import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists, listedDiagrams, startedRun } from './helpers';
import { scanThroughHome, watchPosts, readChoices, where } from './helpers-selections';
import { homeServer, tickOnHome, rowFacts, jobsOnScreen, startedRetry, runRecordAt, squash } from './helpers-home';

const FLAKY = 'Billing [fixture:flaky:second]';
const FLAKY_ID = 'billing-fixture-flaky-second';

// JOB-3, JOB-8, START-7, HOME-6 (ui contract, `draw-ready`, `draw-retry`; api contract, *Trying again*): when one choice of a draw fails the
// others go on and are written; the draw is Ready (not failed) with the failed choice marked in its row, in the Ready line and in
// Activity, and `Try again` there draws only the failed choice into the same file, through the retry endpoint (no new draw, no
// new scan), ending on a Ready that opens the same drawing on the choice it added.
test('H240 [JOB-3 JOB-8 START-7 HOME-6 STORY-1 #202] when one choice fails the others are written and Ready offers Try again, which draws the failed choice into the same file and opens the same drawing', async ({ page, request }) => {
  test.setTimeout(360_000);
  const project = await gitRepo('home-partial');
  const server = await homeServer(page, request, { stepMs: '300' });
  try {
    const posts = watchPosts(page);
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    await scanThroughHome(page, project.dir, server.base);
    await tickOnHome(page, { whole: true, typed: FLAKY }, 'linkedin');
    const first = await startedRun(page, () => page.getByTestId('draw-start').click());

    // The draw succeeds with a failed choice: Ready says so, the rows tell which, nothing is an error of the whole draw.
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
    expect(squash(await page.getByTestId('draw-ready').textContent())).toMatch(/^Ready.*1 drawing for a LinkedIn post · 1 could not be drawn/);
    await expect(page.getByTestId('draw-retry')).toHaveText('Try again'); await expect(page.getByTestId('draw-open')).toBeVisible(); await expect(page.getByTestId('draw-error')).toHaveCount(0);
    const rows = await rowFacts(page);
    expect(rows.map(r => [r.choice, r.state])).toEqual([['system', 'done'], [FLAKY_ID, 'failed']]);
    expect(rows[0]).toMatchObject({ line: 'Drawn · 8 parts', stages: ['done', 'done', 'done'] });
    expect(rows[1]).toMatchObject({ line: 'Could not draw: Fixture failure requested', stages: ['failed', 'waiting', 'waiting'] });
    expect((await jobsOnScreen(page)).find(j => j.id === first.runId)).toMatchObject({ state: 'succeeded', status: 'LinkedIn post · Ready, 1 failed', open: 'Open' });
    const firstRecord = await runRecordAt(request, server.base, first.runId);
    expect(firstRecord).toMatchObject({ status: 'succeeded', error: null }); expect(firstRecord.choices.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(['system:done', `${FLAKY_ID}:failed`]);
    const before = await readChoices(file); expect(before.choices.map(c => c.id), 'the file holds the choice that finished only').toEqual(['system']);
    expect((await listedDiagrams(request, server.base)).length).toBe(2); await expect(page.getByTestId('editor')).toHaveCount(0);

    // Try again: the retry endpoint, no new draw and no new scan; one row, the failed choice; it ends on its own Ready.
    const scans = posts.filter(p => p.path === '/api/scans').length;
    const retry = await startedRetry(page, () => page.getByTestId('draw-retry').click());
    expect(retry.from).toBe(first.runId); expect(retry.runId).not.toBe(first.runId);
    expect(posts.filter(p => p.path === '/api/runs'), 'Try again is not a new draw request').toHaveLength(1); expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(scans);
    await expect.poll(async () => (await rowFacts(page)).map(r => r.choice)).toEqual([FLAKY_ID]);
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
    expect(squash(await page.getByTestId('draw-ready').textContent())).toMatch(/^Ready.*1 drawing for a LinkedIn post$/);
    await expect(page.getByTestId('draw-ready')).not.toContainText('could not be drawn'); await expect(page.getByTestId('draw-retry')).toHaveCount(0);
    expect((await rowFacts(page)).map(r => [r.choice, r.state, r.line])).toEqual([[FLAKY_ID, 'done', 'Drawn · 8 parts']]);

    // The same file now holds both; the first choice is exactly as it was; no second file, no second library entry.
    const secondRecord = await runRecordAt(request, server.base, retry.runId);
    expect(secondRecord).toMatchObject({ status: 'succeeded', retryOf: first.runId, into: firstRecord.diagramId, diagramId: firstRecord.diagramId, choice: FLAKY_ID });
    const after = await readChoices(file);
    expect(after.choices.map(c => c.id)).toEqual(['system', FLAKY_ID]); expect(after.choices[0]).toEqual(before.choices[0]);
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false); expect((await listedDiagrams(request, server.base)).length).toBe(2);
    await page.waitForTimeout(1000); await expect(page.getByTestId('editor'), 'the editor still waits for Open').toHaveCount(0);
    await page.getByTestId('draw-open').click(); await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/d/${firstRecord.diagramId}\\?choice=${FLAKY_ID}&channel=linkedin`)); expect(await where(page)).toMatchObject({ choice: FLAKY_ID, channel: 'linkedin' });
  } finally { await server.close(); }
});
