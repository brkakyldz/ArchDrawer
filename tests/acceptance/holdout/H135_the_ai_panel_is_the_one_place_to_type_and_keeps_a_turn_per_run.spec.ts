import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, factOf, viewOf, startedRun, runDone, acceptPreview, openAiPanel, aiTurn, aiTurns, turnStates, turnTexts, FACTS_ROUTE } from './helpers';

const ASK_BOX = ['ask-input', 'ask-send', 'ask-expand', 'ask-status', 'ask-cancel', 'ask-error', 'ask-retry', 'ask-saved'];
const NOTE = 'Test engine (no AI): it understands only add, remove, rename, hold, move and align, gives a canned post, a canned simplification and a canned second look, and changes nothing else';

// AI-2: one place to type, shown as a conversation. One turn per run started on the open drawing, whichever control started
// it, with the instruction (or the control's name) and where it ran; the latest turn holds the progress and the result, an
// earlier one keeps its result; the conversation lives in the browser only.
test('H135 [AI-2, AI-1, FILE-1] the AI panel is the one place to type, a line break is Shift+Enter, every run from the panel or from a channel control makes one turn with its text and where, and a reload starts the thread empty', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('thread', withLinkedIn(shop3('Thread shop')));
  const posts: Record<string, any>[] = [];
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') posts.push(req.postDataJSON()); });
  await openDrawing(page, request, file);
  const before = await readDocument(file);

  // The ask box is gone; the panel is closed when the drawing opens and `ai-button` opens it.
  for (const id of ASK_BOX) await expect(page.getByTestId(id), id).toHaveCount(0);
  await expect(page.getByTestId('ai-panel')).toBeHidden(); await expect(page.getByTestId('ai-button')).toHaveAccessibleName('Ask AI');
  await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-panel')).toBeVisible();
  for (const id of ASK_BOX) await expect(page.getByTestId(id), `${id} with the panel open`).toHaveCount(0);
  await expect(page.getByTestId('ai-thread')).toHaveCount(1); await expect(aiTurns(page)).toHaveCount(0); await expect(page.getByTestId('ai-suggestions')).toHaveCount(1);
  await expect(page.getByTestId('ai-input')).toHaveAttribute('placeholder', 'Ask the test engine (no AI) to change this drawing');
  await expect(page.getByTestId('ai-engine-note')).toHaveText(NOTE); await expect(page.getByTestId('ai-send')).toBeDisabled();

  // Shift+Enter is a line break and sends nothing; Enter sends, and the input is cleared as the run starts.
  await page.getByTestId('ai-input').click(); await page.keyboard.type('add Cache component'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Keep the rest as it is.');
  await expect(page.getByTestId('ai-input')).toHaveValue('add Cache component\nKeep the rest as it is.'); await expect(page.getByTestId('ai-send')).toBeEnabled();
  expect(posts, 'Shift+Enter starts no run').toEqual([]); await expect(aiTurns(page)).toHaveCount(0);
  const first = await startedRun(page, () => page.keyboard.press('Enter'));
  expect(first.body).toMatchObject({ instruction: 'add Cache component\nKeep the rest as it is.', engine: 'fixture', scope: { kind: 'view' } });
  await expect(page.getByTestId('ai-input')).toHaveValue('');

  // The latest turn: its text and where, while it runs the progress and Cancel, then the summary, the route and the report.
  const one = aiTurn(page, first.runId);
  await expect(aiTurns(page)).toHaveCount(1); await expect(one).toHaveCount(1);
  await expect(one.getByTestId('ai-turn-text')).toContainText('add Cache component'); await expect(one.getByTestId('ai-turn-text')).toContainText('Keep the rest as it is.');
  await expect(one.getByTestId('ai-turn-where')).toHaveText('Overview · This view');
  await expect(page.getByTestId('ai-progress')).toBeVisible(); await expect(page.getByTestId('ai-cancel')).toBeVisible(); await expect(page.getByTestId('ai-send')).toBeDisabled();
  expect(await runDone(page, first.runId)).toBe('preview');
  await expect(page.getByTestId('ai-progress')).toHaveCount(0);
  await expect(page.getByTestId('ai-summary')).toContainText(/\badd(?:ed)?\b/i); await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-added', '1');
  await expect(page.getByTestId('ai-route')).toHaveAttribute('data-route', 'facts'); await expect(page.getByTestId('ai-route')).toHaveText(FACTS_ROUTE);
  await expect(page.getByTestId('layout-report')).toBeVisible(); await expect(page.getByTestId('node-cache')).toBeVisible();
  await acceptPreview(page); await expect(one).toHaveAttribute('data-state', 'accepted');

  // A channel control makes a turn named after the control: Draw it on the empty README tab.
  await page.getByTestId('channel-tab-readme').click();
  await expect(page.getByTestId('channel-empty')).toContainText('The README drawing is not drawn yet');
  const second = await startedRun(page, () => page.getByTestId('channel-draw').click());
  expect(second.body).toMatchObject({ kind: 'story', channel: 'readme', readCode: false });
  expect(await runDone(page, second.runId)).toBe('preview');
  const two = aiTurn(page, second.runId);
  await expect(aiTurns(page)).toHaveCount(2);
  await expect(two.getByTestId('ai-turn-text')).toHaveText('Draw it'); await expect(two.getByTestId('ai-turn-where')).toHaveText(/^README · \S/);
  // Only the latest turn holds the summary; the first one keeps its result as `ai-turn-result`. A story names no route.
  await expect(page.getByTestId('ai-summary')).toHaveCount(1); await expect(aiTurns(page).first().getByTestId('ai-summary')).toHaveCount(0);
  await expect(page.getByTestId('ai-route')).toHaveCount(0);
  await expect(aiTurns(page).first().getByTestId('ai-turn-result')).toContainText(/\badd(?:ed)?\b/i);
  await expect(aiTurns(page).first().getByTestId('ai-turn-text')).toContainText('add Cache component'); await expect(aiTurns(page).first()).toHaveAttribute('data-state', 'accepted');
  await acceptPreview(page);

  // The LinkedIn panel's Rewrite it in plain words is a turn of its own, on the LinkedIn channel.
  await page.getByTestId('channel-tab-linkedin').click(); await expect(page.getByTestId('linkedin-panel')).toBeVisible();
  const third = await startedRun(page, () => page.getByTestId('explain-feed').click());
  expect(third.body).toMatchObject({ kind: 'post' }); expect(third.body.instruction).toMatch(/^Rewrite this post in plain words/);
  expect(await runDone(page, third.runId)).toBe('preview');
  const three = aiTurn(page, third.runId);
  await expect(three.getByTestId('ai-turn-text')).toHaveText('Rewrite it in plain words'); await expect(three.getByTestId('ai-turn-where')).toHaveText(/^LinkedIn · \S/);
  await expect(page.getByTestId('ai-route')).toHaveCount(0);
  await acceptPreview(page);

  // The thread: three turns, oldest first, each with its final state; closing the panel does not empty it.
  expect(await turnStates(page)).toEqual(['accepted', 'accepted', 'accepted']);
  const texts = await turnTexts(page); expect(texts[0]).toContain('add Cache component'); expect(texts.slice(1)).toEqual(['Draw it', 'Rewrite it in plain words']);
  await page.getByTestId('ai-close').click(); await expect(page.getByTestId('ai-panel')).toBeHidden();
  await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(3);
  expect(posts).toHaveLength(3);

  // The file holds the three results and no conversation; a reload starts the thread empty and the results stay.
  const stored = await readDocument(file);
  expect(factOf(stored, 'cache')).toBeTruthy(); expect(viewOf(stored, 'readme')).toBeTruthy(); expect(viewOf(stored, 'linkedin')!.nodes.map(n => n.id)).toContain('zone-runtime');
  expect(stored.facts.components.length).toBe(before.facts.components.length + 1);
  expect(JSON.stringify(stored)).not.toMatch(/"(?:turns?|thread|conversation)"\s*:/); expect(stored.requests ?? []).toEqual([]);
  await page.reload(); await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('ai-panel')).toBeHidden(); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await openAiPanel(page); await expect(aiTurns(page)).toHaveCount(0); await expect(page.getByTestId('ai-input')).toHaveValue('');
  expect(await readDocument(file)).toEqual(stored);
});
