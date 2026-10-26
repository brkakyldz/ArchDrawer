import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, saved, box, drag, edgePaths, callout } from './helpers';
import { readView, nodeOf, persistedChoice, viewIn, pickUp, dragMarks } from './helpers-drawing';

test('H19 [EDIT-1 FILE-1 EDIT-5 #166 #167] select and move connected parts with the target group shown, regroup them and undo a destructive edit', async ({ page, request }) => {
  const doc = drawing('Moving order flow');
  for (const [i, n] of doc.views[0].nodes.entries()) { n.place = null; n.x = i === 0 ? 160 : 440; n.y = i === 2 ? 400 : 120; }
  doc.views[0].nodes.push(component('runtime', { label: 'Runtime', form: 'group', x: 840, y: 400 }));
  doc.views[0].texts.push({ id: 'reminder', text: 'Keep validation visible', x: 440, y: 620, size: 20 });
  const { file } = await workspace('move', doc); await openDrawing(page, request, file);
  const web = page.getByTestId('node-web'); const api = page.getByTestId('node-api');
  await web.click(); await expect(web).toHaveAttribute('data-selected', 'true');
  await api.click({ modifiers: ['Shift'] }); await expect(api).toHaveAttribute('data-selected', 'true');
  await web.click({ modifiers: ['Shift'] }); await expect(web).toHaveAttribute('data-selected', 'false');
  await page.keyboard.press('Escape');
  // Box-select these two components using an empty margin around their actual boxes.
  const wb = await box(web), ab = await box(api);
  await page.mouse.move(Math.min(wb.x, ab.x) - 12, Math.min(wb.y, ab.y) - 12);
  await page.mouse.down(); await page.mouse.move(Math.max(wb.x + wb.width, ab.x + ab.width) + 12, Math.max(wb.y + wb.height, ab.y + ab.height) + 12, { steps: 8 }); await page.mouse.up();
  await expect(web).toHaveAttribute('data-selected', 'true'); await expect(api).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Escape');
  const oldView = await readView(file), oldApi = await nodeOf(file, 'api'), originalPaths = await edgePaths(page, 'e1');
  // Dragging lifts the part and its connection follows while the pointer is still down.
  const b = await box(api); await page.mouse.move(b.x + b.width / 2, b.y + 20); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 45, b.y + 55, { steps: 6 });
  await expect(api).toHaveAttribute('data-lifted', 'true');
  await expect.poll(() => edgePaths(page, 'e1')).not.toEqual(originalPaths); // Must follow while still dragging.
  await page.mouse.up(); await saved(page);
  await expect(api).not.toHaveAttribute('data-lifted', 'true');
  await persistedChoice(file, d => viewIn(d)!.nodes.find(n => n.id === 'api')?.x !== oldApi.x);
  let moved = await nodeOf(file, 'api');
  // Positions are whole pixels; they are on the 8 px grid only in an axis where no guide snapped them, so only whole pixels are asserted.
  expect(Number.isInteger(moved.x) && Number.isInteger(moved.y), 'the moved part is at whole pixels').toBe(true);
  expect((await readView(file)).texts).toEqual(oldView.texts); // Free text has no component attachment.
  await page.keyboard.press('Escape');

  // Regroup by dropping on the group: the group is the target while the pointer is over it, and not any more once released.
  const groupBox = await box(page.getByTestId('node-runtime')); const sourceBox = await box(api);
  const held = await pickUp(page, 'api');
  await held.by(groupBox.x + groupBox.width / 2 - sourceBox.x - sourceBox.width / 2, groupBox.y + groupBox.height / 2 - sourceBox.y - sourceBox.height / 2, 12);
  await expect.poll(async () => (await dragMarks(page)).dropTargets).toEqual(['runtime']);
  await expect(page.getByTestId('node-runtime')).toHaveAttribute('data-drop-target', 'true');
  await held.release();
  await expect(api).toHaveAttribute('data-parent', 'runtime'); await saved(page);
  expect((await dragMarks(page)).dropTargets, 'no group is a target after the drop').toEqual([]);
  const childBefore = await nodeOf(file, 'api');
  await drag(page, page.getByTestId('node-runtime'), 40, 24); await saved(page);
  const childAfter = await nodeOf(file, 'api');
  expect(childAfter.x).not.toBe(childBefore.x); expect(childAfter.parent).toBe('runtime');
  // Drag the child back into the now-vacant area it occupied before grouping.
  const cb = await box(api); const target = await box(web);
  await page.keyboard.press('Escape'); await drag(page, api, target.x + target.width + 150 - cb.x - cb.width / 2, target.y - cb.y);
  await expect(api).toHaveAttribute('data-parent', ''); await saved(page);
  const apiCallout = await callout(page, 'api'); await apiCallout.getByTestId('callout-parent').selectOption('runtime'); await saved(page);
  const groupCallout = await callout(page, 'runtime'); await groupCallout.getByTestId('callout-form').click(); await page.getByTestId('form-option-card').click();
  await expect(page.getByTestId('node-runtime')).toHaveAttribute('data-form', 'card'); await expect(api).toHaveAttribute('data-parent', '');
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-runtime')).toHaveAttribute('data-form', 'group'); await expect(api).toHaveAttribute('data-parent', 'runtime');
  await (await callout(page, 'runtime')).getByTestId('callout-delete').click();
  await expect(page.getByTestId('node-runtime')).toHaveCount(0); await expect(api).toHaveAttribute('data-parent', '');
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-runtime')).toBeVisible(); await expect(api).toHaveAttribute('data-parent', 'runtime');
  await page.keyboard.press('Escape'); await api.click(); await page.keyboard.press('Escape');
  // Focus the drawing by clicking the component, then Delete (not a form field).
  await api.click(); await page.keyboard.press('Delete'); await expect(api).toHaveCount(0);
  await expect(page.getByTestId('edge-e1')).toHaveCount(0); await expect(page.getByTestId('edge-e2')).toHaveCount(0);
  await expect(page.getByTestId('text-reminder')).toContainText('Keep validation visible');
  await page.getByTestId('tool-undo').click(); await expect(api).toBeVisible(); await expect(page.getByTestId('edge-e1')).toBeVisible();
  await expect(page.getByTestId('text-reminder')).toContainText('Keep validation visible');
  await page.getByTestId('tool-redo').click(); await expect(api).toHaveCount(0); await saved(page);
  moved = await nodeOf(file, 'web');
  const stored = await readView(file); expect(stored.nodes.map(n => n.id)).toContain('web');
  expect(stored.nodes.map(n => n.id)).toContain('db'); expect(stored.edges).toHaveLength(0);
  expect(stored.texts).toEqual(oldView.texts);
  await page.reload(); await expect(api).toHaveCount(0); // Deleted components must not resurrect on reload.
});
