import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, baseURL, download, type View } from './helpers';
import { routeGeometry, type Point } from './helpers-v7';
import { entersBox } from './helpers-v8';
import { checkRouteBorders, crossingWitness } from './helpers-v9';
import { inDrawingFonts } from './helpers-v5';
import { smoothConnection, arcWitnesses, sampleCubics, checkSmooth, checkClear, lineLength, centre, distance, checkCap, type Geometry, type Cubic } from './helpers-v13';
import type { Box } from './helpers-v7';

// A public-geometry witness goes round the earlier edge's left end, on the
// outside of all four cards. No standalone curve or initial handle is assumed.
const crossingChoiceWitness = (g: Geometry, earlierSource: Box): Cubic[] => {
  const sign = centre(g.source).y > centre(earlierSource).y ? -1 : 1, h = 64 * g.scale;
  const a = { x: g.source.left, y: centre(g.source).y };
  const b = { x: centre(g.target).x, y: sign < 0 ? g.target.top : g.target.bottom };
  const bend = { x: Math.min(...g.nodes.map(n => n.box.left)) - h,
    y: sign < 0 ? Math.min(...g.nodes.map(n => n.box.top)) - h : Math.max(...g.nodes.map(n => n.box.bottom)) + h };
  return [[a, { x: a.x - h, y: a.y }, { x: bend.x - h, y: bend.y }, bend],
    [bend, { x: bend.x + h, y: bend.y }, { x: b.x, y: b.y + sign * h }, b]];
};

// A legal but costlier alternative rounds the outside of every part.
const costlyAvoidanceWitness = (g: Geometry): Cubic[] => {
  const horizontal = Math.abs(centre(g.target).x - centre(g.source).x) > Math.abs(centre(g.target).y - centre(g.source).y);
  const h = 64 * g.scale;
  if (horizontal) {
    const a = { x: centre(g.source).x, y: g.source.bottom }, b = { x: centre(g.target).x, y: g.target.bottom };
    const p = { x: (a.x + b.x) / 2, y: Math.max(...g.nodes.map(n => n.box.bottom)) + 128 * g.scale };
    return [[a, { x: a.x, y: a.y + h }, { x: p.x - h, y: p.y }, p],
      [p, { x: p.x + h, y: p.y }, { x: b.x, y: b.y + h }, b]];
  }
  const a = { x: g.source.left, y: centre(g.source).y }, b = { x: g.target.left, y: centre(g.target).y };
  const p = { x: Math.min(...g.nodes.map(n => n.box.left)) - 24 * g.scale, y: (a.y + b.y) / 2 };
  return [[a, { x: a.x - h, y: a.y }, { x: p.x, y: p.y - h }, p],
    [p, { x: p.x, y: p.y + h }, { x: b.x - h, y: b.y }, b]];
};

// Keep the historical title/journey. spec@4162614 replaces "fewest crossings, then shortest"
// with "cost = length ÷ ... centres + 0.25 per earlier line crossed" and the short-arc cap.

