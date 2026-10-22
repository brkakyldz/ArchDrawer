import { test, expect } from '@playwright/test';
import { shop3, workspaceRaw, openDrawing, persistedDoc, saved, box, canvasClick, emptyCanvasPoint, callout, editorShape, thumbShapes, factOf, type Doc3 } from './helpers';
import { ALL_KINDS, SHAPES, SHAPE_BY_KIND, cardSize, compactHeight, fullDetail, nodeSize, sizeIs, readChoice, persistedChoice } from './helpers-drawing';

const factIn = (doc: Doc3, id: string) => factOf(doc, id);

// LOOK-2 in the places a user chooses a kind: the component picker draws each form button (card, compact, panel) in the chosen kind's shape, an added
// part is drawn in it, and changing the kind in the callout changes the outline and, with it, the size the shape needs (diagram contract, Shapes) while the
// part keeps its place and its text (EDIT-1); undo and redo bring the old outline and size and the new ones back.
test('H132 [LOOK-2 EDIT-1 FILE-1 #177] the picker draws its form buttons in the shape of the chosen kind, an added part wears it, and changing the kind in the callout changes the outline and the size the shape needs, not the place', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { file } = await workspaceRaw('kind-shapes', shop3('Kind shape shop')); await openDrawing(page, request, file);
  await fullDetail(page);
  const shapeIs = async (id: string, shape: string) => await expect.poll(() => editorShape(page, id), { message: `shape of ${id}` }).toBe(shape);
  const kindMenu = async (id: string, kind: string) => {
    await (await callout(page, id)).getByTestId('callout-kind').click(); await page.getByTestId(`kind-option-${kind}`).click();
    await expect(page.getByTestId(`node-${id}`)).toHaveAttribute('data-kind', kind);
  };
  const addFromPicker = async (kind: string, form: string, label: string, id: string) => {
    await page.keyboard.press('Escape'); await page.getByTestId('tool-component').click();
    const spot = await emptyCanvasPoint(page); await canvasClick(page, spot.x, spot.y);
    await expect(page.getByTestId('component-picker')).toBeVisible();
    await page.getByTestId(`picker-kind-${kind}`).click(); await page.getByTestId(`picker-form-${form}`).click();
    await page.getByTestId('picker-add').click(); await page.getByTestId('node-label-input').fill(label); await page.getByTestId('node-label-input').press('Enter');
    await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  };

  // The drawing's own parts wear their kind's outline whatever their form: a store, a window, and an API panel is a port, not a plain card.
  expect(await editorShape(page, 'db')).toBe('store'); expect(await editorShape(page, 'web')).toBe('window'); expect(await editorShape(page, 'api')).toBe('port');

  // The picker: every kind's button, for the card, the compact and the panel form, is drawn in that kind's shape and in no other.
  await page.getByTestId('tool-component').click();
  const point = await emptyCanvasPoint(page); await canvasClick(page, point.x, point.y);
  await expect(page.getByTestId('component-picker')).toBeVisible();
  for (const kind of ALL_KINDS) {
    const shape = SHAPE_BY_KIND[kind];
    await page.getByTestId(`picker-kind-${kind}`).click();
    for (const form of ['card', 'compact', 'panel']) {
      await expect.poll(async () => (await thumbShapes(page, form)).includes(shape), { message: `${kind}: the ${form} button shows ${shape}` }).toBe(true);
      const shown = await thumbShapes(page, form);
      for (const other of SHAPES.filter(s => s !== shape)) expect(shown, `${kind}: the ${form} button is not drawn as ${other}`).not.toContain(other);
    }
  }
  expect(await thumbShapes(page, 'group'), 'the group button is drawn as a group').toContain('group');
  await page.getByTestId('picker-kind-service').click(); await page.getByTestId('picker-form-card').click();
  await page.getByTestId('picker-add').click(); await page.getByTestId('node-label-input').fill('Probe card'); await page.getByTestId('node-label-input').press('Enter');
  await persistedChoice(file, d => factIn(d, 'new-component')?.label === 'Probe card');
  await shapeIs('new-component', 'card');

  // Changing the kind in the callout changes the outline and the size the shape needs, whichever way round, and keeps the part where it was.
  const at = await box(page.getByTestId('node-new-component'));
  sizeIs(await nodeSize(page, 'new-component'), cardSize('card'), 'the plain card');
  for (const kind of ALL_KINDS) {
    await kindMenu('new-component', kind); await shapeIs('new-component', SHAPE_BY_KIND[kind]);
    sizeIs(await nodeSize(page, 'new-component'), cardSize(SHAPE_BY_KIND[kind]), `the ${kind} card`);
    const now = await box(page.getByTestId('node-new-component'));
    expect(Math.abs(now.x - at.x) + Math.abs(now.y - at.y), `${kind}: the part's top-left stays where it was`).toBeLessThanOrEqual(1.5);
  }
  await kindMenu('new-component', 'service'); await shapeIs('new-component', 'card');
  await persistedChoice(file, d => factIn(d, 'new-component')?.kind === 'service');

  // The outline and the size follow undo and redo of the kind change, and the file follows it.
  await kindMenu('new-component', 'data'); await shapeIs('new-component', 'store');
  sizeIs(await nodeSize(page, 'new-component'), cardSize('store'), 'the store');
  await persistedChoice(file, d => factIn(d, 'new-component')?.kind === 'data');
  await page.getByTestId('tool-undo').click(); await shapeIs('new-component', 'card'); sizeIs(await nodeSize(page, 'new-component'), cardSize('card'), 'after undo');
  await persistedChoice(file, d => factIn(d, 'new-component')?.kind === 'service');
  await page.getByTestId('tool-redo').click(); await shapeIs('new-component', 'store'); sizeIs(await nodeSize(page, 'new-component'), cardSize('store'), 'after redo');
  await persistedChoice(file, d => factIn(d, 'new-component')?.kind === 'data');

  // A panel wears its kind's outline and is as big as a card of that kind; leaving the form keeps the outline.
  await kindMenu('new-component', 'llm'); await shapeIs('new-component', 'agent');
  await (await callout(page, 'new-component')).getByTestId('callout-form').click(); await page.getByTestId('form-option-panel').click();
  await expect(page.getByTestId('node-new-component')).toHaveAttribute('data-form', 'panel'); await shapeIs('new-component', 'agent');
  sizeIs(await nodeSize(page, 'new-component'), cardSize('agent'), 'the agent panel'); await expect(page.getByTestId('node-new-component').getByTestId('node-item')).toHaveCount(0);
  await (await callout(page, 'new-component')).getByTestId('callout-form').click(); await page.getByTestId('form-option-compact').click();
  await expect(page.getByTestId('node-new-component')).toHaveAttribute('data-form', 'compact'); await shapeIs('new-component', 'agent');
  expect((await nodeSize(page, 'new-component')).height, 'the compact agent').toBeCloseTo(compactHeight('agent'), 0);

  // A compact part added as a person is drawn as one, and becomes a check with the check's compact height.
  await addFromPicker('actor', 'compact', 'Reviewer', 'new-component-2');
  await shapeIs('new-component-2', 'person'); expect((await nodeSize(page, 'new-component-2')).height).toBeCloseTo(compactHeight('person'), 0);
  await kindMenu('new-component-2', 'gate'); await shapeIs('new-component-2', 'check');
  expect((await nodeSize(page, 'new-component-2')).height).toBeCloseTo(compactHeight('check'), 0);
  await saved(page);

  // Must not happen: the facts of the other parts changing, or the outline becoming a field of the file.
  const stored = await readChoice(file);
  expect(factIn(stored, 'db')).toMatchObject({ kind: 'data', label: 'Orders DB' }); expect(factIn(stored, 'web')).toMatchObject({ kind: 'client' });
  expect(factIn(stored, 'new-component-2')).toMatchObject({ kind: 'gate', label: 'Reviewer' });
  expect(JSON.stringify(stored)).not.toMatch(/"shape"\s*:/);
});
