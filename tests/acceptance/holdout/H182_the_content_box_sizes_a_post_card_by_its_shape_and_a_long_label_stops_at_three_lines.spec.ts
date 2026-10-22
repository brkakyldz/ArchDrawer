import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { workspaceRaw, openDrawing, part, svgInfo, svgShapes, editorShapes, type Part } from './helpers';
import { ALL_KINDS, sketch, withPost, shapeForKind, cardSize, compactHeight, fullDetail, nodeSize, sizeIs, imageOf, countPuts, type SketchPart } from './helpers-drawing';
import { inDrawingFonts } from './helpers-svg-parity';

const LONG = 'A deliberately long label that keeps going and going and going and going and going and going and going';
const WRAP = 'Probe probe probe probe probe probe probe probe probe probe probe probe probe probe probe';

// The overview draws the facts as plain cards and compacts; the post view draws the same facts again in the post style.
function postDoc(title: string, subLines: boolean) {
  const parts: SketchPart[] = [], post: Part[] = [];
  ALL_KINDS.forEach((kind, i) => {
    parts.push({ id: `c-${kind}`, kind, label: 'Probe', sub: 'short', x: i * 280, y: 0 });
    parts.push({ id: `k-${kind}`, kind, form: 'compact', label: 'Probe', sub: 'short', x: i * 380, y: 220 });
    post.push(part(`lp-c-${kind}`, { facts: [`c-${kind}`], x: i * 280, y: 0 }), part(`lp-k-${kind}`, { facts: [`k-${kind}`], form: 'compact', x: i * 380, y: 220 }));
  });
  for (const [id, kind] of [['long-service', 'service'], ['long-api', 'api']]) {
    parts.push({ id, kind, form: 'compact', label: LONG, sub: '', x: kind === 'api' ? 700 : 0, y: 340 });
    post.push(part(`lp-${id}`, { facts: [id], form: 'compact', x: kind === 'api' ? 700 : 0, y: 340 }));
  }
  parts.push({ id: 'wrap3', label: WRAP, sub: 'short', x: 0, y: 460 }); post.push(part('lp-wrap3', { facts: ['wrap3'], x: 0, y: 460 }));
  const doc = withPost(sketch(title, parts), post, []);
  if (!subLines) (doc.channels.linkedin!.views![0] as { subLines?: boolean }).subLines = false;
  return doc;
}

// Every text of every part lies inside the part's box in the image.
async function textsInside(page: Page, svg: string) {
  return await inDrawingFonts(page, svg, async surface => await surface.evaluate(element => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const bad: string[] = [];
    for (const g of Array.from(root.querySelectorAll('g[data-node-id]'))) {
      const rect = g.querySelector('rect')!.getBoundingClientRect();
      for (const t of Array.from(g.querySelectorAll('text'))) {
        const r = t.getBoundingClientRect();
        if (r.left < rect.left - 1 || r.right > rect.right + 1 || r.top < rect.top - 1 || r.bottom > rect.bottom + 1) bad.push(`${g.getAttribute('data-node-id')}: ${t.textContent}`);
      }
    }
    return bad;
  }));
}

