import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, readDrawing, previewSVG, svgInfo, svgBoxes, overlaps, download, settledReport } from './helpers';
import { checkReadability } from './helpers';
import { routeGeometry, compareRoutes, visibleTextContent } from './helpers-svg-parity';

test('H63 [SHARE-1, LAYOUT-1, LAYOUT-3] share a full ordinary view for three destinations with a wrapped caption and explicit clipping warning', async ({ page, request }) => {
  const doc = drawing('Partner handoff'), source = doc.views[0];
  source.caption.title = 'How the request reaches the partner team through the intake, the stored record and the final delivery service';
  source.caption.lede = 'Each request is checked before it is stored, then the partner receives the result with enough context to continue the work.';
  const longLabel = 'W'.repeat(48), longSub = 'M'.repeat(60);
  source.nodes.push(component('crowded', { label: longLabel, sub: longSub, form: 'compact', place: { row: -1, col: 1 } }));
  source.edges.push({ id: 'handoff', from: 'api', to: 'crowded', label: 'Send context', style: 'async', both: false, step: null });
  const { dir, file } = await workspace('h63', doc); await openDrawing(page, request, file);
  const baseline = await readDrawing(file), bytes = await readFile(file, 'utf8');
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toHaveAttribute('role', 'dialog');
  const choices = [['readme', 1600, 900, 880], ['slide', 1920, 1080, 1280], ['square', 1080, 1080, 552]] as const;
  for (const [format, width, height, seen] of choices) {
    await page.getByTestId(`format-${format}`).click(); await page.getByTestId('preset-simple').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
    await expect(page.getByTestId('share-size')).toHaveText(`${width} × ${height}`);
    const preview = await previewSVG(page), info = await svgInfo(page, preview);
    expect(info).toMatchObject({ width, height, format, forbidden: false, error: false });
    expect(info.nodes.map(n => n.id).sort()).toEqual(baseline.views[0].nodes.map(n => n.id).sort());
    expect(info.edges.map(e => e.id).sort()).toEqual(baseline.views[0].edges.map(e => e.id).sort());
    const compact = (text: string) => text.replace(/\s/g, '');
    const captions = await svgBoxes(page, preview, 'text:not(g[data-node-id] text):not(g[data-edge-id] text)');
    expect(captions.length).toBeGreaterThan(0);
    const prose = compact(captions.sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text).join(''));
    expect(prose).toContain(compact(source.caption.title)); expect(prose).toContain(compact(source.caption.lede));
    const nodes = await svgBoxes(page, preview, 'g[data-node-id]'); expect(nodes.length).toBe(4);
    for (const caption of captions) {
      expect(caption.text).not.toContain('…');
      for (const node of nodes) expect(overlaps(caption, node), caption.text).toBe(false);
    }
    await expect(page.getByTestId('share-clipped')).toBeVisible();
    const shortened = await page.getByTestId('share-clipped-item').allTextContents(); expect(shortened.length).toBeGreaterThan(0);
    expect(shortened.some(text => text.includes(longLabel) || text.includes(longSub))).toBe(true);
    const report = await checkReadability(page, width, seen);
    expect(report.parts).toBe(4); expect(report.zones).toBe(0); expect(report.connections).toBe(3);
    expect(report.cut).toBeGreaterThanOrEqual(shortened.length);
    await expect(page.getByTestId('share-actions').getByTestId('readability')).toBeVisible();
    await expect(page.getByTestId('share-actions').getByTestId('layout-report')).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });
    const previewText = await visibleTextContent(page.getByTestId('share-preview'));
    expect(previewText.length).toBeGreaterThan(0);
    const out = join(dir, `${format}.svg`); await download(page, 'download-svg', out);
    const downloaded = await readFile(out, 'utf8');
    const exportedInfo = await svgInfo(page, downloaded);
    expect(exportedInfo).toMatchObject({ width, height, format, theme: info.theme, forbidden: false, error: false, xmlns: info.xmlns });
    expect(exportedInfo.nodes.map(n => n.id).sort()).toEqual(info.nodes.map(n => n.id).sort());
    expect(exportedInfo.edges.map(e => e.id).sort()).toEqual(info.edges.map(e => e.id).sort());
    // Intrinsic sizes remain equal; fitted geometry below is compared in image coordinates.
    for (const node of info.nodes) {
      const exported = exportedInfo.nodes.find(n => n.id === node.id)!;
      expect([exported.width, exported.height]).toEqual([node.width, node.height]);
    }
    const holder = await page.context().newPage();
    try {
      await holder.setContent(`<!doctype html><html><body style="margin:0">${downloaded}</body></html>`);
      await holder.evaluate(async () => { await document.fonts.ready; });
      const exportText = await visibleTextContent(holder.locator('svg'));
      expect(exportText.length).toBeGreaterThan(0);
      // Compare complete per-component/caption content at each font, independent of text/tspan partition and child order.
      expect(exportText).toEqual(previewText);
      const exportedCaptions = await svgBoxes(page, downloaded, 'text:not(g[data-node-id] text):not(g[data-edge-id] text)');
      expect(exportedCaptions.length).toBeGreaterThan(0);
      const prose = compact(exportedCaptions.sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text).join(''));
      expect(prose).toContain(compact(source.caption.title)); expect(prose).toContain(compact(source.caption.lede));
      expect(baseline.views[0].edges.length).toBeGreaterThan(0);
      for (const edge of baseline.views[0].edges) compareRoutes(
        await routeGeometry(page.getByTestId('share-preview'), edge.id, edge.from, edge.to),
        await routeGeometry(holder.locator('svg'), edge.id, edge.from, edge.to), false, 0.3);
    } finally { await holder.close(); }
  }
  await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('show-lede')).toBeChecked(); await expect(page.getByTestId('show-items')).not.toBeChecked();
  await page.getByTestId('preset-detailed').click(); await expect(page.getByTestId('show-items')).toBeChecked();
  await expect(page.getByTestId('show-lede')).not.toBeChecked();
  await page.getByTestId('share-theme-dark').click(); expect((await svgInfo(page, await previewSVG(page))).theme).toBe('dark');
  // Drive focus beyond one complete cycle in both directions; it never reaches the editor.
  const controls = await page.getByTestId('share-dialog').locator('button:visible, input:visible, select:visible, textarea:visible').count();
  expect(controls).toBeGreaterThan(0);
  for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i <= controls; i++) {
    await page.keyboard.press(key);
    expect(await page.getByTestId('share-dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.getByTestId('share-close').click(); await expect(page.getByTestId('share-button')).toBeFocused();
  expect(await readFile(file, 'utf8')).toBe(bytes); expect((await readDrawing(file)).views).toEqual(baseline.views);
  // A cleared drawing with its caption hidden has no visible text; the meter must never call it good.
  const empty = drawing('Cleared draft'); empty.views[0].nodes = []; empty.views[0].edges = [];
  const blank = await workspace('h63-empty-image', empty); await openDrawing(page, request, blank.file);
  await page.getByTestId('share-button').click();
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  for (const id of ['title', 'lede', 'items', 'steps', 'labels', 'legend', 'texts']) await page.getByTestId(`show-${id}`).uncheck();
  await expect.poll(() => settledReport(page)).toMatchObject({ opened: 0, inPlace: 0, level: 'warn', parts: 0, zones: 0, connections: 0, longest: 0, cut: 0 });
  await expect(page.getByTestId('readability')).toHaveAttribute('data-level', 'warn');
});
