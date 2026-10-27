import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists, listedDiagrams } from './helpers';
import { watchPosts } from './helpers-selections';
import { homeServer, drawOnHome, rowFacts, jobsOnScreen, activityNow, stepper } from './helpers-home';

// JOB-9, HOME-7 (ui contract, `jobs-restarted`, *Following a job*; api contract, *A restart*): jobs live in the server's memory only. A page that
// was following a running draw when the server restarted says once `The server restarted; 1 job stopped`, lists no job any more
// (`Nothing is running.`), is back on the Folder step with its fields free (the job it followed answers 404), and the old ids are
// gone; nothing was written; a reload clears the notice, and the restarted server draws again.
test('H243 [JOB-9 HOME-7 #202] when the server restarts in the middle of a draw the page says once that 1 job stopped, lists none, frees the panel, and the restarted server draws again', async ({ page, request }) => {
  test.setTimeout(360_000);
  const project = await gitRepo('home-restart');
  const server = await homeServer(page, request, { stepMs: '700' });
  try {
    const posts = watchPosts(page);
    const run = await drawOnHome(page, server, project.dir, { whole: true, options: ['o2'] }, 'linkedin');
    await expect.poll(async () => (await rowFacts(page)).some(r => r.state === 'running')).toBe(true);
    await expect(page.getByTestId('jobs-restarted')).toHaveCount(0);
    const instance = (await activityNow(request, server.base)).instance; expect(instance).toMatch(/^[0-9a-f]{16}$/);
    const listed = (await listedDiagrams(request, server.base)).length;

    await server.restart();
    expect((await activityNow(request, server.base)).instance, 'a new server process').not.toBe(instance);
    await expect(page.getByTestId('jobs-restarted')).toHaveText('The server restarted; 1 job stopped', { timeout: 60_000 });
    await expect(page.getByTestId('activity-none')).toHaveText('Nothing is running.', { timeout: 30_000 });
    expect((await jobsOnScreen(page)).map(j => j.id), 'the stopped job is not listed any more').not.toContain(run.runId);

    // The followed job is gone: the panel follows nothing, on the Folder step, its fields free.
    await expect(page.getByTestId('draw-progress')).toHaveCount(0); await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-scan')).toBeEnabled();
    expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Folder'), nowCount: 1 });
    expect((await request.get(`${server.base}/api/runs/${run.runId}`)).status(), 'the old id is unknown').toBe(404);
    expect(await exists(join(project.dir, 'docs')), 'nothing was written').toBe(false); expect((await listedDiagrams(request, server.base)).length).toBe(listed);
    await page.waitForTimeout(5000); // the notice is said once: several polls later it is still the one sentence, not a count that grew
    await expect(page.getByTestId('jobs-restarted')).toHaveText('The server restarted; 1 job stopped');
    await page.reload(); await expect(page.getByTestId('home')).toBeVisible(); await expect(page.getByTestId('jobs-restarted')).toHaveCount(0);

    // The restarted server works: a new scan and a new draw (the old scan is gone with the old process).
    const again = await drawOnHome(page, server, project.dir, { whole: true }, 'readme');
    expect(again.runId).not.toBe(run.runId);
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(2); await expect(page.getByTestId('jobs-restarted')).toHaveCount(0);
  } finally { await server.close(); }
});
