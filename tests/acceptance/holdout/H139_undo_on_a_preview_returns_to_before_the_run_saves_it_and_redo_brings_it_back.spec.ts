import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDocument, persistedDoc, saved, factOf, sendInPanel, runDone, openAiPanel, aiTurns, turnStates } from './helpers';

// AI-3: Undo on a preview returns to the drawing before the run, exactly as the ordinary undo would, and saves it, so the file
// and a reload show it; Redo brings the result back. A run that changes nothing shows no preview.
test('H139 [AI-3, FILE-1, EDIT-1] Undo on a preview returns the drawing to before the run and saves it, Redo brings the result back, a reload keeps what the file holds, and a run that changes nothing shows no preview', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspace('preview-undo', drawing('Undo shop')); await openDrawing(page, request, file);
  const baseline = await readDocument(file);
  const sameAsBaseline = (doc: Awaited<ReturnType<typeof readDocument>>) => { expect(doc.facts).toEqual(baseline.facts); expect(doc.channels).toEqual(baseline.channels); };

  // Undo: the part goes from the screen and from the file, the turn says `undone`, the choices go.
  const added = await sendInPanel(page, 'add Cache component');
  expect(await runDone(page, added.runId)).toBe('preview');
  await persistedDoc(file, d => !!factOf(d, 'cache')); await expect(page.getByTestId('node-cache')).toBeVisible();
  await page.getByTestId('ai-undo').click();
  await expect(page.getByTestId('ai-preview')).toHaveCount(0); await expect(page.getByTestId('node-cache')).toHaveCount(0);
  await expect(page.getByTestId('ai-thread').getByTestId('ai-turn').last()).toHaveAttribute('data-state', 'undone');
  await persistedDoc(file, d => !factOf(d, 'cache')); await saved(page); sameAsBaseline(await readDocument(file));
  // It is the ordinary undo: nothing is left before it, and redo is there.
  await expect(page.getByTestId('tool-undo')).toBeDisabled(); await expect(page.getByTestId('tool-redo')).toBeEnabled();

  // Redo brings the result back, into the file too, with no new preview.
  await page.getByTestId('tool-redo').click();
  await expect(page.getByTestId('node-cache')).toBeVisible(); await persistedDoc(file, d => !!factOf(d, 'cache')); await saved(page);
  await expect(page.getByTestId('ai-preview')).toHaveCount(0); await expect(page.getByTestId('tool-redo')).toBeDisabled();
  const withCache = await readDocument(file);

  // A second run is undone and the editor is reloaded: the file holds the drawing before that run, and the cache the first one made.
  const renamed = await sendInPanel(page, 'rename Orders DB to Vault');
  expect(await runDone(page, renamed.runId)).toBe('preview');
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Vault'); await expect(page.getByTestId('node-db')).toHaveAttribute('data-changed', 'true');
  await page.getByTestId('ai-undo').click();
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Orders DB'); await expect(page.getByTestId('node-db')).not.toHaveAttribute('data-changed', 'true');
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Orders DB'); await saved(page);
  const states = await turnStates(page); expect(states).toHaveLength(2); expect(states[1]).toBe('undone');
  await page.reload();
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Orders DB'); await expect(page.getByTestId('node-cache')).toBeVisible();
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  const reloaded = await readDocument(file); expect(reloaded.facts).toEqual(withCache.facts); expect(reloaded.channels).toEqual(withCache.channels);

  // A run that changes nothing: the summary says so, and there is no preview and no choice.
  await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(0); // a reload started the thread empty
  const idle = await sendInPanel(page, 'leave it alone');
  expect(await runDone(page, idle.runId)).toBe('unchanged');
  await expect(page.getByTestId('ai-summary')).toHaveText('Nothing changed');
  await expect(page.getByTestId('ai-preview')).toHaveCount(0); await expect(page.getByTestId('ai-accept')).toHaveCount(0); await expect(page.getByTestId('ai-undo')).toHaveCount(0);
  // Must not happen: the drawing changing because nothing was asked of it, or a part staying lit.
  const last = await readDocument(file); expect(last.facts).toEqual(withCache.facts); expect(last.channels).toEqual(withCache.channels);
  for (const id of ['web', 'api', 'db', 'cache']) await expect(page.getByTestId(`node-${id}`)).not.toHaveAttribute('data-changed', 'true');
});
