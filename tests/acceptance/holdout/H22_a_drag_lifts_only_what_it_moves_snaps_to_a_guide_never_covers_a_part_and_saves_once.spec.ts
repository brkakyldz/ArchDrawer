import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import {
  drawingRepo, doc, choice, comp, rel, part, link, view, openDrawing, stored, viewOf, nodeOf, box, saved, exportSvg, readImage, drawn, svgOnPage, expectSameDrawing,
} from './helpers';

const product = useProduct();

function drawing() {
  return doc('Drag shop', [choice('system', 'The whole system', 'system', {
    components: [comp('p1', 'Mover', 'service'), comp('p2', 'Target', 'service'), comp('p3', 'Third', 'service'),
      comp('runtime', 'Runtime', 'service'), comp('a', 'Inner one', 'service'), comp('b', 'Inner two', 'service')],
    relations: [rel('r1', 'p1', 'p2'), rel('r2', 'a', 'b'), rel('r3', 'p3', 'a')],
  }, [view('overview', 'Overview', [
    part('p1', { x: 96, y: 520 }), part('p2', { x: 640, y: 112 }), part('p3', { x: 1040, y: 520 }),
    part('runtime', { form: 'group', x: 96, y: 112 }), part('a', { parent: 'runtime', x: 120, y: 176 }), part('b', { parent: 'runtime', x: 360, y: 176 }),
  ], [link('p1', 'p2', ['r1'], null, { id: 'e1' }), link('a', 'b', ['r2'], null, { id: 'e2' }), link('p3', 'a', ['r3'], null, { id: 'e3' })])])]);
}
const pathOf = async (page: import('@playwright/test').Page, id: string) => (await drawn(page.getByTestId('canvas'), 'p2')).edges[id]?.d;

