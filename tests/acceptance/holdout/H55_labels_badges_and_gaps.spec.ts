import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, readDrawing, previewBoxes, previewSVG, download, overlaps } from './helpers';
import { badgeLabels, exportedBadgeLabels, postSwitches, checkReadability } from './helpers-v5';

test('H55 [DEP-5, LAY-5, LAY-6, LAY-7, SHR-10] hide labels without reserving their gaps and keep numbered badges clear in editor and SVG', async ({ page, request }) => {
  const doc = drawing('Dispatch'), source = doc.views[0];
  const labels = ['Submit', 'Validate', 'Dispatch', 'Record', 'Finish'];
  const post = { id: 'dispatch-post', title: 'Post', postOf: source.id,
    caption: { title: 'How dispatch works', lede: 'A request becomes a recorded delivery.' },
    nodes: labels.map((label, i) => component(`part-${i}`, { label, lane: { spine: i }, place: null })),
    edges: labels.slice(1).map((_, i) => ({ id: `dispatch-edge-${i}`, from: `part-${i}`, to: `part-${i + 1}`,
      label: ['Send the complete request', 'Start the delivery', 'Record the delivery', 'Return the receipt'][i], style: 'call', both: false, step: i + 1 })), texts: [] };
  doc.views.push(post); doc.showSteps = true;
  for (const id of ['audit', 'cache', 'queue']) post.nodes.push(component(id, { lane: { anchor: 'part-1', side: 'below' } }));
  const { dir, file } = await workspace('h55', doc); await openDrawing(page, request, file);
  await page.getByTestId('views-button').click(); await page.getByTestId('view-item-dispatch-post').click();
  // Semantic zoom hides labels below 75%; these editor checks concern actually drawn labels.
  await expect.poll(async () => {
    if (await page.getByTestId('canvas').getAttribute('data-detail') !== 'full') await page.getByTestId('zoom-in').click();
    return page.getByTestId('canvas').getAttribute('data-detail');
  }).toBe('full');
  await badgeLabels(page.getByTestId('canvas'));
  await page.getByTestId('share-button').click(); await postSwitches(page);
  const stored = (await readDrawing(file)).views.find(v => v.id === post.id)!;
  const nodesOn = await previewBoxes(page, 'g[data-node-id]'); expect(nodesOn.length).toBe(8);
  const byId = (id: string, nodes = nodesOn) => { const found = nodes.find(n => n.nodeId === id); expect(found).toBeTruthy(); return found!; };
  // Five outer units: three left-to-right, then two right-to-left.
  expect(byId('part-0').x).toBeLessThan(byId('part-1').x); expect(byId('part-1').x).toBeLessThan(byId('part-2').x);
  expect(byId('part-3').y).toBeGreaterThan(byId('part-0').y); expect(byId('part-4').x).toBeLessThan(byId('part-3').x);
  const satellites = ['audit', 'cache', 'queue'].map(id => byId(id));
  for (const a of satellites) expect(a.y).toBeGreaterThanOrEqual(byId('part-1').y + byId('part-1').height);
  for (const [i, a] of satellites.entries()) for (const b of satellites.slice(i + 1)) {
    expect(Math.max(a.y, b.y)).toBeLessThan(Math.min(a.y + a.height, b.y + b.height)); expect(a.x).not.toBe(b.x);
  }
  await badgeLabels(page.getByTestId('share-preview'));
  const drawnLabels = await previewBoxes(page, '[data-testid^="edge-label-"]'); expect(drawnLabels.length).toBeGreaterThan(0);
  for (const label of drawnLabels) for (const node of nodesOn) expect(overlaps(label, node)).toBe(false);
  const on = await checkReadability(page, 1080, 552);
  const gapRatio = (nodes: typeof nodesOn) => {
    const a = byId('part-0', nodes), b = byId('part-1', nodes);
    return (b.x - a.x - a.width) / a.width;
  };
  const withLabels = gapRatio(nodesOn), snapshot = await readFile(file, 'utf8');
  const output = join(dir, 'labelled.svg'); await download(page, 'download-svg', output);
  await exportedBadgeLabels(page, await readFile(output, 'utf8'), stored);
  await page.getByTestId('show-labels').uncheck();
  await expect(page.getByTestId('share-preview').locator('[data-testid^="edge-label-"]')).toHaveCount(0);
  const off = await checkReadability(page, 1080, 552);
  const nodesOff = await previewBoxes(page, 'g[data-node-id]'); expect(nodesOff.length).toBe(8);
  expect(gapRatio(nodesOff)).toBeLessThanOrEqual(withLabels + 0.000001);
  expect(off.cut).toBeLessThanOrEqual(on.cut);
  const hidden = await previewSVG(page);
  const actualText = await page.getByTestId('share-preview').locator('text').allTextContents(); expect(actualText.length).toBeGreaterThan(0);
  for (const edge of post.edges) expect(actualText.join(' ')).not.toContain(edge.label);
  expect(await readFile(file, 'utf8')).toBe(snapshot); // Export switches never rewrite positions.
  // A hidden non-empty label must use the same gap as the otherwise identical empty-label drawing.
  const emptyLabels = structuredClone(doc); emptyLabels.views[1].edges.forEach(e => { e.label = ''; });
  const comparison = await workspace('h55-empty-labels', emptyLabels), other = await page.context().newPage();
  try {
    await openDrawing(other, request, comparison.file); await other.getByTestId('views-button').click();
    await other.getByTestId('view-item-dispatch-post').click(); await other.getByTestId('share-button').click();
    await postSwitches(other); await other.getByTestId('show-labels').uncheck();
    await checkReadability(other, 1080, 552);
    const blank = await previewBoxes(other, 'g[data-node-id]'); expect(blank.length).toBe(8);
    expect(gapRatio(nodesOff)).toBeCloseTo(gapRatio(blank), 6);
  } finally { await other.close(); }
  await page.getByTestId('show-labels').check(); await checkReadability(page, 1080, 552);
  await badgeLabels(page.getByTestId('share-preview'));
  expect(hidden).not.toBe(await previewSVG(page));
});
