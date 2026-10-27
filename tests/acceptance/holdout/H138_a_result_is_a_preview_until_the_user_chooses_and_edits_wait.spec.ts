import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDocument, readDrawing, persistedDoc, persisted, saved, drag, callout, factOf, sendInPanel, runDone, acceptPreview, noToast,
  REFUSED_WHILE_PREVIEW, FACTS_ROUTE } from './helpers';

// AI-3: a run on the open drawing arrives as a preview. The file already holds the result; the changed parts stay lit and the
// two choices stay until the user makes one; meanwhile every edit, undo and redo is refused with a toast, and the undo and redo buttons are disabled (EDIT-4 goes on after
// the run). Looking around still works. Accept keeps the result as one undo step.
test('H138 [AI-3, AI-1, EDIT-1, EDIT-4] a result arrives as a preview that stays until Accept or Undo, edits and undo are refused meanwhile, and Accept keeps it as one undo step', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { file } = await workspace('preview', drawing('Preview shop')); await openDrawing(page, request, file);
  const baseline = await readDocument(file), baselineDrawing = await readDrawing(file);
  const refused = async (action: () => Promise<unknown>) => {
    await noToast(page); await action(); await expect(page.getByTestId('toast')).toHaveText(REFUSED_WHILE_PREVIEW);
  };

  // The run: the saved result is shown with the changed part lit, the summary, the route sentence and both choices.
  const run = await sendInPanel(page, 'add Cache component');
  expect(await runDone(page, run.runId)).toBe('preview');
  const preview = page.getByTestId('ai-preview');
  await expect(preview).toBeVisible(); await expect(preview).toContainText('The drawing was updated:'); await expect(preview).toContainText(FACTS_ROUTE);
  await expect(page.getByTestId('ai-accept')).toBeVisible(); await expect(page.getByTestId('ai-undo')).toBeVisible();
  await expect(page.getByTestId('node-cache')).toBeVisible(); await expect(page.getByTestId('node-cache')).toHaveAttribute('data-changed', 'true');
  await expect(page.getByTestId('node-web')).not.toHaveAttribute('data-changed', 'true');
  await persistedDoc(file, d => !!factOf(d, 'cache')); await saved(page);
  const result = await readDocument(file), resultDrawing = await readDrawing(file);

  // It stays: the old three seconds are long past and the part is still lit, the choices still there.
  await page.waitForTimeout(3200); // proves a negative: no contract state marks "the old 3 s are over", so only the clock can; just past those 3 s
  await expect(page.getByTestId('node-cache')).toHaveAttribute('data-changed', 'true'); await expect(preview).toBeVisible();
  await expect(page.getByTestId('ai-thread').getByTestId('ai-turn').last()).toHaveAttribute('data-state', 'preview');

  // Edits are refused with the toast: a drag and a delete; the undo and redo keys too (below).
  const web = resultDrawing.views[0].nodes.find(n => n.id === 'web')!;
  await refused(() => drag(page, page.getByTestId('node-web'), 48, 24));
  await refused(async () => { await (await callout(page, 'web')).getByTestId('callout-delete').click(); });
  await expect(page.getByTestId('node-web')).toBeVisible(); await page.keyboard.press('Escape');
  // The buttons are disabled while a result is in preview, and their keys show the same toast.
  await expect(page.getByTestId('tool-undo')).toBeDisabled(); await expect(page.getByTestId('tool-redo')).toBeDisabled();
  await refused(() => page.keyboard.press('ControlOrMeta+z'));
  await refused(() => page.keyboard.press('ControlOrMeta+Shift+z'));
  await refused(() => page.keyboard.press('Control+y'));
  await expect(page.getByTestId('node-cache')).toBeVisible(); await expect(preview).toBeVisible();
  await page.waitForTimeout(600); // proves a negative: just past the 350 ms save delay, a hidden edit would have been written by now
  const idle = await readDocument(file);
  expect(idle.facts, 'nothing was edited while the preview was shown').toEqual(result.facts); expect(idle.channels).toEqual(result.channels); expect(idle.warnings ?? []).toEqual(result.warnings ?? []);
  const stillThere = (await readDrawing(file)).views[0].nodes.find(n => n.id === 'web')!; expect([stillThere.x, stillThere.y]).toEqual([web.x, web.y]);

  // Looking around still works: the share dialog opens and closes, the zoom changes.
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
  await page.getByTestId('share-close').click(); await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  const zoom = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click(); await expect(page.getByTestId('zoom-level')).not.toHaveText(zoom);
  await expect(preview).toBeVisible();

  // Accept keeps the result: the choices go, the lit part goes out, and one undo takes the whole run back.
  await acceptPreview(page);
  await expect(page.getByTestId('node-cache')).not.toHaveAttribute('data-changed', 'true'); await expect(page.getByTestId('ai-thread').getByTestId('ai-turn').last()).toHaveAttribute('data-state', 'accepted');
  const kept = await readDocument(file); expect(kept.facts).toEqual(result.facts); expect(kept.channels).toEqual(result.channels); // keeping writes nothing new
  await expect(page.getByTestId('tool-undo')).toBeEnabled(); await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('node-cache')).toHaveCount(0); await persistedDoc(file, d => !factOf(d, 'cache'));
  const undone = await readDocument(file);
  expect(undone.facts).toEqual(baseline.facts); expect(undone.channels).toEqual(baseline.channels); expect(undone.warnings ?? []).toEqual(baseline.warnings ?? []);
  expect((await readDrawing(file)).views).toEqual(baselineDrawing.views);
  await expect(page.getByTestId('tool-undo'), 'one step took the whole run back').toBeDisabled();

  // Redo brings the result back, and with no preview shown an edit goes through again.
  await page.getByTestId('tool-redo').click(); await expect(page.getByTestId('node-cache')).toBeVisible(); await persistedDoc(file, d => !!factOf(d, 'cache'));
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await drag(page, page.getByTestId('node-web'), 48, 24);
  await persisted(file, d => { const moved = d.views[0].nodes.find(n => n.id === 'web')!; return moved.x !== web.x || moved.y !== web.y; });
});
