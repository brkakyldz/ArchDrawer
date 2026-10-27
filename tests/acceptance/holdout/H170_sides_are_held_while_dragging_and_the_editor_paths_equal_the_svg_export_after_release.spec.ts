import { test, expect } from '@playwright/test';
import { workspaceRaw, openDrawing, saved, box } from './helpers';
import { inDrawingFonts } from './helpers-svg-parity';
import { sketch, pickUp, drawnRoutes, expectSameRoutes, nearestSide, settleEdges, zoomFactor, imageOf, nodeOf, readView, type Drawn } from './helpers-drawing';

// A (0,0) and B (300,0): centres 300 px apart. B is dragged straight down with Alt held (no snap). Stateless, the facing sides
// change where the centre-to-centre angle passes 45 degrees; while the pointer is down the pair is kept until the cheapest pair
// costs less than 0.8 times the kept one (about 42.3 degrees going back, 47.5 degrees going down). 320 px down is 46.8 degrees.
test('H170 [LAYOUT-5 EDIT-5 #165 #164] sides are held while a part is dragged, flip to the stateless choice on release, and the editor paths then equal the SVG export', async ({ page, request }) => {
  test.setTimeout(60_000);
  const doc = sketch('Held sides', [
    { id: 'A', label: 'Source', sub: 'starts', x: 0, y: 0 }, { id: 'B', label: 'Target', sub: 'ends', x: 300, y: 0 },
  ], [{ id: 'ab', from: 'A', to: 'B', label: '' }]);
  const { file } = await workspaceRaw('held-sides', doc);
  const opened = await openDrawing(page, request, file);
  const canvas = page.getByTestId('canvas');
  const park = async () => { const c = await box(canvas); await page.mouse.move(c.x + 6, c.y + c.height - 6); };
  const sidesOf = (d: Drawn) => { const p = d.edges.ab.p; return { a: nearestSide(p[0], d.nodes.A), b: nearestSide(p[3], d.nodes.B) }; };
  const editorSides = async () => sidesOf(await drawnRoutes(canvas, 'A'));
  const expectSides = async (a: string, b: string, when: string) => {
    await page.waitForTimeout(300);
    await expect.poll(editorSides, { message: when }).toEqual({ a, b });
  };
  const exportDrawn = async () => await inDrawingFonts(page, await imageOf(request, opened.id), s => drawnRoutes(s, 'A'));
  const agree = async (what: string) => {
    await settleEdges(page);
    const editor = await drawnRoutes(canvas, 'A'), image = await exportDrawn();
    expectSameRoutes(editor, image, what);
    return image;
  };
  const aStart = await nodeOf(file, 'A'), bStart = await nodeOf(file, 'B');
  const rest = (p: Record<string, unknown>) => { const { x, y, ...others } = p as any; return others; };

  expect(await editorSides(), 'side by side: right to left').toEqual({ a: 'right', b: 'left' });
  let z = await zoomFactor(page);

  // Down: the pair is the stateless one up to 45 degrees and still the kept one at 46.8 degrees.
  let held = await pickUp(page, 'B', { alt: true });
  await held.by(0, 100 * z); await expectSides('right', 'left', 'at 18 degrees');
  await held.by(0, 150 * z); await expectSides('right', 'left', 'at 40 degrees');
  await held.by(0, 70 * z); await expectSides('right', 'left', 'at 46.8 degrees the kept pair stays while the pointer is down');
  await page.waitForTimeout(400);
  expect(await editorSides(), 'and it still stays a moment later').toEqual({ a: 'right', b: 'left' });

  // Release: the route is the stateless one the export draws.
  await held.release(); await park();
  await expect.poll(editorSides, { message: 'after release the stateless pair' }).toEqual({ a: 'bottom', b: 'top' });
  await saved(page);
  const image = await agree('after releasing at 46.8 degrees');
  // Must not happen: the export using the held sides.
  expect(sidesOf(image), 'the export never uses held sides').toEqual({ a: 'bottom', b: 'top' });
  const bMoved = await nodeOf(file, 'B');
  expect(Math.abs(bMoved.y! - 320), 'B was moved straight down').toBeLessThanOrEqual(2); expect(bMoved.x).toBe(300);
  expect(rest(bMoved as any), 'only the position of B changed in the file').toEqual(rest(bStart as any));
  expect(await nodeOf(file, 'A')).toEqual(aStart);
  expect((await readView(file)).edges.length).toBe(1);

  // A fresh editor has no memory of the drag: the same paths.
  await page.reload(); await expect(page.getByTestId('editor')).toBeVisible(); await saved(page);
  expect(await editorSides(), 'after a reload').toEqual({ a: 'bottom', b: 'top' });
  await agree('after a reload');

  // Back up: the vertical pair is kept down to 43.8 degrees and given up well before 38 degrees.
  z = await zoomFactor(page);
  held = await pickUp(page, 'B', { alt: true });
  await held.by(0, -32 * z); await expectSides('bottom', 'top', 'at 43.8 degrees the kept pair stays');
  await held.by(0, -54 * z); await expectSides('right', 'left', 'at 38 degrees the cheaper pair is taken');
  await held.release(); await park();
  await expect.poll(editorSides).toEqual({ a: 'right', b: 'left' });
  await saved(page);
  const second = await agree('after releasing at 38 degrees');
  expect(sidesOf(second)).toEqual({ a: 'right', b: 'left' });
});
