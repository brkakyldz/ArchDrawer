import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, callout, box, factOf, viewOf, sorted } from './helpers';

const FACTS_SENTENCE = 'Changed the facts: every channel that shows them shows it';
const STORY_SENTENCE = 'Redrew this channel from the facts, without reading the code';

// AI-5 at the surface: after a refine the AI panel says which way it went (`ai-route`, `data-route`), and the ask box's toast
// adds the same sentence. A story-route instruction on the overview may move parts but changes no content; a parts scope is
// always the facts.
test('H130 [AI-5, AI-1, EDIT-4, STORY-6] the AI panel and the ask box say whether an instruction changed the facts or redrew the channel from them, a story on the overview only moves things, and a selection of parts always changes the facts', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('routing-ui', withLinkedIn(shop3('Route shop')));
  await openDrawing(page, request, file);
  const route = page.getByTestId('ai-route'), toast = page.getByTestId('toast');
  const openPanel = async () => { if (!await page.getByTestId('ai-panel').isVisible()) await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-panel')).toBeVisible(); };
  const sendInPanel = async (text: string) => {
    await openPanel(); await page.getByTestId('ai-input').fill(text); await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-input')).toHaveValue('', { timeout: 90_000 }); // cleared on success: this run is over, not an earlier one's summary
    await expect(page.getByTestId('ai-summary')).toBeVisible(); await expect(route).toBeVisible();
  };

  // 1. The ask box, facts route: the toast carries the summary and the sentence.
  await page.getByTestId('ask-input').fill('rename Orders DB to Order store'); await page.getByTestId('ask-send').click();
  await expect(toast).toContainText('The drawing was updated', { timeout: 90_000 }); await expect(toast).toContainText(FACTS_SENTENCE);
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Order store');
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store');

  // 2. The panel, facts route: the sentence and `data-route`, beside the summary.
  await sendInPanel('rename Order API to Checkout API');
  await expect(route).toHaveAttribute('data-route', 'facts'); await expect(route).toHaveText(FACTS_SENTENCE);
  await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-changed', '1');
  expect(factOf(await readDocument(file), 'api')!.label).toBe('Checkout API');

  // 3. Story route on the overview: a move happens, a rename is not applied, and both say they redrew from the facts.
  await sendInPanel('[fixture:story] move Web app right of Checkout API');
  await expect(route).toHaveAttribute('data-route', 'story'); await expect(route).toHaveText(STORY_SENTENCE);
  const web = await box(page.getByTestId('node-web')), api = await box(page.getByTestId('node-api'));
  expect(web.x, 'the story route may move parts').toBeGreaterThan(api.x + api.width);
  await sendInPanel('[fixture:story] rename Web app to Storefront');
  await expect(route).toHaveAttribute('data-route', 'story');
  expect(factOf(await readDocument(file), 'web')!.label, 'a story never renames a fact').toBe('Web app');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Web app');
  await expect(page.getByTestId('warnings')).toBeVisible(); // the ignored change is warned about

  // 4. The ask box on the LinkedIn channel, story route: the channel is drawn again from the facts, the toast says so.
  await page.getByTestId('ai-close').click();
  await page.getByTestId('channel-tab-linkedin').click();
  await page.getByTestId('ask-input').fill('[fixture:story] Make the post shorter'); await page.getByTestId('ask-send').click();
  await expect(toast).toContainText('The drawing was updated', { timeout: 90_000 }); await expect(toast).toContainText(STORY_SENTENCE);
  await persistedDoc(file, d => !!viewOf(d, 'linkedin')!.nodes.find(n => n.id === 'zone-runtime'), 60_000);
  await expect(page.getByTestId('node-intake')).toBeVisible();
  const afterPost = await readDocument(file);
  expect(sorted(viewOf(afterPost, 'linkedin')!.nodes.map(n => n.id))).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(factOf(afterPost, 'db')!.label).toBe('Order store'); // the facts were left as the earlier instructions made them

  // 5. A selection of parts always changes the facts: the marker is not heard, the rename is applied.
  await page.getByTestId('channel-tab-overview').click();
  await (await callout(page, 'web')).getByTestId('callout-ask').click();
  await expect(page.getByTestId('ai-scope-selection')).toBeChecked();
  await page.getByTestId('ai-input').fill('[fixture:story] rename Web app to Storefront'); await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-input')).toHaveValue('', { timeout: 90_000 });
  await expect(page.getByTestId('ai-summary')).toBeVisible();
  await expect(route).toHaveAttribute('data-route', 'facts'); await expect(route).toHaveText(FACTS_SENTENCE);
  await persistedDoc(file, d => factOf(d, 'web')?.label === 'Storefront');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Storefront');

  // 6. Simplify names no route: there is no question to answer and the sentence is not shown.
  await page.getByTestId('simplify-overview').click();
  await expect(page.getByTestId('ai-input')).toHaveValue('', { timeout: 90_000 });
  await expect(page.getByTestId('ai-summary')).toBeVisible();
  await expect(route).toHaveCount(0);
  // Must not happen: the story-route instructions having added or removed a fact.
  expect(sorted((await readDocument(file)).facts.components.map(f => f.id))).toEqual(['api', 'db', 'web']);
});
