import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { slideShop, SLIDE_STEPS, withReadme, withLinkedIn, workspaceRaw, openDrawing, toPresentation, downloaded, readPdf, readZip, pngSize, slugOf, saved, type Step } from './helpers';

// PRES-3 + SHARE-2 + STORY-4: the two slide downloads are on the presentation channel's share dialog and on no other channel's. Their
// names come from the title (accents removed), a talk of eleven steps gives twelve pages and entries -00 to -11, and a talk of one step
// two. Without a step both are off with the reason and nothing downloads; removing the last step switches them off and undo brings them back.
const NAMES = (slug: string, count: number) => Array.from({ length: count }, (_, i) => `${slug}-slide-${String(i).padStart(2, '0')}.png`);

async function shareOpen(page: Page) { await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toBeVisible(); }
async function shareClose(page: Page) { await page.getByTestId('share-close').click(); await expect(page.getByTestId('share-dialog')).toHaveCount(0); }

test('H166 [PRES-3, SHARE-2, STORY-4] the slide downloads are in the presentation channels share dialog and no other, are named from an accented title with two-digit slide numbers for eleven steps, and go off with the reason when the last step is removed', async ({ page, request }) => {
  test.setTimeout(60_000);
  const TITLE = 'Crème Brûlée Café!', SLUG = 'creme-brulee-cafe';
  expect(slugOf(TITLE)).toBe(SLUG);
  const eleven: Step[] = Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, parts: [['web', 'api', 'cache', 'db', 'zone'][i % 5]], text: `Slide text ${i + 1}`, note: '' }));
  const { file } = await workspaceRaw('slides-names', withLinkedIn(withReadme(slideShop(TITLE, { steps: eleven })), { intakeItems: ['Takes the order', 'Checks the price'] })); // (a panel shows at least one row)
  await openDrawing(page, request, file);
  const bytes = await readFile(file, 'utf8');
  let downloads = 0;
  page.on('download', () => { downloads++; });

  // Every other channel's dialog has its own downloads and no slide download.
  for (const channel of ['overview', 'readme', 'linkedin'] as const) {
    await page.getByTestId(`channel-tab-${channel}`).click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', channel);
    await shareOpen(page);
    const actions = page.getByTestId('share-actions');
    for (const id of ['download-png', 'download-svg', 'copy-image']) await expect(actions.getByTestId(id), `${channel}: ${id}`).toBeVisible();
    await expect(page.getByTestId('download-slides-pdf'), channel).toHaveCount(0); await expect(page.getByTestId('download-slides-png'), channel).toHaveCount(0);
    await shareClose(page);
  }

  // The presentation: eleven steps and the opening slide are twelve pages and twelve entries, numbered in two digits.
  await toPresentation(page); await shareOpen(page);
  await expect(page.getByTestId('download-slides-pdf')).toBeEnabled(); await expect(page.getByTestId('download-slides-png')).toBeEnabled();
  const pdf = await downloaded(page, 'download-slides-pdf');
  expect(pdf.name).toBe(`${SLUG}-slides.pdf`);
  const read = readPdf(pdf.bytes);
  expect(read.starts && read.ends).toBe(true); expect(read.count).toBe(12); expect(read.pages).toHaveLength(12); expect(read.images).toHaveLength(12);
  expect(read.pages.every(p => p.mediaBox)).toBe(true);
  for (const image of read.images) expect(image).toMatchObject({ width: 3840, height: 2160, dct: true, jpeg: true });
  const zip = await downloaded(page, 'download-slides-png');
  expect(zip.name).toBe(`${SLUG}-slides.zip`);
  const archive = readZip(zip.bytes);
  expect(archive.count).toBe(12); expect(archive.entries.map(e => e.name)).toEqual(NAMES(SLUG, 12));
  expect(archive.entries[10].name).toBe(`${SLUG}-slide-10.png`); expect(archive.entries[11].name).toBe(`${SLUG}-slide-11.png`);
  for (const entry of archive.entries) { expect(entry.method, entry.name).toBe(0); expect(entry.crcOk, entry.name).toBe(true); expect(pngSize(entry.data), entry.name).toEqual({ png: true, width: 3840, height: 2160 }); }
  await page.waitForTimeout(500); expect(downloads, 'one file per click').toBe(2);
  await shareClose(page);

  // A talk of one step: two pages, two entries. Removing that step takes the downloads away, and undo gives them back.
  const one = await workspaceRaw('slides-one', slideShop('One Step Talk', { steps: [structuredClone(SLIDE_STEPS[0])] }));
  await openDrawing(page, request, one.file); await toPresentation(page);
  await shareOpen(page);
  const onePdf = readPdf((await downloaded(page, 'download-slides-pdf')).bytes);
  expect(onePdf.count).toBe(2); expect(onePdf.pages).toHaveLength(2); expect(onePdf.images).toHaveLength(2);
  const oneZip = readZip((await downloaded(page, 'download-slides-png')).bytes);
  expect(oneZip.count).toBe(2); expect(oneZip.entries.map(e => e.name)).toEqual(NAMES('one-step-talk', 2));
  await shareClose(page);

  await page.locator('[data-testid="step-item"]').first().click(); await page.getByTestId('step-remove').click();
  await expect(page.getByTestId('step-none')).toBeVisible(); await saved(page);
  await shareOpen(page);
  const before = downloads;
  for (const id of ['download-slides-pdf', 'download-slides-png']) {
    const button = page.getByTestId(id);
    await expect(button, id).toBeVisible(); await expect(button, id).toBeDisabled(); await expect(button, id).toHaveAttribute('title', 'Add a step first');
    await button.click({ force: true });
  }
  await expect(page.getByTestId('download-png')).toBeEnabled();
  await page.waitForTimeout(800); expect(downloads, 'a disabled button downloads nothing').toBe(before);
  await shareClose(page);
  await page.getByTestId('tool-undo').click();
  await expect(page.locator('[data-testid="step-item"]')).toHaveCount(1);
  await shareOpen(page);
  await expect(page.getByTestId('download-slides-pdf')).toBeEnabled(); await expect(page.getByTestId('download-slides-png')).toBeEnabled();
  await shareClose(page);

  // Must not happen: making slides editing the first drawing.
  expect(await readFile(file, 'utf8')).toBe(bytes);
});