// LOOK-2: a shape has a content box and the part is sized to it, in the post style too (numbers in parentheses of the contract). STORY-2: the post is denser.
test('H182 [LOOK-2 LAYOUT-1 STORY-2 SHARE-1 #177] a LinkedIn post sizes each card by its shape in the post style, a long label stops at three lines inside the box, and sub-lines off take 18 px from every card', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { file } = await workspaceRaw('post-content-box', postDoc('Post content box', true)), opened = await openDrawing(page, request, file);
  const before = await readFile(file, 'utf8'), puts = countPuts(page);
  const query = (channel: string, format: string) => `channel=${channel}&view=${channel === 'linkedin' ? 'linkedin-post' : 'overview'}&format=${format}`;
  const expectedShape: Record<string, string> = {}, postShape: Record<string, string> = {};
  for (const kind of ALL_KINDS) {
    expectedShape[`c-${kind}`] = shapeForKind(kind, 'card'); expectedShape[`k-${kind}`] = shapeForKind(kind, 'compact');
    postShape[`lp-c-${kind}`] = shapeForKind(kind, 'card'); postShape[`lp-k-${kind}`] = shapeForKind(kind, 'compact');
  }

  // The post, in both post images and in the editor: card heights 84 / 86 / 92 / 94 / 96 / 98 by shape, widths 176 plus the extra width, compact heights.
  const postCard = (kind: string, subLine = true) => cardSize(shapeForKind(kind, 'card'), { post: true, subLine });
  expect(postCard('service').height).toBe(84); expect(postCard('actor').height).toBe(86); expect(postCard('client').height).toBe(92);
  expect(postCard('ops').height).toBe(94); expect(postCard('data').height).toBe(96); expect(postCard('gate').height).toBe(98); expect(postCard('api').width).toBe(200);
  for (const format of ['feed', 'linkedin']) {
    const svg = await imageOf(request, opened.id, query('linkedin', format)), image = await svgInfo(page, svg), at = (id: string) => image.nodes.find(n => n.id === id)!;
    expect(await svgShapes(page, svg), `${format}: shapes`).toMatchObject(postShape);
    for (const kind of ALL_KINDS) {
      expect({ width: at(`lp-c-${kind}`).width, height: at(`lp-c-${kind}`).height }, `${format}: ${kind} card`).toEqual(postCard(kind));
      expect(at(`lp-k-${kind}`).height, `${format}: ${kind} compact`).toBe(compactHeight(shapeForKind(kind, 'compact')));
    }
    // A very long label: three lines at most (20 px a line in the post), kept inside the box; a compact part stops at 320 plus its extra width.
    expect(at('lp-wrap3').height, `${format}: three lines`).toBe(cardSize('card', { post: true, labelLines: 3 }).height);
    expect(at('lp-long-service').width, `${format}: compact service`).toBe(320); expect(at('lp-long-api').width, `${format}: compact API`).toBe(340);
    expect(await textsInside(page, svg), `${format}: no text outside its part`).toEqual([]);
  }
  await page.getByTestId('channel-tab-linkedin').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await fullDetail(page);
  expect(await editorShapes(page, Object.keys(postShape))).toEqual(postShape);
  for (const kind of ALL_KINDS) {
    sizeIs(await nodeSize(page, `lp-c-${kind}`), postCard(kind), `editor ${kind} post card`);
    expect((await nodeSize(page, `lp-k-${kind}`)).height).toBeCloseTo(compactHeight(shapeForKind(kind, 'compact')), 0);
  }
  sizeIs(await nodeSize(page, 'lp-wrap3'), { width: 176, height: cardSize('card', { post: true, labelLines: 3 }).height }, 'editor three-line post card');

  // The overview of the same facts is not a post: plain widths and heights, and the three-line card grows by 18 a line.
  const overview = await svgInfo(page, await imageOf(request, opened.id, query('overview', 'readme')));
  expect(await svgShapes(page, await imageOf(request, opened.id, query('overview', 'readme'))), 'overview shapes').toMatchObject(expectedShape);
  for (const kind of ALL_KINDS) expect({ width: overview.nodes.find(n => n.id === `c-${kind}`)!.width, height: overview.nodes.find(n => n.id === `c-${kind}`)!.height }, `overview ${kind}`).toEqual(cardSize(shapeForKind(kind, 'card')));
  expect(overview.nodes.find(n => n.id === 'wrap3')!.height).toBe(cardSize('card', { labelLines: 3 }).height);
  expect(cardSize('card', { labelLines: 3 }).height - cardSize('card').height, 'the plain style adds 18 a line').toBe(36);
  expect(cardSize('card', { post: true, labelLines: 3 }).height - cardSize('card', { post: true }).height, 'the post style adds 20 a line').toBe(40);
  // The person card holds no icon above its label: 48 + 24 insets, a label line and the sub-line row.
  expect(overview.nodes.find(n => n.id === 'c-actor')!.height).toBe(48 + 24 + 18 + 18);

  // Sub-lines off in the post view: every post card is 18 px shorter, in the image and in the editor.
  const off = await workspaceRaw('post-content-box-off', postDoc('Post without sub-lines', false)), offOpened = await openDrawing(page, request, off.file);
  const offSvg = await imageOf(request, offOpened.id, query('linkedin', 'feed')), offImage = await svgInfo(page, offSvg);
  for (const kind of ALL_KINDS) expect(offImage.nodes.find(n => n.id === `lp-c-${kind}`)!.height, `${kind} without sub-lines`).toBe(postCard(kind, false).height);
  expect(offImage.nodes.flatMap(n => n.text).join(' | ')).not.toContain('short');

  // Must not happen: looking at the post writes anything, or a shape changes the size of a text.
  expect(await readFile(file, 'utf8'), 'viewing wrote nothing').toBe(before);
  expect(puts.count, 'no save').toBe(0);
});
