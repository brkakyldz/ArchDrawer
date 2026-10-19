import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, postRun, startKind, finishRun, viewOf, postViewOf, baseURL, type View } from './helpers';

test('H49 [SHR-9, ASK-10, DEP-6, PLT-2] run a post and a simplification over HTTP, own the post through postOf and refuse bad input before any engine starts', async ({ page, request }) => {
  const doc = drawing('Kinds shop'), view = doc.views[0];
  view.nodes.push(component('worker', { label: 'Order relay', kind: 'worker', files: ['src/extra.ts'], place: { row: 1, col: 0 } }),
    component('ops', { label: 'Order telemetry', kind: 'ops', place: { row: -1, col: 1 } }),
    component('owner', { label: 'Shop owner', kind: 'actor', place: { row: -1, col: 0 } }));
  view.edges.push({ id: 'e3', from: 'db', to: 'worker', label: 'Send it on', style: 'async', both: false, step: 3 },
    { id: 'e4', from: 'api', to: 'ops', label: 'Record a trace', style: 'dep', both: false, step: null });
  // A view somebody authored by hand, named like a post but owned by nobody.
  const unrelated: View = { id: 'overview-linkedin', title: 'My own version', caption: { title: 'Hand drawn', lede: '' },
    nodes: [component('hand-made', { label: 'Hand made', kind: 'client' })], edges: [], texts: [] };
  const detail: View = { id: 'inside-api', title: 'Inside the API', caption: { title: 'What the API does', lede: '' },
    nodes: [component('api-inner', { label: 'Route table', kind: 'api' })], edges: [], texts: [] };
  // A source id so long that `<source>-linkedin` would not fit in 64 characters.
  const longId = `long-source-${'x'.repeat(47)}`;
  expect(longId).toHaveLength(59);
  const longView: View = { id: longId, title: 'A long view', caption: { title: 'A long source view', lede: '' },
    nodes: [component('long-one', { label: 'Only part', kind: 'service' })], edges: [], texts: [] };
  doc.views.push(unrelated, detail, longView);
  doc.views[0].nodes.find(n => n.id === 'api')!.detail = 'inside-api';
  const { file } = await workspace('run-kinds', doc); const opened = await openDrawing(page, request, file);
  const baseline = await readDrawing(file), source = baseline.views[0], handMade = viewOf(baseline, 'overview-linkedin');

  // A post may not take the name of a view it does not own.
  const designed = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: 'overview', kind: 'post', format: 'feed', engine: 'fixture', model: null, scope: { kind: 'view' },
  }), 'succeeded', 60_000);
  await persisted(file, d => d.views.length === 5);
  let stored = await readDrawing(file);
  expect(designed.view).toBe('overview-2-linkedin');
  const post = postViewOf(stored, 'overview');
  expect(post.id).toBe('overview-2-linkedin');
  expect(designed.layoutReport.view).toBe(post.id); expect(designed.layoutReport.format).toBe('feed');
  expect(designed.kind).toBe('post');
  expect(viewOf(stored, 'overview-linkedin')).toEqual(handMade); // The hand-drawn view is kept as it was.
  expect(stored.views[0]).toEqual(source);
  expect(viewOf(stored, 'inside-api')).toEqual(viewOf(baseline, 'inside-api'));

  // Naming the post itself redesigns that same post, found through postOf.
  const again = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: post.id, kind: 'post', format: 'linkedin', engine: 'fixture', model: 'fixture-careful', scope: { kind: 'view' },
  }), 'succeeded', 60_000);
  expect(again.view).toBe(post.id); expect(again.model).toBe('fixture-careful');
  expect(again.layoutReport.format).toBe('linkedin');
  await persisted(file, d => d.views.length === 5);
  stored = await readDrawing(file);
  expect(postViewOf(stored, 'overview').id).toBe(post.id);
  expect(viewOf(stored, 'overview-linkedin')).toEqual(handMade);
  expect(stored.views[0]).toEqual(source);

  // A bounded id: the source prefix is cut to 55 characters, and postOf still names the whole source.
  const bounded = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: longId, kind: 'post', format: 'feed', engine: 'fixture', model: null,
  }), 'succeeded', 60_000);
  expect(bounded.view).toBe(`${longId.slice(0, 55)}-linkedin`);
  expect(bounded.view.length).toBeLessThanOrEqual(64);
  await persisted(file, d => d.views.length === 6);
  stored = await readDrawing(file);
  expect(postViewOf(stored, longId).id).toBe(bounded.view);
  expect(viewOf(stored, longId)).toEqual(viewOf(baseline, longId));
  expect(postViewOf(stored, 'overview').id).toBe(post.id);

  // The simplify kind reports itself and its own view.
  const simplified = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: 'overview', kind: 'simplify', engine: 'fixture', model: null,
  }), 'succeeded', 60_000);
  expect(simplified.kind).toBe('simplify'); expect(simplified.view).toBe('overview');
  expect(Object.keys(simplified.changes).sort()).toEqual(['added', 'changed', 'edgesAdded', 'edgesChanged', 'edgesRemoved', 'moved', 'removed']);
  expect(simplified.layoutReport.view).toBe('overview');
  expect(simplified.layoutReport.targets).toEqual({ parts: null, zones: { min: 4, max: 6 }, connections: 15 });
  await persisted(file, d => d.views.length === 7);
  stored = await readDrawing(file);
  const survivors = new Set(stored.views.flatMap(v => [...v.nodes.map(n => n.id), ...v.nodes.flatMap(n => n.from ?? [])]));
  for (const node of source.nodes) expect(survivors.has(node.id), node.id).toBe(true);
  expect(viewOf(stored, 'overview-linkedin')).toEqual(handMade);

  // Bad input is refused before an engine runs, and changes nothing.
  const bytes = await readFile(file, 'utf8'), views = (await readDrawing(file)).views.length;
  const common = { diagramId: opened.id, view: 'overview', engine: 'fixture', model: null };
  const refusals: Record<string, unknown>[] = [
    { ...common, kind: 'shrink' },
    { ...common, kind: 'post', scope: { kind: 'all' } },
    { ...common, kind: 'post', scope: { kind: 'parts', ids: ['api'] } },
    { ...common, kind: 'post', format: 'readme' },
    { ...common, kind: 'post', instruction: 42 },
    // (api-v2's 400 list names the > 4000-character limit for a refine instruction only, so an
    // over-long post instruction is not asserted here.)
    { ...common, kind: 'post', revise: 'yes' },
    { ...common, kind: 'post', engine: 'not-installed' },
    { ...common, kind: 'post', model: 123 },
    { ...common, kind: 'simplify', view: 'inside-api' },
    { ...common, kind: 'simplify', view: 'ghost' },
    { ...common, kind: 'simplify', scope: { kind: 'all' } },
  ];
  for (const data of refusals) {
    const refused = await postRun(request, opened.token, data);
    expect(refused.status(), JSON.stringify(data)).toBe(400);
    expect((await refused.json()).error).toEqual(expect.any(String));
  }
  // A mutating run still needs this process's token.
  for (const headers of [{}, { 'X-Archdraw-Token': 'wrong-token' }]) {
    const response = await request.post(`${baseURL()}/api/runs`, { headers, data: { ...common, kind: 'post' } });
    expect(response.status()).toBe(403);
  }
  expect(await readFile(file, 'utf8')).toBe(bytes);
  expect((await readDrawing(file)).views).toHaveLength(views);

  // The supplied packet does not establish the spike gate's state; both states are permitted.
  const revision = await postRun(request, opened.token, { ...common, kind: 'post', revise: true });
  expect([400, 202]).toContain(revision.status());
  const enabled = revision.status() === 202;
  if (enabled) {
    const revised = await finishRun(request, (await revision.json()).runId, 'succeeded', 60_000);
    expect(revised).toMatchObject({ kind: 'post', engine: 'fixture', error: null });
    expect(revised.layoutReport.view).toBe(revised.view);
    expect(Number.isFinite(revised.layoutReport.longestConnection)).toBe(true);
  } else {
    expect((await revision.json()).error).toBe('Layout revision is not enabled');
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect((await readDrawing(file)).views).toHaveLength(views);
  }
  await page.reload(); await page.getByTestId('share-button').click();
  await page.getByTestId('share-advanced-toggle').click();
  if (enabled) {
    await expect(page.getByTestId('layout-revise')).toBeVisible();
    await expect(page.getByTestId('layout-revise')).not.toBeChecked();
  } else await expect(page.getByTestId('layout-revise')).toHaveCount(0);
});
