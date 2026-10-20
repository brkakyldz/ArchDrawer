import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, startKind, finishRun, settledReport, baseURL } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport } from './helpers-svg-parity';

// Outcome: the layout report a run returns and the share dialog shows counts exactly the crossings and
// connections over parts that the exported image draws, and asking for no change moves no stored part.
test('H86 [LAYOUT-1, LAYOUT-2, LAYOUT-3, AI-1] ask for no change on a drawing with fixed positions: nothing moves and the layout report counts what the image draws', async ({ page, request }) => {
  const doc = drawing('Report truth');
  doc.views[0].nodes = [component('zone', { form: 'group', label: 'Runtime' }),
    component('a', { parent: 'zone', x: 0, y: 0 }), component('obstacle', { parent: 'zone', x: 350, y: 240 }),
    component('b', { x: 750, y: 0 }), component('c', { x: 0, y: 600 }), component('d', { x: 750, y: 600 })];
  doc.views[0].edges = [{ id: 'ad', from: 'a', to: 'd', label: '', style: 'call', both: false, step: null },
    { id: 'bc', from: 'b', to: 'c', label: '', style: 'call', both: false, step: null },
    { id: 'ac', from: 'a', to: 'c', label: '', style: 'call', both: false, step: null }];
  const { file } = await workspace('report-truth', doc), opened = await openDrawing(page, request, file);
  const before = await readDrawing(file);
  const positions = before.views[0].nodes.map(n => [n.id, n.x, n.y]);

  const run = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: 'overview', kind: 'refine', instruction: 'Observe the existing drawing',
    format: 'readme', engine: 'fixture', model: null, scope: { kind: 'view' },
  }), 'succeeded', 60_000);

  // Must not happen: a part moving, or anything being added or removed, because nothing was asked.
  const after = await readDrawing(file);
  expect(after.views[0].nodes.map(n => [n.id, n.x, n.y]), 'stored positions never move').toEqual(positions);
  expect(run.changes).toEqual({ added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] });
  expect(after.views[0].edges).toEqual(before.views[0].edges);

  // The image, measured line by line, says what the run's report says.
  const exported = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
  expect(exported.status()).toBe(200);
  const final = after.views[0];
  const independent = await inDrawingFonts(page, await exported.text(), async surface => {
    const geometries = [];
    for (const edge of final.edges) geometries.push(await routeGeometry(surface, edge.id!, edge.from, edge.to));
    return measuredRouteReport(final, geometries);
  });
  const pairs = (entries: { edge: string; node: string }[]) => entries.map(p => `${p.edge}/${p.node}`).sort();
  const diagnostic = `independent measurement of the exported image: ${JSON.stringify(independent)}`;
  expect(run.layoutReport.counts).toEqual({ parts: 5, zones: 1, connections: 3 });
  expect(run.layoutReport.crossings, diagnostic).toBe(independent.crossings);
  expect(pairs(run.layoutReport.edgesOverParts), diagnostic).toEqual(pairs(independent.edgesOverParts));
  expect(run.layoutReport.longestConnection, diagnostic).toBeCloseTo(independent.longestConnection, 3);

  // The share dialog shows the same report for the same image.
  await page.reload(); await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  const shown = await settledReport(page);
  expect(shown, diagnostic).toMatchObject({ view: 'overview', format: 'readme', parts: 5, zones: 1, connections: 3 });
  expect(shown.crossings, diagnostic).toBe(independent.crossings);
  expect(shown.overParts, diagnostic).toBe(independent.edgesOverParts.length);
  expect(shown.cut).toBe(run.layoutReport.cutText.length);
  expect(shown.longest, diagnostic).toBeCloseTo(independent.longestConnection, 3);
  expect((await readDrawing(file)).views[0].nodes.map(n => [n.id, n.x, n.y])).toEqual(positions);
});
