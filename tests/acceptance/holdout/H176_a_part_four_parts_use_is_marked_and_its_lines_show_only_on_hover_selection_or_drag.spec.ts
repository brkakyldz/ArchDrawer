import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRaw, openDrawing, register, cli, box, startKind, finishRun, settledReport } from './helpers';
import { inDrawingFonts, crossingWitness } from './helpers-svg-parity';
import { sketch, readView, drawnRoutes, expectSameRoutes, sampleCubic, imageOf, inspectImage, openShare, closeShare, settleEdges, edgeSnaps, nodeSnaps, sameBox, pickUp, type Drawn } from './helpers-drawing';

const HUB_USERS = ['u1', 'u2', 'u3', 'u4', 'u5'];
const PARTS = [
  { id: 'hub', x: 500, y: 400 }, { id: 'u1', x: 100, y: 100 }, { id: 'u2', x: 500, y: 100 }, { id: 'u3', x: 900, y: 100 }, { id: 'u4', x: 100, y: 650 }, { id: 'u5', x: 900, y: 650 },
  { id: 'hub2', x: 1500, y: 400 }, { id: 'w1', x: 1300, y: 100 }, { id: 'w2', x: 1700, y: 100 }, { id: 'w3', x: 1500, y: 700 },
];
const EDGES = [
  { id: 'a1', from: 'u1', to: 'hub', label: 'in-one' }, { id: 'a2', from: 'u2', to: 'hub', label: 'in-two' }, { id: 'a3', from: 'u3', to: 'hub', label: 'in-three' },
  { id: 'a4', from: 'u4', to: 'hub', label: 'in-four', both: true }, { id: 'a5', from: 'u5', to: 'hub', step: 1 },
  { id: 'g1', from: 'w1', to: 'hub2' }, { id: 'g2', from: 'w2', to: 'hub2' }, { id: 'g3', from: 'w3', to: 'hub2' },
];
const HIDDEN = ['a1', 'a2', 'a3', 'a4'], DRAWN = ['a5', 'g1', 'g2', 'g3'];

function crossings(drawn: Drawn) {
  const metas = EDGES.filter(e => drawn.edges[e.id]); let n = 0;
  for (let i = 0; i < metas.length; i++) for (let j = i + 1; j < metas.length; j++) {
    const a = metas[i], b = metas[j];
    if ([a.from, a.to].some(id => id === b.from || id === b.to)) continue;
    if (crossingWitness(sampleCubic(drawn.edges[a.id].p), sampleCubic(drawn.edges[b.id].p), 32)) n++;
  }
  return n;
}
const only = (d: Drawn, ids: string[]): Drawn => ({ ...d, edges: Object.fromEntries(Object.entries(d.edges).filter(([id]) => ids.includes(id))), trunks: [] });
async function away(page: Page) { const c = await box(page.getByTestId('canvas')); await page.mouse.move(c.x + 4, c.y + c.height - 4); }
async function hiddenIs(page: Page, ids: string[], hidden: boolean) {
  await expect.poll(async () => { const s = await edgeSnaps(page); return ids.every(id => s[id].hidden === hidden); }, { message: `${ids.join(',')} hidden=${hidden}` }).toBe(true);
}

