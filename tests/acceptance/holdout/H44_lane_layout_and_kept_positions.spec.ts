import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, cli, startKind, startRun, finishRun, postViewOf, labelled, svgInfo, previewBoxes, overlaps, baseURL, type Component } from './helpers';

test('H44 [LAY-5, DEP-5, SHR-9, LAY-3] place a post by its lanes, turn the portrait spine back and leave positioned parts where they are', async ({ page, request }) => {
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
    expect(at(id).from).toEqual([]);
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

  // The story's lanes now place a portrait post: four outer spine units, so the spine turns back.
  const design = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: 'overview', kind: 'post', format: 'feed', engine: 'fixture', model: null, scope: { kind: 'view' },
  }), 'succeeded', 60_000);
  await persisted(file, d => d.views.length === 2);
  const post = postViewOf(await readDrawing(file), 'overview');
  expect(design.view).toBe(post.id);
  const sizes = (await svgInfo(page, await (await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=${post.id}&format=feed`)).text())).nodes;
  const boxOf = (part: Component) => {
    const shape = sizes.find(n => n.id === part.id)!;
    return { x: part.x!, y: part.y!, width: shape.width, height: shape.height };
  };
  const entry = boxOf(labelled(post, 'Request')), intake = boxOf(labelled(post, 'Request intake'));
  const zone = boxOf(labelled(post, 'App runtime')), result = boxOf(labelled(post, 'Result'));
  const loop = boxOf(labelled(post, 'Work loop')), facts = boxOf(labelled(post, 'Stored facts')), approval = boxOf(labelled(post, 'Approval'));
  const band = [entry, intake, loop]; // ADR 0014: members occupy the outer cells; the zone encloses them.
  for (const [i, left] of band.entries()) for (const right of band.slice(i + 1)) {
    expect(left.x, 'spine order left to right').toBeLessThan(right.x);
    expect(left.y).toBeLessThan(right.y + right.height); expect(left.y + left.height).toBeGreaterThan(right.y);
  }
  for (const unit of [entry, intake]) {
    expect(result.y, 'the fourth spine unit turns back into a second band').toBeGreaterThanOrEqual(unit.y + unit.height);
    expect(overlaps(result, unit)).toBe(false);
  }
  expect(overlaps(result, zone)).toBe(false);
  // Side parts sit on their own side of their anchor, and a zone member stays inside its zone.
  expect(facts.y).toBeGreaterThan(loop.y);
  expect(facts.x).toBeLessThan(loop.x + loop.width); expect(facts.x + facts.width).toBeGreaterThan(loop.x);
  expect(labelled(post, 'Stored facts').parent).toBe(labelled(post, 'App runtime').id);
  for (const inside of [loop, facts]) {
    expect(inside.x).toBeGreaterThanOrEqual(zone.x); expect(inside.x + inside.width).toBeLessThanOrEqual(zone.x + zone.width);
    expect(inside.y).toBeGreaterThanOrEqual(zone.y); expect(inside.y + inside.height).toBeLessThanOrEqual(zone.y + zone.height);
  }
  expect(approval.y + approval.height).toBeLessThanOrEqual(result.y);
  expect(approval.x).toBeLessThan(result.x + result.width); expect(approval.x + approval.width).toBeGreaterThan(result.x);
  for (const [i, one] of post.nodes.entries()) for (const other of post.nodes.slice(i + 1)) {
    if (one.id === other.parent || other.id === one.parent) continue;
    expect(overlaps(boxOf(one), boxOf(other)), `${one.label} and ${other.label}`).toBe(false);
  }

  // The wide post keeps the same lanes in one left-to-right band, with no engine call and no write.
  const bytes = await readFile(file, 'utf8');
  const runCalls: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') runCalls.push(r.url()); });
  await page.reload(); await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await page.getByTestId('share-advanced-toggle').click(); await page.getByTestId('format-linkedin').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1620');
  const drawnBoxes = await previewBoxes(page, 'g[data-node-id]');
  const wide = ['Request', 'Request intake', 'Work loop', 'Result'].map(label => {
    const id = labelled(post, label).id, found = drawnBoxes.find(shape => shape.nodeId === id);
    expect(found, label).toBeTruthy(); return found!;
  });
  for (const [i, left] of wide.entries()) for (const right of wide.slice(i + 1)) {
    expect(left.x, 'the wide post keeps one left-to-right band').toBeLessThan(right.x);
    expect(left.y).toBeLessThan(right.y + right.height); expect(left.y + left.height).toBeGreaterThan(right.y);
  }
  expect(runCalls).toEqual([]);
  expect(await readFile(file, 'utf8')).toBe(bytes);
});
