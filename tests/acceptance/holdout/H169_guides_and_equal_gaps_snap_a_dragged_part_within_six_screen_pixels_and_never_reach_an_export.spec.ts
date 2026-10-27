import { test, expect } from '@playwright/test';
import { workspaceRaw, openDrawing, saved, box, previewSVG } from './helpers';
import { sketch, pickUp, dragMarks, nodeRect, nodeOf, editorOnlyMarks, imageOf, openShare, closeShare, cardSize } from './helpers-drawing';

// The anchor sits at stored coordinates that are not multiples of 8 (203, 301), so a snap to its lines is told from the 8 px grid.
// The mover m starts at (616, 640), clear of every line of the others. L and R are a row with a gap of 704 px (196 .. 900).
test('H169 [EDIT-5 #168] alignment guides and equal-gap marks snap a dragged part within 6 screen pixels, Alt turns snapping off, release moves nothing, and no export draws a guide', async ({ page, request }) => {
  test.setTimeout(60_000);
  const size = cardSize('card');
  const doc = sketch('Guides', [
    { id: 'anchor', label: 'Anchor', sub: 'stays', x: 203, y: 301 }, { id: 'm', label: 'Mover', sub: 'is moved', x: 616, y: 640 },
    { id: 'L', label: 'Left', sub: 'stays', x: 0, y: 1100 }, { id: 'R', label: 'Right', sub: 'stays', x: 900, y: 1100 },
  ]);
  const { file } = await workspaceRaw('guides', doc);
  const opened = await openDrawing(page, request, file);
  const ze = async () => (await nodeRect(page, 'anchor')).width / size.width; // screen px per drawing px
  const centre = async (id: string) => { const r = await nodeRect(page, id); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const park = async () => { const c = await box(page.getByTestId('canvas')); await page.mouse.move(c.x + 6, c.y + c.height - 6); };
  const restore = async () => {
    await page.getByTestId('tool-undo').click();
    await expect.poll(async () => { const n = await nodeOf(file, 'm'); return [n.x, n.y]; }).toEqual([616, 640]);
    await saved(page);
  };
  // Pick m up and bring its centre line `offset` screen px below the anchor's centre line (x unchanged).
  const attempt = async (offset: number, alt = false) => {
    const held = await pickUp(page, 'm', { alt });
    const m = await centre('m'), a = await centre('anchor');
    await held.by(0, a.y - m.y + offset, 12);
    await page.waitForTimeout(300);
    return held;
  };
  const yGuides = async () => (await dragMarks(page)).guides.filter(g => g.axis === 'y');
  const offsetScreen = async () => (await centre('m')).y - (await centre('anchor')).y;

  // (a) 4 screen px from the centre line: the guide shows at the anchor's centre (301 + 54), the part snaps onto it, release moves nothing.
  const z1 = await ze();
  let held = await attempt(4);
  await expect.poll(async () => (await yGuides()).some(g => Math.abs(g.at - 355) <= 1), { message: 'a guide on the anchor centre line' }).toBe(true);
  await expect.poll(async () => Math.abs(await offsetScreen()), { message: 'the centres are aligned' }).toBeLessThanOrEqual(1.2);
  const seenA = ((await nodeRect(page, 'm')).y - (await nodeRect(page, 'anchor')).y) / z1;
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'm')).y).toBe(301);
  await saved(page);
  let stored = await nodeOf(file, 'm');
  expect(Math.abs((stored.y! - 301) - seenA), 'release changed nothing').toBeLessThanOrEqual(1);
  expect(Math.abs(stored.x! % 8), 'no guide in x: the 8 px grid').toBe(0);
  expect((await dragMarks(page)).guides, 'no guide left after release').toEqual([]);
  await restore();

  // (b) 9 screen px away is past the distance: no guide in y, no alignment, the 8 px grid instead.
  held = await attempt(9);
  expect(await yGuides(), 'no guide beyond 6 screen px').toEqual([]);
  expect(Math.abs(await offsetScreen()), 'not aligned').toBeGreaterThan(3);
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'm')).y).not.toBe(640);
  await saved(page);
  stored = await nodeOf(file, 'm');
  expect(stored.y, 'not snapped to the anchor').not.toBe(301); expect(Math.abs(stored.y! % 8), 'y is on the 8 px grid').toBe(0);
  await restore();

  // (c) The distance is in screen px: zoom out, and 5 screen px still snaps while 9 do not.
  const before = await page.getByTestId('zoom-level').innerText();
  await page.getByTestId('zoom-out').click(); await expect(page.getByTestId('zoom-level')).not.toHaveText(before);
  const z2 = await ze(); expect(z2).toBeLessThan(z1);
  held = await attempt(5);
  await expect.poll(async () => (await yGuides()).some(g => Math.abs(g.at - 355) <= 1)).toBe(true);
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'm')).y).toBe(301);
  await saved(page); await restore();
  held = await attempt(9);
  expect(await yGuides(), 'still no guide at 9 screen px after zooming out').toEqual([]);
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'm')).y).not.toBe(640);
  await saved(page);
  expect((await nodeOf(file, 'm')).y).not.toBe(301);
  await restore();

  // (d) Alt: no guide, no gap mark, no snap; the part follows the pointer in whole pixels.
  held = await attempt(4, true);
  expect((await dragMarks(page)).guides, 'no guide with Alt').toEqual([]); expect((await dragMarks(page)).gaps, 'no gap mark with Alt').toEqual([]);
  const away = Math.abs(await offsetScreen());
  expect(away, 'about 4 screen px off, not aligned').toBeGreaterThan(2.5); expect(away).toBeLessThan(5.5);
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'm')).y).not.toBe(640);
  await saved(page);
  stored = await nodeOf(file, 'm');
  expect(stored.y, 'not snapped onto the anchor').not.toBe(301);
  expect(Number.isInteger(stored.x) && Number.isInteger(stored.y), 'whole pixels').toBe(true);
  expect(Math.abs(stored.y! - 301) * z2, 'about 4 screen px from the line').toBeGreaterThan(2.5);
  await restore();

  // (e) Between L and R with the gaps within 6 screen px of equal: two gap marks of the same size, and the gaps are equal after release.
  held = await pickUp(page, 'm');
  await held.by((450 - 616) * z2 + 2, (1100 - 640) * z2, 14);
  await expect.poll(async () => (await dragMarks(page)).gaps.length, { message: 'one mark for each gap' }).toBe(2);
  const gaps = (await dragMarks(page)).gaps;
  expect(gaps.every(g => g.axis === 'x')).toBe(true);
  expect(Math.abs(gaps[0].size - gaps[1].size), 'equal gaps').toBeLessThanOrEqual(1);
  expect(Math.abs(gaps[0].size - 254), 'each gap is 254 drawing px').toBeLessThanOrEqual(1.5);

  // (f) While the pointer is down the image that is exported, and after release the share preview, carry none of the editor's marks.
  expect(editorOnlyMarks(await imageOf(request, opened.id)), 'the export while dragging').toEqual([]);
  await held.release(); await park();
  await expect.poll(async () => (await nodeOf(file, 'm')).y).not.toBe(640);
  await saved(page);
  stored = await nodeOf(file, 'm');
  expect(Math.abs((stored.x! - size.width - 0) - (900 - (stored.x! + size.width))), 'the two gaps are equal after release').toBeLessThanOrEqual(1);
  const marks = await dragMarks(page);
  expect(marks.guides, 'no guide after release').toEqual([]); expect(marks.gaps, 'no gap mark after release').toEqual([]);
  await openShare(page);
  expect(editorOnlyMarks(await previewSVG(page)), 'the share preview').toEqual([]);
  await closeShare(page);

  // Must not happen: any other part moving because m was dragged.
  const anchor = await nodeOf(file, 'anchor');
  expect([anchor.x, anchor.y]).toEqual([203, 301]);
  expect([(await nodeOf(file, 'L')).x, (await nodeOf(file, 'R')).x]).toEqual([0, 900]);
});
