import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, startedRun, finishRun, runEvents, listedDiagrams, postJSON, exists } from './helpers';
import {
  WHOLE, option, typed, SLUG, ENGINE_LINES, scanThroughHome, drawRows, rowStates, startDrawChoices, runRecord, choiceStates, messagesOf, progressOf, readChoices, getRaw, choiceIds,
} from './helpers-selections';

const SLOW = 'Slow question [fixture:slow:second]';
const SLOW_ID = 'slow-question-fixture-slow-second';

// START-7 (api contract, *Deadlines and cancel*, ui contract `draw-cancel`): cancelling a draw while its second choice is read stops the run
// there. The first choice stays done, the second shows cancelled at its stage, the choices after it wait, nothing is written, and the next
// draw goes through the finished choice without reading it again.
test('H197 [START-7 START-6 SCAN-3 #181] cancelling a draw in its second choice shows the first done and the second cancelled, writes nothing, and the next draw reuses the first', async ({ page, request }) => {
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
  // The first choice is drawn at once; the second is slow: its read counts lines every two seconds.
  await expect(page.getByTestId('draw-line')).toContainText(/Working \d+\/30/, { timeout: 120_000 });
  expect(rowStates(await drawRows(page))).toEqual(['system:done', `${SLOW_ID}:running`]);
  await expect(page.getByTestId('draw-cancel')).toBeVisible();
  await page.getByTestId('draw-cancel').click();
  await finishRun(request, run.runId, 'cancelled', 60_000);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => rowStates(await drawRows(page))).toEqual(['system:done', `${SLOW_ID}:cancelled`]);
  const rows = await drawRows(page);
  expect(rows[0].stages.map(s => s.state)).toEqual(['done', 'done', 'done']);
  expect(rows[1].stages.map(s => [s.stage, s.state])).toEqual([['read', 'failed'], ['overview', 'waiting'], ['channel', 'waiting']]);
  await expect(page.getByTestId('draw-retry')).toHaveText('Try again');
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  await expect(page.getByTestId('focus-whole')).toBeChecked(); await expect(page.getByTestId('focus-text')).toHaveValue(SLOW); await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked();
  await expect(page.getByTestId('focus-whole')).toBeEnabled(); await expect(page.getByTestId('start-folder')).toBeEnabled();
  const cancelled = await runEvents(run.runId);
  expect(cancelled.at(-1)!.data).toMatchObject({ status: 'cancelled', diagramId: null, path: null });
  expect(cancelled.at(-1)!.data.choices.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(['system:done', `${SLOW_ID}:cancelled`]);

  // The question is changed so it is no longer slow; the finished choice is not read again.
  await page.getByTestId('focus-text').fill('Slow question');
  const next = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 300_000 });
  const events = await runEvents(next.runId);
  expect(messagesOf(events, 'system', 'read')).toContain('Using the facts already read');
  for (const line of ENGINE_LINES) expect(messagesOf(events, 'system'), `no engine call for the finished choice: "${line}"`).not.toContain(line);
  expect(messagesOf(events, 'slow-question', 'read')).toContain('Reading the code');
  expect((await readChoices(join(project.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual(['system', 'slow-question']);

  // ---- Over the API, with a choice after the cancelled one: it never starts and waits as the run ended.
  const other = await gitRepo('api-cancel');
  const scan = await scanFolder(request, auth, other.dir);
  const runId = await startDrawChoices(request, auth, scan.id, [WHOLE, typed(SLOW), option('o2')], 'linkedin');
  await expect.poll(async () => choiceStates(await runRecord(request, runId)), { timeout: 180_000 }).toEqual(['system:done', `${SLOW_ID}:running`, `${SLUG.o2}:waiting`]);
  expect((await runRecord(request, runId)).choices.map((c: { stage: string | null }) => c.stage)).toEqual(['channel', 'read', null]);
  expect((await postJSON(request, auth, `/api/runs/${runId}/cancel`, {})).status).toBe(200);
  const record = await finishRun(request, runId, 'cancelled', 60_000);
  expect(choiceStates(record)).toEqual(['system:done', `${SLOW_ID}:cancelled`, `${SLUG.o2}:waiting`]);
  expect(record).toMatchObject({ status: 'cancelled', diagramId: null, path: null });
  expect(progressOf(await runEvents(runId), SLUG.o2), 'the choice after the cancelled one never started').toEqual([]);
  expect(await exists(join(other.dir, 'docs'))).toBe(false);
  // The next draw leaves the cancelled choice out and draws the others, the finished one from what was kept.
  const again = await startDrawChoices(request, auth, scan.id, [option('o2'), WHOLE], 'linkedin');
  const done = await finishRun(request, again, 'succeeded', 240_000);
  const againEvents = await runEvents(again);
  expect(messagesOf(againEvents, 'system', 'read')).toContain('Using the facts already read');
  for (const line of ENGINE_LINES) expect(messagesOf(againEvents, 'system')).not.toContain(line);
  expect(messagesOf(againEvents, SLUG.o2, 'read')).toContain('Reading the code');
  expect(choiceIds(await getRaw(request, done.diagramId))).toEqual([SLUG.o2, 'system']);
});