// A user drags a part across the drawing: only it lifts and its own line lights up while every other line, label and group frame holds
// still; the group under the pointer shows it would take the part; near another part's top a guide shows and the part snaps to it; the
// release changes nothing and saves once; Undo takes the whole drag back; a part dropped on another moves to a free spot.
test('H22 [EDIT-5 EDIT-1 LAYOUT-5] a drag lifts only what it moves, shows the target group and a guide, snaps so release changes nothing, saves once, and a drop never covers a part', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('drag', drawing());
  const id = await openDrawing(page, p, file);
  const zoom = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')) / 100;
  const puts: string[] = [];
  page.on('request', r => { if (r.method() === 'PUT') puts.push(r.url()); });
  const start = viewOf(await stored(p, id), 'overview');
  const groupBox = await box(page.getByTestId('node-runtime'));
  const otherLine = await pathOf(page, 'e2');
  const moverBox = await box(page.getByTestId('node-p1'));

  // Press on the mover and carry it over the group: it lifts, the rest dims, the group shows it would take it.
  const grab = { x: moverBox.x + moverBox.width / 2, y: moverBox.y + moverBox.height / 2 };
  await page.mouse.move(grab.x, grab.y); await page.mouse.down();
  // The part's centre (under the pointer) inside the group's frame, between its two members.
  const overGroup = { x: groupBox.x + groupBox.width / 2, y: groupBox.y + groupBox.height / 2 };
  await page.mouse.move(overGroup.x, overGroup.y, { steps: 12 });
  await expect(page.getByTestId('node-p1')).toHaveAttribute('data-lifted', 'true');
  await expect(page.getByTestId('node-p3')).toHaveAttribute('data-drag-dim', 'true');
  await expect(page.getByTestId('edge-e1')).toHaveAttribute('data-focus', 'true');
  await expect(page.getByTestId('edge-e2')).toHaveAttribute('data-drag-dim', 'true');
  await expect(page.getByTestId('node-runtime')).toHaveAttribute('data-drop-target', 'true');
  const lifted = await box(page.getByTestId('node-p1'));
  expect([Math.round(lifted.width), Math.round(lifted.height)], 'no scale while lifted').toEqual([Math.round(moverBox.width), Math.round(moverBox.height)]);
  expect(await pathOf(page, 'e2'), 'another line keeps its path during the drag').toBe(otherLine);
  const frame = await box(page.getByTestId('node-runtime'));
  expect([frame.x, frame.y, frame.width, frame.height], 'the group frame holds still').toEqual([groupBox.x, groupBox.y, groupBox.width, groupBox.height]);
  await expect(page.getByTestId('save-status')).not.toHaveText(/Saving/);

  // Carry it to just under the target's top: a horizontal guide shows, and the part snaps level with the target.
  const target = nodeOf(start, 'p2');
  const dyScreen = (target.y - nodeOf(start, 'p1').y) * zoom + 3;
  const dxScreen = (target.x + 400 - nodeOf(start, 'p1').x) * zoom;
  await page.mouse.move(grab.x + dxScreen, grab.y + dyScreen, { steps: 12 });
  // A horizontal guide is a line with no height, so it is checked as present in the page, at the target's top, middle or bottom.
  const guide = page.locator('[data-testid="drag-guide"][data-axis="y"]').first();
  await expect(guide).toBeAttached();
  const at = Number(await guide.getAttribute('data-at'));
  expect([target.y, target.y + (await box(page.getByTestId('node-p2'))).height / zoom / 2, target.y + (await box(page.getByTestId('node-p2'))).height / zoom].some(y => Math.abs(y - at) <= 1),
    `the guide at ${at} is a line of the target`).toBe(true);
  await expect(page.getByTestId('node-runtime')).not.toHaveAttribute('data-drop-target', 'true');
  expect(puts, 'nothing is saved before release').toEqual([]);
  await page.mouse.up();
  await expect(page.getByTestId('drag-guide')).toHaveCount(0);
  await expect(page.getByTestId('node-p1')).not.toHaveAttribute('data-lifted', 'true');
  await saved(page);
  await expect.poll(async () => nodeOf(viewOf(await stored(p, id), 'overview'), 'p1').y).toBe(target.y);
  const moved = nodeOf(viewOf(await stored(p, id), 'overview'), 'p1');
  expect(moved.x % 8, 'the free axis snaps to the 8 px grid').toBe(0);
  expect(moved.parent, 'dropped outside the group').toBeNull();
  expect(puts, 'one save per drag').toHaveLength(1);
  const image = await exportSvg(p, id, 'format=readme');
  expect(image).not.toMatch(/drag-guide|data-lifted|data-drop-target/);
  expect((await readImage(page, image)).nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'p1', 'p2', 'p3', 'runtime']);

  // Once the pointer is up, the editor's routes are the export's: no side held from the drag.
  const shown = await svgOnPage(page, image);
  try { expectSameDrawing(await drawn(page.getByTestId('canvas'), 'p2'), await drawn(shown.surface, 'p2'), 'after release'); } finally { await shown.close(); }

  // Undo takes the whole drag back in one step.
  await page.getByTestId('tool-undo').click();
  await saved(page);
  await expect.poll(async () => { const n = nodeOf(viewOf(await stored(p, id), 'overview'), 'p1'); return [n.x, n.y]; }).toEqual([nodeOf(start, 'p1').x, nodeOf(start, 'p1').y]);

  // A part dropped on another never covers it: it moves to the nearest free spot.
  const third = await box(page.getByTestId('node-p3')), aim = await box(page.getByTestId('node-p2'));
  await page.mouse.move(third.x + third.width / 2, third.y + 20); await page.mouse.down();
  await page.mouse.move(aim.x + aim.width / 2, aim.y + 20, { steps: 12 }); await page.mouse.up();
  await saved(page);
  await expect.poll(async () => nodeOf(viewOf(await stored(p, id), 'overview'), 'p3').y).not.toBe(nodeOf(start, 'p3').y);
  const after = await drawn(page.getByTestId('canvas'), 'p2');
  const [q3, q2] = [after.nodes.p3, after.nodes.p2];
  const clear = Math.max(q2.left - q3.right, q3.left - q2.right, q2.top - q3.bottom, q3.top - q2.bottom);
  expect(clear, 'at least 24 px clear of the part it was dropped on').toBeGreaterThanOrEqual(23.5);
});
