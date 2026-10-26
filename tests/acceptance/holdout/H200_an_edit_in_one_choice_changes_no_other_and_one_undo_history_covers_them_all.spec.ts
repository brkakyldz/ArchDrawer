import { test, expect } from '@playwright/test';
import { fourChoices, workspace4, openFourChoices, readRaw, persistedRaw, where, dragBy, nodeBox, type Doc4, type Choice4 } from './helpers-selections';
import { saved, emptyCanvasPoint, canvasClick } from './helpers';

const choice = (doc: Doc4, id: string): Choice4 => doc.choices.find(c => c.id === id)!;
const others = (doc: Doc4, ...ids: string[]) => doc.choices.filter(c => !ids.includes(c.id));
const labelOf = (doc: Doc4, choiceId: string, fact: string) => choice(doc, choiceId).facts.components.find(f => f.id === fact)?.label;
const partX = (doc: Doc4, choiceId: string, view: string, id: string) => choice(doc, choiceId).channels.overview.views!.find(v => v.id === view)!.nodes.find(n => n.id === id)!.x;

// FILE-2, FILE-3, EDIT-1 (diagram contract, *Edits: facts or channel*; ui contract, *Choices and the views panel*): an edit is made in one
// choice and changes only that choice, its facts and its channels; `outdated` marks only channels of the same choice; the editor's
// undo history is one history over every choice. Two choices hold a fact with the same id `api` and the same label to show the edit
// does not leak: renaming it in the section leaves the whole system's.
test('H200 [FILE-2 FILE-3 EDIT-1 NAV-2 #182 #185] a move, a rename, a new part and the steps switch in one choice change that choice alone, the other choices stay byte for byte and unmarked, and undo walks back through the edits of every choice', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { file } = await workspace4('f4-edit', fourChoices('Edit four'));
  await openFourChoices(page, request, file);
  const initial = await readRaw(file) as Doc4; // as the server normalised it on opening
  const editor = page.getByTestId('editor');
  expect(await where(page)).toMatchObject({ choice: 'checkout' });

  // 1. Appearance in the first choice: a part moves (one with an inside: a drag moves it and opens nothing). Only its place in that
  //    choice's overview changes.
  const cartX = partX(initial, 'checkout', 'checkout-overview', 'charge')!;
  const cartBox = await nodeBox(page, 'charge');
  await dragBy(page, page.getByTestId('node-charge'), 240, 0); await saved(page);
  await persistedRaw(file, d => (partX(d, 'checkout', 'checkout-overview', 'charge') ?? cartX) !== cartX);
  const moved = await readRaw(file) as Doc4;
  expect(partX(moved, 'checkout', 'checkout-overview', 'charge')).toBeGreaterThan(cartX + 100);
  expect((await nodeBox(page, 'charge')).x).toBeGreaterThan(cartBox.x + 40);
  expect(await where(page), 'a drag opens nothing').toEqual({ choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  expect(choice(moved, 'checkout').facts, 'a move is appearance: the facts are as they were').toEqual(choice(initial, 'checkout').facts);
  expect(others(moved, 'checkout'), 'the other three choices are as they were').toEqual(others(initial, 'checkout'));

  // 2. Content in another choice: renaming the section's `api` in its overview changes that fact and no other choice's.
  await page.getByTestId('views-entry-server-overview').click();
  expect(await where(page)).toEqual({ choice: 'server', channel: 'overview', view: 'server-overview' });
  await page.getByTestId('node-api').getByTestId('node-label').dblclick(); await page.getByTestId('node-label-input').fill('Order gateway'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await persistedRaw(file, d => labelOf(d, 'server', 'api') === 'Order gateway');
  const renamed = await readRaw(file) as Doc4;
  expect(labelOf(renamed, 'server', 'api')).toBe('Order gateway'); expect(labelOf(renamed, 'system', 'api'), 'the same fact id in another choice keeps its name').toBe('Order API');
  expect(others(renamed, 'server'), 'no other choice changed').toEqual(others(moved, 'server'));
  expect(choice(renamed, 'server').channels.overview.outdated ?? []).toEqual([]);
  // The section's LinkedIn post shows the new name through the fact and is not marked; the whole system's post is untouched.
  await page.getByTestId('channel-tab-linkedin').click();
  expect(await where(page)).toEqual({ choice: 'server', channel: 'linkedin', view: 'server-linkedin' });
  await expect(page.getByTestId('node-entry').getByTestId('node-label')).toHaveText('Order gateway'); await expect(page.getByTestId('channel-tab-linkedin')).not.toHaveAttribute('data-outdated', /.+/);
  await page.getByTestId('views-entry-overview').click();
  expect(await where(page)).toMatchObject({ choice: 'system', channel: 'overview', view: 'overview' });
  await page.getByTestId('channel-tab-linkedin').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'linkedin', view: 'system-linkedin' });
  await expect(page.getByTestId('node-core').getByTestId('node-label')).toHaveText('Order API');

  // 3. A new part in the section is a new fact there: the section's LinkedIn tab is marked, no other choice's is.
  await page.getByTestId('views-entry-server-overview').click();
  await page.getByTestId('tool-component').click();
  const point = await emptyCanvasPoint(page); await canvasClick(page, point.x, point.y);
  await page.getByTestId('picker-kind-data').click(); await page.getByTestId('picker-add').click();
  await expect(page.getByTestId('node-label-input')).toHaveValue('New component');
  await page.getByTestId('node-label-input').fill('Cache'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await persistedRaw(file, d => choice(d, 'server').facts.components.some(f => f.label === 'Cache'));
  const added = await readRaw(file) as Doc4;
  expect(choice(added, 'server').facts.components.map(f => f.label)).toEqual(['Order gateway', 'Order store', 'Cache']);
  expect(choice(added, 'server').channels.linkedin!.outdated).toHaveLength(1);
  expect(others(added, 'server'), 'no other choice changed, and none is marked').toEqual(others(renamed, 'server'));
  expect(choice(added, 'system').channels.linkedin!.outdated ?? []).toEqual([]);
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('data-outdated', '1');
  await page.getByTestId('views-entry-overview').click();
  await expect(page.getByTestId('channel-tab-linkedin')).not.toHaveAttribute('data-outdated', /.+/);

  // 4. The steps switch of a channel is that channel's alone.
  await page.getByTestId('views-entry-server-overview').click();
  await page.getByTestId('tool-steps').click(); await saved(page);
  await persistedRaw(file, d => choice(d, 'server').channels.overview.showSteps === true);
  const stepped = await readRaw(file) as Doc4;
  expect(choice(stepped, 'system').channels.overview.showSteps ?? false).toBe(false); expect(choice(stepped, 'checkout').channels.overview.showSteps ?? false).toBe(false);
  expect(others(stepped, 'server')).toEqual(others(added, 'server'));
  await expect(page.getByTestId('step-badge-api-store')).toBeVisible();
  await page.getByTestId('views-entry-overview').click(); await expect(page.getByTestId('tool-steps')).toHaveAttribute('aria-pressed', 'false');

  // 5. One history over every choice: undo walks back through the edits, whichever choice is on screen, and the file follows. Every edit
  //    is one step (ui contract, Undo/redo): the move, the rename, the insertion of the part, the typing of its first name, the switch.
  await expect(page.getByTestId('tool-undo')).toBeEnabled();
  await page.getByTestId('tool-undo').click(); await saved(page);
  await persistedRaw(file, d => choice(d, 'server').channels.overview.showSteps !== true);
  await page.getByTestId('tool-undo').click(); await saved(page);
  await persistedRaw(file, d => !choice(d, 'server').facts.components.some(f => f.label === 'Cache'));
  await page.getByTestId('tool-undo').click(); await saved(page);
  await persistedRaw(file, d => choice(d, 'server').facts.components.length === 2);
  expect(choice(await readRaw(file) as Doc4, 'server').channels.linkedin!.outdated ?? [], 'the mark goes with the edit').toEqual([]);
  await page.getByTestId('tool-undo').click(); await saved(page);
  await persistedRaw(file, d => labelOf(d, 'server', 'api') === 'Order API');
  await page.getByTestId('tool-undo').click(); await saved(page);
  await persistedRaw(file, d => partX(d, 'checkout', 'checkout-overview', 'charge') === cartX);
  const undone = await readRaw(file) as Doc4;
  expect(undone.choices, 'every choice is as it was when the file was opened').toEqual(initial.choices);
  await expect(page.getByTestId('tool-undo')).toBeDisabled();
  // Redo brings the first edit back, in the choice it was made in.
  await page.getByTestId('tool-redo').click(); await saved(page);
  await persistedRaw(file, d => partX(d, 'checkout', 'checkout-overview', 'charge') !== cartX);
  expect(others(await readRaw(file) as Doc4, 'checkout')).toEqual(others(initial, 'checkout'));
  // Must not happen: the file changing format or losing a choice.
  const final = await readRaw(file) as Doc4; expect(final.schema).toBe('archdraw/diagram@4'); expect(final.choices.map(c => c.id)).toEqual(['checkout', 'howto', 'server', 'system']);
  await expect(editor).toBeVisible();
});
