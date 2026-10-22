import { test, expect } from '@playwright/test';
import { box } from './helpers';
import { fourChoices, workspace4, openFourChoices, panelEntries, panelStructure, panelRows, where, FOUR_PANEL, FOUR_PANEL_STRUCTURE } from './helpers-selections';

// NAV-2 (ui contract, *Choices and the views panel*): below 900 px wide the panel is not beside the stage: `header-menu` holds it with the
// same test ids, and choosing an entry closes the menu; at 900 px and over it is beside the stage again. `views-button`, `views-menu` and
// `view-item-*` exist at no width.
test('H207 [NAV-2 #185] below 900 px the views panel is in the header menu with the same entries, choosing one goes there and closes the menu, 900 px brings the panel back beside the stage, and the old views button exists at no width', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspace4('f4-narrow', fourChoices('Narrow four'));
  await page.setViewportSize({ width: 820, height: 900 });
  await openFourChoices(page, request, file);
  const menu = page.getByTestId('header-menu'), button = page.getByTestId('header-menu-button'), panel = page.getByTestId('views-panel');
  const gone = async () => { for (const id of ['views-button', 'views-menu']) await expect(page.getByTestId(id)).toHaveCount(0); await expect(page.locator('[data-testid^="view-item-"]')).toHaveCount(0); };

  // Narrow: no panel beside the stage; the menu holds it.
  await expect(button).toBeVisible(); await expect(panel).not.toBeVisible(); await expect(menu).not.toBeVisible(); await gone();
  await button.click(); await expect(menu).toBeVisible();
  await expect(menu.getByTestId('views-panel')).toBeVisible(); await expect(page.getByTestId('views-panel')).toHaveCount(1);
  expect(await panelStructure(page)).toEqual(FOUR_PANEL_STRUCTURE); expect(panelRows(await panelEntries(page))).toEqual(FOUR_PANEL);
  expect((await panelEntries(page)).filter(e => e.current).map(e => e.view)).toEqual(['checkout-overview']);
  await expect(menu.getByTestId('channel-tabs')).toBeVisible(); await expect(menu.getByTestId('crumbs')).toBeVisible();
  await gone();

  // Choosing an entry goes to its view in one click and closes the menu.
  await page.getByTestId('views-entry-orders-inside').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });
  await expect(menu).not.toBeVisible(); await expect(page.getByTestId('node-pay')).toBeVisible();
  await button.click(); await expect(menu.getByTestId('views-entry-orders-inside')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('views-entry-server-overview').click();
  expect(await where(page)).toEqual({ choice: 'server', channel: 'overview', view: 'server-overview' }); await expect(menu).not.toBeVisible();
  // Escape closes the menu with the panel in it, and the entries are reachable from the keyboard there.
  await button.click(); await page.getByTestId('views-entry-overview').focus(); await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => (document.activeElement?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid'))).toBe('views-entry-back-end-inside');
  await page.keyboard.press('Enter'); expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'back-end-inside' }); await expect(menu).not.toBeVisible();
  await button.click(); await expect(menu).toBeVisible(); await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible();

  // 899 px is narrow, 900 px is wide: the panel sits beside the stage, outside the menu, 240 px wide, and the menu button is gone.
  await page.setViewportSize({ width: 899, height: 900 });
  await expect(button).toBeVisible(); await expect(panel).not.toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(button).not.toBeVisible(); await expect(panel).toBeVisible();
  expect(await panel.evaluate(el => !!el.closest('[data-testid="header-menu"]'))).toBe(false);
  expect(Math.abs((await box(panel)).width - 240)).toBeLessThanOrEqual(2);
  expect(panelRows(await panelEntries(page))).toEqual(FOUR_PANEL);
  await gone();
  await page.getByTestId('views-entry-howto-overview').click(); expect(await where(page)).toEqual({ choice: 'howto', channel: 'overview', view: 'howto-overview' });
  // Back to narrow: the same view is shown, the menu holds the panel again, and nothing was written on the way.
  await page.setViewportSize({ width: 700, height: 900 });
  expect(await where(page)).toEqual({ choice: 'howto', channel: 'overview', view: 'howto-overview' });
  await button.click(); await expect(menu.getByTestId('views-entry-howto-overview')).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByTestId('tool-undo')).toBeDisabled(); // no edit was made by any of it
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
});
