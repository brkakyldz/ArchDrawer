import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { slideShop, workspaceRaw, openDrawing, toPresentation, downloaded, readPdf, readZip, pngSize, pixelGrids, gridDistance, saved } from './helpers';

// PRES-3 + SHARE-1 + STORY-4: on the presentation channel the share dialog also offers the steps as slides. `Slides as PDF` is one file
// `<slug>-slides.pdf` of steps + 1 pages of 960 × 540 points, each one 3840 × 2160 JPEG; `Slides as PNG` is `<slug>-slides.zip`
// holding `<slug>-slide-00.png` (the opening slide) to `-03.png`, stored, each 3840 × 2160. The pages and the entries are the same
// slides in the same order. The other downloads keep working and the drawing is not touched.
const SLUG = 'slides-shop';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('H164 [PRES-3, SHARE-1, STORY-4] on the presentation channel the share dialog downloads the talk as a PDF of a page per slide and as a zip of PNG slides, named from the title, in the same order, with the other downloads and the drawing untouched', async ({ page, request }) => {
  test.setTimeout(360_000);
  const { file } = await workspaceRaw('slides-files', slideShop('Slides Shop'));
  await openDrawing(page, request, file); await toPresentation(page);
  const bytes = await readFile(file, 'utf8');
  let downloads = 0, runs = 0;
  page.on('download', () => { downloads++; });
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') runs++; });

  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-dialog')).toBeVisible(); await expect(page.getByTestId('format-slide')).toHaveAttribute('aria-pressed', 'true');
  const actions = page.getByTestId('share-actions'), pdfButton = page.getByTestId('download-slides-pdf'), pngButton = page.getByTestId('download-slides-png');
  for (const id of ['readability', 'layout-report', 'download-png', 'download-svg', 'copy-image', 'download-slides-pdf', 'download-slides-png']) await expect(actions.getByTestId(id), id).toBeVisible();
  await expect(pdfButton).toContainText('Slides as PDF'); await expect(pngButton).toContainText('Slides as PNG');
  await expect(pdfButton).toBeEnabled(); await expect(pngButton).toBeEnabled();

  // The PDF: one page per slide, the opening slide first.
  const pdf = await downloaded(page, 'download-slides-pdf');
  expect(pdf.name).toBe(`${SLUG}-slides.pdf`);
  const read = readPdf(pdf.bytes);
  expect(read.starts, 'starts with %PDF-1.4').toBe(true); expect(read.ends, 'ends with %%EOF').toBe(true);
  expect(read.count, 'three steps and the opening slide').toBe(4); expect(read.pages).toHaveLength(4);
  expect(read.pages.every(p => p.mediaBox), 'every page is 960 × 540 points').toBe(true);
  expect(read.images).toHaveLength(4); expect(read.pageImages).toHaveLength(4);
  for (const image of read.images) expect(image, 'one 3840 × 2160 JPEG per page').toMatchObject({ width: 3840, height: 2160, dct: true, jpeg: true });
  expect(new Set(read.pageImages.map(sha)).size, 'four different slides').toBe(4);
  // The buttons are ready again once the file is made.
  await expect(pdfButton).toBeEnabled(); await expect(pdfButton).toContainText('Slides as PDF'); await expect(pngButton).toBeEnabled();

  // The zip: a PNG per slide, stored, named in order.
  const zip = await downloaded(page, 'download-slides-png');
  expect(zip.name).toBe(`${SLUG}-slides.zip`);
  const archive = readZip(zip.bytes);
  expect(archive.count).toBe(4); expect(archive.entries).toHaveLength(4);
  expect(archive.entries.map(e => e.name)).toEqual([0, 1, 2, 3].map(i => `${SLUG}-slide-${String(i).padStart(2, '0')}.png`));
  for (const entry of archive.entries) {
    expect(entry.method, `${entry.name} is stored`).toBe(0); expect(entry.stored).toBe(entry.size); expect(entry.crcOk, `${entry.name}: the checksum`).toBe(true);
    expect(pngSize(entry.data), entry.name).toEqual({ png: true, width: 3840, height: 2160 });
  }
  expect(new Set(archive.entries.map(e => sha(e.data))).size, 'four different slides').toBe(4);
  await expect(pngButton).toBeEnabled(); await expect(pngButton).toContainText('Slides as PNG');

  // Same slides, same order: each PDF page is nearest to the PNG slide of its own index.
  const grids = await pixelGrids(page, [...read.pageImages.map(b => ({ bytes: b, mime: 'image/jpeg' })), ...archive.entries.map(e => ({ bytes: e.data, mime: 'image/png' }))]);
  const pages = grids.slice(0, 4), slides = grids.slice(4);
  for (let k = 0; k < 4; k++) {
    const distances = slides.map(slide => gridDistance(pages[k], slide));
    expect(distances.indexOf(Math.min(...distances)), `page ${k + 1} is slide ${String(k).padStart(2, '0')} (distances ${distances.map(d => d.toFixed(2)).join(', ')})`).toBe(k);
  }

  // The dialog's other downloads still give their images at twice the slide size, and one click made one download.
  await page.waitForTimeout(500);
  expect(downloads, 'one file per click').toBe(2);
  const single = await downloaded(page, 'download-png');
  expect(single.name).toBe(`${SLUG}-presentation-slide.png`); expect(pngSize(single.bytes)).toEqual({ png: true, width: 3840, height: 2160 });

  // Must not happen: making slides being an edit or a run.
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled(); expect(runs).toBe(0);
});
