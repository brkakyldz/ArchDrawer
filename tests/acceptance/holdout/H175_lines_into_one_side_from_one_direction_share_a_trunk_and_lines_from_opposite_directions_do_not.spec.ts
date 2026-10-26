import { test, expect, type Locator, type Page } from '@playwright/test';
import { workspaceRaw, openDrawing, register, settledReport } from './helpers';
import { inDrawingFonts, crossingWitness } from './helpers-svg-parity';
import { sketch, positionsOf, drawnRoutes, expectSameRoutes, nearestSide, isStraight, sampleCubic, imageOf, inspectImage, openShare, closeShare, settleEdges, edgeSnaps, type Drawn } from './helpers-drawing';

// T (the target) at (600,300). Three sources stacked on its left, 120 px above, level with and 120 px below its left middle:
// seen from the port their centres are within 27 degrees of one another, so lines arriving on T's left share a trunk.
const T = { id: 't', x: 600, y: 300 };
const STACK = [{ id: 's1', x: 0, y: 180 }, { id: 's2', x: 0, y: 300 }, { id: 's3', x: 0, y: 420 }];

const borderDistance = (p: { x: number; y: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  Math.min(Math.abs(p.x - b.left), Math.abs(p.x - b.right), Math.abs(p.y - b.top), Math.abs(p.y - b.bottom));
const asPath = (p: { x: number; y: number }[]) => `M ${p[0].x} ${p[0].y} C ${p[1].x} ${p[1].y} ${p[2].x} ${p[2].y} ${p[3].x} ${p[3].y}`;

async function pointOnTrunk(page: Page) {
  return await page.getByTestId('trunk').evaluate(el => {
    const path = (el.tagName.toLowerCase() === 'path' ? el : el.querySelector('path')) as SVGPathElement;
    const at = path.getPointAtLength(path.getTotalLength() * 0.5), s = new DOMPoint(at.x, at.y).matrixTransform(path.getScreenCTM()!);
    return { x: s.x, y: s.y };
  });
}
// A connection's label box (the first rect of its group) and its line sampled, both in the image's own units.
async function labelAndLine(surface: Locator, edgeId: string) {
  return await surface.evaluate((element, id) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement, inverse = root.getScreenCTM()!.inverse();
    const g = root.querySelector(`g[data-edge-id="${id}"]`)!, rect = g.querySelector('rect') as SVGRectElement | null;
    const paths = (Array.from(g.querySelectorAll('path')) as SVGPathElement[]).filter(p => getComputedStyle(p).stroke !== 'none' && p.getTotalLength() > 0 && !p.closest('marker, defs'))
      .sort((a, b) => b.getTotalLength() - a.getTotalLength());
    const line = paths[0], m = inverse.multiply(line.getScreenCTM()!);
    const points = Array.from({ length: 101 }, (_, i) => { const q = line.getPointAtLength(line.getTotalLength() * i / 100); const r = new DOMPoint(q.x, q.y).matrixTransform(m); return { x: r.x, y: r.y }; });
    let label = null as null | { left: number; right: number; top: number; bottom: number };
    if (rect) {
      const b = rect.getBBox(), n = inverse.multiply(rect.getScreenCTM()!);
      const c = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(n));
      label = { left: Math.min(c[0].x, c[1].x), right: Math.max(c[0].x, c[1].x), top: Math.min(c[0].y, c[1].y), bottom: Math.max(c[0].y, c[1].y) };
    }
    return { label, points };
  }, edgeId);
}
const distanceToBox = (p: { x: number; y: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  Math.hypot(Math.max(b.left - p.x, 0, p.x - b.right), Math.max(b.top - p.y, 0, p.y - b.bottom));

// LAYOUT-5 (#174): connections that arrive on one side of a part from one direction, in one style, share a trunk for their last
// stretch: members end at the split point 32 px out from the port, the trunk is one straight cubic drawn once. SHARE-1: the image
// and the editor draw the same. LAYOUT-3: members that share an end never count as crossing.
test('H175 [LAYOUT-5 SHARE-1 LAYOUT-3 #174] three lines into one side from one direction share a trunk that is drawn once, lines from opposite directions or in another style do not, and the editor and the image agree', async ({ page, request }) => {
  test.setTimeout(240_000);
  const edges = [
    { id: 'e1', from: 's1', to: 't', label: 'first' }, { id: 'e2', from: 's2', to: 't' }, { id: 'e3', from: 's3', to: 't' },
  ];
  const { file } = await workspaceRaw('trunk', sketch('Trunk', [...STACK, T], edges));
  const before = await positionsOf(file);
  const opened = await openDrawing(page, request, file);
  const svg = await imageOf(request, opened.id);

  // The image: one trunk into the left of t, with its three members in view order; members end 32 px out from the port.
  const info = await inspectImage(page, svg);
  expect(info.trunks).toHaveLength(1);
  expect(info.trunks[0]).toMatchObject({ part: 't', side: 'l', edges: ['e1', 'e2', 'e3'], paths: 1 });
  expect(info.edges.map(e => e.id).sort(), 'the members keep their own groups').toEqual(['e1', 'e2', 'e3']);
  const exported = await inDrawingFonts(page, svg, surface => drawnRoutes(surface, 't'));
  expect(exported.trunks).toHaveLength(1);
  const trunk = exported.trunks[0], tBox = exported.nodes.t;
  expect(Math.abs(trunk.p[3].x - tBox.left), 'the trunk ends on the left border of t').toBeLessThanOrEqual(0.5);
  expect(trunk.p[3].y).toBeGreaterThanOrEqual(tBox.top); expect(trunk.p[3].y).toBeLessThanOrEqual(tBox.bottom);
  expect(Math.abs(trunk.p[0].x - (tBox.left - 32)), 'the split point is 32 px out from the port').toBeLessThanOrEqual(0.5);
  expect(isStraight(asPath(trunk.p), 0.1), 'the trunk is one straight cubic').toBe(true);
  for (const id of ['e1', 'e2', 'e3']) {
    const end = exported.edges[id].p[3];
    expect(Math.abs(end.x - (tBox.left - 32)), `${id} ends at the split point`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(end.y - trunk.p[0].y), `${id} ends at the same split point`).toBeLessThanOrEqual(0.5);
    expect(nearestSide(exported.edges[id].p[0], exported.nodes[id.replace('e', 's')]), `${id} leaves its source by the right`).toBe('right');
  }
  // The members do not cross each other before the split point.
  const stretch = (id: string) => sampleCubic(exported.edges[id].p, 64).slice(0, -3);
  for (const [a, b] of [['e1', 'e2'], ['e1', 'e3'], ['e2', 'e3']]) expect(crossingWitness(stretch(a), stretch(b), 32), `${a} and ${b} do not cross`).toBeNull();
  // The label stays on its member's own stretch.
  const labelled = await inDrawingFonts(page, svg, async surface => ({ ...(await labelAndLine(surface, 'e1')), scale: (await drawnRoutes(surface, 't')).scale }));
  expect(labelled.label, 'the label of e1 has room').not.toBeNull();
  const nearest = Math.min(...labelled.points.map(p => distanceToBox(p, labelled.label!)));
  expect(nearest, 'the label lies within 10 px of its own line').toBeLessThanOrEqual(10 * labelled.scale + 0.5);

  // The editor: a trunk element with the same facts, neutral lines, and the same cubics.
  await settleEdges(page);
  const trunkEl = page.getByTestId('trunk');
  await expect(trunkEl).toHaveCount(1);
  await expect(trunkEl).toHaveAttribute('data-part', 't'); await expect(trunkEl).toHaveAttribute('data-side', 'l');
  await expect(trunkEl).toHaveAttribute('data-edges', 'e1 e2 e3'); await expect(trunkEl).toHaveAttribute('data-tone', 'neutral');
  const editor = await drawnRoutes(page.getByTestId('canvas'), 't');
  expectSameRoutes(editor, exported, 'editor and image');
  for (const e of Object.values(await edgeSnaps(page))) { expect(e.tone).toBe('neutral'); expect(e.focus).toBe(false); }

  // Hovering the trunk is hovering none of its connections; hovering t puts all three in focus and colours the trunk.
  const on = await pointOnTrunk(page); await page.mouse.move(on.x, on.y);
  await page.waitForTimeout(300); // a short sleep: it proves that nothing happened
  for (const [id, e] of Object.entries(await edgeSnaps(page))) expect(e.focus, `${id} is not in focus while the trunk is hovered`).toBe(false);
  await page.getByTestId('node-t').hover();
  await expect.poll(async () => Object.values(await edgeSnaps(page)).every(e => e.focus && e.tone === 'kind')).toBe(true);
  await expect(trunkEl).toHaveAttribute('data-tone', 'kind');

  // The report: members share an end, so none of them crosses another.
  await page.mouse.move(2, 2);
  await openShare(page); const report = await settledReport(page);
  expect(report).toMatchObject({ connections: 3, crossings: 0 });
  await closeShare(page);

  // Opposite directions: sources about 20 degrees above and below the port are 40 degrees apart: no trunk, two ends spread on the side.
  const opp = await workspaceRaw('trunk-opposite', sketch('Trunk opposite', [{ id: 'v1', x: 0, y: 118 }, { id: 'v2', x: 0, y: 482 }, { id: 'u', x: 600, y: 300 }],
    [{ id: 'f1', from: 'v1', to: 'u' }, { id: 'f2', from: 'v2', to: 'u' }]));
  const oppOpened = await register(request, opp.file), oppSvg = await imageOf(request, oppOpened.id);
  expect((await inspectImage(page, oppSvg)).trunks, 'no trunk from opposite directions').toHaveLength(0);
  const oppDrawn = await inDrawingFonts(page, oppSvg, surface => drawnRoutes(surface, 'u'));
  expect(Object.keys(oppDrawn.edges).sort()).toEqual(['f1', 'f2']);
  for (const id of ['f1', 'f2']) expect(nearestSide(oppDrawn.edges[id].p[3], oppDrawn.nodes.u), `${id} arrives on the left`).toBe('left');
  expect(Math.abs(oppDrawn.edges.f1.p[3].y - oppDrawn.edges.f2.p[3].y), 'the two ends are spread at least 10 px apart').toBeGreaterThanOrEqual(9.5);

  // Same direction, another style: the async line is not in the trunk of the two calls.
  const mixed = await workspaceRaw('trunk-style', sketch('Trunk style', [...STACK, T], [edges[0], { ...edges[1], style: 'async' }, edges[2]]));
  const mixedOpened = await register(request, mixed.file), mixedSvg = await imageOf(request, mixedOpened.id);
  const mixedInfo = await inspectImage(page, mixedSvg);
  expect(mixedInfo.trunks).toHaveLength(1); expect(mixedInfo.trunks[0].edges).toEqual(['e1', 'e3']);
  const mixedDrawn = await inDrawingFonts(page, mixedSvg, surface => drawnRoutes(surface, 't'));
  expect(borderDistance(mixedDrawn.edges.e2.p[3], mixedDrawn.nodes.t), 'the async line runs to the port on its own').toBeLessThan(0.5);

  // Must not happen: a second trunk, a part moving to make room, or the file changing by looking.
  expect(info.trunks).toHaveLength(1);
  expect(await positionsOf(file), 'stored positions never move').toEqual(before);
});
