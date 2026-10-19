import { expect, type Locator, type Page } from '@playwright/test';
import { component, drawing, settledReport } from './helpers';
import { onBorder, routeGeometry, type Box, type Point } from './helpers-v7';
import { entersBox, routeDistance } from './helpers-v8';

export type Geometry = Awaited<ReturnType<typeof routeGeometry>>;
export type Cubic = [Point, Point, Point, Point];
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const centre = (b: Box): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
// Minimum for exclusion/lower bounds; maximum for witnesses valid at every allowed layout end.
// Pass only the group's own name, sub-line and detail-marker glyph boxes.
export function groupNameBox(group: Box, texts: Box[], scale: number, extent: 'minimum' | 'maximum' = 'minimum'): Box {
  if (!texts.length) throw new Error('Missing group name text');
  const overhang = extent === 'maximum' ? 0.02 * Math.max(...texts.map(b => b.right - b.left)) : 0;
  return { left: group.left, right: Math.max(...texts.map(b => b.right)) + overhang + 2 * scale,
    top: group.top, bottom: group.top + 46 * scale };
}
export const lineLength = (p: Point[]) => p.slice(1).reduce((sum, b, i) => sum + distance(p[i], b), 0);
export const shortestHandle = (curves: Cubic[]) => Math.min(...curves.flatMap(c => [distance(c[0], c[1]), distance(c[2], c[3])]));
// Subdivided control polygons bound the true length from above, unlike sampled chords.
export function cubicLengthUpperBound(curves: Cubic[]): number {
  const half = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const bound = (c: Cubic, depth: number): number => {
    if (!depth) return lineLength(c);
    const a = half(c[0], c[1]), b = half(c[1], c[2]), z = half(c[2], c[3]);
    const p = half(a, b), q = half(b, z), middle = half(p, q);
    return bound([c[0], a, p, middle], depth - 1) + bound([middle, q, z, c[3]], depth - 1);
  };
  return curves.reduce((sum, c) => sum + bound(c, 8), 0);
}
export const overlapsBox = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const sameBox = (a: Box, b: Box) => a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
export const boxGap = (a: Box, b: Box) => Math.hypot(Math.max(a.left - b.right, b.left - a.right, 0), Math.max(a.top - b.bottom, b.top - a.bottom, 0));
const pointBox = (p: Point): Box => ({ left: p.x, right: p.x, top: p.y, bottom: p.y });
const pointSegmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
};
export function segmentBoxDistance(a: Point, b: Point, box: Box) {
  if (entersBox(a, b, box, 0)) return 0;
  return Math.min(boxGap(pointBox(a), box), boxGap(pointBox(b), box),
    ...[box.left, box.right].flatMap(x => [box.top, box.bottom].map(y => pointSegmentDistance({ x, y }, a, b))));
}
export const arcCap = (g: Pick<Geometry, 'source' | 'target' | 'scale'>) => Math.max(1.8 * distance(centre(g.source), centre(g.target)), distance(centre(g.source), centre(g.target)) + 120 * g.scale);

