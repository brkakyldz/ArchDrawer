import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, finishRun, runEvents, listedDiagrams, exists } from './helpers';
import { ENGINE_LINES, scanThroughHome, drawRows, rowStates, messagesOf, readChoices } from './helpers-selections';
import { startedRetry, homeServer, tickOnHome } from './helpers-home';

const SLOW = 'Slow question [fixture:slow:second]';
const SLOW_ID = 'slow-question-fixture-slow-second';

// START-7, JOB-10, HOME-4, HOME-6 (api contract, *Deadlines, a choice that fails, and cancel*; ui contract `draw-cancel`, `draw-error`, `draw-retry`): the two
// choices of a draw run side by side, so cancelling while the second one is read (slowly) stops that choice and keeps the first
// done; nothing is written. The draw stays in its panel as cancelled: `Cancelled` in `draw-error`, the second row cancelled at its read
// stage, the first done, `Try again` and `Draw another project`, no choosing step, no `Cancel`. `Try again` draws every choice into a new
// file, the finished one from what was kept, with no engine call for it.
test('H247 [START-7 JOB-10 HOME-4 HOME-6 SCAN-3 #200 #202] cancelling a draw while its second choice is slow shows the first done and the second cancelled, writes nothing, and Try again draws both into a new file with the finished one from what was kept', async ({ page, request }) => {
  test.setTimeout(480_000);
  const project = await gitRepo('home-cancel-rows');
  const server = await homeServer(page, request, { stepMs: '300' });
  try {
    const listedBefore = (await listedDiagrams(request, server.base)).length;
    await scanThroughHome(page, project.dir, server.base);
    await tickOnHome(page, { whole: true, typed: SLOW }, 'linkedin');
    const run = await startedRun(page, () => page.getByTestId('draw-start').click());

    // Both start at once: the first is drawn in its own time, the second counts its lines every two seconds.
    await expect(page.getByTestId('draw-line')).toContainText(/Working \d+\/30/, { timeout: 120_000 });
    await expect.poll(async () => rowStates(await drawRows(page)), { timeout: 120_000 }).toEqual(['system:done', `${SLOW_ID}:running`]);
    await expect(page.getByTestId('draw-cancel')).toBeVisible();
    await page.getByTestId('draw-cancel').click();
    await finishRun(request, run.runId, 'cancelled', 60_000, server.base);

    // The draw as it ended: Cancelled in its panel, the rows as they stopped, the finished choice done, nothing written, no way to edit the ticks.
    await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId('draw-error')).toHaveText(/Cancelled/); await expect(page.getByTestId('draw-error')).toHaveAttribute('role', 'alert');
    await expect.poll(async () => rowStates(await drawRows(page))).toEqual(['system:done', `${SLOW_ID}:cancelled`]);
    const rows = await drawRows(page);
    expect(rows[0].stages.map(s => s.state)).toEqual(['done', 'done', 'done']);
    expect(rows[1].stages.map(s => [s.stage, s.state])).toEqual([['read', 'failed'], ['overview', 'waiting'], ['channel', 'waiting']]);
    await expect(page.getByTestId('draw-choice').nth(1).getByTestId('draw-choice-line')).toHaveText('Cancelled');
    await expect(page.getByTestId('draw-retry')).toHaveText('Try again'); await expect(page.getByTestId('draw-another')).toBeVisible();
    await expect(page.getByTestId('draw-cancel')).toHaveCount(0); await expect(page.getByTestId('draw-ready')).toHaveCount(0); await expect(page.getByTestId('job-notice')).toHaveCount(0);
    await expect(page.getByTestId('editor')).toHaveCount(0); await expect(page.getByTestId('focus-list')).toHaveCount(0);
    expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
    expect((await listedDiagrams(request, server.base)).length).toBe(listedBefore);
    const cancelled = await runEvents(run.runId, server.base);
    expect(cancelled.at(-1)!.data).toMatchObject({ status: 'cancelled', diagramId: null, path: null });
    expect(cancelled.at(-1)!.data.choices.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(['system:done', `${SLOW_ID}:cancelled`]);

    // Try again: every choice into a new file; the finished one from what was kept, the cancelled one read (slowly) again.
    const retry = await startedRetry(page, () => page.getByTestId('draw-retry').click());
    expect(retry.from).toBe(run.runId);
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 300_000 });
    const events = await runEvents(retry.runId, server.base);
    expect(messagesOf(events, 'system', 'read')).toContain('Using the facts already read');
    for (const line of ENGINE_LINES) expect(messagesOf(events, 'system'), `no engine call for the finished choice: "${line}"`).not.toContain(line);
    expect(messagesOf(events, SLOW_ID, 'read')).toContain('Reading the code');
    expect((await readChoices(join(project.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual(['system', SLOW_ID]);
    await page.waitForTimeout(800); await expect(page.getByTestId('editor'), 'the editor waits for Open').toHaveCount(0);
  } finally { await server.close(); }
});
