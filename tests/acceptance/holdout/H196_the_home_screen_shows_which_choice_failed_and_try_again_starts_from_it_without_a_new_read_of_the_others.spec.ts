import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, runEvents, exists } from './helpers';
import { SLUG, scanThroughHome, optionBox, watchPosts, drawRows, rowStates, progressOf, readChoices } from './helpers-selections';
import { startedRetry } from './helpers-home';

const BROKEN = 'Notes [fixture:fail]';
const BROKEN_ID = 'notes-fixture-fail';

// START-7, START-6 at the home screen (ui contract, `draw-ready`, `draw-error`, `draw-retry`; ADR 0016): when a later choice fails the others
// go on and are written. The draw is Ready (it succeeded) with the failed choice told apart in its row and in the Ready line. `Try again`
// draws only the failed choice, through the retry endpoint, without reading the finished ones again; a choice that fails every time ends
// its retry as a failed draw with its reason in `draw-error`, the rows shrink to it, and the file keeps what it had. (A choice that fails
// once and is then drawn into the same file by `Try again`, opened from Ready, is H240.)
test('H196 [START-7 START-6 SCAN-3 JOB-3 HOME-4 HOME-6 #181 #200 #202] a draw of three choices whose third fails every time is Ready with the others written and the failed one shown, and Try again on it ends in draw-error with its reason, reads none of the finished ones again and leaves the file as it was', async ({ page }) => {
  test.setTimeout(60_000);
  const posts = watchPosts(page);

  // Three choices; the third fails every time. The others are written; Try again fails the same way and the file keeps what it had.
  const project = await gitRepo('home-fail-third');
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  await scanThroughHome(page, project.dir);
  await page.getByTestId('focus-whole').click(); await optionBox(page, 'o2').click();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(BROKEN);
  await page.getByTestId('channel-choice-linkedin').click();
  await expect(page.getByTestId('draw-start')).toContainText('Draw all 3');
  const failing = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 30_000 });
  expect(rowStates(await drawRows(page))).toEqual(['system:done', `${SLUG.o2}:done`, `${BROKEN_ID}:failed`]);
  expect((await page.getByTestId('draw-ready').textContent())!.replace(/\s+/g, ' ')).toMatch(/2 drawings for a LinkedIn post · 1 could not be drawn/);
  expect((await readChoices(file)).choices.map(c => c.id)).toEqual(['system', SLUG.o2]);
  const again = await startedRetry(page, () => page.getByTestId('draw-retry').click());
  expect(again.from).toBe(failing.runId);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert'); await expect(page.getByTestId('draw-retry')).toBeVisible(); await expect(page.getByTestId('draw-another')).toBeVisible();
  const againEvents = await runEvents(again.runId);
  for (const id of ['system', SLUG.o2]) expect(progressOf(againEvents, id), `${id} is not read again`).toEqual([]);
  expect(againEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null });
  expect(rowStates(await drawRows(page))).toEqual([`${BROKEN_ID}:failed`]);
  expect((await readChoices(file)).choices.map(c => c.id), 'the file keeps what it had').toEqual(['system', SLUG.o2]);
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect(posts.filter(p => p.path === '/api/runs'), 'one draw was asked for, and Try again did not ask for another').toHaveLength(1);
});
