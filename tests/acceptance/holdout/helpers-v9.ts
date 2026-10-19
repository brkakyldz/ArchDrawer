import { expect, type Locator } from '@playwright/test';
import type { Shape } from './helpers';
import { assembleRoute, onBorder, type Point, type Box, type routeGeometry } from './helpers-v7';
import { entersBox } from './helpers-v8';

// diagram-v2's drawn box excludes definitions, clipping rectangles and a nested member's paint.
export async function drawnNodeBoxes(surface: Locator): Promise<(Shape & { localWidth: number; localHeight: number })[]> {
  return surface.evaluate(element => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse(), selector = 'g[data-node-id], [data-testid^="node-"][data-kind]';
    return Array.from(root.querySelectorAll(selector)).map(group => {
      const rect = Array.from(group.querySelectorAll('rect')).find(el => {
        if (el.closest('defs, clipPath, mask, marker') || el.closest(selector) !== group) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      });
      if (!rect) throw new Error(`Missing drawn box for ${group.getAttribute('data-node-id') ?? group.getAttribute('data-testid')}`);
      const b = rect.getBBox(), m = inverse.multiply(rect.getScreenCTM()!);
      const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return { tag: 'rect', testId: '', nodeId: group.getAttribute('data-node-id') ?? group.getAttribute('data-testid')!.slice(5),
        edgeId: '', text: '', x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys), localWidth: b.width, localHeight: b.height };
    });
  });
}

type Geometry = Awaited<ReturnType<typeof routeGeometry>>;

// A field may span several text/tspan runs or share a text element with another field.
export async function paintedTextField(surface: Locator, nodeId: string, content: string) {
  return surface.evaluate((element, input) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const selector = 'g[data-node-id], [data-testid^="node-"][data-kind]';
    const group = Array.from(root.querySelectorAll(selector)).find(g =>
      (g.getAttribute('data-node-id') ?? g.getAttribute('data-testid')?.slice(5)) === input.nodeId)!;
    const rect = Array.from(group.querySelectorAll('rect')).find(r => r.closest(selector) === group && !r.closest('defs, clipPath, mask, marker'))!;
    const inverse = root.getScreenCTM()!.inverse(), local = rect.getScreenCTM()!.inverse();
    const characters: { text: string; box: Box; localBox: Box; font: { family: string; size: string; weight: string; loaded: boolean } }[] = [];
    const box = (b: DOMRect, m: DOMMatrix): Box => {
      const points = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
    };
    for (const text of Array.from(group.querySelectorAll('text'))) {
      if (text.closest(selector) !== group || text.closest('defs, clipPath, mask, marker')) continue;
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT); let run: Node | null;
      while ((run = walker.nextNode())) {
        const parent = run.parentElement!, style = getComputedStyle(parent);
        let hidden = style.visibility === 'hidden' || style.visibility === 'collapse';
        for (let part: Element | null = parent; part; part = part.parentElement) {
          const own = getComputedStyle(part); if (own.display === 'none' || Number(own.opacity) === 0) hidden = true;
        }
        const painted = style.fill !== 'none' && Number(style.fillOpacity) > 0 || style.stroke !== 'none' && Number(style.strokeOpacity) > 0;
        if (hidden || !painted) continue;
        for (let i = 0; i < (run.textContent ?? '').length; i++) {
          const character = run.textContent![i]; if (!character.trim()) continue;
          const range = document.createRange(); range.setStart(run, i); range.setEnd(run, i + 1);
          const b = range.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0)) continue;
          characters.push({ text: character, box: box(b, inverse), localBox: box(b, local),
            font: { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight,
              loaded: document.fonts.check(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, character) } });
        }
      }
    }
    characters.sort((a, b) => Math.abs(a.box.top - b.box.top) <= 0.3 ? a.box.left - b.box.left : a.box.top - b.box.top);
    const actual = characters.map(c => c.text).join(''), wanted = input.content.replace(/\s/g, ''), start = actual.indexOf(wanted);
    if (!wanted || start < 0 || actual.indexOf(wanted, start + 1) >= 0) throw new Error(`Missing/ambiguous painted field ${input.nodeId}: ${JSON.stringify({ wanted, actual })}`);
    const runs = characters.slice(start, start + wanted.length);
    const union = (boxes: Box[]): Box => ({ left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)),
      top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)) });
    const card = (rect as SVGGraphicsElement).getBBox(), localBox = union(runs.map(c => c.localBox));
    return { text: runs.map(c => c.text).join(''), box: union(runs.map(c => c.box)), localBox,
      room: { left: localBox.left - card.x, right: localBox.right - card.x, width: localBox.right - localBox.left },
      fonts: runs.map(c => c.font) };
  }, { nodeId, content });
}

