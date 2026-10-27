import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fourChoices, workspace4, openFourChoices, panelEntries, panelStructure, panelRows, where, FOUR_PANEL, FOUR_PANEL_STRUCTURE } from './helpers-selections';
import { sendInPanel, openAiPanel, baseURL } from './helpers';

// The left edge of the first text of an entry, as the user sees it.
async function textLeft(page: import('@playwright/test').Page, view: string) {
  return await page.getByTestId(`views-entry-${view}`).evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
    while ((node = walker.nextNode())) if ((node.textContent ?? '').trim()) { const r = document.createRange(); r.selectNodeContents(node); return r.getBoundingClientRect().left; }
    return el.getBoundingClientRect().left;
  });
}

// NAV-2 (ui contract, *Choices and the views panel*, ADR 0015): a panel beside the canvas lists the whole system, each section and each flow
// (then the choices in the user's own words) with their detail views under them, marks the current view and goes to any in one click.
// `views-button`, `views-menu` and `view-item-*` are gone. Going to a view is not an edit and works while a run goes.
test('H205 [NAV-2 NAV-1 FILE-2 #185] the views panel lists the whole system, the sections, the flows and the user\'s own choices with their detail views under them, marks the current view, goes to any view in one click, and the old views button is gone', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspace4('f4-panel', fourChoices('Panel four'));
  await openFourChoices(page, request, file);
  const editor = page.getByTestId('editor'), bytes = await readFile(file, 'utf8');

  // The panel: a named navigation, the choices by kind, each entry a button with its choice, view and depth.
  const panel = page.getByTestId('views-panel');
  await expect(panel).toBeVisible(); await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(1);
  expect(await panelStructure(page)).toEqual(FOUR_PANEL_STRUCTURE);
  const entries = await panelEntries(page);
  expect(panelRows(entries)).toEqual(FOUR_PANEL);
  expect(entries.every(e => e.tag === 'button'), 'every entry is a button').toBe(true);
  expect(entries.every(e => e.testId === `views-entry-${e.view}`)).toBe(true);
  await expect(page.getByTestId('views-heading-section')).toHaveText('Sections'); await expect(page.getByTestId('views-heading-flow')).toHaveText('Flows'); await expect(page.getByTestId('views-heading-custom')).toHaveText('Your own');
  for (const [id, kind] of [['system', 'system'], ['server', 'section'], ['checkout', 'flow'], ['howto', 'custom']]) await expect(page.getByTestId(`views-choice-${id}`)).toHaveAttribute('data-kind', kind);
  // The file opens on its first choice, but the panel puts the whole system first and groups the rest by kind.
  expect(await where(page)).toEqual({ choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  // The current view is marked, and only it.
  expect(entries.filter(e => e.current).map(e => e.view)).toEqual(['checkout-overview']);
  // Detail views are indented 16 px per level (the system's: the first view, its inside, the inside's inside).
  const base = await textLeft(page, 'overview');
  expect(Math.abs((await textLeft(page, 'back-end-inside')) - base - 16)).toBeLessThanOrEqual(1.5);
  expect(Math.abs((await textLeft(page, 'orders-inside')) - base - 32)).toBeLessThanOrEqual(1.5);
  expect(Math.abs((await textLeft(page, 'appendix')) - base - 16), 'a view no link reaches is at depth 1').toBeLessThanOrEqual(1.5);
  // The old way of reaching a view is gone, here and in every channel.
  for (const id of ['views-button', 'views-menu']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.locator('[data-testid^="view-item-"]')).toHaveCount(0);

  // One click goes to any view, in the overview channel of its choice, and the address and the crumbs follow.
  await page.getByTestId('views-entry-checkout-charge').click();
  expect(await where(page)).toEqual({ choice: 'checkout', channel: 'overview', view: 'checkout-charge' });
  await expect(page).toHaveURL(/choice=checkout/); await expect(page).toHaveURL(/view=checkout-charge/);
  expect((await panelEntries(page)).filter(e => e.current).map(e => e.view)).toEqual(['checkout-charge']);
  await expect(page.getByTestId('crumb-checkout-overview')).toBeVisible(); await expect(page.getByTestId('crumbs')).toContainText('Charge');
  await expect(page.getByTestId('node-gateway')).toBeVisible();
  const fitted = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-fit').click(); expect(await page.getByTestId('zoom-level').innerText(), 'going to a view fits it').toBe(fitted);
  await page.getByTestId('views-entry-orders-inside').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });
  await expect(page.getByTestId('crumb-overview')).toBeVisible(); await expect(page.getByTestId('crumb-back-end-inside')).toBeVisible(); await expect(page.getByTestId('crumbs')).toContainText('Orders inside');
  await expect(page.getByTestId('node-pay')).toBeVisible(); await expect(page.getByTestId('node-gateway')).toHaveCount(0);
  expect((await panelEntries(page)).filter(e => e.current).map(e => e.view)).toEqual(['orders-inside']);
  await page.reload(); await expect(editor).toBeVisible();
  expect(await where(page), 'a reload shows the same view').toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });
  await page.getByTestId('views-entry-appendix').click(); expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'appendix' });
  await page.getByTestId('views-entry-howto-overview').click(); expect(await where(page)).toEqual({ choice: 'howto', channel: 'overview', view: 'howto-overview' });
  await page.getByTestId('views-entry-server-overview').click(); expect(await where(page)).toEqual({ choice: 'server', channel: 'overview', view: 'server-overview' });

  // In another channel the current choice's first entry is the marked one; an entry goes to the overview channel of its choice.
  await page.getByTestId('channel-tab-linkedin').click();
  expect(await where(page)).toEqual({ choice: 'server', channel: 'linkedin', view: 'server-linkedin' });
  expect((await panelEntries(page)).filter(e => e.current).map(e => e.view), 'in LinkedIn the choice\'s first entry').toEqual(['server-overview']);
  await expect(page.getByTestId('crumbs')).toHaveCount(0);
  await page.getByTestId('views-entry-overview').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'overview' });
  await page.getByTestId('channel-tab-linkedin').click(); expect(await where(page)).toEqual({ choice: 'system', channel: 'linkedin', view: 'system-linkedin' });
  expect((await panelEntries(page)).filter(e => e.current).map(e => e.view)).toEqual(['overview']);
  await page.getByTestId('views-entry-back-end-inside').click(); expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'back-end-inside' });

  // None of it was an edit.
  await page.waitForTimeout(700);
  await expect(page.getByTestId('save-status')).toHaveText('Saved'); await expect(page.getByTestId('tool-undo')).toBeDisabled();
  expect(await readFile(file, 'utf8'), 'moving between views writes nothing').toBe(bytes);

  // It works while a run goes: a slow instruction runs, the panel still takes the user to another choice, and the run is not disturbed.
  await openAiPanel(page);
  const run = await sendInPanel(page, 'keep it as it is [fixture:slow]');
  await expect(page.getByTestId('ai-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible();
  await page.getByTestId('views-entry-checkout-overview').click();
  expect(await where(page)).toEqual({ choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  await page.getByTestId('views-entry-orders-inside').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });
  await expect(page.getByTestId('ai-cancel')).toBeVisible();
  await page.getByTestId('ai-cancel').click();
  await expect.poll(async () => (await (await request.get(`${baseURL()}/api/runs/${run.runId}`)).json()).status, { timeout: 30_000 }).toBe('cancelled');
  expect(await readFile(file, 'utf8'), 'the cancelled run and the clicks left the file as it was').toBe(bytes);
});
