import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { workspaceRaw, openDrawing, saved, svgInfo, previewSVG, settledReport, box } from './helpers';
import { sketch, fullDetail, nodeSize, sizeIs, cardSize, imageOf, readChoice, readView, persistedChoice, openShare, closeShare, advancedOptions, countPuts, zoomFactor } from './helpers-drawing';

// LOOK-3: under its label a part shows a one-line sub-line, on by default and switchable per view (`tool-sublines`); SHARE-2: the share image follows the
// view's switch unless its own `show-sub` says otherwise. The switch is appearance: it changes only its channel, and "on" is the field's absence.
test('H181 [LOOK-3 SHARE-1 SHARE-2 FILE-3 #177] the sub-line switch shrinks the parts of one view only, is one undoable saved edit that leaves no field when on, and the share image follows it unless show-sub says otherwise', async ({ page, request }) => {
  test.setTimeout(60_000);
  const doc = sketch('Sub-line switch', [
    { id: 'a', kind: 'service', label: 'Alpha', sub: 'first line', x: 0, y: 0 }, { id: 'b', kind: 'llm', label: 'Beta', sub: 'second line', x: 300, y: 0 },
    { id: 'c', kind: 'data', label: 'Gamma', sub: 'third line', x: 600, y: 0 }, { id: 'e', kind: 'service', form: 'compact', label: 'Epsilon', sub: 'compact line', x: 0, y: 220 },
    { id: 'zone', form: 'group', label: 'Zone', sub: 'zone line', x: 300, y: 220 }, { id: 'd', label: 'Delta', sub: 'child line', parent: 'zone', x: 320, y: 280 },
  ]);
  const view = doc.channels.overview.views![0];
  doc.channels.readme = { showSteps: false, outdated: [], views: [{ ...structuredClone(view), id: 'readme', title: 'README' }] };
  const { file } = await workspaceRaw('sub-switch', doc), opened = await openDrawing(page, request, file);
  const afterOpen = await readFile(file, 'utf8'), factsBefore = (await readChoice(file)).facts;
  const puts = countPuts(page);
  await fullDetail(page);
  const subs = page.getByTestId('canvas').getByTestId('node-sub'), toggle = page.getByTestId('tool-sublines');
  const shapes: [string, string][] = [['a', 'card'], ['b', 'agent'], ['c', 'store']];

  // On by default: every part draws its sub-line, at the card sizes of the contract.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true'); await expect(subs).toHaveCount(6);
  for (const [id, shape] of shapes) sizeIs(await nodeSize(page, id), cardSize(shape), `${id} with its sub-line`);
  const groupBefore = await nodeSize(page, 'zone');

  // Off: no node-sub in the view, a card loses its 18 px row (the plain card is 90 tall), a compact part its sub-line text.
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false'); await expect(subs).toHaveCount(0);
  for (const [id, shape] of shapes) sizeIs(await nodeSize(page, id), cardSize(shape, { subLine: false }), `${id} without its sub-line`);
  expect(cardSize('card', { subLine: false }).height).toBe(90);
  await expect(page.getByTestId('node-e').getByTestId('node-sub')).toHaveCount(0); expect((await nodeSize(page, 'e')).height).toBeCloseTo(46, 0);
  await expect(page.getByTestId('node-head-zone').getByTestId('node-sub')).toHaveCount(0);
  expect((await nodeSize(page, 'zone')).width, 'the group is as wide as its children and header need').toBeGreaterThan(0);
  await page.getByTestId('node-a').getByTestId('node-label').dblclick(); await expect(page.getByTestId('node-label-input')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('node-label-input')).toHaveCount(0);
  // Just below the label, where the sub-line row was: with the view's sub-lines off there is none to edit (ui contract, Callout: "a sub-line → node-sub-input").
  const label = await box(page.getByTestId('node-a').getByTestId('node-label')), part = await box(page.getByTestId('node-a')), zoom = await zoomFactor(page);
  const below = { x: label.x + label.width / 2, y: label.y + label.height + 9 * zoom };
  expect(below.y, 'the point is on the part').toBeLessThan(part.y + part.height);
  await page.mouse.dblclick(below.x, below.y);
  await page.waitForTimeout(300); // a short sleep: it proves that no input opens
  await expect(page.getByTestId('node-sub-input'), 'there is no sub-line to edit').toHaveCount(0); await page.keyboard.press('Escape');

  // One undoable edit: undo brings the sub-lines and the sizes back, redo takes them away again.
  await page.getByTestId('tool-undo').click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true'); await expect(subs).toHaveCount(6);
  sizeIs(await nodeSize(page, 'a'), cardSize('card'), 'undo'); sizeIs(await nodeSize(page, 'zone'), groupBefore, 'undo, the group');
  await page.getByTestId('tool-redo').click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false'); await expect(subs).toHaveCount(0);
  await saved(page);
  await persistedChoice(file, d => (d.channels.overview.views![0] as { subLines?: boolean }).subLines === false);
  const stored = await readChoice(file);
  expect(JSON.stringify(stored.facts), 'the facts are unchanged').toBe(JSON.stringify(factsBefore));
  expect('subLines' in stored.channels.readme!.views![0], 'the README keeps its own switch').toBe(false);

  // Another channel has its own switch.
  await page.getByTestId('channel-tab-readme').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'readme');
  await expect(page.getByTestId('tool-sublines')).toHaveAttribute('aria-pressed', 'true'); await expect(subs).toHaveCount(6);
  await page.getByTestId('channel-tab-overview').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'overview');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // The share dialog starts show-sub as the view's switch in every format; toggling it changes the preview only.
  const savesBefore = puts.count;
  await openShare(page, 'format-readme'); await advancedOptions(page);
  for (const format of ['format-feed', 'format-readme', 'format-slide', 'format-square'] as const) {
    await page.getByTestId(format).click(); await expect(page.getByTestId('show-sub'), format).not.toBeChecked();
  }
  await page.getByTestId('format-readme').click();
  const heightOf = async (id: string) => (await svgInfo(page, await previewSVG(page))).nodes.find(n => n.id === id)!.height;
  expect(await heightOf('a')).toBe(cardSize('card', { subLine: false }).height);
  await page.getByTestId('show-sub').check();
  await expect.poll(() => heightOf('a')).toBe(cardSize('card').height);
  const withSub = await svgInfo(page, await previewSVG(page));
  expect(withSub.nodes.find(n => n.id === 'a')!.text.join(' ')).toContain('first line');
  await settledReport(page);
  expect(await page.getByTestId('readability').textContent(), 'no suggestion about rows').not.toMatch(/what each part holds|held/i);
  await page.getByTestId('show-sub').uncheck(); await expect.poll(() => heightOf('a')).toBe(cardSize('card', { subLine: false }).height);
  await closeShare(page);
  expect(puts.count, 'the dialog saves nothing').toBe(savesBefore);

  // The export follows the view: no sub-line text, every card at the no-sub-line height.
  const exported = await svgInfo(page, await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme'));
  for (const [id, shape] of shapes) expect(exported.nodes.find(n => n.id === id)!.height, `export ${id}`).toBe(cardSize(shape, { subLine: false }).height);
  for (const sub of ['first line', 'second line', 'third line', 'compact line', 'zone line', 'child line']) expect(exported.nodes.flatMap(n => n.text).join(' | '), sub).not.toContain(sub);
  const readmeExport = await svgInfo(page, await imageOf(request, opened.id, 'channel=readme&view=readme&format=readme'));
  expect(readmeExport.nodes.find(n => n.id === 'a')!.height, 'the README channel still draws its sub-lines').toBe(cardSize('card').height);

  // Turning it on again removes the field from the file.
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true'); await expect(subs).toHaveCount(6); await saved(page);
  await persistedChoice(file, d => !('subLines' in d.channels.overview.views![0]));
  sizeIs(await nodeSize(page, 'a'), cardSize('card'), 'on again');

  // Must not happen: `subLines: true` in the file, the facts or the README changing, a reload rewriting a file that was merely opened.
  const raw = await readFile(file, 'utf8');
  expect(raw).not.toMatch(/"subLines"\s*:\s*true/);
  expect(JSON.stringify((await readView(file, 'readme'))), 'the README view is as it was').toBe(JSON.stringify(stored.channels.readme!.views![0]));
  expect(JSON.stringify((await readChoice(file)).facts)).toBe(JSON.stringify(factsBefore));
  expect(afterOpen.includes('subLines')).toBe(false);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('Saved');
  expect(await readFile(file, 'utf8'), 'reloading changes nothing').toBe(raw);
});
