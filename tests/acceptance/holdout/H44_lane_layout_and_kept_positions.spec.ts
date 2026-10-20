import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, cli, startRun, finishRun } from './helpers';

test('H44 [LAYOUT-1, AI-1, START-5] accept lane hints in a session file, place what has no position by its place hint and leave positioned parts where they are', async ({ page, request }) => {
  const doc = drawing('Lane shop'), view = doc.views[0];
  view.nodes = [
    component('a', { label: 'Front door', kind: 'client', lane: { spine: 0 }, x: 80, y: 320 }),
    component('b', { label: 'Intake', kind: 'api', form: 'panel', items: ['Check it'], lane: { spine: 1 }, x: 480, y: 320 }),
    component('c', { label: 'Watcher', kind: 'ops', lane: { anchor: 'b', side: 'above' }, x: 480, y: 120 }),
    component('d', { label: 'Worker', kind: 'worker', place: { row: 0, col: 5 } }),
    component('e', { label: 'Store', kind: 'data', place: { row: 1, col: 5 } }),
  ];
  view.edges = [
    { id: 'l1', from: 'a', to: 'b', label: 'Ask', style: 'call', both: false, step: 1 },
    { id: 'l2', from: 'b', to: 'd', label: 'Hand over', style: 'call', both: false, step: 2 },
    { id: 'l3', from: 'd', to: 'e', label: 'Keep it', style: 'call', both: false, step: 3 },
    { id: 'l4', from: 'b', to: 'c', label: '', style: 'dep', both: false, step: null },
  ];
  const { file } = await workspace('lanes', doc);
  // A lane is accepted by the file contract and changes nothing about an existing position.
  const validated = await cli(['validate', file]); expect(validated.code, validated.stderr).toBe(0);
  const opened = await openDrawing(page, request, file);
  const normalised = await readDrawing(file), placed = normalised.views[0];
  const at = (id: string) => placed.nodes.find(n => n.id === id)!;
  for (const id of ['a', 'b', 'c']) {
    const original = view.nodes.find(n => n.id === id)!;
    expect([at(id).x, at(id).y], id).toEqual([original.x, original.y]);
    expect(at(id).facts, `${id} shows its own fact`).toEqual([id]);
  }
  for (const id of ['d', 'e']) { expect(at(id).lane, id).toBeNull(); expect(Number.isFinite(at(id).x)).toBe(true); }
  expect(at('d').y!).toBeLessThan(at('e').y!); // Place hints still order unpositioned components by row.
  expect(normalised.warnings).toEqual([]);

  // An ordinary run never moves a component that has a position, lane or not.
  const kept = new Map(placed.nodes.map(n => [n.id, [n.x, n.y]] as const));
  const refined = await finishRun(request, await startRun(request, opened.id, opened.token, 'add Cache component'), 'succeeded');
  expect(refined.changes.moved).toEqual([]);
  await persisted(file, d => d.views[0].nodes.some(n => n.id === 'cache'));
  const afterRefine = (await readDrawing(file)).views[0];
  for (const [id, position] of kept) expect([afterRefine.nodes.find(n => n.id === id)!.x, afterRefine.nodes.find(n => n.id === id)!.y], id).toEqual(position);
  const lanes = afterRefine.nodes.filter(n => ['a', 'b', 'c'].includes(n.id)).map(n => n.lane);
  expect(lanes).toEqual([{ spine: 0 }, { spine: 1 }, { anchor: 'b', side: 'above' }]);
});
