import { test, expect } from '@playwright/test';
import { shop3, workspaceRaw, openDrawing, readDocument, persistedDoc, viewOf, partOf, outdatedOf, channelNames, type Channel } from './helpers';

// STORY-1: after the facts are read, a channel is chosen and drawn from them; switching channel never reads the code again.
test('H102 [STORY-1, NAV-2, AI-1] an empty LinkedIn channel is drawn from the facts with Draw it, switching channels starts no run, and one undo step takes the drawing away', async ({ page, request }) => {
  const { file } = await workspaceRaw('draw', shop3('Draw shop'));
  const runs: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') runs.push(req.url()); });
  await openDrawing(page, request, file);
  const before = await readDocument(file);
  const editor = page.getByTestId('editor'), tab = (channel: Channel) => page.getByTestId(`channel-tab-${channel}`), empty = page.getByTestId('channel-empty');

  // Choosing channels is free: no engine is asked anything, nothing is written.
  for (const channel of ['linkedin', 'readme', 'presentation', 'overview', 'linkedin'] as const) {
    await tab(channel).click(); await expect(editor).toHaveAttribute('data-channel', channel);
  }
  expect(runs, 'switching channel starts no run').toEqual([]);
  await expect(empty).toContainText('The LinkedIn post is not drawn yet');
  expect(await readDocument(file)).toEqual(before);

  // Draw it: the LinkedIn channel is drawn from the facts the drawing already holds.
  await expect(page.getByTestId('channel-draw')).toContainText('Draw it');
  await page.getByTestId('channel-draw').click();
  await persistedDoc(file, d => (d.channels.linkedin?.views ?? []).length === 1, 30_000);
  await expect(page.getByTestId('node-intake')).toBeVisible({ timeout: 15_000}); await expect(empty).toHaveCount(0);
  await expect(page.getByTestId('tool-undo')).toBeEnabled(); // the run is over: edits and undo are back
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const drawn = await readDocument(file);
  const post = viewOf(drawn, 'linkedin')!;
  expect(post).toMatchObject({ id: 'linkedin', title: 'LinkedIn' });
  expect(post.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['request', 'intake', 'loop', 'zone-runtime']));
  const known = new Set(drawn.facts.components.map(f => f.id));
  for (const p of post.nodes) for (const id of p.facts) expect(known.has(id), `${p.id} points at an existing fact`).toBe(true);
  expect(post.nodes.some(p => p.facts.length > 0)).toBe(true); // drawn from the facts, not from nothing
  expect(partOf(drawn, 'linkedin', 'request')?.facts).toEqual(['web']);
  await expect(tab('linkedin')).toHaveAttribute('aria-current', 'true');

  // Must not happen: the facts, the overview or another channel changing, or a mark appearing, because LinkedIn was drawn.
  expect(drawn.facts).toEqual(before.facts); expect(drawn.channels.overview).toEqual(before.channels.overview);
  for (const channel of channelNames) expect(outdatedOf(drawn, channel), channel).toEqual([]);
  for (const channel of channelNames) await expect(page.getByTestId(`channel-outdated-${channel}`)).toHaveCount(0);

  // One undo step takes the whole drawing away, the stage asks to draw it again; redo brings it back.
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => (d.channels.linkedin?.views ?? []).length === 0);
  await expect(empty).toContainText('The LinkedIn post is not drawn yet'); await expect(page.getByTestId('channel-draw')).toBeVisible();
  expect((await readDocument(file)).facts).toEqual(before.facts);
  await page.getByTestId('tool-redo').click();
  await persistedDoc(file, d => (d.channels.linkedin?.views ?? []).length === 1);
  expect(viewOf(await readDocument(file), 'linkedin')).toEqual(post);
  await page.reload(); await expect(editor).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('node-intake')).toBeVisible();
});
