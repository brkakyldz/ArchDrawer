import { test, expect, waitRun, library, events } from './helpers';

test('H06 [ENG-5, ENG-7, GEN-2, PER-1] failure and cancellation leave no partial diagram and the user can try again', async ({ page, request, source }) => {
  const before = await library(request);
  await page.goto('/');
  await page.getByTestId('source-input').fill(source);
  await page.getByTestId('engine-select').selectOption('fixture');
  async function submit(instruction: string) {
    await page.getByTestId('instruction-input').fill(instruction);
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
    await page.getByTestId('generate-button').click();
    const response = await pending;
    expect(response.status()).toBe(202);
    return (await response.json()).runId as string;
  }
  const failedId = await submit('Draw the system [fixture:fail]');
  const failed = await waitRun(request, failedId, 'failed');
  expect(failed.error).toBe('Fixture failure requested');
  expect(failed.diagramId).toBeNull();
  await expect(page.getByTestId('run-error')).toHaveText('Fixture failure requested');
  await expect(page.getByTestId('generate-button')).toBeEnabled();
  expect(await library(request)).toEqual(before);
  const cancelledId = await submit('Draw slowly [fixture:slow]');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(page.getByTestId('run-panel')).toBeVisible();
  await expect(page.getByTestId('generate-button')).toBeDisabled();
  await expect(page.getByTestId('run-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible();
  await page.getByTestId('run-cancel').click();
  const cancelled = await waitRun(request, cancelledId, 'cancelled');
  expect(cancelled.diagramId).toBeNull();
  await expect(page.getByTestId('generate-button')).toBeEnabled();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await library(request)).toEqual(before);
  const stream = await events(request, cancelledId);
  expect(stream.filter(event => event.event === 'done')).toHaveLength(1);
  expect(stream.at(-1)!.data.status).toBe('cancelled');
  const recovered = await waitRun(request, await submit('Try drawing the system again'));
  await expect(page).toHaveURL(new RegExp(`/d/${recovered.diagramId}$`));
  await expect(page.getByTestId('diagram-title')).toHaveText('Sample Shop architecture');
  expect((await library(request)).length).toBe(before.length + 1);
  const stillCancelled = await request.get(`/api/runs/${cancelledId}`);
  expect((await stillCancelled.json()).status).toBe('cancelled');
  expect((await stillCancelled.json()).diagramId).toBeNull();
});
