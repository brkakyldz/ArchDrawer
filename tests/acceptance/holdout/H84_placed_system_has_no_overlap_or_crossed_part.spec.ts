import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, readDrawing, cli, svgInfo } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport, entersBox, groupNameBox, overlapsBox } from './helpers-svg-parity';

// Outcome: a session writes a drawing with no positions; code places every part, and what is drawn
// has no overlapping parts, no connection through a part it does not join, none through a group's name.
test('H84 [START-5, LAYOUT-1, LAYOUT-2, QUAL-2] open a session file without positions: no part overlaps another and no connection runs through a part it does not join or a group name', async ({ page, request }) => {
  const doc = drawing('Placed by code'), view = doc.views[0];
  view.nodes = [
    component('owner', { label: 'Shop owner', kind: 'actor' }),
    component('web', { label: 'Web app', kind: 'client', sub: 'React' }),
    component('api', { label: 'Order API', kind: 'api', form: 'panel', items: ['Validate order', 'Create order'], files: ['src/api.ts'] }),
    component('runtime', { label: 'Order runtime', form: 'group' }),
    component('gate', { label: 'Check access', kind: 'gate', form: 'compact', parent: 'runtime' }),
    component('orders', { label: 'Order service', sub: 'Decide and store', parent: 'runtime' }),
    component('db', { label: 'Orders DB', kind: 'data', sub: 'Postgres', files: ['src/db.ts'] }),
    component('mail', { label: 'Mail service', kind: 'external' }),
    component('metrics', { label: 'Telemetry', kind: 'ops' }),
  ];
  view.edges = [
    { id: 'e1', from: 'owner', to: 'web', label: 'Place an order', style: 'call', both: false, step: 1 },
    { id: 'e2', from: 'web', to: 'api', label: '', style: 'call', both: false, step: 2 },
    { id: 'e3', from: 'api', to: 'gate', label: '', style: 'call', both: false, step: 3 },
    { id: 'e4', from: 'gate', to: 'orders', label: '', style: 'call', both: false, step: 4 },
    { id: 'e5', from: 'orders', to: 'db', label: '', style: 'call', both: false, step: 5 },
    { id: 'e6', from: 'orders', to: 'mail', label: 'Send receipt', style: 'async', both: false, step: null },
    { id: 'e7', from: 'api', to: 'metrics', label: '', style: 'dep', both: false, step: null },
  ];
  const { dir, file } = await workspace('placed-by-code', doc);
  const validated = await cli(['validate', file]); expect(validated.code, validated.stderr).toBe(0);
  const opened = await cli(['open', file, '--no-browser']); expect(opened.code, opened.stderr).toBe(0);
  const placedText = await readFile(file, 'utf8'), stored = (await readDrawing(file)).views[0];
  for (const node of stored.nodes) expect(Number.isFinite(node.x) && Number.isFinite(node.y), `${node.id} was placed`).toBe(true);
  // Must not happen: placing again. A second open finds every part placed and moves none.
  expect((await cli(['open', file, '--no-browser'])).code).toBe(0);
  expect(await readFile(file, 'utf8')).toBe(placedText);

  await openDrawing(page, request, file);
  const out = join(dir, 'placed.svg'), exported = await cli(['svg', file, '--view', 'overview', '--format', 'readme', '--out', out]);
  expect(exported.code, exported.stderr).toBe(0);
  const svg = await readFile(out, 'utf8'), image = await svgInfo(page, svg);
  expect(image.nodes.map(n => n.id).sort()).toEqual(stored.nodes.map(n => n.id).sort()); expect(image.edges).toHaveLength(stored.edges.length);

  await inDrawingFonts(page, svg, async surface => {
    const geometries = [];
    for (const edge of stored.edges) geometries.push(await routeGeometry(surface, edge.id!, edge.from, edge.to));
    const nodes = geometries[0].nodes, scale = geometries[0].scale, epsilon = scale * 0.3;
    expect(nodes).toHaveLength(stored.nodes.length);

    // No two parts overlap, except a group and the members it contains.
    const parentOf = new Map(stored.nodes.map(n => [n.id, n.parent] as const));
    const within = (id: string, group: string) => {
      for (let at = parentOf.get(id) ?? null; at; at = parentOf.get(at) ?? null) if (at === group) return true;
      return false;
    };
    let pairs = 0;
    for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) {
      if (within(a.id, b.id) || within(b.id, a.id)) continue;
      pairs++; expect(overlapsBox(a.box, b.box), `${a.id} and ${b.id} overlap`).toBe(false);
    }
    expect(pairs).toBeGreaterThan(0);
    const group = nodes.find(n => n.id === 'runtime')!;
    for (const id of ['gate', 'orders']) {
      const member = nodes.find(n => n.id === id)!.box;
      expect(member.left, id).toBeGreaterThanOrEqual(group.box.left - epsilon); expect(member.right, id).toBeLessThanOrEqual(group.box.right + epsilon);
      expect(member.top, id).toBeGreaterThanOrEqual(group.box.top - epsilon); expect(member.bottom, id).toBeLessThanOrEqual(group.box.bottom + epsilon);
    }

    // No connection runs through a part it does not join (a group is not a part here; its name is checked below).
    const independent = measuredRouteReport(stored, geometries);
    expect(independent.edgesOverParts, 'connections over parts').toEqual([]);

    // No connection enters a group's name.
    const name = groupNameBox(group.box, group.texts.map(t => t.box), scale);
    let segments = 0;
    for (const [i, geometry] of geometries.entries()) for (const route of geometry.routes) for (let k = 1; k < route.length; k++) {
      segments++; expect(entersBox(route[k - 1], route[k], name, epsilon), `${stored.edges[i].id} enters the name of the group`).toBe(false);
    }
    expect(segments).toBeGreaterThan(0);
  });
  // Looking at the picture has not changed the file.
  expect(await readFile(file, 'utf8')).toBe(placedText);
});
