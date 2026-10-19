import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, readDrawing, baseURL, download, type View } from './helpers';
import { noUnrelatedOverlap } from './helpers-v5';
import { drawnNodeBoxes } from './helpers-v9';

test('H78 [DEP-5, LAY-1, LAY-5, SHR-6, SHR-10] place a side-lane zone as one unit and anchor an outside satellite on a zone first member', async ({ page, request }) => {
  let styles = 0, memberChecks = 0;
  for (const post of [false, true]) {
    const doc = drawing('Zone side relations');
    const view: View = { id: post ? 'side-post' : 'overview', title: 'Zone lanes', postOf: post ? 'overview' : null,
      caption: { title: 'Zone lanes', lede: '' }, edges: [], texts: [],
      // Three spine members keep these relations comparable without a portrait return band.
      nodes: [component('anchor', { label: 'Anchor', lane: { spine: 0 } }),
        component('side-zone', { label: 'Side work', form: 'group', lane: { anchor: 'anchor', side: 'below' } }),
        component('side-first', { label: 'Side first', parent: 'side-zone', lane: { spine: 0 } }),
        component('side-last', { label: 'Side last', parent: 'side-zone', lane: { spine: 1 } }),
        component('side-watch', { label: 'Side watch', parent: 'side-zone', lane: { anchor: 'side-first', side: 'above' } }),
        component('main-zone', { label: 'Runtime', form: 'group', lane: { spine: 1 } }),
        component('main-first', { label: 'Runtime first', parent: 'main-zone', lane: { spine: 1 } }),
        component('main-last', { label: 'Runtime last', parent: 'main-zone', lane: { spine: 2 } }),
        component('zone-satellite', { label: 'Outside watch', lane: { anchor: 'main-zone', side: 'above' } })] };
    if (post) doc.views.push(view); else doc.views[0] = view;
    const { dir, file } = await workspace(`h78-${post}`, doc), opened = await openDrawing(page, request, file);
    const stored = (await readDrawing(file)).views.find(v => v.id === view.id)!; expect(stored.nodes).toHaveLength(9);
    const bytes = await readFile(file, 'utf8');
    if (post) { await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${view.id}`).click(); }
    const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=${view.id}&format=${post ? 'linkedin' : 'readme'}`);
    expect(response.status()).toBe(200);
    const holder = await page.context().newPage();
    try {
      const checkSurface = async (surface: Locator) => {
        const boxes = await drawnNodeBoxes(surface); expect(boxes).toHaveLength(9); noUnrelatedOverlap(stored, boxes);
        const node = (id: string) => { const result = boxes.find(b => b.nodeId === id); expect(result, id).toBeTruthy(); return result!; };
        const anchor = node('anchor'), unit = node('side-zone'), insideFirst = node('side-first'), insideLast = node('side-last');
        expect(unit.y, 'the whole side zone is below its anchor').toBeGreaterThanOrEqual(anchor.y + anchor.height);
        expect(Math.max(unit.x, anchor.x), 'the unit sits beside the anchor column').toBeLessThan(Math.min(unit.x + unit.width, anchor.x + anchor.width));
        expect(insideFirst.x).toBeLessThan(insideLast.x);
        expect(Math.max(insideFirst.y, insideLast.y)).toBeLessThan(Math.min(insideFirst.y + insideFirst.height, insideLast.y + insideLast.height));
        const watch = node('side-watch'); expect(watch.y + watch.height).toBeLessThanOrEqual(insideFirst.y);
        const main = ['anchor', 'main-first', 'main-last'].map(node); expect(main).toHaveLength(3);
        for (let i = 1; i < main.length; i++) {
          expect(main[i].x).toBeGreaterThan(main[i - 1].x);
          expect(Math.max(main[i].y, main[0].y)).toBeLessThan(Math.min(main[i].y + main[i].height, main[0].y + main[0].height));
        }
        const firstMember = node('main-first'), secondMember = node('main-last'), satellite = node('zone-satellite');
        expect(satellite.y + satellite.height).toBeLessThanOrEqual(firstMember.y);
        // There is only one outside satellite and a free above cell: its column belongs to the first member, not the aggregate zone centre.
        expect(Math.max(satellite.x, firstMember.x)).toBeLessThan(Math.min(satellite.x + satellite.width, firstMember.x + firstMember.width));
        expect(satellite.x + satellite.width).toBeLessThanOrEqual(secondMember.x);
        const zones = stored.nodes.filter(n => n.form === 'group'); expect(zones).toHaveLength(2);
        for (const zone of zones) {
          const outer = node(zone.id), members = stored.nodes.filter(n => n.parent === zone.id); expect(members.length).toBeGreaterThan(0);
          for (const member of members) {
            memberChecks++; const inner = node(member.id);
            expect(inner.x).toBeGreaterThanOrEqual(outer.x); expect(inner.y).toBeGreaterThanOrEqual(outer.y);
            expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.001);
            expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.001);
          }
        }
        styles++;
      };
      await checkSurface(page.getByTestId('canvas'));
      await holder.setContent(`<!doctype html><html><body style="margin:0">${await response.text()}</body></html>`);
      await holder.evaluate(async () => { await document.fonts.ready; });
      await checkSurface(holder.locator('svg'));
      await page.getByTestId('share-button').click();
      if (post && await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
      await page.getByTestId(post ? 'format-linkedin' : 'format-readme').click();
      await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', view.id);
      await checkSurface(page.getByTestId('share-preview'));
      const out = join(dir, 'side-lanes.svg'); await download(page, 'download-svg', out);
      await holder.setContent(`<!doctype html><html><body style="margin:0">${await readFile(out, 'utf8')}</body></html>`);
      await holder.evaluate(async () => { await document.fonts.ready; });
      await checkSurface(holder.locator('svg'));
    } finally { await holder.close(); }
    expect(await readFile(file, 'utf8')).toBe(bytes);
  }
  expect(styles).toBe(8); expect(memberChecks).toBe(40);
});
