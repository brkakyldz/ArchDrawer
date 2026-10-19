import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, type Drawing } from './helpers';
import { drawnNodeBoxes, paintedTextField, measuredRouteReport } from './helpers-v9';
import { type Box } from './helpers-v7';
import { smoothConnection, shareGeometry, checkClear, checkCap, arcCap, overlapsBox, arcClear, arcWitnesses,
  centre, groupNameBox, sampleCubics, checkSmooth, lineLength, cubicLengthUpperBound, segmentBoxDistance, type Cubic, type Geometry } from './helpers-v13';
import { entersBox } from './helpers-v8';

// Any route from above to below this name must pass both corners at one end.
// Distances from entire rectangles give a lower bound over ALL endpoint ports.
const nameGapDeficit = (source: Box, target: Box, name: Box, scale: number) => {
  if (!(source.bottom < name.top && target.top >= name.bottom &&
    [source, target].every(b => b.left > name.left && b.right < name.right))) return -Infinity;
  const around = (x: number) => Math.hypot(Math.max(source.left - x, x - source.right, 0), name.top - source.bottom)
    + name.bottom - name.top + Math.hypot(Math.max(target.left - x, x - target.right, 0), target.top - name.bottom);
  const lowerBound = Math.min(around(name.left), around(name.right));
  return lowerBound - arcCap({ source, target, scale });
};

// A three-cubic certificate can go below the lower name before entering a
// target's left side. This bounds fallback, without promising a capped arc.
const roomWitness = (g: Geometry, names: Box[]): Cubic[] => {
  const h = 64 * g.scale, a = { x: centre(g.source).x, y: g.source.bottom }, b = { x: g.target.left, y: centre(g.target).y };
  const x = Math.min(...g.nodes.map(n => n.box.left), ...names.map(n => n.left)) - h;
  const p = { x, y: (a.y + Math.min(...names.filter(n => n.top > a.y).map(n => n.top))) / 2 }, q = { x, y: b.y };
  return [[a, { x: a.x, y: a.y + h }, { x, y: p.y - h }, p],
    [p, { x, y: p.y + h }, { x, y: q.y - h }, q],
    [q, { x, y: q.y + h }, { x: b.x - h, y: b.y }, b]];
};

// Three-cubic certificate through the widened column gap: facing bottom departure,
// free right-side entry. Clearance and the cap are checked independently below.
const boundedRoomWitness = (g: Geometry, names: Box[]): Cubic[] => {
  const h = 24 * g.scale, inset = 0.01 * g.scale, name = names[1];
  const a = { x: centre(g.source).x, y: g.source.bottom }, b = { x: g.target.right, y: centre(g.target).y };
  const p = { x: Math.max(b.x, name.right) + inset, y: name.top - inset };
  const q = { x: p.x, y: name.bottom + inset };
  return [[a, { x: a.x, y: a.y + h }, { x: p.x, y: p.y - h }, p],
    [p, { x: p.x, y: p.y + h }, { x: q.x, y: q.y - h }, q],
    [q, { x: q.x, y: q.y + h }, { x: b.x + h, y: b.y }, b]];
};

