import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { component, drawing, workspace, isolatedDrawing, readDrawing, persisted, startKind, finishRun, postViewOf, labelled, reportAttributes, type LayoutReport } from './helpers';

test('H50 [SHR-9, SHR-7, SHR-10, ASK-8] keep over-long story text in full and report it, and keep the drawing when a story cannot be converted', async ({ page, request }) => {
  const doc = drawing('Long text shop'), view = doc.views[0];
  view.nodes.push(component('worker', { label: 'Order relay', kind: 'worker', files: ['src/extra.ts'], place: { row: 1, col: 0 } }),
    component('ops', { label: 'Order telemetry', kind: 'ops', place: { row: -1, col: 1 } }),
    component('owner', { label: 'Shop owner', kind: 'actor', place: { row: -1, col: 0 } }));
  view.edges.push({ id: 'e3', from: 'db', to: 'worker', label: 'Send it on', style: 'async', both: false, step: 3 });
  const { file } = await workspace('long-story', doc);
  const server = await isolatedDrawing(page, request, file, '2000');
  try {
    const baseline = await readDrawing(file), source = baseline.views[0];
    const longLabel = 'A deliberately longer request name';
    expect(longLabel).toHaveLength(34);

    // Over-limit story text is kept whole and reported; code does not shorten it to meet a target.
    const long = await finishRun(request, await startKind(request, server.token, {
      diagramId: server.id, view: 'overview', kind: 'post', format: 'feed', engine: 'fixture', model: null,
      instruction: 'Design it for the feed [fixture:long]', scope: { kind: 'view' },
    }, server.base), 'succeeded', 120_000, server.base);
    await persisted(file, d => d.views.length === 2, 30_000);
    const stored = await readDrawing(file), post = postViewOf(stored, 'overview');
    const overLong = labelled(post, longLabel);
    expect(overLong.label).toBe(longLabel); expect(overLong.label).not.toContain('…');
    expect(post.nodes.some(node => node.label === 'Request')).toBe(false);
    const report = long.layoutReport as LayoutReport;
    expect(report.overLimitText).toContainEqual({ id: overLong.id, field: 'label', text: longLabel, limit: 28 });
    for (const cut of report.cutText) expect(cut.text).not.toContain('…'); // cutText carries the full text, not the shortened one.
    // Warnings have no category field; cut/readability warnings may name the same part.
    const added = stored.warnings!.slice(baseline.warnings!.length);
    expect(added.some(warning => warning.includes(longLabel) || warning.includes(overLong.id))).toBe(true);
    expect(stored.views[0]).toEqual(source);

    // The share dialog shows that over-limit text as a warning beside the report.
    await page.reload(); await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    const shown = await reportAttributes(page, 'share-dialog');
    expect(shown.overLimit).toBeGreaterThanOrEqual(1);
    const warning = page.getByTestId('share-dialog').getByTestId('layout-report-warning');
    await expect(warning.first()).toBeVisible();
    // ui-v2: a text/target warning names the field/part it is about.
    await expect(warning.filter({ hasText: new RegExp(`${longLabel}|${overLong.id}|\\blabel\\b`, 'i') }).first()).toBeVisible();

    // A story that cannot be converted fails without saving and without quietly falling back.
    const bytes = await readFile(file, 'utf8');
    const invalid = await finishRun(request, await startKind(request, server.token, {
      diagramId: server.id, view: 'overview', kind: 'post', format: 'feed', engine: 'fixture', model: null,
      instruction: 'Design it again [fixture:invalid]', scope: { kind: 'view' },
    }, server.base), 'failed', 120_000, server.base);
    expect(invalid.error).toEqual(expect.any(String)); expect(invalid.error).not.toBe('');
    expect(invalid.changes).toBeNull(); expect(invalid.layoutReport).toBeNull();
    expect(await readFile(file, 'utf8')).toBe(bytes);
    const kept = await readDrawing(file);
    expect(kept.views).toHaveLength(2); expect(postViewOf(kept, 'overview')).toEqual(post);

    // Cancelling a design in the dialog keeps the previewed version and offers the same run again.
    async function design(control: string) {
      const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
      await page.getByTestId(control).click(); const response = await waiting; expect(response.status()).toBe(202);
      return { id: (await response.json()).runId as string, body: response.request().postDataJSON() };
    }
    const started = await design('design-post');
    await expect(page.getByTestId('share-run')).toBeVisible();
    await page.getByTestId('share-run-cancel').click();
    expect((await finishRun(request, started.id, 'cancelled', 60_000, server.base)).changes).toBeNull();
    await expect(page.getByTestId('share-run-error')).toBeVisible();
    await expect(page.getByTestId('share-run-retry')).toHaveText('Try again');
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
    expect(await readFile(file, 'utf8')).toBe(bytes);
    const retried = await design('share-run-retry');
    expect(retried.body).toEqual(started.body); expect(retried.id).not.toBe(started.id);
    const finished = await finishRun(request, retried.id, 'succeeded', 120_000, server.base);
    expect(finished.view).toBe(post.id);
    await persisted(file, d => postViewOf(d, 'overview').nodes.some(node => node.label === 'Request'), 30_000);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    expect((await readDrawing(file)).views[0]).toEqual(source);
  } finally { await server.close(); }
});
