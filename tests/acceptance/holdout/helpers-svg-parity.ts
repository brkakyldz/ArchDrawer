import { expect, type Locator, type Page } from '@playwright/test';
import { svgInfo, type Shape, type View } from './helpers';

export type Point = { x: number; y: number };
export type Box = { left: number; right: number; top: number; bottom: number };

// ui contract: the same drawn sizes/paths, independently of SVG paint serialization.
export async function compareSVGs(page: Page, first: string, second: string, edges: View['edges']) {
  const measure = async (svg: string) => {
    const info = await svgInfo(page, svg);
    return inDrawingFonts(page, svg, async surface => ({
      metadata: { error: info.error, width: info.width, height: info.height, theme: info.theme,
        format: info.format, viewBox: info.viewBox.trim().split(/[\s,]+/).map(value => Number(value) === 0 ? 0 : Number(value)), xmlns: info.xmlns, forbidden: info.forbidden },
      nodes: info.nodes.map(({ id, width, height }) => ({ id, width, height })).sort((a, b) => a.id.localeCompare(b.id)),
      boxes: (await nodeRectBoxes(surface)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
      text: await visibleTextContent(surface),
      routes: await Promise.all(info.edges.map(async ({ id }) => {
        const edge = edges.find(e => e.id === id); expect(edge, `known connection ${id}`).toBeTruthy();
        return { id, geometry: await routeGeometry(surface, id, edge!.from, edge!.to) };
      })),
    }));
  };
  // Sequential renders use the existing font-sharing iframe and always remove it.
  const a = await measure(first), b = await measure(second);
  expect(a.metadata).toEqual(b.metadata); expect(a.nodes).toEqual(b.nodes); expect(a.text).toEqual(b.text);
  expect(a.boxes.map(n => n.nodeId)).toEqual(b.boxes.map(n => n.nodeId));
  for (const [i, box] of a.boxes.entries()) for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(box[key] - b.boxes[i][key]), `same component ${box.nodeId} ${key}`).toBeLessThanOrEqual(0.3);
  expect(a.routes.map(r => r.id).sort()).toEqual(b.routes.map(r => r.id).sort());
  for (const route of a.routes) compareRoutes(route.geometry, b.routes.find(r => r.id === route.id)!.geometry, false, 0.3);
}

// Compare in image coordinates, omitting only font-embedding markup outside the drawing.
// shortcut: routes use bounds and 17 samples, upgrade to curve equivalence if exact path parity needs proof.
export async function inDrawingFonts<T>(page: Page, svg: string, measure: (surface: Locator) => Promise<T>) {
  await page.evaluate(async markup => {
    await document.fonts.ready;
    const frame = document.createElement('iframe'); frame.setAttribute('data-holdout-image', '');
    frame.style.cssText = 'position:fixed;left:-10000px;width:1920px;height:1500px';
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.open(); doc.write(`<!doctype html><html><body style="margin:0">${markup}</body></html>`); doc.close();
    // FontFace objects can be shared with this same-origin document; ready alone cannot install Geist.
    document.fonts.forEach(face => doc.fonts.add(face));
    await doc.fonts.ready;
  }, svg);
  try {
    return await measure(page.frameLocator('iframe[data-holdout-image]').locator('svg').first());
  } finally { await page.locator('iframe[data-holdout-image]').evaluate(el => el.remove()); }
}

export function onBorder(p: Point, b: Box, epsilon: number) {
  return p.x >= b.left - epsilon && p.x <= b.right + epsilon && p.y >= b.top - epsilon && p.y <= b.bottom + epsilon &&
    Math.min(Math.abs(p.x - b.left), Math.abs(p.x - b.right), Math.abs(p.y - b.top), Math.abs(p.y - b.bottom)) <= epsilon;
}