test('H77 [LAY-4, LAY-5, SHR-6, SHR-10] take a shorter crossing-free post detour when the initial curve crosses a previously drawn line', async ({ page, request }) => {
  const doc = drawing('Crossing choice');
  const post: View = { id: 'crossing-post', title: 'Post', postOf: 'overview', caption: { title: 'Crossing choice', lede: '' }, texts: [],
    nodes: [component('a', { label: 'A', x: 0, y: 0 }), component('b', { label: 'B', x: 500, y: 0 }),
      component('c', { label: 'C', x: 0, y: 400 }), component('d', { label: 'D', x: 500, y: 400 })],
    edges: [{ id: 'earlier', from: 'a', to: 'd', label: '', style: 'call', both: false, step: null },
      { id: 'later', from: 'b', to: 'c', label: '', style: 'call', both: false, step: null }] };
  const control = structuredClone(post); control.id = 'curve-post'; control.postOf = 'curve-source';
  control.nodes.forEach(n => { n.id = `control-${n.id}`; });
  control.edges = [{ id: 'initial-curve', from: 'control-b', to: 'control-c', label: '', style: 'call', both: false, step: null }];
  const reverseControl = structuredClone(post); reverseControl.id = 'other-curve-post'; reverseControl.postOf = 'other-curve-source';
  reverseControl.nodes.forEach(n => { n.id = `other-${n.id}`; });
  reverseControl.edges = [{ id: 'other-initial-curve', from: 'other-a', to: 'other-d', label: '', style: 'call', both: false, step: null }];
  doc.views.push(post, { id: 'curve-source', title: 'Curve source', caption: { title: 'Curve source', lede: '' }, nodes: [], edges: [], texts: [] }, control,
    { id: 'other-curve-source', title: 'Other curve source', caption: { title: 'Other curve source', lede: '' }, nodes: [], edges: [], texts: [] }, reverseControl);
  const { dir, file } = await workspace('h77', doc), opened = await openDrawing(page, request, file), bytes = await readFile(file, 'utf8');
  const holders = await Promise.all([page.context().newPage(), page.context().newPage(), page.context().newPage()]); expect(holders).toHaveLength(3);
  try {
    for (const [index, view] of [post, control, reverseControl].entries()) {
      const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=${view.id}&format=readme`); expect(response.status()).toBe(200);
      await holders[index].setContent(`<!doctype html><html><body style="margin:0">${await response.text()}</body></html>`);
      await holders[index].evaluate(async () => { await document.fonts.ready; });
    }
    let surfaceChecks = 0;
    const checkSurface = async (surface: Locator) => {
      const order = await surface.locator('g[data-edge-id], [data-testid="edge-earlier"], [data-testid="edge-later"]')
        .evaluateAll(edges => [...new Set(edges.map(e => e.getAttribute('data-edge-id') ?? e.getAttribute('data-testid')!.slice(5)))]);
      expect(order.slice().sort()).toEqual(['earlier', 'later']);
      // The rule follows actual paint order; the contract does not require edge array order to be SVG order.
      const reversed = order[0] === 'later', from = reversed ? 'a' : 'b', to = reversed ? 'd' : 'c';
      const earlier = await smoothConnection(surface, order[0]!, reversed ? 'b' : 'a', reversed ? 'c' : 'd');
      const later = await smoothConnection(surface, order[1]!, from, to);
      const initial = await routeGeometry(holders[reversed ? 2 : 1].locator('svg'), reversed ? 'other-initial-curve' : 'initial-curve',
        `${reversed ? 'other' : 'control'}-${from}`, `${reversed ? 'other' : 'control'}-${to}`);
      expect(earlier.nodes).toHaveLength(4); expect(later.nodes).toHaveLength(4); expect(initial.nodes).toHaveLength(4);
      for (const geometry of [earlier, later, initial]) checkRouteBorders(geometry);
      const align = (p: Point) => ({ x: later.source.left + (p.x - initial.source.left) * later.scale / initial.scale,
        y: later.source.top + (p.y - initial.source.top) * later.scale / initial.scale });
      const oldLine = earlier.routes.flat(), initialCurve = initial.routes.flat().map(align), newLine = later.routes.flat();
      const controlCrossing = crossingWitness(oldLine, initialCurve, 16 * later.scale);
      // A standalone route cannot reveal the multi-connection router's initial candidate.
      test.info().annotations.push({ type: 'crossing-control', description: JSON.stringify({ surface: surfaceChecks + 1,
        controlCrossing: controlCrossing !== null, conditionalActivation: 'unverified; standalone control is not the initial candidate' }) });
      const byId = (id: string) => { const node = later.nodes.find(n => n.id === id); expect(node, id).toBeTruthy(); return node!.box; };
      const a = byId(reversed ? 'b' : 'a'), b = byId(from), c = byId(to);
      const epsilon = later.scale * 0.3, clearance = later.scale * 64;
      expect(c.top - a.bottom).toBeGreaterThan(clearance * 2);
      // A right-angle witness is no longer an admissible alternative. Compare only actual smooth,
      // part-clear, port-normal alternatives under the cap; a shorter route may retain a crossing.
      const candidates = arcWitnesses(later, later.nodes.map(n => n.box));
      expect(candidates.length, 'admissible bounded smooth alternatives').toBeGreaterThan(0);
      const span = distance(centre(later.source), centre(later.target));
      const cost = (points: Point[]) => lineLength(points) / span + (crossingWitness(oldLine, points, 16 * later.scale) ? 0.25 : 0);
      expect(cost(newLine), 'no witnessed legal arc has lower cost').toBeLessThanOrEqual(Math.min(...candidates.map(c => cost(c.points))) + 0.001);
      checkCap(later);
      test.info().annotations.push({ type: 'route-length', description: JSON.stringify({ surface: surfaceChecks + 1,
        final: lineLength(newLine) / later.scale, finalCost: cost(newLine), candidates: candidates.length,
        conditionalActivation: 'unverified; candidates give a finite cost bound, not the initial curve' }) });
      const sides = (p: Point, box: typeof b) => ['top', 'right', 'bottom', 'left'].filter(side =>
        Math.abs(side === 'top' ? p.y - box.top : side === 'bottom' ? p.y - box.bottom : side === 'left' ? p.x - box.left : p.x - box.right) <= epsilon);
      const start = sides(newLine[0], b), end = sides(newLine.at(-1)!, c); expect(start.length).toBeGreaterThan(0); expect(end.length).toBeGreaterThan(0);
      // These four parts are >40 px apart and the earlier edge uses different endpoints.
      // ADR 0015 allows individually unused sides; the old like-side-pair restriction is gone.
      for (const endpoint of [b, c]) for (const node of later.nodes.filter(n => n.id !== from && n.id !== to))
        expect(Math.hypot(Math.max(node.box.left - endpoint.right, endpoint.left - node.box.right, 0),
          Math.max(node.box.top - endpoint.bottom, endpoint.top - node.box.bottom, 0))).toBeGreaterThanOrEqual(40 * later.scale);
      const segments = newLine.slice(1).map((p, i) => ({ a: newLine[i], b: p })); expect(segments.length).toBeGreaterThan(0);
      for (const node of later.nodes) expect(segments.find(s => entersBox(s.a, s.b, node.box, epsilon)), `later route enters ${node.id}`).toBeUndefined();
      checkClear(later, later.nodes.map(n => n.box));
      surfaceChecks++;
    };
    await checkSurface(holders[0].locator('svg'));
    await page.getByTestId('views-button').click(); await page.getByTestId('view-item-crossing-post').click();
    await checkSurface(page.getByTestId('canvas'));
    await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await checkSurface(page.getByTestId('share-preview'));
    const out = join(dir, 'crossing.svg'); await download(page, 'download-svg', out);
    await holders[0].setContent(`<!doctype html><html><body style="margin:0">${await readFile(out, 'utf8')}</body></html>`);
    await holders[0].evaluate(async () => { await document.fonts.ready; });
    await checkSurface(holders[0].locator('svg'));
    expect(surfaceChecks).toBe(4);
  } finally { for (const holder of holders) await holder.close(); }
  expect(await readFile(file, 'utf8')).toBe(bytes);

  // A cheaper arc must beat EVERY crossing route, even at the closest allowed
  // endpoint ports. Reading paint order avoids assuming an edge-array order.
  const cheap = drawing('Discriminating crossing cost'), choice: View = {
    id: 'cheap-post', title: 'Post', postOf: 'overview', caption: { title: 'Crossing cost', lede: '' }, texts: [],
    nodes: [component('high-left', { form: 'compact', x: 0, y: 0 }), component('low-left', { form: 'compact', x: 0, y: 180 }),
      component('high-right', { form: 'compact', x: 6000, y: 0 }), component('low-right', { form: 'compact', x: 6000, y: 180 })],
    edges: [{ id: 'falling', from: 'high-left', to: 'low-right', label: '', style: 'call', both: false, step: null },
      { id: 'rising', from: 'low-left', to: 'high-right', label: '', style: 'call', both: false, step: null }],
  };
  cheap.views.push(choice);
  const certified = await workspace('h77-cheaper-arc', cheap), registered = await openDrawing(page, request, certified.file);
  const certifiedBytes = await readFile(certified.file, 'utf8');
  const image = await request.get(`${baseURL()}/api/diagrams/${registered.id}/export.svg?view=${choice.id}&format=readme`);
  expect(image.status()).toBe(200);
  await inDrawingFonts(page, await image.text(), async surface => {
    const order = await surface.locator('g[data-edge-id]').evaluateAll(groups => groups.map(g => g.getAttribute('data-edge-id')!));
    expect(order.slice().sort()).toEqual(['falling', 'rising']);
    const geometry: Awaited<ReturnType<typeof smoothConnection>>[] = [];
    for (const id of order) {
      const edge = choice.edges.find(e => e.id === id)!;
      geometry.push(await smoothConnection(surface, id, edge.from, edge.to));
    }
    const [earlier, later] = geometry, curves = crossingChoiceWitness(later, earlier.source), points = sampleCubics(curves);
    checkSmooth(curves, later.source, later.target, later.scale * 0.3, later.scale);
    checkClear({ ...later, routes: [points] }, later.nodes.map(n => n.box), 0); checkCap({ ...later, routes: [points] });
    expect(crossingWitness(earlier.routes[0], points, 16 * later.scale), 'witness avoids the actual earlier line').toBeNull();
    // The unused left and outside top/bottom sides have >40 px from every other part.
    for (const [id, box] of [[order[1] === 'rising' ? 'low-left' : 'high-left', later.source],
      [order[1] === 'rising' ? 'high-right' : 'low-right', later.target]] as const)
      for (const part of later.nodes.filter(n => n.id !== id))
        expect(Math.hypot(Math.max(part.box.left - box.right, box.left - part.box.right, 0),
          Math.max(part.box.top - box.bottom, box.top - part.box.bottom, 0))).toBeGreaterThanOrEqual(40 * later.scale);
    const span = distance(centre(later.source), centre(later.target));
    const portDistance = Math.hypot(Math.max(later.target.left - later.source.right, 0),
      Math.max(later.source.top - later.target.bottom, later.target.top - later.source.bottom, 0));
    const witnessCost = lineLength(points) / span, crossingLowerBound = portDistance / span + 0.25;
    expect(witnessCost + 0.005, 'a legal arc is cheaper than every possible crossing route').toBeLessThan(crossingLowerBound);
    const crossed = crossingWitness(earlier.routes[0], later.routes[0], 16 * later.scale) !== null;
    const actualCost = lineLength(later.routes[0]) / span + (crossed ? 0.25 : 0);
    expect(actualCost).toBeLessThanOrEqual(witnessCost + 0.001);
    expect(crossed, 'the cost penalty forces the cheaper crossing-free choice').toBe(false);
  });
  expect(await readFile(certified.file, 'utf8')).toBe(certifiedBytes);

  // The reverse cost choice: avoidance is possible under the cap but costs more.
  // Both paint orders discriminate, so no edge-array/paint-order promise is needed.
  const retain = drawing('Keep the cheaper crossing'), retention: View = {
    id: 'retain-post', title: 'Post', postOf: 'overview', caption: { title: 'Crossing cost', lede: '' }, texts: [],
    nodes: [component('left', { form: 'compact', label: 'In', x: -600, y: 0 }),
      component('right', { form: 'compact', label: 'In', x: 600, y: 0 }),
      component('top', { form: 'compact', label: 'In', x: 0, y: -500 }),
      component('bottom', { form: 'compact', label: 'In', x: 0, y: 500 })],
    edges: [{ id: 'horizontal', from: 'left', to: 'right', label: '', style: 'call', both: false, step: null },
      { id: 'vertical', from: 'top', to: 'bottom', label: '', style: 'call', both: false, step: null }],
  };
  retain.views.push(retention);
  const retained = await workspace('h77-retain-crossing', retain), retainedOpen = await openDrawing(page, request, retained.file);
  const retainedBytes = await readFile(retained.file, 'utf8');
  const retainedImage = await request.get(`${baseURL()}/api/diagrams/${retainedOpen.id}/export.svg?view=${retention.id}&format=readme`);
  expect(retainedImage.status()).toBe(200);
  await inDrawingFonts(page, await retainedImage.text(), async surface => {
    const order = await surface.locator('g[data-edge-id]').evaluateAll(groups => groups.map(g => g.getAttribute('data-edge-id')!));
    expect(order.slice().sort()).toEqual(['horizontal', 'vertical']);
    const routes: Awaited<ReturnType<typeof smoothConnection>>[] = [];
    for (const id of order) {
      const edge = retention.edges.find(e => e.id === id)!;
      routes.push(await smoothConnection(surface, id, edge.from, edge.to));
    }
    const [earlier, later] = routes, s = later.scale;
    const horizontal = order[1] === 'horizontal';
    const a = horizontal ? { x: later.source.right, y: centre(later.source).y } : { x: centre(later.source).x, y: later.source.bottom };
    const b = horizontal ? { x: later.target.left, y: centre(later.target).y } : { x: centre(later.target).x, y: later.target.top };
    const h = 24 * s, direct: Cubic[] = [[a, { x: a.x + (horizontal ? h : 0), y: a.y + (horizontal ? 0 : h) },
      { x: b.x - (horizontal ? h : 0), y: b.y - (horizontal ? 0 : h) }, b]];
    const directPoints = sampleCubics(direct), span = distance(centre(later.source), centre(later.target));
    checkSmooth(direct, later.source, later.target, 0.3 * s, s);
    checkClear({ ...later, routes: [directPoints] }, later.nodes.map(n => n.box), 0);
    expect(crossingWitness(earlier.routes[0], directPoints, 16 * s)).not.toBeNull();
    // The earlier plain curve stays in its ends' perpendicular strip, and
    // joins opposite sides of the later connection's corridor.
    const axis = horizontal ? 'x' : 'y', lo = horizontal ? earlier.source.left : earlier.source.top;
    const hi = horizontal ? earlier.source.right : earlier.source.bottom;
    for (const p of earlier.routes[0]) {
      expect(p[axis]).toBeGreaterThanOrEqual(lo - 0.01 * s); expect(p[axis]).toBeLessThanOrEqual(hi + 0.01 * s);
    }
    const first = earlier.routes[0][0], last = earlier.routes[0].at(-1)!;
    // Going round either end of that barrier costs at least this reflection
    // bound, even ignoring every part. Trim 16 px for crossingWitness's guard.
    const reach = horizontal ? Math.min(later.source.top - Math.min(first.y, last.y), Math.max(first.y, last.y) - later.target.bottom) - 16 * s
      : Math.min(later.source.left - Math.min(first.x, last.x), Math.max(first.x, last.x) - later.target.right) - 16 * s;
    const gap = horizontal ? later.target.left - later.source.right : later.target.top - later.source.bottom;
    expect(reach).toBeGreaterThan(0);
    const crossingCost = lineLength(directPoints) / span + 0.25, avoidingLowerCost = Math.hypot(gap, 2 * reach) / span;
    expect(crossingCost + 0.005, 'every crossing-free route costs more than a legal crossing').toBeLessThan(avoidingLowerCost);
    const avoidance = costlyAvoidanceWitness(later), avoidancePoints = sampleCubics(avoidance);
    checkSmooth(avoidance, later.source, later.target, 0.3 * s, s);
    checkClear({ ...later, routes: [avoidancePoints] }, later.nodes.map(n => n.box), 0); checkCap({ ...later, routes: [avoidancePoints] });
    expect(crossingWitness(earlier.routes[0], avoidancePoints, 16 * s), 'costlier avoidance really is available under the cap').toBeNull();
    for (const endpoint of [later.source, later.target]) for (const node of later.nodes.filter(n => n.id !== retention.edges.find(e => e.id === order[1])!.from && n.id !== retention.edges.find(e => e.id === order[1])!.to))
      expect(Math.hypot(Math.max(node.box.left - endpoint.right, endpoint.left - node.box.right, 0),
        Math.max(node.box.top - endpoint.bottom, endpoint.top - node.box.bottom, 0))).toBeGreaterThanOrEqual(40 * s);
    expect(crossingWitness(earlier.routes[0], later.routes[0], 16 * s), 'retain the crossing when avoidance costs more').not.toBeNull();
    expect(lineLength(later.routes[0]) / span + 0.25).toBeLessThanOrEqual(crossingCost + 0.001);
    checkClear(later, later.nodes.map(n => n.box)); checkCap(later);
  });
  expect(await readFile(retained.file, 'utf8')).toBe(retainedBytes);

  // Occupy top at b and bottom at c: like-side choices now have real unavailable sides.
  const occupied = drawing('Occupied post sides'), busy = structuredClone(post);
  busy.nodes.push(component('above-b', { label: 'Above B', x: 500, y: -400 }),
    component('below-c', { label: 'Below C', x: 0, y: 800 }));
  busy.edges.unshift({ id: 'b-top', from: 'b', to: 'above-b', label: '', style: 'call', both: false, step: null },
    { id: 'c-bottom', from: 'c', to: 'below-c', label: '', style: 'call', both: false, step: null });
  occupied.views.push(busy);
  const extra = await workspace('h77-occupied', occupied), extraOpened = await openDrawing(page, request, extra.file);
  const extraBytes = await readFile(extra.file, 'utf8');
  const response = await request.get(`${baseURL()}/api/diagrams/${extraOpened.id}/export.svg?view=${busy.id}&format=readme`);
  expect(response.status()).toBe(200);
  const holder = await page.context().newPage();
  try {
    await holder.setContent(`<!doctype html><html><body style="margin:0">${await response.text()}</body></html>`);
    await holder.evaluate(async () => { await document.fonts.ready; });
    const line = await smoothConnection(holder.locator('svg'), 'later', 'b', 'c');
    const top = await routeGeometry(holder.locator('svg'), 'b-top', 'b', 'above-b');
    const bottom = await routeGeometry(holder.locator('svg'), 'c-bottom', 'c', 'below-c');
    for (const geometry of [line, top, bottom]) checkRouteBorders(geometry);
    const epsilon = line.scale * 0.3;
    const sides = (p: Point, box: typeof line.source) => ['top', 'right', 'bottom', 'left'].filter(side =>
      Math.abs(side === 'top' ? p.y - box.top : side === 'bottom' ? p.y - box.bottom : side === 'left' ? p.x - box.left : p.x - box.right) <= epsilon);
    const usedAtSource = sides(top.routes[0][0], top.source), usedAtTarget = sides(bottom.routes[0][0], bottom.source);
    expect(usedAtSource).toContain('top'); expect(usedAtTarget).toContain('bottom');
    const start = sides(line.routes[0][0], line.source), end = sides(line.routes[0].at(-1)!, line.target);
    expect(start.length).toBeGreaterThan(0); expect(end.length).toBeGreaterThan(0);
    expect(start.some(side => side === 'left' || !usedAtSource.includes(side)), 'source: own side or a side unused by its other connection').toBe(true);
    expect(end.some(side => side === 'right' || !usedAtTarget.includes(side)), 'target: own side or a side unused by its other connection').toBe(true);
    for (const [id, endpoint] of [['b', line.source], ['c', line.target]] as const) for (const node of line.nodes.filter(n => n.id !== id))
      expect(Math.hypot(Math.max(node.box.left - endpoint.right, endpoint.left - node.box.right, 0),
        Math.max(node.box.top - endpoint.bottom, endpoint.top - node.box.bottom, 0)), 'every alternate side has at least 40 px of part clearance').toBeGreaterThanOrEqual(40 * line.scale);
    checkCap(line);
    checkClear(line, line.nodes.map(n => n.box));
  } finally { await holder.close(); }
  expect(await readFile(extra.file, 'utf8')).toBe(extraBytes);
});
