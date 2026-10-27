import { test, expect } from '@playwright/test';
import { gitRepo } from './helpers';
import { SLUG, watchPosts } from './helpers-selections';
import { homeServer, drawOnHome, rowFacts, jobsOnScreen, jobIn, clock, activityNow } from './helpers-home';

// JOB-7, HOME-7, HOME-4 (ui contract, *Activity*, *Following a job*; api contract, *Activity*): the server lists what runs, so a reload in the
// middle of a draw of three choices finds the job in Activity and, followed, shows the same three rows going on from where they
// were (their times not restarted, what had finished still finished, the rest still running), and a second page does the same;
// the draw is never started twice and ends on Ready with its notice.
test('H242 [JOB-7 HOME-7 HOME-4 HOME-6 #202] reloading in the middle of a draw of three choices shows the same three rows going on, with their times and states kept, and a second page finds the job too', async ({ page, request }) => {
  test.setTimeout(360_000);
  const project = await gitRepo('home-reload');
  const server = await homeServer(page, request, { stepMs: '700' });
  try {
    const posts = watchPosts(page);
    const run = await drawOnHome(page, server, project.dir, { whole: true, options: ['o2', 'o1'] }, 'linkedin');
    await expect(page.getByTestId('draw-choice')).toHaveCount(3);
    await expect.poll(async () => clock((await rowFacts(page))[0].time), { timeout: 60_000 }).toBeGreaterThanOrEqual(4); // some seconds into the draw
    const before = await rowFacts(page);
    expect(before.some(r => r.state === 'running'), 'the draw is in the middle').toBe(true);
    const seconds = (rows: typeof before) => Object.fromEntries(rows.map(r => [r.choice, clock(r.time)]));
    const rank = (state: string) => ({ waiting: 0, running: 1, done: 2, failed: 2, cancelled: 2 } as Record<string, number>)[state];

    // Reload: Activity lists the job as running; following it shows the same three rows, not new ones.
    await page.reload(); await expect(page.getByTestId('home')).toBeVisible();
    await expect(jobIn(page, run.runId)).toBeVisible({ timeout: 30_000 }); await expect(jobIn(page, run.runId)).toHaveAttribute('data-type', 'draw');
    if ((await page.getByTestId('draw-progress').count()) === 0) await jobIn(page, run.runId).getByTestId('activity-job-name').click();
    await expect(page.getByTestId('draw-progress')).toBeVisible(); await expect(jobIn(page, run.runId)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('draw-choice')).toHaveCount(3); await expect(page.getByTestId('start-folder')).toBeDisabled(); await expect(page.getByTestId('start-folder')).toHaveValue(project.dir);
    const after = await rowFacts(page);
    expect(after.map(r => r.choice), 'the same rows in the same order').toEqual(['system', SLUG.o2, SLUG.o1]);
    for (const r of after) {
      const was = before.find(b => b.choice === r.choice)!;
      expect(rank(r.state), `${r.choice} did not go back from ${was.state}`).toBeGreaterThanOrEqual(rank(was.state));
      expect(seconds(after)[r.choice], `${r.choice}: its time was not restarted`).toBeGreaterThanOrEqual(seconds(before)[r.choice] - 1);
    }
    expect(after.some(r => r.state === 'running' || r.state === 'done'), 'the rows go on').toBe(true);
    expect(after.filter(r => r.state === 'running').every(r => r.stages.includes('running')), 'a running row shows its running stage').toBe(true);

    // A second page finds the same job and follows it from where it is.
    const other = await page.context().newPage();
    try {
      await other.goto(`${server.base}/`); await expect(other.getByTestId('home')).toBeVisible();
      await expect.poll(async () => (await jobsOnScreen(other)).find(j => j.id === run.runId)?.type, { timeout: 30_000 }).toBe('draw');
      await jobIn(other, run.runId).getByTestId('activity-job-name').click();
      await expect(other.getByTestId('draw-choice')).toHaveCount(3);
      expect(await other.getByTestId('draw-choice').evaluateAll(els => els.map(el => el.getAttribute('data-choice')))).toEqual(['system', SLUG.o2, SLUG.o1]);
    } finally { await other.close(); }

    // The draw ends once: the finished rows read as they would have, and the page that saw it running says it is ready.
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
    for (const r of await rowFacts(page)) expect(r).toMatchObject({ state: 'done', line: 'Drawn · 8 parts' });
    await expect(page.getByTestId('job-notice')).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId('editor')).toHaveCount(0);
    const jobs = (await activityNow(request, server.base)).jobs.filter(j => j.type === 'draw');
    expect(jobs.map(j => j.id), 'one draw, never started again').toEqual([run.runId]);
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
  } finally { await server.close(); }
});
