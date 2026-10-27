import { test, expect } from '@playwright/test';
import { gitRepo } from './helpers';
import { scanThroughHome } from './helpers-selections';
import { homeServer, tickOnHome, rowFacts, jobsOnScreen } from './helpers-home';
import { startedRun } from './helpers';

const QUIET = 'Quiet one [fixture:quiet]';
const QUIET_ID = 'quiet-one-fixture-quiet';

// HOME-5, JOB-6 (ui contract, `draw-choice-quiet`, `activity-job-status`; testing contract, `[fixture:quiet]`): the fixture's read says nothing for 45 s
// after its `Reading the code` line. The choice stays `running`, but once 30 s have passed since the engine's last line its row says
// `Quiet for <s> s — still running (limit <m> min)` with `<m>` from the server's time limit (here 10 min), counting up every second,
// and Activity says `quiet for <s> s`; the other choice, which is finished, is not called quiet; the sentence goes when the engine
// speaks again and the draw ends well. Nothing fails or times out.
test('H244 [HOME-5 JOB-6 #202] a choice whose engine says nothing for 30 seconds shows Quiet for with the limit of the server, counting up, Activity says so too, and it goes with the next line without any failure', async ({ page, request }) => {
  test.setTimeout(180_000);
  const project = await gitRepo('home-quiet');
  const server = await homeServer(page, request, { stepMs: '400', timeoutMs: 600_000 });
  try {
    await scanThroughHome(page, project.dir, server.base);
    await tickOnHome(page, { whole: true, typed: QUIET }, 'linkedin');
    const run = await startedRun(page, () => page.getByTestId('draw-start').click());
    const row = page.locator(`[data-testid="draw-choice"][data-choice="${QUIET_ID}"]`);
    await expect(row).toHaveAttribute('data-state', 'running', { timeout: 30_000 });
    await expect(page.getByTestId('draw-choice-quiet'), 'no choice is quiet while its engine speaks').toHaveCount(0);

    // Thirty seconds of silence: the sentence, with the limit from the server's time limit; the finished choice is not quiet.
    const quiet = row.getByTestId('draw-choice-quiet');
    await expect(quiet).toBeVisible({ timeout: 45_000 });
    const sentence = /^Quiet for (\d+) s — still running \(limit 10 min\)$/;
    const text1 = (await quiet.textContent())!.replace(/\s+/g, ' ').trim(); expect(text1).toMatch(sentence);
    const s1 = Number(sentence.exec(text1)![1]); expect(s1).toBeGreaterThanOrEqual(30); expect(s1).toBeLessThan(46);
    await expect(row).toHaveAttribute('data-state', 'running');
    await expect.poll(async () => { const t = (await quiet.textContent().catch(() => null)) ?? ''; const m = sentence.exec(t.replace(/\s+/g, ' ').trim()); return m ? Number(m[1]) : 0; }, { timeout: 8_000, message: 'it counts up every second' }).toBeGreaterThan(s1);
    await expect.poll(async () => (await jobsOnScreen(page)).find(j => j.id === run.runId)?.status, { message: 'Activity says so too' }).toMatch(/quiet for \d+ s/i);
    const rows = await rowFacts(page); expect(rows.find(r => r.choice === 'system')!.quiet, 'a choice that is done is not quiet').toBeNull();

    // The engine speaks again: the sentence goes, the row is not failed, and the draw ends with both choices drawn.
    await expect(quiet).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 30_000 });
    expect((await rowFacts(page)).map(r => [r.choice, r.state])).toEqual([['system', 'done'], [QUIET_ID, 'done']]);
    await expect(page.getByTestId('draw-ready')).toContainText('2 drawings for a LinkedIn post'); await expect(page.getByTestId('draw-error')).toHaveCount(0);
    await expect.poll(async () => (await jobsOnScreen(page)).find(j => j.id === run.runId)?.status).toBe('LinkedIn post · Ready');
  } finally { await server.close(); }
});
