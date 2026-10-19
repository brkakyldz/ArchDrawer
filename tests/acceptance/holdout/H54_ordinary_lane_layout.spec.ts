import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, component, workspace, cli, openDrawing, readDrawing, box, svgInfo, svgBoxes, baseURL } from './helpers';
import { noUnrelatedOverlap } from './helpers-v5';

test('H54 [DEP-5, LAY-5, LAY-3, CLI-2] open an ordinary map with anchored satellites, internal lanes and a fixed positioned component', async ({ page, request }) => {
  const doc = drawing('Operations map'), view = doc.views[0];
  view.nodes = [component('first', { lane: { spine: 0 } }), component('anchor', { lane: { spine: 1 } }),
    component('last', { lane: { spine: 2 } }),
    ...['log', 'cache', 'queue'].map(id => component(id, { lane: { anchor: 'anchor', side: 'below' }, place: { row: -4, col: 7 } })),
    component('watch', { lane: { anchor: 'anchor', side: 'above' } }),
    component('zone', { form: 'group', lane: { spine: 3 } }),
    component('inside-a', { parent: 'zone', lane: { spine: 0 } }),
    component('inside-b', { parent: 'zone', lane: { spine: 1 } }),
    component('inside-watch', { parent: 'zone', lane: { anchor: 'inside-a', side: 'above' } }),
    component('fixed', { x: -900, y: -700, lane: { spine: 9 }, place: { row: 12, col: 12 } })];
  view.edges = [
    { id: 'a-b', from: 'first', to: 'anchor', label: '', style: 'call', both: false, step: 1 },
    { id: 'b-c', from: 'anchor', to: 'last', label: '', style: 'call', both: false, step: 2 },
  ];
  doc.views.push({ id: 'legacy', title: 'Old drawing', caption: { title: 'Old hints still work', lede: '' },
    nodes: [component('old-left', { place: { row: 0, col: 0 } }), component('old-right', { place: { row: 0, col: 2 } })], edges: [], texts: [] });
  const { file } = await workspace('h54', doc), original = await readFile(file, 'utf8');
  const checked = await cli(['validate', file]); expect(checked.code, checked.stderr).toBe(0);
  expect(await readFile(file, 'utf8')).toBe(original);
  const openedCLI = await cli(['open', file, '--no-browser']); expect(openedCLI.code, openedCLI.stderr).toBe(0);
  const opened = await openDrawing(page, request, file), stored = await readDrawing(file);
  const placed = stored.views[0];
  expect(placed.nodes.find(n => n.id === 'fixed')).toMatchObject({ x: -900, y: -700, lane: { spine: 9 }, place: { row: 12, col: 12 } });
  for (const node of view.nodes) expect(placed.nodes.find(n => n.id === node.id)).toMatchObject({ lane: node.lane, place: node.place });
  const boxes = new Map<string, Awaited<ReturnType<typeof box>>>();
  for (const node of placed.nodes) boxes.set(node.id, await box(page.getByTestId(`node-${node.id}`)));
  const first = boxes.get('first')!, anchor = boxes.get('anchor')!, last = boxes.get('last')!;
  expect(first.x).toBeLessThan(anchor.x); expect(anchor.x).toBeLessThan(last.x);
  const side = ['log', 'cache', 'queue'].map(id => boxes.get(id)!);
  expect(side.length).toBe(3);
  for (const b of side) expect(b.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
  for (const [i, a] of side.entries()) for (const b of side.slice(i + 1)) {
    expect(Math.max(a.y, b.y)).toBeLessThan(Math.min(a.y + a.height, b.y + b.height));
    expect(a.x).not.toBe(b.x); // Neighbouring columns, not successively farther rows.
  }
  expect(boxes.get('watch')!.y + boxes.get('watch')!.height).toBeLessThanOrEqual(anchor.y);
  expect(boxes.get('inside-a')!.x).toBeLessThan(boxes.get('inside-b')!.x);
  expect(boxes.get('inside-watch')!.y + boxes.get('inside-watch')!.height).toBeLessThanOrEqual(boxes.get('inside-a')!.y);
  const zone = boxes.get('zone')!;
  for (const id of ['inside-a', 'inside-b', 'inside-watch']) {
    const b = boxes.get(id)!; expect(b.x).toBeGreaterThanOrEqual(zone.x); expect(b.y).toBeGreaterThanOrEqual(zone.y);
    expect(b.x + b.width).toBeLessThanOrEqual(zone.x + zone.width); expect(b.y + b.height).toBeLessThanOrEqual(zone.y + zone.height);
  }
  const exported = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
  expect(exported.status()).toBe(200); const svg = await exported.text();
  expect((await svgInfo(page, svg)).nodes).toHaveLength(view.nodes.length);
  noUnrelatedOverlap(placed, await svgBoxes(page, svg, 'g[data-node-id]'));
  const old = stored.views[1];
  expect(old.nodes[0].x!).toBeLessThan(old.nodes[1].x!);
  for (const n of old.nodes) { expect(n.lane).toBeNull(); expect(n.from).toEqual([]); }
  const beforeReopen = await readDrawing(file); await cli(['open', file, '--no-browser']);
  expect((await readDrawing(file)).views).toEqual(beforeReopen.views);
});
