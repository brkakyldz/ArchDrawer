import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, svgInfo, previewSVG, download, box, overlaps, checkReadability } from './helpers';
import { inDrawingFonts } from './helpers-svg-parity';
import { readDrawn, drawnRoutes, expectSameRoutes, expectSameBoxes, inspectImage, cardSize, SHARE_TOGGLES } from './helpers-drawing';

// Reach a toggle state with the show-* checkboxes under "Advanced options" (the presets are gone). There is no show-items any more:
// no part draws rows. show-sub (Sub-lines) starts as the view's switch, which is on here.
const ALL_TOGGLES = SHARE_TOGGLES;
const SIMPLE_TOGGLES = ['title', 'lede', 'sub', 'steps', 'texts'], DETAILED_TOGGLES = ['title', 'sub', 'steps', 'labels', 'legend', 'texts'];
async function openAdvanced(page: Page) {
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('share-advanced')).toBeVisible();
}
async function setToggles(page: Page, on: string[]) {
  await openAdvanced(page);
  for (const id of ALL_TOGGLES) { const toggle = page.getByTestId(`show-${id}`); if (on.includes(id)) await toggle.check(); else await toggle.uncheck(); }
}
async function expectToggles(page: Page, on: string[]) {
  await openAdvanced(page);
  for (const id of ALL_TOGGLES) { if (on.includes(id)) await expect(page.getByTestId(`show-${id}`)).toBeChecked(); else await expect(page.getByTestId(`show-${id}`)).not.toBeChecked(); }
}
// The preview and the download are the same image: the same sizes, text, part boxes and connection paths (shaped parts can end a line
// on their outline inside the box, so the paths are read as cubics, not followed from border to border).
async function sameImages(page: Page, first: string, second: string, anchor: string) {
  const a = await svgInfo(page, first), b = await svgInfo(page, second);
  expect(a).toMatchObject({ error: false, width: b.width, height: b.height, theme: b.theme, format: b.format, xmlns: b.xmlns, forbidden: false });
  const key = (n: { id: string; width: number; height: number }) => `${n.id}:${n.width}x${n.height}`;
  expect(a.nodes.map(key).sort()).toEqual(b.nodes.map(key).sort()); expect(a.text).toEqual(b.text);
  const one = await inDrawingFonts(page, first, surface => drawnRoutes(surface, anchor)), two = await inDrawingFonts(page, second, surface => drawnRoutes(surface, anchor));
  expectSameBoxes(one, two, 'preview and download'); expectSameRoutes(one, two, 'preview and download');
}

