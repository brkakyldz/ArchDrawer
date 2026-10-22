import { test, expect, type Page } from '@playwright/test';
import { kinds, fact, part, workspaceRaw, openDrawing, readDocument, saved, box, svgInfo, svgShapes, editorShapes, shapeFor, baseURL, type Doc3, type Fact, type Part } from './helpers';

async function fullDetail(page: Page) {
  for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
    const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
  }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
}

// Every card of the ten kinds and a compact of seven of them carry the same label and sub-line, so any difference in size
// could only come from the shape; a panel and a group of kinds that have a shape come with them.
function shapesDoc(title: string) {
  const facts: Fact[] = [], nodes: Part[] = [], expected: Record<string, string> = {}, sizes: { id: string; kind: string; form: string }[] = [];
  const add = (id: string, kind: string, form: string, place: { row: number; col: number } | null, extra: Partial<Part> = {}, items: string[] = []) => {
    facts.push(fact(id, { label: 'Probe', sub: 'probe line', kind, description: `A ${kind} ${form}.`, items }));
    nodes.push(part(id, { form, place, ...extra })); expected[id] = shapeFor(kind, form); sizes.push({ id, kind, form });
  };
  kinds.forEach((kind, col) => add(`card-${kind}`, kind, 'card', { row: 0, col }));
  ['service', 'client', 'llm', 'actor', 'data', 'external', 'gate'].forEach((kind, col) => add(`compact-${kind}`, kind, 'compact', { row: 1, col }));
  add('panel-llm', 'llm', 'panel', { row: 2, col: 0 }, {}, ['One', 'Two']);
  add('group-data', 'data', 'group', { row: 2, col: 3 });
  add('child-gate', 'gate', 'compact', null, { parent: 'group-data' });
  const doc: Doc3 = { schema: 'archdraw/diagram@3', title, facts: { components: facts, relations: [] },
    channels: { overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview',
      caption: { title: `How ${title} looks`, lede: '' }, nodes, edges: [], texts: [] }] } } };
  return { doc, expected, parts: sizes };
}

// LOOK-2: a card or compact part of kind llm, actor, data, external or gate draws its own outline, named by `data-shape`,
// the same in the editor and in the exported image; every other part keeps the rounded rectangle. LAYOUT-1: the shape lies
// inside the box the part already has, so no size changes with it. LOOK-1: light and dark draw the same shapes.
test('H131 [LOOK-2, LOOK-1, LAYOUT-1] cards and compact parts of five kinds draw their own outline in the editor and in the exported image, in light and dark, at the size of a plain part', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { doc, expected, parts } = shapesDoc('Shape review');
  const ids = parts.map(p => p.id);
  const { file } = await workspaceRaw('shapes', doc), opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  const exportOf = async (theme: string) => {
    const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?channel=overview&view=overview&format=readme&theme=${theme}`);
    expect(response.status()).toBe(200); return await response.text();
  };

  // The contracted table, kind by kind: the five shaped kinds, a panel and a group as card and group, the rest as card.
  expect(expected).toMatchObject({ 'card-llm': 'agent', 'card-actor': 'person', 'card-data': 'store', 'card-external': 'external', 'card-gate': 'check',
    'card-service': 'card', 'card-client': 'card', 'card-api': 'card', 'card-worker': 'card', 'card-ops': 'card', 'compact-gate': 'check', 'compact-service': 'card',
    'panel-llm': 'card', 'group-data': 'group', 'child-gate': 'check' });
  expect(await editorShapes(page, ids), 'the editor, light').toEqual(expected);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');

  // Sizes in the editor: a shaped part is as big as a plain part with the same text, the card and the compact each.
  await fullDetail(page);
  const editorSize = async (id: string) => { const b = await box(page.getByTestId(`node-${id}`)); return { width: b.width, height: b.height }; };
  const plainCard = await editorSize('card-service'), plainCompact = await editorSize('compact-service');
  for (const kind of kinds) {
    const size = await editorSize(`card-${kind}`);
    expect(Math.abs(size.width - plainCard.width), `card-${kind} width`).toBeLessThanOrEqual(1); expect(Math.abs(size.height - plainCard.height), `card-${kind} height`).toBeLessThanOrEqual(1);
  }
  for (const kind of ['client', 'llm', 'actor', 'data', 'external', 'gate']) {
    const size = await editorSize(`compact-${kind}`);
    expect(Math.abs(size.width - plainCompact.width), `compact-${kind} width`).toBeLessThanOrEqual(1); expect(Math.abs(size.height - plainCompact.height), `compact-${kind} height`).toBeLessThanOrEqual(1);
  }

  // The exported image of the same file: the same shapes, the same first box per part, and the editor draws that box at the zoom shown.
  const light = await exportOf('light'), lightShapes = await svgShapes(page, light), lightImage = await svgInfo(page, light);
  expect(lightShapes, 'the image, light').toEqual(expected); expect(lightShapes).toEqual(await editorShapes(page, ids));
  const imageBox = (image: typeof lightImage, id: string) => { const n = image.nodes.find(node => node.id === id)!; return { width: n.width, height: n.height }; };
  for (const kind of kinds) expect(imageBox(lightImage, `card-${kind}`), `image card-${kind}`).toEqual(imageBox(lightImage, 'card-service'));
  for (const kind of ['client', 'llm', 'actor', 'data', 'external', 'gate']) expect(imageBox(lightImage, `compact-${kind}`), `image compact-${kind}`).toEqual(imageBox(lightImage, 'compact-service'));
  const zoom = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')) / 100;
  for (const id of ids) {
    const shape = imageBox(lightImage, id), size = await editorSize(id);
    expect(Math.abs(size.width - shape.width * zoom), `width of ${id}`).toBeLessThanOrEqual(shape.width * 0.005 + 1);
    expect(Math.abs(size.height - shape.height * zoom), `height of ${id}`).toBeLessThanOrEqual(shape.height * 0.005 + 1);
  }

  // Dark: the editor and the image draw the same shapes at the same sizes.
  await page.getByTestId('tool-theme').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await expect(page.getByTestId('tool-theme')).toHaveAttribute('aria-pressed', 'true'); await saved(page);
  expect(await editorShapes(page, ids), 'the editor, dark').toEqual(expected);
  const dark = await exportOf('dark'), darkImage = await svgInfo(page, dark);
  expect(darkImage.theme).toBe('dark'); expect(await svgShapes(page, dark), 'the image, dark').toEqual(expected);
  for (const id of ids) expect(imageBox(darkImage, id), `dark image ${id}`).toEqual(imageBox(lightImage, id));
  const darkStore = await editorSize('card-data'), darkPlain = await editorSize('card-service'); // the store is no taller or wider than a plain card in dark either
  expect(Math.abs(darkStore.width - darkPlain.width)).toBeLessThanOrEqual(1); expect(Math.abs(darkStore.height - darkPlain.height)).toBeLessThanOrEqual(1);

  // Must not happen: a shape becoming a field of the file, or a kind or a form changing because of how it is drawn.
  const after = await readDocument(file);
  expect(after.schema).toBe('archdraw/diagram@3'); expect(JSON.stringify(after)).not.toMatch(/"shape"\s*:/);
  expect(after.facts).toEqual(before.facts);
  expect(after.channels.overview.views![0].nodes.map(n => [n.id, n.form, n.facts])).toEqual(before.channels.overview.views![0].nodes.map(n => [n.id, n.form, n.facts]));
});
