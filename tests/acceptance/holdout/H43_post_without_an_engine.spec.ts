import { test, expect } from '@playwright/test';
import { drawing, component, workspace, isolatedDrawing, readDrawing, persisted, postViewOf, reportAttributes, token, postRun } from './helpers';

test('H43 [SHR-3, SHR-10, ASK-2, ASK-10, PER-1] prepare the post and queue a rewrite and a simplification on a machine with no engine', async ({ page, request }) => {
  const doc = drawing('No engine shop'), view = doc.views[0];
  view.nodes.push(component('order-runtime', { label: 'Order runtime', form: 'group', place: { row: 0, col: 2 } }),
    component('validator', { label: 'Validate order', parent: 'order-runtime', form: 'compact', kind: 'gate' }),
    component('writer', { label: 'Store order', parent: 'order-runtime', form: 'compact' }),
    component('relay', { label: 'Order relay', kind: 'worker', sub: 'Fulfilment', place: { row: 0, col: 4 } }),
    component('metrics', { label: 'Metrics sink', kind: 'ops', description: 'No description yet.', place: { row: -1, col: 1 } }));
  view.edges = [
    { id: 'story-1', from: 'web', to: 'api', label: 'Send an order to the shop', style: 'call', both: true, step: 9 },
    { id: 'story-2', from: 'api', to: 'order-runtime', label: 'Check and accept the order', style: 'call', both: false, step: 23 },
    { id: 'story-3', from: 'order-runtime', to: 'db', label: 'Keep the accepted order safe', style: 'call', both: false, step: 40 },
    { id: 'story-4', from: 'db', to: 'relay', label: 'Send it to the fulfilment team', style: 'async', both: false, step: 72 },
    { id: 'cross', from: 'api', to: 'db', label: 'Read past orders', style: 'dep', both: false, step: null },
    { id: 'observe', from: 'api', to: 'metrics', label: 'Record a trace', style: 'dep', both: false, step: null },
    { id: 'inside', from: 'validator', to: 'writer', label: 'Validated', style: 'call', both: false, step: null },
  ];
  view.texts.push({ id: 'editor-only', text: 'Internal review remark', x: 40, y: 680, size: 20 });
  const { file } = await workspace('no-engine-post', doc);
  // ARCHDRAW_ENGINES is empty: this machine offers no engine at all, and none is ever started.
  const server = await isolatedDrawing(page, request, file, '250', '');
  const runCalls: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') runCalls.push(r.url()); });
  try {
    const baseline = await readDrawing(file), source = baseline.views[0];
    const engines = await (await request.get(`${server.base}/api/engines`)).json();
    expect(engines.engines.filter((engine: { available: boolean }) => engine.available)).toHaveLength(0);
    await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('linkedin-flow')).toBeVisible(); await expect(page.getByTestId('design-post')).toHaveCount(0);
    await expect(page.getByTestId('post-engine-note')).toHaveText('No engine available — prepared without AI');
    await expect(page.getByTestId('linkedin-prepare')).toHaveText('Prepare the simple version');
    await page.getByTestId('linkedin-prepare').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
    await persisted(file, d => d.views.length === 2);
    const post = postViewOf(await readDrawing(file), 'overview');
    expect(post).toMatchObject({ id: 'overview-linkedin', title: 'LinkedIn', texts: [] });
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1080'); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
    expect(post.nodes.map(n => n.id).sort()).toEqual(['web-li', 'api-li', 'order-runtime-li', 'db-li', 'relay-li', 'metrics-li'].sort());
    // The importance score opens the four parts that carry the story; a folded group shows its members.
    expect(post.nodes.find(n => n.id === 'api-li')).toMatchObject({ form: 'panel', items: ['Validate order', 'Create order'] });
    expect(post.nodes.find(n => n.id === 'order-runtime-li')).toMatchObject({ form: 'panel', items: ['Validate order', 'Store order'] });
    for (const id of ['web-li', 'db-li', 'relay-li']) expect(post.nodes.find(n => n.id === id)?.form).toBe('card');
    expect(post.nodes.find(n => n.id === 'metrics-li')?.form).toBe('compact');
    expect(post.nodes.every(n => n.parent === null)).toBe(true); // A folded group draws no children.
    expect(post.edges.filter(e => e.step !== null).map(e => e.step).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4]);
    expect(post.edges.some(e => e.from === 'validator-li' || e.to === 'writer-li')).toBe(false);
    expect(post.edges).toHaveLength(6);
    // The report is computed for this image without any engine.
    const shown = await reportAttributes(page, 'share-dialog');
    expect(shown).toMatchObject({ view: post.id, format: 'feed', parts: 6, zones: 0, connections: 6 });
    expect(['good', 'ok', 'warn']).toContain(shown.level);
    await expect(page.getByTestId('share-preview').locator('[data-caption="step"]')).toHaveCount(0);
    expect((await readDrawing(file)).views[0]).toEqual(source);

    // Preparing is one undoable edit of the drawing.
    await page.getByTestId('share-close').click(); await page.getByTestId('tool-undo').click();
    await persisted(file, d => d.views.length === 1);
    await page.getByTestId('tool-redo').click();
    await persisted(file, d => d.views.length === 2);
    expect(postViewOf(await readDrawing(file), 'overview')).toEqual(post);

    // The associated version is found through postOf, so the dialog previews it straight away.
    await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await expect(page.getByTestId('linkedin-prepare')).toHaveCount(0);
    const rewrite = 'Rewrite this post in plain words for someone who has never seen the project';
    await page.getByTestId('explain-feed').click();
    await expect(page.getByTestId('linkedin-flow')).toContainText('Saved in the file for your next archdrawer session');
    await persisted(file, d => (d.requests ?? []).length === 1);
    let stored = await readDrawing(file);
    // ui-v2: without an engine the rewrite instruction is saved as a request. Its text is the
    // contracted one; which view a saved rewrite names is not stated, only that a request names a
    // view of this document (api-v2 answers 400 for an unknown view).
    expect(stored.requests![0]).toMatchObject({ text: rewrite });
    expect(stored.views.map(v => v.id)).toContain(stored.requests![0].view);
    expect(postViewOf(stored, 'overview')).toEqual(post); // Nothing was redesigned without an engine.
    await page.getByTestId('share-close').click();

    // Simplify the overview with no engine: the filled instruction is queued, never a faked run.
    await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-engine')).toHaveCount(0);
    const simplify = "Simplify the overview: keep every component in a detail view or a merged part's from";
    await page.getByTestId('simplify-overview').click();
    // No engine, so the filled instruction is saved as a request at once; whether `ai-input` still
    // holds it afterwards is not specified, and the stored request below carries the text verbatim.
    await expect(page.getByTestId('ai-saved')).toHaveText('Saved in the file for your next archdrawer session');
    await persisted(file, d => (d.requests ?? []).length === 2);
    stored = await readDrawing(file);
    expect(stored.requests![1]).toMatchObject({ text: simplify, view: 'overview' });
    expect(stored.views).toHaveLength(2); expect(stored.views[0]).toEqual(source);
    expect(stored.views.some(v => v.nodes.some(n => n.label === 'System map'))).toBe(false);
    // api-v2 (Run kinds): with no engine available `POST /api/runs` fails 400 and "the UI uses the
    // specified local post fallback or saves a simplify instruction through
    // /api/diagrams/:id/requests instead"; ui-v2 adds that simplify "never fakes a run".
    expect(runCalls).toEqual([]);

    // The HTTP endpoint refuses a run outright when no engine is available.
    const auth = await token(request, server.base);
    const refused = await postRun(request, auth, { diagramId: server.id, view: 'overview', kind: 'post', engine: null, model: null }, server.base);
    expect(refused.status()).toBe(400);
    expect((await readDrawing(file)).views).toHaveLength(2);
  } finally { await server.close(); }
});
