import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, isolatedDrawing, readDocument, persistedDoc, viewOf, openAiPanel, aiTurns, turnStates, SUGGESTION_TEXT } from './helpers';

const SAVED = 'Saved in the file for your next archdrawer session';

// AI-4 without an engine: the suggestions are still there, and each one saves its instruction as a request for the next
// session (FILE-1), as a typed instruction would, and shows as a saved turn (AI-2). Nothing is run and the drawing is left alone.
test('H142 [AI-4, AI-2, FILE-1] with no engine a suggestion saves its instruction as a request for its channel and view, shows as a saved turn, starts no run and leaves the input and the drawing alone', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('suggest-saved', withLinkedIn(shop3('Saved suggestions shop')));
  const server = await isolatedDrawing(page, request, file, '100', '');
  const posts: string[] = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(new URL(req.url()).pathname); });
  try {
    const before = await readDocument(file);
    await openAiPanel(page);
    await expect(page.getByTestId('ai-engine-note')).toContainText('No engine is available');
    for (const id of ['simpler', 'loop']) await expect(page.getByTestId(`ai-suggest-${id}`), `${id} without an engine`).toBeEnabled();
    await page.getByTestId('ai-input').fill('a draft I am still typing');

    // Show the loop and Simpler on the overview, then Shorter for LinkedIn on the LinkedIn tab: three saved turns.
    await page.getByTestId('ai-suggest-loop').click();
    await expect(aiTurns(page)).toHaveCount(1);
    await expect(aiTurns(page).first()).toHaveAttribute('data-state', 'saved'); await expect(page.getByTestId('ai-saved')).toHaveText(SAVED);
    await expect(aiTurns(page).first().getByTestId('ai-turn-text')).toContainText('Show the loop'); await expect(aiTurns(page).first().getByTestId('ai-turn-where')).toHaveText('Overview · This view');
    await page.getByTestId('ai-suggest-simpler').click(); await expect(aiTurns(page)).toHaveCount(2);
    await expect(aiTurns(page).last().getByTestId('ai-turn-text')).toContainText(/simpl/i);
    await page.getByTestId('channel-tab-linkedin').click(); await openAiPanel(page);
    await expect(page.getByTestId('ai-suggest-shorter')).toHaveText('Shorter for LinkedIn'); await expect(page.getByTestId('ai-suggest-shorter')).toBeEnabled();
    await page.getByTestId('ai-suggest-shorter').click(); await expect(aiTurns(page)).toHaveCount(3);
    await expect(aiTurns(page).last().getByTestId('ai-turn-where')).toHaveText(/^LinkedIn · \S/);
    expect(await turnStates(page)).toEqual(['saved', 'saved', 'saved']);

    // The file got the three requests, in order, with the channel and the view each was asked on.
    await persistedDoc(file, d => (d.requests ?? []).length === 3);
    const requests = (await readDocument(file)).requests!;
    expect(requests.map(r => r.text)).toEqual([SUGGESTION_TEXT.loop, SUGGESTION_TEXT.simpler, SUGGESTION_TEXT.shorter]);
    expect(requests[0]).toMatchObject({ channel: 'overview', view: 'overview' }); expect(requests[1]).toMatchObject({ channel: 'overview', view: 'overview' });
    expect(requests[2]).toMatchObject({ channel: 'linkedin', view: viewOf(before, 'linkedin')!.id });

    // Must not happen: a run, the typed draft taken or sent, or the drawing changed by instructions nobody ran.
    expect(posts.filter(path => path === '/api/runs'), 'no engine: no run').toEqual([]);
    await page.getByTestId('channel-tab-overview').click(); await openAiPanel(page);
    await expect(page.getByTestId('ai-input')).toHaveValue('a draft I am still typing');
    expect(requests.map(r => r.text)).not.toContain('a draft I am still typing');
    const after = await readDocument(file); expect(after.facts).toEqual(before.facts); expect(after.channels).toEqual(before.channels);
    await expect(page.getByTestId('ai-preview')).toHaveCount(0); await expect(page.getByTestId('node-system-map')).toHaveCount(0); // Simpler folded nothing

    // A reload starts the conversation empty; the requests wait in the file.
    await page.reload(); await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(0);
    expect((await readDocument(file)).requests).toHaveLength(3);
  } finally { await server.close(); }
});
