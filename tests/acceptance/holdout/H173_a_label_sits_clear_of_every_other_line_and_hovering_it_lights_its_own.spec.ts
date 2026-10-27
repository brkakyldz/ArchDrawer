import { test, expect, type Locator, type Page } from '@playwright/test';
import { workspaceRaw, openDrawing, box } from './helpers';
import { inDrawingFonts, routeGeometry, overlapsBox, distanceToBox, type Box } from './helpers-svg-parity';
import { sketch, drawnRoutes, sampleCubic, imageOf, nodeRect, settleEdges, edgeSnaps, type Drawn } from './helpers-drawing';

// Two labelled lines cross in an X, so the middle of each curve is the crossing; a third, numbered line runs down the right.
const EDGES = [
  { id: 'nw-se', from: 'nw', to: 'se', label: 'north' }, { id: 'sw-ne', from: 'sw', to: 'ne', label: 'south' },
  { id: 'ne-se', from: 'ne', to: 'se', label: 'down', step: 1 },
];
const doc = () => sketch('Crossing labels', [
  { id: 'nw', label: 'Alpha', x: 0, y: 0 }, { id: 'sw', label: 'Bravo', x: 0, y: 520 }, { id: 'ne', label: 'Charlie', x: 900, y: 0 }, { id: 'se', label: 'Delta', x: 900, y: 520 },
], EDGES);

