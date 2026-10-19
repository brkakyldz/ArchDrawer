import { entersBox } from './helpers-v8';
import type { Box } from './helpers-v7';
import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, startKind, finishRun } from './helpers';
import { smoothConnection, shareGeometry, lineLength, distance, centre, groupNameBox, sampleCubics, checkSmooth, cubicLengthUpperBound, type Geometry, type Cubic } from './helpers-v13';
import { drawnNodeBoxes, paintedTextField, measuredRouteReport } from './helpers-v9';

// Three cubics use legal 24 px handles, with smooth horizontal joins beside the name.
// Outer control polygons stay left/right of the name; the middle stays above/below it.
const namedFallbackWitness = (g: Geometry, name: Box): Cubic[][] => {
  const a = { x: g.source.right, y: centre(g.source).y }, b = { x: g.target.left, y: centre(g.target).y }, h = 24 * g.scale;
  return [name.top - 0.01 * g.scale, name.bottom + 0.01 * g.scale].map(y => {
    const p = { x: name.left, y }, q = { x: name.right, y };
    return [[a, { x: a.x + h, y: a.y }, { x: p.x - h, y }, p],
      [p, { x: p.x + h, y }, { x: q.x - h, y }, q],
      [q, { x: q.x + h, y }, { x: b.x - h, y: b.y }, b]];
  });
};

