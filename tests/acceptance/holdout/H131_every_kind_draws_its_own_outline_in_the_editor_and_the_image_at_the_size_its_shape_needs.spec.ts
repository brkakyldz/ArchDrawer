import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { workspaceRaw, openDrawing, saved, svgInfo, svgShapes, editorShapes } from './helpers';
import { ALL_KINDS, sketch, shapeForKind, cardSize, compactHeight, compactShortWidth, fullDetail, nodeSize, sizeIs, readChoice, imageOf, type SketchPart } from './helpers-drawing';

// Every card of the ten kinds carries the same label and sub-line, every compact the same short label and no sub-line, so any difference in size
// could only come from the shape; panels of three kinds and a group come with them.
function shapesDoc(title: string) {
  const parts: SketchPart[] = [], expected: Record<string, string> = {}, all: { id: string; kind: string; form: string }[] = [];
  const add = (p: SketchPart, kind: string, form: string) => { parts.push({ ...p, kind, form }); expected[p.id] = shapeForKind(kind, form); all.push({ id: p.id, kind, form }); };
  ALL_KINDS.forEach((kind, col) => add({ id: `card-${kind}`, label: 'Probe', sub: 'probe line', place: { row: 0, col } }, kind, 'card'));
  ALL_KINDS.forEach((kind, col) => add({ id: `compact-${kind}`, label: 'Pr', sub: '', place: { row: 1, col } }, kind, 'compact'));
  ['llm', 'data', 'gate'].forEach((kind, col) => add({ id: `panel-${kind}`, label: 'Probe', sub: 'probe line', items: ['One', 'Two'], place: { row: 2, col } }, kind, 'panel'));
  add({ id: 'group-data', label: 'Zone', place: { row: 3, col: 0 } }, 'data', 'group');
  add({ id: 'child-gate', label: 'Pr', sub: '', parent: 'group-data' }, 'gate', 'compact');
  return { doc: sketch(title, parts), expected, all };
}

// LOOK-2: every kind draws its own outline, named by `data-shape`, the same in the editor and in the exported image, for a card, a compact part and a
// panel (a panel takes its kind's shape); a group is `group`. The part is sized by its shape (content box), so a shield or a cylinder is taller than a
// plain card with the same text; the editor and the image draw the same box (LAYOUT-1, SHARE-1). LOOK-3: a panel is drawn exactly like a card of its kind.
test('H131 [LOOK-2 LOOK-3 LOOK-1 LAYOUT-1 SHARE-1 #177] every kind draws its own outline in the editor and in the exported image, as card, compact part and panel, in light and dark, at the size its shape needs', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { doc, expected, all } = shapesDoc('Shape review');
  const ids = all.map(p => p.id);
  const { file } = await workspaceRaw('shapes', doc), opened = await openDrawing(page, request, file);
  const before = await readChoice(file);

  // The table: ten kinds, ten shapes; a panel is its kind's shape, a group is group.
  expect(expected).toMatchObject({ 'card-actor': 'person', 'card-client': 'window', 'card-api': 'port', 'card-service': 'card', 'card-worker': 'stack', 'card-llm': 'agent',
    'card-external': 'external', 'card-ops': 'pulse', 'card-gate': 'check', 'card-data': 'store', 'compact-gate': 'check', 'compact-api': 'port', 'panel-llm': 'agent',
    'panel-data': 'store', 'panel-gate': 'check', 'group-data': 'group', 'child-gate': 'check' });
  expect(await editorShapes(page, ids), 'the editor, light').toEqual(expected);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');

  // Sizes in the editor, in drawing px: a card is its shape's content-box size, a panel the same as a card of its kind, a compact its shape's height and (short text) width.
  await fullDetail(page);
  const checkEditor = async (when: string) => {
    for (const p of all.filter(a => a.form === 'card')) sizeIs(await nodeSize(page, p.id), cardSize(shapeForKind(p.kind, 'card')), `${when}: card ${p.kind}`);
    for (const p of all.filter(a => a.form === 'panel')) sizeIs(await nodeSize(page, p.id), cardSize(shapeForKind(p.kind, 'panel')), `${when}: panel ${p.kind}`);
    for (const p of all.filter(a => a.form === 'compact' && a.id.startsWith('compact-'))) {
      const shape = shapeForKind(p.kind, 'compact');
      sizeIs(await nodeSize(page, p.id), { width: compactShortWidth(shape), height: compactHeight(shape) }, `${when}: compact ${p.kind}`);
    }
  };
  await checkEditor('light');
  // The shield, the cylinder, the cloud top and the stack make a part taller than a plain card with the same text.
  const plain = await nodeSize(page, 'card-service');
  for (const kind of ['worker', 'external', 'data', 'gate']) expect((await nodeSize(page, `card-${kind}`)).height, `card-${kind} is taller than a plain card`).toBeGreaterThan(plain.height + 5);
  expect((await nodeSize(page, 'card-api')).width, 'a port is wider than a plain card').toBeGreaterThan(plain.width + 20);

  // The exported image of the same file: the same shapes, the contracted boxes, and the editor draws that box at the zoom shown.
  const light = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme&theme=light'), lightImage = await svgInfo(page, light);
  expect(await svgShapes(page, light), 'the image, light').toEqual(expected);
  const imageBox = (image: typeof lightImage, id: string) => { const n = image.nodes.find(node => node.id === id)!; return { width: n.width, height: n.height }; };
  for (const p of all.filter(a => a.form !== 'group' && (a.form !== 'compact' || a.id.startsWith('compact-')))) {
    const shape = shapeForKind(p.kind, p.form);
    const want = p.form === 'compact' ? { width: compactShortWidth(shape), height: compactHeight(shape) } : cardSize(shape);
    expect(imageBox(lightImage, p.id), `image ${p.id}`).toEqual(want);
    sizeIs(await nodeSize(page, p.id), imageBox(lightImage, p.id), `editor against image: ${p.id}`);
  }

  // Dark: the same shapes at the same sizes, in the editor and in the image.
  await page.getByTestId('tool-theme').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await expect(page.getByTestId('tool-theme')).toHaveAttribute('aria-pressed', 'true'); await saved(page);
  expect(await editorShapes(page, ids), 'the editor, dark').toEqual(expected);
  await checkEditor('dark');
  const dark = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme&theme=dark'), darkImage = await svgInfo(page, dark);
  expect(darkImage.theme).toBe('dark'); expect(await svgShapes(page, dark), 'the image, dark').toEqual(expected);
  for (const id of ids.filter(i => i !== 'group-data')) expect(imageBox(darkImage, id), `dark image ${id}`).toEqual(imageBox(lightImage, id));

  // Must not happen: a shape becoming a field of the file, or a kind, a form or a fact changing because of how it is drawn.
  const raw = await readFile(file, 'utf8'), after = await readChoice(file);
  expect(JSON.parse(raw).schema, 'the file the product has opened is format 4').toBe('archdraw/diagram@4');
  expect(raw).not.toMatch(/"shape"\s*:/);
  expect(after.facts).toEqual(before.facts);
  expect(after.channels.overview.views![0].nodes.map(n => [n.id, n.form, n.facts])).toEqual(before.channels.overview.views![0].nodes.map(n => [n.id, n.form, n.facts]));
});
