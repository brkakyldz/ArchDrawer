import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, callout, project, emptyCanvasPoint, canvasClick, box } from './helpers';
import { readChoice, persistedChoice } from './helpers-drawing';

const drawnOf = async (file: string) => project(await readChoice(file));

test('H40 [EDIT-1 EDIT-2 FILE-1 LOOK-3 #177] rename from the callout, choose pictured forms whose panel holds its rows in the callout, and follow tool hints without accidental edits', async ({ page, request }) => {
  const { file } = await workspace('discover-editing', drawing('Editing shop')); await openDrawing(page, request, file);
  const baseline = await drawnOf(file); let detail = await callout(page, 'web');
  await detail.getByTestId('callout-title').click(); await expect(page.getByTestId('callout-title-input')).toHaveValue('Web app');
  await page.getByTestId('callout-title-input').fill('Cancelled label'); await page.getByTestId('callout-title-input').press('Escape');
  await expect(detail.getByTestId('callout-title')).toHaveText('Web app'); expect((await drawnOf(file)).views).toEqual(baseline.views);
  await detail.getByTestId('callout-title').click(); await page.getByTestId('callout-title-input').fill(''); await page.getByTestId('callout-title-input').press('Enter');
  if (await page.getByTestId('callout-title-input').isVisible()) await page.getByTestId('callout-title-input').press('Escape');
  detail = await callout(page, 'web'); await expect(detail.getByTestId('callout-title')).toHaveText('Web app');
  await detail.getByTestId('callout-title').click(); await page.getByTestId('callout-title-input').fill('Storefront'); await page.getByTestId('callout-title-input').press('Enter');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Storefront'); await persistedChoice(file, d => project(d).views[0].nodes[0].label === 'Storefront');
  await detail.getByTestId('callout-form').click();
  for (const form of ['card', 'compact', 'panel', 'group']) {
    const thumbnail = page.getByTestId(`form-option-${form}`).getByTestId('form-thumb'); await expect(thumbnail).toBeVisible(); expect((await box(thumbnail)).height).toBeGreaterThan(0);
  }
  await page.getByTestId('form-option-panel').click(); await expect(page.getByTestId('node-web')).toHaveAttribute('data-form', 'panel');
  // A panel holds its rows in the callout: `New item` is there, as a shown item, and the part draws nothing for it.
  detail = await callout(page, 'web');
  await expect(detail.getByTestId('callout-item')).toHaveText([/New item/]); await expect(detail.getByTestId('callout-item').first()).toHaveAttribute('data-row', 'item');
  await expect(page.getByTestId('node-web').getByTestId('node-item')).toHaveCount(0);
  await expect(page.getByTestId('node-web')).not.toContainText('New item'); // Must not happen: a row drawn on the part.
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-web')).toHaveAttribute('data-form', 'card');
  await page.keyboard.press('Escape');
  for (const [tool, hint] of [
    ['component', 'Click an empty spot to add a component'], ['connect', 'Drag from one component to another to connect them'],
    ['text', 'Click anywhere to type text'], ['pan', 'Drag to move around'],
  ]) { await page.getByTestId(`tool-${tool}`).click(); await expect(page.getByTestId('tool-hint')).toHaveText(hint); }
  await page.getByTestId('tool-select').click(); await expect(page.getByTestId('tool-hint')).not.toBeVisible();
  await page.getByTestId('tool-component').click(); const point = await emptyCanvasPoint(page); await canvasClick(page, point.x, point.y);
  for (const form of ['card', 'compact', 'panel', 'group']) await expect(page.getByTestId(`picker-form-${form}`).getByTestId('form-thumb')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('component-picker')).not.toBeVisible();
  await persistedChoice(file, d => project(d).views[0].nodes[0].label === 'Storefront' && project(d).views[0].nodes[0].form === 'card');
  const expected = structuredClone(baseline.views); expected[0].nodes[0].label = 'Storefront'; expect((await drawnOf(file)).views).toEqual(expected);
  await page.reload(); await expect((await callout(page, 'web')).getByTestId('callout-title')).toHaveText('Storefront');
  expect((await drawnOf(file)).views[0].nodes).toHaveLength(3); expect((await drawnOf(file)).requests).toHaveLength(0);
});
