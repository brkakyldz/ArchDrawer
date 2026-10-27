import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { OPTIONS, SLUG, scanThroughHome, readChoices, where } from './helpers-selections';
import { homeServer, tickOnHome, rowFacts, recordRowFacts, recordedFacts, maxRunning, clock, jobsOnScreen, stepper, squash, runRecordAt } from './helpers-home';
import { startedRun } from './helpers';

// JOB-1, JOB-2, JOB-6, JOB-8, HOME-4, HOME-6 (ui contract, *Following a job*, `draw-choice`, `draw-ready`, `job-notice`): three choices of one
// draw run side by side in the three default slots, each row with its own stages, its time ticking every second, the engine's latest
// line with a pulse on each new one, the files read so far and, once its read is checked, the parts found; when all have ended
// the rows stay, `Ready` with `Open` replaces the line, a notice says the drawing is ready and the editor stays closed until Open.
test('H237 [JOB-1 JOB-2 JOB-6 JOB-8 HOME-4 HOME-6 STORY-1 #200 #202] three choices run side by side, each row with its stages, time, latest line, files read and parts found, and the draw ends on Ready with a notice and Activity, the editor opening only from Open', async ({ page, request }) => {
  test.setTimeout(90_000);
  const project = await gitRepo('home-side');
  const server = await homeServer(page, request, { stepMs: '400' });
  try {
    await scanThroughHome(page, project.dir, server.base);
    await tickOnHome(page, { whole: true, options: ['o2', 'o1'] }, 'linkedin');
    await recordRowFacts(page);
    const run = await startedRun(page, () => page.getByTestId('draw-start').click());
    expect(run.body.choices, 'the order of the list: the whole system, the sections, the flows').toEqual([{ kind: 'whole' }, { kind: 'option', option: 'o2' }, { kind: 'option', option: 'o1' }]);

    // One row per choice in the draw's order; the panel follows the draw and the choosing step is gone.
    await expect(page.getByTestId('draw-progress')).toBeVisible(); await expect(page.getByTestId('draw-choice')).toHaveCount(3);
    expect((await rowFacts(page)).map(r => r.choice)).toEqual(['system', SLUG.o2, SLUG.o1]);
    await expect(page.getByTestId('draw-choice').evaluateAll(els => els.map(el => el.getAttribute('data-kind')))).resolves.toEqual(['system', 'section', 'flow']);
    await expect(page.getByTestId('draw-choice-title').evaluateAll(els => els.map(el => (el.textContent ?? '').trim()))).resolves.toEqual(['The whole system', OPTIONS.o2.title, OPTIONS.o1.title]);
    await expect(page.getByTestId('draw-stage')).toHaveCount(9);
    await expect(page.getByTestId('focus-list')).toHaveCount(0); await expect(page.getByTestId('draw-start')).toHaveCount(0);
    await expect(page.getByTestId('start-folder')).toBeDisabled(); await expect(page.getByTestId('start-folder')).toHaveValue(project.dir);
    expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Draw'), nowCount: 1, done: 3 });
    await expect(page.getByTestId('draw-line')).toBeVisible(); await expect(page.getByTestId('draw-cancel')).toBeVisible(); await expect(page.getByTestId('draw-another')).toBeVisible();
    await expect(page.getByTestId('draw-choice').first().getByTestId('draw-choice-time')).toHaveText(/^\d+:\d{2}$/, { timeout: 30_000 }); // a running row counts its time
    const t0 = clock((await rowFacts(page))[0].time); await expect.poll(async () => clock((await rowFacts(page))[0].time) > t0 || (await rowFacts(page))[0].state !== 'running', { timeout: 15_000 }).toBe(true);

    // The end: Ready in place of the line, the rows shown once, Open, no retry, no cancel.
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 30_000 });
    expect(squash(await page.getByTestId('draw-ready').textContent())).toMatch(/^Ready.*3 drawings for a LinkedIn post/);
    await expect(page.getByTestId('draw-ready')).not.toContainText('could not be drawn'); await expect(page.getByTestId('draw-open')).toBeVisible();
    await expect(page.getByTestId('draw-retry')).toHaveCount(0); await expect(page.getByTestId('draw-line')).toHaveCount(0); await expect(page.getByTestId('draw-cancel')).toHaveCount(0);
    await expect(page.getByTestId('draw-choice')).toHaveCount(3); await expect(page.getByTestId('draw-error')).toHaveCount(0);
    const ended = await rowFacts(page);
    for (const r of ended) { expect(r.state).toBe('done'); expect(r.stages).toEqual(['done', 'done', 'done']); expect(r.line).toMatch(/^Drawn · 8 parts$/); expect(r.time).toMatch(/^\d+:\d{2}$/); }
    await page.waitForTimeout(1500);
    expect((await rowFacts(page)).map(r => r.time), 'a finished row stops counting').toEqual(ended.map(r => r.time));

    // What the rows showed on the way (recorded from the first change on).
    const seen = await recordedFacts(page);
    expect(maxRunning(seen), 'the three slots held three choices at once').toBe(3);
    for (const rows of seen) for (const r of rows) {
      const rank = (s: string) => s === 'done' ? 2 : s === 'running' || s === 'failed' ? 1 : 0;
      r.stages.forEach((s, k) => { if (rank(s) >= 1) for (let i = 0; i < k; i++) expect(r.stages[i], `${r.choice}: stage ${k + 1} never starts before stage ${i + 1} is done`).toBe('done'); });
    }
    const running = seen.flat().filter(r => r.state === 'running');
    expect(running.some(r => /^\d+:\d{2}$/.test(r.time)), 'a running row shows its time').toBe(true);
    expect(running.some(r => /Reading the (code|drawing)/.test(r.line)), 'a running row shows the engine\'s latest line').toBe(true);
    expect(running.some(r => r.events !== null && r.events >= 1), 'the pulse counts the events of its choice').toBe(true);
    expect(running.some(r => r.files === '2 files read'), 'the files read so far').toBe(true);
    expect(running.some(r => r.parts === '8 parts found' && r.files !== null), 'the parts found once the read is checked').toBe(true);

    // The notice, the editor still closed, and Activity: the job is Ready with Open.
    const notice = page.getByTestId('job-notice');
    await expect(notice).toHaveText(new RegExp(`${basename(project.dir)} is ready`)); await expect(notice).toHaveAttribute('role', 'status'); await expect(page.getByTestId('job-notice-open')).toHaveText('Open');
    await page.waitForTimeout(1000); await expect(page.getByTestId('editor'), 'nothing opens the editor by itself').toHaveCount(0);
    await expect(page.getByTestId('job-notice-dismiss')).toHaveAccessibleName('Dismiss'); await page.getByTestId('job-notice-dismiss').click(); await expect(notice).toHaveCount(0);
    await expect.poll(async () => (await jobsOnScreen(page)).find(j => j.id === run.runId)).toMatchObject({ type: 'draw', state: 'succeeded', status: 'LinkedIn post · Ready', current: true, open: 'Open' });
    await expect(page.getByTestId('activity-count')).toHaveCount(0); await expect(page.getByTestId('activity')).toContainText('Done');

    // Open: the editor on the first choice at the chosen channel, one file with the choices in the order asked, ids as if drawn in turn.
    await page.getByTestId('draw-open').click(); await expect(page.getByTestId('editor')).toBeVisible();
    expect(await where(page)).toMatchObject({ choice: 'system', channel: 'linkedin' }); await expect(page).toHaveURL(/\/d\/[^/?]+\?choice=system&channel=linkedin/);
    const record = await runRecordAt(request, server.base, run.runId);
    expect(record.choices.map((c: { id: string; status: string; parts: number }) => [c.id, c.status, c.parts])).toEqual([['system', 'done', 8], [SLUG.o2, 'done', 8], [SLUG.o1, 'done', 8]]);
    const doc = await readChoices(join(project.dir, 'docs', 'architecture.archdraw.json'));
    expect(doc.choices.map(c => c.id)).toEqual(['system', SLUG.o2, SLUG.o1]);
    expect(doc.choices[0].channels.linkedin!.views![0].id).toBe('linkedin');
    for (const c of doc.choices.slice(1)) { expect(c.channels.overview.views!.map(v => v.id)).toEqual([`${c.id}-overview`]); expect(c.channels.linkedin!.views![0].id).toBe(`${c.id}-linkedin`); }
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    expect((await project.git(['status', '--porcelain'])).trim()).toBe('?? docs/');
  } finally { await server.close(); }
});
