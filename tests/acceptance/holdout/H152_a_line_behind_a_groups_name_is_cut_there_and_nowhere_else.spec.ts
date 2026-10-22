import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fact, part, workspaceRaw, openDrawing, readDocument, readDrawing, cli, settledReport, type Doc3 } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport, edgeLine, isSingleCubic, rasterDifferences, overlapsBox, type Box } from './helpers-svg-parity';

// A drawing whose one connection runs from a part left of a group to a part right of it, level with the group's name.
function groupDoc(title: string, srcY: number, dstY: number, withEdge: boolean): Doc3 {
  return { schema: 'archdraw/diagram@3', title,
    facts: {
      components: [fact('src', { label: 'Intake', kind: 'client' }), fact('dst', { label: 'Archive', kind: 'data' }),
        fact('m1', { label: 'Checker', kind: 'gate' }), fact('m2', { label: 'Writer' })],
      relations: [{ id: 'r1', from: 'src', to: 'dst', label: 'handoff', style: 'call', both: false }],
    },
    channels: { overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview',
      caption: { title: 'A line behind a name', lede: 'The line passes behind the name of a group.' },
      nodes: [part('src', { x: 0, y: srcY }), part('dst', { x: 2200, y: dstY }),
        part('zone', { facts: [], form: 'group', label: 'Processing zone', kind: 'service', description: 'Where orders are processed.' }),
        part('m1', { parent: 'zone', x: 400, y: 400 }), part('m2', { parent: 'zone', x: 700, y: 400 })],
      edges: withEdge ? [{ id: 'e1', from: 'src', to: 'dst', relations: ['r1'], step: 1 }] : [], texts: [] }] } } };
}

// Outcome (ADR 0011): a connection that meets a group's name passes behind it. The name's text is cut out of the line, in
// the editor's drawing and in every export, and only there: the line is drawn on both sides of the name and through the
// rest of the group, it is still one cubic, its label and badge are drawn, and a group is not a part the report lists.
test('H152 [LAYOUT-2, LAYOUT-3, SHARE-1] a connection level with the name of a group passes behind it: the name is cut out of the line in the readme and the square image and the line is drawn everywhere else, as one cubic, with its label and badge, and the report lists no part', async ({ page, request }) => {
  test.setTimeout(240_000);
  // Phase 1: draw the group once to learn where its name is, then put the two outer parts level with it. Stored positions
  // are the author's; nothing is moved by the product.
  const first = await workspaceRaw('group-name-probe', groupDoc('Group name probe', 0, 0, true));
  await openDrawing(page, request, first.file);
  const probe = join(first.dir, 'probe.svg'), probed = await cli(['svg', first.file, '--format', 'readme', '--out', probe]);
  expect(probed.code, probed.stderr).toBe(0);
  const level = await inDrawingFonts(page, await readFile(probe, 'utf8'), async surface => {
    const g = await routeGeometry(surface, 'e1', 'src', 'dst');
    const zone = g.nodes.find(n => n.id === 'zone')!, name = zone.texts.find(t => t.text.includes('Processing'))!;
    const middle = (name.box.top + name.box.bottom) / 2, centre = (id: string) => { const b = g.nodes.find(n => n.id === id)!.box; return (b.top + b.bottom) / 2; };
    return { src: Math.round((middle - centre('src')) / g.scale * 100) / 100, dst: Math.round((middle - centre('dst')) / g.scale * 100) / 100 };
  });

  // Phase 2: the drawing with the line, and the same drawing without it.
  const withLine = await workspaceRaw('group-name-line', groupDoc('Group name line', level.src, level.dst, true));
  const without = await workspaceRaw('group-name-bare', groupDoc('Group name line', level.src, level.dst, false));
  const stored = (await readDrawing(withLine.file)).views[0], storedBefore = await readDocument(withLine.file);
  // The group is written with no x/y and opening fills in its computed box (contracts/diagram.md), so it is left out here.
  const positions = (doc: Doc3) => doc.channels.overview.views![0].nodes.filter(n => n.id !== 'zone').map(n => [n.id, n.x, n.y]);

  for (const format of ['readme', 'square'] as const) {
    const a = join(withLine.dir, `line-${format}.svg`), b = join(without.dir, `bare-${format}.svg`);
    for (const [target, path] of [[withLine.file, a], [without.file, b]] as const) {
      const done = await cli(['svg', target, '--format', format, '--out', path]); expect(done.code, done.stderr).toBe(0);
    }
    const svgWith = await readFile(a, 'utf8'), svgWithout = await readFile(b, 'utf8');
    const seen = await inDrawingFonts(page, svgWith, async surface => {
      const g = await routeGeometry(surface, 'e1', 'src', 'dst'), lines = await edgeLine(surface, 'e1');
      return { g, lines, independent: measuredRouteReport(stored, [g]) };
    });
    const { g, lines, independent } = seen, s = g.scale;
    const zone = g.nodes.find(n => n.id === 'zone')!, src = g.nodes.find(n => n.id === 'src')!.box, dst = g.nodes.find(n => n.id === 'dst')!.box;
    const name = zone.texts.find(t => t.text.includes('Processing'))!.box;

    // One cubic, drawn under the parts; the label and the badge are drawn and the label stays on its line.
    expect(lines.length, `${format}: the line is drawn`).toBeGreaterThan(0);
    expect(isSingleCubic(lines[0].d), `${format}: ${lines[0].d}`).toBe(true);
    expect(g.labels.map(l => l.text.trim()), `${format}: the label`).toEqual(['handoff']);
    expect(g.badges, `${format}: the badge`).toHaveLength(1);
    const line = g.routes[0], lineY = line[0].y;
    expect(Math.abs(line.at(-1)!.y - lineY), `${format}: the line is level`).toBeLessThanOrEqual(1 * s);
    expect(Math.abs(lineY - (name.top + name.bottom) / 2), `${format}: the line is level with the name`).toBeLessThanOrEqual(6 * s);

    // The name is cut out of the line; the line is drawn left of the group, through the group beyond the name, and right of it.
    const band = { top: lineY - 4 * s, bottom: lineY + 4 * s };
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
    expect(inName, `${format}: the line is cut out of the group's name`).toBe(0);
    expect(left, `${format}: the line is drawn left of the group`).toBeGreaterThan(0);
    expect(beyond, `${format}: the line is drawn in the group beyond its name`).toBeGreaterThan(0);
    expect(right, `${format}: the line is drawn right of the group`).toBeGreaterThan(0);

    // A group is not a part: the line passes behind a group's name and the report lists nothing.
    expect(independent.edgesOverParts, `${format}: no part is passed behind`).toEqual([]);
  }

  // The editor draws it as one cubic and the share dialog's report lists no part either.
  await openDrawing(page, request, withLine.file);
  const editor = await edgeLine(page.getByTestId('canvas'), 'e1');
  expect(editor.length).toBeGreaterThan(0); expect(isSingleCubic(editor[0].d), `the editor: ${editor[0].d}`).toBe(true);
  await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  const shown = await settledReport(page);
  expect(shown).toMatchObject({ view: 'overview', format: 'readme', zones: 1, parts: 4, connections: 1, overParts: 0, crossings: 0 });
  await page.getByTestId('share-close').click();

  // Must not happen: a part moved to clear the name, or the file rewritten by looking at it.
  expect(positions(await readDocument(withLine.file)), 'stored positions never move').toEqual(positions(storedBefore));
  expect((await readDocument(withLine.file)).channels.overview.views![0].edges).toEqual(storedBefore.channels.overview.views![0].edges);
});
