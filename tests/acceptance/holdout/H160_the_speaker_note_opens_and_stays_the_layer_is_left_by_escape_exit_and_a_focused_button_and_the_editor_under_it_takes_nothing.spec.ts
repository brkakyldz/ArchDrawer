import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { slideShop, workspaceRaw, openDrawing, toPresentation, openLayer, litParts, textLines, saved, box } from './helpers';

// PRES-1 + STORY-4 + EDIT-1: the speaker note is hidden on the opening slide, closed when the layer opens, opened by N or by its
// button and then kept from step to step, with its newlines or `No note for this step`. Escape, `Exit` and Enter on a focused
// `Exit` all leave: the focus goes back to `present-start`, the step shown becomes the current one in the steps panel (none after the
// opening slide) and lights its parts on the canvas. While the layer is open the editor under it takes no key and no click: a
// selected part is not deleted, no tool changes, search does not open, nothing is selected by a click, and nothing is saved.
test('H160 [PRES-1, STORY-4, EDIT-1] the speaker note is closed on entry and kept open from step to step with its newlines, Escape Exit and Enter on Exit each leave with the focus back and the step shown current, and no key or click reaches the editor under the layer', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('present-note', slideShop('Note shop'));
  await openDrawing(page, request, file); await toPresentation(page);
  const start = page.getByTestId('present-start'), layer = page.getByTestId('present'), toggle = page.getByTestId('present-note-toggle'), note = page.getByTestId('present-note');
  const current = page.locator('[data-testid="step-item"][aria-current="true"]');
  const bytes = await readFile(file, 'utf8');
  const index = async () => Number(await layer.getAttribute('data-index'));

  // The opening slide has no note to show: no button, and N does nothing.
  await openLayer(page, 'present');
  await expect(toggle).toBeHidden(); await page.keyboard.press('n'); await expect(note).toBeHidden(); await expect(toggle).toBeHidden(); await expect(layer).toHaveAttribute('data-index', '0');

  // Step 1: the button is there, closed; N opens it and shows the note with its line break; N closes it; the button opens it.
  await page.keyboard.press('ArrowRight'); await expect(layer).toHaveAttribute('data-index', '1');
  await expect(toggle).toBeVisible(); await expect(toggle).toContainText('Speaker note'); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(note).toBeHidden();
  await page.keyboard.press('n'); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(note).toBeVisible();
  expect(await textLines(note)).toEqual(['Say who is asking.', 'Then show the click.']);
  await page.keyboard.press('n'); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(note).toBeHidden();
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(note).toBeVisible(); await expect(layer).toHaveAttribute('data-index', '1');

  // Kept open from slide to slide: a step with an empty note says so, the next one shows its own line.
  await layer.focus(); await page.keyboard.press('ArrowRight'); await expect(layer).toHaveAttribute('data-index', '2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(note).toHaveText('No note for this step');
  await page.keyboard.press('ArrowRight'); await expect(layer).toHaveAttribute('data-index', '3');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(await textLines(note)).toEqual(['One line only.']);
  // ... and kept closed the same way.
  await page.keyboard.press('n'); await expect(note).toBeHidden();
  await page.keyboard.press('ArrowLeft'); await expect(layer).toHaveAttribute('data-index', '2'); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(note).toBeHidden();
  await page.keyboard.press('ArrowLeft'); await expect(layer).toHaveAttribute('data-index', '1'); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(note).toBeHidden();

  // Space and Enter on the focused button activate it and do not move the slide.
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(note).toBeVisible(); expect(await index()).toBe(1);
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(note).toBeHidden(); expect(await index()).toBe(1);

  // Escape on step 2 leaves: the focus is back on Present, the second step is the current one and lights its parts.
  await layer.focus(); await page.keyboard.press('ArrowRight'); await expect(layer).toHaveAttribute('data-index', '2');
  await page.keyboard.press('Escape'); await expect(layer).toHaveCount(0); await expect(start).toBeFocused();
  await expect(current).toHaveCount(1); await expect(current).toHaveAttribute('data-step-id', 's2');
  expect(await litParts(page)).toEqual({ on: ['db', 'zone'], dim: ['api', 'cache', 'web'], all: ['api', 'cache', 'db', 'web', 'zone'] });

  // `Exit` leaves as Escape does, from the last step.
  await openLayer(page, 'present'); await expect(layer).toHaveAttribute('data-index', '0');
  await page.keyboard.press('End'); await expect(layer).toHaveAttribute('data-index', '3');
  await expect(page.getByTestId('present-exit')).toHaveText('Exit'); await page.getByTestId('present-exit').click();
  await expect(layer).toHaveCount(0); await expect(start).toBeFocused();
  await expect(current).toHaveCount(1); await expect(current).toHaveAttribute('data-step-id', 's3');
  expect((await litParts(page)).on).toEqual(['api', 'db']);

  // Nothing was edited, saved or undoable by presenting.
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled();

  // Under the layer the editor is deaf. A part is selected (its callout open) before presenting; every key the editor listens
  // to and a click where another part sits are given to the layer, and the editor is as it was when the layer goes.
  await page.getByTestId('node-web').getByTestId('node-label').click();
  await expect(page.getByTestId('node-web')).toHaveAttribute('data-selected', 'true');
  const api = await box(page.getByTestId('node-api'));
  await openLayer(page, 'present');
  for (const key of ['Delete', 'Backspace', 'h', 'c', 'e', 't', '/', 'Control+k', 'Control+z']) await page.keyboard.press(key);
  await page.mouse.click(api.x + api.width / 2, api.y + api.height / 2);
  await expect(page.getByTestId('search')).toHaveCount(0); await expect(layer).toBeVisible();
  // The index may follow the click a frame later: read it only once two reads, 250 ms apart, agree, and still inside the layer.
  let shown = await index(); for (let again = 0; again < 20; again++) { await page.waitForTimeout(250); const next = await index(); if (next === shown) break; shown = next; }
  await page.getByTestId('present-exit').focus(); await page.keyboard.press('Enter');
  await expect(layer).toHaveCount(0); await expect(start).toBeFocused();
  // (the click may have been the slide's own "next slide": the slide shown, read before leaving, is current, and none is after the opening slide)
  if (shown > 0) { await expect(current).toHaveCount(1); await expect(current).toHaveAttribute('data-step-id', `s${shown}`); } else await expect(current).toHaveCount(0);
  // The editor takes no pointer input under the layer, so the part clicked there was not selected. (Whether the part selected before
  // stays selected is not in the contract; the unchanged file shows Delete reached nothing.)
  await expect(page.getByTestId('node-api')).not.toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByTestId('tool-pan')).not.toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search')).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled();
});
