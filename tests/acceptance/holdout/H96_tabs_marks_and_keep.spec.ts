import { test, expect } from '@playwright/test';
import { shop3, withDetail, withLinkedIn, workspaceRaw, openDrawing, saved, viewOf, outdatedOf, sorted, channelNames, type Channel } from './helpers';
import { readDocument, persistedDoc } from './helpers-selections'; // the stored file is format 4: these read its one choice

// The marks are written into the file by hand (this step has the tabs, not yet the edits that set them).
test('H96 [NAV-2, FILE-2, EDIT-1, #185] tabs show the four channels in order with their marks and counts, and Keep as it is empties a stage mark as one undoable edit', async ({ page, request }) => {
  const doc = withLinkedIn(withDetail(shop3('Tabs shop')), { outdated: ['db', 'r2'] });
  doc.channels.overview.outdated = ['gone'];
  const { file } = await workspaceRaw('tabs', doc);
  await openDrawing(page, request, file);
  const before = await readDocument(file);
  const editor = page.getByTestId('editor');
  const tab = (channel: Channel) => page.getByTestId(`channel-tab-${channel}`);

  // Four tabs in order, the current one marked, the counts of what needs an update on the tabs that need one.
  await expect(page.getByTestId('channel-tabs').locator('[data-testid^="channel-tab-"]')).toHaveText([/^Overview/, /^LinkedIn/, /^README/, /^Presentation/]);
  await expect(tab('overview')).toHaveAttribute('aria-current', 'true');
  for (const channel of ['linkedin', 'readme', 'presentation'] as const) await expect(tab(channel)).not.toHaveAttribute('aria-current', 'true');
  await expect(editor).toHaveAttribute('data-channel', 'overview'); await expect(editor).toHaveAttribute('data-view', 'overview');
  await expect(tab('overview')).toHaveAttribute('data-outdated', '1'); await expect(tab('linkedin')).toHaveAttribute('data-outdated', '2');
  await expect(page.getByTestId('channel-outdated-linkedin')).toHaveAccessibleName(/Needs update: 2 change/);
  await expect(page.getByTestId('channel-outdated-overview')).toHaveAccessibleName(/Needs update: 1 change/);
  for (const channel of ['readme', 'presentation'] as const) {
    await expect(tab(channel)).not.toHaveAttribute('data-outdated', /.*/); await expect(page.getByTestId(`channel-outdated-${channel}`)).toHaveCount(0);
  }
  // The overview's own stage says so too, and only the LinkedIn channel offers a redraw.
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/); await expect(page.getByTestId('channel-keep')).toBeVisible();
  await expect(page.getByTestId('channel-redraw')).toHaveCount(0);
  await expect(page.getByTestId('node-api')).toBeVisible();

  // The LinkedIn tab goes to the channel's first view; the overview's path and views belong to the overview alone.
  await tab('linkedin').click();
  await expect(editor).toHaveAttribute('data-channel', 'linkedin'); await expect(editor).toHaveAttribute('data-view', 'linkedin-post');
  await expect(page).toHaveURL(/channel=linkedin/);
  await expect(tab('linkedin')).toHaveAttribute('aria-current', 'true'); await expect(tab('overview')).not.toHaveAttribute('aria-current', 'true');
  for (const id of ['visitor', 'intake', 'ledger']) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await expect(page.getByTestId('node-web')).toHaveCount(0); // the overview's parts are not on this canvas
  await expect(page.getByTestId('node-ledger').getByTestId('node-label')).toHaveText('Orders ledger');
  await expect(page.getByTestId('crumbs')).toHaveCount(0); await expect(page.getByTestId('views-button')).toHaveCount(0);
  await expect(page.getByTestId('channel-outdated')).toContainText(/2 change/); await expect(page.getByTestId('channel-outdated')).toContainText(/in the facts since this was drawn/);

  // Keep as it is: the mark goes, from the stage, the tab and the file; nothing else does.
  await page.getByTestId('channel-keep').click(); await saved(page);
  await expect(page.getByTestId('channel-outdated')).toHaveCount(0); await expect(page.getByTestId('channel-outdated-linkedin')).toHaveCount(0);
  await persistedDoc(file, d => outdatedOf(d, 'linkedin').length === 0);
  const kept = await readDocument(file);
  expect(outdatedOf(kept, 'overview')).toEqual(['gone']); // another channel's mark is not touched
  await expect(tab('overview')).toHaveAttribute('data-outdated', '1');
  expect(viewOf(kept, 'linkedin')).toEqual(viewOf(before, 'linkedin')); expect(kept.facts).toEqual(before.facts);
  // One undo step brings the mark back, one redo takes it away again.
  await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('channel-outdated')).toContainText(/2 change/); await expect(tab('linkedin')).toHaveAttribute('data-outdated', '2');
  await persistedDoc(file, d => sorted(outdatedOf(d, 'linkedin')).join() === 'db,r2');
  await page.getByTestId('tool-redo').click();
  await expect(page.getByTestId('channel-outdated')).toHaveCount(0); await persistedDoc(file, d => outdatedOf(d, 'linkedin').length === 0);

  // Back on the overview, the first view again, and its own mark can be kept the same way.
  await tab('overview').click();
  await expect(editor).toHaveAttribute('data-channel', 'overview'); await expect(editor).toHaveAttribute('data-view', 'overview');
  await expect(page).not.toHaveURL(/channel=linkedin/);
  await expect(page.getByTestId('crumbs')).toBeVisible(); await expect(page.getByTestId('views-panel')).toBeVisible(); // its overview holds two views, so the panel shows
  await expect(page.getByTestId('views-button')).toHaveCount(0);
  await page.getByTestId('channel-keep').click(); await saved(page);
  await persistedDoc(file, d => outdatedOf(d, 'overview').length === 0);
  await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
  for (const channel of channelNames) await expect(page.getByTestId(`channel-outdated-${channel}`)).toHaveCount(0);

  // The marks are the file's: a reload on the LinkedIn address shows none.
  await page.goto(`${new URL(page.url()).pathname}?channel=linkedin&view=linkedin-post`);
  await expect(editor).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
  expect(outdatedOf(await readDocument(file), 'linkedin')).toEqual([]);
});
