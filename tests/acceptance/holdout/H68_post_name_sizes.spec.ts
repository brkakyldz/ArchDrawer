import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, readDrawing, download, svgInfo, type View } from './helpers';
import { visibleTextSizes, checkReadability } from './helpers-v5';

test('H68 [LAY-1, SHR-3, SHR-6, SHR-10] draw larger post names across all forms and make room for a second card line', async ({ page, request }) => {
  const doc = drawing('Post typography'); doc.showSteps = true;
  const post: View = { id: 'name-post', title: 'Post', postOf: 'overview', caption: { title: 'Post names', lede: '' }, texts: [],
    nodes: [component('short', { label: 'Request', sub: 'Start here', x: 0, y: 0 }),
      component('wrapped', { label: 'Request validation service', sub: 'Then continue', x: 400, y: 0 }),
      component('panel', { label: 'Review', form: 'panel', sub: 'Check the work', items: ['Scope check', 'Keep evidence'], x: 800, y: 0 }),
      component('zone', { label: 'Runtime zone', form: 'group' }),
      component('compact', { label: 'Worker', form: 'compact', sub: 'Handle work', parent: 'zone', x: 800, y: 300 })],
    edges: [{ id: 'names-edge', from: 'short', to: 'wrapped', label: 'continue', style: 'call', both: false, step: 1 }] };
  doc.views.push(post);
  const { dir, file } = await workspace('h68', doc); await openDrawing(page, request, file);
  await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${post.id}`).click();
  const baseline = await readFile(file, 'utf8'), stored = (await readDrawing(file)).views.find(v => v.id === post.id)!;
  expect(stored.nodes).toHaveLength(5);
  await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  for (const id of ['title', 'lede', 'legend', 'texts']) await page.getByTestId(`show-${id}`).uncheck();
  for (const id of ['items', 'steps', 'labels']) await page.getByTestId(`show-${id}`).check();
  await checkReadability(page, 1600, 880);
  const out = join(dir, 'names.svg'); await download(page, 'download-svg', out);
  const svg = await readFile(out, 'utf8'), info = await svgInfo(page, svg);
  expect(info.nodes).toHaveLength(5); expect(info.edges).toHaveLength(1);
  const holder = await page.context().newPage();
  try {
    await holder.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await holder.evaluate(async () => { await document.fonts.ready; });
    const measured = await visibleTextSizes(holder.locator('svg'), stored);
    const names = measured.runs.filter(r => r.name), details = measured.runs.filter(r => !r.name);
    expect(names.length).toBeGreaterThanOrEqual(stored.nodes.length); expect(details.length).toBeGreaterThan(0);
    for (const node of stored.nodes) {
      const runs = names.filter(r => r.nodeId === node.id); expect(runs.length, node.id).toBeGreaterThan(0);
      for (const run of runs) expect(run.font, `${node.id}/${run.text}`).toBe(node.form === 'compact' ? 15 : 16.5);
      if (node.form !== 'compact') {
        for (const run of runs) expect(run.weight, node.id).toBe(600);
      }
    }
    for (const run of details) expect(run.font, run.text).toBeGreaterThanOrEqual(12.5);
    const twoLines = new Set(names.filter(r => r.nodeId === 'wrapped').flatMap(r => r.lineYs));
    expect(twoLines.size, 'the authored long name exercises the second-line rule').toBeGreaterThan(1);
    expect(info.nodes.find(n => n.id === 'wrapped')!.height).toBe(84 + 20);
    expect(info.nodes.find(n => n.id === 'short')!.height).toBe(84);
    expect(info.nodes.find(n => n.id === 'panel')!.height).toBe(14 + 22 + 16 + 6 + 19 * 2 + 1);
  } finally { await holder.close(); }
  // Names on the editor use the same intrinsic sizes, regardless of its zoom.
  await page.getByTestId('share-close').click();
  for (const node of stored.nodes) {
    const label = page.getByTestId(`node-${node.id}`).getByTestId('node-label'); await expect(label).toHaveCount(1);
    const runs = await label.evaluate(el => {
      const elements = [el, ...Array.from(el.querySelectorAll('text, tspan'))];
      return elements.filter(t => Array.from(t.childNodes).some(run => run.nodeType === Node.TEXT_NODE && run.textContent?.trim()))
        .map(t => ({ font: parseFloat(getComputedStyle(t).fontSize), weight: Number(getComputedStyle(t).fontWeight) }));
    });
    expect(runs.length, node.id).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.font, node.id).toBe(node.form === 'compact' ? 15 : 16.5);
      if (node.form !== 'compact') expect(run.weight, node.id).toBe(600);
    }
  }
  expect(await readFile(file, 'utf8')).toBe(baseline);
});
