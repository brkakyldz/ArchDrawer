import { test, expect, type Locator } from '@playwright/test';
import { workspaceRaw, openDrawing, register, settledReport, type Doc3 } from './helpers';
import { inDrawingFonts } from './helpers-svg-parity';
import { sketch, EDGE_NEUTRAL, lineStyle, imageOf, inspectImage, openShare, closeShare, positionsOf } from './helpers-drawing';

// Row one: left, wall, right, with a line from left to right that has to pass behind wall (lr), and a short line into wall (into).
// Row two: the same with an async line (lr2). Row three: a line that passes behind nothing (free).
function traceDoc(title: string, lrStep: number | null): Doc3 {
  return sketch(title, [
    { id: 'left', label: 'Left', x: 0, y: 0 }, { id: 'wall', label: 'Wall', x: 420, y: 0 }, { id: 'right', label: 'Right', x: 840, y: 0 },
    { id: 'l2', label: 'Left two', x: 0, y: 300 }, { id: 'w2', label: 'Wall two', x: 420, y: 300 }, { id: 'r2', label: 'Right two', x: 840, y: 300 },
    { id: 'u1', label: 'Open one', x: 0, y: 600 }, { id: 'u2', label: 'Open two', x: 840, y: 600 },
  ], [
    { id: 'lr', from: 'left', to: 'right', step: lrStep }, { id: 'into', from: 'left', to: 'wall' },
    { id: 'lr2', from: 'l2', to: 'r2', style: 'async' }, { id: 'free', from: 'u1', to: 'u2' },
  ]);
}
async function traceInfo(surface: Locator, edge: string) {
  return await surface.evaluate((el, id) => {
    const root = (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg')) as SVGSVGElement;
    const t = root.querySelector(`path.trace[data-edge-of="${id}"]`); if (!t) return null;
    const s = getComputedStyle(t);
    return { stroke: s.stroke, marker: t.hasAttribute('marker-end') || t.hasAttribute('marker-start') };
  }, edge);
}
const dashOf = (value: string) => value.replace(/px/g, '').replace(/\s+/g, '');

// LOOK-4: a line behind a part leaves a faint trace over it (1 px, opacity 0.25, its own dash, its own colour, under the text). LAYOUT-2 and LAYOUT-3: the line still
// passes behind the part and the layout report still lists it; a line that passes behind nothing has no trace.
test('H172 [LOOK-4 LAYOUT-2 LAYOUT-3 SHARE-1 #171] a line that passes behind a part leaves a faint trace of itself over that part in the editor and the image, and a line that passes behind nothing leaves none', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('trace-neutral', traceDoc('Trace neutral', null));
  const opened = await openDrawing(page, request, file);
  const before = await positionsOf(file);

  // The image, light: the trace is inside the part the line passes behind, after its outline and before its text.
  const svg = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme&theme=light');
  const info = await inspectImage(page, svg);
  const node = (id: string) => info.nodes.find(n => n.id === id)!;
  const traces = info.nodes.flatMap(n => n.traces.map(t => ({ ...t, in: n.id })));
  expect(traces.map(t => `${t.in}/${t.edge}`).sort(), 'a trace for each line behind a part, and for no other line').toEqual(['w2/lr2', 'wall/lr']);
  const trace = node('wall').traces[0];
  expect(trace.afterBody, 'after the outline').toBe(true); expect(trace.beforeText, 'before the text').toBe(true);
  expect(parseFloat(trace.strokeWidth), 'one pixel wide').toBeCloseTo(1, 2);
  expect(trace.opacity, 'at opacity 0.25').toBeCloseTo(0.25, 2);
  expect(dashOf(trace.dash), 'a solid line has a solid trace').toBe('none');
  expect(dashOf(node('w2').traces[0].dash), 'an async line has a dashed trace').toBe('6,5');
  expect(node('wall').texts, 'the text of the part is still drawn over the trace').toContain('Wall');
  for (const id of ['left', 'right', 'l2', 'r2', 'u1', 'u2']) expect(node(id).traces, `${id} is an end: no trace`).toEqual([]);
  expect(traces.some(t => t.edge === 'free' || t.edge === 'into'), 'no trace for a line that passes behind nothing or ends at the part').toBe(false);

  // The trace is the same path as the line, in the line's colour (neutral), with no arrowhead.
  await inDrawingFonts(page, svg, async surface => {
    const line = await lineStyle(surface, 'lr'), t = await traceInfo(surface, 'lr');
    expect(trace.d, 'the same path as the line').toBe(line.d);
    expect(t!.stroke, 'a neutral line leaves a neutral trace').toBe(EDGE_NEUTRAL.light);
    expect(t!.marker, 'no arrowhead on a trace').toBe(false);
  });
  // Dark: the same traces in the dark neutral colour.
  const dark = await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme&theme=dark');
  expect((await inspectImage(page, dark)).nodes.flatMap(n => n.traces.map(t => `${n.id}/${t.edge}`)).sort()).toEqual(['w2/lr2', 'wall/lr']);
  await inDrawingFonts(page, dark, async surface => { expect((await traceInfo(surface, 'lr'))!.stroke).toBe(EDGE_NEUTRAL.dark); });

  // The editor draws the same trace inside the same part, and none elsewhere.
  const canvas = page.getByTestId('canvas');
  await expect(page.getByTestId('node-wall').locator('path.trace[data-edge-of="lr"]')).toHaveCount(1);
  await expect(page.getByTestId('node-w2').locator('path.trace[data-edge-of="lr2"]')).toHaveCount(1);
  await expect(page.getByTestId('node-left').locator('path.trace')).toHaveCount(0);
  await expect(page.getByTestId('node-right').locator('path.trace')).toHaveCount(0);
  await expect(canvas.locator('path.trace[data-edge-of="free"], path.trace[data-edge-of="into"]')).toHaveCount(0);

  // The line is still behind the part and the report lists it: both blocked lines, and nothing else.
  await openShare(page);
  const shown = await settledReport(page);
  expect(shown).toMatchObject({ connections: 4, overParts: 2 });
  await closeShare(page);

  // A numbered line is in kind colours, and so is its trace.
  const numbered = await workspaceRaw('trace-kind', traceDoc('Trace kind', 1));
  const second = await register(request, numbered.file);
  const kindSvg = await imageOf(request, second.id, 'channel=overview&view=overview&format=readme&theme=light');
  expect((await inspectImage(page, kindSvg)).nodes.find(n => n.id === 'wall')!.traces.map(t => t.edge)).toEqual(['lr']);
  await inDrawingFonts(page, kindSvg, async surface => {
    const line = await lineStyle(surface, 'lr'), t = await traceInfo(surface, 'lr');
    expect(line.tone).toBe('kind');
    expect(t!.stroke, 'the trace of a numbered line is not neutral').not.toBe(EDGE_NEUTRAL.light);
  });

  // Must not happen: a part moving to clear a line, or looking at the drawing changing the file.
  expect(await positionsOf(file), 'stored positions never move').toEqual(before);
});
