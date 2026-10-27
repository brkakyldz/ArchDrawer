import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists, listedDiagrams, finishRun, startedRun } from './helpers';
import { startedRetry } from './helpers-home';

// START-4: when a draw fails, nothing was written; the panel keeps showing the draw with its reason, and from there the user can try
// again or leave it for another draw. From ADR 0016 a failed draw stays in the draw panel (`draw-error`, `draw-retry`,
// `draw-another`): its choosing step is not shown again, `Try again` calls the retry endpoint, and a changed draw is a new one.
// A machine with no engine (the screen says what to install, Scan off, the example) is H248.
test('H123 [START-4, START-7, JOB-3, HOME-4, HOME-6, #181, #200, #202] a failed draw writes nothing and stays in the panel with its reason, Try again uses the retry endpoint and fails the same way, and a changed draw from the same folder opens from Ready', async ({ page, request }) => {
  test.setTimeout(60_000);
  const project = await gitRepo('start-fail');
  const listedBefore = (await listedDiagrams(request)).length;
  const posts: { path: string; body: any }[] = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { let body: any = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; } posts.push({ path: url.pathname, body }); }
  });
  const runs = () => posts.filter(p => p.path === '/api/runs');

  await page.goto('/'); await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill('The tool loop [fixture:fail]');
  await page.getByTestId('channel-choice-linkedin').click();
  const firstDraw = await startedRun(page, () => page.getByTestId('draw-start').click());

  // The draw fails at the read: the reason is shown in the draw panel, nothing was written or registered, the choosing step is not shown again.
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested'); await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('draw-progress').getByTestId('draw-error')).toBeVisible();
  await expect(page.getByTestId('draw-retry')).toHaveText('Try again'); await expect(page.getByTestId('draw-another')).toBeVisible();
  // The one choice's row shows where it ended: failed at its read, the other stages waiting.
  await expect(page.getByTestId('draw-choice')).toHaveCount(1); await expect(page.getByTestId('draw-choice')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('draw-stage').evaluateAll(els => els.map(el => el.getAttribute('data-state')))).resolves.toEqual(['failed', 'waiting', 'waiting']);
  await expect(page.getByTestId('draw-choice-line')).toContainText('Could not draw: Fixture failure requested');
  await expect(page.getByTestId('focus-list')).toHaveCount(0); await expect(page.getByTestId('draw-start')).toHaveCount(0); await expect(page.getByTestId('channel-choice-linkedin')).toHaveCount(0);
  await expect(page.getByTestId('start-folder')).toHaveValue(project.dir);
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  expect(runs()).toHaveLength(1);

  // Try again calls the retry endpoint of the draw (no body, no new draw request, no new scan); it fails the same way.
  const scansBefore = posts.filter(p => p.path === '/api/scans').length;
  const firstRun = firstDraw.runId;
  const retry = await startedRetry(page, () => page.getByTestId('draw-retry').click());
  expect(retry.from).toBe(firstRun); expect(retry.runId).not.toBe(firstRun); expect(['', '{}'], 'the retry names no choices').toContain(retry.body ?? '');
  expect(runs(), 'Try again is not a new draw request').toHaveLength(1);
  await finishRun(request, retry.runId, 'failed', 15_000);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(scansBefore);

  // Leave it for another draw: the folder again (cached), the words changed, the drawing written; the editor opens from Ready only.
  await page.getByTestId('draw-another').click(); await expect(page.getByTestId('draw-progress')).toHaveCount(0); await expect(page.getByTestId('start-folder')).toBeEnabled();
  await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId('focus-typed')).not.toBeChecked();
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill('The tool loop');
  await page.getByTestId('channel-choice-linkedin').click();
  await page.getByTestId('draw-start').click();
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000); await expect(page.getByTestId('editor')).toHaveCount(0);
  await page.getByTestId('draw-open').click();
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  expect(runs()).toHaveLength(2); expect(runs()[1].body).toMatchObject({ kind: 'draw', choices: [{ kind: 'typed', text: 'The tool loop' }], channel: 'linkedin' }); expect(runs()[1].body).not.toHaveProperty('focus');
  expect(await exists(join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true); expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
});
