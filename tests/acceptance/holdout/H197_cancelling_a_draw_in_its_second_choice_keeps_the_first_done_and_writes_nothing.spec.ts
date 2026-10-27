import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, startedRun, finishRun, runEvents, listedDiagrams, postJSON, exists } from './helpers';
import {
  WHOLE, option, typed, SLUG, ENGINE_LINES, scanThroughHome, drawRows, rowStates, startDrawChoices, runRecord, choiceStates, messagesOf, readChoices, getRaw, choiceIds,
} from './helpers-selections';
import { startedRetry } from './helpers-home';

const SLOW = 'Slow question [fixture:slow:second]';
const SLOW_ID = 'slow-question-fixture-slow-second';

// START-7, JOB-10 (api contract, *Deadlines, a choice that fails, and cancel*, ui contract `draw-cancel`, `draw-error`, `draw-retry`): the choices of a draw run side by side, so
// cancelling it while its second choice is read stops that choice and keeps the finished ones done; nothing is written. On the home
// screen the draw stays in its panel as cancelled (`Cancelled` in `draw-error`, the row cancelled at its read stage, the finished one
// done, no choosing step) with `Try again` and `Draw another project`; `Try again` is the retry endpoint and draws every choice into a
// new file, the finished one from what was kept; the editor opens only from `Open`. Over the API the same cancel leaves every choice that
// finished (the third too, which started beside the slow one on a free slot) done and the next draw reuses them. The screen half is
// also written with a server of its own in H247; this file keeps it on the suite's shared server, with the API half after it.
test('H197 [START-7 START-6 JOB-2 JOB-10 SCAN-3 HOME-4 HOME-6 #181 #200 #202] cancelling a draw in its second choice shows the first done and the second cancelled, writes nothing, and Try again draws all of them into a new file with the finished one from what was kept', async ({ page, request }) => {
  test.setTimeout(480_000);
  const auth = await token(request);
  const listedBefore = (await listedDiagrams(request)).length;

  // ---- On the home screen.
  const project = await gitRepo('home-cancel');
  await scanThroughHome(page, project.dir);
  await page.getByTestId('focus-whole').click();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(SLOW);
  await page.getByTestId('channel-choice-linkedin').click();
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  // Both choices start at once: the first is drawn in its own time, the second is slow: its read counts lines every two seconds.
  await expect(page.getByTestId('draw-line')).toContainText(/Working \d+\/30/, { timeout: 120_000 });
  await expect.poll(async () => rowStates(await drawRows(page)), { timeout: 120_000 }).toEqual(['system:done', `${SLOW_ID}:running`]);
  await expect(page.getByTestId('draw-cancel')).toBeVisible();
  await page.getByTestId('draw-cancel').click();
  await finishRun(request, run.runId, 'cancelled', 60_000);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId('draw-error')).toHaveText(/Cancelled/);
  await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert');
  await expect.poll(async () => rowStates(await drawRows(page))).toEqual(['system:done', `${SLOW_ID}:cancelled`]);
  const rows = await drawRows(page);
  expect(rows[0].stages.map(s => s.state)).toEqual(['done', 'done', 'done']);
  expect(rows[1].stages.map(s => [s.stage, s.state])).toEqual([['read', 'failed'], ['overview', 'waiting'], ['channel', 'waiting']]);
  await expect(page.getByTestId('draw-choice').nth(1).getByTestId('draw-choice-line')).toHaveText('Cancelled');
  await expect(page.getByTestId('draw-retry')).toHaveText('Try again'); await expect(page.getByTestId('draw-another')).toBeVisible();
  await expect(page.getByTestId('draw-cancel')).toHaveCount(0); await expect(page.getByTestId('draw-ready')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toHaveCount(0); await expect(page.getByTestId('focus-list'), 'the choosing step is not shown again').toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  const cancelled = await runEvents(run.runId);
  expect(cancelled.at(-1)!.data).toMatchObject({ status: 'cancelled', diagramId: null, path: null });
  expect(cancelled.at(-1)!.data.choices.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(['system:done', `${SLOW_ID}:cancelled`]);

  // Try again: every choice of the draw into a new file; the finished choice is drawn from what was kept, the cancelled one is read (slowly) again.
  const retry = await startedRetry(page, () => page.getByTestId('draw-retry').click());
  expect(retry.from).toBe(run.runId);
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 300_000 });
  const events = await runEvents(retry.runId);
  expect(messagesOf(events, 'system', 'read')).toContain('Using the facts already read');
  for (const line of ENGINE_LINES) expect(messagesOf(events, 'system'), `no engine call for the finished choice: "${line}"`).not.toContain(line);
  expect(messagesOf(events, SLOW_ID, 'read')).toContain('Reading the code');
  expect((await readChoices(join(project.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual(['system', SLOW_ID]);
  await page.waitForTimeout(800); await expect(page.getByTestId('editor'), 'the editor waits for Open').toHaveCount(0);

  // ---- Over the API, with a third choice beside the slow one: it is done before the cancel, so only the slow one is cancelled.
  const other = await gitRepo('api-cancel');
  const scan = await scanFolder(request, auth, other.dir);
  const runId = await startDrawChoices(request, auth, scan.id, [WHOLE, typed(SLOW), option('o2')], 'linkedin');
  await expect.poll(async () => choiceStates(await runRecord(request, runId)), { timeout: 180_000 }).toEqual(['system:done', `${SLOW_ID}:running`, `${SLUG.o2}:done`]);
  expect((await runRecord(request, runId)).choices.map((c: { stage: string | null }) => c.stage)).toEqual(['channel', 'read', 'channel']);
  expect((await postJSON(request, auth, `/api/runs/${runId}/cancel`, {})).status).toBe(200);
  const record = await finishRun(request, runId, 'cancelled', 60_000);
  expect(choiceStates(record)).toEqual(['system:done', `${SLOW_ID}:cancelled`, `${SLUG.o2}:done`]);
  expect(record).toMatchObject({ status: 'cancelled', diagramId: null, path: null });
  expect(await exists(join(other.dir, 'docs'))).toBe(false);
  // The next draw leaves the cancelled choice out and draws the others, both from what was kept.
  const again = await startDrawChoices(request, auth, scan.id, [option('o2'), WHOLE], 'linkedin');
  const done = await finishRun(request, again, 'succeeded', 240_000);
  const againEvents = await runEvents(again);
  for (const id of ['system', SLUG.o2]) {
    expect(messagesOf(againEvents, id, 'read')).toContain('Using the facts already read');
    for (const line of ENGINE_LINES) expect(messagesOf(againEvents, id)).not.toContain(line);
  }
  expect(choiceIds(await getRaw(request, done.diagramId))).toEqual([SLUG.o2, 'system']);
});
