import { test, expect } from '@playwright/test';
import { agent3, workspaceRaw, isolatedDrawing, openDrawing, readDocument, persistedDoc, outsideWrite, saved, fact, part, viewOf, partOf, outdatedOf, ownText,
  stepIds, sorted, channelNames } from './helpers';

// Without an engine the presentation is prepared in code: the README's simple version (the overview's first view as it is)
// plus one step per numbered connection, in step order. It is one undoable edit, and Redraw it replaces it, steps included.
test('H128 [STORY-4, STORY-1, FILE-3, EDIT-1] with no engine the Presentation tab prepares the overview as the drawing with one step per numbered connection, and Redraw it makes the same again after a change, each as one undoable edit', async ({ page, request }) => {
  test.setTimeout(240_000);
  const doc = agent3('Simple talk');
  doc.facts.relations![1].label = ''; // the second connection has no label of its own: its step is named by its two parts
  const { file } = await workspaceRaw('simple-presentation', doc);
  const server = await isolatedDrawing(page, request, file, '750', ''); // no engine at all
  try {
    const before = await readDocument(file);
    const tab = page.getByTestId('channel-tab-presentation'), empty = page.getByTestId('channel-empty');
    await tab.click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'presentation');
    await expect(empty).toContainText('The presentation is not drawn yet');
    await expect(page.getByTestId('channel-prepare')).toContainText('Prepare the simple version');
    await expect(page.getByTestId('post-engine-note')).toContainText('No engine available — prepared without AI');
    await expect(page.getByTestId('channel-draw')).toHaveCount(0); await expect(page.getByTestId('share-button')).toBeDisabled();

    await page.getByTestId('channel-prepare').click();
    await persistedDoc(file, d => (d.channels.presentation?.views ?? []).length === 1);
    await expect(page.getByTestId('steps-panel')).toBeVisible(); await expect(empty).toHaveCount(0); await saved(page);
    const prepared = await readDocument(file), view = viewOf(prepared, 'presentation')!, overview = viewOf(before)!;
    // The drawing: the overview's first view as it is, nothing of its own.
    expect(view).toMatchObject({ id: 'presentation', title: 'Presentation', caption: overview.caption }); expect(view.texts ?? []).toEqual([]);
    expect(view.nodes.map(n => [n.id, n.facts, n.form, n.held ?? [], n.limits ?? []])).toEqual(overview.nodes.map(n => [n.id, n.facts, n.form, n.held ?? [], n.limits ?? []]));
    for (const p of view.nodes) expect(ownText(p), `${p.id} takes its text from the facts`).toEqual({ label: null, kind: null, sub: null, description: null, items: null });
    expect(view.edges.map(e => [e.from, e.to, e.relations, e.step])).toEqual(overview.edges.map(e => [e.from, e.to, e.relations, e.step]));
    // The steps: one per numbered connection, in step order, naming its two parts, with the drawn label or `from → to`, and an empty note.
    const steps = prepared.channels.presentation!.steps!;
    expect(steps.map(s => [[...s.parts].sort(), s.text, s.note])).toEqual([[['agent', 'app'], 'asks', ''], [['agent', 'store'], 'Agent → Store', '']]);
    expect(new Set(steps.map(s => s.id)).size).toBe(2);
    expect(await stepIds(page)).toEqual(steps.map(s => s.id));
    // Must not happen: a fact, the overview or another channel changing, or a mark appearing.
    expect(prepared.facts).toEqual(before.facts); expect(prepared.channels.overview).toEqual(before.channels.overview);
    for (const channel of channelNames) expect(outdatedOf(prepared, channel), channel).toEqual([]);
    expect(prepared.channels.readme?.views ?? []).toEqual([]);
    // One undo step takes the drawing and its steps away; redo brings the same back.
    await page.getByTestId('tool-undo').click();
    await persistedDoc(file, d => (d.channels.presentation?.views ?? []).length === 0);
    expect((await readDocument(file)).channels.presentation?.steps ?? []).toEqual([]); await expect(empty).toContainText('The presentation is not drawn yet');
    await page.getByTestId('tool-redo').click();
    await persistedDoc(file, d => (d.channels.presentation?.steps ?? []).length === 2);
    expect((await readDocument(file)).channels.presentation).toEqual(prepared.channels.presentation);

    // The user's own words in a step, then a new fact that the presentation does not draw: the tab is marked.
    await page.getByTestId('step-item').nth(0).click(); await page.getByTestId('step-text').fill('My own words'); await saved(page);
    await persistedDoc(file, d => d.channels.presentation!.steps![0].text === 'My own words');
    await page.getByTestId('channel-tab-overview').click();
    const grown = await readDocument(file);
    grown.facts.components.push(fact('cache', { label: 'Cache', kind: 'data', description: 'Keeps recent answers.' }));
    viewOf(grown)!.nodes.push(part('cache', { place: { row: 2, col: 0 } })); grown.updatedAt = '2099-01-01T00:00:00.000Z';
    await outsideWrite(file, grown);
    await expect(page.getByTestId('node-cache')).toBeVisible({ timeout: 8000 });
    await persistedDoc(file, d => outdatedOf(d, 'presentation').includes('cache'));
    await tab.click();
    await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/); await expect(page.getByTestId('channel-redraw')).toBeVisible(); await expect(page.getByTestId('channel-keep')).toBeVisible();
    const marked = await readDocument(file);

    // Redraw it: the simple version again from the facts, with the cache, the steps made anew, the mark gone: one undo step.
    await page.getByTestId('channel-redraw').click();
    await persistedDoc(file, d => !!partOf(d, 'presentation', 'cache') && outdatedOf(d, 'presentation').length === 0);
    const redrawn = await readDocument(file);
    expect(sorted(viewOf(redrawn, 'presentation')!.nodes.map(n => n.id))).toEqual(['agent', 'app', 'cache', 'store']);
    expect(redrawn.channels.presentation!.steps!.map(s => s.text)).toEqual(['asks', 'Agent → Store']); // "My own words" went with the old drawing
    expect(redrawn.facts).toEqual(marked.facts); expect(redrawn.channels.overview).toEqual(marked.channels.overview);
    await page.getByTestId('tool-undo').click();
    await persistedDoc(file, d => !partOf(d, 'presentation', 'cache') && outdatedOf(d, 'presentation').join() === 'cache');
    expect((await readDocument(file)).channels.presentation!.steps![0].text).toBe('My own words');

    // With no numbered connection there is still one step: every top-level part, the caption's title as its text.
    const flat = agent3('Flat talk'); for (const e of viewOf(flat)!.edges) e.step = null;
    const second = await workspaceRaw('simple-presentation-flat', flat);
    await openDrawing(page, request, second.file, server.base);
    await page.getByTestId('channel-tab-presentation').click(); await page.getByTestId('channel-prepare').click();
    await persistedDoc(second.file, d => (d.channels.presentation?.steps ?? []).length > 0);
    const only = (await readDocument(second.file)).channels.presentation!.steps!;
    expect(only).toHaveLength(1); expect([...only[0].parts].sort()).toEqual(['agent', 'app', 'store']);
    expect(only[0].text).toBe('How Flat talk runs'); expect(only[0].note).toBe('');
  } finally { await server.close(); }
});