// LAY-8 / diagram-v2: "When no arc fits and the parts in its way were placed automatically
// (lanes or place, no stored x/y), the layout widens the row or column gap the arc needs ...;
// widening that still leaves the connection without an arc is undone; a stored part never moves."
test('H81 [LAY-8, LAY-3] make room around an automatic blocker while keeping every stored position', async ({ page, request }) => {
  const calibration = drawing('Measure the room fixture');
  calibration.views[0].nodes = [component('wall', { label: 'Work', form: 'panel',
    items: Array.from({ length: 12 }, (_, i) => `Op ${i}`), place: { row: 0, col: 0 } }),
    component('start', { label: 'In', form: 'compact', x: -3000, y: 0 }),
    component('end', { label: 'Out', form: 'compact', x: 3000, y: 0 })];
  calibration.views[0].edges = [];
  const probe = await workspace('h81-measure', calibration); await openDrawing(page, request, probe.file);
  const sizes = await drawnNodeBoxes(page.getByTestId('canvas'));
  const size = (id: string) => { const found = sizes.find(n => n.nodeId === id); expect(found, id).toBeTruthy(); return found!; };
  const w = size('wall').localWidth, h = size('wall').localHeight;
  expect(w).toBeGreaterThanOrEqual(184); expect(w).toBeLessThanOrEqual(320); expect(h).toBeCloseTo(412, 3);
  const origin = (await readDrawing(probe.file)).views[0].nodes.find(n => n.id === 'wall')!;
  expect(Number.isFinite(origin.x) && Number.isFinite(origin.y)).toBe(true);
  const pinned = structuredClone(calibration), nodes = pinned.views[0].nodes;
  Object.assign(nodes[0], { x: origin.x!, y: origin.y! });
  Object.assign(nodes[1], { x: origin.x! - size('start').localWidth, y: origin.y! + (h - size('start').localHeight) / 2 });
  Object.assign(nodes[2], { x: origin.x! + w, y: origin.y! + (h - size('end').localHeight) / 2 });
  // Four stored rails extend the wall into a continuous barrier. This certificate
  // works over the entire allowed width ranges, without assuming minimum widths.
  for (const row of [-2, -1, 1, 2]) nodes.push(component(`rail-${row}`, { label: 'Work', form: 'panel',
    items: [...nodes[0].items], x: origin.x!, y: origin.y! + row * h }));
  pinned.views[0].edges = [{ id: 'room', from: 'start', to: 'end', label: '', style: 'call', both: false, step: null }];
  const authored = (doc: Drawing) => doc.views[0].nodes.filter(n => n.x !== undefined && n.y !== undefined).map(n => [n.id, n.x, n.y]);
  const checkKept = async (file: string, doc: Drawing) => {
    const current = await readDrawing(file);
    for (const [id, x, y] of authored(doc)) {
      const kept = current.views[0].nodes.find(n => n.id === id)!;
      expect([kept.x, kept.y], `authored ${id} never moves, including initial normalisation`).toEqual([x, y]);
    }
  };
  const noShortArc = (g: Pick<Geometry, 'source' | 'target' | 'nodes' | 'scale'>) => {
    const walls = g.nodes.filter(n => n.id === 'wall' || n.id.startsWith('rail-')).map(n => n.box).sort((a, b) => a.top - b.top);
    expect(walls).toHaveLength(5);
    const wall = walls[2], s = g.scale;
    for (const [i, part] of walls.entries()) {
      expect(Math.abs(part.left - wall.left)).toBeLessThanOrEqual(0.01 * s);
      expect(Math.abs(part.right - wall.right)).toBeLessThanOrEqual(0.01 * s);
      if (i) expect(Math.abs(part.top - walls[i - 1].bottom)).toBeLessThanOrEqual(0.01 * s);
    }
    expect(Math.abs(g.source.right - wall.left)).toBeLessThanOrEqual(0.01 * s);
    expect(Math.abs(g.target.left - wall.right)).toBeLessThanOrEqual(0.01 * s);
    for (const end of [g.source, g.target]) {
      expect(end.top).toBeGreaterThan(wall.top); expect(end.bottom).toBeLessThan(wall.bottom);
    }
    // Facing handles enter the wall; alternate top/bottom sides have it within 40 px.
    // Only the outside vertical sides remain. Any clear route between ANY ports there
    // must go above/below the entire continuous barrier; reflection bounds its length.
    const vertical = Math.min(g.source.top - walls[0].top, g.target.top - walls[0].top,
      walls.at(-1)!.bottom - g.source.bottom, walls.at(-1)!.bottom - g.target.bottom);
    const lowerBound = Math.hypot(g.target.right - g.source.left, 2 * vertical);
    expect(lowerBound, 'demonstrated insufficient base gap, independent of routing').toBeGreaterThan(arcCap(g) + s);
  };

  const automatic = structuredClone(pinned); delete automatic.views[0].nodes[0].x; delete automatic.views[0].nodes[0].y;
  // A new part among stored ones may take ANY free spot. This control checks only
  // LAY-3; it is not evidence that an automatic blocker needs routing room.
  const baseline = structuredClone(automatic); baseline.views[0].edges = [];
  const control = await workspace('h81-no-connection', baseline); await openDrawing(page, request, control.file);
  await checkKept(control.file, baseline);
  const shapes = await drawnNodeBoxes(page.getByTestId('canvas'));
  const boxes = shapes.map(n => ({ id: n.nodeId!, box: { left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height } }));
  const box = (id: string) => boxes.find(n => n.id === id)!.box;
  for (const stored of boxes.filter(n => n.id !== 'wall'))
    expect(overlapsBox(box('wall'), stored.box), `new wall does not overlap ${stored.id}`).toBe(false);

  const fixed = await workspace('h81-stored', pinned); await openDrawing(page, request, fixed.file);
  await checkKept(fixed.file, pinned);
  const fixedReport = await shareGeometry(page), before = await smoothConnection(page.getByTestId('share-preview'), 'room', 'start', 'end');
  noShortArc(before); expect(fixedReport.overParts).toBeGreaterThan(0); await checkKept(fixed.file, pinned);

  const free = await workspace('h81-automatic', automatic); await openDrawing(page, request, free.file);
  await checkKept(free.file, automatic);
  const report = await shareGeometry(page), after = await smoothConnection(page.getByTestId('share-preview'), 'room', 'start', 'end');
  const mixedParts = after.nodes.map(n => n.box);
  const mixedWitnesses = arcWitnesses(after, mixedParts);
  if (mixedWitnesses.length) expect(report.overParts, 'a witnessed legal arc rules out fallback').toBe(0);
  expect(report.overParts).toBe(measuredRouteReport(automatic.views[0], [after]).edgesOverParts.length);
  if (!report.overParts) { checkClear(after, mixedParts); checkCap(after); }
  await checkKept(free.file, automatic);
  const moved = (await readDrawing(free.file)).views[0].nodes.find(n => n.id === 'wall')!;
  expect(moved.place).toEqual({ row: 0, col: 0 });

  // Both automatic fixtures start blocked. The smaller one has a 120 px
  // widening certificate; the larger one may also succeed with a larger gap.
  // The contract limits retry count, not widening distance; only failure rolls back.
  for (const feasible of [true, false]) {
  const ordinary = drawing('Automatic room'), name = 'W'.repeat(feasible ? 34 : 48);
  ordinary.views[0].nodes = [];
  ordinary.views[0].edges = [];
  for (const [row, prefix] of ['start', 'end'].entries()) {
    ordinary.views[0].nodes.push(component(`${prefix}-zone`, { label: name, form: 'group', place: { row, col: 0 },
      lane: row === 0 ? { spine: 0 } : { anchor: 'start-zone', side: 'below' } }));
    for (let col = 0; col < (feasible ? 2 : 5); col++) ordinary.views[0].nodes.push(component(`${prefix}-${col}`, {
      label: 'Work', form: feasible && col === 1 ? 'panel' : 'compact', items: feasible && col === 1 ? ['Op'] : [],
      parent: `${prefix}-zone`, place: { row: 0, col } }));
  }
  const layoutControl = await workspace('h81-ordinary-room', ordinary);
  await openDrawing(page, request, layoutControl.file);
  const ordinaryStored = await readDrawing(layoutControl.file);
  const ordinaryShapes = await drawnNodeBoxes(page.getByTestId('canvas'));
  const ordinaryBox = (id: string) => {
    const n = ordinaryShapes.find(n => n.nodeId === id)!;
    return { left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height };
  };
  const scale = ordinaryShapes.find(n => n.nodeId === 'start-0')!;
  const baseScale = scale.width / scale.localWidth;
  const baseNames = await Promise.all(['start-zone', 'end-zone'].map(async id => {
    const field = await paintedTextField(page.getByTestId('canvas'), id, name);
    return groupNameBox(ordinaryBox(id), [field.box], baseScale);
  }));
  const baseWitnessNames = await Promise.all(['start-zone', 'end-zone'].map(async id => {
    const field = await paintedTextField(page.getByTestId('canvas'), id, name);
    return groupNameBox(ordinaryBox(id), [field.box], baseScale, 'maximum');
  }));
  const ordinaryName = baseNames[1];
  const candidates = feasible ? [{ from: 'start-1', to: 'end-1' }] : Array.from({ length: 5 }, (_, col) => ({ from: `start-${col}`, to: `end-${col}` }))
    .filter(pair => nameGapDeficit(ordinaryBox(pair.from), ordinaryBox(pair.to), ordinaryName, baseScale) > baseScale);
  expect(candidates.length, 'ordinary placement has a certified blocked connection').toBeGreaterThan(0);
  const pair = candidates[0];
  const ordinaryParts = ordinary.views[0].nodes.filter(n => n.form !== 'group').map(n => ({ id: n.id, box: ordinaryBox(n.id) }));
  const baseRoom = { scale: baseScale, nodes: ordinaryParts, source: ordinaryBox(pair.from), target: ordinaryBox(pair.to) } as Geometry;
  if (feasible) {
    expect(nameGapDeficit(baseRoom.source, baseRoom.target, ordinaryName, baseScale), 'even all-port name-clear routes exceed the ordinary cap').toBeGreaterThan(baseScale);
    expect(Math.abs(baseRoom.target.top - ordinaryName.bottom)).toBeLessThanOrEqual(0.3 * baseScale);
  }
  const connected = structuredClone(ordinary);
  connected.views[0].edges = [{ id: 'automatic-room', ...pair, label: '', style: 'call', both: false, step: null }];
  const automaticRoom = await workspace('h81-connected-room', connected);
  await openDrawing(page, request, automaticRoom.file);
  const roomReport = await shareGeometry(page);
  const room = await smoothConnection(page.getByTestId('share-preview'), 'automatic-room', pair.from, pair.to);
  const names = ['start-zone', 'end-zone'].map(id => {
    const group = room.nodes.find(n => n.id === id)!;
    return groupNameBox(group.box, group.texts.map(t => t.box), room.scale);
  });
  const witnessNames = ['start-zone', 'end-zone'].map(id => {
    const group = room.nodes.find(n => n.id === id)!;
    return groupNameBox(group.box, group.texts.map(t => t.box), room.scale, 'maximum');
  });
  const parts = room.nodes.filter(n => connected.views[0].nodes.find(part => part.id === n.id)!.form !== 'group');
  // Group bodies are free to cross; only non-group boxes can impose the 8 px margin.
  const arcRoom = { ...room, nodes: parts }, forbidden = [...parts.map(n => n.box), ...names];
  // Certify one permitted 120 px widening from the no-edge control only.
  // The contract does not prescribe the size of any widening attempt.
  if (feasible) {
  const shift = (id: string) => {
    const col = ordinary.views[0].nodes.find(n => n.id === id)!.place!.col, b = ordinaryBox(id), dx = (col >= 1 ? 3 * 40 : 0) * baseScale;
    return { ...b, left: b.left + dx, right: b.right + dx };
  };
  const widened = { ...baseRoom, nodes: ordinaryParts.map(n => ({ ...n, box: shift(n.id) })),
    source: shift(pair.from), target: shift(pair.to) };
  const widenedNames = baseWitnessNames, certificate = boundedRoomWitness(widened, widenedNames);
  const certified = { ...widened, routes: [sampleCubics(certificate)] };
  checkSmooth(certificate, certified.source, certified.target, baseScale * 0.3, baseScale);
  checkClear(certified, [...certified.nodes.map(n => n.box), ...widenedNames], 0); checkCap(certified);
  expect(cubicLengthUpperBound(certificate), 'a legal chain fits after three 40 px column widenings').toBeLessThan(arcCap(certified) - baseScale);
  // Source uses its own facing bottom; only the target's alternate right needs 40 px.
  for (const n of certified.nodes.filter(n => n.id !== pair.to))
    expect(segmentBoxDistance({ x: certified.target.right, y: certified.target.top },
      { x: certified.target.right, y: certified.target.bottom }, n.box), 'unused target right side has full 40 px clearance').toBeGreaterThanOrEqual(40 * baseScale);
  }
  // Facing sides need no alternate-side availability check; only unused
  // alternate sides need the additional 40 px clearance.
  const witnessForbidden = [...parts.map(n => n.box), ...witnessNames];
  const legal = arcWitnesses(arcRoom, witnessForbidden);
  const roomCurves = roomWitness(room, witnessNames);
  checkSmooth(roomCurves, room.source, room.target, room.scale * 0.3, room.scale);
  const roomAlternative = { ...arcRoom, routes: [sampleCubics(roomCurves)] };
  const roomSideFree = [
    { id: pair.from, name: 'bottom', box: room.source, other: room.target,
      a: { x: room.source.left, y: room.source.bottom }, b: { x: room.source.right, y: room.source.bottom } },
    { id: pair.to, name: 'left', box: room.target, other: room.source,
      a: { x: room.target.left, y: room.target.top }, b: { x: room.target.left, y: room.target.bottom } },
  ].every(side => {
    const a = centre(side.box), b = centre(side.other), dx = b.x - a.x, dy = b.y - a.y;
    const facing = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
    return side.name === facing || parts.filter(n => n.id !== side.id)
      .every(n => segmentBoxDistance(side.a, side.b, n.box) >= 40 * room.scale);
  });
  const legalThree = roomSideFree && arcClear(roomAlternative, witnessForbidden) && cubicLengthUpperBound(roomCurves) <= arcCap(room) - 0.001 * room.scale;
  if (legal.length || legalThree) expect(roomReport.overParts, 'a witnessed legal arc rules out fallback').toBe(0);
  expect(roomReport.overParts).toBe(measuredRouteReport(connected.views[0], [room]).edgesOverParts.length);
  for (const n of names) expect(room.routes[0].slice(1).some((p, i) => entersBox(room.routes[0][i], p, n, room.scale * 0.05)), 'even fallback stays out of group names').toBe(false);
  if (!roomReport.overParts) { checkClear(arcRoom, forbidden); checkCap(room); }
  else if (roomSideFree && arcClear(roomAlternative, witnessForbidden)) expect(lineLength(room.routes[0]), 'fallback within 0.5 % of a legal name-clear witness').toBeLessThanOrEqual(1.005 * cubicLengthUpperBound(roomCurves) + room.scale * 0.3);
  const separation = (a: Box, b: Box) => Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom, 0);
  if (feasible) expect(roomReport.overParts, 'feasible automatic room-making must succeed').toBe(0);
  if (!roomReport.overParts) {
    checkClear(arcRoom, forbidden); checkCap(room);
    const last = room.curves.at(-1)!;
    if (last[2].y < last[3].y - 0.3 * room.scale)
      expect(last[3].x, 'a first-row top entry is at least 10 px right of the name').toBeGreaterThanOrEqual(names[1].right + 10 * room.scale - 0.3 * room.scale);
    expect(parts.some((a, i) => parts.slice(i + 1).some(b => separation(a.box, b.box) / room.scale >
      separation(ordinaryBox(a.id), ordinaryBox(b.id)) / baseScale + 1)), 'successful routing widens a measured gap beyond ordinary placement').toBe(true);
  } else {
    for (const node of room.nodes) {
      const baseline = ordinaryBox(node.id), source = ordinaryBox(pair.from);
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const axis = side === 'left' || side === 'right' ? 'left' : 'top';
        expect(Math.abs((node.box[side] - room.source[axis]) / room.scale -
          (baseline[side] - source[axis]) / baseScale), `unsuccessful widening restores drawn ${node.id}.${side}`).toBeLessThanOrEqual(0.3);
      }
    }
    const final = await readDrawing(automaticRoom.file);
    for (const node of ordinaryStored.views[0].nodes) {
      const kept = final.views[0].nodes.find(n => n.id === node.id)!;
      expect([kept.x, kept.y], `unsuccessful widening restores ${node.id}`).toEqual([node.x, node.y]);
    }
  }
  }
  // Retry count is not exposed by a contract-named surface; this tests its observable result.
});
