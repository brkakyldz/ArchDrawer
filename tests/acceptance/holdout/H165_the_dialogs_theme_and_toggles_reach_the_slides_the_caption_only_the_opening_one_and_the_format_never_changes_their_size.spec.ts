import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { slideShop, workspaceRaw, openDrawing, toPresentation, downloaded, readPdf, readZip, pngSize, pixelGrids, gridDistance, saved } from './helpers';

// PRES-3 + SHARE-1 + LOOK-1: both slide downloads use the share dialog's theme and its toggles as they are when pressed, with the
// title and description on the opening slide only; the format chosen changes the toggles that start with it but never the size of a
// slide. So: light and dark zips differ slide by slide (which is darker is not asserted: the contract names the themes, not their colours); a PDF made in dark is nearer the dark slides than
// the light ones; switching the title off or the description on changes the opening slide and no other; switching texts off changes
// every slide; the square format gives the same entries, all 3840 × 2160.
const SLUG = 'theme-shop', NAMES = [0, 1, 2, 3].map(i => `${SLUG}-slide-${String(i).padStart(2, '0')}.png`);

async function advanced(page: Page) {
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('share-advanced')).toBeVisible();
}
async function zipOf(page: Page) {
  const zip = await downloaded(page, 'download-slides-png'), archive = readZip(zip.bytes);
  expect(zip.name).toBe(`${SLUG}-slides.zip`); expect(archive.entries.map(e => e.name)).toEqual(NAMES);
  for (const entry of archive.entries) expect(pngSize(entry.data), entry.name).toEqual({ png: true, width: 3840, height: 2160 });
  return archive.entries.map(e => e.data);
}

test('H165 [PRES-3, SHARE-1, LOOK-1] the share dialogs theme and toggles reach the slides, the title and description only the opening one, and the format chosen never changes a slides size or the entries', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { file } = await workspaceRaw('slides-theme', slideShop('Theme Shop', { theme: 'light' }));
  await openDrawing(page, request, file); await toPresentation(page);
  const bytes = await readFile(file, 'utf8');
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
  const light = () => page.getByTestId('share-theme-light').click(), dark = () => page.getByTestId('share-theme-dark').click();

  // Light and dark: the same entries, every slide different, and the PDF made in dark nearer the dark slides.
  await light(); const lightZip = await zipOf(page);
  await dark(); const darkZip = await zipOf(page);
  const pdf = await downloaded(page, 'download-slides-pdf'), pdfRead = readPdf(pdf.bytes);
  expect(pdf.name).toBe(`${SLUG}-slides.pdf`); expect(pdfRead.count).toBe(4); expect(pdfRead.pageImages).toHaveLength(4);
  for (let k = 0; k < 4; k++) expect(Buffer.compare(lightZip[k], darkZip[k]), `slide ${k}: light and dark differ`).not.toBe(0);
  const grids = await pixelGrids(page, [...lightZip, ...darkZip].map(data => ({ bytes: data, mime: 'image/png' })).concat(pdfRead.pageImages.map(data => ({ bytes: data, mime: 'image/jpeg' }))));
  const lightGrids = grids.slice(0, 4), darkGrids = grids.slice(4, 8), pdfGrids = grids.slice(8, 12);
  for (let k = 0; k < 4; k++) {
    expect(gridDistance(pdfGrids[k], darkGrids[k]), `page ${k + 1} of the PDF made in dark is the dark slide`).toBeLessThan(gridDistance(pdfGrids[k], lightGrids[k]));
  }

  // The toggles, in light. The caption is the opening slide's alone: the title off or the description on changes that slide and no other.
  await light(); await advanced(page);
  await expect(page.getByTestId('show-title')).toBeChecked(); await expect(page.getByTestId('show-lede')).not.toBeChecked(); await expect(page.getByTestId('show-texts')).toBeChecked();
  const baseline = lightZip, baseGrids = lightGrids;
  const sameAsBaseline = async (zip: Buffer[], from: number, to: number, what: string) => {
    const g = await pixelGrids(page, zip.slice(from, to).map(data => ({ bytes: data, mime: 'image/png' })));
    g.forEach((grid, i) => expect(gridDistance(grid, baseGrids[from + i]), `${what}: slide ${from + i} is as it was`).toBeLessThan(0.5));
  };
  await page.getByTestId('show-title').uncheck(); const noTitle = await zipOf(page); await page.getByTestId('show-title').check();
  expect(Buffer.compare(noTitle[0], baseline[0]), 'without the title the opening slide differs').not.toBe(0);
  await sameAsBaseline(noTitle, 1, 4, 'no title');
  await page.getByTestId('show-lede').check(); const withLede = await zipOf(page); await page.getByTestId('show-lede').uncheck();
  expect(Buffer.compare(withLede[0], baseline[0]), 'with the description the opening slide differs').not.toBe(0);
  expect(Buffer.compare(withLede[0], noTitle[0]), 'and differs from the one without a title').not.toBe(0);
  await sameAsBaseline(withLede, 1, 4, 'description on');
  await page.getByTestId('show-texts').uncheck(); const noTexts = await zipOf(page); await page.getByTestId('show-texts').check();
  for (let k = 0; k < 4; k++) expect(Buffer.compare(noTexts[k], baseline[k]), `slide ${k}: the text is drawn on every slide, so switching it off shows`).not.toBe(0);

  // The format sets the toggles it starts with and nothing else: a slide is 1920 × 1080 whichever is chosen.
  await page.getByTestId('format-square').click(); await expect(page.getByTestId('format-square')).toHaveAttribute('aria-pressed', 'true');
  await advanced(page);
  await expect(page.getByTestId('show-labels')).not.toBeChecked(); await expect(page.getByTestId('show-lede')).toBeChecked();
  const square = await zipOf(page);
  for (let k = 0; k < 4; k++) expect(Buffer.compare(square[k], baseline[k]), `slide ${k}: the square format's toggles show`).not.toBe(0);
  const squarePdf = readPdf((await downloaded(page, 'download-slides-pdf')).bytes);
  expect(squarePdf.count).toBe(4); expect(squarePdf.pages.every(p => p.mediaBox)).toBe(true);
  for (const image of squarePdf.images) expect(image).toMatchObject({ width: 3840, height: 2160 });

  // Must not happen: the export settings being an edit of the drawing.
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled();
});
