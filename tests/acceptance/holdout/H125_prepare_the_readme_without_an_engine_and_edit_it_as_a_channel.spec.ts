import { test, expect, type Page } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, isolatedDrawing, readDocument, persistedDoc, saved, callout, factOf, partOf, viewOf, outdatedOf, ownText, sorted, channelNames,
  previewSVG, svgInfo, type Doc3 } from './helpers';

async function rename(page: Page, id: string, text: string) {
  await page.keyboard.press('Escape');
  await page.getByTestId(`node-${id}`).getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill(text); await page.getByTestId('node-label-input').press('Enter');
  await page.keyboard.press('Escape'); await saved(page);
}
const marks = (doc: Doc3) => Object.fromEntries(channelNames.map(c => [c, outdatedOf(doc, c)]));

// With no engine, the README tab prepares the simple version in code: the overview's first view as it is, laid out again for
// a README. Then it is edited like any channel: a name there is its own, a description corrects the fact, deleting a part
// leaves it out of the README only.
test('H125 [STORY-1, STORY-3, FILE-3, EDIT-1, SHARE-2] with no engine the README tab prepares the simple version from the overview as one undoable edit, and editing the README changes the facts or only itself by the same rules as any channel', async ({ page, request }) => {
  test.setTimeout(240_000);
  const doc = withLinkedIn(shop3('Readme edit shop'));
  partOf(doc, 'linkedin', 'intake')!.description = 'Where an order is checked.'; // LinkedIn tells the API its own way
  const { file } = await workspaceRaw('readme-prepare', doc);
  const server = await isolatedDrawing(page, request, file, '750', ''); // ARCHDRAW_ENGINES empty: no engine at all
  try {
    const before = await readDocument(file);
    const tab = page.getByTestId('channel-tab-readme');
    await tab.click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'readme');
    await expect(page.getByTestId('channel-empty')).toContainText('The README drawing is not drawn yet');
    await expect(page.getByTestId('channel-prepare')).toContainText('Prepare the simple version');
    await expect(page.getByTestId('post-engine-note')).toContainText('No engine available — prepared without AI');
    await expect(page.getByTestId('channel-draw')).toHaveCount(0); await expect(page.getByTestId('share-button')).toBeDisabled();

    // Prepared: the overview's first view, part for part, in one undoable edit.
    await page.getByTestId('channel-prepare').click();
    await persistedDoc(file, d => (d.channels.readme?.views ?? []).length === 1);
    await expect(page.getByTestId('node-api')).toBeVisible(); await expect(page.getByTestId('channel-empty')).toHaveCount(0); await saved(page);
    const prepared = await readDocument(file), view = viewOf(prepared, 'readme')!, overview = viewOf(before)!;
    expect(view).toMatchObject({ id: 'readme', title: 'README', caption: overview.caption }); expect(view.texts ?? []).toEqual([]);
    expect(view.nodes.map(n => [n.id, n.facts, n.form, n.parent])).toEqual(overview.nodes.map(n => [n.id, n.facts, n.form, n.parent]));
    for (const p of view.nodes) expect(ownText(p), `${p.id} takes its text from the fact`).toEqual({ label: null, kind: null, sub: null, description: null, items: null });
    expect(view.edges.map(e => [e.from, e.to, e.relations, e.step])).toEqual(overview.edges.map(e => [e.from, e.to, e.relations, e.step]));
    expect(prepared.facts).toEqual(before.facts); expect(prepared.channels.overview).toEqual(before.channels.overview);
    expect(marks(prepared)).toEqual({ overview: [], linkedin: [], readme: [], presentation: [] });
    await page.getByTestId('tool-undo').click();
    await persistedDoc(file, d => (d.channels.readme?.views ?? []).length === 0);
    await expect(page.getByTestId('channel-empty')).toContainText('The README drawing is not drawn yet');
    await page.getByTestId('tool-redo').click();
    await persistedDoc(file, d => (d.channels.readme?.views ?? []).length === 1);
    expect(viewOf(await readDocument(file), 'readme')).toEqual(view);

    // Share on this channel defaults to the README size and draws the README's own view.
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'readme'); await expect(page.getByTestId('share-size')).toHaveText('1600 × 900');
    expect((await svgInfo(page, await previewSVG(page))).nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);
    await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);

    // A name given in the README is the README's own: the fact, the overview and LinkedIn keep theirs, and nothing is marked.
    await rename(page, 'db', 'Store');
    await persistedDoc(file, d => partOf(d, 'readme', 'db')?.label === 'Store');
    const named = await readDocument(file);
    expect(factOf(named, 'db')!.label).toBe('Orders DB'); expect(partOf(named, 'overview', 'db')?.label ?? null).toBeNull();
    expect(viewOf(named, 'overview')).toEqual(viewOf(prepared, 'overview')); expect(viewOf(named, 'linkedin')).toEqual(viewOf(prepared, 'linkedin'));
    expect(marks(named)).toEqual({ overview: [], linkedin: [], readme: [], presentation: [] });

    // A description is content: it corrects the fact. The overview shows it directly; LinkedIn tells it its own way and is marked.
    await page.keyboard.press('Escape');
    await (await callout(page, 'api')).getByTestId('callout-description').dblclick();
    await page.getByTestId('callout-description-input').fill('Takes and checks every order.');
    await page.getByTestId('callout-description-input').press('ControlOrMeta+Enter'); await saved(page);
    await persistedDoc(file, d => factOf(d, 'api')?.description === 'Takes and checks every order.');
    const described = await readDocument(file);
    expect(partOf(described, 'readme', 'api')?.description ?? null).toBeNull(); expect(partOf(described, 'overview', 'api')?.description ?? null).toBeNull();
    expect(partOf(described, 'linkedin', 'intake')?.description).toBe('Where an order is checked.');
    expect(marks(described)).toEqual({ overview: [], linkedin: ['api'], readme: [], presentation: [] }); // the channel it was made in is never marked
    await page.keyboard.press('Escape');

    // Deleting a part in the README leaves it out of the README only.
    await (await callout(page, 'web')).getByTestId('callout-delete').click(); await saved(page);
    await persistedDoc(file, d => !partOf(d, 'readme', 'web'));
    const left = await readDocument(file);
    expect(sorted(viewOf(left, 'readme')!.nodes.map(n => n.id))).toEqual(['api', 'db']); expect(viewOf(left, 'readme')!.edges.map(e => e.relations)).toEqual([['r2']]);
    expect(left.facts).toEqual(described.facts); expect(factOf(left, 'web')).toBeTruthy(); expect(partOf(left, 'overview', 'web')).toBeTruthy(); expect(partOf(left, 'linkedin', 'visitor')).toBeTruthy();
    expect(marks(left)).toEqual({ overview: [], linkedin: ['api'], readme: [], presentation: [] });
    await page.getByTestId('tool-undo').click();
    await persistedDoc(file, d => !!partOf(d, 'readme', 'web'));
    expect(viewOf(await readDocument(file), 'readme')!.edges.map(e => e.relations)).toEqual([['r1'], ['r2']]);
    // Must not happen: any of it writing into the presentation channel, or marking the README.
    expect((await readDocument(file)).channels.presentation?.views ?? []).toEqual([]); expect(outdatedOf(await readDocument(file), 'readme')).toEqual([]);
  } finally { await server.close(); }
});
