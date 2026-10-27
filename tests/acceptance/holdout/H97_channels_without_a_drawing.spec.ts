import { test, expect, type Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { shop3, workspaceRaw, openDrawing, openAiPanel, aiTurns, SUGGESTIONS, type Channel } from './helpers';

// From 0.4 the ask box is gone and the AI panel (`ai-button`) is the one place to type. On a stage with no drawing `ai-button` still
// opens the panel, but `ai-send` (even with text typed), the channel's suggestions and `ai-look-again` are disabled.
const toolsOf = ['tool-component', 'tool-connect', 'tool-text', 'share-button'] as const;
async function expectDisabled(page: Page, channel: Channel) {
  for (const id of toolsOf) await expect(page.getByTestId(id), id).toBeDisabled();
  await expect(page.getByTestId('ask-input')).toHaveCount(0);
  await expect(page.getByTestId('ai-button')).toBeEnabled(); await openAiPanel(page);
  await page.getByTestId('ai-input').fill('add Cache component');
  await expect(page.getByTestId('ai-send'), 'ai-send on a channel with no view').toBeDisabled();
  await expect(page.getByTestId('ai-look-again'), 'ai-look-again on a channel with no view').toBeDisabled();
  for (const [id] of SUGGESTIONS[channel]) await expect(page.getByTestId(`ai-suggest-${id}`), `suggestion ${id}`).toBeDisabled();
  await expect(aiTurns(page), 'nothing was sent').toHaveCount(0); await page.getByTestId('ai-input').fill('');
}
async function expectEnabled(page: Page) {
  for (const id of toolsOf) await expect(page.getByTestId(id), id).toBeEnabled();
  await expect(page.getByTestId('ai-button')).toBeEnabled(); await expect(page.getByTestId('ask-input')).toHaveCount(0);
  await openAiPanel(page); await page.getByTestId('ai-input').fill('add Cache component');
  await expect(page.getByTestId('ai-send')).toBeEnabled();
  for (const [id] of SUGGESTIONS.overview) await expect(page.getByTestId(`ai-suggest-${id}`), `suggestion ${id}`).toBeEnabled();
  await page.getByTestId('ai-input').fill('');
}

// A channel can hold no drawing yet (README, presentation and LinkedIn are all drawn on demand): each shows its own stage
// instead of the canvas, with the editing tools and Share off, and moving between tabs writes nothing. From 0.3 the README
// stage says the README is not drawn yet and offers to draw it. The presentation's own stage text and buttons arrive with the
// steps panel, so here it is held to what is true before and after that: a stage, no canvas, tools off.
test('H97 [NAV-2, FILE-1, STORY-1, AI-2, AI-4, LAYOUT-4] a channel with no drawing shows its stage with the tools, Share, sending, the suggestions and the second look disabled (the AI panel still opens), and switching tabs edits nothing', async ({ page, request }) => {
  const { file } = await workspaceRaw('empty-channels', shop3('Empty tabs shop'));
  const opened = await openDrawing(page, request, file);
  const bytes = await readFile(file, 'utf8'), modified = (await stat(file)).mtimeMs;
  const editor = page.getByTestId('editor'), tab = (channel: Channel) => page.getByTestId(`channel-tab-${channel}`), empty = page.getByTestId('channel-empty');
  await expectEnabled(page); await expect(empty).toHaveCount(0); await expect(page.getByTestId('canvas')).toBeVisible();

  // README and presentation: nothing drawn yet.
  for (const channel of ['readme', 'presentation'] as const) {
    await tab(channel).click();
    await expect(editor).toHaveAttribute('data-channel', channel); await expect(tab(channel)).toHaveAttribute('aria-current', 'true');
    await expect(empty).toBeVisible();
    if (channel === 'readme') {
      await expect(empty).toContainText('The README drawing is not drawn yet'); await expect(page.getByTestId('channel-draw')).toContainText('Draw it');
    }
    await expect(page.getByTestId('canvas')).toHaveCount(0); // the stage replaces the canvas
    await expectDisabled(page, channel);
    await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
    await expect(page.getByTestId('repo-name')).toHaveText('Empty tabs shop'); // the rest of the frame stays
    await expect(page.getByTestId('crumbs')).toHaveCount(0); await expect(page).toHaveURL(new RegExp(`channel=${channel}`));
  }

  // LinkedIn with nothing drawn yet says so, in its own words.
  await tab('linkedin').click();
  await expect(editor).toHaveAttribute('data-channel', 'linkedin');
  await expect(empty).toContainText('The LinkedIn post is not drawn yet'); await expect(empty).not.toContainText('README drawing');
  await expect(page.getByTestId('canvas')).toHaveCount(0); await expectDisabled(page, 'linkedin');

  // The overview is back as it was, and the tools with it.
  await tab('overview').click();
  await expect(editor).toHaveAttribute('data-channel', 'overview'); await expect(empty).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toBeVisible(); await expect(page.getByTestId('node-api')).toBeVisible(); await expectEnabled(page);

  // An address names a channel with no drawing, and a reload shows the same stage.
  await page.goto(`/d/${opened.id}?channel=readme`);
  await expect(editor).toHaveAttribute('data-channel', 'readme'); await expect(empty).toContainText('The README drawing is not drawn yet');
  await page.reload(); await expect(editor).toHaveAttribute('data-channel', 'readme'); await expect(empty).toContainText('The README drawing is not drawn yet');
  await page.goto(`/d/${opened.id}?channel=presentation`);
  await expect(editor).toHaveAttribute('data-channel', 'presentation'); await expect(empty).toBeVisible(); await expect(page.getByTestId('canvas')).toHaveCount(0);
  await page.goto(`/d/${opened.id}?channel=linkedin`);
  await expect(editor).toHaveAttribute('data-channel', 'linkedin'); await expect(empty).toContainText('The LinkedIn post is not drawn yet');

  // Must not happen: any of this being an edit. Nothing to undo, nothing written, the file untouched.
  await page.waitForTimeout(600); // longer than the 350 ms save delay: a hidden edit would have been written by now
  await expect(page.getByTestId('save-status')).toHaveText('Saved'); await expect(page.getByTestId('tool-undo')).toBeDisabled();
  expect(await readFile(file, 'utf8')).toBe(bytes); expect((await stat(file)).mtimeMs).toBe(modified);
});
