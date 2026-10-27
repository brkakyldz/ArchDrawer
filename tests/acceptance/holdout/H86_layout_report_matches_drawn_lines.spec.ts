import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, startKind, finishRun, settledReport, baseURL } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport, entersBox, edgeLine, isSingleCubic } from './helpers-svg-parity';

// Outcome: on a drawing with stored positions a connection is never bent around a part: it is one cubic that passes
// behind the part in its way, and the layout report a run returns and the share dialog shows list exactly the parts the
// exported image draws a line behind. Asking for no change moves no stored part to clear a line.
test('H86 [LAYOUT-1, LAYOUT-2, LAYOUT-3, AI-1] ask for no change on a drawing with fixed positions: nothing moves, a line meeting a part passes behind it as one cubic, and the layout report lists what the image draws', async ({ page, request }) => {
  const doc = drawing('Report truth');
  doc.views[0].nodes = [component('zone', { form: 'group', label: 'Runtime' }),
    component('a', { parent: 'zone', x: 0, y: 0 }), component('obstacle', { parent: 'zone', x: 350, y: 240 }),
    component('b', { x: 750, y: 0 }), component('c', { x: 0, y: 600 }), component('d', { x: 750, y: 600 }),
    // Three parts in one row with the middle one on the straight line between the outer two: the line cannot clear it.
    component('left', { x: 0, y: 1000 }), component('wall', { x: 400, y: 1000 }), component('right', { x: 800, y: 1000 })];
  doc.views[0].edges = [{ id: 'ad', from: 'a', to: 'd', label: '', style: 'call', both: false, step: null },
    { id: 'bc', from: 'b', to: 'c', label: '', style: 'call', both: false, step: null },
    { id: 'ac', from: 'a', to: 'c', label: '', style: 'call', both: false, step: null },
    { id: 'lr', from: 'left', to: 'right', label: '', style: 'call', both: false, step: null }];
  const { file } = await workspace('report-truth', doc), opened = await openDrawing(page, request, file);
  const before = await readDrawing(file);
  const positions = before.views[0].nodes.map(n => [n.id, n.x, n.y]);

  const run = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: 'overview', kind: 'refine', instruction: 'Observe the existing drawing',
    format: 'readme', engine: 'fixture', model: null, scope: { kind: 'view' },
  }), 'succeeded', 15_000);

  // Must not happen: a part moving to clear a line, or anything being added or removed, because nothing was asked.
  const after = await readDrawing(file);
  expect(after.views[0].nodes.map(n => [n.id, n.x, n.y]), 'stored positions never move').toEqual(positions);
  expect(run.changes).toEqual({ added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] });
  expect(after.views[0].edges).toEqual(before.views[0].edges);

  // The image, measured line by line, says what the run's report says.
  const exported = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
  expect(exported.status()).toBe(200);
  const final = after.views[0];
  const measured = await inDrawingFonts(page, await exported.text(), async surface => {
    const geometries = [], lines = [];
    for (const edge of final.edges) { geometries.push(await routeGeometry(surface, edge.id!, edge.from, edge.to)); lines.push(await edgeLine(surface, edge.id!)); }
    return { independent: measuredRouteReport(final, geometries), geometries, lines };
  });
  const { independent, geometries, lines } = measured;
  const pairs = (entries: { edge: string; node: string }[]) => entries.map(p => `${p.edge}/${p.node}`).sort();
  const diagnostic = `independent measurement of the exported image: ${JSON.stringify(independent)}`;

  // Every connection is one cubic, whether or not it meets a part: never bent, chained or straightened into corners.
  for (const [i, edge] of final.edges.entries()) {
    expect(lines[i].length, `${edge.id} is drawn`).toBeGreaterThan(0);
    expect(isSingleCubic(lines[i][0].d), `${edge.id}: ${lines[i][0].d}`).toBe(true);
  }
  // The line from left to right runs through `wall`, as the sampled curve itself shows, and is drawn under it.
  const lr = final.edges.findIndex(e => e.id === 'lr'), wall = geometries[lr].nodes.find(n => n.id === 'wall')!.box;
  const route = geometries[lr].routes[0], inside = route.slice(1).some((p, k) => entersBox(route[k], p, wall, 1e-7 * geometries[lr].scale));
  expect(inside, 'the curve between left and right passes through the box of wall').toBe(true);
  expect(lines[lr][0].under, 'wall is drawn over the line').toContain('wall');
  expect(pairs(independent.edgesOverParts), diagnostic).toContain('lr/wall');

  // The report lists that part, and every other part a line passes behind, and nothing else.
  expect(run.layoutReport.counts).toEqual({ parts: 8, zones: 1, connections: 4 });
  expect(run.layoutReport.crossings, diagnostic).toBe(independent.crossings);
  expect(pairs(run.layoutReport.edgesOverParts), diagnostic).toEqual(pairs(independent.edgesOverParts));
  expect(pairs(run.layoutReport.edgesOverParts), 'the report lists the line behind wall').toContain('lr/wall');
  // Must not happen: a group listed as a part passed behind, or an end of a connection listed against itself.
  for (const entry of run.layoutReport.edgesOverParts as { edge: string; node: string }[]) {
    const edge = final.edges.find(e => e.id === entry.edge)!;
    expect(['zone', edge.from, edge.to], `${entry.edge}/${entry.node} is not a part the line passes behind`).not.toContain(entry.node);
  }
  expect(run.layoutReport.longestConnection, diagnostic).toBeCloseTo(independent.longestConnection, 3);

  // The share dialog shows the same report for the same image.
  await page.reload(); await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  const shown = await settledReport(page);
  expect(shown, diagnostic).toMatchObject({ view: 'overview', format: 'readme', parts: 8, zones: 1, connections: 4 });
  expect(shown.crossings, diagnostic).toBe(independent.crossings);
  expect(shown.overParts, diagnostic).toBe(independent.edgesOverParts.length);
  expect(shown.overParts, 'the line behind wall is counted').toBeGreaterThanOrEqual(1);
  expect(shown.cut).toBe(run.layoutReport.cutText.length);
  expect(shown.longest, diagnostic).toBeCloseTo(independent.longestConnection, 3);
  expect((await readDrawing(file)).views[0].nodes.map(n => [n.id, n.x, n.y])).toEqual(positions);
});
