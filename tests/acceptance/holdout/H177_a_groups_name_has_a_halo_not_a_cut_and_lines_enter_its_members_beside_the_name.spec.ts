import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRaw, openDrawing, cli, type Doc3 } from './helpers';
import { inDrawingFonts, routeGeometry, rasterDifferences, overlapsBox, type Box } from './helpers-svg-parity';
import { sketch, lineStyle, drawnRoutes, expectSameRoutes, inspectImage, imageOf, settleEdges, persistedChoice, positionsOf, viewIn } from './helpers-drawing';
import { isSingleCubic } from './helpers-svg-parity';

// A source far left and a destination far right joined by `e1` (a label and a step), a group named `Processing zone` with two members in its first row, and two parts
// above the group with lines into its second member (one call, one async, so they share no trunk) and one into its first.
function zoneDoc(srcY: number, dstY: number, withLine: boolean): Doc3 {
  return sketch('Group halo', [
    { id: 'src', label: 'Intake', x: 0, y: srcY }, { id: 'dst', label: 'Archive', x: 2200, y: dstY },
    { id: 'zone', label: 'Processing zone', form: 'group', description: 'Where orders are processed.' },
    { id: 'm1', label: 'Checker', parent: 'zone', x: 400, y: 400 }, { id: 'm2', label: 'Writer', parent: 'zone', x: 700, y: 400 },
    { id: 'top', label: 'Desk', x: 480, y: 80 }, { id: 'top2', label: 'Back desk', x: 760, y: 80 },
  ], [
    ...(withLine ? [{ id: 'e1', from: 'src', to: 'dst', label: 'handoff', step: 1 }] : []),
    { id: 't1', from: 'top', to: 'm2' }, { id: 't2', from: 'top2', to: 'm2', style: 'async' }, { id: 't3', from: 'top', to: 'm1' },
  ]);
}
// The boxes of the texts in a group's head, in the image's own units.
async function headTexts(surface: Locator, id: string) {
  return await surface.evaluate((el, gid) => {
    const root = (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const head = root.querySelector(`g[data-group-head="${gid}"]`)!;
    return Array.from(head.querySelectorAll('text')).map(t => {
      const g = t as unknown as SVGGraphicsElement, b = g.getBBox(), m = inverse.multiply(g.getScreenCTM()!);
      const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { text: (t.textContent ?? '').replace(/\s+/g, ' ').trim(), left: Math.min(...c.map(p => p.x)), right: Math.max(...c.map(p => p.x)), top: Math.min(...c.map(p => p.y)), bottom: Math.max(...c.map(p => p.y)) };
    });
  }, id);
}

// LAYOUT-2: a connection that crosses a group's header passes over it, and the name stays readable on a halo, so nothing is cut out of the line. LOOK-4: lines are drawn over the
// header band. SHARE-1: every export draws the group in two layers. (#176: lines that enter a member from above come in right of the name.)
test('H177 [LAYOUT-2 LOOK-4 SHARE-1 #176 #170] a group name sits on a halo and nothing is cut out of a line that crosses its header, and lines that enter a member from above come in right of the name', async ({ page, request }) => {
  test.setTimeout(300_000);
  // Phase 1: learn where the name is, then put the two outer parts level with it but 11 px above its middle: inside the old 28 px cut, clear of the letters and their halo.
  const probe = await workspaceRaw('halo-probe', zoneDoc(0, 0, true));
  await openDrawing(page, request, probe.file);
  const probeOut = join(probe.dir, 'probe.svg'), probed = await cli(['svg', probe.file, '--format', 'readme', '--out', probeOut]);
  expect(probed.code, probed.stderr).toBe(0);
  const level = await inDrawingFonts(page, await readFile(probeOut, 'utf8'), async surface => {
    const g = await routeGeometry(surface, 'e1', 'src', 'dst'), texts = await headTexts(surface, 'zone');
    const name = texts.find(t => t.text.includes('Processing'))!, src = g.nodes.find(n => n.id === 'src')!.box;
    return Math.round(((name.top + name.bottom) / 2 - (src.top + src.bottom) / 2) / g.scale - 11);
  });

  // Phase 2: the drawing with the line and the same drawing without it.
  const withLine = await workspaceRaw('halo-line', zoneDoc(level, level, true)), without = await workspaceRaw('halo-bare', zoneDoc(level, level, false));
  const opened = await openDrawing(page, request, withLine.file);
  const stored = await positionsOf(withLine.file);
  const exceptZone = (rows: typeof stored) => rows.filter(r => r[0] !== 'zone');

  for (const format of ['readme', 'square'] as const) {
    const a = join(withLine.dir, `line-${format}.svg`), b = join(without.dir, `bare-${format}.svg`);
    for (const [target, path] of [[withLine.file, a], [without.file, b]] as const) { const done = await cli(['svg', target, '--format', format, '--out', path]); expect(done.code, done.stderr).toBe(0); }
    const svgWith = await readFile(a, 'utf8'), svgWithout = await readFile(b, 'utf8');
    const info = await inspectImage(page, svgWith);

    // The group is two layers; the name carries a halo; nothing is clipped.
    const head = info.heads.find(h => h.id === 'zone')!;
    expect(head, `${format}: the group has a head`).toBeTruthy();
    expect(head.names.length, `${format}: the head holds the name`).toBeGreaterThanOrEqual(1);
    for (const n of head.names) {
      expect(n.stroke, `${format}: the halo is a solid colour (${n.text})`).toMatch(/^rgb\(/);
      expect(parseFloat(n.strokeWidth), `${format}: the halo is 4 px`).toBeCloseTo(4, 2);
      expect(n.linejoin).toBe('round'); expect(n.paintOrder.startsWith('stroke'), `${format}: stroke is painted first (${n.paintOrder})`).toBe(true);
    }
    expect(info.clippedEdges, `${format}: nothing is cut out of a line`).toEqual([]);
    expect(info.order, `${format}: frames, then lines, then heads, then parts`).toEqual({ framesBeforeEdges: true, headsAfterEdges: true, headsBeforeParts: true });

    const seen = await inDrawingFonts(page, svgWith, async surface => {
      const g = await routeGeometry(surface, 'e1', 'src', 'dst'), texts = await headTexts(surface, 'zone');
      return { g, name: texts.find(t => t.text.includes('Processing'))!, line: await lineStyle(surface, 'e1'), drawn: await drawnRoutes(surface, 'src'), texts };
    });
    const { g, name, line } = seen, s = g.scale;
    const zone = g.nodes.find(n => n.id === 'zone')!.box, src = g.nodes.find(n => n.id === 'src')!.box, dst = g.nodes.find(n => n.id === 'dst')!.box;
    expect(isSingleCubic(line.d), `${format}: ${line.d}`).toBe(true);
    expect(g.labels.map(l => l.text.trim()), `${format}: the label`).toEqual(['handoff']); expect(g.badges, `${format}: the badge`).toHaveLength(1);
    const lineY = g.routes[0][0].y, nameMid = (name.top + name.bottom) / 2;
    expect(Math.abs(lineY - g.routes[0].at(-1)!.y), `${format}: level`).toBeLessThanOrEqual(1 * s);
    expect(lineY, `${format}: above the middle of the name, inside the old cut`).toBeLessThan(nameMid - 8 * s); expect(lineY).toBeGreaterThan(nameMid - 14 * s);

    // The line is drawn across the whole width of the name (the old cut hid it there), left of the group, beyond the name and right of the group.
    const band = { top: lineY - 3 * s, bottom: lineY + 3 * s };
    const regions: Box[] = [
      { left: name.left, right: name.right, ...band }, { left: src.right + 12 * s, right: src.right + 40 * s, ...band },
      { left: name.right + 16 * s, right: name.right + 56 * s, ...band }, { left: zone.right + 12 * s, right: zone.right + 40 * s, ...band },
    ];
    expect(regions[2].right, `${format}: room in the group beyond its name`).toBeLessThan(zone.right);
    expect(regions[3].right, `${format}: room right of the group`).toBeLessThan(dst.left - 20 * s);
    for (const note of [...g.labels.map(l => l.box), ...g.badges]) for (const region of regions)
      expect(overlapsBox(region, { left: note.left - 4 * s, right: note.right + 4 * s, top: note.top - 4 * s, bottom: note.bottom + 4 * s }), `${format}: a label or badge is not in a probed region`).toBe(false);
    const [inName, left, beyond, right] = await rasterDifferences(page, svgWith, svgWithout, regions);
    expect(inName, `${format}: the line is drawn over the header, across the name`).toBeGreaterThan(0);
    expect(left, `${format}: left of the group`).toBeGreaterThan(0); expect(beyond, `${format}: beyond the name`).toBeGreaterThan(0); expect(right, `${format}: right of the group`).toBeGreaterThan(0);

    // Lines that enter the second member from above come in right of the name and at least 10 px apart.
    const nameRight = (name.right - src.left) / s;
    const t1 = seen.drawn.edges.t1.p[3], t2 = seen.drawn.edges.t2.p[3];
    expect(t1.x, `${format}: t1 enters right of the name`).toBeGreaterThanOrEqual(nameRight - 0.3); expect(t2.x, `${format}: t2 enters right of the name`).toBeGreaterThanOrEqual(nameRight - 0.3);
    expect(Math.abs(t1.x - t2.x), `${format}: the two ends are at least 10 px apart`).toBeGreaterThanOrEqual(10 - 0.3);
    expect(seen.drawn.trunks, `${format}: a call and an async line share no trunk`).toEqual([]);
  }

  // The editor: the head is its own layer with the same halo, the line is the export's, and the name renames in place.
  await settleEdges(page);
  const head = page.getByTestId('node-head-zone'), label = head.getByTestId('node-label');
  await expect(head).toBeVisible();
  const halo = await label.evaluate(el => { const c = getComputedStyle(el); return { width: c.strokeWidth, join: c.strokeLinejoin, order: c.paintOrder, stroke: c.stroke }; });
  expect(parseFloat(halo.width)).toBeCloseTo(4, 2); expect(halo.join).toBe('round'); expect(halo.order.startsWith('stroke')).toBe(true); expect(halo.stroke).toMatch(/^rgb\(/);
  expect(await page.getByTestId('edge-e1').evaluate(el => el.hasAttribute('clip-path') || el.hasAttribute('mask') || !!el.querySelector('[clip-path], [mask]')), 'no clip on the line in the editor').toBe(false);
  const editorRoutes = await drawnRoutes(page.getByTestId('canvas'), 'src');
  const exportRoutes = await inDrawingFonts(page, await imageOf(request, opened.id), async surface => await drawnRoutes(surface, 'src'));
  expectSameRoutes(editorRoutes, exportRoutes, 'editor and export');
  await label.dblclick();
  await expect(page.getByTestId('node-label-input')).toBeVisible();
  await page.getByTestId('node-label-input').fill('Processing area'); await page.getByTestId('node-label-input').press('Enter');
  await persistedChoice(withLine.file, d => viewIn(d)!.nodes.find(n => n.id === 'zone')?.label === 'Processing area');

  // Must not happen: a part moving to clear the name, or the connection changing.
  expect(exceptZone(await positionsOf(withLine.file)), 'stored positions never move').toEqual(exceptZone(stored));
});
