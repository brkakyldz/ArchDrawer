import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fourChoices, workspace4, openFourChoices, readRaw, persistedRaw, where, openState, plainClick, dragBy, nodeBox, type Doc4 } from './helpers-selections';
import { saved, emptyCanvasPoint, canvasClick } from './helpers';

const checkout = (d: Doc4) => d.choices.find(c => c.id === 'checkout')!.channels.overview.views![0];
const xOf = (d: Doc4, id: string) => checkout(d).nodes.find(n => n.id === id)!.x;

// NAV-1 (ui contract, *Opening a part's inside*, ADR 0015): a part with an inside (its `detail` is set), whatever its form, wears an open
// mark. With the select tool a click on it (less than 3 px between press and release, no modifier) goes to its detail view and selects
// nothing, opens no callout and is no edit; a drag moves it and goes nowhere; Shift+click selects it and opens its callout, where
// `callout-open-inside` goes in; it is a button in the tab order and Enter goes in. A part with no inside keeps selecting and opening
// its callout.
test('H203 [NAV-1 EDIT-1 #184] a click without moving goes into a part with an inside and is no edit, a drag of the same part moves it and opens nothing, Shift+click selects it, and Enter on it opens it; a part with no inside still opens its callout', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspace4('f4-open', fourChoices('Open four'));
  await openFourChoices(page, request, file);
  const editor = page.getByTestId('editor'), bytes = await readFile(file, 'utf8');
  const stay = { choice: 'checkout', channel: 'overview', view: 'checkout-overview' };

  // The parts: `charge` has an inside, `shop-zone` is a group that has one, `cart` has none.
  const charge = await openState(page, 'charge'), cart = await openState(page, 'cart');
  expect(charge).toMatchObject({ open: 'true', mark: true, tabindex: '0', role: 'button', label: 'Open Charge' });
  expect(cart.open, 'a part with no inside is not open').toBeNull(); expect(cart.mark).toBe(false);
  await expect(page.getByTestId('node-shop-zone')).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('button', { name: 'Open Charge' }).first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Open Shop' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Cart' })).toHaveCount(0);
  await expect(page.getByTestId('node-charge').getByTestId('node-inside')).toBeVisible();
  await expect(page.getByTestId('node-head-shop-zone').getByTestId('node-inside')).toBeVisible();

  // A click on the part, anywhere on it, without moving: it goes in, selects nothing, opens no callout, is not an edit.
  await plainClick(page, page.getByTestId('node-charge'));
  await expect(editor).toHaveAttribute('data-view', 'checkout-charge');
  expect(await where(page)).toEqual({ choice: 'checkout', channel: 'overview', view: 'checkout-charge' });
  await expect(page).toHaveURL(/view=checkout-charge/); await expect(page.getByTestId('node-gateway')).toBeVisible(); await expect(page.getByTestId('node-cart')).toHaveCount(0);
  await expect(page.getByTestId('crumb-checkout-overview')).toBeVisible(); await expect(page.getByTestId('crumbs')).toContainText('Charge');
  await expect(page.getByTestId('callout-charge')).toHaveCount(0);
  await expect(page.getByTestId('tool-undo')).toBeDisabled(); await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await page.getByTestId('crumb-checkout-overview').click(); expect(await where(page)).toEqual(stay);
  await expect(page.getByTestId('node-charge')).not.toHaveAttribute('data-selected', 'true'); await expect(page.getByTestId('callout-charge')).toHaveCount(0);
  // A slip of two pixels between press and release is still a click.
  const box = await nodeBox(page, 'charge'), cx = box.x + box.width / 2, cy = box.y + Math.min(box.height / 2, 24);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 2, cy + 1); await page.mouse.up();
  await expect(editor).toHaveAttribute('data-view', 'checkout-charge'); await page.getByTestId('crumb-checkout-overview').click();
  // The group's click: on its head, the same.
  await plainClick(page, page.getByTestId('node-head-shop-zone').getByTestId('node-label'));
  await expect(editor).toHaveAttribute('data-view', 'checkout-shop'); await expect(page.getByTestId('node-rules')).toBeVisible();
  await page.getByTestId('crumb-checkout-overview').click(); expect(await where(page)).toEqual(stay);
  // None of this was an edit.
  await page.waitForTimeout(700);
  await expect(page.getByTestId('save-status')).toHaveText('Saved'); await expect(page.getByTestId('tool-undo')).toBeDisabled();
  expect(await readFile(file, 'utf8'), 'going in and out writes nothing').toBe(bytes);

  // A part with no inside is selected by a click and opens its callout, as before.
  await plainClick(page, page.getByTestId('node-cart'));
  expect(await where(page)).toEqual(stay); await expect(page.getByTestId('callout-cart')).toBeVisible(); await expect(page.getByTestId('node-cart')).toHaveAttribute('data-selected', 'true');
  const empty = await emptyCanvasPoint(page); await canvasClick(page, empty.x, empty.y);
  await expect(page.getByTestId('callout-cart')).toHaveCount(0);

  // Shift+click selects the part with an inside and opens its callout, where `callout-open-inside` goes in.
  await page.getByTestId('node-charge').click({ modifiers: ['Shift'], position: { x: 20, y: 20 } });
  expect(await where(page), 'Shift+click goes nowhere').toEqual(stay);
  await expect(page.getByTestId('node-charge')).toHaveAttribute('data-selected', 'true'); await expect(page.getByTestId('callout-charge')).toBeVisible();
  await expect(page.getByTestId('callout-title')).toHaveText('Charge'); await expect(page.getByTestId('callout-open-inside')).toBeVisible();
  await page.getByTestId('callout-open-inside').click(); await expect(editor).toHaveAttribute('data-view', 'checkout-charge');
  await page.getByTestId('crumb-checkout-overview').click();

  // Enter: the part is a button, in the order of the view's parts; Tab from the first reaches the next, and Enter goes in.
  await page.getByRole('button', { name: 'Open Charge' }).first().focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('[role="button"]')?.getAttribute('aria-label') ?? null), 'the next part with an inside, in the view\'s order').toBe('Open Shop');
  await page.keyboard.press('Enter'); await expect(editor).toHaveAttribute('data-view', 'checkout-shop');
  await page.getByTestId('crumb-checkout-overview').click();
  await page.getByRole('button', { name: 'Open Charge' }).first().focus(); await page.keyboard.press('Enter');
  await expect(editor).toHaveAttribute('data-view', 'checkout-charge'); await page.getByTestId('crumb-checkout-overview').click();
  await expect(page.getByTestId('tool-undo'), 'selecting and going in are no edits').toBeDisabled();

  // A drag moves the part, and goes nowhere: the file follows once, and undo takes it back.
  const initial = await readRaw(file) as Doc4, before = xOf(initial, 'charge')!, was = await nodeBox(page, 'charge');
  await dragBy(page, page.getByTestId('node-charge'), 240, 40);
  expect(await where(page), 'a drag opens nothing').toEqual(stay);
  await saved(page); await persistedRaw(file, d => xOf(d, 'charge') !== before);
  expect((await nodeBox(page, 'charge')).x).toBeGreaterThan(was.x + 60);
  await expect(page.getByTestId('callout-charge')).toHaveCount(0); await expect(page.getByTestId('tool-undo')).toBeEnabled();
  expect((await readRaw(file) as Doc4).choices.filter(c => c.id !== 'checkout')).toEqual(initial.choices.filter(c => c.id !== 'checkout'));
  await page.getByTestId('tool-undo').click(); await saved(page); await persistedRaw(file, d => xOf(d, 'charge') === before);
  await dragBy(page, page.getByTestId('node-head-shop-zone'), 200, 0); expect(await where(page), 'a drag of the group opens nothing').toEqual(stay);

  // Deeper: the whole system's map opens a part with an inside, which opens another; the crumbs follow the links from the map.
  await page.getByTestId('views-entry-overview').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'overview' });
  await plainClick(page, page.getByTestId('node-back-end'));
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'back-end-inside' });
  await plainClick(page, page.getByTestId('node-orders'));
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });
  await expect(page.getByTestId('crumb-overview')).toBeVisible(); await expect(page.getByTestId('crumb-back-end-inside')).toBeVisible(); await expect(page.getByTestId('crumbs')).toContainText('Orders inside');
  await page.getByTestId('crumb-back-end-inside').click(); expect(await where(page)).toMatchObject({ view: 'back-end-inside' });
  await page.getByTestId('crumb-overview').click(); expect(await where(page)).toMatchObject({ view: 'overview' });
});