// Follow adjoining ends in either direction; separated stubs cannot make a connection.
export function assembleRoute(pieces: Point[][], source: Box, target: Box, epsilon: number): Point[] {
  const follow = (chain: Point[], used: Set<number>): Point[] | null => {
    const tip = chain.at(-1)!;
    if (onBorder(tip, target, epsilon)) return chain;
    for (const [i, piece] of pieces.entries()) {
      if (used.has(i) || piece.length < 2) continue;
      for (const points of [piece, [...piece].reverse()]) {
        if (Math.hypot(tip.x - points[0].x, tip.y - points[0].y) > epsilon) continue;
        const result = follow([...chain, ...points], new Set([...used, i]));
        if (result) return result;
      }
    }
    return null;
  };
  for (const [i, piece] of pieces.entries()) {
    if (piece.length < 2) continue;
    for (const points of [piece, [...piece].reverse()]) {
      if (!onBorder(points[0], source, epsilon)) continue;
      const chain = follow(points, new Set([i]));
      if (chain) return chain;
    }
  }
  throw new Error('No continuous source-to-target connection line');
}

// Shared editor/export measurement: export identity is the edge group and its real number.
export function measureEdgeAnnotations(element: Element, input: { edgeId: string; step?: number | null }) {
  const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
  const inverse = root.getScreenCTM()!.inverse();
  const edge = root.querySelector(`g[data-edge-id="${input.edgeId}"], [data-testid="edge-${input.edgeId}"]`)!;
  const visible = (el: Element) => {
    if (el.closest('defs, marker, clipPath, mask')) return false;
    for (let p: Element | null = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const box = (el: SVGGraphicsElement): Box => {
    const b = el.getBBox(), m = inverse.multiply(el.getScreenCTM()!);
    const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
  };
  const texts = Array.from(edge.querySelectorAll('text')).filter(visible);
  const hook = root.querySelector(`[data-testid="step-badge-${input.edgeId}"]`);
  const candidates = [...new Set([...texts, ...(hook ? hook.tagName.toLowerCase() === 'text' ? [hook] : Array.from(hook.querySelectorAll('text')) : [])])].filter(visible);
  const numbers = candidates.filter(t => input.step !== null && (input.step === undefined ? /^\d+$/.test(t.textContent?.trim() ?? '') : t.textContent?.trim() === String(input.step))
    && !t.closest('[data-testid^="edge-label-"]'));
  const badgeTexts = new Set<Element>(), badges: Box[] = [];
  for (const candidate of numbers) {
    const number = candidate as SVGTextElement;
    const measured: SVGGraphicsElement[] = [number];
    let wrapper: SVGGraphicsElement | null = null;
    for (let parent = number.parentElement; parent && parent !== edge && parent !== root; parent = parent.parentElement) {
      if (Array.from(parent.querySelectorAll('text')).some(t => t !== number && t.textContent?.trim())) break;
      if (parent instanceof SVGGraphicsElement && Array.from(parent.querySelectorAll('*')).some(el => el instanceof SVGGeometryElement && visible(el))) {
        wrapper = parent; break;
      }
    }
    if (wrapper) measured.push(wrapper);
    else {
      const b = number.getBBox(), centre = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(number.getScreenCTM()!);
      // shortcut: ungrouped stroke-only/offset paint is ambiguous; upgrade when exports expose badge identity.
      const paint = Array.from((hook ? root : edge).querySelectorAll('*')).filter((el): el is SVGGeometryElement => {
        if (!(el instanceof SVGGeometryElement) || !visible(el)) return false;
        const s = getComputedStyle(el);
        return s.fill !== 'none' && s.fill !== 'transparent' && Number(s.fillOpacity) > 0
          && el.isPointInFill(centre.matrixTransform(el.getScreenCTM()!.inverse()));
      }).sort((a, b) => a.getBBox().width * a.getBBox().height - b.getBBox().width * b.getBBox().height);
      if (paint.length) measured.push(paint[0]);
    }
    if (measured.length === 1) {
      if (hook && (hook === number || hook.contains(number))) throw new Error(`Missing complete badge paint for ${input.edgeId}`);
      continue; // An unpainted numeric label is not a step badge.
    }
    badgeTexts.add(number);
    const boxes = measured.map(box);
    badges.push({ left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)),
      top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)) });
  }
  const labels = texts.filter(t => !badgeTexts.has(t)).map(t => {
    let painted: SVGGraphicsElement = t;
    for (let parent = t.parentElement; parent && parent !== edge && parent !== root; parent = parent.parentElement) {
      if (Array.from(parent.querySelectorAll('text')).some(other => other !== t && other.textContent?.trim())) break;
      if (parent instanceof SVGGraphicsElement && Array.from(parent.querySelectorAll('*')).some(el => el instanceof SVGGeometryElement && visible(el))) { painted = parent; break; }
    }
    return { text: t.textContent ?? '', box: box(painted) };
  });
  return { badges, labels };
}

