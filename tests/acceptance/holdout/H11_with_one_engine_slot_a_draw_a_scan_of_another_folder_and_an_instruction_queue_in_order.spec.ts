import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  gitRepo, scan, startDraw, runRecord, scanRecord, waitRun, waitScan, activity, home, answerTo, drawingRepo, shopDoc, register, exists, typed, WHOLE,
} from './helpers';

const product = useProduct({ slots: 1, stepMs: 150, keepMs: 30_000 });

// On a machine with one engine slot, a user's first repository is being drawn (slowly) when they scan a second one and, in another drawing,
// send an instruction. Both wait their turn and say so; Activity lists every job and follows the one pressed; cancelling the draw frees the
// slot, and the waiting jobs run in the order they asked.
test('H11 [JOB-1 JOB-5 JOB-7 JOB-10 HOME-7 AI-1] with one engine slot, a scan of another folder and an instruction wait in the order they asked, Activity says so and follows the job pressed, and a cancel frees the slot', async ({ page }) => {
  const p = product();
  const first = await gitRepo('queue-first', undefined, 'First shop'), second = await gitRepo('queue-second', undefined, 'Second shop');
  const firstScan = await scan(p, { folder: first.dir });
  const drawId = await startDraw(p, firstScan.id, [typed('A slow part [fixture:slow]'), WHOLE], 'readme');
  await expect.poll(async () => (await runRecord(p, drawId)).choices.map((c: any) => c.status)).toEqual(['running', 'waiting']);

  // The second folder's scan waits for the slot, on the panel and in Activity.
  await home(page, p);
  await page.getByTestId('start-folder').fill(second.dir);
  const scanned = await answerTo(page, 'POST', /^\/api\/scans$/, () => page.getByTestId('start-scan').click());
  const scanId = scanned.body.scanId as string;
  await expect(page.getByTestId('scan-progress')).toContainText(/Waiting for a free engine/);
  const scanJob = page.locator(`[data-testid="activity-job"][data-job="${scanId}"]`);
  const drawJob = page.locator(`[data-testid="activity-job"][data-job="${drawId}"]`);
  await expect(scanJob).toHaveAttribute('data-state', 'waiting');
  await expect(scanJob.getByTestId('activity-job-status')).toHaveText(/Waiting for a free engine/);
  await expect(drawJob).toHaveAttribute('data-type', 'draw');
  await expect(drawJob.getByTestId('activity-job-name')).toHaveText('First shop');
  await expect(scanJob).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('activity-keep')).toContainText('1');
  expect((await scanRecord(p, scanId)).waiting).toBe(true);

  // An instruction on another drawing asks after the scan, so it waits behind it.
  const { file } = await drawingRepo('queue-instruction', shopDoc('Queued shop'));
  const diagramId = (await register(p, file)).id;
  const instruction = await p.post('/api/runs', { diagramId, view: 'overview', instruction: 'add Cache', engine: 'fixture', model: null, scope: { kind: 'view' } });
  expect(instruction.status).toBe(202);
  const instructionId = instruction.body.runId as string;
  await expect.poll(async () => (await runRecord(p, instructionId)).waiting).toBe(true);
  expect((await runRecord(p, instructionId)).progress[0]).toMatch(/Waiting for a free engine/);
  const now = await activity(p);
  // In the queue: the draw's whole-system choice, the scan and the instruction (api contract, *Activity*: `waiting`, the requests in the queue).
  expect(now.slots).toEqual({ total: 1, busy: 1, waiting: 3 });
  expect(now.jobs.some((j: any) => j.id === instructionId), 'Activity lists scans and draws only').toBe(false);

  // Cancel the draw: its slot goes to the scan, then to the instruction.
  expect((await p.post(`/api/runs/${drawId}/cancel`)).body).toEqual({ ok: true });
  const cancelled = await waitRun(p, drawId, 'cancelled');
  expect(cancelled.choices.map((c: any) => c.status)).toEqual(['cancelled', 'waiting']);
  // Until the instruction has ended, every look at the server must show at most one engine at work, and never the instruction at work
  // while the scan, which asked first, is still at work or waiting (api contract, *Engine slots*: one queue, in the order asked). These are
  // states sampled together, not times compared.
  const broken: string[] = [];
  await expect.poll(async () => {
    const [act, s, r] = [await activity(p), await scanRecord(p, scanId), await runRecord(p, instructionId)];
    if (act.slots.busy > 1) broken.push(`${act.slots.busy} engines at work`);
    if (s.status === 'running' && r.status === 'running' && !r.waiting) broken.push('the instruction ran before the scan had ended');
    return r.status;
  }, { timeout: 60_000, intervals: [50] }).not.toBe('running');
  expect(broken).toEqual([]);
  await waitScan(p, scanId);
  await waitRun(p, instructionId);
  await expect(page.getByTestId('focus-list'), 'the panel follows its scan to the choosing step').toBeVisible();

  // Pressing the cancelled draw in Activity makes the panel follow it; Draw another project frees the panel and the jobs stay listed.
  await drawJob.click();
  await expect(page.getByTestId('draw-error')).toHaveText(/Cancelled/);
  await expect(drawJob).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('draw-another').click();
  await expect(page.getByTestId('start-folder')).toHaveValue('');
  await expect(page.getByTestId('start-folder')).toBeEnabled();
  await expect(drawJob).toBeVisible(); await expect(scanJob).toBeVisible();
  await expect(scanJob.getByTestId('activity-open')).toHaveText(/Choose/);
  await page.reload();
  await expect(page.locator(`[data-testid="activity-job"][data-job="${drawId}"]`), 'a reload shows the same').toBeVisible();

  // Must not happen: the cancelled draw writing a file, or a second engine running at once.
  expect(await exists(join(first.dir, 'docs'))).toBe(false);
  await expect.poll(async () => (await activity(p)).slots.busy).toBe(0);
  // Kept for the keep time only (ARCHDRAW_JOB_KEEP_MS): then the draw is no longer listed and its id is gone.
  await expect.poll(async () => (await activity(p)).jobs.some((j: any) => j.id === drawId), { timeout: 90_000 }).toBe(false);
  expect((await p.get(`/api/runs/${drawId}`)).status).toBe(404);
  await expect(page.locator(`[data-testid="activity-job"][data-job="${drawId}"]`)).toHaveCount(0, { timeout: 20_000 });
});
