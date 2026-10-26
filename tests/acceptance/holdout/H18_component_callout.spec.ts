import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, project, saved, box, overlaps, callout as getCallout } from './helpers';
import { readChoice, persistedChoice } from './helpers-drawing';

const drawnOf = async (file: string) => project(await readChoice(file));

// EDIT-2: the callout is where a part's rows are listed and edited (ADR 0014, LOOK-3): the canvas draws none of them.
test('H18 [EDIT-1 EDIT-2 FILE-1 LOOK-3 #177] explain a component and edit every field and held item in its callout, with no row drawn on the canvas, without losing its neighbours', async ({ page, request }) => {
  const doc = drawing('Callout shop'); doc.views[0].nodes.push(component('runtime', { label: 'Runtime', form: 'group', place: { row: -1, col: 1 } }));
  const { file } = await workspace('callout', doc); await openDrawing(page, request, file);
  const node = page.getByTestId('node-api'); await node.click();
  let callout = page.getByTestId('callout-api'); await expect(callout).toBeVisible();
  await expect(callout.getByTestId('callout-title')).toHaveText('Order API');
  await expect(callout.getByTestId('callout-kind')).toHaveText('API');
  await expect(callout.getByTestId('callout-description')).toHaveText('Handles api.');
  await expect(callout.getByTestId('callout-files')).toContainText('src/api.ts');
  await expect(callout.getByTestId('callout-link-web')).toHaveAttribute('data-direction', 'both');
  await expect(callout.getByTestId('callout-link-db')).toHaveAttribute('data-direction', 'to');
  // The panel's two items are listed in the callout, as shown items, and drawn nowhere on the canvas.
  await expect(callout.getByTestId('callout-item')).toHaveCount(2);
  await expect(callout.getByTestId('callout-item')).toHaveText([/Validate order/, /Create order/]);
  for (const row of await callout.getByTestId('callout-item').all()) await expect(row).toHaveAttribute('data-row', 'item');
  await expect(node.getByTestId('node-item')).toHaveCount(0);
  await expect(node).not.toContainText('Validate order'); // Must not happen: a row drawn on the part.
  for (const id of ['web', 'api', 'db', 'runtime']) expect(overlaps(await box(callout), await box(page.getByTestId(`node-${id}`)))).toBe(false);
  const screenSize = await box(callout); await page.getByTestId('zoom-out').click();
  const zoomedSize = await box(callout); expect(Math.abs(screenSize.width - zoomedSize.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(screenSize.height - zoomedSize.height)).toBeLessThanOrEqual(1);
  await callout.getByTestId('callout-link-db').click(); await expect(page.getByTestId('callout-db')).toBeVisible();
  await expect(page.getByTestId('node-db')).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Escape'); await node.getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Checkout API'); await page.getByTestId('node-label-input').press('Enter');
  await node.getByTestId('node-label').dblclick(); await page.getByTestId('node-label-input').fill(''); await page.getByTestId('node-label-input').press('Enter');
  await page.keyboard.press('Escape');
  await expect(node.getByTestId('node-label')).toHaveText('Checkout API'); // An empty label must not replace it.
  await page.keyboard.press('Escape'); await page.getByTestId('node-web').getByTestId('node-sub').dblclick();
  await page.getByTestId('node-sub-input').fill('Browser'); await page.getByTestId('node-sub-input').press('Enter');
  await page.keyboard.press('Escape'); await node.click(); callout = page.getByTestId('callout-api');
  await callout.getByTestId('callout-kind').click(); await page.getByTestId('kind-option-gate').click();
  await callout.getByTestId('callout-icon').click(); await page.getByTestId('icon-option-lock').click();
  await callout.getByTestId('callout-description').dblclick();
  await page.getByTestId('callout-description-input').fill('Checks each order before it is stored.');
  await page.getByTestId('callout-description-input').press('ControlOrMeta+Enter');
  await callout.getByTestId('callout-item').first().dblclick();
  await page.getByTestId('callout-item-input').fill('Check scope'); await page.getByTestId('callout-item-input').press('Enter');
  await callout.getByTestId('callout-item-add').click();
  await page.getByTestId('callout-item-input').fill('Audit decision'); await page.getByTestId('callout-item-input').press('Enter');
  await callout.getByTestId('callout-item').last().getByTestId('callout-item-up').click();
  await expect(callout.getByTestId('callout-item')).toContainText(['Check scope', 'Audit decision', 'Create order']);
  await callout.getByTestId('callout-item').first().getByTestId('callout-item-down').click();
  await callout.getByTestId('callout-item').last().getByTestId('callout-item-remove').click();
  await callout.getByTestId('callout-file-add').click(); await page.getByTestId('callout-file-input').fill('src/extra.ts'); await page.getByTestId('callout-file-input').press('Enter');
  await callout.getByTestId('callout-file').first().getByTestId('callout-file-remove').click();
  await callout.getByTestId('callout-parent').selectOption('runtime'); await expect(node).toHaveAttribute('data-parent', 'runtime');
  await expect(node.getByTestId('node-item')).toHaveCount(0); // still no row on the canvas after every row edit
  await saved(page); await persistedChoice(file, d => project(d).views[0].nodes.find(n => n.id === 'api')?.items.join('|') === 'Audit decision|Check scope');
  let stored = await drawnOf(file);
  expect(stored.views[0].nodes.find(n => n.id === 'api')).toMatchObject({ label: 'Checkout API', kind: 'gate', form: 'panel', icon: 'lock', description: 'Checks each order before it is stored.', files: ['src/extra.ts'], parent: 'runtime' });
  expect(stored.views[0].nodes.find(n => n.id === 'web')?.sub).toBe('Browser');
  await page.reload(); await node.click(); callout = page.getByTestId('callout-api');
  await callout.getByTestId('callout-items').getByTestId('callout-item').first().getByTestId('callout-item-remove').click();
  await callout.getByTestId('callout-items').getByTestId('callout-item').first().getByTestId('callout-item-remove').click();
  await expect(node).toHaveAttribute('data-form', 'card');
  await callout.getByTestId('callout-form').click(); await page.getByTestId('form-option-panel').click();
  await expect(node).toHaveAttribute('data-form', 'panel');
  // A panel with no item gets `New item`: it is a row of the callout, not of the part.
  callout = await getCallout(page, 'api');
  await expect(callout.getByTestId('callout-item')).toHaveText([/New item/]); await expect(callout.getByTestId('callout-item').first()).toHaveAttribute('data-row', 'item');
  await expect(node.getByTestId('node-item')).toHaveCount(0);
  await callout.getByTestId('callout-item').first().dblclick();
  await page.getByTestId('callout-item-input').fill('Final check'); await page.getByTestId('callout-item-input').press('Enter');
  await expect(callout.getByTestId('callout-item')).toHaveText([/Final check/]);
  callout = await getCallout(page, 'api'); await callout.getByTestId('callout-icon').click(); await page.getByTestId('icon-option-default').click();
  await page.getByTestId('callout-api').getByTestId('callout-ask').click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(page.getByTestId('ai-scope-selection')).toBeChecked();
  await expect(node).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('ai-input')).toBeFocused();
  await saved(page); stored = await drawnOf(file);
  expect(stored.views[0].nodes.find(n => n.id === 'api')).toMatchObject({ icon: null, items: ['Final check'] });
  expect(stored.views[0].nodes).toHaveLength(4); expect(stored.views[0].edges).toHaveLength(2);
  expect(stored.requests ?? []).toHaveLength(0); // Prefilling an ask must not submit an instruction.
});
