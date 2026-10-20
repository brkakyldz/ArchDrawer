import { test, expect } from '@playwright/test';
import { component, kinds, drawing, workspace, openDrawing, readDrawing, writeJSON, cli, baseURL, box, overlaps, svgInfo } from './helpers';

test('H17 [LAYOUT-1, START-5] a hinted system and nested loop render with matching export geometry and kept positions', async ({ page, request }) => {
  const doc = drawing('System geometry');
  doc.views[0].nodes = kinds.map((kind, i) => component(`kind-${kind}`, {
    label: kind, kind, form: i === 2 ? 'panel' : i === 3 ? 'group' : i === 4 ? 'compact' : 'card',
    items: i === 2 ? ['Validate order', 'Create order'] : [], sub: i === 2 ? 'Intake' : '',
    place: { row: Math.floor(i / 4) - 1, col: i % 4 },
  }));
  const group = doc.views[0].nodes.find(n => n.form === 'group')!;
  for (let i = 0; i < 4; i++) doc.views[0].nodes.push(component(`loop-${i}`, { label: `Loop ${i}`, form: 'compact', parent: group.id }));
  doc.views[0].edges = [
    { id: 'main', from: 'kind-actor', to: 'kind-client', label: 'start', style: 'call', both: true, step: 1 },
    { id: 'event', from: 'kind-api', to: 'kind-worker', label: 'queue', style: 'async', both: false, step: null },
    { id: 'trace', from: 'kind-api', to: 'kind-ops', label: 'observe', style: 'dep', both: false, step: null },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `loop-edge-${i}`, from: `loop-${i}`, to: `loop-${i + 1}`, label: '', style: 'call', both: false, step: i + 2 })),
  ];
  doc.views.push({ id: 'without-hints', title: 'Unhinted path', caption: { title: 'An unhinted request path', lede: '' },
    nodes: [component('entry'), component('middle'), component('finish')],
    edges: [{ id: 'unhinted-one', from: 'entry', to: 'middle', label: '', style: 'call', both: false, step: 1 },
      { id: 'unhinted-two', from: 'middle', to: 'finish', label: '', style: 'call', both: false, step: 2 }], texts: [] });
  const { file } = await workspace('geometry', doc); const opened = await openDrawing(page, request, file);
  const placed = await readDrawing(file); const nodes = placed.views[0].nodes;
  const top = nodes.find(n => n.id === 'kind-actor')!; const sameRow = nodes.find(n => n.id === 'kind-client')!;
  const below = nodes.find(n => n.id === 'kind-worker')!;
  expect(top.x).toBeLessThan(sameRow.x!); expect(top.y).toBe(sameRow.y); expect(below.y).toBeGreaterThan(top.y!);
  const loop = nodes.filter(n => n.parent === group.id);
  expect(new Set(loop.map(n => n.y)).size).toBeGreaterThan(1); // The inner path must not remain a flat row.
  const fallback = placed.views[1].nodes;
  expect(fallback[0].x).toBeLessThan(fallback[1].x!); expect(fallback[1].x).toBeLessThan(fallback[2].x!);
  expect(new Set(fallback.map(n => n.y)).size).toBe(1); // Steps order the main row even without place hints.
  const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg`); expect(response.status()).toBe(200);
  const svg = await svgInfo(page, await response.text()); expect(svg.error).toBe(false); expect(svg.forbidden).toBe(false);
  expect(svg.nodes).toHaveLength(nodes.length); expect(svg.edges).toHaveLength(placed.views[0].edges.length);
  const zoom = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')) / 100;
  for (const node of nodes) {
    const ui = page.getByTestId(`node-${node.id}`);
    await expect(ui).toHaveAttribute('data-kind', node.kind); await expect(ui).toHaveAttribute('data-form', node.form);
    await expect(ui).toHaveAttribute('data-parent', node.parent ?? ''); await expect(ui.getByTestId('node-label')).toHaveText(node.label);
    await expect(ui.getByTestId('node-item')).toHaveCount(node.items.length);
    const shape = svg.nodes.find(n => n.id === node.id)!; const size = await box(ui);
    // zoom-level is rounded to a whole percent; account only for that rounding and subpixels.
    expect(Math.abs(size.width - shape.width * zoom)).toBeLessThanOrEqual(shape.width * 0.005 + 1);
    expect(Math.abs(size.height - shape.height * zoom)).toBeLessThanOrEqual(shape.height * 0.005 + 1);
    if (node.form === 'card') expect(shape.width).toBe(196);
    if (node.form === 'compact') { expect(shape.height).toBe(46); expect(shape.width).toBeGreaterThanOrEqual(140); expect(shape.width).toBeLessThanOrEqual(320); }
    if (node.form === 'panel') expect(shape.height).toBe(24 + 22 + 17 + 10 + 26 * 2 + 4);
  }
  for (const edge of placed.views[0].edges) {
    await expect(page.getByTestId(`edge-${edge.id}`)).toHaveAttribute('data-style', edge.style);
    await expect(page.getByTestId(`edge-${edge.id}`)).toHaveAttribute('data-both', String(edge.both));
    const label = page.getByTestId(`edge-label-${edge.id}`);
    if (await label.count()) for (const node of nodes.filter(n => n.form !== 'group')) expect(overlaps(await box(label), await box(page.getByTestId(`node-${node.id}`)))).toBe(false);
  }
  const groupBox = svg.nodes.find(n => n.id === group.id)!;
  const childShapes = loop.map(n => ({ ...n, ...svg.nodes.find(s => s.id === n.id)! }));
  const minX = Math.min(...loop.map(n => n.x!)); const minY = Math.min(...loop.map(n => n.y!));
  const maxX = Math.max(...childShapes.map(n => n.x! + n.width)); const maxY = Math.max(...childShapes.map(n => n.y! + n.height));
  const storedGroup = nodes.find(n => n.id === group.id)!;
  expect(storedGroup.x).toBe(minX - 18); expect(storedGroup.y).toBe(minY - 46);
  expect(groupBox.width).toBeGreaterThanOrEqual(maxX - minX + 36); expect(groupBox.height).toBe(maxY - minY + 64);
  const before = new Map(nodes.filter(n => n.form !== 'group').map(n => [n.id, [n.x, n.y]]));
  placed.views[0].nodes.push(component('new-cache', { kind: 'data', label: 'Cache', place: null }));
  await writeJSON(file, placed); expect((await cli(['open', file, '--no-browser'])).code).toBe(0);
  const after = await readDrawing(file);
  for (const node of after.views[0].nodes.filter(n => before.has(n.id))) expect([node.x, node.y]).toEqual(before.get(node.id));
  const newSVG = await svgInfo(page, await (await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg`)).text());
  const added = after.views[0].nodes.find(n => n.id === 'new-cache')!; const addedShape = newSVG.nodes.find(n => n.id === added.id)!;
  for (const node of after.views[0].nodes.filter(n => n.id !== added.id)) {
    const shape = newSVG.nodes.find(n => n.id === node.id)!;
    expect(overlaps({ x: added.x!, y: added.y!, width: addedShape.width, height: addedShape.height }, { x: node.x!, y: node.y!, width: shape.width, height: shape.height })).toBe(false);
  }
});