// Parse the public SVG grammar, including relative/implicit cubic coordinates and exponent numbers.
export function parseCubics(d: string): Cubic[] {
  const tokens = d.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|[a-z]/gi) ?? [];
  if (d.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|[a-z]|[\s,]/gi, '')) throw new Error('Invalid path token');
  let i = 0, current: Point = { x: 0, y: 0 };
  const number = () => { const n = Number(tokens[i++]); if (!Number.isFinite(n)) throw new Error('Missing path number'); return n; };
  const move = tokens[i++]; if (!/^[Mm]$/.test(move ?? '')) throw new Error('Connection must start with M');
  current = { x: number(), y: number() };
  const curves: Cubic[] = []; let command = '';
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
    if (!/^[Cc]$/.test(command)) throw new Error('Only cubic commands may follow the initial move');
    const origin = current;
    const point = (): Point => ({ x: number() + (command === 'c' ? origin.x : 0), y: number() + (command === 'c' ? origin.y : 0) });
    const c1 = point(), c2 = point(), end = point(); curves.push([current, c1, c2, end]); current = end;
  }
  if (curves.length < 1 || curves.length > 3) throw new Error('Connection needs one to three cubics');
  return curves;
}

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export function angle(a: Point, b: Point) {
  if (!(Math.hypot(a.x, a.y) > 1e-8 && Math.hypot(b.x, b.y) > 1e-8)) throw new Error('Zero direction handle');
  return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * 180 / Math.PI;
}
function checkJoins(curves: Cubic[], epsilon: number) {
  for (let i = 1; i < curves.length; i++) {
    expect(distance(curves[i - 1][3], curves[i][0])).toBeLessThanOrEqual(epsilon);
    expect(angle(subtract(curves[i - 1][3], curves[i - 1][2]), subtract(curves[i][1], curves[i][0])), 'cubic joint angle, degrees').toBeLessThanOrEqual(1 + 1e-6);
  }
}
function checkEnd(p: Point, handle: Point, box: Box, epsilon: number) {
  expect(onBorder(p, box, epsilon), 'curve end on its part').toBe(true);
  const normals = [{ delta: Math.abs(p.x - box.left), x: -1, y: 0 }, { delta: Math.abs(p.x - box.right), x: 1, y: 0 },
    { delta: Math.abs(p.y - box.top), x: 0, y: -1 }, { delta: Math.abs(p.y - box.bottom), x: 0, y: 1 }].filter(n => n.delta <= epsilon);
  expect(Math.min(...normals.map(n => angle(subtract(handle, p), n))), 'handle along outward side normal').toBeLessThanOrEqual(1e-5);
}
export function checkSmooth(curves: Cubic[], source: Box, target: Box, epsilon: number, scale = 1) {
  expect(curves.length, 'complete connection has one to three cubics').toBeGreaterThanOrEqual(1);
  expect(curves.length, 'complete connection has one to three cubics').toBeLessThanOrEqual(3);
  expect(shortestHandle(curves), 'every handle is at least 24 drawing px').toBeGreaterThanOrEqual(24 * scale - scale * 1e-7);
  checkJoins(curves, epsilon);
  const first = curves[0], last = curves.at(-1)!;
  const forward = onBorder(first[0], source, epsilon);
  checkEnd(first[0], first[1], forward ? source : target, epsilon); checkEnd(last[3], last[2], forward ? target : source, epsilon);
}

export async function smoothConnection(surface: Locator, id: string, from: string, to: string) {
  const g = await routeGeometry(surface, id, from, to);
  const measured = await surface.evaluate((element, input) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const edge = root.querySelector(`[data-testid="edge-${input.id}"], g[data-edge-id="${input.id}"]`)!;
    const inverse = root.getScreenCTM()!.inverse();
    const paths = [edge, ...Array.from(edge.querySelectorAll('*'))].filter((el): el is SVGGeometryElement => {
      if (!(el instanceof SVGGeometryElement) || el.closest('defs, marker, clipPath, mask, [data-testid^="step-badge-"], [data-testid^="edge-label-"]')) return false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
      }
      const s = getComputedStyle(el);
      const transparent = s.stroke === 'transparent' || /^rgba\(/.test(s.stroke) && /,\s*0(?:\.0+)?%?\s*\)$/.test(s.stroke)
        || /\/\s*0(?:\.0+)?%?\s*\)$/.test(s.stroke);
      if (s.stroke === 'none' || transparent || Number(s.strokeOpacity) === 0 || !(parseFloat(s.strokeWidth) > 0)) return false;
      return el.getTotalLength() > 0;
    }).map(el => {
      const m = inverse.multiply(el.getScreenCTM()!);
      const point = (length: number) => { const p = el.getPointAtLength(length).matrixTransform(m); return { x: p.x, y: p.y }; };
      return { d: el.getAttribute('d') ?? '', matrix: [m.a, m.b, m.c, m.d, m.e, m.f], a: point(0), b: point(el.getTotalLength()) };
    });
    // ui-v2 names the label separately; it need not be a child of the edge path.
    const label = root.querySelector(`[data-testid="edge-label-${input.id}"]`) as SVGGraphicsElement | null;
    let drawn = !!label;
    for (let p: Element | null = label; p; p = p.parentElement) {
      const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) drawn = false;
    }
    if (!label || !drawn) return { paths, label: null };
    const b = label.getBBox(), m = inverse.multiply(label.getScreenCTM()!);
    const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    return { paths, label: { text: label.textContent ?? '', box: { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
      top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) } } };
  }, { id, source: g.source, target: g.target, epsilon: g.scale * 0.3 });
  // Glow and line may repeat or split geometry; ui-v2 counts connections, not paint layers.
  const paths = [...new Map(measured.paths.map(p => [JSON.stringify(p), p])).values()];
  const epsilon = g.scale * 0.3, reference = g.routes[0];
  const nearest = (p: Point) => reference.reduce((best, q, i) => distance(p, q) < distance(p, reference[best]) ? i : best, 0);
  const pieces: Cubic[][] = [];
  for (const { d, matrix: m, a, b } of paths) {
    if (distance(a, b) <= 1e-8) continue; // Closed arrow/badge paint is not the open connection.
    const ai = nearest(a), bi = nearest(b);
    // Recognize contributing strokes before parsing: separate glyphs and implicit
    // arrowhead fills do not join two distinct positions on the connection.
    const onLine = (p: Point, i: number) => distance(p, reference[i]) <= epsilon || onBorder(p, g.source, epsilon) || onBorder(p, g.target, epsilon);
    if (!(onLine(a, ai) && onLine(b, bi)) || ai === bi || distance(reference[ai], reference[bi]) <= epsilon) continue;
    const curves = parseCubics(d).map(c => c.map(p => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })) as Cubic);
    expect(shortestHandle(curves), 'every contributing handle is at least 24 drawing px').toBeGreaterThanOrEqual(24 * g.scale - g.scale * 1e-7);
    checkJoins(curves, epsilon);
    const points = sampleCubics(curves);
    const section = reference.slice(Math.min(ai, bi), Math.max(ai, bi) + 1);
    if (bi < ai) section.reverse();
    expect(routeDistance(section, points), 'every visible cubic piece follows its section of the connection').toBeLessThanOrEqual(epsilon);
    for (const [p, handle] of [[curves[0][0], curves[0][1]], [curves.at(-1)![3], curves.at(-1)![2]]])
      for (const box of [g.source, g.target]) if (onBorder(p, box, epsilon)) checkEnd(p, handle, box, epsilon);
    pieces.push(bi < ai ? [...curves].reverse().map(c => [...c].reverse() as Cubic) : curves);
  }
  for (const a of pieces) for (const b of pieces) if (a !== b && distance(a.at(-1)![3], b[0][0]) <= epsilon)
    checkJoins([a.at(-1)!, b[0]], epsilon);
  const curves = assembleCubics(pieces, g.source, g.target, epsilon, g.scale);
  return { ...g, labels: measured.label ? [measured.label] : g.labels, curves, cubicJoins: curves.length - 1 };
}

