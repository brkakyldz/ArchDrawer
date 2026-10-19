import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, download } from './helpers';
import { inDrawingFonts } from './helpers-v5';
import { compareRoutes } from './helpers-v8';
import { arcDrawing, smoothConnection, checkClear, checkCap, checkHorizontalObstruction, arcWitnesses, lineLength, shareGeometry, fullEditor, groupNameBox,
  centre, distance, arcCap, sampleCubics, checkSmooth, cubicLengthUpperBound, segmentBoxDistance, type Geometry, type Cubic } from './helpers-v13';
import type { Box, Point } from './helpers-v7';

// diagram-v2 sizes names "through the bundled Geist metrics". Glyphs measured
// before a bundled face loads are fallback glyphs, which end short of the real
// name and so shrink the minimum name box; load every painted face first.
async function drawingFontsLoaded(surface: import('@playwright/test').Locator) {
  const missing = await surface.evaluate(async element => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const fonts = root.ownerDocument.fonts; await fonts.ready;
    const faces = Array.from(root.querySelectorAll('text')).filter(t => t.textContent?.trim()).map(t => {
      const s = getComputedStyle(t); return { font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, text: t.textContent! };
    });
    await Promise.all(faces.map(f => fonts.load(f.font, f.text))); await fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    return [...new Set(faces.filter(f => !fonts.check(f.font, f.text)).map(f => f.font))];
  });
  expect(missing, 'every painted face is loaded before glyphs are measured').toEqual([]);
}

// Both measured ports lie within the name's x span, on opposite sides of its
// full-height band. Any name-clear route goes round both corners of one side;
// straight distances through those corners bound its length from below.
const nameEntryBound = (start: Point, name: Box, entry: Point) => Math.min(...[name.left, name.right].map(x =>
  distance(start, { x, y: name.top }) + (name.bottom - name.top)
  + distance({ x, y: name.bottom }, entry)));
// The same bound for every port on the two parts' borders, so it holds whatever
// ports a legal arc or the fallback uses: the nearest point of each part.
const gap = (b: Box, p: Point) => Math.hypot(Math.max(b.left - p.x, p.x - b.right, 0), Math.max(b.top - p.y, p.y - b.bottom, 0));
const anyPortBound = (source: Box, name: Box, target: Box) => Math.min(...[name.left, name.right].map(x =>
  gap(source, { x, y: name.top }) + (name.bottom - name.top) + gap(target, { x, y: name.bottom })));

// diagram-v2 at spec@3bb5b39: the layout end "lies at or past the painted glyphs
// and up to 4 % of the name's width beyond them". Taking that width as the
// layout one (the wider reading), the overhang o obeys o <= 0.04 (w + o), so
// o <= w / 24. Witnesses clear this widest box; bounds use groupNameBox's
// smallest (painted end + 2 px).
const widestNameBox = (group: Box, texts: Box[], scale: number): Box => {
  const box = groupNameBox(group, texts, scale);
  return { ...box, right: box.right + Math.max(...texts.map(b => b.right - b.left)) / 24 };
};

// Side-middle ports, which a lone connection on a free side always has; the
// chain turns at both corners of one end of the name; all handles are 24 px.
const sideWitness = (g: Geometry, name: Box, side: 'left' | 'right'): Cubic[] => {
  const s = side === 'right' ? 1 : -1, h = 24 * g.scale, x = side === 'right' ? name.right + 0.01 * g.scale : name.left - 0.01 * g.scale;
  const port = (b: Box) => ({ x: side === 'right' ? b.right : b.left, y: (b.top + b.bottom) / 2 });
  const a = port(g.source), b = port(g.target);
  const p = { x, y: name.top - 0.01 * g.scale }, q = { x, y: name.bottom + 0.01 * g.scale };
  return [[a, { x: a.x + s * h, y: a.y }, { x: p.x, y: p.y - h }, p],
    [p, { x: p.x, y: p.y + h }, { x: q.x, y: q.y - h }, q],
    [q, { x: q.x, y: q.y + h }, { x: b.x + s * h, y: b.y }, b]];
};

