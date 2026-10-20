import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing } from './helpers';

test('H39 [SHARE-2, LAYOUT-3] keep keyboard focus inside sharing and call a drawing too wide to read too small, in the report and the meter alike', async ({ page, request }) => {
  const doc = drawing('Wide shop'), view = doc.views[0];
  view.nodes = Array.from({ length: 18 }, (_, i) => component(`wide-${i}`, { label: `Order station ${i + 1}`, form: 'panel', sub: 'Handle an order', items: ['Check order', 'Keep record'], x: i * 900, y: 160 }));
  view.edges = Array.from({ length: 17 }, (_, i) => ({ id: `wide-edge-${i}`, from: `wide-${i}`, to: `wide-${i + 1}`, label: 'Next station', style: 'call', both: false, step: i + 1 }));
  const { file } = await workspace('readability', doc); await openDrawing(page, request, file); const source = (await readDrawing(file)).views[0];
  await page.getByTestId('share-button').click(); const dialog = page.getByTestId('share-dialog'), actions = page.getByTestId('share-actions');
  await expect(dialog).toHaveAttribute('role', 'dialog'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  // Exercise both wrapping boundaries using actual, enabled, visible dialog controls.
  const tabbable = 'button,input,select,textarea,a[href],[tabindex]';
  await dialog.locator(tabbable).evaluateAll(els => {
    const controls = els.filter(el => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length);
    (controls.at(-1) as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');
  expect(await dialog.locator(tabbable).evaluateAll(els => {
    const controls = els.filter(el => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length);
    return document.activeElement === controls[0];
  })).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.locator(tabbable).evaluateAll(els => {
    const controls = els.filter(el => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length);
    return document.activeElement === controls.at(-1);
  })).toBe(true);
  for (let i = 0; i < 32; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
  // The 18 wide stations cannot be read at the size README is shown: the meter and the report say so, and agree.
  await expect(actions.getByTestId('readability')).toHaveAttribute('data-level', 'warn');
  await expect(actions.getByTestId('download-png')).toBeVisible(); await expect(actions.getByTestId('download-svg')).toBeVisible();
  const report = actions.getByTestId('layout-report'); await expect(report).toBeVisible();
  await expect(report).toHaveAttribute('data-level', 'warn'); await expect(report).toHaveAttribute('data-view', 'overview');
  await expect(actions.getByTestId('readability')).toHaveText(/\S/);
  // Reading the report writes nothing into the drawing.
  expect((await readDrawing(file)).views[0]).toEqual(source);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByTestId('share-button')).toBeFocused();
});
