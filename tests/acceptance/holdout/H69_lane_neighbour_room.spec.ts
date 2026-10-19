import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, download, svgInfo, svgBoxes, settledReport, type View } from './helpers';

test('H69 [LAY-1, LAY-5, LAY-6, LAY-7, SHR-10] reserve column, badge and drawn-label room between lane neighbours', async ({ page, request }) => {
  const cases = [
    { post: false, vertical: false, label: '', step: null, base: true },
    { post: true, vertical: false, label: '', step: null, base: true },
    { post: true, vertical: false, label: '', step: 1, base: false },
    { post: true, vertical: true, label: '', step: 1, base: false },
    { post: true, vertical: false, label: 'Keep the complete delivery record', step: null, base: false },
    { post: true, vertical: true, label: 'Review', step: null, base: false },
  ];
  expect(cases).toHaveLength(6);
  for (const [index, input] of cases.entries()) {
    const doc = drawing(`Neighbour room ${index}`); doc.showSteps = true;
    const view: View = { id: input.post ? 'room-post' : 'overview', title: 'Room', postOf: input.post ? 'overview' : null,
      caption: { title: 'Neighbour room', lede: '' }, texts: [],
      nodes: [component('left', { label: 'First', lane: { spine: 0 } }),
        component('right', { label: 'Next', lane: input.vertical ? { anchor: 'left', side: 'below' } : { spine: 1 } })],
      edges: input.base ? [] : [{ id: 'room-edge', from: 'left', to: 'right', label: input.label, style: 'call', both: false, step: input.step }] };
    if (input.post) doc.views.push(view); else doc.views[0] = view;
    const { dir, file } = await workspace(`h69-${index}`, doc); await openDrawing(page, request, file);
    if (input.post) { await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${view.id}`).click(); }
    const baseline = await readFile(file, 'utf8'); await page.getByTestId('share-button').click();
    // Wide has one band and re-places post geometry from lanes; README measures the ordinary view.
    if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
    await page.getByTestId(input.post ? 'format-linkedin' : 'format-readme').click();
    for (const id of ['title', 'lede', 'legend', 'texts']) await page.getByTestId(`show-${id}`).uncheck();
    for (const id of ['items', 'steps', 'labels']) await page.getByTestId(`show-${id}`).check();
    const report = await settledReport(page);
    expect(report).toMatchObject({ view: view.id, parts: 2, zones: 0, connections: input.base ? 0 : 1 });
    const out = join(dir, 'room.svg'); await download(page, 'download-svg', out);
    const svg = await readFile(out, 'utf8'), info = await svgInfo(page, svg);
    const shapes = await svgBoxes(page, svg, 'g[data-node-id]'); expect(shapes).toHaveLength(2);
    const a = shapes.find(s => s.nodeId === 'left')!, b = shapes.find(s => s.nodeId === 'right')!;
    const scale = a.width / info.nodes.find(n => n.id === 'left')!.width; expect(scale).toBeGreaterThan(0);
    const gap = (input.vertical ? b.y - a.y - a.height : b.x - a.x - a.width) / scale;
    expect(gap).toBeGreaterThan(0);
    if (input.base) expect(gap, 'no badge or label enlarges the 24 px column gap').toBeCloseTo(24, 5);
    if (input.step !== null) {
      const numbers = (await svgBoxes(page, svg, 'g[data-edge-id] text')).filter(t => t.text === '1');
      expect(numbers).toHaveLength(1);
      expect(gap, 'post badge radius is 11.5; neighbouring parts leave 2(r + 3) + 28').toBeGreaterThanOrEqual(2 * (11.5 + 3) + 28 - 0.001);
    }
    if (input.label) {
      const labels = (await svgBoxes(page, svg, 'g[data-edge-id] text')).filter(t => t.text === input.label);
      expect(labels).toHaveLength(1); expect(report.cut).toBe(0);
      const label = labels[0], size = (input.vertical ? label.height : label.width) / scale;
      expect(size).toBeGreaterThan(0);
      expect(gap, 'a drawn label gets its measured dimension plus 16 px').toBeGreaterThanOrEqual(size + 16 - 0.001);
    }
    expect(await readFile(file, 'utf8')).toBe(baseline);
  }
});
