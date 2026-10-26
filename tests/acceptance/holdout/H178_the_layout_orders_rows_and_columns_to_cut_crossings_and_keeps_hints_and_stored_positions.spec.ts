import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { workspaceRaw, openDrawing, cli, settledReport, type Doc3 } from './helpers';
import { inDrawingFonts, crossingWitness } from './helpers-svg-parity';
import { sketch, positionsOf, nodeOf, readView, drawnRoutes, sampleCubic, imageOf, openShare, closeShare, type Drawn, type SketchEdge, type SketchPart } from './helpers-drawing';

// A main path m1 -> m2 -> m3 -> m4 (steps 1-3, placed on one row) and four movable parts, each connected to one main-path part. The
// movable parts are listed in the reverse order of their neighbours, or in the same order.
function ladder(title: string, reversed: boolean): Doc3 {
  const main: SketchPart[] = [1, 2, 3, 4].map(i => ({ id: `m${i}`, place: { row: 0, col: i - 1 } }));
  const movable: SketchPart[] = [1, 2, 3, 4].map(i => ({ id: `x${i}` })), links: SketchEdge[] = [1, 2, 3, 4].map(i => ({ id: `l${i}`, from: `x${i}`, to: `m${i}` }));
  const steps: SketchEdge[] = [1, 2, 3].map(i => ({ id: `mp${i}`, from: `m${i}`, to: `m${i + 1}`, step: i }));
  return sketch(title, [...main, ...(reversed ? [...movable].reverse() : movable)], [...steps, ...(reversed ? [...links].reverse() : links)]);
}
const LADDER_EDGES = [1, 2, 3].map(i => ({ id: `mp${i}`, from: `m${i}`, to: `m${i + 1}` })).concat([1, 2, 3, 4].map(i => ({ id: `l${i}`, from: `x${i}`, to: `m${i}` })));

function count(drawn: Drawn, metas: { id: string; from: string; to: string }[]) {
  let n = 0;
  for (let i = 0; i < metas.length; i++) for (let j = i + 1; j < metas.length; j++) {
    const a = metas[i], b = metas[j];
    if ([a.from, a.to].some(id => id === b.from || id === b.to)) continue;
    if (crossingWitness(sampleCubic(drawn.edges[a.id].p), sampleCubic(drawn.edges[b.id].p), 32)) n++;
  }
  return n;
}
// Writes the document where the server can read it, then opens it with the command, which lays out every part without a position.
async function laidOut(id: string, doc: Doc3) {
  const made = await workspaceRaw(id, doc);
  const opened = await cli(['open', made.file, '--no-browser']); expect(opened.code, opened.stderr).toBe(0);
  return made;
}

