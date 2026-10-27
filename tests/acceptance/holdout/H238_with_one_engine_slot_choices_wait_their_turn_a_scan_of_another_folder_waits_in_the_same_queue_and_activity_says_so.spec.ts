import { test, expect } from '@playwright/test';
import { gitRepo, startScan, scanRecord, startedRun } from './helpers';
import { scanThroughHome, runRecord } from './helpers-selections';
import { homeServer, tickOnHome, rowFacts, recordRowFacts, recordedFacts, maxRunning, jobsOnScreen, jobIn } from './helpers-home';

// JOB-1, JOB-5, HOME-4, HOME-7 (ui contract, `draw-choice-line`, `scan-progress`, `activity-job`; api contract, *Engine slots*): with one slot
// (ARCHDRAW_ENGINE_SLOTS=1) a draw of three choices runs them one after another, the others saying `Waiting for a free engine`
// with all three stages waiting and no time; a scan of another folder asked meanwhile waits in the same queue, behind the draw's choices,
// and says so in Activity and in the panel when followed; pressing jobs in Activity moves the panel between them while all go on;
// the finished draw is opened from its Activity row. No job ever runs two engines past the slot limit.
test('H238 [JOB-1 JOB-5 HOME-4 HOME-7 #202] with one engine slot the choices wait their turn and say so, a scan of another folder waits in the same queue and Activity and the panel say so, and pressing jobs moves the panel between them', async ({ page, request }) => {
  test.setTimeout(360_000);
  const first = await gitRepo('home-wait-a'), second = await gitRepo('home-wait-b');
  const server = await homeServer(page, request, { stepMs: '400', slots: 1 });
  try {
    await scanThroughHome(page, first.dir, server.base);
    await tickOnHome(page, { whole: true, options: ['o2', 'o1'] }, 'linkedin');
    await recordRowFacts(page);
    const run = await startedRun(page, () => page.getByTestId('draw-start').click());
    await expect(page.getByTestId('activity-keep')).toHaveText('Keeps going if you reload. Up to 1 at once.');

    // One choice runs; the others wait, with their stages waiting, no time and the sentence for a free engine.
    await expect.poll(async () => (await rowFacts(page)).map(r => r.state), { timeout: 30_000 }).toEqual(['running', 'waiting', 'waiting']);
    const waiting = await rowFacts(page);
    for (const r of waiting.slice(1)) expect(r).toMatchObject({ line: 'Waiting for a free engine', time: '', stages: ['waiting', 'waiting', 'waiting'] });
    await expect(page.getByTestId('draw-choice').nth(1).getByTestId('draw-choice-pulse')).toHaveCount(0);

    // A scan of another folder, asked while the draw holds the slot: it waits behind all three choices.
    const scanId = await startScan(request, server.token, second.dir, {}, server.base);
    await expect.poll(async () => (await jobsOnScreen(page)).find(j => j.id === scanId)?.state, { timeout: 30_000 }).toBe('waiting');
    const jobs = await jobsOnScreen(page);
    expect(jobs.find(j => j.id === scanId)).toMatchObject({ type: 'scan', status: 'Waiting for a free engine' });
    expect(jobs.find(j => j.id === run.runId)).toMatchObject({ type: 'draw', state: 'running', current: true });
    expect(jobs.filter(j => j.state !== 'succeeded').map(j => j.id), 'the running ones, newest first').toEqual([scanId, run.runId]);
    await expect(page.getByTestId('activity-count'), 'a waiting job is not counted as running').toHaveText('1 running');

    // Following the waiting scan: the panel says it waits; the draw goes on in Activity.
    await jobIn(page, scanId).getByTestId('activity-job-name').click();
    await expect(jobIn(page, scanId)).toHaveAttribute('aria-current', 'true'); await expect(jobIn(page, run.runId)).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('draw-progress')).toHaveCount(0);
    const progress = page.getByTestId('scan-progress');
    if ((await jobIn(page, scanId).getAttribute('data-state')) === 'waiting') await expect(progress).toContainText('Waiting for a free engine');
    const seen = await recordedFacts(page);
    expect(maxRunning(seen), 'one slot: never two choices at once').toBe(1);
    expect(seen.some(rows => rows.some(r => r.state === 'done') && rows.some(r => r.state === 'running')), 'the second choice ran after the first was done').toBe(true);

    // The scan gets the slot after the draw's choices and succeeds: the panel shows its card and choices.
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 240_000 }); await expect(page.getByTestId('focus-list')).toBeVisible();
    await expect(page.getByTestId('scan-card-name')).toHaveText(second.dir.replace(/\\/g, '/').split('/').at(-1)!);
    const drawRecord = await runRecord(request, run.runId, server.base);
    const scanDone = await scanRecord(request, scanId, server.base) as any;
    const lastEnd = Math.max(...drawRecord.choices.map((c: { endedAt: string | null }) => Date.parse(c.endedAt ?? '')));
    if (drawRecord.status === 'running' || drawRecord.status === 'succeeded') expect(Date.parse(scanDone.startedAt), 'the scan took its slot after the choices queued before it').toBeGreaterThanOrEqual(lastEnd - 100);

    // Back to the draw by its row, then Open from Activity (the editor opens only when asked).
    await jobIn(page, run.runId).getByTestId('activity-job-name').click(); await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
    const after = await jobsOnScreen(page);
    expect(after.find(j => j.id === scanId)).toMatchObject({ state: 'succeeded', status: 'Scan · 3 sections and flows', open: 'Choose' });
    expect(after.find(j => j.id === run.runId)).toMatchObject({ state: 'succeeded', status: 'LinkedIn post · Ready', open: 'Open' });
    await expect(page.getByTestId('editor')).toHaveCount(0);
    await jobIn(page, run.runId).getByTestId('activity-open').click(); await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'system');
  } finally { await server.close(); }
});
