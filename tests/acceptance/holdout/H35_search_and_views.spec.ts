import { test, expect, type Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { drawing, component, workspace, openDrawing, box } from './helpers';
import { readDrawing } from './helpers-selections'; // the stored file is format 4: this reads its one choice

// Overview parts, left to right: Orders DB, Order API (opens "Inside API"), Order worker, Billing gateway; Web app below the API.
// Stored positions put the two nearest "order" parts side by side and the third far to the left, so a zoomed-in view shows only some.
const ids = ['orders-db', 'api', 'worker', 'web', 'gateway'] as const;
type Id = typeof ids[number];
type Rect = { x: number; y: number; width: number; height: number };
const near = (a: number, b: number, by = 0.6) => Math.abs(a - b) <= by;

async function boxes(page: Page) {
  const result = {} as Record<Id, Rect>;
  for (const id of ids) result[id] = await box(page.getByTestId(`node-${id}`));
  return result;
}
// A short wait until the view has stopped moving (a step may animate).
async function steady(page: Page) {
  let last = JSON.stringify(await boxes(page));
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(120);
    const now = JSON.stringify(await boxes(page));
    if (now === last) return JSON.parse(now) as Record<Id, Rect>;
    last = now;
  }
  throw new Error('The view never stopped moving');
}
async function marks(page: Page) {
  return await page.evaluate(list => Object.fromEntries(list.map(id => {
    const el = document.querySelector(`[data-testid="node-${id}"]`);
    const match = el?.getAttribute('data-match') ?? '';
    return [id, { lit: match === 'true' || match === 'current', current: match === 'current', dim: el?.getAttribute('data-dim') === 'true', selected: el?.getAttribute('data-selected') === 'true' }];
  })), [...ids]) as Record<Id, { lit: boolean; current: boolean; dim: boolean; selected: boolean }>;
}
const look = async (page: Page) => Object.fromEntries(Object.entries(await marks(page)).map(([id, m]) => [id, `${m.lit ? 'lit' : 'plain'}/${m.dim ? 'dim' : 'clear'}`]));
const edgeDim = async (page: Page, id: string) => (await page.getByTestId(`edge-${id}`).getAttribute('data-dim')) === 'true';
async function wholly(page: Page, rect: Rect) {
  const canvas = await box(page.getByTestId('canvas')), bar = page.getByTestId('search');
  if (rect.x < canvas.x - 0.5 || rect.y < canvas.y - 0.5 || rect.x + rect.width > canvas.x + canvas.width + 0.5 || rect.y + rect.height > canvas.y + canvas.height + 0.5) return false;
  if (await bar.isVisible()) { const b = await box(bar); if (rect.x < b.x + b.width && rect.x + rect.width > b.x && rect.y < b.y + b.height && rect.y + rect.height > b.y) return false; }
  return true;
}
async function zoomIn(page: Page) {
  for (let i = 0; i < 16; i++) {
    if (parseInt(await page.getByTestId('zoom-level').innerText(), 10) >= 100) return;
    await page.getByTestId('zoom-in').click();
  }
  throw new Error('Zoom never reached 100%');
}
function sameSizes(now: Record<Id, Rect>, before: Record<Id, Rect>) {
  for (const id of ids) { expect(near(now[id].width, before[id].width), `${id} width`).toBe(true); expect(near(now[id].height, before[id].height), `${id} height`).toBe(true); }
}
function sameBoxes(now: Record<Id, Rect>, before: Record<Id, Rect>) {
  sameSizes(now, before);
  for (const id of ids) { expect(near(now[id].x, before[id].x), `${id} x`).toBe(true); expect(near(now[id].y, before[id].y), `${id} y`).toBe(true); }
}

