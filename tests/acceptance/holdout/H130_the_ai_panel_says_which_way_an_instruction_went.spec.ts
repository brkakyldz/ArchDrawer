import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, callout, box, factOf, viewOf, sorted, startedRun, sendInPanel, runDone, openAiPanel, aiTurn,
  FACTS_ROUTE, STORY_ROUTE } from './helpers';

// AI-5 at the surface: after a refine the AI panel says which way it went (`ai-route`, `data-route`), and the preview carries
// the same sentence. A story-route instruction on the overview may move parts but changes no content; a parts scope is
// always the facts. From 0.4 there is one place to type (AI-2) and the one-click fold is the `Simpler` suggestion (AI-4).
test('H130 [AI-5, AI-1, AI-2, AI-4, EDIT-4, STORY-6] the AI panel says whether an instruction changed the facts or redrew the channel from them, a story on the overview only moves things, a selection of parts always changes the facts, and Simpler names no route', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('routing-ui', withLinkedIn(shop3('Route shop')));
  await openDrawing(page, request, file);
  const route = page.getByTestId('ai-route');
  const ask = async (text: string, state: string) => {
    const run = await sendInPanel(page, text);
    expect(await runDone(page, run.runId), text).toBe(state); await expect(page.getByTestId('ai-summary')).toBeVisible(); return run;
  };
  for (const id of ['ask-input', 'ask-send']) await expect(page.getByTestId(id), 'the ask box is gone').toHaveCount(0);

  // 1. Facts route: the preview carries the summary and the sentence; the panel says it too.
  await ask('rename Orders DB to Order store', 'preview');
  await expect(page.getByTestId('ai-preview')).toContainText('The drawing was updated'); await expect(page.getByTestId('ai-preview')).toContainText(FACTS_ROUTE);
  await expect(route).toHaveAttribute('data-route', 'facts'); await expect(route).toHaveText(FACTS_ROUTE);
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Order store');
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store');

  // 2. A second instruction (which keeps the first result): the sentence and `data-route`, beside the summary.
  await ask('rename Order API to Checkout API', 'preview');
  await expect(route).toHaveAttribute('data-route', 'facts'); await expect(route).toHaveText(FACTS_ROUTE);
  await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-changed', '1');
  expect(factOf(await readDocument(file), 'api')!.label).toBe('Checkout API');

  // 3. Story route on the overview: a move happens, a rename is not applied, and both say they redrew from the facts.
  await ask('[fixture:story] move Web app right of Checkout API', 'preview');
  await expect(route).toHaveAttribute('data-route', 'story'); await expect(route).toHaveText(STORY_ROUTE);
  const web = await box(page.getByTestId('node-web')), api = await box(page.getByTestId('node-api'));
  expect(web.x, 'the story route may move parts').toBeGreaterThan(api.x + api.width);
  await ask('[fixture:story] rename Web app to Storefront', 'unchanged');
  await expect(route).toHaveAttribute('data-route', 'story');
  expect(factOf(await readDocument(file), 'web')!.label, 'a story never renames a fact').toBe('Web app');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Web app');
  await expect(page.getByTestId('warnings')).toBeVisible(); // the ignored change is warned about

  // 4. The panel on the LinkedIn channel, story route: the channel is drawn again from the facts, and the preview says so.
  await page.getByTestId('channel-tab-linkedin').click(); await openAiPanel(page);
  const post = await ask('[fixture:story] Make the post shorter', 'preview');
  await expect(page.getByTestId('ai-preview')).toContainText(STORY_ROUTE); await expect(route).toHaveAttribute('data-route', 'story');
  await expect(aiTurn(page, post.runId).getByTestId('ai-turn-where')).toHaveText(/^LinkedIn · /);
  await persistedDoc(file, d => !!viewOf(d, 'linkedin')!.nodes.find(n => n.id === 'zone-runtime'), 60_000);
  await expect(page.getByTestId('node-intake')).toBeVisible();
  const afterPost = await readDocument(file);
  expect(sorted(viewOf(afterPost, 'linkedin')!.nodes.map(n => n.id))).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(factOf(afterPost, 'db')!.label).toBe('Order store'); // the facts were left as the earlier instructions made them

  // 5. A selection of parts always changes the facts: the marker is not heard, the rename is applied.
  await page.getByTestId('channel-tab-overview').click();
  await (await callout(page, 'web')).getByTestId('callout-ask').click();
  await expect(page.getByTestId('ai-scope-selection')).toBeChecked(); await expect(page.getByTestId('ai-input')).toBeFocused();
  const selected = await startedRun(page, async () => { await page.getByTestId('ai-input').fill('[fixture:story] rename Web app to Storefront'); await page.getByTestId('ai-send').click(); });
  expect(selected.body).toMatchObject({ scope: { kind: 'parts', ids: ['web'] } });
  expect(await runDone(page, selected.runId)).toBe('preview');
  await expect(route).toHaveAttribute('data-route', 'facts'); await expect(route).toHaveText(FACTS_ROUTE);
  await persistedDoc(file, d => factOf(d, 'web')?.label === 'Storefront');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Storefront');

  // 6. Simpler names no route: there is no question to answer and the sentence is not shown.
  const folding = await startedRun(page, () => page.getByTestId('ai-suggest-simpler').click());
  expect(await runDone(page, folding.runId)).toBe('preview');
  await expect(page.getByTestId('ai-summary')).toBeVisible();
  await expect(route).toHaveCount(0);
  // Must not happen: the story-route instructions having added or removed a fact.
  expect(sorted((await readDocument(file)).facts.components.map(f => f.id))).toEqual(['api', 'db', 'web']);
});
