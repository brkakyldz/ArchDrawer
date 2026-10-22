import { test, expect } from '@playwright/test';
import { workspaceRaw, openDrawing, saved, box } from './helpers';
import { sketch, pickUp, dragMarks, edgeSnaps, nodeSnaps, sameBox, nodeSize, sizeIs, zoomFactor, countPuts, positionsOf, nodeOf } from './helpers-drawing';

// A drawing of two loose pairs and a group: a -> b (a numbered line with a label), a group `zone` holding c -> d (labelled), and a
// loose part e with two lines (to d inside the group, and to f). e is dragged across the group while a, b, c, d, f and the lines
// that do not touch e stay as they are.
test('H167 [EDIT-5 LOOK-4 #166 #170] dragging one part across a group keeps the other labels, badges and frames still, lifts the part and lights its own lines, and is saved once on release', async ({ page, request }) => {
  test.setTimeout(240_000);
  const doc = sketch('Calm drag', [
    { id: 'a', label: 'Intake', sub: 'takes it', x: 0, y: 0 }, { id: 'b', label: 'Review', sub: 'checks it', x: 400, y: 0 },
    { id: 'zone', form: 'group', label: 'Processing zone' },
    { id: 'c', label: 'Parser', sub: 'reads it', x: 400, y: 400, parent: 'zone' }, { id: 'd', label: 'Writer', sub: 'stores it', x: 700, y: 400, parent: 'zone' },
    { id: 'e', label: 'Notifier', sub: 'tells people', x: 1100, y: 430 }, { id: 'f', label: 'Archive', sub: 'keeps it', x: 1100, y: 700 },
  ], [
    { id: 'ab', from: 'a', to: 'b', label: 'handoff', step: 1 }, { id: 'cd', from: 'c', to: 'd', label: 'inside' },
    { id: 'ed', from: 'e', to: 'd', label: 'notes' }, { id: 'ef', from: 'e', to: 'f', label: '' },
  ], { showSteps: true });
  const { file } = await workspaceRaw('calm-drag', doc);
  await openDrawing(page, request, file);
  const puts = countPuts(page);
  const startPositions = await positionsOf(file);
  const eStart = await nodeOf(file, 'e');
  const before = { edges: await edgeSnaps(page), nodes: await nodeSnaps(page), size: await nodeSize(page, 'e') };
  const z = await zoomFactor(page);
  const same = (a: any, b: any) => (a === null && b === null) || sameBox(a, b);
  const park = async () => { const c = await box(page.getByTestId('canvas')); await page.mouse.move(c.x + 6, c.y + c.height - 6); };

  // During the drag of e: the lifted look, the lit lines, and nothing else moves.
  const during = async (when: string, lifted: string[], dimParts: string[], dimEdges: string[], lit: string[], still: string[]) => {
    await expect.poll(async () => (await dragMarks(page)).lifted, { message: when }).toEqual(lifted);
    const marks = await dragMarks(page);
    expect(marks.dimmedParts, `${when}: every other part is dimmed`).toEqual(dimParts);
    expect(marks.dimmedEdges, `${when}: the lines that do not touch it are dimmed`).toEqual(dimEdges);
    expect(marks.litEdges, `${when}: its own lines are lit`).toEqual(lit);
    const now = await edgeSnaps(page), nodes = await nodeSnaps(page);
    for (const id of dimEdges) {
      expect(now[id].d, `${when}: ${id} keeps its path`).toBe(before.edges[id].d);
      expect(same(now[id].label, before.edges[id].label), `${when}: label of ${id} stays`).toBe(true);
      expect(same(now[id].badge, before.edges[id].badge), `${when}: badge of ${id} stays`).toBe(true);
      expect(now[id].tone, `${when}: ${id} tone`).toBe(id === 'ab' ? 'kind' : 'neutral');
    }
    for (const id of lit) { expect(now[id].tone, `${when}: ${id} in its kind colours`).toBe('kind'); expect(now[id].focus).toBe(true); }
    for (const id of still) expect(sameBox(nodes[id], before.nodes[id]), `${when}: the box of ${id} stays`).toBe(true);
    await expect(page.getByTestId('save-status'), `${when}: nothing is saved before release`).not.toHaveText('Saving…');
    expect(puts.count, `${when}: no save before release`).toBe(0);
  };

  const held = await pickUp(page, 'e');
  await held.by(-500 * z, 40 * z);
  await during('first third', ['e'], ['a', 'b', 'c', 'd', 'f', 'zone'], ['ab', 'cd'], ['ed', 'ef'], ['zone', 'a', 'b', 'c', 'd', 'f']);
  await held.by(-500 * z, 0);
  await during('across the group', ['e'], ['a', 'b', 'c', 'd', 'f', 'zone'], ['ab', 'cd'], ['ed', 'ef'], ['zone', 'a', 'b', 'c', 'd', 'f']);
  await page.waitForTimeout(400);
  await during('after waiting', ['e'], ['a', 'b', 'c', 'd', 'f', 'zone'], ['ab', 'cd'], ['ed', 'ef'], ['zone', 'a', 'b', 'c', 'd', 'f']);
  sizeIs(await nodeSize(page, 'e'), before.size, 'e while lifted');

  // Release: one save, no mark left, the same box.
  await held.release(); await park();
  await expect.poll(() => puts.count).toBe(1);
  await saved(page);
  await page.waitForTimeout(1500);
  expect(puts.count, 'one PUT for the whole drag').toBe(1);
  await expect.poll(async () => { const m = await dragMarks(page); return [m.lifted, m.dimmedParts, m.dimmedEdges, m.litEdges, m.dropTargets].map(x => x.length).join(','); }).toBe('0,0,0,0,0');
  sizeIs(await nodeSize(page, 'e'), before.size, 'e after release');
  const after = await edgeSnaps(page);
  expect(after.cd.tone).toBe('neutral'); expect(after.ed.tone).toBe('neutral'); expect(after.ef.tone).toBe('neutral');
  const eNow = await nodeOf(file, 'e');
  expect([eNow.x, eNow.y], 'e was moved').not.toEqual([eStart.x, eStart.y]);

  // Must not happen: another part moving, or the drag being more than one undo step.
  const movedOnly = (await positionsOf(file)).filter(([id]) => id !== 'e' && id !== 'zone');
  expect(movedOnly).toEqual(startPositions.filter(([id]) => id !== 'e' && id !== 'zone'));
  puts.reset();
  await page.getByTestId('tool-undo').click();
  await expect.poll(async () => { const n = await nodeOf(file, 'e'); return [n.x, n.y]; }).toEqual([eStart.x, eStart.y]);
  await saved(page);

  // A member of the group is dragged: the group it belongs to keeps its frame until release too.
  const zoneBefore = (await nodeSnaps(page)).zone;
  puts.reset();
  const member = await pickUp(page, 'c');
  await member.by(0, 60 * z);
  await expect.poll(async () => (await dragMarks(page)).lifted).toEqual(['c']);
  await page.waitForTimeout(400);
  expect(sameBox((await nodeSnaps(page)).zone, zoneBefore), 'the frame of the group holding the dragged part stays').toBe(true);
  expect(puts.count).toBe(0);
  await member.release(); await park();
  await expect.poll(() => puts.count).toBe(1);
  await saved(page);
  await page.waitForTimeout(1000);
  expect(puts.count, 'one PUT for the second drag').toBe(1);
  expect((await positionsOf(file)).filter(([id]) => !['c', 'zone'].includes(id))).toEqual(startPositions.filter(([id]) => !['c', 'zone'].includes(id)));
});
