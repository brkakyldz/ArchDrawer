import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { workspaceRaw, openDrawing, saved, svgInfo, svgShapes, editorShapes } from './helpers';
import { ALL_KINDS, sketch, shapeForKind, cardSize, compactHeight, compactShortWidth, fullDetail, nodeSize, sizeIs, imageOf, readChoice, type SketchPart } from './helpers-drawing';

// One card, one compact (with a sub-line), one short compact (label `Pr`, no sub-line) of each of the ten kinds, a panel of three kinds that hold rows,
// a group, and two cards whose label wraps (three words of 14 characters: a label is 48 characters at most). Every label and sub-line is the same, so a size can only come from the shape.
function kindsDoc(title: string) {
  const parts: SketchPart[] = [];
  ALL_KINDS.forEach((kind, i) => {
    parts.push({ id: `card-${kind}`, kind, label: 'Probe', sub: 'probe line', x: i * 320, y: 0 });
    parts.push({ id: `compact-${kind}`, kind, form: 'compact', label: 'Probe', sub: 'probe line', x: i * 360, y: 200 });
    parts.push({ id: `short-${kind}`, kind, form: 'compact', label: 'Pr', sub: '', x: i * 360, y: 320 });
  });
  ['llm', 'data', 'gate'].forEach((kind, i) => parts.push({ id: `panel-${kind}`, kind, form: 'panel', label: 'Probe', sub: 'probe line',
    items: ['One'], held: ['Held row'], limits: ['Stops soon'], x: i * 320, y: 440 }));
  parts.push({ id: 'group-data', form: 'group', kind: 'data', label: 'Zone', x: 1200, y: 440 });
  // A compact part inside the group wears its own kind's shape (only the shape assertions count it).
  parts.push({ id: 'child-gate', kind: 'gate', form: 'compact', label: 'Pr', sub: '', parent: 'group-data', x: 1220, y: 500 });
  parts.push({ id: 'wrap2', label: 'Probe probe probe probe probe probe', sub: 'probe line', x: 0, y: 700 });
  parts.push({ id: 'wrap3', label: 'Authentication Reconciliation Orchestration', sub: 'probe line', x: 320, y: 700 });
  return sketch(title, parts);
}

