import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { tabTo, postJSON, startedRun } from './helpers';
import { watchPosts } from './helpers-selections';
import { homeServer, openHome, makeRepo } from './helpers-home';

const CTRL_K = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

// HOME-10, HOME-2 (ui contract, *The keyboard*, `start-folder`): every control is reached with Tab in the order of the screen (the top bar,
// the navigation, the panel, the drawings, the side column); `Ctrl K` selects This computer and focuses the folder search from the
// Link tab; ArrowDown and Enter take the entry (which scans nothing), the next Enter on Scan scans; on the choosing step Space ticks and
// chooses and Enter on a focused destination presses the draw button once it is enabled (and does nothing before); `Ctrl K`
// while a draw is followed frees the panel and focuses the field while the draw goes on.
test('H245 [HOME-10 HOME-2 START-4 #200 #201] the home screen works from the keyboard in the order of the screen, Ctrl K finds the folder search, Enter takes an entry and scans, and Enter on a destination draws once it can', async ({ page, request }) => {
  test.setTimeout(300_000);
  const server = await homeServer(page, request, { stepMs: '500' });
  try {
    const alpha = await makeRepo(join(server.home, 'code', 'alpha-app'));
    const posts = watchPosts(page);
    await openHome(page, server);
    await expect.poll(async () => await page.getByTestId('source-found').getByTestId('source-item').count(), { timeout: 60_000 }).toBe(1);

    // The order of Tab: top bar, navigation, the panel (field, then Scan), the drawings, the side column.
    const stop = () => page.evaluate(() => {
      const a = document.activeElement; if (!a || a === document.body) return null;
      const within = (id: string) => !!a.closest(`[data-testid="${id}"]`);
      const zone = within('home-nav') ? 'nav' : within('start') ? 'start' : within('library') ? 'library' : (within('activity') || within('home-continue') || within('start-engine') || within('scan-card')) ? 'side' : 'other';
      return { zone, id: (a.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? '' };
    });
    const stops: { zone: string; id: string }[] = [];
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    for (let i = 0; i < 90; i++) { await page.keyboard.press('Tab'); const s = await stop(); if (s) stops.push(s); if (s?.id === 'ai-model') break; }
    const first = (zone: string) => stops.findIndex(s => s.zone === zone);
    expect(first('other'), 'the top bar comes first').toBe(0);
    expect(first('nav')).toBeGreaterThan(first('other')); expect(first('start')).toBeGreaterThan(first('nav')); expect(first('library')).toBeGreaterThan(first('start')); expect(first('side')).toBeGreaterThan(first('library'));
    const idx = (id: string) => stops.findIndex(s => s.id === id);
    expect(idx('home-nav-drawings')).toBeLessThan(idx('home-nav-new')); expect(idx('home-nav-new')).toBeLessThan(idx('start-folder')); expect(idx('start-folder')).toBeLessThan(idx('start-scan'));
    const known = stops.filter(s => s.zone !== 'other'); const rank: Record<string, number> = { nav: 1, start: 2, library: 3, side: 4 };
    known.forEach((s, i) => { if (i) expect(rank[s.zone], `${s.id} after ${known[i - 1].id}`).toBeGreaterThanOrEqual(rank[known[i - 1].zone]); });
    expect(stops.some(s => s.id === 'ai-engine')).toBe(true);

    // Ctrl K from the Link tab: This computer, the field focused; ArrowDown and Enter take the entry and scan nothing; Enter on Scan scans.
    await page.getByTestId('start-source-link').click(); await expect(page.getByTestId('start-link')).toBeVisible();
    await page.keyboard.press(CTRL_K);
    await expect(page.getByTestId('start-folder')).toBeVisible(); await expect(page.getByTestId('start-folder')).toBeFocused(); await expect(page.getByTestId('start-link')).toBeHidden();
    await page.keyboard.type('alpha'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(page.getByTestId('start-folder')).toHaveValue(alpha.dir); await expect(page.getByTestId('start-scan')).toBeFocused();
    await page.waitForTimeout(500); expect(posts.filter(p => p.path === '/api/scans'), 'taking an entry scans nothing').toEqual([]);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 }); expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(1);

    // The choosing step: Space ticks; Enter before a destination is chosen does nothing; Space chooses; Enter on the destination draws.
    await tabTo(page, 'focus-whole'); await page.keyboard.press('Space'); await expect(page.getByTestId('focus-whole')).toBeChecked();
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    expect(posts.filter(p => p.path === '/api/runs'), 'Enter does not draw while the draw button is off').toEqual([]);
    await tabTo(page, 'channel-choice-linkedin'); await page.keyboard.press('Space'); await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(page.getByTestId('draw-start')).toBeEnabled();
    const run = await startedRun(page, () => page.keyboard.press('Enter'));
    expect(run.body).toMatchObject({ kind: 'draw', channel: 'linkedin', choices: [{ kind: 'whole' }] }); await expect(page.getByTestId('draw-progress')).toBeVisible();

    // Ctrl K while the draw is followed: the panel is free and the field focused; the draw goes on in Activity.
    await page.keyboard.press(CTRL_K);
    await expect(page.getByTestId('draw-progress')).toHaveCount(0); await expect(page.getByTestId('start-folder')).toBeFocused(); await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-folder')).toHaveValue('');
    await expect(page.locator(`[data-testid="activity-job"][data-job="${run.runId}"]`)).toHaveCount(1);
    expect((await postJSON(request, server.token, `/api/runs/${run.runId}/cancel`, {}, server.base)).status).toBe(200);
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
  } finally { await server.close(); }
});
