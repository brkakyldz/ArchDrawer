import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, component, workspace, openDrawing, svgInfo, baseURL, type View } from './helpers';
import { drawnNodeBoxes } from './helpers-v9';

test('H71 [LAY-1, LAY-5, DEP-5, SHR-6, SHR-10] widen the gap after a zone whose name is wider than its members', async ({ page, request }) => {
  let checked = 0;
  for (const post of [false, true]) {
    const gaps: number[] = [], controlGaps: number[] = [];
    for (const name of ['Zone', 'W'.repeat(48)]) {
      const doc = drawing('Zone name room');
      const view: View = { id: post ? 'zone-post' : 'overview', title: 'Zone room', postOf: post ? 'overview' : null,
        caption: { title: 'Zone room', lede: '' }, texts: [], edges: [],
        nodes: [component('zone', { label: name, form: 'group', lane: { spine: 0 } }),
          component('member', { label: 'Work', parent: 'zone', lane: { spine: 0 } }),
          component('next', { label: 'Next', lane: { spine: 1 } }),
          component('control', { label: 'Neighbour', lane: { spine: 2 } })] };
      if (post) doc.views.push(view); else doc.views[0] = view;
      const { file } = await workspace(`h71-${post}-${name.length}`, doc), opened = await openDrawing(page, request, file);
      const baseline = await readFile(file, 'utf8');
      const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=${view.id}&format=${post ? 'linkedin' : 'readme'}`);
      expect(response.status()).toBe(200); const svg = await response.text(), info = await svgInfo(page, svg);
      expect(info.nodes).toHaveLength(4);
      const holder = await page.context().newPage();
      try {
        await holder.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
        await holder.evaluate(async () => { await document.fonts.ready; });
        const boxes = await drawnNodeBoxes(holder.locator('svg')); expect(boxes).toHaveLength(4);
        const byId = (id: string) => { const box = boxes.find(b => b.nodeId === id); expect(box, id).toBeTruthy(); return box!; };
        const zone = byId('zone'), member = byId('member'), next = byId('next'), control = byId('control');
        const scale = member.width / info.nodes.find(n => n.id === 'member')!.width; expect(scale).toBeGreaterThan(0);
        expect(member.x).toBeGreaterThan(zone.x); expect(member.x + member.width).toBeLessThanOrEqual(zone.x + zone.width);
        expect(next.x, 'the following column clears the zone rectangle').toBeGreaterThanOrEqual(zone.x + zone.width - scale * 0.3);
        expect(Math.max(member.y, next.y)).toBeLessThan(Math.min(member.y + member.height, next.y + next.height));
        const text = await holder.locator('g[data-node-id="zone"] text').filter({ hasText: name }).all(); expect(text).toHaveLength(1);
        const nameWidth = await text[0].evaluate(el => (el as SVGGraphicsElement).getBBox().width);
        expect(nameWidth).toBeGreaterThan(0);
        if (name.length === 48) expect(nameWidth, 'the input actually has a header wider than its member').toBeGreaterThan(info.nodes.find(n => n.id === 'member')!.width + 36);
        gaps.push((next.x - member.x - member.width) / scale);
        expect(Math.max(next.y, control.y)).toBeLessThan(Math.min(next.y + next.height, control.y + control.height));
        controlGaps.push((control.x - next.x - next.width) / scale);
        checked++;
      } finally { await holder.close(); }
      expect(await readFile(file, 'utf8')).toBe(baseline);
    }
    expect(gaps).toHaveLength(2);
    expect(gaps[1], 'a wider name widens the gap after the member column').toBeGreaterThan(gaps[0]);
    expect(controlGaps).toHaveLength(2);
    expect(controlGaps[0]).toBeGreaterThan(0);
    expect(Math.abs(controlGaps[1] - controlGaps[0]), 'the unaffected next-to-control gap stays the same').toBeLessThanOrEqual(0.3);
  }
  expect(checked).toBe(4);
});
