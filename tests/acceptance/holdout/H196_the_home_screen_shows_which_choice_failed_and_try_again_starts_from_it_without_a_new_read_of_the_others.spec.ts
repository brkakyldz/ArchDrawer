import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, runEvents, listedDiagrams, exists } from './helpers';
import { SLUG, scanThroughHome, optionBox, watchPosts, drawRows, rowStates, messagesOf, progressOf, readChoices, where } from './helpers-selections';
import { startedRetry, runRecordAt } from './helpers-home';
import { baseURL } from './helpers';

const FLAKY = 'Billing [fixture:flaky:second]';
const FLAKY_ID = 'billing-fixture-flaky-second';
const BROKEN = 'Notes [fixture:fail]';
const BROKEN_ID = 'notes-fixture-fail';

// START-7, START-6 at the home screen (ui contract, `draw-ready`, `draw-error`, `draw-retry`; ADR 0016): when a later choice fails the others
// go on and are written. The draw is Ready (it succeeded) with the failed choice told apart in its row and in the Ready line; nothing
// of the draw's own panel is editable any more. `Try again` draws only the failed choice, into the same file, through the retry
// endpoint, without reading the finished ones again. A choice that fails every time ends its retry as a failed draw with its reason
// in `draw-error`, and the file keeps what it had.
test('H196 [START-7 START-6 STORY-1 SCAN-3 JOB-3 JOB-8 HOME-6 #181 #200 #202] a draw whose second choice fails is Ready with the first written and the second shown failed, Try again draws only the failed one into the same file, and a choice that fails every time ends its retry with its reason and leaves the file as it was', async ({ page, request }) => {
  test.setTimeout(540_000);
  const posts = watchPosts(page);
  const listedBefore = (await listedDiagrams(request)).length;

  // ---- The whole system and a question of the user's own; the second read fails the first time.
  const project = await gitRepo('home-fail-second');
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  await scanThroughHome(page, project.dir);
  await page.getByTestId('focus-whole').click();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(FLAKY);
  await page.getByTestId('channel-choice-linkedin').click();
  await expect(page.getByTestId('draw-start')).toContainText('Draw all 2');
  const first = await startedRun(page, () => page.getByTestId('draw-start').click());
  expect(first.body.choices).toEqual([{ kind: 'whole' }, { kind: 'typed', text: FLAKY }]);
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
  expect((await page.getByTestId('draw-ready').textContent())!.replace(/\s+/g, ' ')).toMatch(/1 drawing for a LinkedIn post · 1 could not be drawn/);
  await expect(page.getByTestId('draw-retry')).toHaveText('Try again'); await expect(page.getByTestId('draw-error')).toHaveCount(0);

  // The rows as the draw ended: the first done at every stage, the second failed at its read, its other stages waiting.
  const rows = await drawRows(page);
  expect(rowStates(rows)).toEqual(['system:done', `${FLAKY_ID}:failed`]);
  expect(rows[0].stages.map(s => s.state)).toEqual(['done', 'done', 'done']);
  expect(rows[1].stages.map(s => [s.stage, s.state])).toEqual([['read', 'failed'], ['overview', 'waiting'], ['channel', 'waiting']]);
  expect(rows[1].title).toBe(FLAKY);
  await expect(page.getByTestId('draw-choice').nth(1).getByTestId('draw-choice-line')).toHaveText('Could not draw: Fixture failure requested');
  // The draw's choices are not edited here: no choosing step. The finished choice is in the file, the failed one is not; the editor waits for Open.
  await expect(page.getByTestId('focus-list')).toHaveCount(0); await expect(page.getByTestId('draw-start')).toHaveCount(0); await expect(page.getByTestId('editor')).toHaveCount(0);
  expect((await readChoices(file)).choices.map(c => c.id)).toEqual(['system']);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  expect((await project.git(['status', '--porcelain'])).trim()).toBe('?? docs/');

  // Try again: the retry endpoint, no new scan, no new draw request; only the failed choice is drawn, into the same file.
  const scans = posts.filter(p => p.path === '/api/scans').length;
  const retry = await startedRetry(page, () => page.getByTestId('draw-retry').click());
  expect(retry.from).toBe(first.runId); expect(retry.runId).not.toBe(first.runId);
  expect(posts.filter(p => p.path === '/api/runs'), 'Try again is not a new draw request').toHaveLength(1);
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('draw-ready')).not.toContainText('could not be drawn');
  expect(posts.filter(p => p.path === '/api/scans'), 'no new scan').toHaveLength(scans);
  const events = await runEvents(retry.runId);
  expect(progressOf(events, 'system'), 'the finished choice is not drawn again: it is not in the retry').toEqual([]);
  expect(messagesOf(events, FLAKY_ID, 'read'), 'the failed choice is read').toContain('Reading the code');
  expect(await runRecordAt(request, baseURL(), retry.runId)).toMatchObject({ status: 'succeeded', retryOf: first.runId, diagramId: (await runRecordAt(request, baseURL(), first.runId)).diagramId });
  expect((await readChoices(file)).choices.map(c => c.id)).toEqual(['system', FLAKY_ID]);
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  await page.getByTestId('draw-open').click(); await expect(page.getByTestId('editor')).toBeVisible({ timeout: 30_000 });
  expect(await where(page)).toMatchObject({ choice: FLAKY_ID, channel: 'linkedin' });

  // ---- Three choices; the third fails every time. The others are written; Try again fails the same way and the file keeps what it had.
  const other = await gitRepo('home-fail-third');
  const otherFile = join(other.dir, 'docs', 'architecture.archdraw.json');
  await scanThroughHome(page, other.dir);
  await page.getByTestId('focus-whole').click(); await optionBox(page, 'o2').click();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(BROKEN);
  await page.getByTestId('channel-choice-linkedin').click();
  await expect(page.getByTestId('draw-start')).toContainText('Draw all 3');
  const failing = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
  expect(rowStates(await drawRows(page))).toEqual(['system:done', `${SLUG.o2}:done`, `${BROKEN_ID}:failed`]);
  expect((await page.getByTestId('draw-ready').textContent())!.replace(/\s+/g, ' ')).toMatch(/2 drawings for a LinkedIn post · 1 could not be drawn/);
  expect((await readChoices(otherFile)).choices.map(c => c.id)).toEqual(['system', SLUG.o2]);
  const again = await startedRetry(page, () => page.getByTestId('draw-retry').click());
  expect(again.from).toBe(failing.runId);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 240_000 }); await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert'); await expect(page.getByTestId('draw-retry')).toBeVisible(); await expect(page.getByTestId('draw-another')).toBeVisible();
  const againEvents = await runEvents(again.runId);
  for (const id of ['system', SLUG.o2]) expect(progressOf(againEvents, id), `${id} is not read again`).toEqual([]);
  expect(againEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null });
  expect(rowStates(await drawRows(page))).toEqual([`${BROKEN_ID}:failed`]);
  expect((await readChoices(otherFile)).choices.map(c => c.id), 'the file keeps what it had').toEqual(['system', SLUG.o2]);
  expect(await exists(join(other.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect(posts.filter(p => p.path === '/api/runs'), 'two draws were asked for, neither was asked again').toHaveLength(2);
});
