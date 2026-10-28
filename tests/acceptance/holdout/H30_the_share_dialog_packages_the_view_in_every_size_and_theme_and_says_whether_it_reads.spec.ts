import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { useProduct } from './server';
import { drawingRepo, shopDoc, openDrawing, stored, saved, readImage } from './helpers';

const product = useProduct();

// A user shares their drawing: they switch it to the dark theme, open Share, step through the four destinations (each at its own size),
// read the readability sentence (plain words, the numbers only under Details), download the image and copy it, and close with Escape.
test('H30 [SHARE-1 SHARE-2 SHARE-3 LOOK-1] the share dialog packages the view at each destination\'s size, in the drawing\'s theme or the other, says in plain words whether it reads, downloads and copies, and returns focus @smoke', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = product();
  const { file } = await drawingRepo('share', shopDoc('Share shop'));
  const id = await openDrawing(page, p, file);

  // The drawing's own theme.
  await page.getByTestId('tool-theme').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('tool-theme')).toHaveAttribute('aria-pressed', 'true');
  await saved(page);
  expect((await stored(p, id)).theme).toBe('dark');

  await page.getByTestId('share-button').click();
  const dialog = page.getByTestId('share-dialog');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="share-dialog"]'))).toBe(true);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="share-dialog"]')), 'Tab stays in the dialog').toBe(true);
  }
  await expect(page.getByTestId('format-readme'), 'README by default outside LinkedIn').toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-theme-dark'), 'the drawing\'s theme by default').toHaveAttribute('aria-pressed', 'true');
  const preview = page.getByTestId('share-preview');
  const sizes: [string, number, number, RegExp][] = [
    ['format-readme', 1600, 900, /GitHub README/], ['format-slide', 1920, 1080, /projected slide/], ['format-square', 1080, 1080, /feed/], ['format-feed', 1080, 1350, /LinkedIn feed/],
  ];
  for (const [format, width, height, where] of sizes) {
    await page.getByTestId(format).click();
    await expect(page.getByTestId(format)).toHaveAttribute('aria-pressed', 'true');
    await expect(preview).toHaveAttribute('data-width', String(width));
    await expect(preview).toHaveAttribute('data-height', String(height));
    await expect(page.getByTestId('share-size')).toHaveText(new RegExp(`${width}\\D+${height}`));
    const readability = page.getByTestId('readability');
    await expect(readability).toHaveAttribute('data-level', /^(good|ok|warn)$/);
    await expect(readability).toContainText(where);
    expect(await readability.evaluate(el => Array.from(el.childNodes).filter(n => !(n as Element).getAttribute?.('data-testid')?.startsWith('readability-details')).map(n => n.textContent ?? '').join('')), `${format}: no numbers in the sentence`).not.toMatch(/\d/);
  }
  await page.getByTestId('readability-details-toggle').click();
  await expect(page.getByTestId('readability-details-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('readability-details')).toContainText(/\d+(\.\d)? px/);
  await page.getByTestId('share-advanced-toggle').click();
  await page.getByTestId('format-linkedin').click();
  await expect(preview).toHaveAttribute('data-width', '1620');
  await expect(preview).toHaveAttribute('data-height', '1080');

  // The other theme, downloaded: the file is the image the preview shows.
  await page.getByTestId('format-readme').click();
  await page.getByTestId('share-theme-light').click();
  const waiting = page.waitForEvent('download'); await page.getByTestId('download-svg').click();
  const download = await waiting; const saved_ = info.outputPath('share.svg'); await download.saveAs(saved_);
  expect(download.suggestedFilename()).toBe('share-shop-overview-readme.svg');
  const image = await readImage(page, await readFile(saved_, 'utf8'));
  expect([image.width, image.height, image.theme, image.format]).toEqual([1600, 900, 'light', 'readme']);
  expect(image.nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);
  expect(image.words.join(' ')).toContain('How an order flows');
  expect((await stored(p, id)).theme, 'the image theme is not the drawing\'s').toBe('dark');

  await page.getByTestId('copy-image').click();
  await expect(page.getByTestId('toast')).toHaveText(/Copied the image|Download PNG/);

  // Must not happen: the dialog simplifying or rearranging; Escape closes and gives the focus back.
  await expect(dialog.getByRole('button', { name: /simplif|share one part|re-arrange/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('share-button')).toBeFocused();
});
