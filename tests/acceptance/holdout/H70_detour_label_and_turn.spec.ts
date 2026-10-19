import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, download, settledReport, type View } from './helpers';
import { checkBorders, entersBox } from './helpers-v8';
import { checkDrawingFit } from './helpers-v9';
import { checkNearestMiddle, checkCap, checkClear, checkHorizontalObstruction, smoothConnection } from './helpers-v13';
import { inDrawingFonts } from './helpers-v5';

// ADR 0015 / diagram-v2 replaces the title's historical longest-straight-run rule:
// "A connection's label, and its step badge, take the free spot nearest the middle of its curve."

test('H70 [LAY-4, LAY-5, SHR-6, SHR-10] centre a detour label on its longest free straight run and keep the portrait turn clear', async ({ page, request }) => {
  const cases = ['obstacle', 'portrait'] as const; expect(cases).toHaveLength(2);
  for (const kind of cases) {
    const doc = drawing(`Detour ${kind}`);
    const view: View = kind === 'obstacle' ? {
      id: 'overview', title: 'Detour', caption: { title: 'Go around a part', lede: '' }, texts: [],
      nodes: [component('start', { label: 'Start', form: 'compact', x: 0, y: 240 }),
        component('obstacle', { label: 'Other work', x: 480, y: 200 }),
        component('end', { label: 'End', form: 'compact', x: 960, y: 240 })],
      edges: [{ id: 'detour', from: 'start', to: 'end', label: 'continue', style: 'call', both: false, step: null }],
    } : {
      id: 'turn-post', title: 'Post', postOf: 'overview', caption: { title: 'Turn back', lede: '' }, texts: [],
      nodes: [0, 1, 2, 3, 4].map(i => component(`spine-${i}`, { label: `Stage ${String.fromCharCode(65 + i)}`, lane: { spine: i } })),
      edges: [0, 1, 2, 3].map(i => ({ id: i === 2 ? 'detour' : `spine-edge-${i}`, from: `spine-${i}`, to: `spine-${i + 1}`,
        label: '', style: 'call', both: false, step: null })),
    };
    if (kind === 'portrait') {
      for (const id of ['audit', 'cache', 'queue']) view.nodes.push(component(id, { label: 'Side work', lane: { anchor: 'spine-2', side: 'below' } }));
      doc.views.push(view);
    } else doc.views[0] = view;
    const { dir, file } = await workspace(`h70-${kind}`, doc); await openDrawing(page, request, file);
    if (kind === 'portrait') { await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${view.id}`).click(); }
    const baseline = await readFile(file, 'utf8'); await page.getByTestId('share-button').click();
    await page.getByTestId(kind === 'portrait' ? 'format-feed' : 'format-readme').click();
    if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
    for (const id of ['title', 'lede', 'legend', 'texts']) await page.getByTestId(`show-${id}`).uncheck();
    for (const id of ['items', 'steps', 'labels']) await page.getByTestId(`show-${id}`).check();
    const report = await settledReport(page);
    expect(report).toMatchObject({ view: view.id, parts: view.nodes.length, zones: 0, connections: view.edges.length });
    const out = join(dir, 'detour.svg'); await download(page, 'download-svg', out);
    await inDrawingFonts(page, await readFile(out, 'utf8'), async surface => {
      const geometry = await smoothConnection(surface, 'detour', kind === 'obstacle' ? 'start' : 'spine-2', kind === 'obstacle' ? 'end' : 'spine-3');
      expect(geometry.checked).toBeGreaterThan(0); expect(geometry.scale).toBeGreaterThan(0);
      expect(geometry.nodes).toHaveLength(view.nodes.length);
      const node = (id: string) => { const found = geometry.nodes.find(n => n.id === id); expect(found, id).toBeTruthy(); return found!.box; };
      if (kind === 'obstacle') {
        const obstacle = node('obstacle'), labels = geometry.labels.filter(t => t.text.trim() === 'continue'); expect(labels).toHaveLength(1); const label = labels[0].box;
        checkHorizontalObstruction(geometry, obstacle);
        checkClear(geometry, geometry.nodes.map(n => n.box));
        expect(geometry.routes.some(points => points.some(p => p.y < obstacle.top || p.y > obstacle.bottom)), 'the route actually detours').toBe(true);
        let freeChecks = 0;
        for (const part of geometry.nodes) {
          freeChecks++;
          expect(label.left < part.box.right && label.right > part.box.left && label.top < part.box.bottom && label.bottom > part.box.top,
            `the curve's label stays clear of ${part.id}`).toBe(false);
        }
        expect(freeChecks).toBe(3);
        checkNearestMiddle(geometry, label, []); checkCap(geometry);
        expect(report.cut).toBe(0);
      } else {
        const before = node('spine-2'), after = node('spine-3'); expect(after.top).toBeGreaterThanOrEqual(before.bottom);
        // Equal-width cards expose the lane columns; five spine parts return right-to-left.
        const width = before.right - before.left;
        expect(width).toBeGreaterThan(0);
        for (const part of geometry.nodes) expect((part.box.right - part.box.left) / width).toBeCloseTo(1, 5);
        const first = node('spine-0'), second = node('spine-1');
        const pitch = second.left - first.left;
        expect((pitch - width) / geometry.scale).toBeCloseTo(24, 5);
        expect((before.left - second.left) / pitch).toBeCloseTo(1, 5);
        expect(node('spine-4').left).toBeLessThan(after.left);
        const satellites = geometry.nodes.filter(n => ['audit', 'cache', 'queue'].includes(n.id)); expect(satellites).toHaveLength(3);
        const intervening = satellites.filter(n => n.box.top >= before.bottom && n.box.bottom <= after.top);
        expect(intervening.length, 'an occupied satellite row lies between the turn ends').toBeGreaterThan(0);
        // The contract removed whole-column reservation: the drawn line goes around intervening parts.
        const epsilon = geometry.scale * 0.3; let checks = 0, rowChecks = 0;
        let firstViolation: { part: string; segment: { x: number; y: number }[] } | null = null;
        for (const points of geometry.routes) for (let i = 1; i < points.length; i++) {
          for (const part of intervening) {
            checks++;
            if (!firstViolation && entersBox(points[i - 1], points[i], part.box, epsilon)) firstViolation = { part: part.id, segment: [points[i - 1], points[i]] };
            if (Math.max(points[i - 1].y, points[i].y) > part.box.top && Math.min(points[i - 1].y, points[i].y) < part.box.bottom) rowChecks++;
          }
        }
        expect(firstViolation, 'first part entered by the turn').toBe(null);
        expect(checks).toBeGreaterThan(0); expect(rowChecks, 'the drawn turn traverses an occupied row').toBeGreaterThan(0);
        checkBorders(geometry);
        await checkDrawingFit(surface, geometry);
      }
    });
    expect(await readFile(file, 'utf8')).toBe(baseline);
  }
});
