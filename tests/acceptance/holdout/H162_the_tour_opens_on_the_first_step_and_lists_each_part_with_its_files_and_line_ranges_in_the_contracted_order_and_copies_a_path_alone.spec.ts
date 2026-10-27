import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tourShop, TOUR_DESK_FIRST, workspaceRaw, openDrawing, toPresentation, openLayer, slideRead, slideDimming, textLines, saved } from './helpers';

// PRES-2 + STORY-4 + FILE-2: the tour is the presentation's steps read in a window. It opens on the first step and is never full
// screen. Beside the slide the panel holds the step's note and one entry per lit part, in the order of the view's parts, each with its
// files: the facts' files, then the held facts', each fact's own files first and then the files its evidence cites that are not listed
// yet, with the cited line ranges after the path; a part with no file says so. A button copies the path alone. The tour reads no file,
// checks no file and writes nothing.
const text = (value: string) => value.replace(/\s+/g, ' ').trim();
// The text of each `tour-file`, without any `tour-copy` inside it (where the button sits is open), whitespace-normalised; the contract
// does not say whether a space separates the path from its ranges, so none is kept before a colon that follows the path.
const filesOf = async (part: Locator) => (await part.getByTestId('tour-file').evaluateAll(els => els.map(el => {
  const copy = el.cloneNode(true) as Element; copy.querySelectorAll('[data-testid="tour-copy"]').forEach(b => b.remove()); return copy.textContent ?? '';
}))).map(value => text(value).replace(/([^,\s])\s+:/g, '$1:'));

test('H162 [PRES-2, STORY-4, FILE-2] the tour opens on the first step and never in full screen, lists one part per lit part in the order of the view with its files and cited line ranges in the contracted order or No files recorded, and copies a path alone', async ({ page, request, context }) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { file } = await workspaceRaw('tour-files', tourShop('Tour shop'));
  await openDrawing(page, request, file); await toPresentation(page);
  const bytes = await readFile(file, 'utf8');
  // Counted only while the tour is open: when the editor itself checks files, outside the layer, is not the contract's to say.
  const requests: string[] = []; let touring = false;
  page.on('request', req => { const path = new URL(req.url()).pathname; if (touring && path.startsWith('/api/') && (req.method() !== 'GET' || /check-files|\/files\b/.test(path))) requests.push(`${req.method()} ${path}`); });

  const layer = await openLayer(page, 'tour'); touring = true;
  const panel = page.getByTestId('tour-panel'), parts = page.getByTestId('tour-part'), note = page.getByTestId('tour-note'), status = page.getByTestId('present-status'), toast = page.getByTestId('toast');
  const part = (id: string) => page.locator(`[data-testid="tour-part"][data-node-id="${id}"]`);

  // Step 1: the first step, in a window, with its slide and its panel.
  await expect(layer).toHaveAttribute('data-index', '1'); await expect(layer).toHaveAttribute('data-fullscreen', 'false');
  expect(await layer.evaluate(el => document.fullscreenElement !== el), 'the tour never takes the layer full screen').toBe(true);
  await expect(status).toHaveText('Step 1 of 3: The shopper reaches the desk');
  const slide = await slideRead(page);
  expect(slide).toMatchObject({ slide: '1', format: 'slide', bandCount: '1 / 3' });
  expect(slideDimming(slide).nodes).toEqual({ lit: ['desk', 'storefront'], dim: ['gateway', 'ledger'] });
  await expect(page.getByTestId('present-hint')).toBeHidden(); await expect(page.getByTestId('present-note-toggle')).toBeHidden();
  await expect(panel).toBeVisible();
  expect(await textLines(note)).toEqual(['Start with the click.', 'Then the desk takes over.']);

  // The parts: the step names desk before storefront, the panel follows the view's parts, each with its label.
  await expect(parts).toHaveCount(2);
  expect(await parts.evaluateAll(els => els.map(el => el.getAttribute('data-node-id')))).toEqual(['storefront', 'desk']);
  await expect(part('storefront')).toContainText('Storefront'); await expect(part('desk')).toContainText('Order desk');

  // The files: facts first, then held facts; a fact's files, then the files its evidence cites; ranges after the path.
  expect(await filesOf(part('storefront'))).toEqual(['src/web.ts:1']);
  const desk = await filesOf(part('desk'));
  expect(desk).toHaveLength(3); expect(desk[0]).toMatch(TOUR_DESK_FIRST); expect(desk.slice(1)).toEqual(['src/db.ts:2', 'src/extra.ts:40–52']);
  await expect(part('desk').getByTestId('tour-copy')).toHaveCount(3); await expect(part('storefront').getByTestId('tour-copy')).toHaveCount(1);
  await expect(part('desk').getByTestId('tour-copy').first()).toHaveAccessibleName(/Copy path/);
  await expect(part('desk')).not.toContainText('No files recorded'); await expect(part('storefront')).not.toContainText('No files recorded');

  // Copy path: the path alone, with no range, and a toast. (A browser that refuses the clipboard says so instead.)
  const copyAndRead = async (from: Locator, expected: string) => {
    await from.click();
    await expect(toast).toHaveText(/^(Copied the path|Copying is not allowed here)$/);
    if ((await toast.innerText()).trim() === 'Copied the path') await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    await expect(toast).toHaveCount(0, { timeout: 8_000 });
  };
  await copyAndRead(part('desk').getByTestId('tour-copy').nth(0), 'src/api.ts');
  await copyAndRead(part('desk').getByTestId('tour-copy').nth(2), 'src/extra.ts');
  await copyAndRead(part('storefront').getByTestId('tour-copy').nth(0), 'src/web.ts');

  // Step 2: an empty note says so; a part with no file says that; a merged part lists each file once, in the order of its facts.
  await layer.focus(); await page.keyboard.press('ArrowRight'); await expect(layer).toHaveAttribute('data-index', '2');
  await expect(status).toHaveText('Step 2 of 3: The ledger feeds the gateway'); await expect(note).toHaveText('No note for this step');
  expect(await parts.evaluateAll(els => els.map(el => el.getAttribute('data-node-id')))).toEqual(['ledger', 'gateway']);
  await expect(part('ledger')).toContainText('Order ledger'); await expect(part('gateway')).toContainText('Gateway');
  await expect(part('ledger')).toContainText('No files recorded'); await expect(part('ledger').getByTestId('tour-file')).toHaveCount(0); await expect(part('ledger').getByTestId('tour-copy')).toHaveCount(0);
  expect(await filesOf(part('gateway'))).toEqual(['src/db.ts', 'src/web.ts', 'src/extra.ts']);
  await expect(part('gateway').getByTestId('tour-copy')).toHaveCount(3);

  // Step 3: one part again, with its files as in step 1 and its own note.
  await layer.focus(); await page.keyboard.press('ArrowRight'); await expect(layer).toHaveAttribute('data-index', '3');
  expect(await textLines(note)).toEqual(['Only the desk repeats work.']);
  await expect(parts).toHaveCount(1); await expect(part('desk')).toBeVisible();
  expect((await filesOf(part('desk')))[1]).toBe('src/db.ts:2');

  // Must not happen: the tour opening, checking or saving anything.
  await layer.focus(); await page.keyboard.press('Escape'); await expect(layer).toHaveCount(0); touring = false;
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled();
  expect(requests, 'no write and no file check while touring').toEqual([]);
});
