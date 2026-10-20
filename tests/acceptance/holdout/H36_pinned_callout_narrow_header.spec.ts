import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, callout, box, overlaps, persisted, readDrawing } from './helpers';

test('H36 [EDIT-1, EDIT-2, LOOK-1, FILE-1] pin explanations beside the canvas and keep editing controls reachable in a narrow header', async ({ page, request }) => {
  const { file } = await workspace('narrow', drawing('Narrow shop')); await openDrawing(page, request, file);
  const baseline = await readDrawing(file), freeWidth = (await box(page.getByTestId('canvas'))).width;
  let detail = await callout(page, 'api'); await expect(detail).toHaveAttribute('data-docked', 'false');
  await expect(detail.getByTestId('callout-pin')).toHaveAccessibleName('Pin to the side'); await detail.getByTestId('callout-pin').click();
  await expect(detail).toHaveAttribute('data-docked', 'true'); await expect(detail.getByTestId('callout-pin')).toHaveAttribute('aria-pressed', 'true');
  expect((await box(page.getByTestId('canvas'))).width).toBeLessThan(freeWidth); expect(overlaps(await box(detail), await box(page.getByTestId('canvas')))).toBe(false);
  await detail.getByTestId('callout-link-db').click(); detail = page.getByTestId('callout-db'); await expect(detail).toHaveAttribute('data-docked', 'true');
  await page.setViewportSize({ width: 820, height: 900 }); await expect(page.getByTestId('header-menu-button')).toBeVisible();
  await page.getByTestId('header-menu-button').click(); const menu = page.getByTestId('header-menu'); await expect(menu).toBeVisible();
  for (const id of ['repo-name', 'crumbs', 'tool-undo', 'tool-redo', 'tool-theme', 'tool-steps']) await expect(menu.getByTestId(id)).toBeVisible();
  await expect(menu.getByTestId('repo-name')).toHaveText('Narrow shop');
  for (const id of ['header-menu-button', 'tool-undo', 'tool-redo', 'tool-theme', 'tool-steps']) await expect(page.getByTestId(id)).toHaveAccessibleName(/\S/);
  await menu.getByTestId('tool-theme').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await persisted(file, d => d.theme === 'dark');
  async function header() { if (!await menu.isVisible()) await page.getByTestId('header-menu-button').click(); return menu; }
  await (await header()).getByTestId('tool-undo').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');
  await (await header()).getByTestId('tool-redo').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark');
  await (await header()).getByTestId('tool-steps').click(); await expect(page.getByTestId('step-badge-e1')).toHaveText('1'); await persisted(file, d => d.showSteps === true);
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  detail = await callout(page, 'db'); expect(overlaps(await box(detail), await box(page.getByTestId('canvas')))).toBe(false);
  for (const button of await page.getByRole('button').all()) {
    if (await button.isVisible() && !(await button.innerText()).trim()) {
      await expect(button).toHaveAttribute('aria-label', /\S/); await expect(button).toHaveAccessibleName(/\S/);
    }
  }
  await detail.getByTestId('callout-pin').click(); await expect(detail).toHaveAttribute('data-docked', 'false');
  await page.setViewportSize({ width: 1600, height: 1000 }); await expect(page.getByTestId('header-menu-button')).not.toBeVisible();
  await page.reload(); await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await expect(page.getByTestId('tool-steps')).toHaveAttribute('aria-pressed', 'true');
  await expect(await callout(page, 'api')).toHaveAttribute('data-docked', 'false');
  expect((await readDrawing(file)).views).toEqual(baseline.views); // Pinning/resizing has never moved or hidden a component in the file.
});
