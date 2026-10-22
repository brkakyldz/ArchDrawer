import { test, expect, type Page } from '@playwright/test';
import { fact, part, workspaceRaw, openDrawing, readDocument, box, svgInfo, svgShapes, editorShapes, baseURL, type Doc3, type Fact, type Part, type Link } from './helpers';

async function fullDetail(page: Page) {
  for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
    const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
  }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
}

// The overview draws every fact once. The LinkedIn post draws them again in its own parts, one per outline: five shaped
// kinds, a plain service for comparison, a panel and a group. Every label is `Probe` and no part has a sub-line.
function postDoc(title: string) {
  const facts: Fact[] = [
    fact('f-person', { label: 'Probe', kind: 'actor' }), fact('f-agent', { label: 'Probe', kind: 'llm' }), fact('f-store', { label: 'Probe', kind: 'data' }),
    fact('f-ext', { label: 'Probe', kind: 'external' }), fact('f-check', { label: 'Probe', kind: 'gate' }), fact('f-plain', { label: 'Probe', kind: 'service' }),
    fact('f-panel', { label: 'Probe', kind: 'llm', items: ['One', 'Two'] }), fact('f-inner', { label: 'Probe', kind: 'gate' }),
  ];
  const overview: Part[] = facts.map((f, col) => part(f.id, { place: { row: Math.floor(col / 4), col: col % 4 } }));
  const spine = (n: number) => ({ lane: { spine: n } });
  const nodes: Part[] = [
    part('lp-person', { facts: ['f-person'], ...spine(0) }), part('lp-agent', { facts: ['f-agent'], ...spine(1) }),
    part('lp-store', { facts: ['f-store'], form: 'compact', ...spine(2) }), part('lp-ext', { facts: ['f-ext'], ...spine(3) }),
    part('lp-check', { facts: ['f-check'], ...spine(4) }), part('lp-plain', { facts: ['f-plain'], ...spine(5) }),
    part('lp-panel', { facts: ['f-panel'], form: 'panel', ...spine(6) }),
    part('lp-zone', { facts: [], form: 'group', label: 'Zone', kind: 'data', description: 'A group of parts.', ...spine(7) }),
    part('lp-inner', { facts: ['f-inner'], form: 'compact', parent: 'lp-zone', ...spine(0) }),
  ];
  const edges: Link[] = [{ id: 'p1', from: 'lp-person', to: 'lp-agent', relations: [], step: 1 }, { id: 'p2', from: 'lp-agent', to: 'lp-store', relations: [], step: 2 },
    { id: 'p3', from: 'lp-store', to: 'lp-ext', relations: [], step: 3 }];
  const doc: Doc3 = { schema: 'archdraw/diagram@3', title, facts: { components: facts, relations: [] },
    channels: {
      overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview', caption: { title: `How ${title} works`, lede: '' }, nodes: overview, edges: [], texts: [] }] },
      linkedin: { showSteps: false, outdated: [], views: [{ id: 'linkedin-post', title: 'LinkedIn', caption: { title: 'One post, every outline', lede: 'The same parts as the map.' }, nodes, edges, texts: [] }] },
    } };
  const expected: Record<string, string> = { 'lp-person': 'person', 'lp-agent': 'agent', 'lp-store': 'store', 'lp-ext': 'external', 'lp-check': 'check',
    'lp-plain': 'card', 'lp-panel': 'card', 'lp-zone': 'group', 'lp-inner': 'check' };
  return { doc, expected };
}

// LOOK-2: the post style (STORY-2, a denser LinkedIn view) draws the same shapes as the other channels, inside the boxes it
// already measures, in the editor and in both post images (SHARE-1: the portrait feed and the wide post).
test('H133 [LOOK-2, STORY-2, SHARE-1] a LinkedIn post draws the same shapes in its denser post style, in the editor and in the portrait and wide images, at the size of a plain post card', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { doc, expected } = postDoc('Post shapes');
  const ids = Object.keys(expected);
  const { file } = await workspaceRaw('post-shapes', doc), opened = await openDrawing(page, request, file);
  const before = await readDocument(file);

  // The overview draws the same kinds in the same outlines. `f-panel` is a card-form part there (only a part of form `panel`
  // draws the card outline), so as a kind `llm` it draws the agent outline.
  expect(await editorShapes(page, ['f-person', 'f-agent', 'f-store', 'f-ext', 'f-check', 'f-plain', 'f-panel'])).toEqual({
    'f-person': 'person', 'f-agent': 'agent', 'f-store': 'store', 'f-ext': 'external', 'f-check': 'check', 'f-plain': 'card', 'f-panel': 'agent' });

  // The LinkedIn tab: each part wears the outline of its kind, a panel is a card and a group is a group.
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('node-lp-zone')).toBeVisible();
  expect(await editorShapes(page, ids), 'the editor, LinkedIn').toEqual(expected);
  await fullDetail(page);
  const size = async (id: string) => { const b = await box(page.getByTestId(`node-${id}`)); return { width: b.width, height: b.height }; };
  const plain = await size('lp-plain');
  for (const id of ['lp-person', 'lp-agent', 'lp-ext', 'lp-check']) {
    const now = await size(id);
    expect(Math.abs(now.width - plain.width), `${id}: width`).toBeLessThanOrEqual(1); expect(Math.abs(now.height - plain.height), `${id}: height`).toBeLessThanOrEqual(1);
  }
  const plainCompact = await size('lp-inner'), store = await size('lp-store');
  expect(Math.abs(store.width - plainCompact.width), 'the compact store is as wide as the compact check').toBeLessThanOrEqual(1);
  expect(Math.abs(store.height - plainCompact.height), 'the compact store is as tall as the compact check').toBeLessThanOrEqual(1);

  // Both post images of the same file: the same outlines, and the post style's own card (176 × 84) for every card, shaped or not.
  for (const [format, width, height] of [['feed', 1080, 1350], ['linkedin', 1620, 1080]] as const) {
    const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?channel=linkedin&view=linkedin-post&format=${format}`);
    expect(response.status(), format).toBe(200);
    const svg = await response.text(), image = await svgInfo(page, svg);
    expect(image).toMatchObject({ error: false, width, height, format });
    expect(await svgShapes(page, svg), `the ${format} image`).toEqual(expected);
    const imageBox = (id: string) => { const n = image.nodes.find(node => node.id === id)!; return { width: n.width, height: n.height }; };
    for (const id of ['lp-plain', 'lp-person', 'lp-agent', 'lp-ext', 'lp-check']) expect(imageBox(id), `${format}: ${id} is a post card`).toEqual({ width: 176, height: 84 });
    expect(imageBox('lp-store'), `${format}: the compact store`).toEqual(imageBox('lp-inner'));
  }

  // Must not happen: looking at the post, or drawing its shapes, writing anything, or a shape becoming a field of the file.
  const after = await readDocument(file);
  expect(after).toEqual(before); expect(JSON.stringify(after)).not.toMatch(/"shape"\s*:/);
  for (const p of after.channels.linkedin!.views![0].nodes) expect(p.held ?? [], `${p.id} holds nothing`).toEqual([]);
});
