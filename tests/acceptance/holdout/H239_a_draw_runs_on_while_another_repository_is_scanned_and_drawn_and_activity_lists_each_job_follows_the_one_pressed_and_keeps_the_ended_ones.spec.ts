import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { SLUG, where, readChoices } from './helpers-selections';
import { homeServer, drawOnHome, tickOnHome, rowFacts, jobsOnScreen, jobIn, activityNow, openHome, stepper } from './helpers-home';
import { startedRun } from './helpers';

const CTRL_K = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

// JOB-5, JOB-7, HOME-7, HOME-10 (ui contract, *Activity*, `draw-another`, *The keyboard*): scans and draws of different repositories run at the
// same time and each has its row in Activity (running ones first, newest first; ended ones under `Done`, newest end first); `Draw another
// project`, and `Ctrl K` while a draw is followed, free the panel while the draw goes on; pressing a job makes the panel follow it; each
// draw writes into its own repository; a notice leaves by itself after about 8 s.
test('H239 [JOB-5 JOB-7 HOME-7 HOME-6 HOME-10 #202] a draw runs on while another repository is scanned and drawn, Activity lists each job and follows the one pressed, keeps the ended ones in order, and each drawing lands in its own repository', async ({ page, request }) => {
  test.setTimeout(120_000);
  const one = await gitRepo('home-two-a'), two = await gitRepo('home-two-b');
  const server = await homeServer(page, request, { stepMs: '1000' });
  try {
    // The first repository: one choice, a LinkedIn post. Then the panel is freed while the draw goes on.
    const first = await drawOnHome(page, server, one.dir, { options: ['o2'] }, 'linkedin');
    await expect(page.getByTestId('draw-choice')).toHaveCount(1);
    await page.getByTestId('draw-another').click();
    await expect(page.getByTestId('draw-progress')).toHaveCount(0); await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-folder')).toHaveValue('');
    expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Folder') });
    await expect.poll(async () => (await jobsOnScreen(page)).find(j => j.id === first.runId)).toMatchObject({ type: 'draw', state: 'running', current: false });

    // Ctrl K while a draw is followed: pressing the job follows it again; Ctrl K frees the panel and focuses the empty field; the draw goes on in Activity.
    await jobIn(page, first.runId).getByTestId('activity-job-name').click(); await expect(page.getByTestId('draw-progress')).toBeVisible();
    await page.keyboard.press(CTRL_K);
    await expect(page.getByTestId('draw-progress')).toHaveCount(0); await expect(page.getByTestId('start-folder')).toBeFocused(); await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-folder')).toHaveValue('');
    await expect(jobIn(page, first.runId)).toHaveCount(1);

    // The second repository is scanned while the first is drawn: both are running, newest first.
    await page.getByTestId('start-folder').fill(two.dir); await page.getByTestId('start-scan').click();
    await expect.poll(async () => { const jobs = await jobsOnScreen(page); return `${jobs.find(j => j.type === 'scan' && j.name !== '' && j.state === 'running') ? 'scan' : ''}+${jobs.find(j => j.id === first.runId)?.state}`; }, { timeout: 30_000 }).toBe('scan+running');
    await expect(page.getByTestId('activity-count')).toHaveText('2 running');
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('scan-card-name')).toHaveText(basename(two.dir));
    await expect(jobIn(page, first.runId)).toHaveAttribute('data-state', 'running'); // the first draw never waited for the scan

    // The second draw: the whole system as a README, started while the first still runs.
    await tickOnHome(page, { whole: true }, 'readme');
    const second = await startedRun(page, () => page.getByTestId('draw-start').click());
    await expect(page.getByTestId('draw-choice')).toHaveCount(1); await expect(page.getByTestId('draw-choice')).toHaveAttribute('data-choice', 'system');
    await expect.poll(async () => (await jobsOnScreen(page)).filter(j => j.type === 'draw' && j.state === 'running').length, { timeout: 30_000 }).toBe(2);
    const both = await jobsOnScreen(page);
    expect(both.find(j => j.id === first.runId)!.status).toMatch(/^LinkedIn post · /); expect(both.find(j => j.id === second.runId)!.status).toMatch(/^README drawing · /);
    expect(both.find(j => j.id === first.runId)!.name).toBe(basename(one.dir)); expect(both.find(j => j.id === second.runId)!.name).toBe(basename(two.dir));
    expect(both.map(j => j.id).indexOf(second.runId), 'newest first').toBeLessThan(both.map(j => j.id).indexOf(first.runId));
    await expect(page.getByTestId('activity-count')).toHaveText('2 running');

    // Pressing the first job moves the panel to it (its choice, its channel); pressing the second moves it back.
    await jobIn(page, first.runId).getByTestId('activity-job-name').click();
    await expect(jobIn(page, first.runId)).toHaveAttribute('aria-current', 'true'); await expect(jobIn(page, second.runId)).not.toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => (await rowFacts(page)).map(r => r.choice)).toEqual([SLUG.o2]);
    await expect(page.getByTestId('draw-stage').nth(2)).toContainText('Drawing the LinkedIn post');
    await jobIn(page, second.runId).getByTestId('activity-job-name').click();
    await expect.poll(async () => (await rowFacts(page)).map(r => r.choice)).toEqual(['system']); await expect(page.getByTestId('draw-stage').nth(2)).toContainText('Drawing the README drawing');

    // Both end: Ready on each, the ended ones under Done, newest end first; the notices go by themselves.
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await jobsOnScreen(page)).filter(j => j.type === 'draw' && j.state === 'succeeded').length, { timeout: 60_000 }).toBe(2);
    await expect(page.getByTestId('activity-count')).toHaveCount(0); await expect(page.getByTestId('activity')).toContainText('Done');
    const api = await activityNow(request, server.base);
    const byEnd = api.jobs.filter(j => j.endedAt).sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)).map(j => j.id);
    await expect.poll(async () => (await jobsOnScreen(page)).map(j => j.id), { message: 'Done lists the ended jobs, newest end first' }).toEqual(byEnd);
    await expect(page.getByTestId('job-notice')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('editor')).toHaveCount(0);

    // Each repository got its own drawing; the editor opens from the first job's Open on its own choice.
    expect((await readChoices(join(one.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual([SLUG.o2]);
    const written = await readChoices(join(two.dir, 'docs', 'architecture.archdraw.json'));
    expect(written.choices.map(c => c.id)).toEqual(['system']); expect(written.choices[0].channels.readme?.views).toHaveLength(1); expect(written.choices[0].channels.linkedin?.views ?? []).toEqual([]);
    expect(await exists(join(one.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    await jobIn(page, first.runId).getByTestId('activity-open').click();
    await expect(page.getByTestId('editor')).toBeVisible(); expect(await where(page)).toMatchObject({ choice: SLUG.o2, channel: 'linkedin' });
    await openHome(page, server); await expect(page.getByTestId('library-item')).toHaveCount(3); // the seeded drawing and one for each repository
  } finally { await server.close(); }
});