// Read rendered routes without depending on path order, path commands or one shape per edge.
export async function routeGeometry(surface: Locator, edgeId: string, from: string, to: string) {
  const measured = await surface.evaluate((element, input) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const visible = (el: Element) => {
      for (let part: Element | null = el; part; part = part.parentElement) {
        const s = getComputedStyle(part);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    const box = (el: SVGGraphicsElement) => {
      const b = el.getBBox(), m = inverse.multiply(el.getScreenCTM()!);
      const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
        top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
    };
    const nodeSelector = 'g[data-node-id], [data-testid^="node-"][data-kind]';
    const nodes = Array.from(root.querySelectorAll(nodeSelector)).map(g => {
      const rect = Array.from(g.querySelectorAll('rect')).find(el =>
        !el.closest('defs, clipPath, mask, marker') && el.closest(nodeSelector) === g && visible(el));
      if (!rect) throw new Error(`Missing drawn box for ${g.getAttribute('data-node-id') ?? g.getAttribute('data-testid')}`);
      return {
      id: g.getAttribute('data-node-id') ?? g.getAttribute('data-testid')!.slice(5), box: box(rect),
      localWidth: rect.getBBox().width,
      texts: Array.from(g.querySelectorAll('text')).filter(t => t.closest(nodeSelector) === g && visible(t))
        .map(t => ({ text: t.textContent ?? '', box: box(t) })),
      };
    });
    const source = nodes.find(n => n.id === input.from)!.box, target = nodes.find(n => n.id === input.to)!.box;
    const edge = root.querySelector(`g[data-edge-id="${input.edgeId}"], [data-testid="edge-${input.edgeId}"]`)!;
    const paint = [edge, ...Array.from(edge.querySelectorAll('*'))].filter((el): el is SVGGeometryElement => {
      if (!(el instanceof SVGGeometryElement) || el.closest('defs, marker, [data-testid^="step-badge-"], [data-testid^="edge-label-"]') || !visible(el)) return false;
      // These closed shapes paint badges, label backgrounds or arrowheads, rather than the open line.
      if (el.matches('rect, circle, ellipse, polygon')) return false;
      const s = getComputedStyle(el);
      const transparent = s.stroke === 'transparent' || /^rgba\(/.test(s.stroke) && /,\s*0(?:\.0+)?%?\s*\)$/.test(s.stroke)
        || /\/\s*0(?:\.0+)?%?\s*\)$/.test(s.stroke);
      return s.stroke !== 'none' && !transparent && Number(s.strokeOpacity) > 0 && parseFloat(s.strokeWidth) > 0 && el.getTotalLength() > 0;
    });
    if (!paint.length) throw new Error('No visible stroked connection geometry');
    type Point = { x: number; y: number };
    const pieces: Point[][] = [];
    let sampled = 0;
    for (const el of paint) {
      const length = el.getTotalLength(), m = inverse.multiply(el.getScreenCTM()!);
      const count = Math.max(2, Math.ceil(length / 0.1)), step = length / count * Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
      let piece: Point[] = [];
      for (let i = 0; i <= count; i++) {
        sampled++;
        const p = el.getPointAtLength(length * i / count).matrixTransform(m), point = { x: p.x, y: p.y };
        // A move between disconnected SVG subpaths is not a drawn connecting segment.
        if (piece.length && Math.hypot(point.x - piece.at(-1)!.x, point.y - piece.at(-1)!.y) > step * 1.01 + 0.000001) {
          if (piece.length > 1) pieces.push(piece); piece = [];
        }
        piece.push(point);
      }
      if (piece.length > 1) pieces.push(piece);
    }
    // Normalise by a part's measured size, independent of how path coordinates/transforms are encoded.
    const scale = (source.right - source.left) / nodes.find(n => n.id === input.from)!.localWidth;
    return { nodes, source, target, pieces, sampled, scale };
  }, { edgeId, from, to });
  const { pieces, ...geometry } = measured, { source, target, scale } = geometry;
  const epsilon = scale * 0.3;
  const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= epsilon;
  // Only the source-to-target chain is the line; separate open arrow glyphs are decoration.
  const open = pieces.filter(p => Math.hypot(p[0].x - p.at(-1)!.x, p[0].y - p.at(-1)!.y) > epsilon);
  const routes = [assembleRoute(open, source, target, epsilon)];
  const ports = [routes[0].at(-1)!];
  const runs: { a: Point; b: Point; length: number }[] = [];
  let checked = 0;
  for (const points of routes) {
    let first = 0;
    const flush = (end: number) => {
      const a = points[first], b = points[end];
      if (Math.hypot(b.x - a.x, b.y - a.y) > epsilon) runs.push({ a, b, length: Math.hypot(b.x - a.x, b.y - a.y) });
      first = end;
    };
    for (let i = 1; i < points.length - 1; i++) {
      checked++;
      const a = points[first], b = points[i], c = points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, nx = c.x - b.x, ny = c.y - b.y;
      const denominator = Math.hypot(dx, dy) * Math.hypot(nx, ny);
      if (denominator && (Math.abs(dx * ny - dy * nx) / denominator > 0.0001 || dx * nx + dy * ny <= 0)) flush(i);
    }
    flush(points.length - 1);
  }
  // assembleRoute already orders/reverses pieces. Only consecutive runs can join;
  // comparing every pair makes a long smooth curve quadratic in its sample count.
  const joined: typeof runs = [];
  for (const run of runs) {
    let b = run;
    while (joined.length) {
      const a = joined.at(-1)!;
      const dx = a.a.x - a.b.x, dy = a.a.y - a.b.y, nx = b.b.x - b.a.x, ny = b.b.y - b.a.y;
      if (!near(a.b, b.a) || Math.abs(dx * ny - dy * nx) / (a.length * b.length) > 0.0001 || dx * nx + dy * ny >= 0) break;
      joined.pop(); b = { a: a.a, b: b.b, length: Math.hypot(b.b.x - a.a.x, b.b.y - a.a.y) };
    }
    joined.push(b);
  }
  // shortcut: finite 0.1 local-px sampling, upgrade if analytic arbitrary-curve proof is required.
  const annotations = await surface.evaluate(measureEdgeAnnotations, { edgeId });
  return { ...geometry, ...annotations, routes, ports, straightRuns: joined, longest: [...joined].sort((a, b) => b.length - a.length)[0], checked };
}

