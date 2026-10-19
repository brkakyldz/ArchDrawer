import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, finishRun, startKind, postViewOf, labelled, settledReport, type LayoutReport } from './helpers';
import { reportNames, checkReadability } from './helpers-v5';
import { routeGeometry } from './helpers-v7';
import { measuredRouteReport } from './helpers-v9';

test('H42 [SHR-9, SHR-10, DEP-5, ASK-9] design the post from the drawing and read the layout report it was judged by', async ({ page, request }) => {
  const doc = drawing('Report shop'), view = doc.views[0];
  // Six source components, in the order the story parts represent them.
  view.nodes = [
    component('src-web', { label: 'Storefront', kind: 'client', sub: 'React', files: ['src/web.ts'], place: { row: 0, col: 0 } }),
    component('src-api', { label: 'Order intake', kind: 'api', form: 'panel', items: ['Validate order', 'Create order'], files: ['src/api.ts'], place: { row: 0, col: 1 } }),
    component('src-work', { label: 'Order worker', kind: 'worker', files: ['src/extra.ts'], place: { row: 0, col: 2 } }),
    component('src-db', { label: 'Orders DB', kind: 'data', sub: 'Postgres', files: ['src/db.ts'], place: { row: 1, col: 2 } }),
    component('src-ops', { label: 'Order telemetry', kind: 'ops', place: { row: -1, col: 1 } }),
    component('src-person', { label: 'Shop owner', kind: 'actor', place: { row: -1, col: 0 } }),
  ];
  view.edges = [
    { id: 'f1', from: 'src-web', to: 'src-api', label: 'Place an order', style: 'call', both: false, step: 1 },
    { id: 'f2', from: 'src-api', to: 'src-work', label: 'Hand it over', style: 'call', both: false, step: 2 },
    { id: 'f3', from: 'src-work', to: 'src-db', label: 'Keep the order', style: 'call', both: false, step: 3 },
    { id: 'f4', from: 'src-api', to: 'src-ops', label: 'Record a trace', style: 'dep', both: false, step: null },
    { id: 'f5', from: 'src-person', to: 'src-web', label: 'Watch the shop', style: 'call', both: false, step: null },
  ];
  const { file } = await workspace('post-report', doc); await openDrawing(page, request, file);
  const before = await readDrawing(file), source = before.views[0];
  await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
  const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('design-post').click(); const started = await waiting; expect(started.status()).toBe(202);
  const runId = (await started.json()).runId as string;
  const run = await finishRun(request, runId, 'succeeded', 60_000);
  expect(run).toMatchObject({ id: runId, kind: 'post', status: 'succeeded', engine: 'fixture', error: null });
  for (const message of ['Reading the drawing', 'Reading the code', 'Updating the drawing']) expect(run.progress.filter((line: string) => line === message)).toHaveLength(1);
  await persisted(file, d => d.views.length === 2);
  const stored = await readDrawing(file), post = postViewOf(stored, 'overview');
  expect(post.id).toBe('overview-linkedin'); expect(run.view).toBe(post.id);
  expect(post.caption).toEqual({ title: 'How a request becomes a result', lede: 'A request enters the app, is checked, and produces a result.' });

  // Zones became groups, chips became held items, spine and anchor/side became lanes, provenance survived.
  const zone = labelled(post, 'App runtime'), parts = ['Request', 'Request intake', 'Work loop', 'Result', 'Stored facts', 'Approval'].map(label => labelled(post, label));
  expect(zone.form).toBe('group');
  expect(parts.map(part => part.from)).toEqual(source.nodes.map(node => [node.id]));
  expect(parts.map(part => part.lane)).toEqual([
    { spine: 0 }, { spine: 1 }, { spine: 2 }, { spine: 3 },
    { anchor: parts[2].id, side: 'below' }, { anchor: parts[3].id, side: 'above' },
  ]);
  expect([parts[2].parent, parts[4].parent]).toEqual([zone.id, zone.id]);
  expect(parts.filter(part => part.parent === null).map(part => part.label)).toEqual(['Request', 'Request intake', 'Result', 'Approval']);
  // Code never shortens story text to fit: every label and sub-line is the engine's own, in full.
  expect(parts.map(part => [part.label, part.sub])).toEqual([
    ['Request', 'start the work'], ['Request intake', 'check the request'], ['Work loop', 'choose the next action'],
    ['Result', 'deliver the outcome'], ['Stored facts', 'keep the current state'], ['Approval', 'review the action'],
  ]);
  expect(JSON.stringify(post)).not.toContain('…');
  // The reversed pair is one two-way connection, with the steps renumbered in their original order.
  expect(post.edges).toHaveLength(5);
  const both = post.edges.filter(edge => edge.both); expect(both).toHaveLength(1);
  expect(both[0]).toMatchObject({ style: 'async', label: 'review', step: null });
  expect(new Set([both[0].from, both[0].to])).toEqual(new Set([parts[3].id, parts[5].id]));
  const step = (from: string, to: string) => post.edges.find(edge => edge.from === from && edge.to === to)?.step;
  expect([step(parts[0].id, parts[1].id), step(parts[1].id, parts[2].id), step(parts[2].id, parts[3].id)]).toEqual([1, 2, 3]);
  const spineEdges = post.edges.filter(edge => edge.step !== null);
  expect(spineEdges).toHaveLength(3);
  for (const edge of spineEdges) expect(edge.label).toBe('');
  // The merge adds one warning; quality targets can add others, with no contracted category or wording.
  expect(stored.warnings!.length - before.warnings!.length).toBeGreaterThanOrEqual(1);

  // The run's change summary covers the view it added and nothing else.
  expect(run.changes.added.slice().sort()).toEqual(post.nodes.map(node => node.id).sort());
  expect(run.changes.edgesAdded.slice().sort()).toEqual(post.edges.map(edge => edge.id!).sort());
  expect(run.changes).toMatchObject({ removed: [], changed: [], moved: [], edgesRemoved: [], edgesChanged: [] });

  // The computed layout report, field by field.
  const report = run.layoutReport as LayoutReport;
  expect(report).toMatchObject({ view: post.id, format: 'feed' });
  expect(report.counts).toEqual({ parts: 6, zones: 1, connections: 5 });
  expect(report.targets).toEqual({ parts: 12, zones: { min: 0, max: 4 }, connections: 14 });
  expect(report.overLimitText).toEqual([]);
  expect(Number.isFinite(report.crossings) && report.crossings >= 0).toBe(true);
  expect(Number.isInteger(report.crossings)).toBe(true);
  for (const pair of report.edgesOverParts) expect(Object.keys(pair).sort()).toEqual(['edge', 'node']);
  for (const cut of report.cutText) expect(Object.keys(cut).sort()).toEqual(['field', 'id', 'text']);
  expect(report.longestConnection).toBeGreaterThan(0); expect(Number.isFinite(report.longestConnection)).toBe(true);
  const { inPlace, opened, level } = report.smallestText;
  const names = reportNames(report);
  expect(inPlace).toBeGreaterThan(0); expect(opened).toBeGreaterThan(0);
  expect(names.inPlace).toBeGreaterThan(0); expect(names.opened).toBeGreaterThan(0);
  expect(names.inPlace).toBeCloseTo(names.opened * 552 / 1080, 6);
  expect(level).toBe(names.inPlace >= 9 && inPlace >= 6.5 ? 'good' : opened >= 8 ? 'ok' : 'warn');
  expect(Math.abs(inPlace - opened * 552 / 1080)).toBeLessThanOrEqual(0.15); // ui-v2: a post is seen 552 px wide.

  // The share dialog shows that same report for the image it is previewing. The run's report used the
  // format's UI defaults, so the dialog is put in exactly that state first: on a LinkedIn version the
  // toggles are title, description, held items, numbered path, connection labels and texts on, colour
  // key off, and the whole view is shared (ui-v2, Share).
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await expect(page.getByTestId('share-part')).toHaveValue('');
  await page.getByTestId('share-advanced-toggle').click();
  for (const id of ['show-title', 'show-lede', 'show-items', 'show-steps', 'show-labels', 'show-texts']) await page.getByTestId(id).check();
  await page.getByTestId('show-legend').uncheck();
  const shown = await settledReport(page, 'share-dialog');
  expect(shown).toMatchObject({ view: post.id, format: 'feed', level, parts: 6, zones: 1, connections: 5 });
  expect(shown.crossings).toBe(report.crossings); expect(shown.overParts).toBe(report.edgesOverParts.length);
  expect(shown.cut).toBe(report.cutText.length); expect(shown.overLimit).toBe(0);
  expect(shown.inPlace).toBeCloseTo(inPlace, 3); expect(shown.opened).toBeCloseTo(opened, 3);
  expect(shown.longest).toBeCloseTo(report.longestConnection, 3);
  const measured = await checkReadability(page, 1080, 552);
  expect(names.opened).toBeCloseTo(measured.namesOpened, 3);
  const geometries = [];
  for (const edge of post.edges) geometries.push(await routeGeometry(page.getByTestId('share-preview'), edge.id!, edge.from, edge.to));
  const independent = measuredRouteReport(post, geometries);
  const evidence = `H42 preview SVG image-px; routed lengths / component-box diagonal, caption and margins excluded; ${JSON.stringify(independent)}`;
  expect(report.longestConnection, evidence).toBeCloseTo(independent.longestConnection, 3);
  expect(shown.longest, evidence).toBeCloseTo(independent.longestConnection, 3);
  expect(report.crossings, evidence).toBe(independent.crossings);
  expect(shown.crossings, evidence).toBe(independent.crossings);
  const pairs = (entries: { edge: string; node: string }[]) => entries.map(p => `${p.edge}/${p.node}`).sort();
  expect(pairs(report.edgesOverParts), evidence).toEqual(pairs(independent.edgesOverParts));
  expect(shown.overParts, evidence).toBe(independent.edgesOverParts.length);
  await expect(page.getByTestId('share-dialog').getByTestId('layout-report')).toContainText(/crossing/i);

  // The drawing the post was made from is untouched, and the post is owned through `postOf`.
  expect(stored.views[0]).toEqual(source);
  expect(post.postOf).toBe('overview'); expect(stored.views[0].postOf ?? null).toBeNull();
  expect(stored.views.filter(v => v.postOf === 'overview')).toHaveLength(1);

  // A session-written drawing plus fixture no-change refine makes report geometry independent of canned stories.
  const probe = drawing('Measured report routes');
  probe.views[0].nodes = [component('zone', { form: 'group', label: 'Runtime' }),
    component('a', { parent: 'zone', x: 0, y: 0 }), component('obstacle', { parent: 'zone', x: 350, y: 240 }),
    component('b', { x: 750, y: 0 }), component('c', { x: 0, y: 600 }), component('d', { x: 750, y: 600 })];
  probe.views[0].edges = [{ id: 'ad', from: 'a', to: 'd', label: '', style: 'call', both: false, step: null },
    { id: 'bc', from: 'b', to: 'c', label: '', style: 'call', both: false, step: null },
    { id: 'ac', from: 'a', to: 'c', label: '', style: 'call', both: false, step: null }];
  const local = await workspace('h42-measured-routes', probe), registered = await openDrawing(page, request, local.file);
  const noChange = await finishRun(request, await startKind(request, registered.token, {
    diagramId: registered.id, view: 'overview', kind: 'refine', instruction: 'Observe the existing drawing',
    format: 'readme', engine: 'fixture', model: null, scope: { kind: 'view' },
  }), 'succeeded', 60_000);
  const final = (await readDrawing(local.file)).views[0];
  await page.reload(); await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  const routes = [];
  for (const edge of final.edges) routes.push(await routeGeometry(page.getByTestId('share-preview'), edge.id!, edge.from, edge.to));
  const actual = measuredRouteReport(final, routes), visible = await settledReport(page);
  const diagnostic = `H42 no-change refine / preview SVG measured geometry; ${JSON.stringify(actual)}`;
  expect(noChange.layoutReport.longestConnection, diagnostic).toBeCloseTo(actual.longestConnection, 3);
  expect(noChange.layoutReport.crossings, diagnostic).toBe(actual.crossings);
  expect(pairs(noChange.layoutReport.edgesOverParts), diagnostic).toEqual(pairs(actual.edgesOverParts));
  expect(visible.longest, diagnostic).toBeCloseTo(actual.longestConnection, 3);
  expect(visible.crossings, diagnostic).toBe(actual.crossings);
  expect(visible.overParts, diagnostic).toBe(actual.edgesOverParts.length);
});
