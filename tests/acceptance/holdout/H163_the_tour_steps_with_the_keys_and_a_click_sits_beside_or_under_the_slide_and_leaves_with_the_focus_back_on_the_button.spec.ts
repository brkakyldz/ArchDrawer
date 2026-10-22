import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tourShop, workspaceRaw, openDrawing, toPresentation, openLayer, litParts, slideRead, slideBox, focusStaysIn, sessionWrite, watchToasts, toastsSeen, factOf, squeezed, saved, box, overlaps } from './helpers';

// PRES-2 + NAV-2 + STORY-4: the tour's keys take the steps only (Home is the first step, End the last, N does nothing, there is no
// opening slide to go back to), a click on the slide is the next step, and no step is passed at either end. The panel is beside the
// slide in a window of 900 px or more and under it below that; the buttons stay in the header at that width. Escape and `Exit` leave,
// the focus goes back to `Tour` and the step shown is the current one in the steps panel. Nothing is saved.
test('H163 [PRES-2, NAV-2, STORY-4] the tour steps with the keys and a click and never past either end, N does nothing, the panel is beside the slide when the window is wide and under it when narrow, and Escape and Exit leave with the focus back on Tour and the step shown current', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('tour-keys', tourShop('Tour keys'));
  await openDrawing(page, request, file); await toPresentation(page);
  const bytes = await readFile(file, 'utf8');
  const tour = page.getByTestId('tour-start'), layer = page.getByTestId('present'), status = page.getByTestId('present-status'), toast = page.getByTestId('toast');
  const current = page.locator('[data-testid="step-item"][aria-current="true"]');
  const TEXT = ['The shopper reaches the desk', 'The ledger feeds the gateway', 'The desk retries safely'];
  const PARTS = [['storefront', 'desk'], ['ledger', 'gateway'], ['desk']];

  // Each step: the layer's index (the first step is 1), the live region, and the panel's parts in the view's order.
  const showing = async (index: number) => {
    await expect(layer).toHaveAttribute('data-index', String(index)); await expect(layer).toHaveAttribute('data-mode', 'tour'); await expect(layer).toHaveAttribute('data-fullscreen', 'false');
    await expect(status).toHaveText(`Step ${index} of 3: ${TEXT[index - 1]}`);
    await expect.poll(async () => (await page.getByTestId('tour-part').evaluateAll(els => els.map(el => el.getAttribute('data-node-id'))))).toEqual(PARTS[index - 1]);
    expect((await page.getByTestId('present-slide').evaluate(el => (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg'))!.getAttribute('data-slide')))).toBe(String(index));
  };
  const key = async (name: string, index: number) => { await page.keyboard.press(name); await showing(index); };
  const stays = async (name: string, index: number) => { await page.keyboard.press(name); await page.waitForTimeout(150); await showing(index); await expect(layer).toBeVisible(); await expect(toast).toHaveCount(0); };

  // Wide: the panel is beside the slide, which keeps 16:9.
  await openLayer(page, 'tour'); await expect(layer).toBeFocused(); await showing(1);
  const slide = await slideBox(page), panel = await box(page.getByTestId('tour-panel')); // the slide as drawn, not the element that holds it
  expect(slide.width / slide.height).toBeGreaterThan(1.76); expect(slide.width / slide.height).toBeLessThan(1.8);
  expect(overlaps(slide, panel), 'the panel does not cover the slide').toBe(false);
  expect(panel.y < slide.y + slide.height && panel.y + panel.height > slide.y, 'level with the slide').toBe(true);
  expect(panel.x >= slide.x + slide.width - 2 || panel.x + panel.width <= slide.x + 2, 'to one side of the slide').toBe(true);

  // The first step is the start: nothing goes before it, and Home is the first step. Then the keys of the table.
  await stays('ArrowLeft', 1); await stays('ArrowUp', 1); await stays('PageUp', 1); await stays('Home', 1);
  await key('ArrowRight', 2); await key('Space', 3);
  await stays('PageDown', 3); await stays('ArrowDown', 3); await stays('ArrowRight', 3); await stays('End', 3);
  await key('ArrowLeft', 2); await stays('n', 2); await key('ArrowUp', 1); await key('PageDown', 2); await key('End', 3); await key('PageUp', 2); await key('Home', 1); await key('ArrowDown', 2);
  // N has no note to show in a tour: no button, no second note.
  await expect(page.getByTestId('present-note-toggle')).toBeHidden(); await expect(page.getByTestId('present-note')).toBeHidden(); await expect(page.getByTestId('present-hint')).toBeHidden();
  // A click on the slide is the next step, and nothing after the last.
  await page.getByTestId('present-slide').click(); await showing(3);
  await page.getByTestId('present-slide').click(); await page.waitForTimeout(150); await showing(3);

  // `Exit` leaves from the last step; the focus is on Tour and the step shown is the current one, lit on the canvas.
  await expect(page.getByTestId('present-exit')).toHaveText('Exit'); await page.getByTestId('present-exit').click();
  await expect(layer).toHaveCount(0); await expect(tour).toBeFocused();
  await expect(current).toHaveCount(1); await expect(current).toHaveAttribute('data-step-id', 's3'); expect((await litParts(page)).on).toEqual(['desk']);

  // Below 900 px the panel goes under the slide and the buttons stay in the header.
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByTestId('header-menu-button')).toBeVisible(); await expect(tour).toBeVisible(); await expect(tour).toHaveAccessibleName('Tour');
  await openLayer(page, 'tour'); await showing(1);
  const narrowSlide = await slideBox(page), under = await box(page.getByTestId('tour-panel'));
  expect(narrowSlide.width / narrowSlide.height).toBeGreaterThan(1.76); expect(narrowSlide.width / narrowSlide.height).toBeLessThan(1.8);
  expect(overlaps(narrowSlide, under), 'the panel does not cover the slide').toBe(false);
  expect(under.y >= narrowSlide.y + narrowSlide.height - 2, 'under the slide').toBe(true);
  expect(under.x < narrowSlide.x + narrowSlide.width && under.x + under.width > narrowSlide.x, 'below it, not beside').toBe(true);
  await key('ArrowRight', 2);

  // Escape leaves from the second step, with the focus back on Tour.
  await page.keyboard.press('Escape'); await expect(layer).toHaveCount(0); await expect(tour).toBeFocused();
  await expect(current).toHaveCount(1); await expect(current).toHaveAttribute('data-step-id', 's2');
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Must not happen: touring being an edit.
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled();

  // Tab and Shift+Tab cycle inside the tour's layer, and an outside change to the file re-renders the step shown with no toast.
  await watchToasts(page);
  await openLayer(page, 'tour'); await showing(1); await key('ArrowRight', 2);
  await layer.focus(); await focusStaysIn(page, 'present', 'Tab'); await focusStaysIn(page, 'present', 'Shift+Tab');
  const slow = { timeout: 15_000 };
  await sessionWrite(file, d => { factOf(d, 'db')!.label = 'Order book'; });
  // The contract says the slide shown is re-rendered; it says nothing of `tour-panel`, so only the slide is observed.
  await expect.poll(async () => squeezed((await slideRead(page)).words.join('')).includes(squeezed('Order book')), slow).toBe(true);
  await showing(2); await expect(layer).toBeVisible();
  expect(await toastsSeen(page)).toEqual([]); await expect(toast).toHaveCount(0);
  await layer.focus(); await page.keyboard.press('Escape'); await expect(layer).toHaveCount(0); await expect(tour).toBeFocused();
});
