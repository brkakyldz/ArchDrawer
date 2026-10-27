import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRaw, openDrawing, cli, settledReport } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport, edgeLine, isSingleCubic, rasterDifferences, overlapsBox, type Box } from './helpers-svg-parity';
import { sketch, readDrawn, positionsOf, inspectImage, drawnRoutes, expectSameRoutes, openShare, closeShare, imageOf } from './helpers-drawing';

// A drawing whose one connection runs from a part left of a group to a part right of it, level with the group's name (the offsets are in drawing px
// from the level of the name's middle, learnt from a first drawing).
function groupDoc(title: string, srcY: number, dstY: number, withEdge: boolean) {
  return sketch(title, [
    { id: 'src', label: 'Intake', x: 0, y: srcY }, { id: 'dst', label: 'Archive', x: 2200, y: dstY },
    { id: 'zone', label: 'Processing zone', kind: 'service', description: 'Where orders are processed.', form: 'group' },
    { id: 'm1', label: 'Checker', parent: 'zone', x: 400, y: 400 }, { id: 'm2', label: 'Writer', parent: 'zone', x: 700, y: 400 },
  ], withEdge ? [{ id: 'e1', from: 'src', to: 'dst', label: 'handoff', step: 1 }] : []);
}

// The name of a group is the first text of its head `g[data-group-head]`: its box in the image's own units.
async function nameBox(surface: Locator, groupId: string): Promise<Box> {
  return await surface.evaluate((element, id) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const text = root.querySelector(`g[data-group-head="${id}"] text`) as SVGTextElement;
    const b = text.getBBox(), m = root.getScreenCTM()!.inverse().multiply(text.getScreenCTM()!);
    const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    return { left: Math.min(...c.map(q => q.x)), right: Math.max(...c.map(q => q.x)), top: Math.min(...c.map(q => q.y)), bottom: Math.max(...c.map(q => q.y)) };
  }, groupId);
}

