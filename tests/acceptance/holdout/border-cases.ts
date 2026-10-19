import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, download, settledReport, persisted, type View } from './helpers';
import { compareRoutes, drawingBounds, entersBox } from './helpers-v8';
import { checkRouteBorders, checkDrawingFit } from './helpers-v9';
import { smoothConnection, checkCap, checkClear, checkNearestMiddle, arcWitnesses, lineLength } from './helpers-v13';

// Same twelve border journeys, three per independent test budget; no product imports or new route rules.
export async function runBorderCases(page: Page, request: APIRequestContext, post: boolean, indices: number[]) {
  const cases = [
    { direction: 'horizontal', side: null, style: 'call' },
    { direction: 'vertical', side: null, style: 'async' },
    { direction: 'down', side: 'tie', style: 'dep' },
    { direction: 'up', side: 'tie', style: 'call' },
    { direction: 'down', side: 'left', style: 'async' },
    { direction: 'up', side: 'right', style: 'dep' },
  ] as const;
  expect(cases).toHaveLength(6); expect(indices).toHaveLength(3); let connections = 0, detours = 0, ties = 0;
  for (const index of indices) {
    const started = performance.now(), input = cases[index];
    const doc = drawing(`Border route ${post}-${index}`), horizontal = input.direction === 'horizontal', up = input.direction === 'up';
    const view: View = { id: post ? 'border-post' : 'overview', title: 'Border route', postOf: post ? 'overview' : null,
      caption: { title: 'Border route', lede: '' }, texts: [],
      nodes: [component('start', { label: 'Start', x: 0, y: up ? 600 : 0 }),
        component('end', { label: 'End', x: horizontal ? 600 : 0, y: horizontal || up ? 0 : 600 })],
      edges: [{ id: 'route', from: 'start', to: 'end', label: '', style: input.style, both: up, step: input.side ? 1 : null }] };
    if (input.side) view.nodes.push(component('obstacle', { label: 'Other work', x: 0, y: 280 }),
      component('left-bound', { label: 'Left bound', x: input.side === 'right' ? 0 : -500, y: 900 }),
      component('right-bound', { label: 'Right bound', x: input.side === 'left' ? 0 : 500, y: 1100 }));
    if (post) doc.views.push(view); else doc.views[0] = view;
    const { dir, file } = await workspace(`h72-${post}-${index}`, doc); await openDrawing(page, request, file);
    if (post) { await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${view.id}`).click(); }
    for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
      const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
      await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
    }
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
    const steps = page.getByTestId('tool-steps');
    if (await steps.getAttribute('aria-pressed') !== 'true') await steps.click();
    await persisted(file, doc => doc.showSteps === true);
    const editor = await smoothConnection(page.getByTestId('canvas'), 'route', 'start', 'end');
    checkRouteBorders(editor);
    const baseline = await readFile(file, 'utf8'); await page.getByTestId('share-button').click();
    await page.getByTestId(post ? 'format-feed' : 'format-readme').click();
    if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
    for (const id of ['title', 'lede', 'legend', 'texts', 'labels']) await page.getByTestId(`show-${id}`).uncheck();
    await page.getByTestId('show-steps').check();
    const report = await settledReport(page);
    expect(report).toMatchObject({ view: view.id, parts: view.nodes.length, zones: 0, connections: 1, overParts: 0 });
    const geometry = await smoothConnection(page.getByTestId('share-preview'), 'route', 'start', 'end');
    checkRouteBorders(geometry); connections++;
    compareRoutes(editor, geometry, true);
    expect(geometry.nodes).toHaveLength(view.nodes.length);
    if (input.side) {
      detours++;
      const node = (id: string) => { const found = geometry.nodes.find(n => n.id === id); expect(found, id).toBeTruthy(); return found!.box; };
      const obstacle = node('obstacle'), epsilon = geometry.scale * 0.3;
      const centre = (geometry.source.left + geometry.source.right) / 2;
      expect(centre).toBeGreaterThan(obstacle.left); expect(centre).toBeLessThan(obstacle.right);
      expect(obstacle.top).toBeGreaterThan(Math.min(geometry.source.bottom, geometry.target.bottom));
      expect(obstacle.bottom).toBeLessThan(Math.max(geometry.source.top, geometry.target.top));
      const partsExtent = drawingBounds(geometry); // Fixture symmetry only, never a line/badge containment bound.
      await checkDrawingFit(page.getByTestId('share-preview'), geometry);
      if (input.side === 'tie') {
        ties++; expect(centre - partsExtent.left).toBeCloseTo(partsExtent.right - centre, 5);
      }
      const samples = geometry.routes.flat().filter(p => p.y > obstacle.top + epsilon && p.y < obstacle.bottom - epsilon);
      expect(samples.length, 'the line traverses the obstructed row').toBeGreaterThan(0);
      const goRight = samples.every(point => point.x > obstacle.right - epsilon);
      const goLeft = samples.every(point => point.x < obstacle.left + epsilon);
      expect(goRight || goLeft, 'the complete obstructed-row line takes one side').toBe(true);
      if (input.side === 'tie') expect(goRight, 'equal available sides choose right').toBe(true);
      const segments = geometry.routes.flatMap(points => points.slice(1).map((b, i) => ({ a: points[i], b })));
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.find(({ a, b }) => entersBox(a, b, obstacle, epsilon)), 'the detour enters the obstacle').toBeUndefined();
      expect(geometry.badges).toHaveLength(1); expect(editor.badges).toHaveLength(1);
      const badge = geometry.badges[0], badgeWidth = badge.right - badge.left;
      expect(badgeWidth).toBeGreaterThan(0); expect(badge.bottom - badge.top).toBeGreaterThan(0);
      checkClear(geometry, geometry.nodes.map(n => n.box));
      checkNearestMiddle(geometry, badge, [], 'badge');
      // diagram-v2: a short smooth arc with the lowest length/centre-distance cost.
      // Compressing sampled x coordinates could introduce a corner or violate end normals.
      checkCap(geometry);
      const alternatives = arcWitnesses(geometry, geometry.nodes.map(n => n.box));
      expect(alternatives.length, 'legal smooth alternatives for the bulge comparison').toBeGreaterThan(0);
      expect(lineLength(geometry.routes[0])).toBeLessThanOrEqual(Math.min(...alternatives.map(c => c.length)) + geometry.scale * 0.5);
    }
    const out = join(dir, 'borders.svg'); await download(page, 'download-svg', out);
    const holder = await page.context().newPage();
    try {
      await holder.setContent(`<!doctype html><html><body style="margin:0">${await readFile(out, 'utf8')}</body></html>`);
      await holder.evaluate(async () => { await document.fonts.ready; });
      const exported = await smoothConnection(holder.locator('svg'), 'route', 'start', 'end');
      checkRouteBorders(exported); compareRoutes(geometry, exported); compareRoutes(editor, exported, true);
      if (input.side) {
        expect(exported.badges).toHaveLength(1); await checkDrawingFit(holder.locator('svg'), exported);
        checkClear(exported, exported.nodes.map(n => n.box));
        checkNearestMiddle(exported, exported.badges[0], [], 'badge');
        const obstacle = exported.nodes.find(n => n.id === 'obstacle')!.box, epsilon = exported.scale * 0.3;
        const samples = exported.routes.flat().filter(p => p.y > obstacle.top + epsilon && p.y < obstacle.bottom - epsilon);
        expect(samples.length).toBeGreaterThan(0);
        const goRight = samples.every(point => point.x > obstacle.right - epsilon);
        const goLeft = samples.every(point => point.x < obstacle.left + epsilon);
        expect(goRight || goLeft).toBe(true);
        if (input.side === 'tie') expect(goRight).toBe(true);
        const segments = exported.routes.flatMap(points => points.slice(1).map((b, i) => ({ a: points[i], b })));
        expect(segments.length).toBeGreaterThan(0);
        expect(segments.find(({ a, b }) => entersBox(a, b, obstacle, epsilon))).toBeUndefined();
        checkCap(exported);
        const alternatives = arcWitnesses(exported, exported.nodes.map(n => n.box));
        expect(alternatives.length).toBeGreaterThan(0);
        expect(lineLength(exported.routes[0])).toBeLessThanOrEqual(Math.min(...alternatives.map(c => c.length)) + exported.scale * 0.5);
      }
    } finally { await holder.close(); }
    expect(await readFile(file, 'utf8')).toBe(baseline);
    console.log(`BORDER_CASE post=${post} index=${index} elapsedMs=${Math.round(performance.now() - started)}`);
  }
  expect(connections).toBe(3); expect(detours).toBe(indices.filter(i => cases[i].side !== null).length);
  expect(ties).toBe(indices.filter(i => cases[i].side === 'tie').length);
}
