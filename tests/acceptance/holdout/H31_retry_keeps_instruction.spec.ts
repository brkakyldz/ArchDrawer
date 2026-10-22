import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, project, finishRun, callout as getCallout } from './helpers';
import { readChoice } from './helpers-drawing';

const drawnOf = async (file: string) => project(await readChoice(file));

test('H31 [AI-1 AI-2 AI-3 EDIT-1 LOOK-3 #177] retry failed and cancelled changes with the same text, model and selection, and a kept hold shows in the callout, never as a row on the canvas', async ({ page, request }) => {
  const { file } = await workspace('retry', drawing('Retry shop')); await openDrawing(page, request, file);
  const baseline = await drawnOf(file);
  await page.getByTestId('node-api').getByTestId('node-label').click();
  await page.getByTestId('callout-api').getByTestId('callout-ask').click();
  await expect(page.getByTestId('ai-scope-selection')).toBeChecked(); await page.getByTestId('ai-model').selectOption('fixture-fast');
  async function send(control: string) {
    const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
    await page.getByTestId(control).click(); const response = await waiting; expect(response.status()).toBe(202);
    return { id: (await response.json()).runId as string, body: response.request().postDataJSON() };
  }
  const failing = 'hold Audit in Order API\n[fixture:fail]'; await page.getByTestId('ai-input').fill(failing);
  const first = await send('ai-send'); const failed = await finishRun(request, first.id, 'failed'); expect(failed.changes).toBeNull();
  await expect(page.getByTestId('ai-error')).toContainText('Fixture failure requested'); await expect(page.getByTestId('ai-input')).toHaveValue(failing);
  const retry = await send('ai-retry'); expect(retry.body).toEqual(first.body); expect(retry.id).not.toBe(first.id);
  await finishRun(request, retry.id, 'failed'); await expect(page.getByTestId('ai-input')).toHaveValue(failing);
  expect((await drawnOf(file)).views).toEqual(baseline.views); await expect(page.getByTestId('ai-summary')).not.toBeVisible();
  const cancelling = 'rename Order API to Cancelled API\n[fixture:slow]'; await page.getByTestId('ai-input').fill(cancelling);
  const cancelled = await send('ai-send'); await expect(page.getByTestId('ai-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible();
  await page.getByTestId('ai-cancel').click(); expect((await finishRun(request, cancelled.id, 'cancelled')).changes).toBeNull();
  await expect(page.getByTestId('ai-error')).toContainText('Cancelled'); await expect(page.getByTestId('ai-input')).toHaveValue(cancelling);
  const retriedCancel = await send('ai-retry'); expect(retriedCancel.body).toEqual(cancelled.body);
  await expect(page.getByTestId('ai-progress')).toBeVisible(); await page.getByTestId('ai-cancel').click(); await finishRun(request, retriedCancel.id, 'cancelled');
  await expect(page.getByTestId('ai-input')).toHaveValue(cancelling); expect((await drawnOf(file)).views).toEqual(baseline.views);
  await expect(page.getByTestId('node-api')).not.toHaveAttribute('data-changed', 'true');
  await page.getByTestId('ai-input').fill('hold Audit in Order API'); const recovered = await send('ai-send'); await finishRun(request, recovered.id, 'succeeded');
  await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-changed', '1');
  // The part now holds `Audit`; the rows are listed in its callout (ADR 0014) and the part draws none of them.
  await expect(page.getByTestId('node-api').getByTestId('node-item')).toHaveCount(0);
  await expect((await getCallout(page, 'api')).getByTestId('callout-item')).toContainText(['Validate order', 'Create order', 'Audit']);
  // The result arrived as a preview: keep it, and the ordinary undo then takes the whole run back.
  await page.getByTestId('ai-accept').click(); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  const thread = page.getByTestId('ai-thread').getByTestId('ai-turn');
  await expect(thread).toHaveCount(5);
  expect(await thread.evaluateAll(all => all.map(turn => turn.getAttribute('data-state')))).toEqual(['failed', 'failed', 'cancelled', 'cancelled', 'accepted']);
  await page.getByTestId('tool-undo').click();
  await expect.poll(async () => (await drawnOf(file)).views[0].nodes.find(n => n.id === 'api')?.items.length).toBe(2);
  await expect((await getCallout(page, 'api')).getByTestId('callout-item')).toHaveCount(2);
  // The same panel with the whole view as its scope (there is no second box to type in): a failure and its retry, as above.
  await page.getByTestId('ai-scope-view').check();
  const quick = 'keep everything [fixture:fail]'; await page.getByTestId('ai-input').fill(quick);
  const quickRun = await send('ai-send'); expect(quickRun.body).toMatchObject({ engine: 'fixture', model: 'fixture-fast', scope: { kind: 'view' } }); await finishRun(request, quickRun.id, 'failed');
  await expect(page.getByTestId('ai-input')).toHaveValue(quick); await expect(page.getByTestId('ai-error')).toContainText('Fixture failure requested');
  const quickRetry = await send('ai-retry'); expect(quickRetry.body).toEqual(quickRun.body); await finishRun(request, quickRetry.id, 'failed');
  await expect(page.getByTestId('ai-input')).toHaveValue(quick);
  expect((await drawnOf(file)).views).toEqual(baseline.views);
  // One turn per run, oldest first, each in the state it ended in; the retry of a failure is a turn of its own.
  const turns = page.getByTestId('ai-thread').getByTestId('ai-turn');
  await expect(turns).toHaveCount(7);
  // The accepted turn's state after the ordinary undo is left open by the contract: it is checked above, before the undo.
  const states = await turns.evaluateAll(all => all.map(turn => turn.getAttribute('data-state')));
  expect(states.filter((_, i) => i !== 4)).toEqual(['failed', 'failed', 'cancelled', 'cancelled', 'failed', 'failed']);
  await expect(turns.nth(4).getByTestId('ai-turn-where')).toHaveText('Overview · Selected parts (1)');
  await expect(turns.nth(5).getByTestId('ai-turn-where')).toHaveText('Overview · This view');
});
