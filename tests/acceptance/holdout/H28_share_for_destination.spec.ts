import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, readDrawing, svgInfo, previewSVG, download, box, overlaps, checkReadability } from './helpers';
import { compareSVGs } from './helpers-svg-parity';

test('H28 [SHARE-1, LAYOUT-1, LAYOUT-3] preview and download an image for every destination in both themes and keep the drawing untouched', async ({ page, request, context }) => {
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
  const original = await readFile(file, 'utf8'), baseline = await readDrawing(file), source = baseline.views[0];
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('preset-detailed')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['format-feed', 'format-readme', 'format-slide', 'format-square', 'preset-simple', 'preset-detailed']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('share-advanced')).not.toBeVisible();
  await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('share-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
  for (const id of ['show-title', 'show-items', 'show-steps', 'show-labels', 'show-legend', 'show-texts']) await expect(page.getByTestId('share-advanced').getByTestId(id)).toBeChecked();
  await expect(page.getByTestId('show-lede')).not.toBeChecked();
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
    await page.getByTestId(`format-${format.name}`).click(); await page.getByTestId('preset-detailed').click(); await page.getByTestId(`share-theme-${theme}`).click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', String(format.w)); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', String(format.h));
    await expect(page.getByTestId('share-size')).toHaveText(`${format.w} × ${format.h}`);
    const previewMarkup = await previewSVG(page), preview = await svgInfo(page, previewMarkup);
    expect(preview).toMatchObject({ error: false, width: format.w, height: format.h, theme, format: format.name, xmlns: 'http://www.w3.org/2000/svg', forbidden: false });
    expect(preview.viewBox.trim().split(/[\s,]+/).map(value => Number(value) === 0 ? 0 : Number(value))).toEqual([0, 0, format.w, format.h]);
    expect(preview.nodes.map(n => n.id).sort()).toEqual(source.nodes.map(n => n.id).sort()); expect(preview.edges).toHaveLength(9);
    expect(preview.text.join(' ')).toContain(source.caption.title); expect(preview.text.join(' ')).not.toContain(source.caption.lede);
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
    await readability(format.w, format.seen);
    const svgPath = join(dir, `${format.name}-${theme}.svg`), result = await download(page, 'download-svg', svgPath);
    expect(result.suggestedFilename()).toBe(`share-shop-overview-${format.name}.svg`);
    await compareSVGs(page, previewMarkup, await readFile(svgPath, 'utf8'), source.edges);
    const pngPath = join(dir, `${format.name}-${theme}.png`), pngDownload = await download(page, 'download-png', pngPath);
    expect(pngDownload.suggestedFilename()).toBe(`share-shop-overview-${format.name}.png`); const png = await readFile(pngPath);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(png.readUInt32BE(16)).toBe(format.w * 2); expect(png.readUInt32BE(20)).toBe(format.h * 2);
  }
  await page.getByTestId('preset-simple').click();
  for (const id of ['show-title', 'show-lede', 'show-steps', 'show-texts']) await expect(page.getByTestId(id)).toBeChecked();
  for (const id of ['show-items', 'show-labels', 'show-legend']) await expect(page.getByTestId(id)).not.toBeChecked();
  await page.getByTestId('show-title').uncheck(); await page.getByTestId('show-steps').uncheck(); await page.getByTestId('show-texts').uncheck();
  const toggled = await svgInfo(page, await previewSVG(page));
  expect(toggled.text.join(' ')).not.toContain(source.caption.title); expect(toggled.text.join(' ')).toContain(source.caption.lede);
  for (const absent of ['A human can stop the order.', 'Validate order', 'branch A', 'Client app', 'API', 'Data store']) expect(toggled.text).not.toContain(absent);
  expect(toggled.nodes.find(n => n.id === 'api')!.height).toBeLessThan(108); await readability(1080, 552);
  expect(await readFile(file, 'utf8')).toBe(original); // Export settings have not edited any view.

  // The LinkedIn size: portrait 1080 × 1350, drawn from the view itself; nothing is added to the file.
  await page.getByTestId('format-feed').click(); await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1080'); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
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
  const end = await readDrawing(file); expect(end.views).toEqual(baseline.views); expect(await readFile(file, 'utf8')).toBe(original);
});
