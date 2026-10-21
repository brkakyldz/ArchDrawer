import { test, expect } from '@playwright/test';
import { agent3, withReadme, withPresentation, workspaceRaw, openDrawing, readDocument, persistedDoc, saved, callout, viewOf, partOf, outdatedOf, stepIds,
  channelNames, type Doc3, type Step } from './helpers';

const STEPS: Step[] = [
  { id: 's1', parts: ['app'], text: 'A request starts', note: 'Say who asks.' },
  { id: 's2', parts: ['agent', 'store'], text: 'The agent works and keeps state', note: 'Two parts at once.' },
  { id: 's3', parts: ['store'], text: 'The state is kept', note: '' },
];
const stepsOf = async (file: string) => (await readDocument(file)).channels.presentation?.steps ?? [];
const idsOf = async (file: string) => (await stepsOf(file)).map(s => s.id);

// Steps are appearance: every edit of them is one undoable step, saved like any edit, and changes only the presentation
// channel. A part of the presentation drawing that a step names can still be deleted: the steps follow it.
test('H127 [STORY-4, FILE-3, EDIT-1, NAV-2] editing the text, note, parts and order of steps, adding and removing one, are each undoable and touch only the presentation, and deleting a part a step names takes it out of the steps with a warning', async ({ page, request }) => {
  test.setTimeout(240_000);
  const doc: Doc3 = withPresentation(withReadme(agent3('Steps agent')), { steps: STEPS.map(s => structuredClone(s)) });
  const { file } = await workspaceRaw('step-edit', doc);
  await openDrawing(page, request, file);
  const base = await readDocument(file);
  const items = page.getByTestId('step-item');
  await page.getByTestId('channel-tab-presentation').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'presentation'); await expect(page.getByTestId('steps-panel')).toBeVisible();
  expect(await stepIds(page)).toEqual(['s1', 's2', 's3']);
  // Only the presentation changes in any of this: the facts, the other channels and every view are compared at the end.
  const untouched = async () => {
    const now = await readDocument(file);
    expect(now.facts).toEqual(base.facts); expect(now.channels.overview).toEqual(base.channels.overview); expect(now.channels.readme).toEqual(base.channels.readme);
    for (const channel of channelNames) expect(outdatedOf(now, channel), channel).toEqual([]);
    return now;
  };

  // Text and note of the current step: each field an edit of its own, each undone on its own.
  await items.nth(1).click();
  await expect(page.getByTestId('step-text')).toHaveAttribute('maxlength', '120'); await expect(page.getByTestId('step-note')).toHaveAttribute('maxlength', '1000');
  await page.getByTestId('step-text').fill('The agent decides'); await saved(page);
  await persistedDoc(file, d => d.channels.presentation!.steps![1].text === 'The agent decides');
  await page.waitForTimeout(1000); // a new field is a new undo step, not part of the last one
  await page.getByTestId('step-note').fill('Say: the loop asks, checks, runs.\nThen it repeats.'); await saved(page);
  await persistedDoc(file, d => d.channels.presentation!.steps![1].note === 'Say: the loop asks, checks, runs.\nThen it repeats.');
  let now = await untouched();
  expect(now.channels.presentation!.steps![1]).toMatchObject({ id: 's2', parts: ['agent', 'store'], text: 'The agent decides' });
  expect(viewOf(now, 'presentation')).toEqual(viewOf(base, 'presentation')); // steps are not the view
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => d.channels.presentation!.steps![1].note === 'Two parts at once.');
  expect((await stepsOf(file))[1].text).toBe('The agent decides');
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => d.channels.presentation!.steps![1].text === 'The agent works and keeps state');
  await page.getByTestId('tool-redo').click(); await page.getByTestId('tool-redo').click();
  await persistedDoc(file, d => d.channels.presentation!.steps![1].note.startsWith('Say: the loop'));
  await expect(page.getByTestId('step-text')).toHaveValue('The agent decides');

  // Add a step after the current one, holding the selected part; it starts as `New step` with an empty note.
  await page.getByTestId('node-app').getByTestId('node-label').click(); // selects the part (and opens its callout); the current step stays
  await page.getByTestId('step-add').click();
  await persistedDoc(file, d => d.channels.presentation!.steps!.length === 4);
  now = await untouched(); const added = now.channels.presentation!.steps![2];
  expect(now.channels.presentation!.steps!.map(s => s.id).filter(id => !['s1', 's2', 's3'].includes(id))).toEqual([added.id]);
  expect(added).toMatchObject({ text: 'New step', note: '', parts: ['app'] }); expect((await idsOf(file))).toEqual(['s1', 's2', added.id, 's3']);
  await expect(items).toHaveCount(4);
  await page.getByTestId('tool-undo').click(); await persistedDoc(file, d => d.channels.presentation!.steps!.length === 3);
  await page.getByTestId('tool-redo').click(); await persistedDoc(file, d => d.channels.presentation!.steps!.length === 4);

  // The parts of the current step: tick another, and the last one cannot be unticked.
  await page.locator(`[data-testid="step-item"][data-step-id="${added.id}"]`).click();
  const boxes = page.getByTestId('step-parts').getByRole('checkbox');
  await expect(boxes).toHaveCount(3); await expect(page.getByTestId('step-parts').getByRole('checkbox', { name: 'App' })).toBeChecked();
  await page.getByTestId('step-parts').getByRole('checkbox', { name: 'Store' }).check();
  await persistedDoc(file, d => d.channels.presentation!.steps![2].parts.length === 2);
  expect([...(await stepsOf(file))[2].parts].sort()).toEqual(['app', 'store']);
  await page.getByTestId('step-parts').getByRole('checkbox', { name: 'App' }).uncheck();
  await persistedDoc(file, d => d.channels.presentation!.steps![2].parts.join() === 'store');
  await page.getByTestId('step-parts').getByRole('checkbox', { name: 'Store' }).click(); // the last one: refused, so the box stays checked
  await expect(page.getByTestId('toast')).toHaveText('A step highlights at least one part');
  await expect(page.getByTestId('step-parts').getByRole('checkbox', { name: 'Store' })).toBeChecked();
  expect((await stepsOf(file))[2].parts).toEqual(['store']);
  await page.getByTestId('tool-undo').click(); await persistedDoc(file, d => d.channels.presentation!.steps![2].parts.length === 2); // the unticking of App is undone
  await untouched();

  // Order: up and down move the current step one place each, undoably.
  await page.getByTestId('step-up').click();
  await expect.poll(() => idsOf(file)).toEqual(['s1', added.id, 's2', 's3']);
  await page.getByTestId('step-down').click(); await page.getByTestId('step-down').click();
  await expect.poll(() => idsOf(file)).toEqual(['s1', 's2', 's3', added.id]);
  expect(await stepIds(page)).toEqual(['s1', 's2', 's3', added.id]);
  await page.getByTestId('tool-undo').click(); await expect.poll(() => idsOf(file)).toEqual(['s1', 's2', added.id, 's3']);
  await untouched();

  // Remove the added step: gone from the panel and the file, and back with one undo.
  await page.locator(`[data-testid="step-item"][data-step-id="${added.id}"]`).click();
  await page.getByTestId('step-remove').click();
  await expect.poll(() => idsOf(file)).toEqual(['s1', 's2', 's3']); await expect(items).toHaveCount(3);
  await page.getByTestId('tool-undo').click(); await expect.poll(() => idsOf(file)).toEqual(['s1', 's2', added.id, 's3']);
  await page.getByTestId('tool-redo').click(); await expect.poll(() => idsOf(file)).toEqual(['s1', 's2', 's3']);
  expect((await stepsOf(file)).map(s => [s.id, s.text, s.note])).toEqual(STEPS.map(s => [s.id, s.id === 's2' ? 'The agent decides' : s.text, s.id === 's2' ? 'Say: the loop asks, checks, runs.\nThen it repeats.' : s.note]));
  await untouched();

  // Delete the part two steps name: `store` leaves the presentation drawing only, `s2` keeps `agent`, `s3` has no part left and goes.
  await page.keyboard.press('Escape');
  await (await callout(page, 'store')).getByTestId('callout-delete').click(); await saved(page);
  await persistedDoc(file, d => !partOf(d, 'presentation', 'store'));
  const gone = await readDocument(file);
  expect(gone.channels.presentation!.steps!.map(s => [s.id, s.parts])).toEqual([['s1', ['app']], ['s2', ['agent']]]);
  expect(gone.warnings).toContain('Step "s3" had no part left and was removed');
  await expect(page.getByTestId('warnings')).toContainText('Step "s3" had no part left and was removed');
  expect(await stepIds(page)).toEqual(['s1', 's2']);
  expect(gone.facts).toEqual(base.facts); expect(partOf(gone, 'overview', 'store')).toBeTruthy(); expect(partOf(gone, 'readme', 'store')).toBeTruthy(); // channel only
  for (const channel of channelNames) expect(outdatedOf(gone, channel), channel).toEqual([]);
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => !!partOf(d, 'presentation', 'store'));
  expect((await stepsOf(file)).map(s => [s.id, s.parts])).toEqual([['s1', ['app']], ['s2', ['agent', 'store']], ['s3', ['store']]]);
  await expect(items).toHaveCount(3);
});