// Pieces already face forward along the measured route; validate every complete paint chain.
export function assembleCubics(pieces: Cubic[][], source: Box, target: Box, epsilon: number, scale = 1): Cubic[] {
  const unique = [...new Map(pieces.map(piece => [JSON.stringify(piece), piece])).values()];
  let result: Cubic[] | null = null;
  const follow = (chain: Cubic[], used: Set<number>) => {
    if (chain.length && onBorder(chain.at(-1)![3], target, epsilon)) {
      checkSmooth(chain, source, target, epsilon, scale);
      result ??= chain;
      return;
    }
    for (const [i, piece] of unique.entries()) {
      if (used.has(i)) continue;
      if (!chain.length ? !onBorder(piece[0][0], source, epsilon) : distance(chain.at(-1)![3], piece[0][0]) > epsilon) continue;
      follow([...chain, ...piece], new Set([...used, i]));
    }
  };
  follow([], new Set());
  if (!result) throw new Error('No continuous source-to-target curve of one to three cubics');
  return result;
}

export function arcClear(g: Geometry, boxes: Box[], tolerance = 0) {
  const points = g.routes[0];
  return [...boxes, g.source, g.target].every(box => {
    const otherPart = g.nodes.some(n => sameBox(n.box, box)) && !sameBox(box, g.source) && !sameBox(box, g.target);
    return points.slice(1).every((p, i) => otherPart
      ? segmentBoxDistance(points[i], p, box) >= 8 * g.scale - tolerance
      : !entersBox(points[i], p, box, tolerance));
  });
}
export function checkClear(g: Geometry, boxes: Box[], tolerance = g.scale * 0.05) {
  expect(g.routes[0].length).toBeGreaterThan(1);
  expect(arcClear(g, boxes, tolerance), 'arc: 8 px from other parts, no entry into ends or group names').toBe(true);
}
export function checkCap(g: Geometry) {
  expect(lineLength(g.routes[0]), 'max(1.8 × centre distance, centre distance + 120 px)').toBeLessThanOrEqual(arcCap(g) + g.scale * 0.3);
}

// Horizontal outward handles keep any plain cubic inside the end ports' vertical hull.
export function checkHorizontalObstruction(g: Geometry, obstacle: Box) {
  expect(g.target.left - g.source.right).toBeGreaterThan(0);
  expect(Math.abs(centre(g.target).x - centre(g.source).x)).toBeGreaterThan(Math.abs(centre(g.target).y - centre(g.source).y));
  expect(obstacle.left).toBeGreaterThan(g.source.right); expect(obstacle.right).toBeLessThan(g.target.left);
  expect(obstacle.top).toBeLessThan(Math.min(g.source.top, g.target.top));
  expect(obstacle.bottom).toBeGreaterThan(Math.max(g.source.bottom, g.target.bottom));
}

