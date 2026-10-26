import { test, expect } from '@playwright/test';
import { workspaceRaw, openDrawing, register, settledReport } from './helpers';
import { inDrawingFonts, crossingWitness } from './helpers-svg-parity';
import { sketch, positionsOf, drawnRoutes, expectSameRoutes, nearestSide, cubicPoints, isStraight, sampleCubic, imageOf, openShare, closeShare, settleEdges, type Drawn } from './helpers-drawing';

// Distance of a point from the nearest side of a box (0 on the border).
const borderDistance = (p: { x: number; y: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  Math.min(Math.abs(p.x - b.left), Math.abs(p.x - b.right), Math.abs(p.y - b.top), Math.abs(p.y - b.bottom));

// Pairs of connections without a shared end whose drawn lines cross, counted on the sampled cubics.
function crossings(drawn: Drawn, metas: { id: string; from: string; to: string }[]) {
  let n = 0;
  for (let i = 0; i < metas.length; i++) for (let j = i + 1; j < metas.length; j++) {
    const a = metas[i], b = metas[j];
    if ([a.from, a.to].some(id => id === b.from || id === b.to)) continue;
    if (!drawn.edges[a.id] || !drawn.edges[b.id]) continue;
    if (crossingWitness(sampleCubic(drawn.edges[a.id].p), sampleCubic(drawn.edges[b.id].p), 32)) n++;
  }
  return n;
}

const PARTS = [
  { id: 'p', x: 0, y: 0 }, { id: 't1', x: 400, y: -60 }, { id: 't2', x: 400, y: 60 }, { id: 't4', x: 346, y: 200 },
  { id: 'a', x: 0, y: 500 }, { id: 'b', x: 236, y: 500 }, { id: 'c', x: 0, y: 700 }, { id: 'd', x: 236, y: 710 },
  { id: 'e', x: 700, y: 500 }, { id: 'f', x: 700, y: 688 },
];
const EDGES = [
  { id: 'eT1', from: 'p', to: 't1' }, { id: 'eT2', from: 'p', to: 't2' }, { id: 'eT4', from: 'p', to: 't4' },
  { id: 'ab', from: 'a', to: 'b' }, { id: 'cd', from: 'c', to: 'd' }, { id: 'ef', from: 'e', to: 'f' },
];

// LAYOUT-5 (#164): a side counts the ends it already holds, not only the angle; a handle never leaves the gap between close
// parts; ports in line give a straight line; the arrowhead touches the part it points at. LAYOUT-3: the report agrees.
test('H174 [LAYOUT-5 LAYOUT-3 #164] a connection leaves the next free side when its facing side is busy, close parts get handles that never leave the gap, ports in line give a straight line, and the arrowhead touches its part', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('busy-side', sketch('Busy side', PARTS, EDGES));
  const before = await positionsOf(file);
  const opened = await openDrawing(page, request, file);

  const svg = await imageOf(request, opened.id);
  const exported = await inDrawingFonts(page, svg, surface => drawnRoutes(surface, 'p'));
  await settleEdges(page);
  const editor = await drawnRoutes(page.getByTestId('canvas'), 'p');

  for (const [what, d] of [['image', exported], ['editor', editor]] as const) {
    const n = d.nodes;
    // (a) The right side of p holds the ends to t1 and t2; the third connection (30 degrees below horizontal) takes p's bottom and t4's left.
    expect(nearestSide(d.edges.eT1.p[0], n.p), `${what}: p to t1 leaves the right`).toBe('right');
    expect(nearestSide(d.edges.eT2.p[0], n.p), `${what}: p to t2 leaves the right`).toBe('right');
    expect(nearestSide(d.edges.eT4.p[0], n.p), `${what}: p to t4 leaves the busy right side by the bottom`).toBe('bottom');
    expect(nearestSide(d.edges.eT4.p[3], n.t4), `${what}: and arrives on the left of t4`).toBe('left');
    // (b) 40 px apart and level: straight, handles inside the gap. 40 px apart and 10 px off: still inside the gap.
    expect(isStraight(d.edges.ab.d), `${what}: level pair is straight`).toBe(true);
    for (const id of ['ab', 'cd']) {
      const p = d.edges[id].p, lo = Math.min(p[0].x, p[3].x), hi = Math.max(p[0].x, p[3].x);
      expect(hi - lo, `${what}: ${id} spans the 40 px gap`).toBeCloseTo(40, 0);
      for (const q of [p[1], p[2]]) { expect(q.x, `${what}: ${id} handle stays in the gap`).toBeGreaterThanOrEqual(lo - 0.01); expect(q.x).toBeLessThanOrEqual(hi + 0.01); }
      expect(Math.abs(p[1].x - p[0].x), `${what}: ${id} first handle`).toBeLessThanOrEqual(40.01);
      expect(Math.abs(p[3].x - p[2].x), `${what}: ${id} second handle`).toBeLessThanOrEqual(40.01);
    }
    expect(isStraight(d.edges.cd.d), `${what}: the pair 10 px off is a curve`).toBe(false);
    // (c) A vertical pair in line is straight too, its handles inside its 80 px gap.
    expect(isStraight(d.edges.ef.d), `${what}: vertical pair is straight`).toBe(true);
    const ef = d.edges.ef.p; for (const q of [ef[1], ef[2]]) { expect(q.y).toBeGreaterThanOrEqual(Math.min(ef[0].y, ef[3].y) - 0.01); expect(q.y).toBeLessThanOrEqual(Math.max(ef[0].y, ef[3].y) + 0.01); }
    // (d) The arrowhead touches the part: each line ends on the border of the part it points at.
    for (const [id, to] of [['eT1', 't1'], ['eT2', 't2'], ['eT4', 't4'], ['ab', 'b'], ['cd', 'd'], ['ef', 'f']] as const)
      expect(borderDistance(d.edges[id].p[3], n[to]), `${what}: ${id} ends on ${to}`).toBeLessThan(0.5);
  }
  // The editor and the image draw the same cubics once no pointer is down.
  expectSameRoutes(editor, exported, 'editor and image');

  // (e) The report agrees with an independent count of the drawn lines (no new crossing).
  const independent = crossings(exported, EDGES);
  await openShare(page); const report = await settledReport(page);
  expect(report.crossings, 'the share dialog counts what the image draws').toBe(independent);
  expect(report).toMatchObject({ connections: 6, parts: 10 });
  await closeShare(page);

  // The same T4 connection alone has nothing on the right side: it leaves p by the right.
  const alone = await workspaceRaw('busy-side-alone', sketch('Busy side alone', PARTS, [EDGES[2]]));
  const lone = await register(request, alone.file);
  const loneDrawn = await inDrawingFonts(page, await imageOf(request, lone.id), surface => drawnRoutes(surface, 'p'));
  expect(nearestSide(loneDrawn.edges.eT4.p[0], loneDrawn.nodes.p), 'without the other ends the facing right side is free').toBe('right');
  expect(nearestSide(loneDrawn.edges.eT4.p[3], loneDrawn.nodes.t4)).toBe('left');
  expect(cubicPoints(loneDrawn.edges.eT4.d)).not.toBeNull();

  // Must not happen: a stored position moving to make room, or a handle past the other end of a close pair.
  expect(await positionsOf(file), 'stored positions never move').toEqual(before);
  for (const id of ['ab', 'cd']) { const p = exported.edges[id].p; expect(Math.max(p[1].x, p[2].x), `${id}: no handle beyond the far end`).toBeLessThanOrEqual(Math.max(p[0].x, p[3].x) + 0.01); }
});
