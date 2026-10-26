import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { part, workspaceRaw, openDrawing, svgInfo, svgShapes, editorShapes, baseURL, type Link, type Part } from './helpers';
import { ALL_KINDS, sketch, withPost, shapeForKind, cardSize, compactHeight, fullDetail, nodeSize, sizeIs, readChoice, type SketchPart } from './helpers-drawing';

// The overview draws every fact once. The LinkedIn post draws them again in its own parts: a card and a compact part of each of the ten kinds, a panel of
// an AI agent, and a group with a check inside. Every label is `Probe`.
function postDoc(title: string) {
  const facts: SketchPart[] = [];
  ALL_KINDS.forEach((kind, i) => facts.push({ id: `f-${kind}`, label: 'Probe', kind, place: { row: Math.floor(i / 5), col: i % 5 } }));
  ALL_KINDS.forEach((kind, i) => facts.push({ id: `fc-${kind}`, label: 'Probe', kind, place: { row: 2 + Math.floor(i / 5), col: i % 5 } }));
  facts.push({ id: 'f-panel', label: 'Probe', kind: 'llm', items: ['One', 'Two'], place: { row: 4, col: 0 } }, { id: 'f-inner', label: 'Probe', kind: 'gate', place: { row: 4, col: 1 } });
  const doc = sketch(title, facts);
  const spine = (n: number) => ({ lane: { spine: n } });
  const nodes: Part[] = [];
  ALL_KINDS.forEach((kind, i) => nodes.push(part(`lp-${kind}`, { facts: [`f-${kind}`], ...spine(i) })));
  ALL_KINDS.forEach((kind, i) => nodes.push(part(`lc-${kind}`, { facts: [`fc-${kind}`], form: 'compact', ...spine(10 + i) })));
  nodes.push(part('lp-panel', { facts: ['f-panel'], form: 'panel', ...spine(20) }),
    part('lp-zone', { facts: [], form: 'group', label: 'Zone', kind: 'data', description: 'A group of parts.', ...spine(21) }),
    part('lp-inner', { facts: ['f-inner'], form: 'compact', parent: 'lp-zone', ...spine(0) }));
  const edges: Link[] = [{ id: 'p1', from: 'lp-actor', to: 'lp-client', relations: [], step: 1 }, { id: 'p2', from: 'lp-client', to: 'lp-api', relations: [], step: 2 },
    { id: 'p3', from: 'lp-api', to: 'lp-service', relations: [], step: 3 }];
  withPost(doc, nodes, edges);
  const expected: Record<string, string> = { 'lp-panel': 'agent', 'lp-zone': 'group', 'lp-inner': 'check' };
  for (const kind of ALL_KINDS) { expected[`lp-${kind}`] = shapeForKind(kind, 'card'); expected[`lc-${kind}`] = shapeForKind(kind, 'compact'); }
  return { doc, expected };
}

// LOOK-2: the post style (STORY-2, a denser LinkedIn view) draws the same ten shapes as the other channels, sized by the post-style numbers of the
// content-box table, in the editor and in both post images (SHARE-1: the portrait feed and the wide post). LOOK-3: a panel is drawn like a card of its kind.
test('H133 [LOOK-2 LOOK-3 STORY-2 SHARE-1 #177] a LinkedIn post draws the same shapes in its denser post style, in the editor and in the portrait and wide images, at the post sizes of each shape', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { doc, expected } = postDoc('Post shapes');
  const ids = Object.keys(expected);
  const { file } = await workspaceRaw('post-shapes', doc), opened = await openDrawing(page, request, file);
  const before = await readFile(file, 'utf8');

  // The overview draws the same kinds in the plain sizes: its service card is the plain 196 x 108, its store the shape's own.
  await fullDetail(page);
  expect(await editorShapes(page, ['f-actor', 'f-client', 'f-api', 'f-service', 'f-worker', 'f-llm', 'f-external', 'f-ops', 'f-gate', 'f-data'])).toEqual({
    'f-actor': 'person', 'f-client': 'window', 'f-api': 'port', 'f-service': 'card', 'f-worker': 'stack', 'f-llm': 'agent', 'f-external': 'external', 'f-ops': 'pulse', 'f-gate': 'check', 'f-data': 'store' });
  sizeIs(await nodeSize(page, 'f-service'), cardSize('card'), 'the overview card'); sizeIs(await nodeSize(page, 'f-data'), cardSize('store'), 'the overview store');

  // The LinkedIn tab: each part wears the outline of its kind, a panel too, a group is a group; every size is the post style's.
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('node-lp-zone')).toBeVisible();
  expect(await editorShapes(page, ids), 'the editor, LinkedIn').toEqual(expected);
  await fullDetail(page);
  for (const kind of ALL_KINDS) {
    const shape = shapeForKind(kind, 'card');
    sizeIs(await nodeSize(page, `lp-${kind}`), cardSize(shape, { post: true }), `editor: post card ${kind}`);
    expect((await nodeSize(page, `lc-${kind}`)).height, `editor: post compact ${kind}`).toBeCloseTo(compactHeight(shape), 0);
  }
  sizeIs(await nodeSize(page, 'lp-panel'), cardSize('agent', { post: true }), 'editor: the agent panel is a post card of its kind');
  await expect(page.getByTestId('node-lp-panel').getByTestId('node-item')).toHaveCount(0);

  // Both post images of the same file: the same outlines and the post style's boxes: 84 / 86 / 92 / 94 / 96 / 98 tall, 176 wide (port 200, stack 184).
  for (const [format, width, height] of [['feed', 1080, 1350], ['linkedin', 1620, 1080]] as const) {
    const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?channel=linkedin&view=linkedin-post&format=${format}`);
    expect(response.status(), format).toBe(200);
    const svg = await response.text(), image = await svgInfo(page, svg);
    expect(image).toMatchObject({ error: false, width, height, format });
    expect(await svgShapes(page, svg), `the ${format} image`).toEqual(expected);
    const imageBox = (id: string) => { const n = image.nodes.find(node => node.id === id)!; return { width: n.width, height: n.height }; };
    for (const kind of ALL_KINDS) {
      const shape = shapeForKind(kind, 'card');
      expect(imageBox(`lp-${kind}`), `${format}: ${kind} is a post card of its shape`).toEqual(cardSize(shape, { post: true }));
      expect(imageBox(`lc-${kind}`).height, `${format}: compact ${kind}`).toBe(compactHeight(shape));
    }
    expect(imageBox('lp-panel'), `${format}: the panel`).toEqual({ width: 176, height: 84 });
    expect(image.nodes.find(n => n.id === 'lp-panel')!.text.join(' '), `${format}: no row of the panel is drawn`).not.toMatch(/One|Two/);
  }

  // Must not happen: looking at the post, or drawing its shapes, writing anything, or a shape becoming a field of the file; a part holding rows to draw.
  expect(await readFile(file, 'utf8')).toBe(before); expect(before).not.toMatch(/"shape"\s*:/);
  for (const p of (await readChoice(file)).channels.linkedin!.views![0].nodes) expect(p.held ?? [], `${p.id} holds nothing`).toEqual([]);
});
