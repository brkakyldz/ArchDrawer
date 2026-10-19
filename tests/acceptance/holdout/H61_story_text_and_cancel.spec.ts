import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, workspace, isolatedDrawing, startKind, finishRun, readDrawing, postViewOf, labelled, persisted, reportNumber } from './helpers';
import { sendControl, postSwitches, checkReadability } from './helpers-v5';
import { paintedTextField } from './helpers-v9';

test('H61 [SHR-7, SHR-9, SHR-10, SHR-3, ASK-8] keep over-target story text whole, refuse invalid intent and retry a cancelled wide redesign', async ({ page, request }) => {
  const { file } = await workspace('h61', drawing('Story fidelity')), server = await isolatedDrawing(page, request, file, '1000');
  try {
    const baseline = await readDrawing(file), input = { diagramId: server.id, view: 'overview', kind: 'post', engine: 'fixture', model: 'fixture-fast' };
    const longId = await startKind(request, server.token, { ...input, instruction: '[fixture:long]' }, server.base);
    const result = await finishRun(request, longId, 'succeeded', 60_000, server.base);
    const after = await readDrawing(file), post = postViewOf(after, 'overview');
    const full = 'A deliberately longer request name', part = labelled(post, full);
    expect(part.label).toBe(full); expect(part.label).not.toContain('…');
    expect(result.layoutReport.overLimitText).toContainEqual({ id: part.id, field: 'label', text: full, limit: 28 });
    // Quality warnings may accompany the repair/target warnings; their wording has no category tag.
    expect(after.warnings!.length - baseline.warnings!.length).toBeGreaterThanOrEqual(2);
    expect(after.warnings!.slice(baseline.warnings!.length).some(w => w.includes(part.id) || w.includes(full) || /\blabel\b/i.test(w))).toBe(true);
    expect(result.layoutReport.overLimitText).toHaveLength(1);
    expect(after.views[0]).toEqual(baseline.views[0]);
    const snapshot = await readFile(file, 'utf8');
    for (const instruction of ['[fixture:invalid]', '[fixture:fail]']) {
      const bad = await startKind(request, server.token, { ...input, view: post.id, instruction }, server.base);
      const failed = await finishRun(request, bad, 'failed', 60_000, server.base);
      expect(failed.error).toEqual(expect.any(String)); expect(failed.changes).toBeNull(); expect(failed.layoutReport).toBeNull();
      expect(await readFile(file, 'utf8')).toBe(snapshot);
    }
    await page.reload(); await page.getByTestId('ai-button').click(); await page.getByTestId('ai-model').selectOption('fixture-fast');
    await page.getByTestId('ai-close').click(); await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await postSwitches(page); await checkReadability(page, 1080, 552);
    await expect(page.getByTestId('share-dialog').getByTestId('layout-report-warning').filter({ hasText: new RegExp(`${part.id}|${full}|\\blabel\\b`, 'i') }).first()).toBeVisible();
    await page.getByTestId('format-linkedin').click(); await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080');
    const beforeCancel = await readFile(file, 'utf8');
    const running = await sendControl(page, 'explain-feed');
    expect(running.body).toMatchObject({ kind: 'post', view: post.id, format: 'linkedin', scope: { kind: 'view' }, engine: 'fixture', model: 'fixture-fast',
      instruction: 'Rewrite this post in plain words for someone who has never seen the project' });
    await expect(page.getByTestId('share-run')).toBeVisible(); await expect(page.getByTestId('arrange-feed')).toBeDisabled();
    const pending = await (await request.get(`${server.base}/api/runs/${running.id}`)).json();
    expect(pending).toMatchObject({ status: 'running', changes: null, layoutReport: null });
    await page.getByTestId('share-run-cancel').click();
    const cancelled = await finishRun(request, running.id, 'cancelled', 60_000, server.base);
    expect(cancelled.changes).toBeNull(); expect(cancelled.layoutReport).toBeNull();
    await expect(page.getByTestId('share-run-error')).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(beforeCancel);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    const retry = await sendControl(page, 'share-run-retry'); expect(retry.body).toEqual(running.body);
    await finishRun(request, retry.id, 'succeeded', 60_000, server.base);
    await persisted(file, d => {
      const saved = postViewOf(d, 'overview');
      return saved.nodes.some(n => n.label === 'Request') && !saved.nodes.some(n => n.label === full);
    });
    const redesigned = postViewOf(await readDrawing(file), 'overview');
    expect(redesigned.id).toBe(post.id); expect(labelled(redesigned, 'Request').label).toBe('Request');
    expect(redesigned.nodes.map(n => n.label)).not.toContain(full);
    await expect.poll(async () => (await paintedTextField(page.getByTestId('share-preview'), labelled(redesigned, 'Request').id, 'Request')).text).toBe('Request');
    await expect(page.getByTestId('share-preview')).not.toContainText(full);
    await expect.poll(async () => reportNumber(await page.getByTestId('share-dialog').getByTestId('layout-report').getAttribute('data-over-limit'), 'over-limit')).toBe(0);
    expect((await readDrawing(file)).views[0]).toEqual(baseline.views[0]);
    await expect(page.getByTestId('share-run-error')).not.toBeVisible(); await checkReadability(page, 1620, 552);
  } finally { await server.close(); }
});
