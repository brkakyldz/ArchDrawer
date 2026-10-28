import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import { says, saying, gitRepo, scanOnHome, tick, startedRun, answerTo, rows, runRecord, runEvents, lines, readJSON, exists, viewOf, engineLines } from './helpers';

const product = useProduct();
const TYPED = 'Explain the loop [fixture:flaky:overview] [fixture:overlong] [fixture:stubborn]';

// A user's draw fails while the overview is drawn. The panel says why and offers Try again, which starts from the overview with no new
// read. This time the engine's description is too long, stays too long after its one repair turn, and is shortened with one warning:
// the user still gets the drawing, and the editor shows the warning.
test('H19 [START-6 STORY-7 HOME-6 EDIT-3] a draw that fails at the overview keeps its read for Try again, and a description still too long after the repair turn is shortened with one warning and still drawn', async ({ page }) => {
  const p = product();
  const project = await gitRepo('failed-overview');
  await scanOnHome(page, p, project.dir);
  await tick(page, { typed: TYPED }, 'linkedin');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());

  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('draw-error')).toHaveText(/Fixture failure requested/);
  await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert');
  await expect.poll(async () => (await rows(page))[0]?.stages.map(s => `${s.stage}:${s.state}`)).toEqual(['read:done', 'overview:failed', 'channel:waiting']);
  await expect(page.getByTestId('draw-ready')).toHaveCount(0);
  await expect(page.getByTestId('focus-list'), 'a failed draw does not reopen its choosing step').toHaveCount(0);
  const failed = await runRecord(p, run.runId);
  expect(failed).toMatchObject({ status: 'failed', diagramId: null, path: null });
  const choiceId = failed.choices[0].id as string;
  expect(await exists(join(project.dir, 'docs')), 'a failed draw writes nothing').toBe(false);

  const retry = await answerTo(page, 'POST', /^\/api\/runs\/[^/]+\/retry$/, () => page.getByTestId('draw-retry').click());
  expect(retry.status).toBe(202);
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });
  const events = await runEvents(p, retry.body.runId);
  expect(says(lines(events, choiceId, 'read'), /facts already read/)).toBe(true);
  expect(says(lines(events, choiceId, 'read'), /Checking the facts/)).toBe(true);
  expect(engineLines(events, choiceId, 'read'), 'no engine call').toEqual([]);
  const overview = lines(events, choiceId, 'overview');
  expect(saying(overview, /Fixing 1 problem/), 'one repair turn').toBe(1);
  expect(says(overview, /Drawing the overview/)).toBe(true);

  const document = await readJSON(join(project.dir, 'docs', 'architecture.archdraw.json'));
  const lede = viewOf(document, 'overview').caption.lede as string;
  expect(lede.length).toBe(240);
  expect(lede.endsWith('…')).toBe(true);
  // One warning per text shortened: the overview's, and the post's too if the channel call needed a repair turn of its own.
  const channelRepairs = lines(events, choiceId, 'channel').filter(l => /^Fixing \d+ problems? in the answer$/.test(l)).length;
  expect(document.warnings.filter((w: string) => /Shortened the description to 240 characters/.test(w))).toHaveLength(1 + (channelRepairs > 0 ? 1 : 0));

  // The editor shows the warning from the last change.
  await page.getByTestId('draw-open').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('channel-tab-overview').click();
  await expect(page.getByTestId('warnings')).toContainText(/Shortened the description/);
});
