import { test, expect } from '@playwright/test';
import { fourChoices, workspace4, openFourChoices, panelEntries, where, readRaw, choiceOf, type Doc4 } from './helpers-selections';
import { sendInPanel, runDone, acceptPreview, openAiPanel, saved } from './helpers';

// NAV-2, NAV-3, AI-1 (ui contract, *Routes* and *Choices and the views panel*): the editor shows one choice at a time. The address names
// it (`?choice=&channel=&view=`) and an older link with only a view opens the choice and channel that hold it; the tabs, the crumbs, search
// and an instruction all belong to the current choice; the other choices' channels, marks and views are not offered there.
test('H208 [NAV-2 NAV-3 AI-1 FILE-3 #185 #182] the address, the tabs and their marks, the crumbs, search and an instruction all follow the current choice, and an older link with only a view opens the choice that holds it', async ({ page, request }) => {
  test.setTimeout(300_000);
  const doc = fourChoices('Choice four');
  doc.choices.find(c => c.id === 'server')!.channels.linkedin!.outdated = ['store'];
  const { file } = await workspace4('f4-follow', doc);
  const opened = await openFourChoices(page, request, file);
  const editor = page.getByTestId('editor');
  const at = async (query: string, expected: { choice: string; channel: string; view: string }) => {
    await page.goto(`/d/${opened.id}${query}`); await expect(editor).toBeVisible();
    expect(await where(page), query || '(no query)').toEqual(expected);
  };

  // ---- The address: the first choice's overview by default, a choice, a channel, a view, an older link, and what is unknown.
  await at('', { choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  await at('?choice=server', { choice: 'server', channel: 'overview', view: 'server-overview' });
  await at('?choice=system&channel=linkedin', { choice: 'system', channel: 'linkedin', view: 'system-linkedin' });
  await at('?choice=system&view=orders-inside', { choice: 'system', channel: 'overview', view: 'orders-inside' });
  await at('?view=orders-inside', { choice: 'system', channel: 'overview', view: 'orders-inside' });
  await at('?view=server-linkedin', { choice: 'server', channel: 'linkedin', view: 'server-linkedin' });
  await at('?channel=linkedin&view=system-linkedin', { choice: 'system', channel: 'linkedin', view: 'system-linkedin' });
  await at('?choice=nope', { choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  await at('?view=nope', { choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  // Going to a choice, a channel or a view updates the address, and a reload shows the same thing.
  await page.getByTestId('views-entry-server-overview').click(); await expect(page).toHaveURL(/choice=server/);
  await page.getByTestId('channel-tab-linkedin').click(); await expect(page).toHaveURL(/choice=server/); await expect(page).toHaveURL(/channel=linkedin/);
  await page.reload(); await expect(editor).toBeVisible();
  expect(await where(page)).toEqual({ choice: 'server', channel: 'linkedin', view: 'server-linkedin' });
  await page.getByTestId('views-entry-orders-inside').click(); await expect(page).toHaveURL(/choice=system/); await expect(page).toHaveURL(/view=orders-inside/);
  await page.reload(); await expect(editor).toBeVisible(); expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });

  // ---- The tabs are the current choice's channels: a mark belongs to the choice, and a choice without a channel shows it empty.
  await at('?choice=server&channel=linkedin', { choice: 'server', channel: 'linkedin', view: 'server-linkedin' });
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('data-outdated', '1'); await expect(page.getByTestId('channel-outdated-linkedin')).toBeVisible();
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('views-entry-overview').click(); expect(await where(page)).toMatchObject({ choice: 'system', channel: 'overview' });
  await expect(page.getByTestId('channel-tab-linkedin')).not.toHaveAttribute('data-outdated', /.+/); await expect(page.getByTestId('channel-outdated-linkedin')).toHaveCount(0);
  await expect(page.getByTestId('channel-tab-overview')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('views-entry-howto-overview').click();
  for (const c of ['overview', 'linkedin', 'readme', 'presentation']) await expect(page.getByTestId(`channel-tab-${c}`)).toBeVisible();
  await page.getByTestId('channel-tab-linkedin').click(); expect(await where(page)).toMatchObject({ choice: 'howto', channel: 'linkedin' });
  await expect(page.getByTestId('channel-empty')).toBeVisible(); await expect(page.getByTestId('node-bill')).toHaveCount(0); await expect(page.getByTestId('node-visitor')).toHaveCount(0);
  await expect(page.getByTestId('share-button')).toBeDisabled();
  await page.getByTestId('views-entry-overview').click(); await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('node-visitor')).toBeVisible(); await expect(page.getByTestId('channel-empty')).toHaveCount(0);

  // ---- The crumbs are the path inside the current choice.
  await page.getByTestId('views-entry-overview').click(); await expect(page.getByTestId('channel-tab-overview')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('crumbs')).toBeVisible(); await expect(page.locator('[data-testid^="crumb-"]')).toHaveCount(0);
  await page.getByTestId('views-entry-orders-inside').click();
  expect(await page.locator('[data-testid^="crumb-"]').evaluateAll(els => els.map(el => el.getAttribute('data-testid')))).toEqual(['crumb-overview', 'crumb-back-end-inside']);
  await page.getByTestId('crumb-back-end-inside').click(); expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'back-end-inside' });
  await page.getByTestId('views-entry-server-overview').click();
  await expect(page.locator('[data-testid^="crumb-"]')).toHaveCount(0); await expect(page.getByTestId('crumbs')).not.toContainText('Back-end');

  // ---- Search looks in the current choice only: `order` is in labels of three choices.
  const results = page.getByTestId('search-result'), count = page.getByTestId('search-count'), input = page.getByTestId('search-input');
  const listed = async () => (await results.evaluateAll(list => list.map(el => `${el.getAttribute('data-view')}:${el.getAttribute('data-node-id')}`))).sort();
  await page.getByTestId('views-entry-overview').click();
  await page.keyboard.press('/'); await expect(input).toBeFocused(); await input.fill('order');
  await expect(count).toHaveText('No match in this view');
  await expect.poll(listed).toEqual(expect.arrayContaining(['back-end-inside:api', 'back-end-inside:orders', 'orders-inside:db']));
  const system = await listed();
  const here = ['overview', 'back-end-inside', 'orders-inside', 'appendix', 'system-linkedin'];
  expect(system.every(entry => here.includes(entry.split(':')[0])), `only this choice's views are searched: ${system.join(', ')}`).toBe(true);
  await page.locator('[data-testid="search-result"][data-node-id="db"]').first().click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'orders-inside' });
  await expect(page.getByTestId('node-db')).toHaveAttribute('data-match', 'current');
  await input.press('Escape'); await expect(page.getByTestId('search')).not.toBeVisible();
  await page.getByTestId('views-entry-server-overview').click();
  await page.keyboard.press('/'); await input.fill('order');
  await expect(count).toHaveText('2 matches');
  await expect(page.getByTestId('node-api')).toHaveAttribute('data-match', 'true'); await expect(page.getByTestId('node-store')).toHaveAttribute('data-match', 'true');
  const section = await listed();
  expect(section.some(entry => /^(overview|back-end-inside|orders-inside|checkout-|howto-)/.test(entry)), `none of the other choices' views: ${section.join(', ')}`).toBe(false);
  await input.fill('cart'); await expect(count).toHaveText('No match in this view'); await expect(results).toHaveCount(0); // `Cart` is in the checkout choice only
  await input.press('Escape');

  // ---- An instruction runs on the current choice: the request names it, and only its facts change.
  const beforeRun = await readRaw(file) as Doc4;
  await openAiPanel(page);
  const run = await sendInPanel(page, 'rename Order API to Gateway');
  expect(run.body).toMatchObject({ choice: 'server', channel: 'overview', view: 'server-overview', scope: { kind: 'view' } });
  await runDone(page, run.runId);
  await acceptPreview(page); await saved(page);
  const stored = await readRaw(file) as Doc4;
  expect(choiceOf(stored, 'server').facts.components.find(f => f.id === 'api')!.label).toBe('Gateway');
  expect(choiceOf(stored, 'system').facts.components.find(f => f.id === 'api')!.label, 'the same fact id in another choice').toBe('Order API');
  for (const other of ['checkout', 'howto', 'system']) expect(choiceOf(stored, other), `${other} is as it was`).toEqual(choiceOf(beforeRun, other));
  expect((await panelEntries(page)).length).toBe(9);
});