// LAY-8 / diagram-v2: "An arc never enters a group's name and stays clear of parts";
// "lowest cost wins"; "No arc is longer than the larger of 1.8 × that distance and that distance + 120 px."
test('H80 [LAY-8, SHR-6] take a short clear arc around a part without entering a group name', async ({ page, request }) => {
  const doc = arcDrawing(), { dir, file } = await workspace('h80', doc); await openDrawing(page, request, file); await fullEditor(page);
  const check = async (surface: import('@playwright/test').Locator) => {
    const g = await smoothConnection(surface, 'arc', 'start', 'end');
    const zone = g.nodes.find(n => n.id === 'zone')!;
    const name = groupNameBox(zone.box, zone.texts.map(t => t.box), g.scale);
    const obstacle = g.nodes.find(n => n.id === 'obstacle')!.box;
    checkHorizontalObstruction(g, obstacle);
    const forbidden = [...g.nodes.filter(n => n.id !== 'zone').map(n => n.box), name];
    checkClear(g, forbidden); checkCap(g);
    const witnessName = widestNameBox(zone.box, zone.texts.map(t => t.box), g.scale);
    const candidates = arcWitnesses(g, [...forbidden.slice(0, -1), witnessName]); expect(candidates.length, 'independent admissible smooth alternatives exist').toBeGreaterThan(0);
    // No earlier lines here: cost reduces to length / the same centre distance.
    expect(lineLength(g.routes[0]), 'chosen arc costs no more than any witnessed legal arc').toBeLessThanOrEqual(Math.min(...candidates.map(c => c.length)) + g.scale * 0.5);
    return g;
  };
  const editor = await check(page.getByTestId('canvas')); const baseline = await readFile(file, 'utf8');
  expect(await shareGeometry(page)).toMatchObject({ overParts: 0, connections: 1 });
  const preview = await check(page.getByTestId('share-preview')); compareRoutes(editor, preview, true);
  const out = join(dir, 'arc.svg'); await download(page, 'download-svg', out);
  compareRoutes(preview, await inDrawingFonts(page, await readFile(out, 'utf8'), check)); expect(await readFile(file, 'utf8')).toBe(baseline);

  // d = 110 permits 230 px. The anchor puts the name's painted end about 118 px
  // right of both parts, so even the smallest allowed name box (painted end
  // + 2 px) leaves every name-clear route, from any port, above 231 px.
  const short = drawing('Short-distance arc cap'), name = 'W'.repeat(48);
  short.views[0].nodes = [component('short-start', { label: 'In', form: 'compact', x: 0, y: 0 }),
    component('short-end', { label: 'In', form: 'compact', parent: 'short-zone', x: 0, y: 110 }),
    component('short-anchor', { label: 'In', form: 'compact', parent: 'short-zone', x: -442, y: 110 }),
    component('short-zone', { label: name, form: 'group' })];
  short.views[0].edges = [{ id: 'short-arc', from: 'short-start', to: 'short-end', label: '', style: 'call', both: false, step: null }];
  const shortFile = await workspace('h80-short-cap', short); await openDrawing(page, request, shortFile.file);
  const shortBytes = await readFile(shortFile.file, 'utf8');
  const shortReport = await shareGeometry(page);
  await drawingFontsLoaded(page.getByTestId('share-preview'));
  const g = await smoothConnection(page.getByTestId('share-preview'), 'short-arc', 'short-start', 'short-end');
  const group = g.nodes.find(n => n.id === 'short-zone')!;
  const barrier = groupNameBox(group.box, group.texts.map(t => t.box), g.scale);
  const witnessBarrier = widestNameBox(group.box, group.texts.map(t => t.box), g.scale);
  const parts = g.nodes.filter(n => n.id !== 'short-zone'), geometry = { ...g, nodes: parts };
  const forbidden = [...parts.map(n => n.box), barrier], span = distance(centre(g.source), centre(g.target));
  expect(span / g.scale).toBeCloseTo(110, 3);
  for (const end of [g.source, g.target]) {
    expect(end.left).toBeGreaterThan(barrier.left); expect(end.right).toBeLessThan(barrier.right);
  }
  // Both real children share the first row; normalisation derives this header.
  expect((g.target.top - barrier.bottom) / g.scale).toBeCloseTo(0, 3);
  expect((group.box.left - g.nodes.find(n => n.id === 'short-anchor')!.box.left) / g.scale).toBeCloseTo(-18, 3);
  expect(g.source.bottom).toBeLessThan(barrier.top);
  expect(g.curves.at(-1)![2].y, 'the covered top is not a legal entry').toBeGreaterThanOrEqual(g.curves.at(-1)![3].y - 0.3 * g.scale);
  // Report the bound's inputs in drawing px from short-start's corner (the drawing origin).
  const at = (p: Point) => `(${((p.x - g.source.left) / g.scale).toFixed(1)}, ${((p.y - g.source.top) / g.scale).toFixed(1)})`;
  // The smallest allowed box gives the smallest bound, from any ports, so no arc fits any allowed box.
  const bound = anyPortBound(g.source, barrier, g.target), measured = nameEntryBound(g.curves[0][0], barrier, g.curves.at(-1)![3]);
  expect(bound, `every name-clear route round the smallest allowed name box exceeds either arc-cap branch: name box ${at({ x: barrier.left, y: barrier.top })}-${at({ x: barrier.right, y: barrier.bottom })}, `
    + `widest ${at({ x: witnessBarrier.right, y: witnessBarrier.bottom })}, start ${at(g.curves[0][0])}, entry ${at(g.curves.at(-1)![3])}, `
    + `bound ${(bound / g.scale).toFixed(1)} (measured ports ${(measured / g.scale).toFixed(1)}) vs cap ${(arcCap(g) / g.scale).toFixed(1)} drawing px`).toBeGreaterThan(arcCap(g) + g.scale);
  const curves = sideWitness(geometry, witnessBarrier, 'right'), witness = { ...geometry, routes: [sampleCubics(curves)] };
  checkSmooth(curves, g.source, g.target, 0.3 * g.scale, g.scale); checkClear(witness, [...parts.map(n => n.box), witnessBarrier], 0);
  // Both witness ports use unused alternate right sides, with full-side clearance.
  // The chain clears the widest allowed box, so it is no shorter than the
  // shortest chain round whichever allowed box the product measured.
  for (const [end, id] of [[g.source, 'short-start'], [g.target, 'short-end']] as const)
    for (const other of parts.filter(n => n.id !== id))
      expect(segmentBoxDistance({ x: end.right, y: end.top }, { x: end.right, y: end.bottom }, other.box)).toBeGreaterThanOrEqual(40 * g.scale);
  expect(shortReport).toMatchObject({ overParts: 0, connections: 1 });
  checkClear(geometry, forbidden);
  // diagram-v2: "the shortest curve that stays out of group names is drawn
  // (no more than 0.5 % longer than the shortest such chain)".
  expect(lineLength(g.routes[0]), 'fallback no longer than a legal name-clear chain + 0.5 %').toBeLessThanOrEqual(1.005 * cubicLengthUpperBound(curves) + g.scale * 0.3);
  expect(await readFile(shortFile.file, 'utf8')).toBe(shortBytes);

  // Round the name's right end, 1.8d (198) and d+120 (230) leave no room for
  // both a bound on the smallest box and a witness round the widest: a name
  // reaching past both parts is >= 190 px wide, so the widest box lies >= 8 px
  // further out on each leg. The box's left end is the group's left edge, exact.
  // So the feasible arc goes round the left: the anchor, alone in a lower row,
  // sets that edge 77 px left of both parts; the long name keeps the right far longer.
  const feasible = structuredClone(short); feasible.title = 'Feasible short-distance cap';
  feasible.views[0].nodes.find(n => n.id === 'short-zone')!.label = 'W'.repeat(24);
  for (const id of ['short-start', 'short-end']) feasible.views[0].nodes.find(n => n.id === id)!.x = 59;
  Object.assign(feasible.views[0].nodes.find(n => n.id === 'short-anchor')!, { x: 0, y: 260 });
  const capFile = await workspace('h80-feasible-short-cap', feasible); await openDrawing(page, request, capFile.file);
  const capBytes = await readFile(capFile.file, 'utf8'), capReport = await shareGeometry(page);
  await drawingFontsLoaded(page.getByTestId('share-preview'));
  const cap = await smoothConnection(page.getByTestId('share-preview'), 'short-arc', 'short-start', 'short-end');
  const capZone = cap.nodes.find(n => n.id === 'short-zone')!;
  const capName = groupNameBox(capZone.box, capZone.texts.map(t => t.box), cap.scale);
  const capWitnessName = widestNameBox(capZone.box, capZone.texts.map(t => t.box), cap.scale);
  const capParts = cap.nodes.filter(n => n.id !== 'short-zone'), capGeometry = { ...cap, nodes: capParts };
  const capForbidden = [...capParts.map(n => n.box), capName], capSpan = distance(centre(cap.source), centre(cap.target));
  expect(capSpan / cap.scale).toBeCloseTo(110, 3);
  for (const end of [cap.source, cap.target]) {
    expect(end.left).toBeGreaterThan(capName.left); expect(end.right).toBeLessThan(capName.right);
    expect((end.left - capName.left) / cap.scale, 'both parts 77 px right of the name box\'s left edge').toBeCloseTo(77, 3);
  }
  // short-end alone in the first row; normalisation derives this header from it.
  expect((cap.target.top - capName.bottom) / cap.scale).toBeCloseTo(0, 3);
  expect((capZone.box.left - cap.nodes.find(n => n.id === 'short-anchor')!.box.left) / cap.scale).toBeCloseTo(-18, 3);
  expect(cap.source.bottom).toBeLessThan(capName.top);
  expect(cap.curves.at(-1)![2].y, 'the feasible arc also enters by a free side').toBeGreaterThanOrEqual(cap.curves.at(-1)![3].y - 0.3 * cap.scale);
  expect(anyPortBound(cap.source, capName, cap.target), 'every name-clear route, from any ports, exceeds 1.8d').toBeGreaterThan(1.8 * capSpan + cap.scale);
  const capCurves = sideWitness(capGeometry, capWitnessName, 'left'), capWitness = { ...capGeometry, routes: [sampleCubics(capCurves)] };
  checkSmooth(capCurves, cap.source, cap.target, 0.3 * cap.scale, cap.scale); checkClear(capWitness, [...capParts.map(n => n.box), capWitnessName], 0);
  // Both witness ports use unused alternate left sides, with full-side clearance.
  for (const [end, id] of [[cap.source, 'short-start'], [cap.target, 'short-end']] as const)
    for (const other of capParts.filter(n => n.id !== id))
      expect(segmentBoxDistance({ x: end.left, y: end.top }, { x: end.left, y: end.bottom }, other.box)).toBeGreaterThanOrEqual(40 * cap.scale);
  expect(cubicLengthUpperBound(capCurves), 'a legal chain fits d+120').toBeLessThan(capSpan + 120 * cap.scale);
  expect(capReport).toMatchObject({ overParts: 0, connections: 1 });
  checkClear(capGeometry, capForbidden); checkCap(cap);
  expect(lineLength(cap.routes[0]), 'output discriminates d+120 from 1.8d').toBeGreaterThan(1.8 * capSpan + cap.scale);
  expect(await readFile(capFile.file, 'utf8')).toBe(capBytes);
});
