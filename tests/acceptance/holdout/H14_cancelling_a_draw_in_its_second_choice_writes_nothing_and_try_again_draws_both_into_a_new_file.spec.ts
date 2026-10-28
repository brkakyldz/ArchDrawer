import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  says, gitRepo, scanOnHome, tick, startedRun, answerTo, rows, rowStates, rowOf, runRecord, waitRun, runEvents, lines, library, exists, readJSON, activity, engineLines,
} from './helpers';

const product = useProduct();
const SLOW = 'A slow question [fixture:slow]', SLOW_ID = 'a-slow-question-fixture-slow';

// A user draws the whole system and a slow question of their own, and cancels while the question is still being read. The finished choice
// stays done, the question is cancelled, the engine slots are freed and nothing is written. Try again draws both into a new file, the
// finished one from what was kept, with no engine call for it.
test('H14 [JOB-10 START-7 START-6 HOME-4 HOME-6] cancelling a draw while its second choice runs keeps the first done, frees every slot and writes nothing, and Try again draws both into a new file', async ({ page }) => {
  test.setTimeout(300_000);
  const p = product();
  const project = await gitRepo('cancel-second');
  const listedBefore = (await library(p)).length;
  await scanOnHome(page, p, project.dir);
  await tick(page, { whole: true, typed: SLOW }, 'linkedin');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());

  await expect.poll(() => rowStates(page), { timeout: 60_000 }).toEqual(['system:done', `${SLOW_ID}:running`]);
  await expect(page.getByTestId('draw-line')).toContainText(/Working \d+\/30/);
  await expect(rowOf(page, 'system').getByTestId('draw-choice-time')).toHaveText(/^\d\d+:\d\d$/);
  await page.getByTestId('draw-cancel').click();
  await waitRun(p, run.runId, 'cancelled', 60_000);

  // The draw as it ended: Cancelled, the rows as they stopped, nothing written, no way back to the ticks.
  await expect(page.getByTestId('draw-error')).toHaveText(/Cancelled/);
  await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert');
  await expect.poll(() => rowStates(page)).toEqual(['system:done', `${SLOW_ID}:cancelled`]);
  await expect.poll(async () => (await rows(page))[1]?.stages.map(s => `${s.stage}:${s.state}`)).toEqual(['read:failed', 'overview:waiting', 'channel:waiting']);
  await expect(rowOf(page, SLOW_ID).getByTestId('draw-choice-line')).toHaveText(/Cancelled/);
  await expect(page.getByTestId('draw-cancel')).toHaveCount(0);
  await expect(page.getByTestId('draw-ready')).toHaveCount(0);
  await expect(page.getByTestId('focus-list')).toHaveCount(0);
  await expect(page.getByTestId('job-notice')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false);
  expect((await library(p)).length).toBe(listedBefore);
  await expect.poll(async () => (await activity(p)).slots.busy, { message: 'every slot freed' }).toBe(0);
  const ended = (await runEvents(p, run.runId)).at(-1)!;
  expect(ended.data).toMatchObject({ status: 'cancelled', diagramId: null, path: null });

  // Try again: every choice into a new file, the finished one with no engine call.
  const retry = await answerTo(page, 'POST', /^\/api\/runs\/[^/]+\/retry$/, () => page.getByTestId('draw-retry').click());
  expect(retry.status).toBe(202);
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 150_000 });
  const again = await runRecord(p, retry.body.runId);
  expect(again).toMatchObject({ retryOf: run.runId, into: null, status: 'succeeded' });
  const events = await runEvents(p, retry.body.runId);
  expect(says(lines(events, 'system', 'read'), /facts already read/)).toBe(true);
  expect(says(lines(events, 'system', 'channel'), /LinkedIn post already drawn/)).toBe(true);
  expect(engineLines(events, 'system'), 'no engine call').toEqual([]);
  expect(says(lines(events, SLOW_ID, 'read'), /^Reading the code$/)).toBe(true);
  const document = await readJSON(join(project.dir, 'docs', 'architecture.archdraw.json'));
  expect(document.choices.map((c: any) => c.id)).toEqual(['system', SLOW_ID]);
  await expect(page.getByTestId('editor')).toHaveCount(0);
});