export function sampleCubics(curves: Cubic[]): Point[] {
  // shortcut: 1024 samples per cubic for independent candidate witnesses; upgrade for analytic intersection proofs.
  return curves.flatMap((c, index) => Array.from({ length: 1025 }, (_, i) => {
    const t = i / 1024, u = 1 - t;
    return { x: u ** 3 * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t ** 3 * c[3].x,
      y: u ** 3 * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t ** 3 * c[3].y };
  }).slice(index ? 1 : 0));
}

// Independently constructed two-cubic alternatives, not a reconstruction of the product's search.
export function arcWitnesses(g: Geometry, forbidden: Box[], usedSource: string[] = [], usedTarget: string[] = []) {
  const sides = (b: Box) => [
    { name: 'left', p: { x: b.left, y: centre(b).y }, n: { x: -1, y: 0 } },
    { name: 'right', p: { x: b.right, y: centre(b).y }, n: { x: 1, y: 0 } },
    { name: 'top', p: { x: centre(b).x, y: b.top }, n: { x: 0, y: -1 } },
    { name: 'bottom', p: { x: centre(b).x, y: b.bottom }, n: { x: 0, y: 1 } },
  ];
  const facing = (b: Box, other: Box) => {
    const a = centre(b), z = centre(other), dx = z.x - a.x, dy = z.y - a.y;
    return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
  };
  const eligible = (s: ReturnType<typeof sides>[number], b: Box, other: Box, used: string[]) => {
    if (s.name === facing(b, other)) return true;
    if (used.includes(s.name)) return false;
    // Whole side, not only its centre, must be 40 px from every other part.
    const side = s.name === 'left' || s.name === 'right' ? { left: s.p.x, right: s.p.x, top: b.top, bottom: b.bottom } :
      { left: b.left, right: b.right, top: s.p.y, bottom: s.p.y };
    return g.nodes.filter(n => !sameBox(n.box, b) && forbidden.some(q => sameBox(q, n.box))).every(({ box: q }) => Math.hypot(Math.max(q.left - side.right, side.left - q.right, 0),
      Math.max(q.top - side.bottom, side.top - q.bottom, 0)) >= 40 * g.scale);
  };
  const result: { curves: Cubic[]; points: Point[]; length: number }[] = [];
  for (const a of sides(g.source).filter(s => eligible(s, g.source, g.target, usedSource)))
    for (const b of sides(g.target).filter(s => eligible(s, g.target, g.source, usedTarget))) {
      const span = distance(a.p, b.p), h = Math.min(span / 5, 64 * g.scale);
      for (const offset of [-1, -0.5, -0.25, 0.25, 0.5, 1]) {
        const bend = { x: (a.p.x + b.p.x) / 2 - (b.p.y - a.p.y) * offset,
          y: (a.p.y + b.p.y) / 2 + (b.p.x - a.p.x) * offset };
        const tangent = { x: (b.p.x - a.p.x) / 6, y: (b.p.y - a.p.y) / 6 };
        const curves: Cubic[] = [[a.p, { x: a.p.x + a.n.x * h, y: a.p.y + a.n.y * h },
          { x: bend.x - tangent.x, y: bend.y - tangent.y }, bend],
        [bend, { x: bend.x + tangent.x, y: bend.y + tangent.y }, { x: b.p.x + b.n.x * h, y: b.p.y + b.n.y * h }, b.p]];
        if (shortestHandle(curves) < 24 * g.scale) continue;
        const points = sampleCubics(curves), length = lineLength(points);
        // A sampled chord sum cannot certify the cap; reserve 0.001 drawing px.
        if (cubicLengthUpperBound(curves) > arcCap(g) - 0.001 * g.scale) continue;
        if (!arcClear({ ...g, routes: [points] }, forbidden)) continue;
        result.push({ curves, points, length });
      }
    }
  return result;
}

// Compact endpoints fit wholly within the middle card's vertical band, at every facing port.
export function arcDrawing(label = '', step: number | null = null) {
  const doc = drawing('Short arc'); doc.showSteps = true;
  doc.views[0].nodes = [component('start', { label: 'Start', form: 'compact', x: 0, y: 240 }),
    component('obstacle', { label: 'Other work', x: 480, y: 200 }),
    component('end', { label: 'End', form: 'compact', x: 960, y: 240 }),
    component('zone', { label: 'Runtime name', form: 'group' }),
    component('member', { label: 'Named work', parent: 'zone', x: 480, y: 450 })];
  doc.views[0].edges = [{ id: 'arc', from: 'start', to: 'end', label, step, style: 'call', both: false }];
  return doc;
}

