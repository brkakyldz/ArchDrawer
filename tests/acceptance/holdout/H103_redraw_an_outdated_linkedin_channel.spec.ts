import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, viewOf, partOf, outdatedOf, sorted } from './helpers';

// A channel marked as needing an update can be redrawn from the facts: its drawing is replaced, its marks go, and the
// whole thing is one undo step.
test('H103 [STORY-1, FILE-3, EDIT-1] Redraw it draws an outdated LinkedIn channel again from the facts, empties its marks and is one undo step', async ({ page, request }) => {
  const { file } = await workspaceRaw('redraw', withLinkedIn(shop3('Redraw shop'), { outdated: ['db'] }));
  await openDrawing(page, request, file);
  const before = await readDocument(file);
  const editor = page.getByTestId('editor'), tab = page.getByTestId('channel-tab-linkedin');
  await expect(tab).toHaveAttribute('data-outdated', '1');
  await tab.click(); await expect(editor).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);
  await expect(page.getByTestId('channel-keep')).toBeVisible(); await expect(page.getByTestId('channel-redraw')).toBeVisible();
  await expect(page.getByTestId('node-ledger').getByTestId('node-label')).toHaveText('Orders ledger'); // the drawing as it was

  await page.getByTestId('channel-redraw').click();
  await persistedDoc(file, d => !!partOf(d, 'linkedin', 'zone-runtime'), 30_000);
  await expect(page.getByTestId('channel-outdated')).toHaveCount(0, { timeout: 15_000 }); await expect(tab).not.toHaveAttribute('data-outdated', /.*/);
  await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(page.getByTestId('node-ledger')).toHaveCount(0);
  await expect(page.getByTestId('tool-undo')).toBeEnabled();
  const redrawn = await readDocument(file);
  expect(outdatedOf(redrawn, 'linkedin')).toEqual([]);
  const post = viewOf(redrawn, 'linkedin')!;
  expect(post.id).toBe('linkedin-post'); // the channel already had a view: its id is kept
  expect(sorted(post.nodes.map(n => n.id))).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(post.nodes.map(n => n.id)).not.toContain('ledger');
  // Must not happen: the facts or the overview changing because LinkedIn was redrawn.
  expect(redrawn.facts).toEqual(before.facts); expect(redrawn.channels.overview).toEqual(before.channels.overview);

  // One undo step: the old drawing and its mark are back together, and there is nothing further to undo.
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => !!partOf(d, 'linkedin', 'ledger'));
  const undone = await readDocument(file);
  expect(undone.channels.linkedin).toEqual(before.channels.linkedin);
  expect(outdatedOf(undone, 'linkedin')).toEqual(['db']);
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/); await expect(tab).toHaveAttribute('data-outdated', '1');
  await expect(page.getByTestId('tool-undo')).toBeDisabled();
  await expect(page.getByTestId('node-ledger').getByTestId('node-label')).toHaveText('Orders ledger');
  // Redo draws it again, with the marks gone; a reload keeps it.
  await page.getByTestId('tool-redo').click();
  await persistedDoc(file, d => !!partOf(d, 'linkedin', 'zone-runtime') && outdatedOf(d, 'linkedin').length === 0);
  await expect(page.getByTestId('tool-redo')).toBeDisabled();
  expect(viewOf(await readDocument(file), 'linkedin')).toEqual(post);
  await page.reload(); await expect(editor).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
});