// Independent report quantities from complete sampled lines and drawn component boxes, before margins.
export function measuredRouteReport(view: import('./helpers').View, geometries: Geometry[]) {
  if (geometries.length !== view.edges.length || !geometries.length) throw new Error('Need every connection geometry');
  const nodes = geometries[0].nodes, boxes = nodes.map(n => n.box);
  const diagonal = Math.hypot(Math.max(...boxes.map(b => b.right)) - Math.min(...boxes.map(b => b.left)),
    Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)));
  if (!(diagonal > 0)) throw new Error('Missing component bounds');
  const lengths = geometries.map(g => g.routes.reduce((sum, route) => sum + route.slice(1)
    .reduce((length, p, i) => length + Math.hypot(p.x - route[i].x, p.y - route[i].y), 0), 0));
  let crossings = 0;
  for (let i = 0; i < view.edges.length; i++) for (let j = i + 1; j < view.edges.length; j++) {
    const a = view.edges[i], b = view.edges[j];
    if ([a.from, a.to].some(id => id === b.from || id === b.to)) continue;
    if (geometries[i].routes.some(r => geometries[j].routes.some(s => crossingWitness(r, s, 32 * geometries[i].scale)))) crossings++;
  }
  const edgesOverParts: { edge: string; node: string }[] = [];
  for (const [i, edge] of view.edges.entries()) {
    const excluded = new Set([edge.from, edge.to]);
    for (const endpoint of [edge.from, edge.to]) {
      let parent = view.nodes.find(n => n.id === endpoint)?.parent;
      while (parent) { excluded.add(parent); parent = view.nodes.find(n => n.id === parent)?.parent; }
    }
    for (const node of nodes) {
      if (excluded.has(node.id) || view.nodes.find(n => n.id === node.id)?.form === 'group') continue;
      if (geometries[i].routes.some(route => route.slice(1).some((p, k) => entersBox(route[k], p, node.box, 1e-7 * geometries[i].scale))))
        edgesOverParts.push({ edge: edge.id!, node: node.id });
    }
  }
  // shortcut: 0.1 local-px polyline approximates curve length/intersections; upgrade for analytic curve proof.
  return { longestConnection: Math.max(...lengths) / diagonal, crossings, edgesOverParts, lengths, diagonal };
}
export function checkRouteBorders(geometry: Geometry) {
  expect(geometry.sampled).toBeGreaterThan(0); expect(geometry.routes.length).toBeGreaterThan(0); expect(geometry.scale).toBeGreaterThan(0);
  const epsilon = geometry.scale * 0.3, chain = assembleRoute(geometry.routes, geometry.source, geometry.target, epsilon);
  expect(onBorder(chain[0], geometry.source, epsilon), 'line starts on the source border').toBe(true);
  expect(onBorder(chain.at(-1)!, geometry.target, epsilon), 'line ends on the target border').toBe(true);
  let checked = 0;
  const intrusion = geometry.routes.flatMap(points => {
    if (points.length < 2) throw new Error('Empty connection line');
    return points.slice(1).flatMap((b, i) => [geometry.source, geometry.target].filter(box => {
      checked++; return entersBox(points[i], b, box, epsilon);
    }).map(box => ({ a: points[i], b, box })));
  });
  expect(checked).toBeGreaterThan(0); expect(intrusion, 'line continues inside an endpoint part').toEqual([]);
}

// With captions/key/texts hidden, ui-v2 fits the complete drawing into these image margins.
// This independent frame includes room for detours; the parts' extent is not a containment bound.
export async function drawingFrame(surface: Locator): Promise<Box> {
  return surface.evaluate(element => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const margins: Record<string, number> = { feed: 32, linkedin: 24, readme: 32, slide: 40, square: 24 };
    const margin = margins[root.getAttribute('data-format')!], width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
    if (!margin || !(width > margin * 2 && height > margin * 2)) throw new Error('Invalid contracted image frame');
    return { left: margin, top: margin, right: width - margin, bottom: height - margin };
  });
}

export function checkWithinFrame(geometry: Geometry, frame: Box) {
  const epsilon = geometry.scale * 0.3, points = geometry.routes.flat(); expect(points.length).toBeGreaterThan(0);
  const outside = (p: Point) => p.x < frame.left - epsilon || p.x > frame.right + epsilon || p.y < frame.top - epsilon || p.y > frame.bottom + epsilon;
  expect(points.find(outside), 'connection point outside the fitted drawing frame').toBeUndefined();
  if (geometry.badges.length) {
    expect(geometry.badges.find(b => outside({ x: b.left, y: b.top }) || outside({ x: b.right, y: b.bottom })),
      'full step badge outside the fitted drawing frame').toBeUndefined();
  }
}

