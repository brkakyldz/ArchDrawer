import { test, expect } from '@playwright/test';
import { workspaceRaw, openDrawing, saved, box } from './helpers';
import { sketch, pickUp, dragMarks, nodeRect, countPuts, positionsOf, nodeOf, cardSize } from './helpers-drawing';

// A group `zone` of four parts with a wide empty area between them, a loose part p to its left and an obstacle q below p.
// Group members are k (400,100), k2 (1100,100), k3 (400,400) and k4 (1100,400): the empty area is around (848, 304).
test('H168 [EDIT-5 #167 #168] a drop shows the group it would join while dragging, never covers another part, and stays exactly where it is released when it overlaps nothing', async ({ page, request }) => {
  test.setTimeout(60_000);
  const doc = sketch('Drop rule', [
    { id: 'zone', form: 'group', label: 'Processing zone' },
    { id: 'k', label: 'Parser', sub: 'reads it', x: 400, y: 100, parent: 'zone' }, { id: 'k2', label: 'Checker', sub: 'checks it', x: 1100, y: 100, parent: 'zone' },
    { id: 'k3', label: 'Writer', sub: 'stores it', x: 400, y: 400, parent: 'zone' }, { id: 'k4', label: 'Mailer', sub: 'tells them', x: 1100, y: 400, parent: 'zone' },
    { id: 'p', label: 'Probe', sub: 'is moved', x: 0, y: 100 }, { id: 'q', label: 'Obstacle', sub: 'stays', x: 0, y: 500 },
  ]);
  const { file } = await workspaceRaw('drop-rule', doc);
  await openDrawing(page, request, file);
  const puts = countPuts(page);
  const size = cardSize('card');
  const startPositions = await positionsOf(file);
  const ze = (await nodeRect(page, 'k')).width / size.width; // screen px per drawing px
  const centreOf = async (id: string) => { const r = await nodeRect(page, id); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const goTo = async (held: Awaited<ReturnType<typeof pickUp>>, target: { x: number; y: number }) => {
    const c = await centreOf('p'); await held.by(target.x - c.x, target.y - c.y, 10);
  };
  const park = async () => { const c = await box(page.getByTestId('canvas')); await page.mouse.move(c.x + 6, c.y + c.height - 6); };
  const undoTo = async (x: number, y: number, parent: string | null) => {
    await page.getByTestId('tool-undo').click();
    await expect.poll(async () => { const n = await nodeOf(file, 'p'); return [n.x, n.y, n.parent ?? null]; }).toEqual([x, y, parent]);
    await saved(page); puts.reset();
  };
  const home = await centreOf('p');
  const kC = await centreOf('k');
  const emptyArea = { x: kC.x + (848 - 498) * ze, y: kC.y + (304 - 154) * ze };

  // Phase 1: over the group its highlight shows, over empty canvas it does not, and releasing over the group joins it.
  let held = await pickUp(page, 'p');
  await goTo(held, await centreOf('zone'));
  await expect.poll(async () => (await dragMarks(page)).dropTargets).toEqual(['zone']);
  await expect(page.getByTestId('node-zone')).toHaveAttribute('data-drop-target', 'true');
  await goTo(held, home);
  await expect.poll(async () => (await dragMarks(page)).dropTargets, { message: 'over no group no part is a target' }).toEqual([]);
  await goTo(held, emptyArea);
  await expect.poll(async () => (await dragMarks(page)).dropTargets).toEqual(['zone']);
  expect(puts.count, 'nothing is saved while dragging').toBe(0);
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'p')).parent).toBe('zone');
  await expect.poll(() => puts.count).toBe(1);
  await saved(page);
  expect((await dragMarks(page)).dropTargets, 'no target after release').toEqual([]);
  await expect(page.getByTestId('node-zone')).not.toHaveAttribute('data-drop-target', 'true');
  await undoTo(0, 100, null);

  // Phase 2: dropped on the obstacle, p moves to the nearest free spot: on the 8 px grid, 24 px clear of every other part.
  held = await pickUp(page, 'p');
  const qC = await centreOf('q');
  await goTo(held, { x: qC.x, y: qC.y - 14 * ze });
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'p')).y).not.toBe(100);
  await saved(page);
  const dropped = await nodeOf(file, 'p');
  expect(Math.abs(dropped.x! % 8), 'x is on the 8 px grid').toBe(0); expect(Math.abs(dropped.y! % 8), 'y is on the 8 px grid').toBe(0);
  expect(dropped.parent ?? null, 'it keeps the parent its drop gave it: none').toBeNull();
  for (const id of ['q', 'k', 'k2', 'k3', 'k4']) {
    const o = await nodeOf(file, id);
    const gapX = Math.max(o.x! - (dropped.x! + size.width), dropped.x! - (o.x! + size.width)), gapY = Math.max(o.y! - (dropped.y! + size.height), dropped.y! - (o.y! + size.height));
    expect(Math.max(gapX, gapY), `p is 24 px clear of ${id}`).toBeGreaterThanOrEqual(23);
  }
  expect(Math.hypot(dropped.x! + size.width / 2 - 98, dropped.y! + size.height / 2 - 540), 'it lands near where it was dropped').toBeLessThanOrEqual(400);
  await undoTo(0, 100, null);

  // Phase 3: dropped in the group's empty area, where it overlaps nothing, p stays exactly where it was released.
  held = await pickUp(page, 'p');
  await goTo(held, emptyArea);
  await expect.poll(async () => (await dragMarks(page)).dropTargets).toEqual(['zone']);
  await page.waitForTimeout(300);
  const pr = await nodeRect(page, 'p'), kr = await nodeRect(page, 'k');
  const seen = { dx: (pr.x - kr.x) / ze, dy: (pr.y - kr.y) / ze };
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'p')).parent).toBe('zone');
  await saved(page);
  const inside = await nodeOf(file, 'p'), k = await nodeOf(file, 'k');
  expect(Math.abs((inside.x! - k.x!) - seen.dx), 'x stays where it was released').toBeLessThanOrEqual(1.5);
  expect(Math.abs((inside.y! - k.y!) - seen.dy), 'y stays where it was released').toBeLessThanOrEqual(1.5);
  expect((await dragMarks(page)).dropTargets, 'no target after release').toEqual([]);

  // Must not happen: any other part moving because p was dropped.
  const others = (list: [string, number | undefined, number | undefined][]) => list.filter(([id]) => id !== 'p' && id !== 'zone');
  expect(others(await positionsOf(file))).toEqual(others(startPositions));
});
