import { test, expect } from '@playwright/test';
import { component, drawing, kinds, workspace, openDrawing, readDrawing, persisted, saved, box, canvasClick, emptyCanvasPoint } from './helpers';

test('H21 [EDIT-1, FILE-1] choose kinds and forms at their destination, including a child in a group, and cancel safely', async ({ page, request }) => {
  const doc = drawing('Growing the system');
  doc.views[0].nodes = [component('container', { label: 'Runtime', form: 'group', x: 500, y: 220 })]; doc.views[0].edges = [];
  const { file } = await workspace('picker', doc); await openDrawing(page, request, file);
  const initial = await readDrawing(file); await page.getByTestId('tool-component').click();
  let point = await emptyCanvasPoint(page); await canvasClick(page, point.x, point.y);
  await expect(page.getByTestId('component-picker')).toBeVisible();
  for (const kind of kinds) await expect(page.getByTestId(`picker-kind-${kind}`)).toBeVisible();
  for (const form of ['card', 'compact', 'panel', 'group']) await expect(page.getByTestId(`picker-form-${form}`)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('component-picker')).toHaveCount(0);
  expect((await readDrawing(file)).views[0].nodes).toEqual(initial.views[0].nodes); // Cancel adds nothing.
  const added: string[] = [];
  for (const [index, form] of ['card', 'compact', 'panel', 'group'].entries()) {
    await page.getByTestId('tool-component').click(); point = await emptyCanvasPoint(page);
    await canvasClick(page, point.x, point.y); await page.getByTestId(`picker-kind-${index === 2 ? 'llm' : 'worker'}`).click();
    await page.getByTestId(`picker-form-${form}`).click(); const beforeIds = (await readDrawing(file)).views[0].nodes.map(n => n.id);
    await page.getByTestId('picker-add').click(); await expect(page.getByTestId('node-label-input')).toHaveValue('New component');
    await expect(page.getByTestId('node-label-input')).toBeFocused();
    await page.getByTestId('node-label-input').fill(`Added ${form}`); await page.getByTestId('node-label-input').press('Enter');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await persisted(file, d => d.views[0].nodes.some(n => n.label === `Added ${form}`));
    const node = (await readDrawing(file)).views[0].nodes.find(n => !beforeIds.includes(n.id))!; added.push(node.id);
    expect(node).toMatchObject({ form, kind: index === 2 ? 'llm' : 'worker', parent: null, items: form === 'panel' ? ['New item'] : [] });
    await page.keyboard.press('Escape');
  }
  await page.getByTestId('tool-component').click(); const container = await box(page.getByTestId('node-container')); const canvas = await box(page.getByTestId('canvas'));
  await canvasClick(page, container.x - canvas.x + container.width / 2, container.y - canvas.y + container.height - 30);
  await expect(page.getByTestId('component-picker')).toBeVisible(); await page.getByTestId('picker-kind-gate').click(); await page.getByTestId('picker-form-compact').click();
  await page.getByTestId('picker-add').click(); await page.getByTestId('node-label-input').fill('Scope check'); await page.getByTestId('node-label-input').press('Enter');
  await persisted(file, d => d.views[0].nodes.some(n => n.label === 'Scope check' && n.parent === 'container'));
  const child = (await readDrawing(file)).views[0].nodes.find(n => n.label === 'Scope check')!;
  await expect(page.getByTestId(`node-${child.id}`)).toHaveAttribute('data-parent', 'container');
  // Undo the rename, then the insertion; redo both. The other new parts must survive.
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId(`node-${child.id}`).getByTestId('node-label')).toHaveText('New component');
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId(`node-${child.id}`)).toHaveCount(0);
  for (const id of added) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await page.getByTestId('tool-redo').click(); await page.getByTestId('tool-redo').click(); await saved(page); await page.reload();
  await expect(page.getByTestId(`node-${child.id}`).getByTestId('node-label')).toHaveText('Scope check');
  expect((await readDrawing(file)).views[0].nodes).toHaveLength(6);
});