test('H28 [SHARE-1 LAYOUT-1 LAYOUT-3 LOOK-3 LOOK-4 #177 #170] preview and download an image for every destination in both themes, with sub-lines as the view says and numbered connections coloured, and keep the drawing untouched', async ({ page, request, context }) => {
  const doc = drawing('Share Shop');
  doc.views[0].nodes.push(component('agent-runtime', { label: 'Agent runtime', form: 'group', place: { row: 0, col: 2 } }),
    component('think', { label: 'Think', kind: 'llm', form: 'compact', parent: 'agent-runtime' }),
    component('act', { label: 'Act', kind: 'gate', form: 'compact', parent: 'agent-runtime' }),
    component('job', { label: 'Order relay', kind: 'worker', place: { row: 0, col: 4 } }),
    component('check', { label: 'Approval', kind: 'gate', place: { row: 0, col: 5 } }),
    component('ops', { label: 'Order telemetry', kind: 'ops', place: { row: 1, col: 5 } }));
  const path = ['web', 'api', 'agent-runtime', 'db', 'job', 'check', 'ops'];
  doc.views[0].edges = path.slice(1).map((to, i) => ({ id: `main-${i}`, from: path[i], to, label: `branch ${String.fromCharCode(65 + i)}`, style: 'call', both: false, step: i + 1 }));
  doc.views[0].edges.push({ id: 'inner', from: 'think', to: 'act', label: 'decide', style: 'call', both: true, step: null },
    { id: 'store', from: 'think', to: 'db', label: 'read', style: 'call', both: false, step: null },
    { id: 'reply', from: 'db', to: 'act', label: 'resume', style: 'async', both: false, step: null });
  doc.views[0].texts.push({ id: 'share-text', text: 'A human can stop the order.', x: 40, y: 600, size: 20 });
  const { dir, file } = await workspace('sharing', doc); await openDrawing(page, request, file);
  const original = await readFile(file, 'utf8'), source = await readDrawn(file);
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['format-feed', 'format-readme', 'format-slide', 'format-square']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('share-advanced')).not.toBeVisible();
  await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('share-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expectToggles(page, DETAILED_TOGGLES); // README starts with title, sub-lines, path, labels, colour key and texts on; description off
  await expect(page.getByTestId('show-items'), 'no part draws rows, so there is no show-items').toHaveCount(0);
  const actions = page.getByTestId('share-actions');
  for (const id of ['layout-report', 'readability', 'download-png', 'download-svg', 'copy-image']) await expect(actions.getByTestId(id)).toBeVisible();

  // Names and all visible text are measured separately; the report and the meter agree on the level.
  async function readability(width: number, seen: number) {
    await checkReadability(page, width, seen);
  }
  const formats = [
    { name: 'readme', w: 1600, h: 900, seen: 880 },
    { name: 'slide', w: 1920, h: 1080, seen: 1280 }, { name: 'square', w: 1080, h: 1080, seen: 552 },
  ];
  for (const format of formats) for (const theme of ['light', 'dark']) {
    await page.getByTestId(`format-${format.name}`).click(); await page.getByTestId(`share-theme-${theme}`).click();
    await setToggles(page, DETAILED_TOGGLES);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', String(format.w)); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', String(format.h));
    await expect(page.getByTestId('share-size')).toHaveText(`${format.w} × ${format.h}`);
    const previewMarkup = await previewSVG(page), preview = await svgInfo(page, previewMarkup);
    expect(preview).toMatchObject({ error: false, width: format.w, height: format.h, theme, format: format.name, xmlns: 'http://www.w3.org/2000/svg', forbidden: false });
    expect(preview.viewBox.trim().split(/[\s,]+/).map(value => Number(value) === 0 ? 0 : Number(value))).toEqual([0, 0, format.w, format.h]);
    expect(preview.nodes.map(n => n.id).sort()).toEqual(source.nodes.map(n => n.id).sort()); expect(preview.edges).toHaveLength(9);
    expect(preview.text.join(' ')).toContain(source.caption.title); expect(preview.text.join(' ')).not.toContain(source.caption.lede);
    // Connections are neutral in an image except the numbered ones, which keep their kind colours (diagram contract, Colour).
    const tones = new Map((await inspectImage(page, previewMarkup)).edges.map(e => [e.id, e.tone] as const));
    for (const edge of source.edges) expect(tones.get(edge.id!), `${format.name} ${theme}: ${edge.id}`).toBe(edge.step === null ? 'neutral' : 'kind');
    const captionBox = await box(page.getByTestId('share-preview').locator('text').filter({ hasText: source.caption.title }));
    // One <g data-node-id> per drawn component, each with its own box: the caption took a free corner
    // and covers none of them. Every component is checked, so the loop can never pass by running empty.
    const drawnNodes = page.getByTestId('share-preview').locator('[data-node-id]');
    await expect(drawnNodes).toHaveCount(source.nodes.length);
    for (let i = 0; i < source.nodes.length; i++) {
      const first = drawnNodes.nth(i).locator('rect').first();
      await expect(first).toHaveCount(1);
      expect(overlaps(captionBox, await box(first)), `caption over component ${i}`).toBe(false);
    }
    expect(preview.text.join(' ')).not.toMatch(/archdrawer|made with/i); expect(preview.text.join(' ')).toContain('A human can stop the order.');
    for (const label of ['Client app', 'API', 'Service', 'Data store', 'AI agent', 'Check', 'Background job', 'Monitoring']) expect(preview.text.filter(t => t === label)).toHaveLength(1);
    // The api part is a panel holding two items: it is drawn as the plain card of its kind (a port), with its sub-line row, and no row.
    const api = preview.nodes.find(n => n.id === 'api')!;
    expect([api.width, api.height]).toEqual([cardSize('port').width, cardSize('port').height]);
    expect(api.text).not.toContain('Validate order');
    await readability(format.w, format.seen);
    const svgPath = join(dir, `${format.name}-${theme}.svg`), result = await download(page, 'download-svg', svgPath);
    expect(result.suggestedFilename()).toBe(`share-shop-overview-${format.name}.svg`);
    await sameImages(page, previewMarkup, await readFile(svgPath, 'utf8'), 'web');
    const pngPath = join(dir, `${format.name}-${theme}.png`), pngDownload = await download(page, 'download-png', pngPath);
    expect(pngDownload.suggestedFilename()).toBe(`share-shop-overview-${format.name}.png`); const png = await readFile(pngPath);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(png.readUInt32BE(16)).toBe(format.w * 2); expect(png.readUInt32BE(20)).toBe(format.h * 2);
  }
  // Changing the format resets the toggles to that format's start: Square starts with the short set.
  await page.getByTestId('format-readme').click(); await page.getByTestId('format-square').click();
  await expectToggles(page, SIMPLE_TOGGLES);
  await page.getByTestId('show-title').uncheck(); await page.getByTestId('show-steps').uncheck(); await page.getByTestId('show-texts').uncheck();
  const withSub = await svgInfo(page, await previewSVG(page));
  expect(withSub.text.join(' ')).not.toContain(source.caption.title); expect(withSub.text.join(' ')).toContain(source.caption.lede);
  for (const absent of ['A human can stop the order.', 'Validate order', 'branch A', 'Client app', 'API', 'Data store']) expect(withSub.text).not.toContain(absent);
  // Sub-lines are on: the card keeps its sub-line row (108). Switching show-sub off in the dialog shrinks every card by that row (90) and only in the image.
  expect(withSub.nodes.find(n => n.id === 'api')!.height).toBe(cardSize('port').height);
  await page.getByTestId('show-sub').uncheck();
  const withoutSub = await svgInfo(page, await previewSVG(page));
  expect(withoutSub.nodes.find(n => n.id === 'api')!.height).toBe(cardSize('port', { subLine: false }).height);
  expect(withoutSub.nodes.find(n => n.id === 'api')!.height).toBeLessThan(108); await readability(1080, 552);
  expect(await readFile(file, 'utf8')).toBe(original); // Export settings have not edited any view.

  // The LinkedIn size: portrait 1080 × 1350, drawn from the view itself; nothing is added to the file.
  await page.getByTestId('format-feed').click(); await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1080'); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
  await expectToggles(page, ['title', 'lede', 'sub', 'steps', 'labels', 'texts']); // feed: description on, colour key off, sub-lines as the view's switch
  await readability(1080, 552);
  const feedSVG = join(dir, 'feed.svg'), feedDownload = await download(page, 'download-svg', feedSVG);
  expect(feedDownload.suggestedFilename()).toBe('share-shop-overview-feed.svg');
  const feed = await svgInfo(page, await readFile(feedSVG, 'utf8')); expect(feed).toMatchObject({ width: 1080, height: 1350, format: 'feed', forbidden: false, error: false });
  expect(feed.text.join(' ')).not.toMatch(/archdrawer|made with/i);
  const feedPNG = join(dir, 'feed.png'); await download(page, 'download-png', feedPNG); const png = await readFile(feedPNG);
  expect(png.readUInt32BE(16)).toBe(2160); expect(png.readUInt32BE(20)).toBe(2700);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.getByTestId('copy-image').click(); await expect(page.getByTestId('toast')).toContainText(/copied|not allowed/i);
  if (/copied/i.test(await page.getByTestId('toast').innerText())) expect(await page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png')))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  // Must not happen: the dialog's sub-line switch editing the view, or any export setting writing the drawing.
  expect(await readDrawn(file)).toEqual(source); expect(await readFile(file, 'utf8')).toBe(original);
});