// LAYOUT-6 (#175): barycentre sweeps reorder the parts the layout places, empty rows and columns close, the report's crossings never go up.
// LAYOUT-2: stored positions never move. LAYOUT-1: the same file is always laid out the same way.
test('H178 [LAYOUT-6 LAYOUT-2 LAYOUT-1 #175] the layout orders the parts it places to cut crossings, closes empty columns, keeps place hints, step order and stored positions, and gives the same layout for the same file', async ({ page, request }) => {
  test.setTimeout(300_000);

  // (a) Determinism: two files with identical content are laid out identically.
  const one = await laidOut('layout-one', ladder('Ladder', true)), two = await laidOut('layout-two', ladder('Ladder', true));
  const first = await positionsOf(one.file);
  for (const [, x, y] of first) { expect(Number.isFinite(x) && Number.isFinite(y), 'every part was placed').toBe(true); }
  expect(await positionsOf(two.file), 'the same file gets the same layout').toEqual(first);
  // (b) Place hints and the main path hold although the movable parts were reordered.
  const at = Object.fromEntries(first.map(([id, x, y]) => [id, { x: x!, y: y! }]));
  for (const i of [1, 2, 3]) expect(at[`m${i}`].x, `m${i} is left of m${i + 1}`).toBeLessThan(at[`m${i + 1}`].x);
  expect(new Set([1, 2, 3, 4].map(i => at[`m${i}`].y)).size, 'the placed main path is one row').toBe(1);
  const view = await readView(one.file);
  expect(view.nodes.filter(n => n.id.startsWith('m')).map(n => n.place), 'place hints are never rewritten').toEqual([0, 1, 2, 3].map(col => ({ row: 0, col })));

  // The same for a 2 x 2 block of hints, with a main path of parts that have none and two movable parts in the wrong order.
  const block = await laidOut('layout-block', sketch('Block', [
    { id: 'p00', place: { row: 0, col: 0 } }, { id: 'p01', place: { row: 0, col: 1 } }, { id: 'p10', place: { row: 1, col: 0 } }, { id: 'p11', place: { row: 1, col: 1 } },
    { id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }, { id: 'r2' }, { id: 'r1' },
  ], [{ id: 'k1', from: 'q1', to: 'q2', step: 1 }, { id: 'k2', from: 'q2', to: 'q3', step: 2 }, { id: 'k3', from: 'q3', to: 'q4', step: 3 },
    { id: 'k4', from: 'r2', to: 'q4' }, { id: 'k5', from: 'r2', to: 'q2' }, { id: 'k6', from: 'r1', to: 'q3' }, { id: 'k7', from: 'r1', to: 'q1' }]));
  const b = Object.fromEntries((await positionsOf(block.file)).map(([id, x, y]) => [id, { x: x!, y: y! }]));
  expect(b.p00.x).toBeLessThan(b.p01.x); expect(b.p10.x).toBeLessThan(b.p11.x); expect(b.p00.y).toBeLessThan(b.p10.y); expect(b.p01.y).toBeLessThan(b.p11.y);
  for (const i of [1, 2, 3]) expect(b[`q${i}`].x, `the main path keeps its step order: q${i} before q${i + 1}`).toBeLessThan(b[`q${i + 1}`].x);

  // A stored position never moves, also when a part is added to the file later.
  const kept = await laidOut('layout-kept', sketch('Kept', [{ id: 'fixed', x: 400, y: 240 }, { id: 'near' }, { id: 'far' }], [{ id: 'n1', from: 'near', to: 'fixed' }, { id: 'n2', from: 'far', to: 'near' }]));
  const placed = await positionsOf(kept.file);
  expect(placed.find(p => p[0] === 'fixed')!.slice(1), 'a stored position stays').toEqual([400, 240]);
  const raw = JSON.parse(await readFile(kept.file, 'utf8')), target = raw.choices ? raw.choices[0] : raw, v = target.channels.overview.views[0];
  target.facts.components.push({ id: 'late', label: 'late', kind: 'service', sub: '', description: 'Handles late.', files: [], items: [] });
  v.nodes.push({ id: 'late', facts: ['late'], form: 'card', icon: null, parent: null, detail: null, place: null });
  v.edges.push({ id: 'late-1', from: 'late', to: 'fixed', relations: [], step: null, label: '', style: 'call', both: false });
  await writeFile(kept.file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  const again = await cli(['open', kept.file, '--no-browser']); expect(again.code, again.stderr).toBe(0);
  const later = await positionsOf(kept.file);
  for (const [id, x, y] of placed) expect(later.find(p => p[0] === id)!.slice(1), `${id} did not move when a part was added`).toEqual([x, y]);
  const late = later.find(p => p[0] === 'late')!; expect(Number.isFinite(late[1]) && Number.isFinite(late[2]), 'the new part was placed').toBe(true);

  // (c) Compaction: empty columns and rows close, and the hints themselves are not rewritten.
  const wide = await laidOut('layout-wide', sketch('Gap', [{ id: 'a', place: { row: 0, col: 0 } }, { id: 'b', place: { row: 0, col: 6 } }]));
  const near = await laidOut('layout-near', sketch('Gap', [{ id: 'a', place: { row: 0, col: 0 } }, { id: 'b', place: { row: 0, col: 1 } }]));
  expect(await positionsOf(wide.file), 'columns 1 to 5 are empty and closed').toEqual(await positionsOf(near.file));
  expect((await nodeOf(wide.file, 'b')).place, 'the hint stays col 6').toEqual({ row: 0, col: 6 });
  const tall = await laidOut('layout-tall', sketch('Gap', [{ id: 'a', place: { row: 0, col: 0 } }, { id: 'b', place: { row: 6, col: 0 } }]));
  const short = await laidOut('layout-short', sketch('Gap', [{ id: 'a', place: { row: 0, col: 0 } }, { id: 'b', place: { row: 1, col: 0 } }]));
  expect(await positionsOf(tall.file), 'rows 1 to 5 are empty and closed').toEqual(await positionsOf(short.file));

  // (d) Crossings: the ladder in reverse order has none, and never more than the same graph in sorted order.
  const sorted = await laidOut('layout-sorted', ladder('Ladder', false));
  const measured: Record<string, { report: number; independent: number }> = {};
  for (const [name, made] of [['reversed', one], ['sorted', sorted]] as const) {
    const opened = await openDrawing(page, request, made.file);
    await openShare(page); const report = await settledReport(page); await closeShare(page);
    const drawn = await inDrawingFonts(page, await imageOf(request, opened.id), surface => drawnRoutes(surface, 'm1'));
    measured[name] = { report: report.crossings, independent: count(drawn, LADDER_EDGES) };
    expect(report.crossings, `${name}: the report equals a count over the image`).toBe(measured[name].independent);
  }
  expect(measured.reversed.report, 'a ladder listed in reverse order is laid out without crossings').toBe(0);
  expect(measured.reversed.report, 'crossings never go up').toBeLessThanOrEqual(measured.sorted.report);

  // Must not happen: opening again moving a part, or the hints rewritten.
  const reopened = await cli(['open', one.file, '--no-browser']); expect(reopened.code, reopened.stderr).toBe(0);
  expect(await positionsOf(one.file), 'a second open moves nothing').toEqual(first);
});