export async function checkDrawingFit(surface: Locator, geometry: Geometry) {
  checkWithinFrame(geometry, await drawingFrame(surface));
}

// Strict interior crossing, excluding tangencies; return a witness rather than only a verdict.
// shortcut: shared finite route samples, upgrade for analytic arbitrary-curve intersection proof.
export function crossingWitness(a: Point[], b: Point[], cell: number): { a: Point[]; b: Point[] } | null {
  if (a.length < 2 || b.length < 2 || !(cell > 0)) throw new Error('Crossing needs two sampled lines and a positive cell');
  const buckets = new Map<number, number[]>();
  for (let i = 1; i < a.length; i++) {
    for (let key = Math.floor(Math.min(a[i - 1].x, a[i].x) / cell); key <= Math.floor(Math.max(a[i - 1].x, a[i].x) / cell); key++) {
      const entries = buckets.get(key) ?? []; entries.push(i); buckets.set(key, entries);
    }
  }
  const orientation = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const straddles = (points: Point[], end: number, t: number, p: Point, q: Point) => {
    if (t > 1e-9 && t < 1 - 1e-9) return true;
    const before = points[t <= 1e-9 ? end - 2 : end - 1], after = points[t <= 1e-9 ? end : end + 1];
    return !!before && !!after && orientation(p, q, before) * orientation(p, q, after) < 0;
  };
  for (let j = 1; j < b.length; j++) {
    const indices = new Set<number>();
    for (let key = Math.floor(Math.min(b[j - 1].x, b[j].x) / cell); key <= Math.floor(Math.max(b[j - 1].x, b[j].x) / cell); key++) {
      for (const i of buckets.get(key) ?? []) indices.add(i);
    }
    for (const i of indices) {
      const p = a[i - 1], q = a[i], r = b[j - 1], s = b[j];
      if (Math.max(p.y, q.y) < Math.min(r.y, s.y) || Math.max(r.y, s.y) < Math.min(p.y, q.y)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, ex = s.x - r.x, ey = s.y - r.y, denominator = dx * ey - dy * ex;
      if (!denominator) continue;
      const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / denominator, u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && straddles(a, i, t, r, s) && straddles(b, j, u, p, q)) return { a: [p, q], b: [r, s] };
    }
  }
  return null;
}

// Compare complete content/fonts in visual reading order, ignoring SVG run boundaries and child order.
// Coordinates order characters only; their glyph bounds/advances are never equated between images.
export function textFontContent(characters: { nodeId: string | null; text: string; font: number; x: number; y: number }[]) {
  if (!characters.length) throw new Error('No visible text');
  const groups = new Map<string, typeof characters>();
  for (const character of characters) {
    if (![character.font, character.x, character.y].every(Number.isFinite) || character.font <= 0) throw new Error('Invalid text measurement');
    if (!character.text.trim()) continue;
    const key = character.nodeId ?? 'caption', group = groups.get(key) ?? [];
    group.push(character); groups.set(key, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({ key,
    content: group.sort((a, b) => Math.abs(a.y - b.y) <= 0.3 ? a.x - b.x : a.y - b.y).map(c => [c.text, c.font]) }));
}

export async function visibleTextContent(surface: Locator) {
  const characters = await surface.evaluate(element => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const result: { nodeId: string | null; text: string; font: number; x: number; y: number }[] = [];
    for (const text of Array.from(root.querySelectorAll('text'))) {
      if (text.closest('defs, clipPath, mask, marker')) continue;
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT); let run: Node | null;
      while ((run = walker.nextNode())) {
        const parent = run.parentElement!, content = run.textContent ?? '', style = getComputedStyle(parent);
        let hidden = style.visibility === 'hidden' || style.visibility === 'collapse';
        for (let part: Element | null = parent; part; part = part.parentElement) {
          const own = getComputedStyle(part);
          if (own.display === 'none' || Number(own.opacity) === 0) hidden = true;
        }
        const painted = style.fill !== 'none' && Number(style.fillOpacity) > 0 || style.stroke !== 'none' && Number(style.strokeOpacity) > 0;
        for (let i = 0; i < content.length; i++) {
          if (hidden || !painted || !content[i].trim()) continue;
          const range = document.createRange(); range.setStart(run, i); range.setEnd(run, i + 1);
          const bounds = range.getBoundingClientRect();
          if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('Missing visible character');
          const p = new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse);
          result.push({ nodeId: text.closest('g[data-node-id]')?.getAttribute('data-node-id') ??
            (text.closest('g[data-edge-id]') ? `edge:${text.closest('g[data-edge-id]')!.getAttribute('data-edge-id')}` : null),
            text: content[i], font: parseFloat(style.fontSize), x: p.x, y: p.y });
        }
      }
    }
    return result;
  });
  return textFontContent(characters);
}