export async function fullEditor(page: Page) {
  for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
    const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
  }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
}
export async function shareGeometry(page: Page, format = 'readme') {
  await page.getByTestId('share-button').click(); await page.getByTestId(`format-${format}`).click();
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  for (const id of ['title', 'lede', 'legend', 'texts']) await page.getByTestId(`show-${id}`).uncheck();
  for (const id of ['labels', 'steps', 'items']) await page.getByTestId(`show-${id}`).check();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('share-dialog').getByTestId('layout-report')).toHaveAttribute('data-format', format);
  return settledReport(page);
}

export function arcMiddle(points: Point[]): Point {
  const sums = [0];
  for (let i = 1; i < points.length; i++) sums.push(sums.at(-1)! + distance(points[i - 1], points[i]));
  const half = sums.at(-1)! / 2; let midIndex = sums.findIndex(n => n >= half);
  const t = (half - sums[midIndex - 1]) / (sums[midIndex] - sums[midIndex - 1]);
  return { x: points[midIndex - 1].x + t * (points[midIndex].x - points[midIndex - 1].x),
    y: points[midIndex - 1].y + t * (points[midIndex].y - points[midIndex - 1].y) };
}

// Compare independent box centres, including the exact arc-length middle and obstacle tangencies.
// Never carry the output's displacement from the curve into the candidate placements.
export function checkNearestMiddle(g: Geometry, box: Box, otherBoxes: Box[], kind: 'label' | 'badge' = 'label', witnessBoxes = otherBoxes) {
  expect(box.right - box.left).toBeGreaterThan(0); expect(box.bottom - box.top).toBeGreaterThan(0);
  // The arc fixture's zone boundary may be entered; its full name box arrives in otherBoxes.
  const forbidden = [...g.nodes.filter(n => n.id !== 'zone').map(n => n.box), ...otherBoxes];
  const witnessForbidden = [...g.nodes.filter(n => n.id !== 'zone').map(n => n.box), ...witnessBoxes];
  const actual = centre(box), w = (box.right - box.left) / 2, h = (box.bottom - box.top) / 2;
  const gap = kind === 'label' ? 4 * g.scale : Math.max(w, h) + 3 * g.scale;
  const free = (p: Point, boxes = forbidden) => boxes.every(b => boxGap(kind === 'badge' ? pointBox(p) :
    { left: p.x - w, right: p.x + w, top: p.y - h, bottom: p.y + h }, b) >= gap - g.scale * 1e-7);
  expect(free(actual), 'annotation has its contracted clearance').toBe(true);
  const points = g.routes[0], midpoint = arcMiddle(points);
  // Expanded boundaries give conservative legal candidates; rounded clearance
  // corners may offer still better spots, so this is a finite upper bound only.
  const curveDistance = (p: Point) => {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) best = Math.min(best, pointSegmentDistance(p, points[i - 1], points[i]));
    return best;
  };
  const tether = w + 10 * g.scale;
  if (kind === 'label') {
    let nearest = Infinity;
    for (let i = 1; i < points.length; i++) nearest = Math.min(nearest, segmentBoxDistance(points[i - 1], points[i], box));
    expect(nearest, 'label box stays within half its width + 10 px of curve').toBeLessThanOrEqual(tether + g.scale * 0.05);
  }
  const dx = kind === 'label' ? w + gap : gap, dy = kind === 'label' ? h + gap : gap;
  const xs = [midpoint.x, ...witnessForbidden.flatMap(b => [b.left - dx, b.right + dx])];
  const ys = [midpoint.y, ...witnessForbidden.flatMap(b => [b.top - dy, b.bottom + dy])];
  let best = Infinity, count = 0;
  for (const [p, onCurve] of [...points.map(p => [p, true] as const),
    ...xs.flatMap(x => ys.map(y => [{ x, y }, false] as const))]) {
    if (!free(p, witnessForbidden) || !onCurve && kind === 'label' && curveDistance(p) > tether) continue;
    count++; best = Math.min(best, distance(p, midpoint));
  }
  expect(count).toBeGreaterThan(0);
  expect(distance(actual, midpoint), 'no independent free box centre is closer to the arc-length middle').toBeLessThanOrEqual(best + g.scale * 0.6);
}
