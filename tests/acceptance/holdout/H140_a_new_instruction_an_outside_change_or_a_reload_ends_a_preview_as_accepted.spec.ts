import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDocument, readDrawing, persisted, persistedDoc, saved, drag, outsideWrite, factOf, sendInPanel, runDone, acceptPreview, openAiPanel, aiTurn, aiTurns,
  noToast } from './helpers';

// AI-3: a preview ends in one of four ways. The user chooses (H138, H139); or a new run accepts it first; or the file changes
// outside the editor, which shows the outside change as ever; or a reload, which shows the file, and the file holds the result.
// In each the result stays: accepted means kept.
test('H140 [AI-3, AI-2, FILE-1] a new instruction accepts the previous preview first, an outside change to the file or a reload ends a preview as accepted, and the result is never lost', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { file } = await workspace('preview-ends', drawing('Preview ends shop')); await openDrawing(page, request, file);
  const baseline = await readDocument(file);

  // A new instruction accepts the preview before it runs: the first turn is `accepted` and its part is no longer lit.
  const first = await sendInPanel(page, 'add Cache component');
  expect(await runDone(page, first.runId)).toBe('preview');
  await expect(page.getByTestId('node-cache')).toHaveAttribute('data-changed', 'true');
  const second = await sendInPanel(page, 'add Mailer component');
  await expect(aiTurn(page, first.runId)).toHaveAttribute('data-state', 'accepted');
  expect(await runDone(page, second.runId)).toBe('preview');
  await expect(page.getByTestId('node-mailer')).toHaveAttribute('data-changed', 'true'); await expect(page.getByTestId('node-cache')).not.toHaveAttribute('data-changed', 'true');
  await expect(aiTurns(page)).toHaveCount(2);
  // The first run was kept as a step of its own: after keeping the second, one undo takes back the Mailer and leaves the Cache.
  await acceptPreview(page);
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-mailer')).toHaveCount(0); await expect(page.getByTestId('node-cache')).toBeVisible();
  await persistedDoc(file, d => !factOf(d, 'mailer') && !!factOf(d, 'cache'));
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-cache')).toHaveCount(0);
  await persistedDoc(file, d => !factOf(d, 'cache')); expect((await readDocument(file)).facts).toEqual(baseline.facts);
  await page.getByTestId('tool-redo').click(); await page.getByTestId('tool-redo').click();
  await persistedDoc(file, d => !!factOf(d, 'cache') && !!factOf(d, 'mailer')); await saved(page);

  // An outside change during a preview: the session edits the file; the preview ends as accepted and the editor shows the change.
  const third = await sendInPanel(page, 'add Search component');
  expect(await runDone(page, third.runId)).toBe('preview');
  await expect(page.getByTestId('ai-preview')).toBeVisible(); await persistedDoc(file, d => !!factOf(d, 'search')); await saved(page);
  const external = await readDocument(file); external.title = 'Session owned title'; external.updatedAt = '2099-10-13T10:00:00.000Z';
  await noToast(page); await outsideWrite(file, external);
  await expect(page.getByTestId('toast')).toHaveText('Updated from the file', { timeout: 15_000 });
  await expect(page.getByTestId('repo-name')).toHaveText('Session owned title');
  await expect(page.getByTestId('ai-preview')).toHaveCount(0); await expect(aiTurn(page, third.runId)).toHaveAttribute('data-state', 'accepted');
  await expect(page.getByTestId('node-search')).toBeVisible(); await expect(page.getByTestId('node-search')).not.toHaveAttribute('data-changed', 'true');
  const afterOutside = await readDocument(file); expect(afterOutside.title).toBe('Session owned title'); expect(factOf(afterOutside, 'search'), 'the result stays in the file').toBeTruthy();
  // Edits are back: nothing is refused now.
  const web = (await readDrawing(file)).views[0].nodes.find(n => n.id === 'web')!;
  await drag(page, page.getByTestId('node-web'), 48, 24);
  await persisted(file, d => { const moved = d.views[0].nodes.find(n => n.id === 'web')!; return moved.x !== web.x || moved.y !== web.y; });

  // A reload during a preview: the file holds the result, so the editor shows it, with no preview and an empty thread.
  const fourth = await sendInPanel(page, 'add Billing component');
  expect(await runDone(page, fourth.runId)).toBe('preview');
  await persistedDoc(file, d => !!factOf(d, 'billing')); await saved(page);
  await page.reload();
  await expect(page.getByTestId('node-billing')).toBeVisible(); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await expect(page.getByTestId('node-billing')).not.toHaveAttribute('data-changed', 'true'); await expect(page.getByTestId('repo-name')).toHaveText('Session owned title');
  await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(0);
  // Must not happen: any of the four results taken back by the way its preview ended.
  const stored = await readDocument(file);
  for (const id of ['cache', 'mailer', 'search', 'billing']) expect(factOf(stored, id), `${id} is still in the file`).toBeTruthy();
});
