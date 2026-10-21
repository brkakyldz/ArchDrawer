import { test, expect } from '@playwright/test';
import { shop3, workspaceRaw, openDrawing, readDocument, factOf, persistedDoc, startedRun, sendInPanel, runDone, acceptPreview, aiTurns, turnStates, turnTexts, openAiPanel } from './helpers';

// AI-2: a run that fails or is cancelled is still a turn of the conversation. It keeps its error, `ai-retry` sends the same
// request again as a new turn, the typed text comes back into the input, and nothing was written (FILE-1) until a run succeeds.
test('H136 [AI-2, AI-1, FILE-1] a failed or cancelled run is a turn that keeps its error, Try again adds a turn with the same request, the text comes back to the input, and nothing is written until a run succeeds', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('turns', shop3('Turns shop')); await openDrawing(page, request, file);
  const baseline = await readDocument(file);
  const unchanged = async (what: string) => expect(await readDocument(file), what).toEqual(baseline);
  await openAiPanel(page);

  // A failed run: a turn in the state `failed`, the error in the panel (the latest turn's error is `ai-error`), the instruction back in the input.
  const failing = 'rename Orders DB to Vault\n[fixture:fail]';
  const first = await sendInPanel(page, failing);
  expect(await runDone(page, first.runId)).toBe('failed');
  await expect(page.getByTestId('ai-error')).toContainText('Fixture failure requested'); await expect(page.getByTestId('ai-retry')).toBeVisible();
  await expect(page.getByTestId('ai-input')).toHaveValue(failing);
  await expect(page.getByTestId('ai-summary')).toHaveCount(0); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await expect(page.getByTestId('tool-undo')).toBeDisabled(); await unchanged('after the failure');

  // Try again: a second turn with the same request (same body, another run), and the first one keeps its own error.
  const retried = await startedRun(page, () => page.getByTestId('ai-retry').click());
  expect(retried.body).toEqual(first.body); expect(retried.runId).not.toBe(first.runId);
  expect(await runDone(page, retried.runId)).toBe('failed');
  await expect(aiTurns(page)).toHaveCount(2); expect(await turnStates(page)).toEqual(['failed', 'failed']);
  const texts = await turnTexts(page); expect(texts[1]).toBe(texts[0]); expect(texts[0]).toContain('rename Orders DB to Vault');
  await expect(page.getByTestId('ai-error')).toHaveCount(1); await expect(aiTurns(page).first().getByTestId('ai-error')).toHaveCount(0);
  await expect(aiTurns(page).first().getByTestId('ai-turn-result')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('ai-input')).toHaveValue(failing); await unchanged('after Try again');

  // A cancelled run: the progress shows, Cancel stops it, the turn says `cancelled` and the text is back in the input.
  const slow = 'rename Orders DB to Vault\n[fixture:slow]';
  const third = await sendInPanel(page, slow);
  await expect(page.getByTestId('ai-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible();
  await page.getByTestId('ai-cancel').click();
  expect(await runDone(page, third.runId, 30_000)).toBe('cancelled');
  await expect(page.getByTestId('ai-error')).toContainText('Cancelled'); await expect(page.getByTestId('ai-input')).toHaveValue(slow); await unchanged('after Cancel');
  expect(await turnStates(page)).toEqual(['failed', 'failed', 'cancelled']);
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Orders DB');

  // Edited and sent again, it succeeds: a fourth turn, the earlier ones stay as they ended, and only now is the file written.
  const fixed = await sendInPanel(page, 'rename Orders DB to Vault');
  expect(await runDone(page, fixed.runId)).toBe('preview');
  await expect(aiTurns(page)).toHaveCount(4); await expect(page.getByTestId('ai-error')).toHaveCount(0); await expect(page.getByTestId('ai-retry')).toHaveCount(0);
  await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-changed', '1');
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Vault');
  await acceptPreview(page);
  expect(await turnStates(page)).toEqual(['failed', 'failed', 'cancelled', 'accepted']);
  await expect(aiTurns(page).nth(2).getByTestId('ai-turn-result')).toContainText('Cancelled');
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Vault');
  // Must not happen: a failed or cancelled turn leaving a warning, a request or a mark behind.
  const stored = await readDocument(file);
  expect(stored.warnings ?? []).toEqual(baseline.warnings ?? []); expect(stored.requests ?? []).toEqual([]);
  expect(stored.facts.components.filter(f => f.label === 'Vault')).toHaveLength(1);
});
