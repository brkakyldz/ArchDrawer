import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRaw, openDrawing, saved, callout, cli, svgInfo, settledReport, editorShape } from './helpers';
import { sketch, fullDetail, nodeSize, sizeIs, cardSize, imageOf, nodeSnaps, openShare, closeShare, advancedOptions, persistedChoice, readChoice, nodeOf, countPuts } from './helpers-drawing';

const ROWS = ['Model call', 'Tool check', 'Shown item', 'Stops after 12 turns'];

// LOOK-3: no part draws a held mechanism, an item or a limit, on the canvas or in an export; the callout lists them (EDIT-2) and is where they are edited.
// A mechanism is held as a row in the callout, never drawn as a part of its own (the README story's held items: H109).
test('H180 [LOOK-3 EDIT-2 SHARE-1 #177] a panel draws no row in the editor or in any image, is as big as a card of its kind, and its callout lists and edits what it holds', async ({ page, request }) => {
  test.setTimeout(60_000);
  const doc = sketch('Rows in the callout', [
    { id: 'agent', kind: 'llm', form: 'panel', label: 'Agent', sub: 'runs the loop', held: ['Model call', 'Tool check'], items: ['Shown item'], limits: ['Stops after 12 turns'], x: 0, y: 0 },
    { id: 'plain', kind: 'llm', label: 'Plain agent', sub: 'runs the loop', x: 400, y: 0 },
    { id: 'old', kind: 'api', form: 'panel', label: 'Old panel', sub: 'intake', items: ['Validate order', 'Create order'], x: 800, y: 0 },
  ]);
  const { dir, file } = await workspaceRaw('rows-callout', doc), opened = await openDrawing(page, request, file);
  const puts = countPuts(page);
  await fullDetail(page);

  // The canvas: no row of any kind, the label and the sub-line, and the size of a card of the kind (the plain agent beside it).
  for (const id of ['agent', 'old']) await expect(page.getByTestId(`node-${id}`).getByTestId('node-item'), `${id} draws no row`).toHaveCount(0);
  const drawnText = (await page.getByTestId('node-agent').textContent()) ?? '';
  expect(drawnText).toContain('Agent'); expect(drawnText).toContain('runs the loop');
  for (const row of ROWS) expect(drawnText, `the canvas does not draw ${row}`).not.toContain(row);
  expect((await page.getByTestId('node-old').textContent()) ?? '').not.toContain('Validate order');
  expect(await editorShape(page, 'agent')).toBe('agent');
  const plainSize = await nodeSize(page, 'plain'), original = await nodeSize(page, 'agent');
  sizeIs(original, cardSize('agent'), 'the panel is a card of its kind'); sizeIs(original, plainSize, 'the panel is as big as the plain agent');
  sizeIs(await nodeSize(page, 'old'), cardSize('port'), 'an old-style panel of an API is a port card');

  // The images draw none either: the readme, the slide and the command's file; the same boxes, no mechanism as a part of its own.
  const out = join(dir, 'rows.svg'), written = await cli(['svg', file, '--format', 'readme', '--out', out]); expect(written.code, written.stderr).toBe(0);
  const images = [await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme'), await imageOf(request, opened.id, 'channel=overview&view=overview&format=slide'), await readFile(out, 'utf8')];
  for (const [i, svg] of images.entries()) {
    const image = await svgInfo(page, svg), agent = image.nodes.find(n => n.id === 'agent')!;
    expect(image.nodes.map(n => n.id).sort(), `image ${i}: only parts of the view`).toEqual(['agent', 'old', 'plain']);
    for (const row of [...ROWS, 'Validate order', 'Create order']) expect(image.nodes.flatMap(n => n.text).join(' | '), `image ${i} does not draw ${row}`).not.toContain(row);
    expect({ width: agent.width, height: agent.height }, `image ${i}: the agent`).toEqual(cardSize('agent'));
    expect({ width: image.nodes.find(n => n.id === 'old')!.width, height: image.nodes.find(n => n.id === 'old')!.height }, `image ${i}: the old panel`).toEqual(cardSize('port'));
  }
  // The share dialog has no switch for rows, and its report cuts no item.
  await openShare(page, 'format-readme'); await advancedOptions(page);
  await expect(page.getByTestId('show-items')).toHaveCount(0); await expect(page.getByTestId('show-sub')).toHaveCount(1);
  expect((await settledReport(page)).cut, 'no item is cut').toBe(0);
  await closeShare(page);

  // The callout lists the rows in the file's order: the held mechanisms, the shown items, the limits.
  const box = await callout(page, 'agent'), rows = box.getByTestId('callout-item');
  await expect(box.getByTestId('callout-items')).toBeVisible();
  const kindsOf = async () => await rows.evaluateAll(els => els.map(e => e.getAttribute('data-row')));
  const textsOf = async (kind: string) => await rows.evaluateAll((els, k) => els.filter(e => e.getAttribute('data-row') === k).map(e => (e.textContent ?? '').trim()), kind);
  expect(await kindsOf()).toEqual(['held', 'held', 'item', 'limit']);
  await expect(rows).toContainText(ROWS);

  // Renaming a held row renames the mechanism; the part keeps its size.
  await rows.first().dblclick(); await page.getByTestId('callout-item-input').fill('Model request'); await page.getByTestId('callout-item-input').press('Enter');
  await persistedChoice(file, d => d.facts.components.find(f => f.id === 'agent-held-1')?.label === 'Model request');
  sizeIs(await nodeSize(page, 'agent'), original, 'after renaming a held row');

  // Removing a held row stops the part holding it. The overview shows or holds every fact, so a mechanism nobody holds any more goes with its row.
  await rows.nth(1).getByTestId('callout-item-remove').click();
  await persistedChoice(file, d => (d.channels.overview.views![0].nodes.find(n => n.id === 'agent')!.held ?? []).length === 1);
  expect(await kindsOf()).toEqual(['held', 'item', 'limit']);

  // Adding a row puts `New item` before the limits; up and down move a row only among the rows of its own kind.
  await box.getByTestId('callout-item-add').click(); await page.getByTestId('callout-item-input').fill('Audit step'); await page.getByTestId('callout-item-input').press('Enter');
  await expect.poll(kindsOf).toEqual(['held', 'item', 'item', 'limit']);
  expect(await textsOf('item')).toEqual(['Shown item', 'Audit step']);
  await rows.nth(2).getByTestId('callout-item-up').click();
  await expect.poll(async () => await textsOf('item')).toEqual(['Audit step', 'Shown item']);
  expect(await kindsOf(), 'a row moves only among its own kind').toEqual(['held', 'item', 'item', 'limit']);
  await expect.poll(async () => (await textsOf('limit'))[0]).toContain('Stops after 12 turns');
  await saved(page);
  sizeIs(await nodeSize(page, 'agent'), original, 'after adding a row: rows change no size');
  await expect(page.getByTestId('node-agent').getByTestId('node-item')).toHaveCount(0);

  // Removing every row makes the part a card.
  for (let i = 0; i < 8 && await rows.count(); i++) await rows.first().getByTestId('callout-item-remove').click();
  await expect(page.getByTestId('node-agent')).toHaveAttribute('data-form', 'card');
  await saved(page);
  sizeIs(await nodeSize(page, 'agent'), original, 'a card of the kind is the same size');

  // Must not happen: a mechanism drawn as a part, a size following the rows, a request to the server other than saves.
  expect(Object.keys(await nodeSnaps(page)).sort()).toEqual(['agent', 'old', 'plain']);
  expect((await readChoice(file)).facts.components.some(f => f.id === 'agent'), 'the agent fact stays').toBe(true);
  expect((await nodeOf(file, 'old')).form).toBe('panel');
  expect(puts.count, 'edits were saved').toBeGreaterThan(0);
});
