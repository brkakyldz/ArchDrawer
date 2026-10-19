import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, postViewOf, box } from './helpers';

test('H39 [SHR-1, SHR-3, SHR-4, SHR-8, SHR-10] apply only useful readability fixes beside the download and keep keyboard focus inside sharing', async ({ page, request }) => {
  const doc = drawing('Wide shop'), view = doc.views[0];
  view.nodes = Array.from({ length: 18 }, (_, i) => component(`wide-${i}`, { label: `Order station ${i + 1}`, form: 'panel', sub: 'Handle an order', items: ['Check order', 'Keep record'], x: i * 900, y: 160 }));
  view.nodes.push(component('small-group', { label: 'One part', form: 'group' }), component('small-child', { label: 'Review order', parent: 'small-group', form: 'compact', x: 0, y: 560 }));
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
  await expect(actions.getByTestId('readability')).toHaveAttribute('data-level', 'warn');
  await expect(actions.getByTestId('readability')).toContainText('Too small to read'); await expect(actions.getByTestId('readability')).toContainText('Hide what each part holds');
  await expect(actions.getByTestId('download-png')).toBeVisible(); await expect(actions.getByTestId('download-svg')).toBeVisible();
  const meter = await box(actions.getByTestId('readability')), button = await box(actions.getByTestId('download-png'));
  expect(meter.x + meter.width).toBeLessThanOrEqual(button.x + 1); expect(meter.y).toBeLessThan(button.y + button.height); expect(meter.y + meter.height).toBeGreaterThan(button.y);
  // The layout report sits beside the meter, before the fixes and the downloads, and agrees about the level.
  const report = actions.getByTestId('layout-report'); await expect(report).toBeVisible();
  const reportBox = await box(report);
  expect(reportBox.x + reportBox.width).toBeLessThanOrEqual(button.x + 1);
  expect(reportBox.y).toBeLessThan(meter.y + meter.height); expect(reportBox.y + reportBox.height).toBeGreaterThan(meter.y);
  await expect(report).toHaveAttribute('data-level', 'warn'); await expect(report).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('fix-simplify')).toHaveText('Simplify'); await page.getByTestId('fix-simplify').click();
  await expect(page.getByTestId('preset-simple')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('readability')).toHaveAttribute('data-level', 'warn');
  await expect(page.getByTestId('readability')).not.toContainText('Hide what each part holds'); await expect(page.getByTestId('readability')).toContainText('Share one part on its own');
  await expect(page.getByTestId('fix-simplify')).not.toBeVisible(); await expect(page.getByTestId('fix-part')).toHaveText('Share one part');
  await page.getByTestId('fix-part').click(); await expect(page.getByTestId('share-part')).toHaveValue('group:small-group'); await expect(page.getByTestId('share-part')).toBeFocused();
  await expect(page.getByTestId('readability')).toHaveAttribute('data-level', 'good');
  for (const suggestion of ['Hide what each part holds', 'Use the LinkedIn version', 'Share one part on its own', 'Pick a larger format']) await expect(page.getByTestId('readability')).not.toContainText(suggestion);
  await expect(page.getByTestId('fix-part')).not.toBeVisible();
  await page.getByTestId('share-part').selectOption(''); await page.getByTestId('share-advanced-toggle').click(); await page.getByTestId('format-linkedin').click(); await page.getByTestId('preset-simple').click();
  // The wide post is 1620 × 1080 and still a post: the LinkedIn flow belongs to both post formats.
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080'); await expect(page.getByTestId('linkedin-flow')).toBeVisible();
  await expect(page.getByTestId('readability')).toHaveAttribute('data-level', 'warn'); await expect(page.getByTestId('readability')).toContainText('Use the LinkedIn version');
  await expect(page.getByTestId('fix-simplify')).toHaveText('Use the LinkedIn version'); await page.getByTestId('fix-simplify').click();
  // The fix chose `format-feed`: the portrait LinkedIn size, not the wide post it was showing.
  // (`format-feed` was already pressed for the wide post, so its state proves nothing here.)
  await expect(page.getByTestId('share-dialog')).toBeVisible();
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  await persisted(file, d => d.views.some(v => v.postOf === 'overview'), 60_000);
  const version = postViewOf(await readDrawing(file), 'overview');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', version.id);
  await expect(page.getByTestId('linkedin-flow')).toBeVisible(); await expect(page.getByTestId('readability')).not.toContainText('Use the LinkedIn version');
  await expect(page.getByTestId('share-dialog').getByTestId('layout-report')).toHaveAttribute('data-view', version.id);
  expect((await readDrawing(file)).views[0]).toEqual(source); // The source view is never touched by a fix.
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByTestId('share-button')).toBeFocused();
});