// Outcome (ADR 0013): a connection that meets a group's name is drawn over the header and the name sits on a tight halo; nothing is cut out of the line.
// The line level with the name but above its letters (inside the old 28 px cut band) is drawn right across the name's width, in the readme and the square
// image; it is still one cubic with its label and badge, it is drawn left of the group, in it beyond the name and right of it, and a group is not a part the report lists.
test('H152 [LAYOUT-2 LAYOUT-3 SHARE-1 LOOK-4 #176 #170] a connection level with the name of a group is drawn over the header with the name on a halo and nothing cut out of the line, in the readme and the square image and the editor, as one cubic with its label and badge, and the report lists no part', async ({ page, request }) => {
  test.setTimeout(60_000);
  // Phase 1: draw the group once to learn where its name is, then put the two outer parts 11 px above the name's middle: above the letters and their halo,
  // inside the band the old clip cut. Stored positions are the author's; nothing is moved by the product.
  const first = await workspaceRaw('group-name-probe', groupDoc('Group name probe', 0, 0, true));
  const probe = join(first.dir, 'probe.svg'), probed = await cli(['svg', first.file, '--format', 'readme', '--out', probe]);
  expect(probed.code, probed.stderr).toBe(0);
  const level = await inDrawingFonts(page, await readFile(probe, 'utf8'), async surface => {
    const g = await drawnRoutes(surface, 'src'), name = await nameBox(surface, 'zone'), s = g.scale;
    const middle = (name.top + name.bottom) / 2;
    // Normalised boxes have the image's units divided by the scale; the anchor `src` sits at the origin of the normalised space.
    const anchor = await surface.evaluate(element => {
      const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
      const rect = root.querySelector('g[data-node-id="src"] rect') as SVGRectElement; const b = rect.getBBox(), m = root.getScreenCTM()!.inverse().multiply(rect.getScreenCTM()!);
      const p = new DOMPoint(b.x, b.y).matrixTransform(m), q = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
      return { top: p.y, bottom: q.y };
    });
    // Both outer parts are plain 108 px cards, so one offset puts both centres 11 px above the name's middle.
    const offset = Math.round(((middle - (anchor.top + anchor.bottom) / 2) / s - 11) * 100) / 100;
    return { src: offset, dst: offset };
  });

  // Phase 2: the drawing with the line, and the same drawing without it.
  const withLine = await workspaceRaw('group-name-line', groupDoc('Group name line', level.src, level.dst, true));
  const without = await workspaceRaw('group-name-bare', groupDoc('Group name line', level.src, level.dst, false));
  const stored = await readDrawn(withLine.file), storedPositions = await positionsOf(withLine.file);
  const kept = (rows: [string, number | undefined, number | undefined][]) => rows.filter(r => r[0] !== 'zone'); // the group's box is computed on opening

  for (const format of ['readme', 'square'] as const) {
    const a = join(withLine.dir, `line-${format}.svg`), b = join(without.dir, `bare-${format}.svg`);
    for (const [target, path] of [[withLine.file, a], [without.file, b]] as const) {
      const done = await cli(['svg', target, '--format', format, '--out', path]); expect(done.code, done.stderr).toBe(0);
    }
    const svgWith = await readFile(a, 'utf8'), svgWithout = await readFile(b, 'utf8');
    const seen = await inDrawingFonts(page, svgWith, async surface => {
      const g = await routeGeometry(surface, 'e1', 'src', 'dst'), lines = await edgeLine(surface, 'e1'), name = await nameBox(surface, 'zone');
      return { g, lines, name, independent: measuredRouteReport(stored, [g]) };
    });
    const { g, lines, name, independent } = seen, s = g.scale;
    const zone = g.nodes.find(n => n.id === 'zone')!, src = g.nodes.find(n => n.id === 'src')!.box, dst = g.nodes.find(n => n.id === 'dst')!.box;

    // One cubic; the label and the badge are drawn and the label stays on its line.
    expect(lines.length, `${format}: the line is drawn`).toBeGreaterThan(0);
    expect(isSingleCubic(lines[0].d), `${format}: ${lines[0].d}`).toBe(true);
    expect(g.labels.map(l => l.text.trim()), `${format}: the label`).toEqual(['handoff']);
    expect(g.badges, `${format}: the badge`).toHaveLength(1);
    const line = g.routes[0], lineY = line[0].y, middle = (name.top + name.bottom) / 2;
    expect(Math.abs(line.at(-1)!.y - lineY), `${format}: the line is level`).toBeLessThanOrEqual(1 * s);
    expect(Math.abs(lineY - (middle - 11 * s)), `${format}: the line is about 11 px above the middle of the name`).toBeLessThanOrEqual(3 * s);

    // The name has a halo and nothing is cut: no clip or mask on any connection, the head is drawn after every connection and before the parts.
    const info = await inspectImage(page, svgWith), head = info.heads.find(h => h.id === 'zone')!;
    expect(head, `${format}: the group's head`).toBeTruthy();
    const nameText = head.names.find(n => n.text.includes('Processing'))!;
    expect(nameText.strokeWidth, `${format}: the halo is 4 px`).toBe('4px'); expect(nameText.linejoin).toBe('round'); expect(nameText.paintOrder).toMatch(/^stroke/);
    expect(nameText.stroke, `${format}: the halo has a colour`).not.toBe('none');
    // Every text of the head carries the halo, a solid colour (diagram contract, A group's name: the header's colour "made solid").
    for (const n of head.names) {
      expect(n.stroke, `${format}: the halo is a solid colour (${n.text})`).toMatch(/^rgb\(/);
      expect(parseFloat(n.strokeWidth), `${format}: the halo is 4 px (${n.text})`).toBeCloseTo(4, 2);
      expect(n.linejoin).toBe('round'); expect(n.paintOrder.startsWith('stroke'), `${format}: stroke is painted first (${n.paintOrder})`).toBe(true);
    }
    expect(info.clippedEdges, `${format}: nothing is cut out of a line`).toEqual([]);
    expect(info.order, `${format}: frame, then connections, then head, then parts`).toEqual({ framesBeforeEdges: true, headsAfterEdges: true, headsBeforeParts: true });

    // The line is drawn across the name (above its letters), left of the group, through the group beyond the name, and right of it.
    const band = { top: lineY - 2 * s, bottom: lineY + 2 * s };
    const regions: Box[] = [
      { left: name.left, right: name.right, ...band },
      { left: src.right + 12 * s, right: src.right + 40 * s, ...band },
      { left: name.right + 16 * s, right: name.right + 56 * s, ...band },
      { left: zone.box.right + 12 * s, right: zone.box.right + 40 * s, ...band },
    ];
    expect(regions[1].right, `${format}: room between the first part and the group`).toBeLessThan(zone.box.left);
    expect(regions[2].right, `${format}: room in the group beyond its name`).toBeLessThan(zone.box.right);
    expect(regions[3].right, `${format}: room between the group and the last part`).toBeLessThan(dst.left - 20 * s);
    for (const annotation of [...g.labels.map(l => l.box), ...g.badges]) for (const region of regions)
      expect(overlapsBox(region, { left: annotation.left - 4 * s, right: annotation.right + 4 * s, top: annotation.top - 4 * s, bottom: annotation.bottom + 4 * s }), `${format}: a label or badge is not in a probed region`).toBe(false);
    const [inName, left, beyond, right] = await rasterDifferences(page, svgWith, svgWithout, regions);
    expect(inName, `${format}: the line is drawn across the width of the group's name`).toBeGreaterThan(0);
    expect(left, `${format}: the line is drawn left of the group`).toBeGreaterThan(0);
    expect(beyond, `${format}: the line is drawn in the group beyond its name`).toBeGreaterThan(0);
    expect(right, `${format}: the line is drawn right of the group`).toBeGreaterThan(0);

    // A group is not a part: the line passes over a group's header and the report lists nothing.
    expect(independent.edgesOverParts, `${format}: no part is passed behind`).toEqual([]);
  }

  // The editor draws it as one cubic too, with the name on the same halo and the head over the lines, the path equal to the export's; the report lists no part.
  const opened = await openDrawing(page, request, withLine.file);
  const editor = await edgeLine(page.getByTestId('canvas'), 'e1');
  expect(editor.length).toBeGreaterThan(0); expect(isSingleCubic(editor[0].d), `the editor: ${editor[0].d}`).toBe(true);
  expect(await page.getByTestId('edge-e1').evaluate(el => el.hasAttribute('clip-path') || el.hasAttribute('mask') || !!el.querySelector('[clip-path], [mask]')), 'no clip on the line in the editor').toBe(false);
  const halo = await page.getByTestId('node-head-zone').getByTestId('node-label').evaluate(el => { const s = getComputedStyle(el); return { width: s.strokeWidth, join: s.strokeLinejoin, order: s.paintOrder, stroke: s.stroke }; });
  expect(halo.width).toBe('4px'); expect(halo.join).toBe('round'); expect(halo.order).toMatch(/^stroke/); expect(halo.stroke).not.toBe('none');
  expect(halo.stroke, 'the editor halo is a solid colour').toMatch(/^rgb\(/);
  const editorRoutes = await drawnRoutes(page.getByTestId('canvas'), 'src');
  await inDrawingFonts(page, await imageOf(request, opened.id), async surface => { expectSameRoutes(editorRoutes, await drawnRoutes(surface, 'src'), 'editor against image'); });
  await openShare(page, 'format-readme');
  const shown = await settledReport(page);
  expect(shown).toMatchObject({ view: 'overview', format: 'readme', zones: 1, parts: 4, connections: 1, overParts: 0, crossings: 0 });
  await closeShare(page);

  // Must not happen: a part moved to clear the name, or the file rewritten by looking at it.
  expect(kept(await positionsOf(withLine.file)), 'stored positions never move').toEqual(kept(storedPositions));
  expect((await readDrawn(withLine.file)).edges).toEqual(stored.edges);
});
