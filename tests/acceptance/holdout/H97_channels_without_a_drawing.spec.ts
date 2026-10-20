import { test, expect, type Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { shop3, workspaceRaw, openDrawing, type Channel } from './helpers';

const toolsOf = ['tool-component', 'tool-connect', 'tool-text', 'ai-button', 'share-button'] as const;
async function expectDisabled(page: Page) {
  for (const id of toolsOf) await expect(page.getByTestId(id), id).toBeDisabled();
  await expect(page.getByTestId('ask-input')).toBeDisabled();
}
async function expectEnabled(page: Page) {
  for (const id of toolsOf) await expect(page.getByTestId(id), id).toBeEnabled();
  await expect(page.getByTestId('ask-input')).toBeEnabled();
}

// README and presentation hold no drawing in this version, and a LinkedIn channel can be empty: each shows its own
// stage instead of the canvas, with the editing tools and Share off, and moving between tabs writes nothing.
test('H97 [NAV-2, FILE-1] a channel with no drawing shows its stage with the tools and Share disabled, and switching tabs edits nothing', async ({ page, request }) => {
  const { file } = await workspaceRaw('empty-channels', shop3('Empty tabs shop'));
  const opened = await openDrawing(page, request, file);
  const bytes = await readFile(file, 'utf8'), modified = (await stat(file)).mtimeMs;
  const editor = page.getByTestId('editor'), tab = (channel: Channel) => page.getByTestId(`channel-tab-${channel}`), empty = page.getByTestId('channel-empty');
  await expectEnabled(page); await expect(empty).toHaveCount(0); await expect(page.getByTestId('canvas')).toBeVisible();

  // README and presentation: they come in 0.3.
  for (const channel of ['readme', 'presentation'] as const) {
    await tab(channel).click();
    await expect(editor).toHaveAttribute('data-channel', channel); await expect(tab(channel)).toHaveAttribute('aria-current', 'true');
    await expect(empty).toBeVisible(); await expect(empty).toContainText('This channel comes in 0.3');
    await expect(page.getByTestId('canvas')).toHaveCount(0); // the stage replaces the canvas
    await expectDisabled(page);
    await expect(page.getByTestId('channel-draw')).toHaveCount(0); await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
    await expect(page.getByTestId('repo-name')).toHaveText('Empty tabs shop'); // the rest of the frame stays
    await expect(page.getByTestId('crumbs')).toHaveCount(0); await expect(page).toHaveURL(new RegExp(`channel=${channel}`));
  }

  // LinkedIn with nothing drawn yet says so, in its own words.
  await tab('linkedin').click();
  await expect(editor).toHaveAttribute('data-channel', 'linkedin');
  await expect(empty).toContainText('The LinkedIn post is not drawn yet'); await expect(empty).not.toContainText('comes in 0.3');
  await expect(page.getByTestId('canvas')).toHaveCount(0); await expectDisabled(page);

  // The overview is back as it was, and the tools with it.
  await tab('overview').click();
  await expect(editor).toHaveAttribute('data-channel', 'overview'); await expect(empty).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toBeVisible(); await expect(page.getByTestId('node-api')).toBeVisible(); await expectEnabled(page);

  // An address names a channel with no drawing, and a reload shows the same stage.
  await page.goto(`/d/${opened.id}?channel=readme`);
  await expect(editor).toHaveAttribute('data-channel', 'readme'); await expect(empty).toContainText('This channel comes in 0.3');
  await page.reload(); await expect(editor).toHaveAttribute('data-channel', 'readme'); await expect(empty).toContainText('This channel comes in 0.3');
  await page.goto(`/d/${opened.id}?channel=linkedin`);
  await expect(editor).toHaveAttribute('data-channel', 'linkedin'); await expect(empty).toContainText('The LinkedIn post is not drawn yet');

  // Must not happen: any of this being an edit. Nothing to undo, nothing written, the file untouched.
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  await expect(page.getByTestId('save-status')).toHaveText('Saved'); await expect(page.getByTestId('tool-undo')).toBeDisabled();
  expect(await readFile(file, 'utf8')).toBe(bytes); expect((await stat(file)).mtimeMs).toBe(modified);
});