type Geometry = Awaited<ReturnType<typeof routeGeometry>>;

// ui contract's parity surface is the first rect of each identified component.
export async function nodeRectBoxes(surface: Locator): Promise<Shape[]> {
  return surface.evaluate(root => {
    const svg = root as SVGSVGElement, inverse = svg.getScreenCTM()!.inverse();
    return Array.from(root.querySelectorAll('g[data-node-id]')).map(group => {
      const rect = group.querySelector('rect')! as SVGRectElement, b = rect.getBBox();
      const m = inverse.multiply(rect.getScreenCTM()!);
      const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return { tag: 'rect', testId: '', nodeId: group.getAttribute('data-node-id')!, edgeId: '', text: '',
        x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    });
  });
}

// Intersect sampled line segments, rather than a route's enclosing rectangle.
export function entersBox(a: Point, b: Point, box: Box, epsilon: number) {
  let lo = 0, hi = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, box.left + epsilon, box.right - epsilon],
    [a.y, b.y - a.y, box.top + epsilon, box.bottom - epsilon]]) {
    if (min >= max) return false;
    if (!delta) { if (origin <= min || origin >= max) return false; }
    else {
      const t = [(min - origin) / delta, (max - origin) / delta].sort((a, b) => a - b);
      lo = Math.max(lo, t[0]); hi = Math.min(hi, t[1]);
    }
  }
  return lo < hi;
}

