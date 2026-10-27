import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fact, part, workspaceRaw, openDrawing, readDocument, readDrawing, cli, settledReport, type Doc3, type Link, type Part } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport, entersBox, edgeLine, isSingleCubic, routeToBox, sideOf } from './helpers-svg-parity';

// Three parts in one column, 116 px apart, with a line from the first to the third that would run straight down behind the
// second. The overview and the LinkedIn post draw the same column and the same connections.
function columnDoc(title: string): Doc3 {
  const column = (prefix: string, ids: [string, string, string]): { nodes: Part[]; edges: Link[] } => ({
    nodes: ids.map((id, i) => part(`${prefix}${id}`, { facts: [id], x: 0, y: i * 200 })),
    edges: [{ id: `${prefix}1`, from: `${prefix}top`, to: `${prefix}wall`, relations: ['r1'], step: 1 },
      { id: `${prefix}2`, from: `${prefix}wall`, to: `${prefix}bottom`, relations: ['r2'], step: 2 },
      { id: `${prefix}3`, from: `${prefix}top`, to: `${prefix}bottom`, relations: ['r3'], step: null }],
  });
  const overview = column('o-', ['top', 'wall', 'bottom']), post = column('p-', ['top', 'wall', 'bottom']);
  return { schema: 'archdraw/diagram@3', title,
    facts: {
      components: [fact('top', { label: 'Intake', kind: 'client' }), fact('wall', { label: 'Checks', kind: 'gate' }), fact('bottom', { label: 'Ledger', kind: 'data' })],
      relations: [{ id: 'r1', from: 'top', to: 'wall', label: '', style: 'call', both: false },
        { id: 'r2', from: 'wall', to: 'bottom', label: '', style: 'call', both: false },
        { id: 'r3', from: 'top', to: 'bottom', label: 'skip', style: 'async', both: false }],
    },
    channels: {
      overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview', caption: { title: 'A column', lede: 'Three parts in a column.' }, ...overview, texts: [] }] },
      linkedin: { showSteps: false, outdated: [], views: [{ id: 'linkedin-post', title: 'LinkedIn', caption: { title: 'A column in a post', lede: 'The same three parts in a post.' }, ...post, texts: [] }] },
    } };
}

