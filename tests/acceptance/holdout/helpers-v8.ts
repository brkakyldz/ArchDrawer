import { expect, type Locator } from '@playwright/test';
import type { Shape } from './helpers';
import { assembleRoute, onBorder, type routeGeometry } from './helpers-v7';
import type { imageGeometry } from './helpers-v5';

// ui-v2's parity surface is the first rect of each identified component.
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

type Point = { x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number };

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

export function checkBorders(geometry: Awaited<ReturnType<typeof routeGeometry>>) {
  expect(geometry.routes.length).toBeGreaterThan(0); expect(geometry.sampled).toBeGreaterThan(0);
  expect(geometry.scale).toBeGreaterThan(0);
  const epsilon = geometry.scale * 0.3;
  const chain = assembleRoute(geometry.routes, geometry.source, geometry.target, epsilon);
  expect(onBorder(chain[0], geometry.source, epsilon), 'line starts on the source border').toBe(true);
  expect(onBorder(chain.at(-1)!, geometry.target, epsilon), 'line ends on the target border').toBe(true);
  let checked = 0, firstViolation: { segment: Point[]; box: Box } | null = null;
  for (const points of geometry.routes) for (let i = 1; i < points.length; i++) for (const box of [geometry.source, geometry.target]) {
    checked++;
    if (!firstViolation && entersBox(points[i - 1], points[i], box, epsilon)) firstViolation = { segment: [points[i - 1], points[i]], box };
  }
  expect(firstViolation, 'line continues inside an endpoint part').toBe(null); expect(checked).toBeGreaterThan(0);
}

type Geometry = Awaited<ReturnType<typeof routeGeometry>>;
export function drawingBounds(geometry: Geometry): Box {
  expect(geometry.nodes.length).toBeGreaterThan(0);
  return { left: Math.min(...geometry.nodes.map(n => n.box.left)), right: Math.max(...geometry.nodes.map(n => n.box.right)),
    top: Math.min(...geometry.nodes.map(n => n.box.top)), bottom: Math.max(...geometry.nodes.map(n => n.box.bottom)) };
}

export function checkContained(geometry: Geometry, bounds = drawingBounds(geometry)) {
  const epsilon = geometry.scale * 0.3, points = geometry.routes.flat();
  expect(points.length).toBeGreaterThan(0);
  const outside = (p: Point) => p.x < bounds.left - epsilon || p.x > bounds.right + epsilon || p.y < bounds.top - epsilon || p.y > bounds.bottom + epsilon;
  expect(points.find(outside) ?? null, 'first route point outside drawing bounds').toBe(null);
  expect(geometry.badges.find(b => outside({ x: b.left, y: b.top }) || outside({ x: b.right, y: b.bottom })) ?? null,
    'first badge outside drawing bounds').toBe(null);
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

// Match measured text by content and position, ignoring SVG element order and 1e-6 rounding boundaries.
export function compareImageText(a: Awaited<ReturnType<typeof imageGeometry>>, b: Awaited<ReturnType<typeof imageGeometry>>) {
  const first = a.filter(p => p.tag.toLowerCase() === 'text'), remaining = b.filter(p => p.tag.toLowerCase() === 'text');
  expect(first.length).toBeGreaterThan(0); expect(remaining).toHaveLength(first.length);
  const numbers = (x: unknown, y: unknown): void => {
    if (typeof x === 'number' && typeof y === 'number') expect(Math.abs(x - y)).toBeLessThanOrEqual(0.001);
    else if (Array.isArray(x) && Array.isArray(y)) { expect(x).toHaveLength(y.length); x.forEach((v, i) => numbers(v, y[i])); }
    else expect(x).toEqual(y);
  };
  for (const text of first) {
    const matches = remaining.map((p, i) => ({ p, i })).filter(({ p }) => p.text === text.text);
    expect(matches.length, text.text ?? '').toBeGreaterThan(0);
    const nearest = matches.sort((a, b) => Math.hypot(a.p.box[0][0] - text.box[0][0], a.p.box[0][1] - text.box[0][1]) -
      Math.hypot(b.p.box[0][0] - text.box[0][0], b.p.box[0][1] - text.box[0][1]))[0];
    numbers(text.box, nearest.p.box); numbers(text.font, nearest.p.font); numbers(text.characters, nearest.p.characters);
    remaining.splice(nearest.i, 1);
  }
  expect(remaining).toHaveLength(0);
}
