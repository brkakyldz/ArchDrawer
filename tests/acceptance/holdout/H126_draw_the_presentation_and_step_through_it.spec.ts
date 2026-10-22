import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { agent3, workspaceRaw, openDrawing, readDocument, persistedDoc, viewOf, outdatedOf, channelNames, emptyCanvasPoint, canvasClick, stepIds, litParts, nodeSizes,
  previewSVG, svgInfo } from './helpers';

// STORY-4: the presentation is one drawing and ordered steps. Drawn from the facts by the fixture engine, its steps are the
// story's: one per part, a text and a speaker note each, and a step that names a part that is not there is dropped with one
// warning. Choosing a step lights its parts and dims the rest without resizing anything, and never edits the drawing.
test('H126 [STORY-4, STORY-1, FILE-2, SHARE-2, NAV-2, AI-3] Draw it on the Presentation tab keeps the three steps the fixture story names and drops the one for a missing part, and choosing, stepping and leaving a step light and dim parts without resizing or editing anything', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('presentation-draw', agent3('Present agent'));
  const posts: any[] = [];
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') { try { posts.push(JSON.parse(req.postData() ?? 'null')); } catch { /* not json */ } } });
  await openDrawing(page, request, file);
  const before = await readDocument(file);
  const editor = page.getByTestId('editor'), items = page.getByTestId('step-item');

  await page.getByTestId('channel-tab-presentation').click();
  await expect(editor).toHaveAttribute('data-channel', 'presentation');
  await expect(page.getByTestId('channel-empty')).toContainText('The presentation is not drawn yet');
  await expect(page.getByTestId('channel-draw')).toContainText('Draw it'); expect(posts, 'choosing a channel starts no run').toEqual([]);
  await page.getByTestId('channel-draw').click();
  await persistedDoc(file, d => (d.channels.presentation?.steps ?? []).length > 0, 60_000);
  await expect(page.getByTestId('channel-empty')).toHaveCount(0); await expect(page.getByTestId('node-agent')).toBeVisible({ timeout: 15_000 });
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ kind: 'story', channel: 'presentation', readCode: false });

  // The file: one view, three steps (the fourth, naming `ghost-part`, was dropped with one warning), nothing else touched.
  const drawn = await readDocument(file);
  expect(viewOf(drawn, 'presentation')).toMatchObject({ id: 'presentation', title: 'Presentation' });
  expect(viewOf(drawn, 'presentation')!.nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']);
  expect(drawn.channels.presentation!.steps).toEqual([
    { id: 's1', parts: ['app'], text: 'Step 1: App', note: 'The test engine explains App.' },
    { id: 's2', parts: ['agent'], text: 'Step 2: Agent', note: 'The test engine explains Agent.' },
    { id: 's3', parts: ['store'], text: 'Step 3: Store', note: 'The test engine explains Store.' },
  ]);
  expect(drawn.warnings).toHaveLength(1); expect(JSON.stringify(drawn.channels.presentation)).not.toContain('ghost-part');
  await expect(page.getByTestId('warnings')).toBeVisible();
  expect(drawn.facts).toEqual(before.facts); expect(drawn.channels.overview).toEqual(before.channels.overview);
  for (const channel of channelNames) expect(outdatedOf(drawn, channel), channel).toEqual([]);
  expect(drawn.channels.readme?.views ?? []).toEqual([]);
  // From 0.4 the drawn presentation arrives as a preview; the steps are looked at after it is kept.
  await expect(page.getByTestId('ai-preview')).toBeVisible(); await page.getByTestId('ai-accept').click(); await expect(page.getByTestId('ai-preview')).toHaveCount(0);

  // The steps panel lists them in order with their numbers and texts.
  await expect(page.getByTestId('steps-panel')).toBeVisible(); await expect(page.getByTestId('step-none')).toHaveCount(0);
  expect(await stepIds(page)).toEqual(['s1', 's2', 's3']);
  await expect(items.nth(0)).toContainText('Step 1: App'); await expect(items.nth(2)).toContainText('Step 3: Store');
  await expect(page.getByTestId('step-prev')).toBeVisible(); await expect(page.getByTestId('step-next')).toBeVisible();
  const bytes = await readFile(file, 'utf8'), sizes = await nodeSizes(page, ['app', 'agent', 'store']);

  // Choose the second step: its part is lit, the others dimmed, no part changes size, and the file is as it was.
  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true'); await expect(items.nth(0)).not.toHaveAttribute('aria-current', 'true');
  expect(await litParts(page)).toEqual({ on: ['agent'], dim: ['app', 'store'], all: ['agent', 'app', 'store'] });
  expect(await nodeSizes(page, ['app', 'agent', 'store'])).toEqual(sizes);
  await expect(page.getByTestId('step-text')).toHaveValue('Step 2: Agent'); await expect(page.getByTestId('step-note')).toHaveValue('The test engine explains Agent.');

  // Next and Previous go one step; at the ends they are disabled; the arrow keys do the same while focus is in the panel.
  await page.getByTestId('step-next').click();
  await expect(items.nth(2)).toHaveAttribute('aria-current', 'true'); expect((await litParts(page)).on).toEqual(['store']); await expect(page.getByTestId('step-next')).toBeDisabled();
  await page.getByTestId('step-prev').click(); await page.getByTestId('step-prev').click();
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'true'); expect((await litParts(page)).on).toEqual(['app']); await expect(page.getByTestId('step-prev')).toBeDisabled();
  await page.getByTestId('step-next').click(); await page.keyboard.press('ArrowRight');
  await expect(items.nth(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowLeft'); await expect(items.nth(1)).toHaveAttribute('aria-current', 'true'); expect((await litParts(page)).on).toEqual(['agent']);
  expect(await nodeSizes(page, ['app', 'agent', 'store'])).toEqual(sizes);

  // Escape on the canvas leaves the step: nothing lit, nothing dimmed; with no step current, Next goes to the first.
  const spot = await emptyCanvasPoint(page); await canvasClick(page, spot.x, spot.y); await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="step-item"][aria-current="true"]')).toHaveCount(0);
  expect(await litParts(page)).toEqual({ on: [], dim: [], all: ['agent', 'app', 'store'] });
  await page.getByTestId('step-next').click(); await expect(items.nth(0)).toHaveAttribute('aria-current', 'true'); expect((await litParts(page)).on).toEqual(['app']);
  // Must not happen: looking at the steps being an edit.
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await expect(page.getByTestId('save-status')).toHaveText('Saved');

  // Share defaults to the slide on this channel, with the presentation's own view.
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('format-slide')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'presentation'); await expect(page.getByTestId('share-size')).toHaveText('1920 × 1080');
  expect((await svgInfo(page, await previewSVG(page))).nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);

  // One undo step takes the whole presentation, steps and all, away; redo brings it back.
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => (d.channels.presentation?.views ?? []).length === 0);
  expect((await readDocument(file)).channels.presentation?.steps ?? []).toEqual([]);
  await expect(page.getByTestId('channel-empty')).toContainText('The presentation is not drawn yet'); await expect(page.getByTestId('steps-panel')).toHaveCount(0);
  await page.getByTestId('tool-redo').click();
  await persistedDoc(file, d => (d.channels.presentation?.steps ?? []).length === 3);
  expect((await readDocument(file)).channels.presentation).toEqual(drawn.channels.presentation);
});
