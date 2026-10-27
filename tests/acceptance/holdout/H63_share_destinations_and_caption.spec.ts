import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, previewSVG, svgInfo, svgBoxes, overlaps, download } from './helpers';
import { checkReadability } from './helpers';
import { visibleTextContent } from './helpers-svg-parity';
import { readDrawn, drawnRoutes, expectSameRoutes, expectSameBoxes, inspectImage, SHARE_TOGGLES } from './helpers-drawing';

// Reach a toggle state with the show-* checkboxes under "Advanced options" (the presets are gone). There is no show-items;
// show-sub (Sub-lines) starts as the view's switch, which is on in this drawing.
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

test('H63 [SHARE-1 LAYOUT-1 LAYOUT-3 LOOK-3 LOOK-4 #177 #170] share a full ordinary view for three destinations with a wrapped caption, sub-lines as the dialog says and explicit clipping warning', async ({ page, request }) => {
  const doc = drawing('Partner handoff'), source = doc.views[0];
  source.caption.title = 'How the request reaches the partner team through the intake, the stored record and the final delivery service';
  source.caption.lede = 'Each request is checked before it is stored, then the partner receives the result with enough context to continue the work.';
  const longLabel = 'W'.repeat(48), longSub = 'M'.repeat(60);
  source.nodes.push(component('crowded', { label: longLabel, sub: longSub, form: 'compact', place: { row: -1, col: 1 } }));
  source.edges.push({ id: 'handoff', from: 'api', to: 'crowded', label: 'Send context', style: 'async', both: false, step: null });
  const { dir, file } = await workspace('h63', doc); await openDrawing(page, request, file);
  const baseline = await readDrawn(file), bytes = await readFile(file, 'utf8');
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toHaveAttribute('role', 'dialog');
  const choices = [['readme', 1600, 900, 880], ['slide', 1920, 1080, 1280], ['square', 1080, 1080, 552]] as const;
  for (const [format, width, height, seen] of choices) {
    await page.getByTestId(`format-${format}`).click();
    await expectToggles(page, format === 'square' ? SIMPLE_TOGGLES : DETAILED_TOGGLES); // the starting toggles of this format
    await expect(page.getByTestId('show-items')).toHaveCount(0);
    await setToggles(page, SIMPLE_TOGGLES);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
    await expect(page.getByTestId('share-size')).toHaveText(`${width} × ${height}`);
    const preview = await previewSVG(page), info = await svgInfo(page, preview);
    expect(info).toMatchObject({ width, height, format, forbidden: false, error: false });
    expect(info.nodes.map(n => n.id).sort()).toEqual(baseline.nodes.map(n => n.id).sort());
    expect(info.edges.map(e => e.id).sort()).toEqual(baseline.edges.map(e => e.id).sort());
    // Neutral lines, except the numbered connections (diagram contract, Colour).
    const tones = new Map((await inspectImage(page, preview)).edges.map(e => [e.id, e.tone] as const));
    for (const edge of baseline.edges) expect(tones.get(edge.id!), `${format}: ${edge.id}`).toBe(edge.step === null ? 'neutral' : 'kind');
    const compact = (text: string) => text.replace(/\s/g, '');
    const captions = await svgBoxes(page, preview, 'text:not(g[data-node-id] text):not(g[data-edge-id] text):not(g[data-group-head] text)');
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
      const exportedCaptions = await svgBoxes(page, downloaded, 'text:not(g[data-node-id] text):not(g[data-edge-id] text):not(g[data-group-head] text)');
      expect(exportedCaptions.length).toBeGreaterThan(0);
      const exportedProse = compact(exportedCaptions.sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text).join(''));
      expect(exportedProse).toContain(compact(source.caption.title)); expect(exportedProse).toContain(compact(source.caption.lede));
      expect(baseline.edges.length).toBeGreaterThan(0);
      // The same cubics in the preview and the download (read as cubics: a shaped part may end a line on its outline).
      const shown = await drawnRoutes(page.getByTestId('share-preview'), 'web'), saved = await drawnRoutes(holder.locator('svg'), 'web');
      expectSameBoxes(shown, saved, format); expectSameRoutes(shown, saved, format);
    } finally { await holder.close(); }
  }
  await expectToggles(page, SIMPLE_TOGGLES);
  await setToggles(page, DETAILED_TOGGLES); await expectToggles(page, DETAILED_TOGGLES);
  await page.getByTestId('share-theme-dark').click(); expect((await svgInfo(page, await previewSVG(page))).theme).toBe('dark');
  // Drive focus beyond one complete cycle in both directions; it never reaches the editor.
  const controls = await page.getByTestId('share-dialog').locator('button:visible, input:visible, select:visible, textarea:visible').count();
  expect(controls).toBeGreaterThan(0);
  for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i <= controls; i++) {
    await page.keyboard.press(key);
    expect(await page.getByTestId('share-dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.getByTestId('share-close').click(); await expect(page.getByTestId('share-button')).toBeFocused();
  // Must not happen: the dialog's toggles (sub-lines included) writing the drawing.
  expect(await readFile(file, 'utf8')).toBe(bytes); expect(await readDrawn(file)).toEqual(baseline);
  // A cleared drawing is never called good: H64's.
});
