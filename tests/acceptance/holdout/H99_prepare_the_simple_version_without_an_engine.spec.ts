import { test, expect } from '@playwright/test';
import { shop3, workspaceRaw, isolatedDrawing, readDocument, persistedDoc, saved, viewOf, partOf, ownText, outdatedOf } from './helpers';

// With no engine on the machine, the LinkedIn tab offers the simple version: drawn by code from the overview, the
// parts pointing at the same facts, as one undoable edit. No fact and no overview part changes.
test('H99 [FILE-2, NAV-2, EDIT-1] with no engine the LinkedIn tab prepares the simple version from the overview as one undoable edit, its parts pointing at the same facts', async ({ page, request }) => {
  const { file } = await workspaceRaw('prepare', shop3('Prepare shop'));
  const server = await isolatedDrawing(page, request, file, '750', ''); // ARCHDRAW_ENGINES empty: no engine at all
  try {
    const before = await readDocument(file);
    await page.getByTestId('channel-tab-linkedin').click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
    await expect(page.getByTestId('channel-empty')).toContainText('The LinkedIn post is not drawn yet');
    await expect(page.getByTestId('share-button')).toBeDisabled(); // nothing to package yet
    await expect(page.getByTestId('linkedin-prepare')).toContainText('Prepare the simple version');
    await expect(page.getByTestId('post-engine-note')).toContainText('No engine available — prepared without AI');
    await expect(page.getByTestId('design-post')).toHaveCount(0); // there is no engine to design with

    await page.getByTestId('linkedin-prepare').click();
    await persistedDoc(file, d => (d.channels.linkedin?.views ?? []).length === 1);
    await expect(page.getByTestId('node-api')).toBeVisible(); await expect(page.getByTestId('channel-empty')).toHaveCount(0);
    await expect(page.getByTestId('share-button')).toBeEnabled(); await saved(page);
    const prepared = await readDocument(file);
    const post = viewOf(prepared, 'linkedin')!;
    expect(post).toMatchObject({ id: 'linkedin', title: 'LinkedIn', caption: viewOf(before)!.caption }); // the overview's caption
    expect(post.nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']); // each part keeps its overview part's id
    for (const p of post.nodes) {
      expect(p.facts, p.id).toEqual([p.id]); // and points at the same fact
      expect(ownText(p), `${p.id} takes its text from the fact`).toEqual({ label: null, kind: null, sub: null, description: null, items: null });
    }
    expect(partOf(prepared, 'linkedin', 'api')?.form).toBe('panel'); // the part that holds something is opened
    for (const id of ['web', 'db']) expect(partOf(prepared, 'linkedin', id)?.form).not.toBe('panel');
    expect(post.edges.map(e => [e.id, e.relations, e.step])).toEqual([['li-e', ['r1'], 1], ['li-e-2', ['r2'], 2]]);
    expect(post.texts ?? []).toEqual([]);
    expect(outdatedOf(prepared, 'linkedin')).toEqual([]);
    // Must not happen: a fact or the overview changing because LinkedIn was drawn.
    expect(prepared.facts).toEqual(before.facts); expect(prepared.channels.overview).toEqual(before.channels.overview);

    // One undo step takes the whole drawing away; redo brings the same drawing back.
    await page.getByTestId('tool-undo').click();
    await persistedDoc(file, d => (d.channels.linkedin?.views ?? []).length === 0);
    await expect(page.getByTestId('channel-empty')).toContainText('The LinkedIn post is not drawn yet');
    await page.getByTestId('tool-redo').click();
    await persistedDoc(file, d => (d.channels.linkedin?.views ?? []).length === 1);
    expect(viewOf(await readDocument(file), 'linkedin')).toEqual(post);
    await saved(page); await page.reload();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('node-api')).toBeVisible();
  } finally { await server.close(); }
});
