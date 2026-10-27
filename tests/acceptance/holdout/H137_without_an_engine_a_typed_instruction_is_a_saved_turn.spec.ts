import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { shop3, withLinkedIn, workspaceRaw, isolatedDrawing, readDocument, readDrawing, persistedDoc, openAiPanel, aiTurns, turnStates, turnTexts, viewOf } from './helpers';

const SAVED = 'Saved in the file for your next archdrawer session';

// AI-2 without an engine: the panel is still the one place to type, and each instruction typed there is a turn in the state
// `saved`, with the text, where it was typed and the saved sentence. The instruction is only data (SAFE-1) and goes to the
// file for the next session (FILE-1); no run starts, and the prepared simple version of a channel is not a request.
test('H137 [AI-2, AI-1, SAFE-1, FILE-1, FILE-2, #182] with no engine every instruction typed in the AI panel is a saved turn with its place, goes to the file as a literal request, starts no run, and a reload empties the thread', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { dir, file } = await workspaceRaw('saved-turns', withLinkedIn(shop3('Saved turns shop')));
  const server = await isolatedDrawing(page, request, file, '100', '');
  const posts: string[] = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(new URL(req.url()).pathname); });
  try {
    const before = await readDocument(file), marker = join(dir, 'shell-must-not-run.txt'), initialViews = (await readDrawing(file)).views;
    await openAiPanel(page);
    await expect(page.getByTestId('ai-engine')).toHaveCount(0);
    await expect(page.getByTestId('ai-engine-note')).toHaveText('No engine is available: the instruction is saved in the file for your next archdrawer session');
    await expect(page.getByTestId('ai-input')).toHaveAttribute('placeholder', 'Ask Claude to change this drawing');
    await expect(page.getByTestId('ai-send')).toBeDisabled(); await expect(page.getByTestId('ai-look-again')).toBeDisabled();
    await expect(aiTurns(page)).toHaveCount(0);

    // The first instruction is typed on the overview: a saved turn, its place and the saved sentence.
    const instruction = `Add a review gate; node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'bad')"`;
    await page.getByTestId('ai-input').fill(instruction); await page.getByTestId('ai-send').click();
    await expect(aiTurns(page)).toHaveCount(1);
    const one = aiTurns(page).first();
    await expect(one).toHaveAttribute('data-state', 'saved'); await expect(one.getByTestId('ai-turn-text')).toContainText('Add a review gate');
    await expect(one.getByTestId('ai-turn-where')).toHaveText('Overview · This view'); await expect(page.getByTestId('ai-saved')).toHaveText(SAVED);
    expect(await one.getAttribute('data-run-id'), 'a saved request is no run').toBeFalsy();
    await persistedDoc(file, d => (d.requests ?? []).length === 1);
    expect((await readDocument(file)).requests![0]).toMatchObject({ text: instruction, channel: 'overview', view: 'overview' });
    // Its id is a contracted id and `at` a date (drawing contract, Requests), and saving it changed no view (moved from H25).
    const firstRequest = (await readDocument(file)).requests![0];
    expect(firstRequest.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/); expect(Number.isFinite(Date.parse(firstRequest.at))).toBe(true);
    expect((await readDrawing(file)).views).toEqual(initialViews);

    // The second one is typed on the LinkedIn tab, and is saved for that channel and its view.
    await page.getByTestId('channel-tab-linkedin').click(); await expect(page.getByTestId('linkedin-panel')).toBeVisible();
    await openAiPanel(page);
    await page.getByTestId('ai-input').fill('Make the post shorter'); await page.getByTestId('ai-input').press('Enter');
    await expect(aiTurns(page)).toHaveCount(2);
    await persistedDoc(file, d => (d.requests ?? []).length === 2);
    const requests = (await readDocument(file)).requests!;
    expect(requests[1]).toMatchObject({ text: 'Make the post shorter', channel: 'linkedin', view: viewOf(before, 'linkedin')!.id });
    expect(await turnStates(page)).toEqual(['saved', 'saved']);
    expect((await turnTexts(page))[1]).toContain('Make the post shorter'); await expect(aiTurns(page).last().getByTestId('ai-turn-where')).toHaveText(/^LinkedIn · \S/);
    // An earlier turn keeps its result: the saved sentence.
    await expect(aiTurns(page).first().getByTestId('ai-turn-result')).toContainText(SAVED);

    // The simple version of a channel is drawn in code, not asked for: no request and no turn.
    await page.getByTestId('channel-tab-readme').click();
    await expect(page.getByTestId('channel-draw')).toHaveCount(0); await page.getByTestId('channel-prepare').click();
    await persistedDoc(file, d => (d.channels.readme?.views ?? []).length === 1);
    await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(2);
    expect((await readDocument(file)).requests).toHaveLength(2);

    // Must not happen: a run started, text taken for a command, or the drawing's facts changed by an instruction nobody ran.
    expect(posts.filter(path => path === '/api/runs'), 'no engine: no run').toEqual([]);
    expect(await stat(marker).then(() => true, () => false), 'shell-looking text is data').toBe(false);
    expect((await readDocument(file)).facts).toEqual(before.facts);

    // A reload starts the conversation empty; the requests stay in the file.
    await page.reload(); await expect(page.getByTestId('editor')).toBeVisible();
    await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(0);
    // An empty input queues nothing (moved from H25).
    await page.getByTestId('ai-input').fill('');
    if (await page.getByTestId('ai-send').isEnabled()) await page.getByTestId('ai-send').click();
    else await expect(page.getByTestId('ai-send')).toBeDisabled();
    expect((await readDocument(file)).requests).toHaveLength(2);
    await expect(aiTurns(page)).toHaveCount(0);
    expect((await readDocument(file)).requests!.map(r => r.text)).toEqual([instruction, 'Make the post shorter']);
    // The served `@4` document names each request's choice, its one choice `system` (api contract; moved from H25).
    const served = await (await request.get(`${server.base}/api/diagrams/${server.id}`)).json();
    expect(served.requests).toEqual((await readDocument(file)).requests!.map(r => ({ ...r, choice: 'system' })));
  } finally { await server.close(); }
});