// Outcome (ADR 0011): in the overview a line that meets a part passes behind it, straight, and the report lists the part.
// In a LinkedIn post a straight line down that would be hidden behind the part between its ends turns out on one side
// as one cubic, clear of the part by 8 px and not listed, while the lines that are not hidden stay straight on facing sides.
test('H153 [LAYOUT-2, LAYOUT-3, STORY-2, SHARE-1] a straight line hidden behind the part between its ends passes behind it in the overview, and in a LinkedIn post turns out on one side as one cubic clear of that part', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { dir, file } = await workspaceRaw('post-spine', columnDoc('Post spine'));
  await openDrawing(page, request, file);
  const before = await readDocument(file);
  const positions = (doc: Doc3) => [...doc.channels.overview.views![0].nodes, ...doc.channels.linkedin!.views![0].nodes].map(n => [n.id, n.x, n.y]);
  const drawn = await readDrawing(file);

  // The overview: the line from top to bottom meets the part between them. It is not turned out: it leaves the bottom of the
  // first part and enters the top of the last, passes behind the middle one, and the report lists that part.
  const overviewSvg = join(dir, 'overview.svg'), overviewDone = await cli(['svg', file, '--channel', 'overview', '--view', 'overview', '--format', 'readme', '--out', overviewSvg]);
  expect(overviewDone.code, overviewDone.stderr).toBe(0);
  const overview = await inDrawingFonts(page, await readFile(overviewSvg, 'utf8'), async surface => {
    const edges = drawn.views[0].edges, geometries = [], lines = [];
    for (const edge of edges) { geometries.push(await routeGeometry(surface, edge.id!, edge.from, edge.to)); lines.push(await edgeLine(surface, edge.id!)); }
    return { geometries, lines, independent: measuredRouteReport(drawn.views[0], geometries), edges };
  });
  for (const [i, edge] of overview.edges.entries()) expect(isSingleCubic(overview.lines[i][0].d), `overview ${edge.id}: ${overview.lines[i][0].d}`).toBe(true);
  const skip = overview.edges.findIndex(e => e.id === 'o-3'), skipGeometry = overview.geometries[skip], s0 = skipGeometry.scale, eps0 = 0.5 * s0;
  const [oTop, oWall, oBottom] = ['o-top', 'o-wall', 'o-bottom'].map(id => skipGeometry.nodes.find(n => n.id === id)!.box);
  const skipRoute = skipGeometry.routes[0];
  expect(sideOf(skipRoute[0], oTop), 'the overview line leaves the bottom of the first part').toBe('bottom');
  expect(sideOf(skipRoute.at(-1)!, oBottom), 'and enters the top of the last').toBe('top');
  expect(skipRoute.slice(1).some((p, k) => entersBox(skipRoute[k], p, oWall, 1e-7 * s0)), 'it passes through the box of the middle part').toBe(true);
  expect(Math.max(...skipRoute.map(p => Math.abs(p.x - (oWall.left + oWall.right) / 2))), 'and stays within the width of that part').toBeLessThan((oWall.right - oWall.left) / 2 + eps0);
  expect(overview.lines[skip][0].under, 'the middle part is drawn over the line').toContain('o-wall');
  expect(overview.independent.edgesOverParts, 'the overview lists the part behind').toContainEqual({ edge: 'o-3', node: 'o-wall' });
  expect(overview.independent.edgesOverParts.map(p => p.edge), 'only the hidden line is listed').toEqual(['o-3']);
  await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  const overviewShown = await settledReport(page);
  expect(overviewShown).toMatchObject({ view: 'overview', format: 'readme', parts: 3, connections: 3 });
  expect(overviewShown.overParts, 'the share dialog counts the line behind the part').toBe(overview.independent.edgesOverParts.length);
  await page.getByTestId('share-close').click();

  // The post: the same column, in the post's own style. The share dialog reports it first, in its own format.
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await page.getByTestId('share-button').click();
  const postShown = await settledReport(page);
  expect(postShown).toMatchObject({ parts: 3, connections: 3 });
  await page.getByTestId('share-close').click();

  const postSvg = join(dir, 'post.svg'), postDone = await cli(['svg', file, '--channel', 'linkedin', '--view', 'linkedin-post', '--format', postShown.format!, '--out', postSvg]);
  expect(postDone.code, postDone.stderr).toBe(0);
  const post = await inDrawingFonts(page, await readFile(postSvg, 'utf8'), async surface => {
    const view = drawn.post!, geometries = [], lines = [];
    for (const edge of view.edges) { geometries.push(await routeGeometry(surface, edge.id!, edge.from, edge.to)); lines.push(await edgeLine(surface, edge.id!)); }
    return { geometries, lines, independent: measuredRouteReport(view, geometries), edges: view.edges };
  });
  for (const [i, edge] of post.edges.entries()) expect(isSingleCubic(post.lines[i][0].d), `post ${edge.id}: ${post.lines[i][0].d}`).toBe(true);
  const hidden = post.edges.findIndex(e => e.id === 'p-3'), geometry = post.geometries[hidden], s = geometry.scale, eps = 0.5 * s;
  const [top, wall, bottom] = ['p-top', 'p-wall', 'p-bottom'].map(id => geometry.nodes.find(n => n.id === id)!.box);
  const route = geometry.routes[0], start = sideOf(route[0], top), end = sideOf(route.at(-1)!, bottom);

  // It leaves and enters by the same side, left or right, and not by the bottom and the top where it would be hidden.
  expect(['left', 'right'], `the post line leaves by a side of the first part (${start})`).toContain(start);
  expect(end, 'and enters the last part by the same side').toBe(start);
  // It is clear of the part between by at least 8 px, and the handles are the shortest that make it so: 24 px, so the curve
  // bulges 0.75 × 24 = 18 px beyond the parts' side at its middle.
  expect(routeToBox(route, wall), 'clear of the middle part by 8 px').toBeGreaterThanOrEqual(8 * s - eps);
  expect(route.slice(1).some((p, k) => entersBox(route[k], p, wall, 1e-7 * s)), 'it does not pass behind the middle part').toBe(false);
  const outward = start === 'right' ? Math.max(...route.map(p => p.x)) - top.right : top.left - Math.min(...route.map(p => p.x));
  expect(outward / s, 'the curve bulges out by 18 px: handles of 24 px').toBeGreaterThan(16.5);
  expect(outward / s, 'and no further').toBeLessThan(19.5);
  // The post's other two lines are not hidden and stay straight, bottom to top, on facing sides.
  for (const [id, from, to] of [['p-1', 'p-top', 'p-wall'], ['p-2', 'p-wall', 'p-bottom']] as const) {
    const g = post.geometries[post.edges.findIndex(e => e.id === id)];
    const a = g.nodes.find(n => n.id === from)!.box, b = g.nodes.find(n => n.id === to)!.box;
    expect(sideOf(g.routes[0][0], a), `${id} leaves the bottom`).toBe('bottom'); expect(sideOf(g.routes[0].at(-1)!, b), `${id} enters the top`).toBe('top');
  }
  // The label of the turned-out line stays within 10 px of it, or is left out.
  const labels = geometry.labels; expect(labels.length).toBeLessThanOrEqual(1);
  for (const label of labels) expect(routeToBox(route, label.box), 'the label is on its line').toBeLessThanOrEqual(10 * s + eps);
  // Nothing in the post is passed behind, and the share dialog's count agrees with the image.
  expect(post.independent.edgesOverParts, 'the post lists no part').toEqual([]);
  expect(postShown.overParts, 'the share dialog agrees').toBe(0);

  // Must not happen: the post's turn moving a part, or the overview's line being turned out.
  expect(positions(await readDocument(file)), 'stored positions never move').toEqual(positions(before));
  expect(sideOf(skipRoute[0], oTop), 'the overview line is still straight down').toBe('bottom');
});
