import { test, expect } from '@playwright/test';
import { component, drawing, workspace, cli, openDrawing, readDrawing, svgInfo, overlaps, baseURL } from './helpers';

test('H51 [LAY-5, DEP-5, LAY-2, CLI-2] lay out an ordinary view by its lanes: three side parts of one anchor spread across neighbouring columns', async ({ page, request }) => {
  const doc = drawing('Spread shop'), view = doc.views[0];
  view.caption = { title: 'How three checks sit beside one step', lede: '' };
  // Nothing has a position: `archdrawer open` must place every one of them, by lane, not by place.
  view.nodes = [
    component('front', { label: 'Front door', kind: 'client', lane: { spine: 0 } }),
    component('intake', { label: 'Intake', kind: 'api', form: 'panel', items: ['Check it'], lane: { spine: 1 } }),
    component('store', { label: 'Store', kind: 'data', sub: 'Postgres', lane: { spine: 2 } }),
    component('check-a', { label: 'Check A', kind: 'gate', lane: { anchor: 'intake', side: 'below' } }),
    component('check-b', { label: 'Check B', kind: 'gate', lane: { anchor: 'intake', side: 'below' } }),
    // The same side lane, plus a `place` hint that points the opposite way: diagram-v2 says the
    // non-null lane takes precedence over `place` for a component that has to be placed.
    component('check-c', { label: 'Check C', kind: 'gate', lane: { anchor: 'intake', side: 'below' }, place: { row: -3, col: -5 } }),
    component('watcher', { label: 'Watcher', kind: 'ops', lane: { anchor: 'front', side: 'above' } }),
  ];
  view.edges = [
    { id: 'm1', from: 'front', to: 'intake', label: 'Ask', style: 'call', both: false, step: 1 },
    { id: 'm2', from: 'intake', to: 'store', label: 'Keep it', style: 'call', both: false, step: 2 },
    { id: 's1', from: 'intake', to: 'check-a', label: '', style: 'dep', both: false, step: null },
    { id: 's2', from: 'intake', to: 'check-b', label: '', style: 'dep', both: false, step: null },
    { id: 's3', from: 'intake', to: 'check-c', label: '', style: 'dep', both: false, step: null },
    { id: 'w1', from: 'front', to: 'watcher', label: '', style: 'dep', both: false, step: null },
  ];
  const { file } = await workspace('spread', doc);
  // Side lanes on unpositioned components are a valid session file, repaired by nothing.
  const validated = await cli(['validate', file]);
  expect(validated.code, validated.stderr).toBe(0);
  expect(validated.stdout).toMatch(/^valid/m);
  // `archdrawer open` validates, normalises and lays the file out, then writes it back.
  const cliOpen = await cli(['open', file, '--no-browser']);
  expect(cliOpen.code, cliOpen.stderr).toBe(0);
  expect(cliOpen.stdout.trim().split(/\r?\n/).at(-1)).toMatch(/http:\/\/127\.0\.0\.1:\d+\/d\/d_[a-z0-9]+/);
  const opened = await openDrawing(page, request, file);
  const normalised = await readDrawing(file), placed = normalised.views[0];
  expect(normalised.warnings).toEqual([]); // Defaulted `lane`/`from` never warn, and nothing was repaired.

  // Every component was laid out, and its relation came through the file untouched.
  for (const original of view.nodes) {
    const node = placed.nodes.find(n => n.id === original.id)!;
    expect(node.lane, original.id).toEqual(original.lane);
    expect(node.from, original.id).toEqual([]);
    expect(Number.isFinite(node.x) && Number.isFinite(node.y), `${original.id} was placed`).toBe(true);
  }

  // Sizes come from the shared geometry over HTTP; positions from the stored file.
  const drawn = (await svgInfo(page, await (await request.get(
    `${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`)).text())).nodes;
  const boxOf = (id: string) => {
    const node = placed.nodes.find(n => n.id === id)!, shape = drawn.find(s => s.id === id);
    expect(shape, `${id} is drawn`).toBeTruthy();
    return { id, x: node.x!, y: node.y!, width: shape!.width, height: shape!.height };
  };
  const front = boxOf('front'), intake = boxOf('intake'), store = boxOf('store');
  const checks = ['check-a', 'check-b', 'check-c'].map(boxOf), watcher = boxOf('watcher');

  // The spine units run along one row, in spine order.
  const spine = [front, intake, store];
  for (const [i, left] of spine.entries()) for (const right of spine.slice(i + 1)) {
    expect(left.x, `${left.id} before ${right.id}`).toBeLessThan(right.x);
    expect(left.y, `${left.id} and ${right.id} share a row`).toBeLessThan(right.y + right.height);
    expect(left.y + left.height).toBeGreaterThan(right.y);
  }

  // Each side part is on the side of its anchor that it asked for.
  for (const check of checks) expect(check.y, `${check.id} below its anchor`).toBeGreaterThanOrEqual(intake.y + intake.height);
  expect(watcher.y + watcher.height, 'the watcher is above its anchor').toBeLessThanOrEqual(front.y);

  // diagram-v2 (Layout): several side parts of one anchor spread to the nearest free neighbouring
  // columns before going a row further out. Three of them, with free cells beside the anchor's own
  // column, therefore share one row and stand in columns of their own.
  for (const [i, one] of checks.entries()) for (const other of checks.slice(i + 1)) {
    expect(one.y, `${one.id} and ${other.id} stayed in one row`).toBeLessThan(other.y + other.height);
    expect(one.y + one.height).toBeGreaterThan(other.y);
    const apart = one.x + one.width <= other.x || other.x + other.width <= one.x;
    expect(apart, `${one.id} and ${other.id} took columns of their own`).toBe(true);
  }
  // Its lane, not its `place` hint, chose where Check C went: the hint named a row above the main
  // row and a column five to the left of the first one.
  expect(checks[2].y).toBeGreaterThan(intake.y);
  expect(checks[2].x, 'the ignored place hint did not pull Check C out to the left').toBeGreaterThanOrEqual(front.x);

  // Nothing overlaps anything (no groups here, so every pair is unrelated).
  const boxes = placed.nodes.map(node => boxOf(node.id));
  for (const [i, one] of boxes.entries()) for (const other of boxes.slice(i + 1)) {
    expect(overlaps(one, other), `${one.id} and ${other.id}`).toBe(false);
  }

  // The editor draws the same view from that file, every part of it.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview');
  for (const node of placed.nodes) await expect(page.getByTestId(`node-${node.id}`)).toBeVisible();
});
