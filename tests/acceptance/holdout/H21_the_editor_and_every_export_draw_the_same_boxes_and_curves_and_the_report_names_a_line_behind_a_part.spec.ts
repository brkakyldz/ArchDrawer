import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import {
  drawingRepo, doc, choice, comp, rel, part, link, view, openDrawing, exportSvg, svgOnPage, drawn, expectSameDrawing, isOneCubic, overlap, readImage,
  stored, viewOf, nodeOf, drag, saved, type Drawn, type Point, type Box,
} from './helpers';

const product = useProduct();

function drawing() {
  return doc('Order flow', [choice('system', 'The whole system', 'system', {
    components: [
      comp('web', 'Web app', 'client', { sub: 'React' }), comp('mid', 'Order service', 'service', { sub: 'decides' }), comp('db', 'Orders DB', 'data', { sub: 'Postgres' }),
      comp('runtime', 'Order runtime', 'service'), comp('check', 'Check access', 'gate'), comp('relay', 'Order relay', 'worker', { items: ['Retry'] }),
    ],
    relations: [rel('r1', 'web', 'mid', { label: 'POST /orders' }), rel('r2', 'mid', 'db'), rel('r3', 'web', 'db', { style: 'dep' }),
      rel('r4', 'db', 'check', { style: 'async' }), rel('r5', 'check', 'relay')],
  }, [view('overview', 'Overview', [
    // Three parts in one row at stored positions: the line from the first to the third can only pass behind the second.
    part('web', { x: 40, y: 40 }), part('mid', { x: 360, y: 40 }), part('db', { x: 680, y: 40 }),
    part('runtime', { form: 'group', place: { row: 2, col: 1 } }), part('check', { form: 'compact', parent: 'runtime' }),
    part('relay', { form: 'panel', parent: 'runtime' }),
  ], [
    link('web', 'mid', ['r1'], 1, { id: 'e1' }), link('mid', 'db', ['r2'], 2, { id: 'e2' }), link('web', 'db', ['r3'], null, { id: 'e3' }),
    link('db', 'check', ['r4'], 3, { id: 'e4' }), link('check', 'relay', ['r5'], null, { id: 'e5' }),
  ])])]);
}

const sample = (q: Point[], n = 64) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return { x: u ** 3 * q[0].x + 3 * u * u * t * q[1].x + 3 * u * t * t * q[2].x + t ** 3 * q[3].x, y: u ** 3 * q[0].y + 3 * u * u * t * q[1].y + 3 * u * t * t * q[2].y + t ** 3 * q[3].y };
});
const behind = (route: Point[], b: Box) => sample(route).some(s => s.x > b.left + 1 && s.x < b.right - 1 && s.y > b.top + 1 && s.y < b.bottom - 1);
const cross = (a: Point, b: Point, c: Point, d: Point) => {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
// Our own measure of what the layout report counts (api contract, *Layout report*): each drawn line entering a part other than a group
// and its own ends, and each pair of lines without a shared end whose drawn curves cross.
function measure(geometry: Drawn, edges: { id: string; from: string; to: string }[], groups: string[]) {
  const over: string[] = [];
  for (const e of edges) {
    const route = geometry.edges[e.id]?.p; if (!route) continue;
    for (const [node, b] of Object.entries(geometry.nodes)) if (!groups.includes(node) && node !== e.from && node !== e.to && behind(route, b)) over.push(`${node}:${e.id}`);
  }
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = [edges[i], edges[j]];
    if ([a.from, a.to].some(n => n === b.from || n === b.to)) continue;
    const pa = sample(geometry.edges[a.id].p!), pb = sample(geometry.edges[b.id].p!);
    if (pa.some((q, k) => k > 0 && pb.some((r, m) => m > 0 && cross(pa[k - 1], q, pb[m - 1], r)))) crossings++;
  }
  return { over: over.sort(), crossings };
}
const tracesOf = (image: { nodes: { id: string; traces: string[] }[] }) => image.nodes.flatMap(n => n.traces.map(t => `${n.id}:${t}`)).sort();

