import type { Locator } from '@playwright/test';

export type Point = { x: number; y: number };
export type Box = { left: number; right: number; top: number; bottom: number };
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
    // Reuse helpers-v5's enclosing-paint fallback even when the editor hook tags only text.
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