// LOOK-2: every kind of part has its own outline, named by `data-shape`, the same in the editor and in the export, at the box its content box needs
// (a panel is drawn as a card of its kind; a compact part in a group wears its kind's). LOOK-3: a panel draws no row. LAYOUT-1: the editor and the
// image draw from one set of numbers. LOOK-1: dark draws the same.
test('H179 [LOOK-2 LOOK-3 LAYOUT-1 SHARE-1 LOOK-1 #177] every kind of part draws its own outline at its contracted box, in the editor and in the exported image, in light and dark, and a panel is a card of its kind that draws no row', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('kinds-ten', kindsDoc('Ten outlines')), opened = await openDrawing(page, request, file);
  const before = await readChoice(file);
  const expectedShape: Record<string, string> = {}, full: Record<string, { width: number; height: number }> = {}, tall: Record<string, number> = {};
  for (const kind of ALL_KINDS) {
    const shape = shapeForKind(kind, 'card');
    expectedShape[`card-${kind}`] = shape; full[`card-${kind}`] = cardSize(shape);
    expectedShape[`compact-${kind}`] = shape; tall[`compact-${kind}`] = compactHeight(shape);
    expectedShape[`short-${kind}`] = shape; full[`short-${kind}`] = { width: compactShortWidth(shape), height: compactHeight(shape) };
  }
  for (const kind of ['llm', 'data', 'gate']) { expectedShape[`panel-${kind}`] = shapeForKind(kind, 'card'); full[`panel-${kind}`] = cardSize(shapeForKind(kind, 'card')); }
  expectedShape['group-data'] = 'group'; expectedShape['child-gate'] = shapeForKind('gate', 'compact');
  expectedShape.wrap2 = 'card'; expectedShape.wrap3 = 'card';
  expect(expectedShape['child-gate'], 'a compact check is a shield').toBe('check');
  const ids = Object.keys(expectedShape);
  expect(full['card-api'], 'the API card is the plain card plus 28').toEqual({ width: 224, height: 108 });
  expect(full['card-gate'].height, 'a check is 126 tall').toBe(126);

  async function round(when: string, theme: string) {
    expect(await editorShapes(page, ids), `${when}: the editor`).toEqual(expectedShape);
    const svg = await imageOf(request, opened.id, `channel=overview&view=overview&format=readme&theme=${theme}`);
    expect(await svgShapes(page, svg), `${when}: the image`).toEqual(expectedShape);
    const image = await svgInfo(page, svg), at = (id: string) => image.nodes.find(n => n.id === id)!;
    for (const [id, size] of Object.entries(full)) {
      expect({ width: at(id).width, height: at(id).height }, `${when}: image ${id}`).toEqual(size);
      sizeIs(await nodeSize(page, id), size, `${when}: editor ${id}`);
    }
    for (const [id, height] of Object.entries(tall)) {
      expect(at(id).height, `${when}: image ${id}`).toBe(height);
      expect(at(id).width, `${when}: image ${id} is 140 to 320 plus its extra width`).toBeGreaterThanOrEqual(140);
      sizeIs(await nodeSize(page, id), { width: at(id).width, height }, `${when}: editor ${id}`);
    }
    // A label that wraps grows the card by 18 px a line, to three lines at most.
    const two = at('wrap2').height, three = at('wrap3').height;
    expect([cardSize('card', { labelLines: 2 }).height, cardSize('card', { labelLines: 3 }).height], `${when}: wrap2 is two or three lines`).toContain(two);
    expect(three, `${when}: a very long label stops at three lines`).toBe(cardSize('card', { labelLines: 3 }).height);
    sizeIs(await nodeSize(page, 'wrap3'), { width: 196, height: three }, `${when}: editor wrap3`);
    return image;
  }

  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');
  await fullDetail(page);
  const light = await round('light', 'light');
  // A panel is exactly as big as the card of its kind, and its rows are drawn nowhere: not in the image, not on the canvas (its label and sub-line are).
  for (const kind of ['llm', 'data', 'gate']) {
    const panel = light.nodes.find(n => n.id === `panel-${kind}`)!;
    expect(panel.text.join(' '), `panel-${kind} draws no row`).not.toMatch(/Held row|One|Stops soon/);
    const drawnText = (await page.getByTestId(`node-panel-${kind}`).textContent()) ?? '';
    expect(drawnText, `panel-${kind} draws its label on the canvas`).toContain('Probe');
    expect(drawnText, `panel-${kind} draws no row on the canvas`).not.toMatch(/Held row|One|Stops soon/);
  }

  await page.getByTestId('tool-theme').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await expect(page.getByTestId('tool-theme')).toHaveAttribute('aria-pressed', 'true'); await saved(page);
  const dark = await round('dark', 'dark');
  expect(dark.theme, 'the dark image says so on its root').toBe('dark');
  const boxOf = (image: typeof light, id: string) => { const n = image.nodes.find(node => node.id === id)!; return { width: n.width, height: n.height }; };
  expect(boxOf(dark, 'child-gate'), 'the compact part in the group is the same size in dark').toEqual(boxOf(light, 'child-gate'));

  // Must not happen: a shape or a size in the file, or a kind, a form or a fact changing because of how it is drawn.
  const raw = await readFile(file, 'utf8'), stored = await readChoice(file);
  expect(JSON.parse(raw).schema, 'the file the product has opened is format 4').toBe('archdraw/diagram@4');
  expect(raw).not.toMatch(/"shape"\s*:/);
  expect(stored.facts.components.find(f => f.id === 'card-data')!.kind).toBe('data');
  expect(stored.facts.components.find(f => f.id === 'panel-llm')!.kind).toBe('llm');
  expect(stored.facts).toEqual(before.facts);
  expect(stored.channels.overview.views![0].nodes.map(n => [n.id, n.form, n.facts])).toEqual(before.channels.overview.views![0].nodes.map(n => [n.id, n.form, n.facts]));
});
