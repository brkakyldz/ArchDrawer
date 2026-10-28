import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { drawingRepo, shopDoc, openDrawing, openAi, send, startedRun, turn, turnEnds, stored, viewOf, nodeOf, saved, box, drag, PAUSED, ACCEPT_FIRST } from './helpers';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

// Slow enough steps that the first run is still going while the user tries to edit (testing contract, ARCHDRAW_FIXTURE_STEP_MS).
const product = useProduct({ stepMs: 2000 });

// A user asks the AI panel for a change: while it runs their edits pause, the result arrives as a preview with the changed part marked,
// and they undo it (and redo it), then ask for a change to the selected part and accept it, which is one undo step. A run that changes
// nothing shows no preview, and a reload ends a preview as accepted. Every request is a turn of one conversation.
test('H25 [AI-1 AI-2 AI-3 EDIT-4 FILE-1] an instruction pauses edits while it runs, arrives as a preview that Undo and Redo walk, a selected-part change is accepted as one undo step, and a reload accepts a preview @smoke', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('preview', shopDoc('Preview shop'));
  const id = await openDrawing(page, p, file);
  await openAi(page);
  await expect(page.getByTestId('ai-engine')).toHaveValue('fixture');
  await expect(page.getByTestId('ai-engine-note')).toContainText(/Test engine \(no AI\)/);
  await expect(page.getByTestId('ai-scope-view')).toBeChecked();
  await expect(page.getByTestId('ai-send')).toBeDisabled();

  // While it runs: a turn that says so, and every edit refused.
  const first = await send(page, 'add Cache');
  expect(first.sent).toMatchObject({ diagramId: id, choice: 'system', channel: 'overview', view: 'overview', scope: { kind: 'view' }, engine: 'fixture' });
  await expect(page.getByTestId('ai-input')).toHaveValue('');
  await expect(turn(page, first.runId)).toHaveAttribute('data-state', 'running');
  await expect(turn(page, first.runId).getByTestId('ai-turn-where')).toHaveText(/Overview · This view/);
  await expect(page.getByTestId('tool-undo')).toBeDisabled();
  // The undo key is refused with the toast of that state (ui contract, `tool-undo`); a drag moves nothing.
  const webBefore = await box(page.getByTestId('node-web'));
  await page.getByTestId('canvas').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press(UNDO);
  await expect(page.getByTestId('toast')).toHaveText(PAUSED);
  await drag(page, page.getByTestId('node-web'), 0, 90);
  const webAfter = await box(page.getByTestId('node-web'));
  expect([webAfter.x, webAfter.y], 'a drag during a run moves nothing').toEqual([webBefore.x, webBefore.y]);

  // The preview: the new part marked, edits refused until the user chooses, Undo and Redo.
  expect(await turnEnds(page, first.runId)).toBe('preview');
  await expect(page.getByTestId('ai-preview')).toContainText(/1 part added/);
  await expect(page.getByTestId('ai-route')).toHaveAttribute('data-route', 'facts');
  await expect(page.getByTestId('node-cache')).toHaveAttribute('data-changed', 'true');
  await expect(page.getByTestId('node-web')).not.toHaveAttribute('data-changed', 'true');
  await page.getByTestId('canvas').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press(UNDO);
  await expect(page.getByTestId('toast')).toHaveText(ACCEPT_FIRST);
  await expect(page.getByTestId('tool-undo')).toBeDisabled();
  await page.getByTestId('ai-undo').click();
  await expect(page.getByTestId('node-cache')).toHaveCount(0);
  await saved(page);
  await expect.poll(async () => !!nodeOf(viewOf(await stored(p, id), 'overview'), 'cache')).toBe(false);
  await expect(turn(page, first.runId)).toHaveAttribute('data-state', 'undone');
  await page.getByTestId('tool-redo').click();
  await expect(page.getByTestId('node-cache')).toBeVisible();
  await saved(page);
  await expect.poll(async () => (await stored(p, id)).choices[0].facts.components.some((f: any) => f.id === 'cache')).toBe(true);

  // A change to the selected part, accepted: one undo step back to before the run.
  await page.getByTestId('node-db').getByTestId('node-label').click();
  await page.getByTestId('callout-ask').click();
  await expect(page.getByTestId('ai-scope-selection')).toBeChecked();
  await expect(page.getByTestId('ai-input')).toBeFocused();
  const second = await send(page, 'rename Orders DB to Order store');
  expect(second.sent.scope).toEqual({ kind: 'parts', ids: ['db'] });
  expect(await turnEnds(page, second.runId)).toBe('preview');
  await page.getByTestId('ai-accept').click();
  await expect(turn(page, second.runId)).toHaveAttribute('data-state', 'accepted');
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store');
  await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Orders DB');
  await expect(page.getByTestId('node-cache'), 'one step back, not two').toBeVisible();
  await saved(page);

  // Nothing changed: no preview. The conversation holds every turn, oldest first.
  const third = await send(page, 'Make it nicer');
  expect(await turnEnds(page, third.runId)).toBe('unchanged');
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await expect(page.getByTestId('ai-thread').getByTestId('ai-turn')).toHaveCount(3);
  await expect(page.getByTestId('ai-thread').getByTestId('ai-turn').first().getByTestId('ai-turn-text')).toHaveText('add Cache');

  // A failed run is a turn too: its error, the instruction back in the field, and Try again as a new turn.
  const failing = await send(page, 'add Broken [fixture:fail]');
  expect(await turnEnds(page, failing.runId)).toBe('failed');
  await expect(page.getByTestId('ai-error')).toContainText(/Fixture failure requested/);
  await expect(page.getByTestId('ai-input')).toHaveValue('add Broken [fixture:fail]');
  const retried = await startedRun(page, () => page.getByTestId('ai-retry').click());
  expect(retried.sent.instruction).toBe('add Broken [fixture:fail]');
  expect(await turnEnds(page, retried.runId)).toBe('failed');
  await expect(page.getByTestId('ai-thread').getByTestId('ai-turn')).toHaveCount(5);
  expect((await stored(p, id)).choices[0].facts.components.some((f: any) => f.id === 'broken'), 'a failed run writes nothing').toBe(false);
  await page.getByTestId('ai-input').fill('');

  // A reload ends a preview as accepted: the file holds the result and the conversation starts empty.
  const fourth = await send(page, 'add Queue');
  expect(await turnEnds(page, fourth.runId)).toBe('preview');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await expect(page.getByTestId('node-queue')).toBeVisible();
  await openAi(page);
  await expect(page.getByTestId('ai-thread').getByTestId('ai-turn')).toHaveCount(0);
  expect((await stored(p, id)).choices[0].facts.components.some((f: any) => f.id === 'queue')).toBe(true);
});
