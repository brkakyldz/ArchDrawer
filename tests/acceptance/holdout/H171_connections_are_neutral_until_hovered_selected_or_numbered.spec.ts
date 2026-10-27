import { test, expect, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { workspaceRaw, openDrawing, cli, saved, previewSVG, clickEdge, box } from './helpers';
import { inDrawingFonts } from './helpers-svg-parity';
import { sketch, EDGE_NEUTRAL, lineStyle, drawnRoutes, expectSameRoutes, expectSameBoxes, edgeSnaps, nodeSnaps, sameBox, settleEdges, imageOf,
  inspectImage, editorOnlyMarks, openShare, closeShare, type LineStyle } from './helpers-drawing';

// Six parts of six kinds and six connections: a plain call (e1), an async (e2), a dep (e3), one with a step (e4), a labelled one (e5) and a two-way one (e6).
const PARTS = [
  { id: 'a', label: 'Shop front', kind: 'client', x: 0, y: 0 }, { id: 'b', label: 'Order desk', kind: 'api', x: 420, y: 0 }, { id: 'c', label: 'Planner', kind: 'llm', x: 840, y: 0 },
  { id: 'd', label: 'Ledger', kind: 'data', x: 0, y: 320 }, { id: 'e', label: 'Checks', kind: 'service', x: 420, y: 320 }, { id: 'f', label: 'Nightly job', kind: 'worker', x: 840, y: 320 },
];
const EDGES = [
  { id: 'e1', from: 'a', to: 'b', style: 'call' }, { id: 'e2', from: 'b', to: 'c', style: 'async' }, { id: 'e3', from: 'd', to: 'e', style: 'dep' },
  { id: 'e4', from: 'e', to: 'f', style: 'call', step: 1 }, { id: 'e5', from: 'a', to: 'd', style: 'call', label: 'reads' }, { id: 'e6', from: 'c', to: 'f', style: 'call', both: true },
];
const IDS = EDGES.map(e => e.id);
const dashOf = (s: LineStyle) => s.dash.replace(/px/g, '').replace(/\s+/g, '');

// One look for one surface (the canvas or an exported image): the contracted colour, widths and dashes, and no start ring.
async function expectLook(surface: Locator, theme: 'light' | 'dark', what: string) {
  for (const edge of EDGES) {
    const s = await lineStyle(surface, edge.id);
    if (edge.step) {
      expect(s.tone, `${what}: ${edge.id} has a step`).toBe('kind');
      expect(s.stroke, `${what}: ${edge.id} is drawn in its kind colours`).not.toBe(EDGE_NEUTRAL[theme]);
      continue;
    }
    expect(s.tone, `${what}: ${edge.id}`).toBe('neutral');
    expect(s.stroke, `${what}: ${edge.id} is the theme neutral colour`).toBe(EDGE_NEUTRAL[theme]);
    expect(s.circles, `${what}: ${edge.id} has no start ring`).toBe(0);
    expect(parseFloat(s.strokeWidth), `${what}: ${edge.id} width`).toBeCloseTo(edge.style === 'dep' ? 1.9 : 1.75, 2);
    if (edge.style === 'call') expect(dashOf(s), `${what}: ${edge.id} is solid`).toBe('none');
    if (edge.style === 'async') expect(dashOf(s), `${what}: ${edge.id} is dashed 6 5`).toBe('6,5');
    if (edge.style === 'dep') { expect(dashOf(s), `${what}: ${edge.id} is dotted 2 5`).toBe('2,5'); expect(s.linecap, `${what}: ${edge.id} has round caps`).toBe('round'); }
  }
}
async function away(page: Page) { const c = await box(page.getByTestId('canvas')); await page.mouse.move(c.x + c.width - 6, c.y + c.height - 6); }
async function focused(page: Page) {
  const snaps = await edgeSnaps(page); return Object.entries(snaps).filter(([, s]) => s.focus).map(([id]) => id).sort();
}

// LOOK-4: lines are one neutral colour; kind colours come with a step or with focus (a hovered or selected part, a selected line; a hovered label: H173).
// SHARE-1: every export is neutral except the numbered line, and none carries the editor's marks.
test('H171 [LOOK-4 SHARE-1 #170] connections are neutral until a part or line is hovered or selected or the line is numbered, and every export draws the same neutral lines in light and dark', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { dir, file } = await workspaceRaw('calm-look', sketch('Calm look', PARTS, EDGES, { theme: 'light' }));
  const opened = await openDrawing(page, request, file);
  const canvas = page.getByTestId('canvas');
  await settleEdges(page);

  // As opened: every connection neutral, the numbered one in its kind colours, nothing in focus, no start ring.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');
  for (const id of IDS) await expect(page.getByTestId(`edge-${id}`)).not.toHaveAttribute('data-focus', 'true');
  await expectLook(canvas, 'light', 'the editor, light');
  expect(await focused(page)).toEqual([]);

  // Hovering a part puts its connections in focus (kind colours) and moves nothing; the others stay neutral.
  const pathsBefore = await edgeSnaps(page), boxesBefore = await nodeSnaps(page);
  await page.getByTestId('node-a').hover();
  for (const id of ['e1', 'e5']) { await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-focus', 'true'); await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-tone', 'kind'); }
  for (const id of ['e1', 'e5']) expect((await lineStyle(canvas, id)).stroke, `${id} in focus is not neutral`).not.toBe(EDGE_NEUTRAL.light);
  for (const id of ['e2', 'e3', 'e6']) { await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-tone', 'neutral'); await expect(page.getByTestId(`edge-${id}`)).not.toHaveAttribute('data-focus', 'true'); }
  expect(await focused(page)).toEqual(['e1', 'e5']);
  const pathsHover = await edgeSnaps(page), boxesHover = await nodeSnaps(page);
  for (const id of IDS) expect(pathsHover[id].d, `${id} does not move when in focus`).toBe(pathsBefore[id].d);
  for (const id of Object.keys(boxesBefore)) expect(sameBox(boxesHover[id], boxesBefore[id]), `${id} keeps its box`).toBe(true);
  await away(page);
  await expect(page.getByTestId('edge-e1')).not.toHaveAttribute('data-focus', 'true'); await expect(page.getByTestId('edge-e1')).toHaveAttribute('data-tone', 'neutral');
  // (Hovering a label lights its own line alone: H173.)

  // Selecting a line lights it; Escape clears it. Selecting a part lights its lines.
  await clickEdge(page, 'e2'); await away(page);
  await expect(page.getByTestId('edge-e2')).toHaveAttribute('data-selected', 'true'); await expect(page.getByTestId('edge-e2')).toHaveAttribute('data-focus', 'true');
  expect(await focused(page)).toEqual(['e2']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edge-e2')).not.toHaveAttribute('data-focus', 'true');
  await page.getByTestId('node-d').click(); await away(page);
  await expect(page.getByTestId('node-d')).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => focused(page)).toEqual(['e3', 'e5']);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toEqual([]);
  await expectLook(canvas, 'light', 'the editor, light, after the pointer left');
  const editorLight = await drawnRoutes(canvas, 'a');

  // Every export, light: only the numbered connection is in kind colours; the editor's marks are not drawn; no start ring.
  const exportLight = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme&theme=light');
  const asImage = async (svg: string, theme: 'light' | 'dark', what: string) => {
    const info = await inspectImage(page, svg);
    expect(Object.fromEntries(info.edges.map(e => [e.id, e.tone])), `${what}: tones`).toEqual({ e1: 'neutral', e2: 'neutral', e3: 'neutral', e4: 'kind', e5: 'neutral', e6: 'neutral' });
    expect(editorOnlyMarks(svg), `${what}: the editor's marks are not drawn`).toEqual([]);
    return await inDrawingFonts(page, svg, async surface => {
      await expectLook(surface, theme, what);
      const marks = await surface.evaluate(el => {
        const root = (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg')) as SVGSVGElement;
        const count = (id: string, a: string) => root.querySelectorAll(`g[data-edge-id="${id}"] [${a}], g[data-edge-id="${id}"][${a}]`).length;
        return { e1End: count('e1', 'marker-end'), e1Start: count('e1', 'marker-start'), e6End: count('e6', 'marker-end'), e6Start: count('e6', 'marker-start') };
      });
      // When arrowheads are markers: one at the `to` end of a one-way line, none at its start, one at each end of a two-way line.
      if (marks.e1End > 0) { expect(marks.e1Start, `${what}: a one-way line draws nothing at its start`).toBe(0); expect(marks.e6End).toBeGreaterThan(0); expect(marks.e6Start, `${what}: a two-way line has a head at each end`).toBeGreaterThan(0); }
      return await drawnRoutes(surface, 'a');
    });
  };
  const imageLight = await asImage(exportLight, 'light', 'export, light');
  expectSameRoutes(editorLight, imageLight, 'editor and export, light'); expectSameBoxes(editorLight, imageLight, 'editor and export, light');
  for (const id of IDS) expect(editorLight.edges[id].tone, `${id}: same tone in the editor and the export`).toBe(imageLight.edges[id].tone);

  // The share preview and the command line draw the same.
  await openShare(page); await asImage(await previewSVG(page), 'light', 'share preview'); await closeShare(page);
  const out = join(dir, 'look.svg'), written = await cli(['svg', file, '--format', 'readme', '--out', out]);
  expect(written.code, written.stderr).toBe(0);
  await asImage(await readFile(out, 'utf8'), 'light', 'archdrawer svg');

  // Dark: the neutral colour is the dark one, in the editor and in the image.
  await page.getByTestId('tool-theme').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await saved(page); await settleEdges(page);
  await expectLook(canvas, 'dark', 'the editor, dark');
  const darkSvg = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme&theme=dark');
  await asImage(darkSvg, 'dark', 'export, dark');

  // Must not happen: focus or tone kept in the file, or an export carrying the focus mark.
  const stored = await readFile(file, 'utf8');
  expect(stored).not.toMatch(/data-tone|data-focus|"tone"|"focus"|neutral/i);
  expect(exportLight).not.toContain('data-focus');
});
