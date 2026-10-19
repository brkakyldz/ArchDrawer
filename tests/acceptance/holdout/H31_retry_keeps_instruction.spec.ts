import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDrawing, finishRun } from './helpers';

test('H31 [ASK-5, ASK-8, ASK-9, EDT-6] retry failed and cancelled changes with the same text, model and selection', async ({ page, request }) => {
  const { file } = await workspace('retry', drawing('Retry shop')); await openDrawing(page, request, file);
  const baseline = await readDrawing(file);
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
  expect((await readDrawing(file)).views).toEqual(baseline.views); await expect(page.getByTestId('ai-summary')).not.toBeVisible();
  const cancelling = 'rename Order API to Cancelled API\n[fixture:slow]'; await page.getByTestId('ai-input').fill(cancelling);
  const cancelled = await send('ai-send'); await expect(page.getByTestId('ai-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible();
  await page.getByTestId('ai-cancel').click(); expect((await finishRun(request, cancelled.id, 'cancelled')).changes).toBeNull();
  await expect(page.getByTestId('ai-error')).toContainText('Cancelled'); await expect(page.getByTestId('ai-input')).toHaveValue(cancelling);
  const retriedCancel = await send('ai-retry'); expect(retriedCancel.body).toEqual(cancelled.body);
  await expect(page.getByTestId('ai-progress')).toBeVisible(); await page.getByTestId('ai-cancel').click(); await finishRun(request, retriedCancel.id, 'cancelled');
  await expect(page.getByTestId('ai-input')).toHaveValue(cancelling); expect((await readDrawing(file)).views).toEqual(baseline.views);
  await expect(page.getByTestId('node-api')).not.toHaveAttribute('data-changed', 'true');
  await page.getByTestId('ai-input').fill('hold Audit in Order API'); const recovered = await send('ai-send'); await finishRun(request, recovered.id, 'succeeded');
  await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-changed', '1'); await expect(page.getByTestId('node-api').getByTestId('node-item')).toContainText(['Validate order', 'Create order', 'Audit']);
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-api').getByTestId('node-item')).toHaveCount(2);
  await page.getByTestId('ai-close').click();
  const quick = 'keep everything [fixture:fail]'; await page.getByTestId('ask-input').fill(quick);
  const quickRun = await send('ask-send'); expect(quickRun.body).toMatchObject({ engine: 'fixture', model: 'fixture-fast', scope: { kind: 'view' } }); await finishRun(request, quickRun.id, 'failed');
  await expect(page.getByTestId('ask-input')).toHaveValue(quick); await expect(page.getByTestId('ask-error')).toContainText('Fixture failure requested');
  const quickRetry = await send('ask-retry'); expect(quickRetry.body).toEqual(quickRun.body); await finishRun(request, quickRetry.id, 'failed');
  await expect(page.getByTestId('ask-input')).toHaveValue(quick);
  expect((await readDrawing(file)).views).toEqual(baseline.views);
});
