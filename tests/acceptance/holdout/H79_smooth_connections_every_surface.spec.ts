import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arcDrawing, fullEditor, smoothConnection, shareGeometry, checkHorizontalObstruction, segmentBoxDistance, arcWitnesses, checkClear, checkCap, groupNameBox } from './helpers-v13';
import { workspace, openDrawing, baseURL, cli, download, component } from './helpers';
import { compareRasterConnection } from './helpers-svg-parity';
import { inDrawingFonts } from './helpers-v5';

// LAY-8 / diagram-v2: "one cubic or a chain of at most three cubics";
// "Where two cubics meet ... within 1°"; "handles ... outward normals".
test('H79 [LAY-8, SHR-6] draw every ordinary and post connection without corners in the editor and every SVG format', async ({ page, request, context }) => {
  const doc = arcDrawing();
  doc.views[0].edges.push({ id: 'direct', from: 'obstacle', to: 'member', label: '', style: 'async', both: true, step: null });
  // Guards occupy every non-facing side in both views, so the arc needs a joint.
  for (const [id, x, y] of [['start-top', 0, 164], ['start-bottom', 0, 316], ['start-left', -160, 240],
    ['end-top', 960, 164], ['end-bottom', 960, 316], ['end-right', 1120, 240]] as const)
    doc.views[0].nodes.push(component(id, { label: 'Guard', form: 'compact', x, y }));
  const post = structuredClone(doc.views[0]); post.id = 'smooth-post'; post.postOf = 'overview';
  post.nodes.forEach(n => { n.id = `post-${n.id}`; if (n.parent) n.parent = `post-${n.parent}`; });
  post.edges.forEach(e => { e.id = `post-${e.id}`; e.from = `post-${e.from}`; e.to = `post-${e.to}`; e.style = 'dep'; });
  // The post card is 84 px tall; at y=210 it still covers both ends' full band.
  post.nodes.find(n => n.id === 'post-obstacle')!.y = 210;
  doc.views.push(post);
  const { dir, file } = await workspace('h79', doc), opened = await openDrawing(page, request, file);
  const bytes = await readFile(file, 'utf8');
  let checks = 0, joins = 0;
  const check = async (surface: import('@playwright/test').Locator, view: typeof doc.views[number]) => {
    for (const edge of view.edges) {
      const g = await smoothConnection(surface, edge.id!, edge.from, edge.to);
      const prefix = view.id === 'overview' ? '' : 'post-';
      if (edge.id === `${prefix}arc`) {
        checkHorizontalObstruction(g, g.nodes.find(n => n.id === `${prefix}obstacle`)!.box);
        const part = (id: string) => g.nodes.find(n => n.id === `${prefix}${id}`)!.box;
        for (const [box, prefix, outside] of [[g.source, 'start', 'left'], [g.target, 'end', 'right']] as const) {
          const x = outside === 'left' ? box.left : box.right;
          for (const [a, b, guard] of [[{ x: box.left, y: box.top }, { x: box.right, y: box.top }, `${prefix}-top`],
            [{ x: box.left, y: box.bottom }, { x: box.right, y: box.bottom }, `${prefix}-bottom`],
            [{ x, y: box.top }, { x, y: box.bottom }, `${prefix}-${outside}`]] as const)
            expect(segmentBoxDistance(a, b, part(guard)), 'non-facing side is unavailable within 40 px').toBeLessThan(40 * g.scale);
        }
        const zone = g.nodes.find(n => n.id === `${prefix}zone`)!;
        const name = groupNameBox(zone.box, zone.texts.map(t => t.box), g.scale);
        const forbidden = [...g.nodes.filter(n => n.id !== `${prefix}zone`).map(n => n.box), name];
        const witnessName = groupNameBox(zone.box, zone.texts.map(t => t.box), g.scale, 'maximum');
        expect(arcWitnesses(g, [...forbidden.slice(0, -1), witnessName]).length, 'a legal multi-cubic route exists; fallback is unnecessary').toBeGreaterThan(0);
        // The three guarded alternatives leave only the facing horizontal side.
        const first = g.curves[0], last = g.curves.at(-1)!;
        expect(first[1].x - first[0].x, 'source uses its facing right side').toBeGreaterThan(0);
        expect(Math.abs(first[1].y - first[0].y)).toBeLessThanOrEqual(0.3 * g.scale);
        expect(last[2].x - last[3].x, 'target uses its facing left side').toBeLessThan(0);
        expect(Math.abs(last[2].y - last[3].y)).toBeLessThanOrEqual(0.3 * g.scale);
        // Facing horizontal normals keep a single cubic in the obstacle's vertical band.
        checkClear(g, forbidden); checkCap(g);
        expect(g.cubicJoins, 'obstruction plus unavailable alternate sides requires a cubic joint').toBeGreaterThan(0);
      }
      joins += g.cubicJoins; checks++;
    }
  };
  for (const view of doc.views) {
    if (view !== doc.views[0]) { await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${view.id}`).click(); }
    await expect(page.getByTestId(`edge-${view.edges[0].id}`)).toBeAttached(); await fullEditor(page);
    await check(page.getByTestId('canvas'), view);
    for (const format of ['readme', 'feed', 'linkedin', 'slide', 'square']) {
      const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=${view.id}&format=${format}`);
      expect(response.status()).toBe(200);
      await inDrawingFonts(page, await response.text(), surface => check(surface, view));
    }
    const out = join(dir, `${view.id}-cli.svg`);
    const exported = await cli(['svg', file, '--view', view.id, '--format', 'readme', '--out', out]);
    expect(exported.code, exported.stderr).toBe(0);
    await inDrawingFonts(page, await readFile(out, 'utf8'), surface => check(surface, view));
  }
  await page.getByTestId('views-button').click(); await page.getByTestId('view-item-overview').click();
  await shareGeometry(page);
  const obstructed = await smoothConnection(page.getByTestId('share-preview'), 'arc', 'start', 'end');
  checkHorizontalObstruction(obstructed, obstructed.nodes.find(n => n.id === 'obstacle')!.box);
  const svgFile = join(dir, 'raster-reference.svg'), pngFile = join(dir, 'smooth.png');
  await download(page, 'download-svg', svgFile); await download(page, 'download-png', pngFile);
  const svg = await readFile(svgFile, 'utf8');
  await compareRasterConnection(page, svg, `data:image/png;base64,${(await readFile(pngFile)).toString('base64')}`, doc.views[0].edges[0]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.getByTestId('copy-image').click();
  await expect(page.getByTestId('toast')).toContainText(/copied|not allowed/i);
  if (/copied/i.test(await page.getByTestId('toast').innerText())) {
    const copied = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'));
      if (!item) throw new Error('Copied image has no PNG');
      const blob = await item.getType('image/png');
      return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
    });
    await compareRasterConnection(page, svg, copied, doc.views[0].edges[0]);
  } else test.info().annotations.push({ type: 'clipboard-raster-coverage', description: 'permission denied; download PNG compared, copied PNG unobserved' });
  await page.getByTestId('share-close').click();
  await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${post.id}`).click();
  await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  for (const id of ['title', 'lede', 'legend', 'texts']) await page.getByTestId(`show-${id}`).uncheck();
  for (const id of ['labels', 'steps', 'items']) await page.getByTestId(`show-${id}`).check();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await check(page.getByTestId('share-preview'), post);
  const postSvgFile = join(dir, 'post-raster-reference.svg'), postPngFile = join(dir, 'post-smooth.png');
  await download(page, 'download-svg', postSvgFile); await download(page, 'download-png', postPngFile);
  const postSvg = await readFile(postSvgFile, 'utf8');
  await inDrawingFonts(page, postSvg, surface => check(surface, post));
  await compareRasterConnection(page, postSvg, `data:image/png;base64,${(await readFile(postPngFile)).toString('base64')}`, post.edges[0]);
  expect(checks).toBe(32); expect(await readFile(file, 'utf8')).toBe(bytes);
  test.info().annotations.push({ type: 'cubic-join-coverage', description: JSON.stringify({ joins,
    coverage: 'ordinary and post guarded arcs require a joint within 1 degree; README ordinary and feed post PNG ink compared to checked SVGs' }) });
});
