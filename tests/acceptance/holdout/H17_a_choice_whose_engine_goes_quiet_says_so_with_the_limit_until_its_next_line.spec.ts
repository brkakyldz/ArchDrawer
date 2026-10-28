import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { gitRepo, scanOnHome, tick, startedRun, rowOf, watchStream, runRecord } from './helpers';

const product = useProduct({ timeoutMs: 120_000 });
const QUIET = 'A quiet question [fixture:quiet]', QUIET_ID = 'a-quiet-question-fixture-quiet';

// A user watches a draw whose engine says nothing for a long while on one choice. After 30 s that row says it is quiet, with the server's
// limit, while the other row does not; Activity says the same; the record keeps the time of the engine's last line; the notice goes with
// the next line and the draw finishes.
test('H17 [HOME-5 HOME-4 JOB-6] a choice with no engine line for 30 s says it is quiet with the limit while the other is not, and the notice goes with the next line', async ({ page }) => {
  test.setTimeout(150_000);
  const p = product();
  const project = await gitRepo('quiet');
  await scanOnHome(page, p, project.dir);
  await tick(page, { options: ['o2'], typed: QUIET }, 'linkedin');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  const stream = watchStream(p, `/api/runs/${run.runId}/events`);

  const row = rowOf(page, QUIET_ID);
  await expect(row.getByTestId('draw-choice-files')).toHaveText(/2 files read/, { timeout: 30_000 });
  const quiet = row.getByTestId('draw-choice-quiet');
  await expect(quiet).toBeVisible({ timeout: 60_000 });
  await expect(quiet).toHaveText(/Quiet for \d+ s .*limit 2 min/);
  const first = await quiet.innerText();
  await expect(quiet, 'it counts on').not.toHaveText(first);
  await expect(rowOf(page, 'the-agent-loop').getByTestId('draw-choice-quiet'), 'the other row is not quiet').toHaveCount(0);
  await expect(page.locator(`[data-testid="activity-job"][data-job="${run.runId}"]`).getByTestId('activity-job-status')).toHaveText(/quiet for \d+ s/);

  // The record keeps the time of the engine's last line while it is quiet.
  const lastLine = [...stream.events].reverse().find(e => e.event === 'progress' && e.data.choice === QUIET_ID && e.data.source === 'engine');
  expect(lastLine?.data.message).toMatch(/^Reading the code$/);
  const record = await runRecord(p, run.runId);
  expect(record.choices.find((c: any) => c.id === QUIET_ID).lastEngineEventAt).toBe(lastLine!.data.at);

  // The next engine line ends the notice; the draw then finishes.
  await expect(quiet).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 60_000 });
  stream.stop();
});
