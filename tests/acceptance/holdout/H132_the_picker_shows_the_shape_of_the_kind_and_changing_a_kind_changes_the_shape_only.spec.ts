import { test, expect } from '@playwright/test';
import { shop3, workspaceRaw, openDrawing, readDocument, persistedDoc, saved, box, canvasClick, emptyCanvasPoint, callout, editorShape, thumbShapes, factOf } from './helpers';

// diagram contract, Geometry, Shapes: the kind alone gives the outline of a card or a compact part (a panel is a card).
const KINDS: [string, string][] = [['llm', 'agent'], ['actor', 'person'], ['data', 'store'], ['external', 'external'], ['gate', 'check'], ['service', 'card']];
const SHAPES = ['agent', 'person', 'store', 'external', 'check'];

// LOOK-2 in the places a user chooses a kind: the component picker draws each button in the chosen kind's shape, an added
// part is drawn in it, and changing the kind in the callout changes the outline and nothing else (EDIT-1): the part keeps its
// size, its place and its text, and undo and redo bring the old outline and the new one back.
test('H132 [LOOK-2, EDIT-1, FILE-1] the picker draws its form buttons in the shape of the chosen kind, an added part wears it, and changing the kind in the callout changes the outline and not the size', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('kind-shapes', shop3('Kind shape shop')); await openDrawing(page, request, file);
  const shapeIs = async (id: string, shape: string) => await expect.poll(() => editorShape(page, id), { message: `shape of ${id}` }).toBe(shape);
  const sizeOf = async (id: string) => { const b = await box(page.getByTestId(`node-${id}`)); return { width: b.width, height: b.height }; };
  const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }, what: string) => {
    expect(Math.abs(a.width - b.width), `${what}: width`).toBeLessThanOrEqual(1); expect(Math.abs(a.height - b.height), `${what}: height`).toBeLessThanOrEqual(1);
  };
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

  // The drawing's own parts: a store is drawn as one, a client and a panel are plain cards.
  expect(await editorShape(page, 'db')).toBe('store'); expect(await editorShape(page, 'web')).toBe('card'); expect(await editorShape(page, 'api')).toBe('card');

  // The picker: every kind's button is drawn in that kind's shape, for the card and for the compact form.
  await page.getByTestId('tool-component').click();
  const point = await emptyCanvasPoint(page); await canvasClick(page, point.x, point.y);
  await expect(page.getByTestId('component-picker')).toBeVisible();
  for (const [kind, shape] of KINDS) {
    await page.getByTestId(`picker-kind-${kind}`).click();
    for (const form of ['card', 'compact']) {
      await expect.poll(async () => (await thumbShapes(page, form)).includes(shape), { message: `${kind}: the ${form} button shows ${shape}` }).toBe(true);
      const shown = await thumbShapes(page, form);
      for (const other of SHAPES.filter(s => s !== shape)) expect(shown, `${kind}: the ${form} button is not drawn as ${other}`).not.toContain(other);
    }
  }
  await page.getByTestId('picker-kind-service').click(); await page.getByTestId('picker-form-card').click();
  await page.getByTestId('picker-add').click(); await page.getByTestId('node-label-input').fill('Probe card'); await page.getByTestId('node-label-input').press('Enter');
  await persistedDoc(file, d => factOf(d, 'new-component')?.label === 'Probe card');
  await shapeIs('new-component', 'card');

  // Changing the kind in the callout changes the outline and keeps the size, whichever way round.
  const plain = await sizeOf('new-component'), at = await box(page.getByTestId('node-new-component'));
  for (const [kind, shape] of KINDS) {
    await kindMenu('new-component', kind); await shapeIs('new-component', shape);
    sameSize(await sizeOf('new-component'), plain, `the ${kind} card`);
    const now = await box(page.getByTestId('node-new-component'));
    expect(Math.abs(now.x - at.x) + Math.abs(now.y - at.y), `${kind}: the part stays where it was`).toBeLessThanOrEqual(1);
  }
  await persistedDoc(file, d => factOf(d, 'new-component')?.kind === 'service');

  // The outline follows undo and redo of the kind change, and the file follows it.
  await kindMenu('new-component', 'external'); await shapeIs('new-component', 'external');
  await persistedDoc(file, d => factOf(d, 'new-component')?.kind === 'external');
  await page.getByTestId('tool-undo').click(); await shapeIs('new-component', 'card'); sameSize(await sizeOf('new-component'), plain, 'after undo');
  await persistedDoc(file, d => factOf(d, 'new-component')?.kind === 'service');
  await page.getByTestId('tool-redo').click(); await shapeIs('new-component', 'external');
  await persistedDoc(file, d => factOf(d, 'new-component')?.kind === 'external');

  // A panel is a card whatever its kind: leaving the form brings the kind's outline back.
  await kindMenu('new-component', 'llm'); await shapeIs('new-component', 'agent');
  await (await callout(page, 'new-component')).getByTestId('callout-form').click(); await page.getByTestId('form-option-panel').click();
  await expect(page.getByTestId('node-new-component')).toHaveAttribute('data-form', 'panel'); await shapeIs('new-component', 'card');
  await (await callout(page, 'new-component')).getByTestId('callout-form').click(); await page.getByTestId('form-option-compact').click();
  await expect(page.getByTestId('node-new-component')).toHaveAttribute('data-form', 'compact'); await shapeIs('new-component', 'agent');

  // A compact part added as a person is drawn as one, and becomes a check without changing size.
  await addFromPicker('actor', 'compact', 'Reviewer', 'new-component-2');
  await shapeIs('new-component-2', 'person');
  const compact = await sizeOf('new-component-2');
  await kindMenu('new-component-2', 'gate'); await shapeIs('new-component-2', 'check'); sameSize(await sizeOf('new-component-2'), compact, 'the compact check');
  await saved(page);

  // Must not happen: the facts of the other parts changing, or the outline becoming a field of the file.
  const stored = await readDocument(file);
  expect(factOf(stored, 'db')).toMatchObject({ kind: 'data', label: 'Orders DB' }); expect(factOf(stored, 'web')).toMatchObject({ kind: 'client' });
  expect(factOf(stored, 'new-component-2')).toMatchObject({ kind: 'gate', label: 'Reviewer' });
  expect(JSON.stringify(stored)).not.toMatch(/"shape"\s*:/);
});
