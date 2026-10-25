import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, withReadme, withPresentation, withDetail, workspaceRaw, openDrawing, readDocument, persistedDoc, viewOf, sorted, startedRun, sendInPanel, runDone, acceptPreview,
  openAiPanel, aiTurn, SUGGESTIONS, SUGGESTION_TEXT, STORY_ROUTE, FACTS_ROUTE, type Channel } from './helpers';

const POST_PARTS = ['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime'];

// AI-4: each channel has a short fixed list of one-click suggestions. A suggestion is sent like a typed instruction (so it is
// routed and its route is shown), leaves the input as it is, and is disabled while a run goes. `Simpler` is the canned
// simplification of the overview's first view and takes the editor there first; `Show the loop` takes the facts route and,
// as a verb the fixture does not know, changes nothing; the other three take the story route.
test('H141 [AI-4, AI-5, AI-2, STORY-6] each channel offers its own suggestions, each is sent as a routed instruction that leaves the input alone, Simpler folds the overview from its first view, and every suggestion is disabled while a run goes', async ({ page, request }) => {
  test.setTimeout(420_000);
  // The detail view is added last: the README and the presentation are copies of the overview's first view and hold no `detail`.
  const { file } = await workspaceRaw('suggest', withDetail(withPresentation(withReadme(withLinkedIn(shop3('Suggest shop'))))));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  const record = async (runId: string) => await (await request.get(`/api/runs/${runId}`)).json();
  const ids = async () => sorted(await page.getByTestId('ai-suggestions').locator('[data-testid^="ai-suggest-"]').evaluateAll(els => els.map(el => el.getAttribute('data-testid')!)));
  const turnOf = (runId: string) => aiTurn(page, runId);
  const suggestionsOf = async (channel: Channel) => {
    await openAiPanel(page);
    expect(await ids(), `the suggestions of ${channel}`).toEqual(sorted(SUGGESTIONS[channel].map(([id]) => `ai-suggest-${id}`)));
    for (const [id, label] of SUGGESTIONS[channel]) await expect(page.getByTestId(`ai-suggest-${id}`)).toHaveText(label);
    await expect(page.getByTestId('simplify-overview'), 'the old button is gone').toHaveCount(0);
  };
  const clickSuggestion = async (id: string) => await startedRun(page, () => page.getByTestId(`ai-suggest-${id}`).click());
  // The final state of a story-route run: a preview when it changed something, `unchanged` when it did not; either way it names its route.
  const settle = async (runId: string, route: 'story' | 'facts') => {
    const state = await runDone(page, runId); expect(['preview', 'unchanged']).toContain(state);
    await expect(page.getByTestId('ai-route')).toHaveAttribute('data-route', route); await expect(page.getByTestId('ai-route')).toHaveText(route === 'story' ? STORY_ROUTE : FACTS_ROUTE);
    expect((await record(runId)).route).toBe(route);
    if (state === 'preview') await acceptPreview(page);
    return state;
  };

  // Overview, opened on a detail view: Simpler and Show the loop, nothing else.
  await page.goto(`/d/${opened.id}?view=inside-api`);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  await suggestionsOf('overview');
  // Show the loop is a refine on the current view with the typed draft left alone; the fixture takes the facts route and knows no such verb.
  await page.getByTestId('ai-input').fill('a draft I am still typing');
  const loop = await clickSuggestion('loop');
  expect(loop.body.instruction).toBe(SUGGESTION_TEXT.loop); expect(loop.body.kind ?? 'refine').toBe('refine');
  expect(loop.body).toMatchObject({ view: 'inside-api', engine: 'fixture', scope: { kind: 'view' } });
  expect(await settle(loop.runId, 'facts')).toBe('unchanged');
  await expect(page.getByTestId('ai-summary')).toHaveText('Nothing changed'); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await expect(turnOf(loop.runId).getByTestId('ai-turn-text')).toContainText('Show the loop'); await expect(turnOf(loop.runId).getByTestId('ai-turn-where')).toHaveText('Overview · This view');
  await expect(page.getByTestId('ai-input')).toHaveValue('a draft I am still typing'); await page.getByTestId('ai-input').fill('');
  expect((await readDocument(file)).channels.overview, 'a run that changed nothing').toEqual(before.channels.overview);

  // README, presentation and LinkedIn: one suggestion each, whose instruction the routing question hears as a story.
  for (const [channel, id, text] of [['readme', 'fewer-details', /fewer details/i], ['presentation', 'fewer-steps', /fewer steps/i], ['linkedin', 'shorter', /shorter for LinkedIn/i]] as const) {
    await page.getByTestId(`channel-tab-${channel}`).click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', channel);
    await suggestionsOf(channel);
    const run = await clickSuggestion(id);
    expect(run.body.instruction).toBe(SUGGESTION_TEXT[id]); expect(run.body).toMatchObject({ channel, scope: { kind: 'view' } });
    const turn = turnOf(run.runId);
    await expect(turn.getByTestId('ai-turn-text')).toContainText(text);
    await settle(run.runId, 'story');
    await expect(turn.getByTestId('ai-turn-where')).toHaveText(new RegExp(`^${channel === 'linkedin' ? 'LinkedIn' : channel === 'readme' ? 'README' : 'Presentation'} · This view$`));
  }
  await persistedDoc(file, d => sorted(viewOf(d, 'linkedin')!.nodes.map(n => n.id)).join() === POST_PARTS.join());
  const stories = await readDocument(file);
  // The file is one `system` choice: its README story is built from the map and its detail views, skipping the part with a `detail`
  // (`api`), so it holds the map's other parts and the inside of `api` (testing contract, Story, README).
  expect(sorted(viewOf(stories, 'readme')!.nodes.map(n => n.id))).toEqual(['db', 'validator', 'web', 'writer']);
  expect(stories.channels.presentation!.steps!.map(s => s.id)).toEqual(['s1', 's2', 's3']); expect(stories.channels.presentation!.steps![0].text).toMatch(/^Step 1: /);
  expect(stories.facts, 'a story changes no fact').toEqual(before.facts);

  // Every suggestion is disabled while a run goes, as is sending; Cancel brings them back.
  await page.getByTestId('channel-tab-overview').click(); await suggestionsOf('overview');
  const slow = await sendInPanel(page, 'rename Orders DB to Vault\n[fixture:slow]');
  await expect(page.getByTestId('ai-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible();
  for (const [id] of SUGGESTIONS.overview) await expect(page.getByTestId(`ai-suggest-${id}`), `${id} while a run goes`).toBeDisabled();
  await expect(page.getByTestId('ai-send')).toBeDisabled();
  await page.getByTestId('ai-cancel').click(); expect(await runDone(page, slow.runId, 30_000)).toBe('cancelled');
  for (const [id] of SUGGESTIONS.overview) await expect(page.getByTestId(`ai-suggest-${id}`), `${id} after Cancel`).toBeEnabled();
  expect((await readDocument(file)).facts, 'a cancelled run wrote nothing').toEqual(before.facts);

  // Simpler, from a detail view: the editor goes to the overview's first view, the canned simplification runs there, no fact is lost.
  await page.goto(`/d/${opened.id}?view=inside-api`);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api'); await suggestionsOf('overview');
  const simpler = await clickSuggestion('simpler');
  expect(simpler.body).toMatchObject({ kind: 'simplify', view: 'overview', engine: 'fixture' });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview');
  expect(await runDone(page, simpler.runId)).toBe('preview');
  await expect(page.getByTestId('ai-route'), 'a simplify run names no route').toHaveCount(0); expect((await record(simpler.runId)).route).toBeNull();
  await expect(turnOf(simpler.runId).getByTestId('ai-turn-where')).toHaveText('Overview · This view'); await expect(page.getByTestId('ai-preview')).toBeVisible();
  const folded = await readDocument(file), first = viewOf(folded)!;
  expect(first.nodes).toHaveLength(1); expect(first.nodes[0]).toMatchObject({ id: 'system-map', form: 'group', detail: 'inside-the-system' });
  expect(sorted(viewOf(folded, 'overview', 'inside-the-system')!.nodes.map(n => n.id))).toEqual(['api', 'db', 'web']);
  expect(folded.facts, 'folding the map loses and changes no fact').toEqual(before.facts);
  await acceptPreview(page);
});
