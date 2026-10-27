import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withPresentation, workspaceRaw, openDrawing, slideShop, toPresentation, openLayer, slideRead, slideSized, slideBox, slideDimming, fullscreenAgrees, focusStaysIn, persistedDoc, saved,
  type Channel } from './helpers';

// PRES-1: `Present` and `Tour` sit in the header of the presentation channel and nowhere else; they are off, with the reason, when
// the channel has no drawing or no step, and stay in the header at every width. Presenting opens the layer on the opening slide in the
// drawing's theme, with focus on the layer, and asks for full screen without depending on getting it. Leaving by the browser's own
// full-screen exit leaves the layer too. Opening, looking and leaving writes nothing and starts no run.
test('H158 [PRES-1, STORY-4, NAV-2, LOOK-1] Present and Tour are in the header of the presentation channel only, off with a reason when there is no drawing or no step, and Present opens the opening slide in the drawings theme with focus held in the layer and full screen asked for, not assumed', async ({ page, request }) => {
  test.setTimeout(60_000);
  const runs: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') runs.push(req.url()); });
  const editor = page.getByTestId('editor'), start = page.getByTestId('present-start'), tour = page.getByTestId('tour-start'), layer = page.getByTestId('present');
  const open = async (channel: Channel) => { await page.getByTestId(`channel-tab-${channel}`).click(); await expect(editor).toHaveAttribute('data-channel', channel); };

  // A drawing with no presentation: nothing on the other tabs, and both buttons off on the stage that says it is not drawn.
  const bare = await workspaceRaw('present-bare', shop3('Bare talk'));
  await openDrawing(page, request, bare.file);
  for (const channel of ['overview', 'linkedin', 'readme'] as const) { await open(channel); await expect(start, channel).toHaveCount(0); await expect(tour, channel).toHaveCount(0); }
  await open('presentation'); await expect(page.getByTestId('channel-empty')).toContainText('The presentation is not drawn yet');
  for (const button of [start, tour]) { await expect(button).toBeVisible(); await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('title', 'Add a step first'); }
  await start.click({ force: true }); await tour.click({ force: true });
  await expect(layer).toHaveCount(0);

  // A presentation with a drawing and no step: the same, and the steps panel says so.
  const empty = await workspaceRaw('present-no-steps', withPresentation(shop3('Quiet talk'), { steps: [] }));
  await openDrawing(page, request, empty.file); await open('presentation');
  await expect(page.getByTestId('step-none')).toBeVisible();
  for (const button of [start, tour]) { await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('title', 'Add a step first'); }
  await start.click({ force: true }); await expect(layer).toHaveCount(0);

  // A presentation with steps, in a dark drawing: nothing on the other tabs, both buttons on the presentation's.
  const { file } = await workspaceRaw('present-shop', slideShop('Present shop', { theme: 'dark' }));
  await openDrawing(page, request, file);
  await expect(editor).toHaveAttribute('data-theme', 'dark');
  for (const channel of ['overview', 'readme'] as const) { await open(channel); await expect(start, channel).toHaveCount(0); await expect(tour, channel).toHaveCount(0); }
  await toPresentation(page);
  for (const button of [start, tour]) { await expect(button).toBeVisible(); await expect(button).toBeEnabled(); }
  await expect(start).toHaveAccessibleName(/Present/); await expect(tour).toHaveAccessibleName(/Tour/);

  // Narrow: both stay in the header as icons with their names, and the header menu does not take them.
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByTestId('header-menu-button')).toBeVisible();
  await expect(start).toBeVisible(); await expect(start).toHaveAccessibleName('Present'); await expect(tour).toBeVisible(); await expect(tour).toHaveAccessibleName('Tour');
  await page.getByTestId('header-menu-button').click();
  const menu = page.getByTestId('header-menu'); await expect(menu).toBeVisible();
  for (const id of ['repo-name', 'channel-tabs', 'tool-undo', 'tool-redo', 'tool-theme', 'tool-steps']) await expect(menu.getByTestId(id), id).toBeVisible();
  await expect(menu.getByTestId('present-start')).toHaveCount(0); await expect(menu.getByTestId('tour-start')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  await expect(start).toBeVisible(); await expect(tour).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 }); await expect(page.getByTestId('header-menu-button')).not.toBeVisible();
  await saved(page);
  const bytes = await readFile(file, 'utf8');
  await expect(page.locator('[data-testid="step-item"][aria-current="true"]')).toHaveCount(0);

  // Present: the opening slide, in the drawing's theme, in a dialog that holds the focus.
  await openLayer(page, 'present');
  await expect(layer).toHaveAttribute('role', 'dialog'); await expect(layer).toHaveAttribute('aria-modal', 'true');
  await expect(layer).toHaveAttribute('data-index', '0'); await expect(layer).toBeFocused();
  const opening = await slideRead(page);
  expect(opening).toMatchObject({ slide: '0', format: 'slide', theme: 'dark', band: false });
  expect(slideSized(opening), 'the slide is 1920 × 1080 in its own coordinates').toBe(true);
  expect(slideDimming(opening).nodes.dim, 'the opening slide dims nothing').toEqual([]);
  await expect(page.getByTestId('present-status')).toHaveText('Selling with Present shop');
  await expect(page.getByTestId('present-hint')).toBeVisible();
  await focusStaysIn(page, 'present', 'Tab'); await focusStaysIn(page, 'present', 'Shift+Tab');

  // Full screen was asked for: the layer says what it got, and a refusal leaves it open and filling the window.
  const fullscreen = await fullscreenAgrees(page);
  const fit = await layer.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, innerWidth: window.innerWidth, innerHeight: window.innerHeight }; });
  expect(fit.x).toBeLessThanOrEqual(1); expect(fit.y).toBeLessThanOrEqual(1);
  expect(fit.width).toBeGreaterThanOrEqual(fit.innerWidth - 1); expect(fit.height).toBeGreaterThanOrEqual(fit.innerHeight - 1);
  // The slide keeps 16:9, fits inside the layer and fills it on one side.
  const slide = await slideBox(page); // the slide as drawn, not the element that holds it
  expect(slide.width / slide.height).toBeGreaterThan(1.76); expect(slide.width / slide.height).toBeLessThan(1.8);
  expect(slide.width).toBeLessThanOrEqual(fit.width + 1); expect(slide.height).toBeLessThanOrEqual(fit.height + 1);
  expect(slide.width >= fit.width * 0.9 || slide.height >= fit.height * 0.9, 'the slide fills the layer on one side').toBe(true);
  await expect(editor).toHaveAttribute('data-theme', 'dark');

  // Leaving: when the browser took the layer full screen, its own exit leaves the layer; otherwise Escape does. Either way the
  // focus is back on the button that opened it and, after the opening slide, no step is current.
  if (fullscreen) await page.evaluate(() => document.exitFullscreen()); else { await layer.focus(); await page.keyboard.press('Escape'); }
  await expect(layer).toHaveCount(0); await expect(start).toBeFocused();
  await expect(page.locator('[data-testid="step-item"][aria-current="true"]')).toHaveCount(0);

  // Must not happen: looking at the slides being an edit or a run.
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled(); expect(runs).toEqual([]);

  // The theme is the drawing's, not a fixed one: switched to light, the next presenting is light.
  await page.getByTestId('tool-theme').click(); await expect(editor).toHaveAttribute('data-theme', 'light');
  await persistedDoc(file, d => d.theme === 'light');
  await openLayer(page, 'present');
  expect((await slideRead(page)).theme).toBe('light'); await expect(page.getByTestId('present-slide')).toBeVisible();
  await layer.focus(); await page.keyboard.press('Escape');
  await expect(layer).toHaveCount(0); await expect(start).toBeFocused();
  expect(runs).toEqual([]);
});
