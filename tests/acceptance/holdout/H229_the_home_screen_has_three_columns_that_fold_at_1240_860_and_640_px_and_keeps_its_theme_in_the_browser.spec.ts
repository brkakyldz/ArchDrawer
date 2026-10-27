import { test, expect } from '@playwright/test';
import { box, gitRepo, scanFolder, postJSON } from './helpers';
import { typed, startDrawChoices } from './helpers-selections';
import { homeServer, openHome, stepper, squash } from './helpers-home';

// HOME-1, HOME-11, HOME-12 (ui contract, *Home*, *Columns*, *Frame*): three columns (the navigation, the work column with the panel
// over the drawings, the side column with Activity and the engine); the side column goes under the work column at 1240 px with
// `activity-toggle` for what runs, the navigation becomes one row at 860, everything one column at 640 with only the current step's
// name; the theme is the browser's own once chosen. No process guide or footer line.
test('H229 [HOME-1 HOME-11 HOME-12 #200] the home screen has three columns that fold at 1240, 860 and 640 px, shows the stepper and Activity, and keeps the theme chosen in the browser over the system one', async ({ page, request }) => {
  test.setTimeout(240_000);
  const project = await gitRepo('home-frame');
  const server = await homeServer(page, request, { library: ['Library shop', 'Second shop'] });
  try {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
    await openHome(page, server);

    // Three columns: the navigation (236 px), the panel over the drawings, then Activity and the engine in the side column.
    const nav = await box(page.getByTestId('home-nav')), start = await box(page.getByTestId('start'));
    const library = await box(page.getByTestId('library')), activity = await box(page.getByTestId('activity')), engine = await box(page.getByTestId('start-engine'));
    expect(Math.abs(nav.width - 236), 'the navigation column is 236 px wide').toBeLessThanOrEqual(4);
    expect(nav.x + nav.width).toBeLessThanOrEqual(start.x + 2); expect(start.x + start.width).toBeLessThanOrEqual(activity.x + 2);
    expect(library.y).toBeGreaterThan(start.y + start.height - 2); expect(library.x).toBeGreaterThanOrEqual(start.x - 2);
    expect(Math.abs(engine.x - activity.x), 'Activity and the engine share the side column').toBeLessThanOrEqual(2); expect(engine.y).toBeGreaterThan(activity.y);
    await expect(page.getByTestId('home-continue')).toBeVisible(); await expect(page.getByTestId('home-continue-open')).toBeVisible();
    expect((await box(page.getByTestId('home-continue'))).y, 'Continue sits between Activity and the engine').toBeLessThan(engine.y);

    // What the columns hold: the navigation, the stepper's four names, the engine chip and an idle Activity.
    await expect(page.getByTestId('home-nav-drawings')).toContainText('Drawings'); await expect(page.getByTestId('home-nav-drawings')).toContainText('2');
    await expect(page.getByTestId('library-count')).toHaveText('2'); await expect(page.getByTestId('home-nav-new')).toHaveText('New drawing');
    await expect(page.getByTestId('home-server')).toHaveText(new URL(server.base).host);
    await expect(page.getByTestId('start')).toContainText('Draw a project');
    const steps = page.getByTestId('start-steps');
    for (const name of ['Folder', 'Focus', 'Destination', 'Draw']) await expect(steps).toContainText(name);
    expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Folder'), nowCount: 1, done: 0 });
    const label = await page.getByTestId('ai-engine').evaluate(el => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');
    expect(squash(await page.getByTestId('home-engine-chip').textContent())).toBe(`Engine ${squash(label)}`);
    await expect(page.getByTestId('activity')).toContainText('Activity'); await expect(page.getByTestId('activity-none')).toHaveText('Nothing is running.');
    await expect(page.getByTestId('activity-count')).toHaveCount(0); await expect(page.getByTestId('activity-keep')).toHaveText('Keeps going if you reload. Up to 3 at once.');
    await expect(page.getByTestId('activity-toggle')).toHaveCount(0);
    const text = squash(await page.getByTestId('home').innerText());
    expect(text, 'no step counter').not.toMatch(/\bstep \d+ of \d+\b/i); expect(text, 'no footer line').not.toMatch(/all rights reserved|©/i);

    // 1240 px: the side column goes under the work column, and `activity-toggle` names what runs once something does.
    const scan = await scanFolder(request, server.token, project.dir, {}, server.base);
    const runId = await startDrawChoices(request, server.token, scan.id, [typed('Slow part [fixture:slow]')], 'linkedin', {}, server.base);
    await page.setViewportSize({ width: 1240, height: 900 });
    await expect(page.getByTestId('activity-toggle')).toHaveText('1 running', { timeout: 30_000 });
    const folded = await box(page.getByTestId('activity')), foldedStart = await box(page.getByTestId('start'));
    expect(folded.y, 'Activity is under the work column').toBeGreaterThan(foldedStart.y + foldedStart.height - 2); expect(folded.x).toBeLessThan(foldedStart.x + foldedStart.width);
    await page.getByTestId('activity-toggle').click();
    await expect.poll(async () => { const b = await box(page.getByTestId('activity')); return b.y >= -2 && b.y < 900; }, { message: 'pressing the toggle scrolls Activity into view' }).toBe(true);
    expect((await postJSON(request, server.token, `/api/runs/${runId}/cancel`, {}, server.base)).status).toBe(200);
    await expect(page.getByTestId('activity-toggle')).toHaveCount(0, { timeout: 30_000 }); // hidden when 0 run

    // 860 px: the navigation is one row with only Drawings and New drawing; Continue is hidden.
    await page.setViewportSize({ width: 860, height: 900 });
    const row = await box(page.getByTestId('home-nav')), narrowStart = await box(page.getByTestId('start'));
    expect(row.y + row.height).toBeLessThanOrEqual(narrowStart.y + 2); expect(row.width).toBeGreaterThan(600);
    expect(Math.abs((await box(page.getByTestId('home-nav-drawings'))).y - (await box(page.getByTestId('home-nav-new'))).y)).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('source-item').first()).toBeHidden(); await expect(page.getByTestId('home-continue')).toBeHidden();

    // 640 px: every column is full width and the stepper writes only the current step's name.
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(steps).toContainText('Folder');
    for (const name of ['Focus', 'Destination', 'Draw']) await expect(steps, `${name} is not written`).not.toContainText(name);
    expect((await box(page.getByTestId('start'))).width).toBeGreaterThan(520);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling').toBe(true);

    // The theme: the system's at first; the button switches it and the browser keeps it, even against the system's.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('home')).toHaveAttribute('data-theme', 'light'); await expect(page.getByTestId('home-theme')).toHaveAccessibleName('Switch theme');
    await page.getByTestId('home-theme').click(); await expect(page.getByTestId('home')).toHaveAttribute('data-theme', 'dark');
    await page.reload(); await expect(page.getByTestId('home')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.getByTestId('home-theme').click(); await expect(page.getByTestId('home')).toHaveAttribute('data-theme', 'light');
    await page.reload(); await expect(page.getByTestId('home')).toHaveAttribute('data-theme', 'light'); // the chosen theme, not the system's dark
  } finally { await server.close(); }
});
