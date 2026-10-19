import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { compareSVGs } from './helpers-svg-parity';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, readDrawing, previewSVG, svgInfo, download, box, baseURL, reportAttributes } from './helpers';

test('H38 [SHR-7, SHR-8, SHR-1, SHR-5, SHR-6] warn about shortened text and export a group or selected parts with only their own connections', async ({ page, request }) => {
  const doc = drawing('Parts shop'), fullSub = 'W'.repeat(60); doc.views[0].nodes[0].sub = fullSub;
  doc.views[0].nodes.push(component('runtime', { label: 'Runtime', form: 'group' }),
    component('child', { label: 'Worker', parent: 'runtime', form: 'compact' }),
    component('nested', { label: 'Nested runtime', parent: 'runtime', form: 'group' }),
    component('nested-child', { label: 'Queue', parent: 'nested', kind: 'data', form: 'compact' }));
  doc.views[0].edges.push({ id: 'within-group', from: 'child', to: 'nested-child', label: 'Queue work', style: 'async', both: false, step: null },
    { id: 'outside-group', from: 'api', to: 'child', label: 'Start work', style: 'call', both: false, step: null });
  const { dir, file } = await workspace('share-parts', doc), opened = await openDrawing(page, request, file);
  const baseline = await readDrawing(file), bytes = await readFile(file, 'utf8');
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-clipped')).toContainText('Shortened in this image:');
  await expect(page.getByTestId('share-clipped-item').filter({ hasText: fullSub })).toContainText(`Web app: ${fullSub}`);
  expect((await svgInfo(page, await previewSVG(page))).nodes.find(n => n.id === 'web')!.text.join(' ')).toContain('…');
  // The layout report sits beside the readability meter in the always-visible actions row and counts what is drawn.
  const actions = page.getByTestId('share-actions'), report = actions.getByTestId('layout-report');
  await expect(report).toBeVisible(); await expect(actions.getByTestId('readability')).toBeVisible();
  const reportBox = await box(report), meterBox = await box(actions.getByTestId('readability'));
  expect(reportBox.y).toBeLessThan(meterBox.y + meterBox.height); expect(reportBox.y + reportBox.height).toBeGreaterThan(meterBox.y);
  await expect(report).toHaveAttribute('data-view', 'overview'); await expect(report).toHaveAttribute('data-format', 'readme');
  await expect(report).toHaveAttribute('data-parts', '5'); await expect(report).toHaveAttribute('data-zones', '1'); await expect(report).toHaveAttribute('data-connections', '4');
  expect((await reportAttributes(page)).cut).toBeGreaterThanOrEqual(1);
  expect(await report.getAttribute('data-level')).toBe(await actions.getByTestId('readability').getAttribute('data-level'));
  await page.getByTestId('share-part').selectOption('group:runtime');
  const expected = ['runtime', 'child', 'nested', 'nested-child'].sort();
  await expect.poll(async () => (await svgInfo(page, await previewSVG(page))).nodes.map(n => n.id).sort()).toEqual(expected);
  const groupedMarkup = await previewSVG(page), grouped = await svgInfo(page, groupedMarkup); expect(grouped.edges.map(e => e.id)).toEqual(['within-group']);
  await expect(page.getByTestId('share-clipped-item').filter({ hasText: fullSub })).toHaveCount(0); // An excluded part cannot warn about this image.
  // The report recomputes for the chosen portion: two non-group parts, one zone, one connection.
  await expect(report).toHaveAttribute('data-parts', '2'); await expect(report).toHaveAttribute('data-zones', '1'); await expect(report).toHaveAttribute('data-connections', '1');
  const groupFile = join(dir, 'group.svg'), groupDownload = await download(page, 'download-svg', groupFile);
  expect(groupDownload.suggestedFilename()).toBe('parts-shop-overview-runtime-readme.svg');
  await compareSVGs(page, groupedMarkup, await readFile(groupFile, 'utf8'), baseline.views[0].edges);
  const groupHTTP = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme&parts=runtime`);
  expect(groupHTTP.status()).toBe(200); const httpImage = await svgInfo(page, await groupHTTP.text());
  expect(httpImage.nodes.map(n => n.id).sort()).toEqual(expected); expect(httpImage.edges.map(e => e.id)).toEqual(['within-group']);
  await page.getByTestId('share-close').click(); await page.keyboard.press('Escape');
  await page.getByTestId('node-web').getByTestId('node-label').click(); await page.getByTestId('node-api').getByTestId('node-label').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('node-web')).toHaveAttribute('data-selected', 'true'); await expect(page.getByTestId('node-api')).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-part').locator('option[value="selection"]')).toHaveText('The selected parts (2)');
  await page.getByTestId('share-part').selectOption('selection');
  await expect.poll(async () => (await svgInfo(page, await previewSVG(page))).nodes.map(n => n.id).sort()).toEqual(['api', 'web']);
  const selected = await svgInfo(page, await previewSVG(page)); expect(selected.edges.map(e => e.id)).toEqual(['e1']);
  const pngFile = join(dir, 'selected.png'), pngDownload = await download(page, 'download-png', pngFile);
  expect(pngDownload.suggestedFilename()).toBe('parts-shop-overview-selection-readme.png'); const png = await readFile(pngFile);
  expect(png.readUInt32BE(16)).toBe(3200); expect(png.readUInt32BE(20)).toBe(1800);
  const selectedHTTP = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?parts=web,api&format=readme&view=overview`);
  expect(selectedHTTP.status()).toBe(200); const httpSelection = await svgInfo(page, await selectedHTTP.text());
  expect(httpSelection.nodes.map(n => n.id).sort()).toEqual(['api', 'web']); expect(httpSelection.edges.map(e => e.id)).toEqual(['e1']);
  expect((await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?parts=ghost`)).status()).toBe(400);
  expect((await readDrawing(file)).views).toEqual(baseline.views); expect(await readFile(file, 'utf8')).toBe(bytes);
});
