import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, component, workspace, openDrawing, readDrawing, previewBoxes, svgBoxes, baseURL, overlaps, type View, type Shape } from './helpers';
import { noUnrelatedOverlap } from './helpers-v5';

test('H65 [LAY-1, LAY-5, DEP-5, SHR-3, SHR-10] span outer cells with two zones and keep outside satellites out of both boxes', async ({ page, request }) => {
  const doc = drawing('Two zones'), view = doc.views[0];
  view.nodes = [
    component('first', { label: 'First', lane: { spine: 0 } }),
    component('zone-a', { label: 'Zone A', form: 'group', lane: { spine: 1 } }),
    component('a-start', { label: 'A start', parent: 'zone-a', lane: { spine: 1 } }),
    component('a-end', { label: 'A end', parent: 'zone-a', lane: { spine: 2 } }),
    component('a-check', { label: 'A check', parent: 'zone-a', lane: { anchor: 'a-end', side: 'below' } }),
    component('zone-b', { label: 'Zone B', form: 'group', lane: { spine: 3 } }),
    component('b-start', { label: 'B start', parent: 'zone-b', lane: { spine: 3 } }),
    component('b-end', { label: 'B end', parent: 'zone-b', lane: { spine: 4 } }),
    component('b-check', { label: 'B check', parent: 'zone-b', lane: { anchor: 'b-start', side: 'above' } }),
    component('last', { label: 'Last', lane: { spine: 5 } }),
    component('outside', { label: 'Outside', lane: { anchor: 'a-start', side: 'below' } }),
  ];
  view.edges = []; view.caption = { title: 'Two zones span their members', lede: '' };
  const post: View = structuredClone(view); post.id = 'two-zones-post'; post.title = 'Post'; post.postOf = view.id;
  for (const node of post.nodes) {
    node.id = `post-${node.id}`;
    if (node.parent) node.parent = `post-${node.parent}`;
    if (node.lane && 'anchor' in node.lane) node.lane.anchor = `post-${node.lane.anchor}`;
  }
  doc.views.push(post);
  const { file } = await workspace('h65', doc), opened = await openDrawing(page, request, file);
  const stored = await readDrawing(file), baseline = await readFile(file, 'utf8');
  function check(placed: View, shapes: Shape[], portrait = false) {
    noUnrelatedOverlap(placed, shapes);
    const byId = (id: string) => { const found = shapes.find(b => b.nodeId === id); expect(found, id).toBeTruthy(); return found!; };
    const zones = placed.nodes.filter(n => n.form === 'group'); expect(zones).toHaveLength(2);
    let memberChecks = 0, outsideChecks = 0, zonePairs = 0;
    for (const zone of zones) {
      const outer = byId(zone.id), members = placed.nodes.filter(n => n.parent === zone.id);
      expect(members.length).toBeGreaterThan(1);
      for (const member of members) {
        memberChecks++; const inner = byId(member.id);
        expect(inner.x).toBeGreaterThanOrEqual(outer.x); expect(inner.y).toBeGreaterThanOrEqual(outer.y);
        expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.001);
        expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.001);
      }
      const outsiders = placed.nodes.filter(n => n.id !== zone.id && n.parent !== zone.id);
      expect(outsiders.length).toBeGreaterThan(0);
      for (const outsider of outsiders) { outsideChecks++; expect(overlaps(outer, byId(outsider.id)), `${zone.id}/${outsider.id}`).toBe(false); }
    }
    for (const [i, a] of zones.entries()) for (const b of zones.slice(i + 1)) { zonePairs++; expect(overlaps(byId(a.id), byId(b.id))).toBe(false); }
    expect(memberChecks).toBeGreaterThan(0); expect(outsideChecks).toBeGreaterThan(0); expect(zonePairs).toBe(1);
    const spine = placed.nodes.filter(n => n.form !== 'group' && n.lane && 'spine' in n.lane)
      .sort((a, b) => (a.lane as { spine: number }).spine - (b.lane as { spine: number }).spine);
    expect(spine).toHaveLength(6);
    for (let i = 1; i < spine.length; i++) {
      const a = byId(spine[i - 1].id), b = byId(spine[i].id);
      if (portrait && i === 3) {
        expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      } else {
        if (portrait && i > 3) expect(a.x).toBeGreaterThan(b.x);
        else expect(a.x).toBeLessThan(b.x);
        expect(Math.max(a.y, b.y)).toBeLessThan(Math.min(a.y + a.height, b.y + b.height));
      }
    }
    const satellites = placed.nodes.filter(n => n.lane && 'anchor' in n.lane); expect(satellites).toHaveLength(3);
    for (const node of satellites) {
      const lane = node.lane as { anchor: string; side: string }, side = byId(node.id), anchor = byId(lane.anchor);
      if (lane.side === 'below') expect(side.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
      else expect(side.y + side.height).toBeLessThanOrEqual(anchor.y);
    }
  }
  const exported = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
  expect(exported.status()).toBe(200); check(stored.views[0], await svgBoxes(page, await exported.text(), 'g[data-node-id]'));
  await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${post.id}`).click();
  await page.getByTestId('share-button').click(); await page.getByTestId('share-advanced-toggle').click();
  await page.getByTestId('format-linkedin').click(); await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1620');
  check(stored.views[1], await previewBoxes(page, 'g[data-node-id]'));
  await page.getByTestId('format-feed').click();
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  // First / A start / A end consume three real cells; B start must begin the return band.
  // Treating Zone A as one aggregate cell would keep B start in the first band.
  check(stored.views[1], await previewBoxes(page, 'g[data-node-id]'), true);
  expect(await readFile(file, 'utf8')).toBe(baseline);
});
