import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import { gitRepo, scanOnHome, tick, startedRun, rowOf, activity, exists, drawingRepo, shopDoc, openDrawing } from './helpers';

const product = useProduct();
const SLOW = 'A slow question [fixture:slow]', SLOW_ID = 'a-slow-question-fixture-slow';

// A user reloads the home screen in the middle of a slow draw and opens a second tab: both find the job and follow it from where it is.
// Then the server restarts: the home screen says once that one job stopped and lists it no more, the editor open in the other tab never
// claims a save it could not make, and the stopped draw wrote nothing.
test('H16 [JOB-7 JOB-9 HOME-7 EDIT-3] a reload and a second page follow a running draw, and after a restart the page says one job stopped, lists none, and an editor\'s save fails visibly', async ({ page, context }) => {
  test.setTimeout(180_000);
  const p = product();
  const project = await gitRepo('restart');
  const { file } = await drawingRepo('restart-editor', shopDoc('Open shop'));
  await scanOnHome(page, p, project.dir);
  await tick(page, { typed: SLOW }, 'readme');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-line')).toContainText(/Working \d+\/30/, { timeout: 30_000 });

  // A reload: Activity lists the draw running; pressing it follows it from where it is.
  await page.reload();
  const job = page.locator(`[data-testid="activity-job"][data-job="${run.runId}"]`);
  await expect(job).toHaveAttribute('data-state', 'running');
  await expect(job.getByTestId('activity-job-status')).toHaveText(/README drawing/);
  await job.click();
  await expect(rowOf(page, SLOW_ID)).toHaveAttribute('data-state', 'running');
  const line = page.getByTestId('draw-line');
  await expect(line).toContainText(/Working \d+\/30/);
  const seen = await line.innerText();
  await expect(line, 'it goes on following').not.toHaveText(seen, { timeout: 15_000 });

  // A second page sees the same job; a third tab has a drawing open in the editor.
  const second = await context.newPage();
  await second.goto(`${p.base}/`);
  await expect(second.locator(`[data-testid="activity-job"][data-job="${run.runId}"]`)).toHaveAttribute('data-state', 'running');
  const editor = await context.newPage();
  await openDrawing(editor, p, file);
  const before = (await activity(p)).instance as string;
  expect(before).toMatch(/^[0-9a-f]{16}$/);

  await p.restart();

  // The home screen says once how many jobs stopped, lists them no more, and frees the panel.
  await expect(page.getByTestId('jobs-restarted')).toHaveText(/1 job stopped/, { timeout: 30_000 });
  await expect(page.getByTestId('jobs-restarted')).toHaveCount(1);
  await expect(page.getByTestId('activity-job')).toHaveCount(0);
  await expect(page.getByTestId('activity-none')).toBeVisible();
  await expect(page.getByTestId('start-folder')).toBeEnabled();
  const now = await activity(p);
  expect(now.instance).not.toBe(before);
  expect(now.jobs).toEqual([]);
  expect((await p.get(`/api/runs/${run.runId}`)).status, 'the old id is gone').toBe(404);

  // The editor still holds the old token: its next save is refused and says so, never Saved.
  await editor.getByTestId('node-db').getByTestId('node-label').dblclick();
  await editor.getByTestId('node-label-input').fill('Orders store');
  await editor.getByTestId('node-label-input').press('Enter');
  await expect(editor.getByTestId('save-retry')).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByTestId('save-status')).not.toHaveText(/^\s*Saved\s*$/);
  await expect(editor.getByText(/server restarted.*reload/i).first()).toBeVisible();

  // After a reload the notice is gone; the stopped draw wrote nothing.
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('jobs-restarted')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false);
  await second.close(); await editor.close();
});
