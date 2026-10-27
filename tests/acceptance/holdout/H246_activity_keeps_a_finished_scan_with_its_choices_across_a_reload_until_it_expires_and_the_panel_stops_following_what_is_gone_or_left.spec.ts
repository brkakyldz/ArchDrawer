import { test, expect } from '@playwright/test';
import { basename } from 'node:path';
import { gitRepo } from './helpers';
import { OPTIONS, watchPosts, optionsOnScreen } from './helpers-selections';
import { homeServer, openHome, jobsOnScreen, jobIn, stepper } from './helpers-home';

// JOB-7, HOME-7 (ui contract, *Following a job*, *Activity*, `activity-open`, `activity-keep`; testing contract, `ARCHDRAW_JOB_KEEP_MS`,
// `ARCHDRAW_ENGINE_SLOTS`): Activity says when nothing runs and how many may at once; a finished scan stays in it with its card and
// choices, so after a reload `Choose` goes back to the choosing step without scanning again; when the kept job is gone from the
// list the panel that followed it follows nothing and is free; `New drawing` frees the panel while the job it left stays listed.
test('H246 [JOB-7 HOME-7 #202] Activity keeps a finished scan with its choices across a reload so Choose goes back to choosing, and the panel stops following a job that has left the list or that the user leaves', async ({ page, request }) => {
  test.setTimeout(300_000);
  const project = await gitRepo('home-keep');
  const server = await homeServer(page, request, { stepMs: '300', slots: 2, keepMs: 20_000 });
  try {
    const posts = watchPosts(page);
    await openHome(page, server);
    await expect(page.getByTestId('activity-none')).toHaveText('Nothing is running.'); await expect(page.getByTestId('activity-keep')).toHaveText('Keeps going if you reload. Up to 2 at once.');

    // A scan from the panel: its row says what it found; the panel follows it.
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
    const scanId = (await jobsOnScreen(page)).find(j => j.type === 'scan')!.id;
    await expect.poll(async () => (await jobsOnScreen(page)).find(j => j.id === scanId)).toMatchObject({ state: 'succeeded', status: 'Scan · 3 sections and flows', name: basename(project.dir), current: true, open: 'Choose' });
    const choices = await optionsOnScreen(page);

    // A reload loses the panel, not the job: the row is there, and Choose brings back the card and the same choices with no new scan.
    await page.reload(); await expect(page.getByTestId('home')).toBeVisible();
    await expect(jobIn(page, scanId)).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId('activity-none')).toBeVisible();
    await expect(jobIn(page, scanId).getByTestId('activity-open')).toHaveText('Choose');
    if ((await page.getByTestId('focus-list').count()) === 0) await jobIn(page, scanId).getByTestId('activity-open').click();
    await expect(page.getByTestId('focus-list')).toBeVisible(); await expect(page.getByTestId('scan-card-name')).toHaveText(basename(project.dir));
    expect(await optionsOnScreen(page)).toEqual(choices); await expect(page.getByTestId('focus-option').first()).toContainText(OPTIONS.o2.title);
    await expect(page.getByTestId('start-folder')).toBeDisabled(); await expect(page.getByTestId('start-folder')).toHaveValue(project.dir);
    expect(posts.filter(p => p.path === '/api/scans'), 'going back to choosing scans nothing').toHaveLength(1);

    // The job leaves the list once its keeping time is over: the panel that followed it follows nothing and is free.
    await expect(jobIn(page, scanId)).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId('activity-none')).toBeVisible(); await expect(page.getByTestId('focus-list')).toHaveCount(0); await expect(page.getByTestId('scan-card')).toHaveCount(0);
    await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-scan')).toBeEnabled();
    expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Folder'), nowCount: 1, done: 0 });

    // A new look at the same commit is cached and listed again; New drawing leaves it: the fields are emptied, the job stays listed.
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-cached')).toContainText('Scanned before at ', { timeout: 60_000 });
    const second = (await jobsOnScreen(page)).find(j => j.type === 'scan')!; expect(second.id).not.toBe(scanId);
    await page.getByTestId('home-nav-new').click();
    await expect(page.getByTestId('start-folder')).toHaveValue(''); await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-folder')).toBeFocused();
    await expect(page.getByTestId('focus-list')).toHaveCount(0); expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Folder') });
    await expect(jobIn(page, second.id)).toHaveCount(1); await expect(jobIn(page, second.id)).not.toHaveAttribute('aria-current', 'true');
    expect(posts.filter(p => p.path === '/api/runs')).toEqual([]);
  } finally { await server.close(); }
});