const nearestToBox = (points: { x: number; y: number }[], b: Box) => Math.min(...points.map(p => distanceToBox(p, b)));
// Labels in the units of `drawn` (drawing px from the top-left of `nw`): every drawn label clears every other line by 2 px, stays within 10 px of its own
// curve, and covers no part and no other label. At least one is drawn.
function expectLabelsClear(drawn: Drawn, labels: Record<string, Box | null>, what: string) {
  const shown = Object.entries(labels).filter((entry): entry is [string, Box] => !!entry[1]);
  expect(shown.length, `${what}: a label is drawn`).toBeGreaterThanOrEqual(1);
  for (const [id, label] of shown) {
    const grown = { left: label.left - 2, right: label.right + 2, top: label.top - 2, bottom: label.bottom + 2 };
    for (const [other, route] of Object.entries(drawn.edges)) {
      if (other === id) continue;
      expect(nearestToBox(sampleCubic(route.p, 400), grown), `${what}: the label of ${id} touches the line ${other}`).toBeGreaterThan(0);
    }
    expect(nearestToBox(sampleCubic(drawn.edges[id].p, 400), label), `${what}: the label of ${id} is on its own line`).toBeLessThanOrEqual(10.5);
    for (const [part, b] of Object.entries(drawn.nodes)) expect(overlapsBox(label, b), `${what}: the label of ${id} covers ${part}`).toBe(false);
    for (const [otherId, other] of shown) if (otherId !== id) expect(overlapsBox(label, other), `${what}: the labels of ${id} and ${otherId} overlap`).toBe(false);
  }
}
async function editorLabels(page: Page, drawn: Drawn): Promise<Record<string, Box | null>> {
  const anchor = await nodeRect(page, 'nw'), out: Record<string, Box | null> = {};
  for (const e of EDGES) {
    const label = page.getByTestId(`edge-label-${e.id}`);
    if (!await label.count()) { out[e.id] = null; continue; }
    const b = await box(label);
    out[e.id] = { left: (b.x - anchor.x) / drawn.scale, right: (b.x + b.width - anchor.x) / drawn.scale, top: (b.y - anchor.y) / drawn.scale, bottom: (b.y + b.height - anchor.y) / drawn.scale };
  }
  return out;
}
// The border of the label of each connection in an exported image: the first rect around its text.
async function imageBorders(surface: Locator) {
  return await surface.evaluate((el, edges) => {
    const root = (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg')) as SVGSVGElement, out: Record<string, string> = {};
    for (const e of edges) {
      const g = root.querySelector(`g[data-edge-id="${e.id}"]`); const text = g ? Array.from(g.querySelectorAll('text')).find(t => (t.textContent ?? '').trim() === e.label) : null;
      let rect: Element | null = null;
      for (let p: Element | null = text ?? null; p && p !== g && !rect; p = p.parentElement) rect = p.querySelector('rect');
      out[e.id] = rect ? getComputedStyle(rect).stroke : 'no-label';
    }
    return out;
  }, EDGES.map(e => ({ id: e.id, label: e.label })));
}
async function labelBorder(page: Page, id: string) {
  return await page.getByTestId(`edge-label-${id}`).evaluate(el => { const r = el.tagName.toLowerCase() === 'rect' ? el : el.querySelector('rect'); return r ? getComputedStyle(r).stroke : 'no-rect'; });
}

// LOOK-4: a label takes a spot off every other line and belongs to its own; hovering it lights its connection. SHARE-1: the image places its labels the same way.
test('H173 [LOOK-4 SHARE-1 #172] a label sits clear of every other line and on its own, in the editor and the image, and hovering a label lights its own connection without moving it', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('label-spots', doc());
  const opened = await openDrawing(page, request, file);
  await settleEdges(page);

  // The image, readme: labels clear of the crossing line.
  const svg = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme');
  const exported = await inDrawingFonts(page, svg, async surface => {
    const geometries: Record<string, Awaited<ReturnType<typeof routeGeometry>>> = {};
    for (const e of EDGES) geometries[e.id] = await routeGeometry(surface, e.id, e.from, e.to);
    return { geometries, drawn: await drawnRoutes(surface, 'nw'), borders: await imageBorders(surface) };
  });
  const anchorOf = (id: string) => { const g = exported.geometries[id]; return { s: g.scale, a: g.nodes.find(n => n.id === 'nw')!.box }; };
  const imageLabels: Record<string, Box | null> = {};
  for (const e of EDGES) {
    const { s, a } = anchorOf(e.id), label = exported.geometries[e.id].labels.find(l => l.text.includes(e.label));
    imageLabels[e.id] = label ? { left: (label.box.left - a.left) / s, right: (label.box.right - a.left) / s, top: (label.box.top - a.top) / s, bottom: (label.box.bottom - a.top) / s } : null;
  }
  expectLabelsClear(exported.drawn, imageLabels, 'the image');
  // The label of a numbered line is bordered in a colour of its own; the two neutral lines share one border colour.
  expect(exported.borders['nw-se']).not.toBe('no-label'); expect(exported.borders['ne-se']).not.toBe('no-label');
  expect(exported.borders['sw-ne'], 'neutral lines share one label border').toBe(exported.borders['nw-se']);
  expect(exported.borders['ne-se'], 'a numbered line has its own label border').not.toBe(exported.borders['nw-se']);

  // The editor: the same property on screen, in the same units.
  const drawn = await drawnRoutes(page.getByTestId('canvas'), 'nw');
  const shownLabels = await editorLabels(page, drawn);
  expectLabelsClear(drawn, shownLabels, 'the editor');

  // Hovering a label lights its own connection and nothing else; the label does not move and its border takes the line colour.
  const hovered = EDGES.slice(0, 2).find(e => shownLabels[e.id])!;
  const other = EDGES.slice(0, 2).find(e => e.id !== hovered.id)!;
  const labelBox = page.getByTestId(`edge-label-${hovered.id}`);
  const boxBefore = await box(labelBox), borderBefore = await labelBorder(page, hovered.id), pathsBefore = await edgeSnaps(page);
  await labelBox.hover();
  await expect(page.getByTestId(`edge-${hovered.id}`)).toHaveAttribute('data-focus', 'true');
  await expect(page.getByTestId(`edge-${hovered.id}`)).toHaveAttribute('data-tone', 'kind');
  await expect(page.getByTestId(`edge-${other.id}`)).toHaveAttribute('data-tone', 'neutral');
  await expect(page.getByTestId(`edge-${other.id}`)).not.toHaveAttribute('data-focus', 'true');
  const focused = Object.entries(await edgeSnaps(page)).filter(([, s]) => s.focus).map(([id]) => id).sort();
  expect(focused, 'exactly the hovered label\'s line is in focus, of every line').toEqual([hovered.id]);
  expect(await labelBorder(page, hovered.id), 'the border takes the line colour').not.toBe(borderBefore);
  const boxHover = await box(labelBox);
  expect(Math.abs(boxHover.x - boxBefore.x) + Math.abs(boxHover.y - boxBefore.y) + Math.abs(boxHover.width - boxBefore.width) + Math.abs(boxHover.height - boxBefore.height), 'the label does not move or grow').toBeLessThanOrEqual(0.5);
  const pathsHover = await edgeSnaps(page);
  for (const e of EDGES) expect(pathsHover[e.id].d, `${e.id} does not move when its label is hovered`).toBe(pathsBefore[e.id].d);
  const away = await box(page.getByTestId('canvas'));
  await page.mouse.move(away.x + away.width - 6, away.y + away.height - 6);
  await expect(page.getByTestId(`edge-${hovered.id}`)).not.toHaveAttribute('data-focus', 'true');
  await expect(page.getByTestId(`edge-${hovered.id}`)).toHaveAttribute('data-tone', 'neutral');
  expect(await labelBorder(page, hovered.id)).toBe(borderBefore);

  // Must not happen: the hover or the label spots touching the file's connections or positions.
  const stored = await (await request.get(`http://127.0.0.1:${process.env.ARCHDRAW_HOLDOUT_PORT}/api/diagrams/${opened.id}`)).json();
  const view = (stored.choices ? stored.choices[0].channels : stored.channels).overview.views[0];
  expect(view.edges.map((e: { id: string }) => e.id)).toEqual(EDGES.map(e => e.id));
  expect(view.nodes.map((n: { id: string; x: number; y: number }) => [n.id, n.x, n.y])).toEqual([['nw', 0, 0], ['sw', 0, 520], ['ne', 900, 0], ['se', 900, 520]]);
});
