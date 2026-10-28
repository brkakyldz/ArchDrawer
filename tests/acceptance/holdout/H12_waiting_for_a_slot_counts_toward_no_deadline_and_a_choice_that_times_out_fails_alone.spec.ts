import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import { gitRepo, scan, startDraw, startScan, waitRun, waitScan, runRecord, home, rowOf, readJSON, OPTION, option, typed } from './helpers';

const product = useProduct({ slots: 1, timeoutMs: 10_000 });
const SLOW = 'A slow part [fixture:slow]', SLOW_ID = 'a-slow-part-fixture-slow';

// On one slot with the shortest time limit, a user draws a slow part and a section of one repository and scans another. The slow part passes
// its limit and fails alone; the section and the scan, which waited longer than the limit for the slot, finish, because waiting counts
// toward no deadline. The file holds the section only, and the home screen marks the part that could not be drawn.
test('H12 [JOB-1 JOB-3 START-7 HOME-6] time spent waiting for a slot counts toward no deadline, and a choice that passes its own deadline fails alone while the others are written', async ({ page }) => {
  test.setTimeout(150_000);
  const p = product();
  const first = await gitRepo('deadline-first', undefined, 'Deadline shop'), second = await gitRepo('deadline-second');
  const firstScan = await scan(p, { folder: first.dir });
  const drawId = await startDraw(p, firstScan.id, [typed(SLOW), option('o2')], 'readme');
  await expect.poll(async () => (await runRecord(p, drawId)).choices.map((c: any) => c.status)).toEqual(['running', 'waiting']);
  const scanId = await startScan(p, { folder: second.dir });

  const record = await waitRun(p, drawId, 'succeeded', 120_000);
  const [slow, section] = record.choices;
  expect(slow).toMatchObject({ id: SLOW_ID, status: 'failed', stage: 'read' });
  expect(slow.error).toMatch(/Timed out/);
  expect(section).toMatchObject({ id: OPTION.o2.id, status: 'done' });
  // The section was accepted with the slow part and started only once the slow part had used up its whole limit: it waited past a limit
  // of its own, and still finished.
  expect(Date.parse(section.startedAt), 'the section waited for the slot').toBeGreaterThanOrEqual(Date.parse(slow.endedAt));
  const scanned = await waitScan(p, scanId, 'succeeded', 60_000);
  expect(Date.parse(scanned.createdAt), 'the scan was asked while the slow part ran').toBeLessThan(Date.parse(slow.endedAt));
  expect(Date.parse(scanned.startedAt), 'and started after the section').toBeGreaterThanOrEqual(Date.parse(section.endedAt));

  // The file holds the choice that finished, never the one that failed.
  const document = await readJSON(join(first.dir, 'docs', 'architecture.archdraw.json'));
  expect(document.choices.map((c: any) => c.id)).toEqual([OPTION.o2.id]);
  expect(record.path).toBeTruthy();

  // The home screen: Ready with one that could not be drawn, the failed row and Try again.
  await home(page, p);
  await page.locator(`[data-testid="activity-job"][data-job="${drawId}"]`).click();
  await expect(page.getByTestId('draw-ready')).toContainText(/1 could not be drawn/);
  await expect(rowOf(page, SLOW_ID)).toHaveAttribute('data-state', 'failed');
  await expect(rowOf(page, SLOW_ID).getByTestId('draw-choice-line')).toHaveText(/Could not draw: .*Timed out/);
  await expect(rowOf(page, OPTION.o2.id)).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('draw-retry')).toBeVisible();
  await expect(page.locator(`[data-testid="activity-job"][data-job="${drawId}"]`).getByTestId('activity-job-status')).toHaveText(/1 failed/);
});