// Compare positions along measured arc length, independent of SVG commands and element boundaries.
export function routeDistance(a: Point[], b: Point[]) {
  if (a.length < 2 || b.length < 2) throw new Error('Route comparison needs two non-empty lines');
  const lengths = (points: Point[]) => {
    const result = [0];
    for (let i = 1; i < points.length; i++) result.push(result.at(-1)! + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return result;
  };
  const al = lengths(a), bl = lengths(b), count = Math.max(1, Math.ceil(Math.max(al.at(-1)!, bl.at(-1)!) / 0.1));
  let ai = 1, bi = 1, distance = 0;
  const point = (points: Point[], sums: number[], i: number, length: number) => {
    const t = (length - sums[i - 1]) / (sums[i] - sums[i - 1] || 1);
    return { x: points[i - 1].x + t * (points[i].x - points[i - 1].x), y: points[i - 1].y + t * (points[i].y - points[i - 1].y) };
  };
  for (let i = 0; i <= count; i++) {
    const at = al.at(-1)! * i / count, bt = bl.at(-1)! * i / count;
    while (ai < a.length - 1 && al[ai] < at) ai++;
    while (bi < b.length - 1 && bl[bi] < bt) bi++;
    const first = point(a, al, ai, at), second = point(b, bl, bi, bt);
    distance = Math.max(distance, Math.hypot(first.x - second.x, first.y - second.y));
  }
  return distance;
}

export function compareRoutes(a: Geometry, b: Geometry, fitted = false, imageTolerance = 0.001) {
  const normalise = (g: Geometry, p: Point) => fitted ? { x: (p.x - g.source.left) / g.scale, y: (p.y - g.source.top) / g.scale } : p;
  const number = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(fitted ? 0.3 : imageTolerance);
  expect(a.nodes.map(n => n.id).sort()).toEqual(b.nodes.map(n => n.id).sort());
  for (const node of a.nodes) {
    const other = b.nodes.find(n => n.id === node.id)!;
    for (const p of [['left', 'top'], ['right', 'bottom']] as const) {
      const first = normalise(a, { x: node.box[p[0]], y: node.box[p[1]] }), second = normalise(b, { x: other.box[p[0]], y: other.box[p[1]] });
      number(first.x, second.x); number(first.y, second.y);
    }
  }
  const first = a.routes.flat().map(p => normalise(a, p)), second = b.routes.flat().map(p => normalise(b, p));
  expect(routeDistance(first, second), 'same complete connection path').toBeLessThanOrEqual(fitted ? 0.3 : Math.max(imageTolerance, Math.max(a.scale, b.scale) * 0.3));
  expect(a.badges).toHaveLength(b.badges.length);
  for (const [i, badge] of a.badges.entries()) for (const p of [['left', 'top'], ['right', 'bottom']] as const) {
    const first = normalise(a, { x: badge[p[0]], y: badge[p[1]] }), second = normalise(b, { x: b.badges[i][p[0]], y: b.badges[i][p[1]] });
    number(first.x, second.x); number(first.y, second.y);
  }
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

// Independent report quantities from complete sampled lines and drawn component boxes, before margins.
export function measuredRouteReport(view: View, geometries: Geometry[]) {
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

// Minimum for exclusion/lower bounds. Pass only the group's own name, sub-line and detail-marker glyph boxes.
export function groupNameBox(group: Box, texts: Box[], scale: number): Box {
  if (!texts.length) throw new Error('Missing group name text');
  return { left: group.left, right: Math.max(...texts.map(b => b.right)) + 2 * scale,
    top: group.top, bottom: group.top + 46 * scale };
}

export const overlapsBox = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