// LOOK-4 (#186): a part four or more parts use carries `used by N` and the lines from its users that have no step are hidden in the
// editor and in every export; the editor shows them while an end is hovered, selected or dragged. LAYOUT-3: the report counts what is
// drawn. EDIT-2: the callout still lists every connection.
test('H176 [LOOK-4 LAYOUT-3 EDIT-2 #186] a part five parts use is marked used by 5 and its lines from them are not drawn but a step line is, the lines show on hover selection and drag, and the report counts only what is drawn', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { dir, file } = await workspaceRaw('hub', sketch('Hub', PARTS, EDGES));
  const opened = await register(request, file);

  // The image: the mark on the hub only, the step line and the three lines into the three-user part drawn, the other four not.
  const svg = await imageOf(request, opened.id), info = await inspectImage(page, svg);
  expect(info.nodes.filter(n => n.usedBy).map(n => n.id), 'only the hub is marked').toEqual(['hub']);
  expect(info.nodes.find(n => n.id === 'hub')!.usedBy).toEqual({ count: '5', text: 'used by 5' });
  expect(info.edges.map(e => e.id).sort(), 'the hidden lines are not drawn, a step line is').toEqual([...DRAWN].sort());
  expect(info.words.join(' | '), 'a hidden line has no label').not.toMatch(/in-(one|two|three|four)/);
  const out = join(dir, 'hub.svg'), written = await cli(['svg', file, '--format', 'readme', '--out', out]); expect(written.code, written.stderr).toBe(0);
  const fromCommand = await inspectImage(page, await readFile(out, 'utf8'));
  expect(fromCommand.edges.map(e => e.id).sort()).toEqual([...DRAWN].sort());
  expect(fromCommand.nodes.find(n => n.id === 'hub')!.usedBy).toEqual({ count: '5', text: 'used by 5' });

  // The facts are unchanged: every connection is still in the file.
  expect((await readView(file)).edges.map(e => e.id).sort(), 'the file keeps every connection').toEqual(EDGES.map(e => e.id).sort());

  // The report counts the drawn connections, and its crossings equal a count over the drawn lines only.
  const exported = await inDrawingFonts(page, svg, surface => drawnRoutes(surface, 'hub'));
  const independent = crossings(exported);
  const run = await finishRun(request, await startKind(request, opened.token, { diagramId: opened.id, view: 'overview', kind: 'refine', instruction: 'Observe the existing drawing',
    format: 'readme', engine: 'fixture', model: null, scope: { kind: 'view' } }), 'succeeded', 60_000);
  expect(run.layoutReport.counts.connections, 'a hidden connection is not counted').toBe(4);
  expect(run.layoutReport.crossings).toBe(independent);
  for (const entry of run.layoutReport.edgesOverParts as { edge: string }[]) expect(HIDDEN, 'a hidden connection is never listed').not.toContain(entry.edge);

  // The editor: the mark, the four hidden lines with no label, and the same lines as the image.
  await openDrawing(page, request, file);
  await settleEdges(page);
  const pill = page.getByTestId('node-hub').getByTestId('node-used-by');
  await expect(pill).toHaveAttribute('data-count', '5'); await expect(pill).toHaveText('used by 5');
  await expect(page.getByTestId('node-hub2').getByTestId('node-used-by')).toHaveCount(0);
  await hiddenIs(page, HIDDEN, true);
  for (const id of HIDDEN) { await expect(page.getByTestId(`edge-label-${id}`), `no label for ${id}`).toHaveCount(0); await expect(page.getByTestId(`step-badge-${id}`)).toHaveCount(0); }
  const rest = await edgeSnaps(page);
  for (const id of DRAWN) { expect(rest[id].hidden, id).toBe(false); expect(rest[id].focus, id).toBe(false); }
  expect(rest.a5.tone, 'a step line is coloured').toBe('kind'); expect(rest.g1.tone).toBe('neutral');
  const editorBefore = only(await drawnRoutes(page.getByTestId('canvas'), 'hub'), DRAWN);
  expectSameRoutes(editorBefore, only(exported, DRAWN), 'editor and image');
  const nodesBefore = await nodeSnaps(page), snapsBefore = await edgeSnaps(page);

  // Hovering the hub shows its four lines, in focus and coloured, and nothing else moves.
  await page.getByTestId('node-hub').hover();
  await hiddenIs(page, HIDDEN, false);
  const hovered = await edgeSnaps(page);
  for (const id of HIDDEN) { expect(hovered[id].focus, `${id} is in focus`).toBe(true); expect(hovered[id].tone).toBe('kind'); }
  for (const id of ['g1', 'g2', 'g3']) { expect(hovered[id].d, `${id} did not move`).toBe(snapsBefore[id].d); 
    // g1–g3 have no label: none appears on hover (both null); a label there would have to stay where it was.
    if (snapsBefore[id].label === null) expect(hovered[id].label, `${id} grew no label`).toBeNull(); else expect(sameBox(hovered[id].label, snapsBefore[id].label), `${id} label`).toBe(true); }
  expect(hovered.a5.d, 'the step line did not move').toBe(snapsBefore.a5.d);
  const nodesHover = await nodeSnaps(page); for (const id of Object.keys(nodesBefore)) expect(sameBox(nodesBefore[id], nodesHover[id]), `${id} did not move`).toBe(true);
  expectSameRoutes(only(await drawnRoutes(page.getByTestId('canvas'), 'hub'), DRAWN), editorBefore, 'showing the lines moves nothing');

  // Hovering the mark is hovering the part.
  await away(page); await hiddenIs(page, HIDDEN, true);
  await pill.hover(); await hiddenIs(page, HIDDEN, false);

  // Hovering a user shows its own line only.
  await away(page); await hiddenIs(page, HIDDEN, true);
  await page.getByTestId('node-u1').hover(); await hiddenIs(page, ['a1'], false);
  expect((await edgeSnaps(page)).a2.hidden, 'the line of another user stays hidden').toBe(true);

  // Selecting the hub shows them, also with the pointer away; its callout lists a chip for every user, hidden line or not.
  await away(page); await hiddenIs(page, HIDDEN, true);
  await page.getByTestId('node-hub').click();
  const callout = page.getByTestId('callout-hub'); await expect(callout).toBeVisible();
  await away(page); await hiddenIs(page, HIDDEN, false);
  const chips = await callout.locator('[data-testid^="callout-link-"]').evaluateAll(els => els.map(e => (e.getAttribute('data-testid') ?? '').slice('callout-link-'.length)).sort());
  expect(chips, 'every user is listed').toEqual(HUB_USERS);
  await page.keyboard.press('Escape'); await hiddenIs(page, HIDDEN, true);

  // Dragging a user shows its line while the pointer is down.
  const held = await pickUp(page, 'u3'); await held.by(30, 30);
  await hiddenIs(page, ['a3'], false); expect((await edgeSnaps(page)).a2.hidden, 'only the dragged part line shows').toBe(true);
  await held.release();
  await settleEdges(page);

  // The report in the dialog counts what is drawn too.
  await away(page); await openShare(page); const report = await settledReport(page);
  expect(report.connections, 'the dialog counts four drawn connections').toBe(4);
  await closeShare(page);

  // Must not happen: a hidden line in the image, counted in the report, or taken out of the file.
  expect(info.edges.map(e => e.id)).not.toContain('a1');
  expect((await readView(file)).edges.map(e => e.id)).toEqual(expect.arrayContaining(HIDDEN));
});
