import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, runEvents, listedDiagrams, exists, finishRun } from './helpers';
import {
  SLUG, ENGINE_LINES, scanThroughHome, optionBox, watchPosts, drawRows, rowStates, recordDrawRows, recordedRows, rowsAreInOrder, messagesOf, readChoices, where,
} from './helpers-selections';

const FLAKY = 'Billing [fixture:flaky:second]';
const FLAKY_ID = 'billing-fixture-flaky-second';
const BROKEN = 'Notes [fixture:fail]';
const BROKEN_ID = 'notes-fixture-fail';

// START-7, START-6 at the home screen (ui contract, `draw-error`, `draw-retry`): when a later choice fails, the screen shows the rows as the
// run ended (the finished ones done, the one it stopped in failed at its stage), nothing is written, every tick, the text and the channel
// stay and may be changed. `Try again` starts from the first choice that did not finish: the finished ones show their reused stage in
// `draw-line` and go done without an engine call. A changed choice and `draw-start` do the same for the ones that finished.
test('H196 [START-7 START-6 STORY-1 SCAN-3 #181] a draw whose second choice fails shows the first done and the second failed, writes nothing and keeps every tick; Try again goes through the first without a new read and draws the second; a changed third choice reuses the first two', async ({ page, request }) => {
  test.setTimeout(540_000);
  const posts = watchPosts(page);
  const listedBefore = (await listedDiagrams(request)).length;
  const ids = (events: { event: string; data: any }[], choice: string, stage?: string) => messagesOf(events, choice, stage);

  // ---- The whole system and a question of the user's own; the second read fails the first time.
  const project = await gitRepo('home-fail-second');
  await scanThroughHome(page, project.dir);
  await page.getByTestId('focus-whole').click();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(FLAKY);
  await page.getByTestId('channel-choice-linkedin').click();
  await expect(page.getByTestId('draw-start')).toContainText('Draw all 2');
  const first = await startedRun(page, () => page.getByTestId('draw-start').click());
  expect(first.body.choices).toEqual([{ kind: 'whole' }, { kind: 'typed', text: FLAKY }]);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('draw-retry')).toHaveText('Try again');

  // The rows as the run ended: the first done at every stage, the second failed at its read, its other stages waiting.
  const rows = await drawRows(page);
  expect(rowStates(rows)).toEqual(['system:done', `${FLAKY_ID}:failed`]);
  expect(rows[0].stages.map(s => s.state)).toEqual(['done', 'done', 'done']);
  expect(rows[1].stages.map(s => [s.stage, s.state])).toEqual([['read', 'failed'], ['overview', 'waiting'], ['channel', 'waiting']]);
  expect(rows[1].title).toBe(FLAKY);
  // Nothing was written; every choice stays and may be changed.
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  await expect(page.getByTestId('scan-card')).toBeVisible(); await expect(page.getByTestId('start-folder')).toHaveValue(project.dir);
  await expect(page.getByTestId('focus-whole')).toBeChecked(); await expect(page.getByTestId('focus-typed')).toBeChecked(); await expect(page.getByTestId('focus-text')).toHaveValue(FLAKY);
  await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(optionBox(page, 'o2')).not.toBeChecked();
  await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('focus-whole')).toBeEnabled(); await expect(page.getByTestId('focus-text')).toBeEnabled();
  await expect(page.getByTestId('channel-choice-readme')).toBeEnabled();

  // Try again: the same request and no new scan; the first choice goes through what was kept (its reused read shows as the stage
  // running with the line, then done once the next stage starts), and the second is read for the first time.
  const scans = posts.filter(p => p.path === '/api/scans').length;
  await recordDrawRows(page);
  const retry = await startedRun(page, () => page.getByTestId('draw-retry').click());
  expect(retry.body).toEqual(first.body); expect(retry.runId).not.toBe(first.runId);
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 240_000 });
  expect(posts.filter(p => p.path === '/api/scans'), 'no new scan').toHaveLength(scans);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'system'); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  const seen = await recordedRows(page);
  expect(rowsAreInOrder(seen), 'one choice after the other, each stage after the one before').toEqual([]);
  expect(seen.some(s => s.rows[0]?.stages[0] === 'running' && s.line.includes('Using the facts already read')), 'the first read stage ran as "Using the facts already read"').toBe(true);
  expect(seen.some(s => s.rows[0]?.state === 'done' && s.rows[1]?.state === 'running'), 'the first choice was done while the second ran').toBe(true);
  expect(seen.some(s => s.rows[0]?.stages[0] === 'running' && s.rows[1]?.state === 'waiting')).toBe(true);
  const events = await runEvents(retry.runId);
  expect(ids(events, 'system', 'read')).toContain('Using the facts already read');
  for (const line of ENGINE_LINES) expect(ids(events, 'system'), `no engine call for the finished choice: "${line}"`).not.toContain(line);
  expect(ids(events, FLAKY_ID, 'read'), 'the second choice is read').toContain('Reading the code');
  expect(ids(events, FLAKY_ID)).not.toContain('Using the facts already read');
  const stored = await readChoices(join(project.dir, 'docs', 'architecture.archdraw.json'));
  expect(stored.choices.map(c => c.id)).toEqual(['system', FLAKY_ID]);
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);

  // ---- Three choices; the third fails every time. Try again fails the same way and the first two stay done without a new read.
  const other = await gitRepo('home-fail-third');
  await scanThroughHome(page, other.dir);
  await page.getByTestId('focus-whole').click(); await optionBox(page, 'o2').click();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(BROKEN);
  await page.getByTestId('channel-choice-linkedin').click();
  await expect(page.getByTestId('draw-start')).toContainText('Draw all 3');
  const failing = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 240_000 });
  expect(rowStates(await drawRows(page))).toEqual(['system:done', `${SLUG.o2}:done`, `${BROKEN_ID}:failed`]);
  const again = await startedRun(page, () => page.getByTestId('draw-retry').click());
  expect(again.body).toEqual(failing.body); expect(again.runId).not.toBe(failing.runId);
  await finishRun(request, again.runId, 'failed', 240_000);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => rowStates(await drawRows(page)), { timeout: 60_000 }).toEqual(['system:done', `${SLUG.o2}:done`, `${BROKEN_ID}:failed`]);
  const againEvents = await runEvents(again.runId);
  for (const id of ['system', SLUG.o2]) {
    expect(ids(againEvents, id, 'read'), `${id} is read from what was kept`).toContain('Using the facts already read');
    for (const line of ENGINE_LINES) expect(ids(againEvents, id), `${id}: no engine call "${line}"`).not.toContain(line);
  }
  expect(againEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null });
  expect(await exists(join(other.dir, 'docs'))).toBe(false);

  // Change the third choice and draw: the two that finished are not read again, the changed one is, and the drawing opens on all three.
  await page.getByTestId('focus-text').fill('Notes');
  await expect(page.getByTestId('draw-start')).toContainText('Draw all 3');
  const last = await startedRun(page, () => page.getByTestId('draw-start').click());
  expect(last.body.choices).toEqual([{ kind: 'whole' }, { kind: 'option', option: 'o2' }, { kind: 'typed', text: 'Notes' }]);
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 300_000 });
  const lastEvents = await runEvents(last.runId);
  for (const id of ['system', SLUG.o2]) {
    expect(ids(lastEvents, id, 'read')).toContain('Using the facts already read'); expect(ids(lastEvents, id, 'overview')).toContain('Using the overview already drawn');
    for (const line of ENGINE_LINES) expect(ids(lastEvents, id)).not.toContain(line);
  }
  expect(ids(lastEvents, 'notes', 'read'), 'the changed choice is a new question: it is read').toContain('Reading the code');
  expect(await where(page)).toMatchObject({ choice: 'system', channel: 'linkedin' });
  const finished = await readChoices(join(other.dir, 'docs', 'architecture.archdraw.json'));
  expect(finished.choices.map(c => c.id)).toEqual(['system', SLUG.o2, 'notes']);
  expect(await exists(join(other.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
});
