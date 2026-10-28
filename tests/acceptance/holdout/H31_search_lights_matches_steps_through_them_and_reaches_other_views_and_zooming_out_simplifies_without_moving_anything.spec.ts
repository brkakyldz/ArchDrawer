import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { drawingRepo, doc, choice, comp, rel, part, link, view, openDrawing, box, drawn } from './helpers';

const product = useProduct();

function drawing() {
  return doc('Search shop', [choice('system', 'The whole system', 'system', {
    components: [comp('api', 'Order API', 'api'), comp('db', 'Order DB', 'data'), comp('pay', 'Payment', 'external'), comp('mail', 'Mailer', 'external'),
      comp('queue', 'Order queue', 'data'), comp('worker', 'Worker', 'worker')],
    relations: [rel('r1', 'api', 'db', { label: 'stores' }), rel('r2', 'pay', 'mail', { label: 'notifies' }), rel('r3', 'queue', 'worker')],
  }, [
    view('overview', 'Overview', [part('api', { detail: 'api-inside', place: { row: 0, col: 0 } }), part('db', { place: { row: 0, col: 1 } }),
      part('pay', { place: { row: 1, col: 0 } }), part('mail', { place: { row: 1, col: 1 } })],
    [link('api', 'db', ['r1'], null, { id: 'e1' }), link('pay', 'mail', ['r2'], null, { id: 'e2' })]),
    view('api-inside', 'Inside the API', [part('queue'), part('worker')], [link('queue', 'worker', ['r3'], null, { id: 'e3' })]),
  ])]);
}

// A user looks for the order parts: search lights them on the canvas and dims the rest without moving anything, Enter steps through them,
// a match in another view is one click away, and Escape ends it all but keeps the selection. Zooming out fades labels, never sizes.
test('H31 [NAV-3 NAV-1 NAV-2] search lights matches and dims the rest without moving anything, steps with Enter, reaches a match in another view, and zooming out fades labels without changing a size', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('search', drawing());
  await openDrawing(page, p, file);
  await page.getByTestId('zoom-fit').click();
  const before = await drawn(page.getByTestId('canvas'), 'db');
  const apiOnScreen = await box(page.getByTestId('node-api'));

  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('order');
  await expect(page.getByTestId('node-api')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('node-db')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('node-pay')).toHaveAttribute('data-dim', 'true');
  await expect(page.getByTestId('edge-e2')).toHaveAttribute('data-dim', 'true');
  await expect(page.getByTestId('edge-e1')).not.toHaveAttribute('data-dim', 'true');
  await expect(page.getByTestId('search-count')).toHaveText(/2 match/);
  expect((await drawn(page.getByTestId('canvas'), 'db')).nodes, 'nothing moves and no part changes size').toEqual(before.nodes);
  await expect(page.getByTestId('search-result')).toHaveCount(1);
  await expect(page.getByTestId('search-result')).toHaveAttribute('data-view', 'api-inside');

  // Enter steps through the matches on this view; the view stays put while the match is on screen.
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-match="current"]')).toHaveCount(1);
  await expect(page.getByTestId('search-count')).toHaveText(/1 of 2/);
  const current = await page.locator('[data-match="current"]').getAttribute('data-testid');
  await expect(page.getByTestId(current!)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-count')).toHaveText(/2 of 2/);
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('search-count')).toHaveText(/1 of 2/);
  const still = await box(page.getByTestId('node-api'));
  expect([still.x, still.y], 'a match on screen does not move the view').toEqual([apiOnScreen.x, apiOnScreen.y]);

  // A match in another view: one click goes there, with it current.
  await page.getByTestId('search-result').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'api-inside');
  await expect(page.getByTestId('node-queue')).toHaveAttribute('data-match', 'current');
  await expect(page.getByTestId('crumbs')).toContainText('Inside the API');
  // Nothing on this view, something elsewhere; nothing anywhere.
  await page.getByTestId('search-input').fill('mail');
  await expect(page.getByTestId('search-count')).toHaveText(/No match in this view/);
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('node-mail')).toHaveAttribute('data-match', 'current');
  await page.getByTestId('search-input').fill('zebra');
  await expect(page.getByTestId('search')).toContainText(/No component is called that/);

  // Escape ends the search, the lights and the dimming, and keeps the selection.
  await page.getByTestId('search-input').fill('mail');
  await page.getByTestId('search-input').press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('search')).toHaveCount(0);
  await expect(page.locator('[data-match]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="node-"][data-dim="true"]')).toHaveCount(0);
  await expect(page.getByTestId('node-mail')).toHaveAttribute('data-selected', 'true');

  // Zooming out: labels fade, then sub-lines; no size or path changes.
  const level = async () => Number((await page.getByTestId('zoom-level').innerText()).replace('%', ''));
  while (await level() >= 75) { const was = await level(); await page.getByTestId('zoom-out').click(); await expect.poll(level).toBeLessThan(was); }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'outline');
  if (await page.getByTestId('edge-label-e1').count()) {
    await expect.poll(() => page.getByTestId('edge-label-e1').evaluate(el => getComputedStyle(el).opacity === '0' || Array.from(el.children).every(c => getComputedStyle(c).opacity === '0'))).toBe(true);
  }
  while (await level() >= 50) { const was = await level(); await page.getByTestId('zoom-out').click(); await expect.poll(level).toBeLessThan(was); }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'overview');
  const far = await drawn(page.getByTestId('canvas'), 'db');
  for (const [n, b] of Object.entries(before.nodes)) for (const k of ['left', 'right', 'top', 'bottom'] as const) expect(Math.abs(far.nodes[n][k] - b[k]), `${n} ${k}`).toBeLessThanOrEqual(0.5);
});
