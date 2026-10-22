import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, readDrawing, cli, svgInfo, settledReport } from './helpers';
import { inDrawingFonts, routeGeometry, measuredRouteReport, overlapsBox, edgeLine, isSingleCubic, routeToBox } from './helpers-svg-parity';

// Outcome: a session writes a drawing with no positions; code places every part, and what is drawn has no overlapping
// parts, draws every connection as one cubic that is never bent around anything, keeps every label on its line, and
// reports exactly the parts a connection passes behind (ADR 0011). What the layout cannot clear is listed, not hidden.
test('H84 [START-5, LAYOUT-1, LAYOUT-2, LAYOUT-3, QUAL-2] open a session file without positions: no part overlaps another, every connection is one cubic, every label stays on its line, and the layout report lists the parts a connection passes behind as the image draws them', async ({ page, request }) => {
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
  // The editor draws each connection as one cubic too (a hit area that is not painted is not the line).
  for (const edge of stored.edges) {
    const lines = await edgeLine(page.getByTestId('canvas'), edge.id!);
    expect(lines.length, `${edge.id} is drawn in the editor`).toBeGreaterThan(0);
    expect(isSingleCubic(lines[0].d), `${edge.id} in the editor: ${lines[0].d}`).toBe(true);
  }
  const out = join(dir, 'placed.svg'), exported = await cli(['svg', file, '--view', 'overview', '--format', 'readme', '--out', out]);
  expect(exported.code, exported.stderr).toBe(0);
  const svg = await readFile(out, 'utf8'), image = await svgInfo(page, svg);
  expect(image.nodes.map(n => n.id).sort()).toEqual(stored.nodes.map(n => n.id).sort()); expect(image.edges).toHaveLength(stored.edges.length);

  const independent = await inDrawingFonts(page, svg, async surface => {
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

    // Every connection is one cubic, `M … C …` and nothing else: never an arc, a chain, a corner or a straight command.
    for (const edge of stored.edges) {
      const lines = await edgeLine(surface, edge.id!);
      expect(lines.length, `${edge.id} is drawn in the image`).toBeGreaterThan(0);
      expect(isSingleCubic(lines[0].d), `${edge.id} in the image: ${lines[0].d}`).toBe(true);
    }

    // A label is on its line: its box lies within 10 px of the curve, or the label is left out. Some label is drawn here.
    let drawnLabels = 0;
    for (const [i, edge] of stored.edges.entries()) {
      const labels = geometries[i].labels;
      expect(labels.length, `${edge.id} draws at most its one label`).toBeLessThanOrEqual(edge.label ? 1 : 0);
      for (const label of labels) {
        drawnLabels++;
        expect(label.text, `${edge.id}'s label`).toContain(edge.label);
        const distance = routeToBox(geometries[i].routes[0], label.box);
        expect(distance, `${edge.id}'s label is ${distance / scale} px from its curve`).toBeLessThanOrEqual(10 * scale + epsilon);
      }
    }
    expect(drawnLabels, 'at least one of the two labels has room').toBeGreaterThanOrEqual(1);

    return measuredRouteReport(stored, geometries);
  });

  // The layout report lists what the image draws: every part a curve passes behind, counted as the share dialog counts it.
  // Nothing says that none exist; what must hold is that no line behind a part is missing from the report, and none is invented.
  await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  const shown = await settledReport(page);
  expect(shown, JSON.stringify(independent)).toMatchObject({ view: 'overview', format: 'readme', connections: stored.edges.length });
  expect(shown.overParts, `independent measurement of the exported image: ${JSON.stringify(independent.edgesOverParts)}`).toBe(independent.edgesOverParts.length);
  expect(shown.crossings, `independent measurement of the exported image: ${independent.crossings} crossings`).toBe(independent.crossings);
  await page.getByTestId('share-close').click();
  // Looking at the picture has not changed the file.
  expect(await readFile(file, 'utf8')).toBe(placedText);
});