// LAY-8 / diagram-v2: "If there is still no arc, the shortest curve that stays out of group names
// is drawn (no more than 0.5 % longer than the shortest such chain)."
test('H82 [LAY-8] report an unavoidable stored-position connection over a part', async ({ page, request }) => {
  const doc = drawing('Unavoidable overlap');
  // Valid stored geometry intentionally encloses the source in an unrelated panel.
  // Every possible source port is inside the panel: no clear arc exists at any length.
  doc.views[0].nodes = [component('wall', { label: 'Stored wall', form: 'panel', items: Array.from({ length: 12 }, (_, i) => `Stored operation ${i}`), x: 40, y: 0 }),
    component('start', { label: 'Start', x: 60, y: 150 }), component('end', { label: 'End', x: 600, y: 150 })];
  // Force the wall to its contracted maximum width with a long, valid held item.
  doc.views[0].nodes[0].items[0] = 'W'.repeat(44);
  doc.views[0].edges = [{ id: 'blocked', from: 'start', to: 'end', label: '', style: 'call', both: false, step: null }];
  const { file } = await workspace('h82', doc), opened = await openDrawing(page, request, file);
  const positions = doc.views[0].nodes.map(n => [n.id, n.x, n.y]);
  expect((await readDrawing(file)).views[0].nodes.map(n => [n.id, n.x, n.y]), 'authored positions survive initial normalisation').toEqual(positions);
  const run = await finishRun(request, await startKind(request, opened.token, { diagramId: opened.id, view: 'overview', kind: 'refine',
    instruction: 'Observe the existing drawing', engine: 'fixture', model: null, format: 'readme', scope: { kind: 'view' } }), 'succeeded', 60_000);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('Saved');
  const shown = await shareGeometry(page), g = await smoothConnection(page.getByTestId('share-preview'), 'blocked', 'start', 'end');
  const wall = g.nodes.find(n => n.id === 'wall')!.box;
  expect(g.source.left).toBeGreaterThan(wall.left); expect(g.source.right).toBeLessThan(wall.right);
  expect(g.source.top).toBeGreaterThan(wall.top); expect(g.source.bottom).toBeLessThan(wall.bottom);
  const actual = measuredRouteReport(doc.views[0], [g]);
  // There is no group name in this fixture: the straight curve remains a legal shortest witness.
  const plainStart = { x: g.source.right, y: centre(g.source).y }, plainEnd = { x: g.target.left, y: centre(g.target).y };
  expect(Math.abs(plainStart.y - plainEnd.y)).toBeLessThanOrEqual(g.scale * 1e-7);
  const straight: Cubic[] = [[plainStart, { x: plainStart.x + 24 * g.scale, y: plainStart.y },
    { x: plainEnd.x - 24 * g.scale, y: plainEnd.y }, plainEnd]];
  checkSmooth(straight, g.source, g.target, 0.3 * g.scale, g.scale);
  expect(plainEnd.x - plainStart.x).toBeGreaterThanOrEqual(48 * g.scale);
  expect(lineLength(g.routes[0]), 'shortest fallback within 0.5 % of a legal straight witness').toBeLessThanOrEqual(1.005 * distance(plainStart, plainEnd) + 0.3 * g.scale);
  expect(actual.edgesOverParts).toEqual([{ edge: 'blocked', node: 'wall' }]);
  expect(run.layoutReport.edgesOverParts).toEqual(actual.edgesOverParts); expect(shown.overParts).toBe(1);
  expect((await readDrawing(file)).views[0].nodes.map(n => [n.id, n.x, n.y])).toEqual(positions);

  const named = structuredClone(doc); named.title = 'Unavoidable named fallback';
  named.views[0].nodes.push(component('name-zone', { label: 'Barrier', form: 'group' }),
    component('name-member', { label: 'Member', form: 'compact', parent: 'name-zone', x: 400, y: 300 }));
  // Calibrate only the public drawn name, then freeze a new fixture with that name across the direct line.
  const probe = await workspace('h82-name-measure', named); await openDrawing(page, request, probe.file);
  const boxes = await drawnNodeBoxes(page.getByTestId('canvas')), start = boxes.find(n => n.nodeId === 'start')!;
  const name = await paintedTextField(page.getByTestId('canvas'), 'name-zone', 'Barrier');
  named.views[0].nodes.find(n => n.id === 'name-member')!.y! += (start.y + start.height / 2 - centre(name.box).y) / (start.width / start.localWidth);
  const fixture = await workspace('h82-named', named); await openDrawing(page, request, fixture.file);
  const stored = await readDrawing(fixture.file), kept = stored.views[0].nodes.map(n => [n.id, n.x, n.y]);
  const report = await shareGeometry(page), curve = await smoothConnection(page.getByTestId('share-preview'), 'blocked', 'start', 'end');
  const group = curve.nodes.find(n => n.id === 'name-zone')!;
  const barrier = groupNameBox(group.box, group.texts.map(t => t.box), curve.scale);
  const witnessBarrier = groupNameBox(group.box, group.texts.map(t => t.box), curve.scale, 'maximum');
  const enclosing = curve.nodes.find(n => n.id === 'wall')!.box;
  expect(curve.source.left > enclosing.left && curve.source.right < enclosing.right && curve.source.top > enclosing.top && curve.source.bottom < enclosing.bottom,
    'source enclosure makes every clear arc impossible, even with the name').toBe(true);
  const a = { x: curve.source.right, y: centre(curve.source).y }, b = { x: curve.target.left, y: centre(curve.target).y };
  expect(barrier.left).toBeGreaterThan(a.x); expect(barrier.right).toBeLessThan(b.x);
  expect(entersBox(a, b, barrier, 0), 'the direct shortest line is actually name-obstructed').toBe(true);
  const violation = curve.routes[0].slice(1).find((p, i) => entersBox(curve.routes[0][i], p, barrier, 0));
  expect(violation ?? null, 'fallback stays out of the name').toBe(null);
  for (const curves of namedFallbackWitness(curve, witnessBarrier)) {
    checkSmooth(curves, curve.source, curve.target, 0.3 * curve.scale, curve.scale);
    const points = sampleCubics(curves);
    expect(points.slice(1).some((p, i) => entersBox(points[i], p, witnessBarrier, 0)), 'shortest-bound witness is name-clear').toBe(false);
  }
  // Subdivided control polygons bound each legal witness from above; apply the contracted 0.5 %.
  const upper = Math.min(...namedFallbackWitness(curve, witnessBarrier).map(cs => cubicLengthUpperBound(cs)));
  expect(lineLength(curve.routes[0]), 'fallback within 0.5 % of a legal name-clear witness at facing ports').toBeLessThanOrEqual(1.005 * upper + 0.3 * curve.scale);
  const measured = measuredRouteReport(stored.views[0], [curve]);
  expect(measured.edgesOverParts.some(e => e.edge === 'blocked' && e.node === 'wall')).toBe(true);
  expect(report.overParts).toBe(measured.edgesOverParts.length);
  expect((await readDrawing(fixture.file)).views[0].nodes.map(n => [n.id, n.x, n.y])).toEqual(kept);
});
