import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withDetail, withLinkedIn, workspaceRaw, openDrawing, type Channel } from './helpers';

// What the address says is what the editor shows, and a reload shows the same thing. Links made before there were
// channels (`?view=` alone) still open the view; an address that names nothing real opens the overview.
test('H98 [NAV-2, NAV-1] the address names the channel and view and survives a reload, an old view link opens the channel that holds it, and the tabs live in the narrow header menu', async ({ page, request }) => {
  const { file } = await workspaceRaw('routes', withLinkedIn(withDetail(shop3('Routes shop')), { outdated: ['db'] }));
  const opened = await openDrawing(page, request, file);
  const bytes = await readFile(file, 'utf8');
  const editor = page.getByTestId('editor'), tab = (channel: Channel) => page.getByTestId(`channel-tab-${channel}`);
  const at = async (channel: string, view: string) => { await expect(editor).toHaveAttribute('data-channel', channel); await expect(editor).toHaveAttribute('data-view', view); };

  // A channel and view in the address open that drawing, and reloading keeps it.
  await page.goto(`/d/${opened.id}?channel=linkedin&view=linkedin-post`);
  await at('linkedin', 'linkedin-post'); await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(tab('linkedin')).toHaveAttribute('aria-current', 'true');
  await page.reload(); await at('linkedin', 'linkedin-post'); await expect(page.getByTestId('node-intake')).toBeVisible();
  await expect(page).toHaveURL(/channel=linkedin/);

  // Going to a tab and into a detail view updates the address; a reload shows the same view.
  await tab('overview').click(); await at('overview', 'overview');
  await expect(page).not.toHaveURL(/channel=linkedin/);
  await page.getByTestId('node-api').getByTestId('node-inside').click(); await at('overview', 'inside-api');
  await expect(page).toHaveURL(/view=inside-api/); await expect(page.getByTestId('crumbs')).toContainText('Inside API'); await expect(page.getByTestId('node-validator')).toBeVisible();
  await page.reload(); await at('overview', 'inside-api'); await expect(page.getByTestId('node-validator')).toBeVisible();
  // A tab goes to the first view of its channel, not to where that channel was left.
  await tab('linkedin').click(); await at('linkedin', 'linkedin-post');
  await tab('overview').click(); await at('overview', 'overview'); await expect(page.getByTestId('node-web')).toBeVisible();

  // Old links: `?view=` alone opens the channel that holds the view; unknown names open the overview.
  await page.goto(`/d/${opened.id}?view=inside-api`); await at('overview', 'inside-api'); await expect(page.getByTestId('node-writer')).toBeVisible();
  await page.goto(`/d/${opened.id}?view=linkedin-post`); await at('linkedin', 'linkedin-post'); await expect(tab('linkedin')).toHaveAttribute('aria-current', 'true');
  await page.goto(`/d/${opened.id}?view=no-such-view`); await at('overview', 'overview');
  await page.goto(`/d/${opened.id}?channel=no-such-channel`); await at('overview', 'overview');
  await page.goto(`/d/${opened.id}?channel=no-such-channel&view=inside-api`); await expect(editor).toHaveAttribute('data-channel', 'overview');
  await page.goto(`/d/${opened.id}`); await at('overview', 'overview');

  // Narrow: the tabs, with their marks, are in the header menu, and the path of views goes with the overview only.
  await page.goto(`/d/${opened.id}?channel=linkedin&view=linkedin-post`); await at('linkedin', 'linkedin-post');
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByTestId('header-menu-button')).toBeVisible();
  const menu = page.getByTestId('header-menu');
  async function header() { if (!await menu.isVisible()) await page.getByTestId('header-menu-button').click(); await expect(menu).toBeVisible(); return menu; }
  const inMenu = await header();
  await expect(inMenu.getByTestId('channel-tabs')).toBeVisible();
  for (const channel of ['overview', 'linkedin', 'readme', 'presentation'] as const) await expect(inMenu.getByTestId(`channel-tab-${channel}`)).toBeVisible();
  await expect(inMenu.getByTestId('channel-tab-linkedin')).toHaveAttribute('aria-current', 'true');
  await expect(inMenu.getByTestId('channel-outdated-linkedin')).toBeVisible(); await expect(inMenu.getByTestId('channel-outdated-linkedin')).toHaveAccessibleName(/Needs update: 1 change/);
  await expect(inMenu.getByTestId('crumbs')).toHaveCount(0); // not in the LinkedIn channel
  await inMenu.getByTestId('channel-tab-overview').click(); await at('overview', 'overview');
  await expect((await header()).getByTestId('crumbs')).toBeVisible();
  await expect((await header()).getByTestId('channel-tab-overview')).toHaveAttribute('aria-current', 'true');
  await (await header()).getByTestId('channel-tab-readme').click(); await expect(editor).toHaveAttribute('data-channel', 'readme');
  await expect(page.getByTestId('channel-empty')).toContainText('The README drawing is not drawn yet'); // the README channel has no drawing yet
  // Wide again: no menu button, the tabs are in the header itself.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.getByTestId('header-menu-button')).not.toBeVisible(); await expect(page.getByTestId('channel-tabs')).toBeVisible();
  await expect(tab('readme')).toHaveAttribute('aria-current', 'true');
  // Must not happen: following addresses, links and tabs being an edit of the drawing.
  await page.waitForTimeout(600); // longer than the 350 ms save delay: a hidden edit would have been written by now
  await expect(page.getByTestId('tool-undo')).toBeDisabled(); expect(await readFile(file, 'utf8')).toBe(bytes);
});
