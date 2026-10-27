import { test, expect, type Locator } from '@playwright/test';
import { workspaceRaw, openDrawing, type Doc3 } from './helpers';
import { inDrawingFonts } from './helpers-svg-parity';
import { sketch, drawnRoutes, expectSameRoutes, imageOf, nearestSide, settleEdges, persistedChoice, positionsOf, viewIn } from './helpers-drawing';

// A group named `Processing zone` with two members in its first row; its name sits in the header's left part, over the first member `m1`. Two parts above
// the group each send a line into `m1` from above (one call, one async, so they share no trunk): without the rule their ends would sit round the middle
// of m1's top side, under the name.
function zoneDoc(): Doc3 {
  return sketch('Group name ends', [
    { id: 'zone', label: 'Processing zone', form: 'group', description: 'Where orders are processed.' },
    { id: 'm1', label: 'Checker', parent: 'zone', x: 400, y: 400 }, { id: 'm2', label: 'Writer', parent: 'zone', x: 700, y: 400 },
    { id: 'top', label: 'Desk', x: 480, y: 80 }, { id: 'top0', label: 'Front desk', x: 220, y: 80 },
  ], [
    { id: 't3', from: 'top', to: 'm1' }, { id: 't4', from: 'top0', to: 'm1', style: 'async' },
  ]);
}
// The right end of the group's name and the left of a part's box (its first rect, as `drawnRoutes` reads it), in the image's own units.
async function nameAndAnchor(surface: Locator, groupId: string, anchorId: string) {
  return await surface.evaluate((el, ids) => {
    const root = (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const bounds = (g: SVGGraphicsElement) => {
      const b = g.getBBox(), m = inverse.multiply(g.getScreenCTM()!);
      const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { left: Math.min(...c.map(p => p.x)), right: Math.max(...c.map(p => p.x)) };
    };
    const head = root.querySelector(`g[data-group-head="${ids.group}"]`)!;
    const name = Array.from(head.querySelectorAll('text')).find(t => (t.textContent ?? '').includes('Processing'))! as unknown as SVGGraphicsElement;
    const nodeSelector = 'g[data-node-id], [data-testid^="node-"][data-kind]';
    const g = root.querySelector(`g[data-node-id="${ids.anchor}"]`)!;
    const rect = Array.from(g.querySelectorAll('rect')).find(r => !r.closest('defs, clipPath, mask, marker') && r.closest(nodeSelector) === g)!;
    return { nameRight: bounds(name).right, anchorLeft: bounds(rect).left };
  }, { group: groupId, anchor: anchorId });
}

// #176 (diagram contract, Connections, Ends): connections entering a member in a group's first row from above come in right of the group's name when the
// part leaves room, at least 10 px apart. LAYOUT-2: they cross the header band and pass over it beside the name. SHARE-1: the exported image draws it so,
// and the editor draws the export's paths. The group's name renames in place in its head. (The halo and the uncut line: H152.)
test('H177 [LAYOUT-2 LAYOUT-5 SHARE-1 #176] lines that enter a member under a group\'s name from above come in right of the name at least 10 px apart, the editor draws the same paths, and the name renames in its head', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('halo-beside', zoneDoc());
  const opened = await openDrawing(page, request, file);
  const stored = await positionsOf(file);
  const exceptZone = (rows: typeof stored) => rows.filter(r => r[0] !== 'zone');

  // The readme image: both ends on m1's top side, right of the name, at least 10 px apart.
  const seen = await inDrawingFonts(page, await imageOf(request, opened.id), async surface => ({ drawn: await drawnRoutes(surface, 'm1'), at: await nameAndAnchor(surface, 'zone', 'm1') }));
  const { drawn } = seen, m1 = drawn.nodes.m1;
  const nameRight = (seen.at.nameRight - seen.at.anchorLeft) / drawn.scale; // drawing px from m1's left, as `drawn`
  expect(m1.right - nameRight, 'the part leaves room right of the name').toBeGreaterThanOrEqual(20);
  const t3 = drawn.edges.t3.p[3], t4 = drawn.edges.t4.p[3];
  expect(nearestSide(t3, m1), 't3 enters m1 from above').toBe('top'); expect(nearestSide(t4, m1), 't4 enters m1 from above').toBe('top');
  expect(t3.x, 't3 enters right of the name').toBeGreaterThanOrEqual(nameRight - 0.3); expect(t4.x, 't4 enters right of the name').toBeGreaterThanOrEqual(nameRight - 0.3);
  expect(Math.abs(t3.x - t4.x), 'the two ends are at least 10 px apart').toBeGreaterThanOrEqual(10 - 0.3);

  // The editor draws the export's paths, and the name renames in place in its head.
  await settleEdges(page);
  expectSameRoutes(await drawnRoutes(page.getByTestId('canvas'), 'm1'), drawn, 'editor and export');
  const head = page.getByTestId('node-head-zone'), label = head.getByTestId('node-label');
  await expect(head).toBeVisible();
  await label.dblclick();
  await expect(page.getByTestId('node-label-input')).toBeVisible();
  await page.getByTestId('node-label-input').fill('Processing area'); await page.getByTestId('node-label-input').press('Enter');
  await persistedChoice(file, d => viewIn(d)!.nodes.find(n => n.id === 'zone')?.label === 'Processing area');

  // Must not happen: a part moving to clear the name.
  expect(exceptZone(await positionsOf(file)), 'stored positions never move').toEqual(exceptZone(stored));
});