test('H35 [NAV-3, FILE-1] search: matches lit and the rest dimmed while typing, stepping with Enter, other views listed, Escape, and the drawing file never edited', async ({ page, request }) => {
  const doc = drawing('Views shop'), view = doc.views[0];
  view.nodes = [
    component('orders-db', { label: 'Orders DB', kind: 'data', sub: 'Postgres', x: -2400, y: 0 }),
    component('api', { label: 'Order API', kind: 'api', form: 'panel', items: ['Validate order', 'Create order'], detail: 'inside-api', x: 0, y: 0 }),
    component('worker', { label: 'Order worker', kind: 'worker', x: 400, y: 0 }),
    component('web', { label: 'Web app', kind: 'client', sub: 'React', x: 0, y: 320 }),
    component('gateway', { label: 'Billing gateway', kind: 'external', x: 2800, y: 0 }),
  ];
  view.edges = [
    { id: 'e1', from: 'web', to: 'api', label: 'POST /orders', style: 'call', both: true, step: 1 },
    { id: 'e2', from: 'api', to: 'worker', label: '', style: 'async', both: false, step: 2 },
    { id: 'e3', from: 'worker', to: 'orders-db', label: '', style: 'call', both: false, step: 3 },
    { id: 'e4', from: 'gateway', to: 'worker', label: '', style: 'dep', both: false, step: null },
  ];
  doc.views.push({ id: 'inside-api', title: 'Inside API', caption: { title: 'Checking an order', lede: '' }, edges: [{ id: 'i1', from: 'audit-worker', to: 'order-check', label: '', style: 'call', both: false, step: null }], texts: [],
    nodes: [component('audit-worker', { label: 'Audit worker', kind: 'worker' }), component('order-check', { label: 'Order check', kind: 'service' })] });
  const { file } = await workspace('views', doc); await openDrawing(page, request, file);
  const baseline = await readDrawing(file), baselineText = await readFile(file, 'utf8'), baselineTime = (await stat(file)).mtimeMs;
  const editor = page.getByTestId('editor'), search = page.getByTestId('search'), input = page.getByTestId('search-input'), count = page.getByTestId('search-count');
  const results = page.getByTestId('search-result'), zoom = page.getByTestId('zoom-level');
  // Reaching the detail view from the views panel, the part that holds it, the breadcrumb and a link is H205's, H203's and H98's
  // (the first entry's text of a converted file, H88's); this scenario is search.
  await expect(editor).toHaveAttribute('data-view', 'overview');

  await zoomIn(page);
  const before = await steady(page), zoomBefore = await zoom.innerText();
  await test.step('the zoomed view shows the two nearest order parts and not the far ones (the set-up the stepping checks rely on)', async () => {
    expect(await wholly(page, before.api)).toBe(true); expect(await wholly(page, before.worker)).toBe(true);
    expect(await wholly(page, before['orders-db'])).toBe(false); expect(await wholly(page, before.gateway)).toBe(false);
  });

  await test.step('the slash key opens search with the input focused and lights nothing yet', async () => {
    await expect(search).not.toBeVisible();
    await page.keyboard.press('/');
    await expect(search).toBeVisible(); await expect(input).toBeFocused(); await expect(input).toHaveValue('');
    expect(Object.values(await marks(page)).some(m => m.lit || m.dim)).toBe(false);
  });

  await test.step('typing lights the matching parts, dims the rest and counts, without moving or resizing anything', async () => {
    await input.pressSequentially('w');
    await expect.poll(() => look(page)).toEqual({ web: 'lit/clear', worker: 'lit/clear', gateway: 'lit/clear', api: 'plain/dim', 'orders-db': 'plain/dim' });
    await expect(count).toHaveText(/^3 matches$/); sameBoxes(await steady(page), before);
    await input.pressSequentially('e');
    await expect.poll(() => look(page)).toEqual({ web: 'lit/clear', worker: 'plain/dim', gateway: 'plain/dim', api: 'plain/dim', 'orders-db': 'plain/dim' });
    await expect(count).toHaveText(/^1 match(es)?$/);
    expect(await edgeDim(page, 'e1')).toBe(true); // A connection with only one match at its ends is dimmed.
    await input.fill('');
    await expect.poll(async () => Object.values(await marks(page)).some(m => m.lit || m.dim)).toBe(false);
    await input.pressSequentially('ORDER');
    await expect.poll(() => look(page)).toEqual({ 'orders-db': 'lit/clear', api: 'lit/clear', worker: 'lit/clear', web: 'plain/dim', gateway: 'plain/dim' });
    await expect(count).toHaveText(/^3 matches$/);
    expect(await edgeDim(page, 'e1')).toBe(true); expect(await edgeDim(page, 'e4')).toBe(true);
    expect(await edgeDim(page, 'e2')).toBe(false); expect(await edgeDim(page, 'e3')).toBe(false); // Between two matches stays lit.
    sameBoxes(await steady(page), before); expect(await zoom.innerText()).toBe(zoomBefore);
    expect(Object.values(await marks(page)).some(m => m.current)).toBe(false); // Nothing is the current match before stepping.
  });

  await test.step('Enter and Shift+Enter step through the matches with wrap; the view moves only when the match is off screen', async () => {
    const order: Record<number, Id> = {}; let index = 0, stayed = 0, moved = 0;
    const lit = new Set<string>(['orders-db', 'api', 'worker']);
    const step = async (how: 'Enter' | 'Shift+Enter' | 'next' | 'prev') => {
      const was = await steady(page);
      const forward = how === 'Enter' || how === 'next';
      index = ((index - 1 + (forward ? 1 : -1) + 3) % 3) + 1;
      if (how === 'next') await page.getByTestId('search-next').click(); else if (how === 'prev') await page.getByTestId('search-prev').click(); else await input.press(how);
      await expect(count).toHaveText(`${index} of 3`);
      const now = await steady(page), state = await marks(page);
      const currents = ids.filter(id => state[id].current), selected = ids.filter(id => state[id].selected);
      expect(currents).toHaveLength(1); expect(selected).toEqual(currents); // The current match is the only selected part.
      const current = currents[0]; expect(lit.has(current)).toBe(true);
      if (order[index]) expect(current).toBe(order[index]); else order[index] = current;
      expect(ids.filter(id => state[id].lit && !state[id].current).sort()).toEqual([...lit].filter(id => id !== current).sort());
      expect(ids.filter(id => state[id].dim && state[id].lit)).toEqual([]);
      sameSizes(now, was); expect(await zoom.innerText()).toBe(zoomBefore); // Same zoom, same sizes.
      expect(await wholly(page, now[current])).toBe(true);
      const shifted = !near(now.web.x, was.web.x, 1.5) || !near(now.web.y, was.web.y, 1.5);
      if (await wholly(page, was[current])) { expect(shifted, `${current} was already on screen, so the view stays`).toBe(false); stayed++; }
      else { expect(shifted, `${current} was off screen, so the view moves`).toBe(true); moved++; }
    };
    for (const how of ['Enter', 'Enter', 'Enter', 'Enter', 'Shift+Enter', 'Shift+Enter', 'next', 'prev', 'Enter', 'Enter', 'Shift+Enter'] as const) await step(how);
    expect(new Set(Object.values(order))).toEqual(lit); // Every match is reached, and wrapping returned to the first.
    expect(stayed, 'some step landed on a part already on screen').toBeGreaterThan(0);
    expect(moved, 'some step landed on a part that was off screen').toBeGreaterThan(0);
  });

  await test.step('Escape closes search, ends the highlight and dimming and keeps the selection', async () => {
    const state = await marks(page), keep = ids.filter(id => state[id].selected), was = await steady(page);
    expect(keep).toHaveLength(1);
    await input.press('Escape');
    await expect(search).not.toBeVisible();
    await expect.poll(async () => Object.values(await marks(page)).some(m => m.lit || m.dim)).toBe(false);
    expect(await edgeDim(page, 'e1')).toBe(false);
    const after = await marks(page); expect(ids.filter(id => after[id].selected)).toEqual(keep);
    sameBoxes(await steady(page), was);
  });

  await test.step('the search button reopens search; a match in another view is listed and opened with that match current and selected', async () => {
    await page.getByTestId('search-button').click();
    await expect(search).toBeVisible(); await expect(input).toBeFocused();
    await input.fill('order');
    await expect(count).toHaveText(/^3 matches$/);
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-view', 'inside-api'); await expect(results.first()).toHaveAttribute('data-node-id', 'order-check');
    await expect(results.first()).toContainText('Order check'); await expect(results.first()).toContainText('Inside API');
    await expect(search).toContainText('In other views');
    await results.first().click();
    await expect(editor).toHaveAttribute('data-view', 'inside-api'); await expect(page).toHaveURL(/view=inside-api/);
    const target = page.getByTestId('node-order-check');
    await expect(target).toHaveAttribute('data-match', 'current'); await expect(target).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('node-audit-worker')).toHaveAttribute('data-dim', 'true');
    await expect(page.getByTestId('node-audit-worker')).not.toHaveAttribute('data-selected', 'true');
    await expect(search).toBeVisible(); // Search stays open until Escape.
    expect(await wholly(page, await box(target))).toBe(true);
  });

  await test.step('from the other view the first view is listed; a click returns with that part current and on screen', async () => {
    await input.fill('order');
    await expect(count).toHaveText(/^1 match(es)?$/);
    await expect(results).toHaveCount(3);
    expect((await results.evaluateAll(list => list.map(el => `${el.getAttribute('data-view')}:${el.getAttribute('data-node-id')}`))).sort()).toEqual(['overview:api', 'overview:orders-db', 'overview:worker']);
    await page.locator('[data-testid="search-result"][data-node-id="worker"]').click();
    await expect(editor).toHaveAttribute('data-view', 'overview');
    const worker = page.getByTestId('node-worker');
    await expect(worker).toHaveAttribute('data-match', 'current'); await expect(worker).toHaveAttribute('data-selected', 'true');
    expect(await wholly(page, (await steady(page)).worker)).toBe(true);
  });

  await test.step('with no match here, the arrow keys and Enter open the listed one; a text nothing has says so', async () => {
    await input.fill('audit');
    await expect(count).toHaveText('No match in this view');
    await expect(results).toHaveCount(1); await expect(results.first()).toHaveAttribute('data-node-id', 'audit-worker');
    await input.focus(); await input.press('ArrowDown'); await input.press('Enter');
    await expect(editor).toHaveAttribute('data-view', 'inside-api');
    await expect(page.getByTestId('node-audit-worker')).toHaveAttribute('data-match', 'current'); await expect(page.getByTestId('node-audit-worker')).toHaveAttribute('data-selected', 'true');
    await input.fill('zzzz');
    await expect(count).toHaveText('No match in this view'); await expect(results).toHaveCount(0);
    await expect(search.getByText('No component is called that')).toBeVisible();
    await input.press('Enter'); await expect(editor).toHaveAttribute('data-view', 'inside-api'); // Nothing to open.
    await input.press('Escape'); await expect(search).not.toBeVisible();
    await expect(page.getByTestId('node-audit-worker')).not.toHaveAttribute('data-dim', 'true');
    await expect(page.getByTestId('node-audit-worker')).toHaveAttribute('data-selected', 'true');
  });

  await test.step('searching and moving between views never edited the drawing file', async () => {
    await page.waitForTimeout(600); // Longer than the 350 ms save delay: a hidden edit would have been written by now.
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    await expect(page.getByTestId('tool-undo')).toBeDisabled(); // No edit to undo.
    expect(await readFile(file, 'utf8')).toBe(baselineText);
    expect((await stat(file)).mtimeMs).toBe(baselineTime);
    expect((await readDrawing(file)).views).toEqual(baseline.views);
  });
});