// A developer checks that what they see in the editor is what they will share: every part's box and every connection's curve are the same
// in the editor, the share preview and the exported image; every connection is one smooth curve; no two parts overlap; a line that has to
// pass behind a part is listed by the report and leaves a trace over it, as our own measure finds. Once they move the part out of
// the way, that line is off the report.
test('H21 [LAYOUT-1 LAYOUT-2 LAYOUT-3 QUAL-2 SHARE-1 LOOK-4] the editor, the share preview and the export draw the same boxes and curves, a line behind a part is reported and traced as measured, and moving the part takes it off the report @smoke', async ({ page }) => {
  const p = product();
  const document = drawing();
  document.choices[0].channels.overview.showSteps = true;
  const { file } = await drawingRepo('parity', document);
  const id = await openDrawing(page, p, file);
  await page.getByTestId('zoom-fit').click();

  async function agree(when: string) {
    let exported: Drawn;
    const svg = await exportSvg(p, id, 'view=overview&format=readme');
    const image = await svgOnPage(page, svg);
    try { exported = await drawn(image.surface, 'web'); } finally { await image.close(); }
    const editor = await drawn(page.getByTestId('canvas'), 'web');
    expectSameDrawing(editor, exported!, `${when}: editor and export`);
    for (const [edgeId, e] of Object.entries(exported!.edges)) expect(isOneCubic(e.d), `${when}: ${edgeId} is one cubic: ${e.d}`).toBe(true);
    const parts = Object.entries(editor.nodes).filter(([n]) => n !== 'runtime');
    for (const [a, ab] of parts) for (const [b, bb] of parts) if (a < b) expect(overlap(ab, bb), `${when}: ${a} and ${b} overlap`).toBe(false);
    const v = viewOf(await stored(p, id), 'overview');
    const measured = measure(exported!, v.edges, v.nodes.filter((n: any) => n.form === 'group').map((n: any) => n.id));
    return { editor, svg, measured };
  }

  // As opened: the line web → db passes behind the order service, by our own measure, the report's and the trace's; every line the
  // report counts behind a part is one we measure there, and each leaves its trace over that part.
  const first = await agree('as opened');
  expect(first.measured.over, 'e3 meets the order service').toContain('mid:e3');
  const image = await readImage(page, first.svg);
  expect(image.nodes.find(n => n.id === 'mid')!.traces).toContain('e3');
  expect(tracesOf(image), 'a trace over every part a line passes behind, and nowhere else').toEqual(first.measured.over);
  expect(image.edges.find(e => e.id === 'e3')!.tone, 'a line without a step is neutral').toBe('neutral');
  expect(image.edges.find(e => e.id === 'e1')!.tone, 'a numbered line takes its kind colours').toBe('kind');
  // The group's head is drawn after every line, its name on a halo, and nothing is cut out of a line.
  const head = await page.evaluate(svg => {
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const all = Array.from(xml.querySelectorAll('g[data-edge-id], g[data-trunk], g[data-group-head]'));
    const h = xml.querySelector('g[data-group-head="runtime"]');
    const name = h ? Array.from(h.querySelectorAll('text')).find(t => (t.textContent ?? '').includes('Order runtime')) : null;
    return {
      found: !!h, afterLines: !!h && all.slice(all.indexOf(h) + 1).every(e => e.hasAttribute('data-group-head')),
      strokeWidth: name?.getAttribute('stroke-width') ?? null, paintOrder: name?.getAttribute('paint-order') ?? null,
      clipped: Array.from(xml.querySelectorAll('g[data-edge-id], g[data-edge-id] *')).some(e => e.hasAttribute('clip-path') || e.hasAttribute('mask')),
    };
  }, first.svg);
  expect(head).toEqual({ found: true, afterLines: true, strokeWidth: '4', paintOrder: 'stroke', clipped: false });
  await page.getByTestId('share-button').click();
  const report = page.getByTestId('share-dialog').getByTestId('layout-report');
  await expect(report).toHaveAttribute('data-over-parts', String(first.measured.over.length));
  await expect(report).toHaveAttribute('data-crossings', String(first.measured.crossings));
  await expect(report).toHaveAttribute('data-cut', '0');
  await expect(report).toHaveAttribute('data-format', 'readme');
  // The share preview is the export itself.
  const preview = await drawn(page.getByTestId('share-preview'), 'web');
  expectSameDrawing(preview, first.editor, 'share preview and editor');
  await page.getByTestId('share-close').click();
  await expect(page.getByTestId('share-dialog')).toHaveCount(0);

  // The user moves the order service up, out of the line's way. Nothing else moves; the report no longer counts that line.
  const was = viewOf(await stored(p, id), 'overview');
  await page.getByTestId('zoom-out').click(); await page.getByTestId('zoom-out').click(); // room above the drawing
  await drag(page, page.getByTestId('node-mid'), 0, -200);
  await saved(page);
  await expect.poll(async () => nodeOf(viewOf(await stored(p, id), 'overview'), 'mid').y).toBeLessThan(nodeOf(was, 'mid').y - 100);
  const now = viewOf(await stored(p, id), 'overview');
  for (const n of ['web', 'db']) expect([nodeOf(now, n).x, nodeOf(now, n).y], `${n} keeps its stored position`).toEqual([nodeOf(was, n).x, nodeOf(was, n).y]);
  const second = await agree('after the move');
  expect(second.measured.over).not.toContain('mid:e3');
  expect((await readImage(page, second.svg)).nodes.find(n => n.id === 'mid')!.traces, 'no trace once nothing is behind').toEqual([]);
  expect(tracesOf(await readImage(page, second.svg))).toEqual(second.measured.over);
  await page.getByTestId('share-button').click();
  await expect(report).toHaveAttribute('data-over-parts', String(second.measured.over.length));
  await expect(report).toHaveAttribute('data-crossings', String(second.measured.crossings));
  await expect(report).toHaveAttribute('data-cut', '0');
});
