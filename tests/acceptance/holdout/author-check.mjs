// Independent helper checks only; no product imports, browser, engines or installed dependencies.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const here = new URL('.', import.meta.url);
const files = await readdir(here, { withFileTypes: true });
const scenarios = [];
for (const file of files.filter(f => f.isFile() && f.name.endsWith('.ts'))) {
  const source = await readFile(new URL(file.name, here), 'utf8');
  stripTypeScriptTypes(source);
  if (file.name.startsWith('H')) {
    const title = source.match(/test\('([^']+)'/)[1];
    assert.match(title, /^H\d+ \[[^\]]+\] .+/);
    assert.equal(title.split(' ')[0], file.name.split('_')[0]);
    scenarios.push(title.split(' ')[0]);
  }
  for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g))
    assert.ok(match[1].startsWith('./') || ['@playwright/test', 'node:fs/promises', 'node:fs', 'node:path', 'node:os', 'node:url', 'node:net', 'node:child_process', 'node:crypto'].includes(match[1]), match[1]);
}
const verify = JSON.parse(await readFile(new URL('verify.json', here), 'utf8'));
assert.ok(verify.expected.length > 0);
const last = Number(verify.expected.at(-1).slice(1));
// Ids removed by the owner's 2026-10-19 scope decision (Simplify flow and overview-as-map targets).
const retired = ['H46', 'H47', 'H48', 'H57', 'H58', 'H59'];
assert.deepEqual(verify.expected, Array.from({ length: last - 14 }, (_, i) => `H${i + 15}`).filter(id => !retired.includes(id)));
assert.equal(verify.expected.length, 63);
assert.ok(files.every(f => !retired.some(id => f.name.startsWith(`${id}_`))), 'a retired scenario file is still present');
assert.deepEqual(scenarios.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))), verify.expected);
assert.deepEqual([verify.runs, verify.perScenario, verify.overall, verify.timeoutMs], [3, 2, 0.9, 1800000]);
assert.equal(verify.command, 'npx playwright test -c tests/acceptance/holdout');
assert.equal(verify.format, 'playwright-json'); assert.equal(verify.report, 'test-results/holdout.json');

globalThis.authorExpect = (value) => ({
  toBeTruthy: () => assert.ok(value),
  toBe: expected => assert.equal(value, expected),
  toEqual: expected => assert.deepEqual(value, expected),
  toHaveLength: expected => assert.equal(value.length, expected),
  toBeGreaterThan: expected => assert.ok(value > expected, `${value} > ${expected}`),
  toBeGreaterThanOrEqual: expected => assert.ok(value >= expected, `${value} >= ${expected}`),
  toBeLessThan: expected => assert.ok(value < expected, `${value} < ${expected}`),
  toBeLessThanOrEqual: expected => assert.ok(value <= expected, `${value} <= ${expected}`),
});
const load = async (name, replace = source => source) => {
  const source = replace(stripTypeScriptTypes(await readFile(new URL(name, here), 'utf8')));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
};
const v7 = await load('helpers-v7.ts'); globalThis.authorV7 = v7;
const v8 = await load('helpers-v8.ts', source => source
  .replace(/import \{\s*expect\s*,?\s*\} from ['"]@playwright\/test['"];?/, 'const expect = globalThis.authorExpect;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v7['"];?/, 'const { assembleRoute, onBorder } = globalThis.authorV7;'));
const point = (x, y) => ({ x, y }), source = { left: 0, right: 196, top: 0, bottom: 100 }, target = { ...source, top: 600, bottom: 700 };
const geometry = (route, badges = [], nodes = []) => ({ source, target, scale: 1, sampled: 100, routes: [route], badges,
  nodes: [{ id: 'start', box: source }, { id: 'end', box: target }, ...nodes] });
const direct = [point(98, 100), point(98, 600)];
assert.throws(() => v7.assembleRoute([[point(98, 100), point(98, 110)], [point(98, 590), point(98, 600)]], source, target, 0.3));
assert.throws(() => v8.checkBorders({ ...geometry(direct), routes: [[point(98, 100), point(98, 110)], [point(98, 590), point(98, 600)]] }));
const joined = v7.assembleRoute([[point(98, 600), point(98, 300)], [point(98, 100), point(98, 300)]], source, target, 0.3);
v8.checkBorders(geometry(joined));
assert.deepEqual([joined[0], joined.at(-1)], direct);
assert.ok(v8.routeDistance(direct, joined) < 0.001);
assert.ok(v8.routeDistance(direct, [direct[0], point(180, 350), direct[1]]) > 50);
v8.compareRoutes(geometry(direct), geometry(joined));
const fitted = geometry(joined);
const mapPoint = p => point(p.x * 0.5 + 42, p.y * 0.5 + 20);
const mapBox = b => ({ left: b.left * 0.5 + 42, right: b.right * 0.5 + 42, top: b.top * 0.5 + 20, bottom: b.bottom * 0.5 + 20 });
const wronglyFitted = { ...fitted, source: mapBox(source), target: mapBox(target), scale: 0.5,
  routes: [joined.map(mapPoint)], nodes: fitted.nodes.map(n => ({ ...n, box: mapBox(n.box) })) };
v8.compareRoutes(geometry(direct), wronglyFitted, true);
assert.throws(() => v8.compareRoutes(geometry(direct), wronglyFitted, false, 0.3));
const translated = geometry(direct.map(p => point(p.x + 2, p.y)));
assert.throws(() => v8.compareRoutes(geometry(direct), translated, false, 0.3));
assert.throws(() => v8.checkContained(geometry([direct[0], point(500, 350), direct[1]])));
assert.throws(() => v8.checkContained(geometry([direct[0], point(98, -100), direct[1]])));

const obstacle = { left: 0, right: 196, top: 280, bottom: 380 };
const bounds = [{ id: 'obstacle', box: obstacle }, { id: 'left', box: { left: -500, right: -304, top: 900, bottom: 1000 } },
  { id: 'right', box: { left: 500, right: 696, top: 1100, bottom: 1200 } }];
const route = x => [point(196, 50), point(x, 50), point(x, 300), point(x, 330), point(x, 380), point(x, 650), point(196, 650)];
const badge = x => ({ left: x - 12, right: x + 12, top: 318, bottom: 342 });
v8.checkContained(geometry(route(220), [badge(220)], bounds));
assert.throws(() => v8.checkContained(geometry(route(220), [{ ...badge(220), bottom: 1300 }], bounds)));

// Exercise the actual browser measurement callback with synthetic SVG primitives, including decoration.
class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { Object.assign(this, { a, b, c, d, e, f }); }
  inverse() {
    const k = this.a * this.d - this.b * this.c;
    return new Matrix(this.d / k, -this.b / k, -this.c / k, this.a / k,
      (this.c * this.f - this.d * this.e) / k, (this.b * this.e - this.a * this.f) / k);
  }
  multiply(m) { return new Matrix(this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b,
    this.a * m.c + this.c * m.d, this.b * m.c + this.d * m.d,
    this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f); }
}
globalThis.DOMPoint = class {
  constructor(x, y) { this.x = x; this.y = y; }
  matrixTransform(m) { return new DOMPoint(m.a * this.x + m.c * this.y + m.e, m.b * this.x + m.d * this.y + m.f); }
};
globalThis.getComputedStyle = el => ({ display: 'block', visibility: 'visible', opacity: '1', stroke: 'black', fill: 'none', strokeOpacity: '1', strokeWidth: '1', ...el.style });
class Shape {
  constructor(tag, points, decoration = false, closed = false) { this.tag = tag; this.points = points; this.decoration = decoration; this.closed = closed; }
  getScreenCTM() { return new Matrix(); }
  getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; }
  getAttribute(name) { return name === 'd' && this.closed ? 'M0 0L10 10Z' : null; }
  closest() { return this.decoration ? {} : null; }
  matches(selector) { return selector.split(', ').includes(this.tag); }
  getTotalLength() { return Math.hypot(this.points[1].x - this.points[0].x, this.points[1].y - this.points[0].y) * (this.closed ? 2 : 1); }
  getPointAtLength(length) {
    let t = length / this.getTotalLength(); if (this.closed) t = t <= 0.5 ? t * 2 : (1 - t) * 2;
    return new DOMPoint(this.points[0].x + t * (this.points[1].x - this.points[0].x), this.points[0].y + t * (this.points[1].y - this.points[0].y));
  }
}
globalThis.SVGGeometryElement = Shape;
const node = (id, b) => {
  const group = { getAttribute: name => name === 'data-node-id' ? id : null };
  const rect = { getBBox: () => ({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }),
    getScreenCTM: () => new Matrix(), closest: selector => selector.includes('defs') ? null : group };
  const definition = { ...rect, getBBox: () => ({ x: -1000, y: -1000, width: 2000, height: 2000 }),
    closest: selector => selector.includes('defs') ? {} : group };
  const nested = { ...definition, closest: selector => selector.includes('defs') ? null : {} };
  group.querySelector = () => definition;
  group.querySelectorAll = selector => selector === 'rect' ? [definition, nested, rect] : [];
  return group;
};
const paint = [new Shape('path', [point(98, 350), point(98, 100)]), new Shape('path', [point(98, 350), point(98, 600)]),
  new Shape('rect', [point(-800, 0), point(800, 0)]), new Shape('path', [point(-800, 0), point(800, 0)], true),
  new Shape('path', [point(-800, 0), point(800, 0)], false, true), new Shape('polyline', [point(90, 592), point(98, 600)])];
const edge = { querySelectorAll: selector => selector === '*' ? paint : [] };
const root = { tagName: 'svg', getScreenCTM: () => new Matrix(),
  querySelectorAll: selector => selector.includes('step-badge-') ? [] : [node('start', source), node('end', target)], querySelector: selector => selector.includes('step-badge-') ? null : edge };
const surface = { evaluate: async (fn, input) => fn(root, input) };
const measured = await v7.routeGeometry(surface, 'route', 'start', 'end');
assert.equal(measured.routes.length, 1); assert.equal(measured.ports.length, 1);
assert.ok(measured.routes.flat().every(p => p.x === 98));
assert.deepEqual(measured.source, source); assert.deepEqual(measured.target, target);
assert.ok(measured.straightRuns.some(r => Math.abs(r.length - 500) < 0.01));
v8.checkBorders(measured);
paint.splice(0, paint.length, new Shape('path', [point(98, 100), point(98, 110)]), new Shape('path', [point(98, 590), point(98, 600)]),
  new Shape('rect', direct), new Shape('path', direct, true), new Shape('path', direct, false, true));
await assert.rejects(v7.routeGeometry(surface, 'route', 'start', 'end'));
const rootPath = new Shape('path', direct);
rootPath.querySelectorAll = () => [];
const rootEdgeSurface = { evaluate: async (fn, input) => fn({ ...root, querySelector: selector => selector.includes('step-badge-') ? null : rootPath }, input) };
assert.deepEqual((await v7.routeGeometry(rootEdgeSurface, 'route', 'start', 'end')).ports, [direct[1]]);

// Curves may have no straight sections; collecting their route must still work.
const curve = Array.from({ length: 5001 }, (_, i) => point(98 + 250 * Math.sin(Math.PI * i / 5000), 350 - 250 * Math.cos(Math.PI * i / 5000)));
const curved = await v7.routeGeometry({ evaluate: async () => ({ nodes: geometry(direct).nodes, source, target, pieces: [curve], sampled: curve.length, scale: 1, badges: [], labels: [] }) }, 'curve', 'start', 'end');
v8.checkBorders(curved); assert.equal(curved.straightRuns.length, 0);
const text = (text, x) => ({ tag: 'text', text, box: [[x, 0], [x + 10, 0]], font: 16, characters: [[[x, 0], [x + 10, 0], 0]] });
v8.compareImageText([text('A', -0), text('B', 20)], [text('B', 20.0000008), text('A', 0.0000008)]);
assert.throws(() => v8.compareImageText([text('A', 0)], [text('A', 2)]));
globalThis.authorV8 = v8;
const v9 = await load('helpers-v9.ts', source => source
  .replace(/import \{\s*expect\s*,?\s*\} from ['"]@playwright\/test['"];?/, 'const expect = globalThis.authorExpect;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v7['"];?/, 'const { assembleRoute, onBorder } = globalThis.authorV7;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v8['"];?/, 'const { entersBox } = globalThis.authorV8;'));
const boxes = await v9.drawnNodeBoxes(surface);
assert.deepEqual(boxes.map(b => [b.x, b.y, b.width, b.height]), [[0, 0, 196, 100], [0, 600, 196, 100]]);
const character = (text, x, y = 0, font = 16, nodeId = null) => ({ text, x, y, font, nodeId });
const caption = [character('A', 0), character('B', 10), character('C', 20)];
assert.deepEqual(v9.textFontContent(caption), v9.textFontContent([character('C', 0, 20), character('B', 10), character('A', 0)]));
assert.notDeepEqual(v9.textFontContent(caption), v9.textFontContent([character('B', 0), character('A', 10), character('C', 20)]));
assert.notDeepEqual(v9.textFontContent([character('A', 0)]), v9.textFontContent([character('A', 0, 0, 12)]));
assert.notDeepEqual(v9.textFontContent([character('A', 0)]), v9.textFontContent([character('B', 0)]));
assert.throws(() => v9.textFontContent([]));
// Exercise the delivered text callback with equivalent text/tspan partitions and reversed children.
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.document = {
  createTreeWalker: text => { let i = 0; return { nextNode: () => text.runs[i++] ?? null }; },
  createRange: () => {
    let run, index;
    return { setStart: (node, at) => { run = node; index = at; }, setEnd: () => {},
      getBoundingClientRect: () => ({ left: run.positions[index].x, right: run.positions[index].x + 8,
        top: run.positions[index].y, bottom: run.positions[index].y + 16, width: 8, height: 16 }) };
  },
};
const svgText = (chunks, font = 16) => {
  const text = { style: { fill: 'black', fillOpacity: '1', fontSize: String(font) }, parentElement: null, closest: () => null };
  text.runs = chunks.map(({ content, positions }) => ({ textContent: content, positions, parentElement: text }));
  return text;
};
const originalText = svgText([{ content: 'ABC', positions: [point(0, 0), point(10, 0), point(20, 0)] }]);
const regroupedText = [svgText([{ content: 'C', positions: [point(0, 20)] }]),
  svgText([{ content: 'B', positions: [point(10, 0)] }, { content: 'A', positions: [point(0, 0)] }])];
const textSurface = texts => ({ evaluate: async fn => fn({ tagName: 'svg', getScreenCTM: () => new Matrix(), querySelectorAll: () => texts }) });
assert.deepEqual(await v9.visibleTextContent(textSurface([originalText])), await v9.visibleTextContent(textSurface(regroupedText)));
regroupedText[0].style.fontSize = '12';
assert.notDeepEqual(await v9.visibleTextContent(textSurface([originalText])), await v9.visibleTextContent(textSurface(regroupedText)));

document.fonts = { check: () => true };
const fieldSurface = texts => {
  const group = { getAttribute: name => name === 'data-node-id' ? 'card' : null };
  const rect = { getBBox: () => ({ x: 0, y: 0, width: 176, height: 84 }), getScreenCTM: () => new Matrix(),
    closest: selector => selector.includes('defs') ? null : group };
  for (const text of texts) text.closest = selector => selector.includes('defs') ? null : group;
  group.querySelectorAll = selector => selector === 'rect' ? [rect] : texts;
  return { evaluate: async (fn, input) => fn({ tagName: 'svg', getScreenCTM: () => new Matrix(), querySelectorAll: () => [group] }, input) };
};
const run = (content, x, y) => ({ content, positions: [...content].map((_, i) => point(x + 10 * i, y)) });
const joinedField = fieldSurface([svgText([run('Work', 0, 0), run('A', 0, 30), run('BC', 10, 30)])]);
const splitField = fieldSurface([svgText([run('C', 20, 30)]), svgText([run('Work', 0, 0)]), svgText([run('AB', 0, 30)])]);
assert.deepEqual(await v9.paintedTextField(joinedField, 'card', 'ABC'), await v9.paintedTextField(splitField, 'card', 'ABC'));
assert.deepEqual((await v9.paintedTextField(joinedField, 'card', 'ABC')).room, { left: 0, right: 28, width: 28 });
await assert.rejects(v9.paintedTextField(joinedField, 'card', 'ABCD'));

// Run the delivered name classifier with names/sub-lines sharing text elements and runs.
const v5Source = await readFile(new URL('helpers-v5.ts', here), 'utf8');
const sizeSource = v5Source.slice(v5Source.indexOf('export async function visibleTextSizes('), v5Source.indexOf('export function reportNames('));
const { visibleTextSizes } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sizeSource)).toString('base64')}`);
const sizeSurface = partitions => {
  const group = { getAttribute: () => 'card' };
  const texts = partitions.map(chunks => {
    const text = { getScreenCTM: () => new Matrix() };
    const closest = selector => selector === 'text' ? text : selector.includes('g[data-node-id]') ? group : null;
    text.runs = chunks.map(([content, font, y]) => ({ textContent: content, y,
      parentElement: { closest, getScreenCTM: () => new Matrix(), style: { fill: 'black', fillOpacity: '1', fontSize: `${font}px`, fontWeight: font === 16.5 ? '600' : '400' } } }));
    const positions = text.runs.flatMap(r => [...r.textContent].map((_, x) => point(x, r.y)));
    text.getStartPositionOfChar = i => { assert.ok(positions[i], `character ${i} outside text`); return new DOMPoint(positions[i].x, positions[i].y); };
    return text;
  });
  const root = { tagName: 'svg', getScreenCTM: () => new Matrix(), querySelectorAll: () => [group], runs: texts.flatMap(t => t.runs) };
  return { evaluate: async (fn, input) => fn(root, input) };
};
const sized = async (partitions, label = 'Work') => visibleTextSizes(sizeSurface(partitions), { nodes: [{ id: 'card', label }] });
for (const partitions of [
  [[['Work', 16.5, 0]], [['Start here', 12.5, 30]]],
  [[['Work', 16.5, 0], ['Start here', 12.5, 30]]],
  [[['Wo', 16.5, 0], ['rk', 16.5, 0], ['Start here', 12.5, 30]]],
  [[['Wo', 16.5, 0]], [['rk', 16.5, 0], ['Start here', 12.5, 30]]],
]) {
  const measured = await sized(partitions), names = measured.runs.filter(r => r.name), details = measured.runs.filter(r => !r.name);
  assert.equal(names.map(r => r.text).join(''), 'Work');
  assert.equal(details.map(r => r.text).join(''), 'Start here');
  assert.ok(names.every(r => r.font === 16.5)); assert.ok(details.every(r => r.font === 12.5));
  assert.ok(names.every(r => r.weight === 600)); assert.ok(details.every(r => r.weight === 400));
  assert.deepEqual([...new Set(names.flatMap(r => r.lineYs))], [0]);
  assert.equal(measured.namesOpened, 16.5); assert.equal(measured.opened, 12.5);
}
assert.deepEqual((await sized([[['WorkStart here', 16.5, 0]]])).runs.map(r => [r.text, r.name]), [['Work', true], ['Start here', false]]);
assert.equal((await sized([[['Work now', 16.5, 0], ['Start here', 12.5, 30]]], 'Work now')).runs[0].text, 'Work now');
assert.equal((await sized([[['Wor…', 16.5, 0], ['Start here', 12.5, 30]]])).runs[0].name, true);
await assert.rejects(sized([[['Start here', 12.5, 30]]]));

// Execute H77's selector callback: wrapper plus identified child is still one connection.
const h77 = await readFile(new URL('H77_post_reduces_previous_line_crossings.spec.ts', here), 'utf8');
const orderBody = h77.match(/\.evaluateAll\((edges => [^\n]+)\);/)[1];
const edgeOrder = new Function(`return ${stripTypeScriptTypes(orderBody)}`)();
const edgeId = (id, test = false) => ({ getAttribute: name => name === (test ? 'data-testid' : 'data-edge-id') ? (test ? `edge-${id}` : id) : null });
assert.deepEqual(edgeOrder([edgeId('earlier'), edgeId('earlier', true), edgeId('later'), edgeId('later', true)]), ['earlier', 'later']);
assert.deepEqual(edgeOrder([edgeId('later', true), edgeId('earlier', true)]), ['later', 'earlier']);
assert.deepEqual(edgeOrder([edgeId('earlier'), edgeId('later')]), ['earlier', 'later']);

const helpers = await readFile(new URL('helpers.ts', here), 'utf8');
const numericSource = helpers.slice(helpers.indexOf('export function reportNumber('), helpers.indexOf('export async function reportAttributes('));
const { reportNumber } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(numericSource)).toString('base64')}`);
for (const raw of [null, '', ' ', 'NaN', 'Infinity', 'absent']) assert.throws(() => reportNumber(raw, 'longest'));
assert.equal(reportNumber('-0', 'longest'), 0); assert.equal(reportNumber('0', 'longest'), 0);
assert.equal(reportNumber('0.125', 'longest'), 0.125);

const reportView = { nodes: [{ id: 'a', parent: 'zone' }, { id: 'b', parent: null }, { id: 'c', parent: null },
  { id: 'd', parent: null }, { id: 'part', parent: 'zone' }, { id: 'zone', form: 'group', parent: null }],
  edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'cd', from: 'c', to: 'd' }, { id: 'ac', from: 'a', to: 'c' }] };
const reportNodes = [['a', -2, -1, -2, -1], ['b', 11, 12, 11, 12], ['c', -2, -1, 11, 12], ['d', 11, 12, -2, -1],
  ['part', 4, 6, 4, 6], ['zone', -3, 7, -3, 7]].map(([id, left, right, top, bottom]) => ({ id, box: { left, right, top, bottom } }));
const reportGeometries = [[point(0, 0), point(10, 10)], [point(0, 10), point(10, 0)], [point(0, 0), point(0, 10)]]
  .map(r => ({ nodes: reportNodes, routes: [r], scale: 1 }));
const measuredReport = v9.measuredRouteReport(reportView, reportGeometries);
assert.equal(measuredReport.crossings, 1);
assert.deepEqual(measuredReport.edgesOverParts, [{ edge: 'ab', node: 'part' }, { edge: 'cd', node: 'part' }]);
assert.ok(Math.abs(measuredReport.longestConnection - 2 / 3) < 1e-12);
assert.notEqual(measuredReport.longestConnection, 0.42);
const repeated = reportGeometries.map(g => ({ ...g }));
repeated[0].routes = [[point(0, 0), point(10, 10), point(0, 0), point(10, 10)]];
assert.equal(v9.measuredRouteReport(reportView, repeated).crossings, 1);
const scaled = reportGeometries.map(g => ({ ...g, scale: 0.5, nodes: g.nodes.map(n => ({ ...n, box: mapBox(n.box) })), routes: g.routes.map(r => r.map(mapPoint)) }));
assert.ok(Math.abs(v9.measuredRouteReport(reportView, scaled).longestConnection - measuredReport.longestConnection) < 1e-12);
assert.deepEqual(v9.measuredRouteReport(reportView, scaled).edgesOverParts, measuredReport.edgesOverParts);
const tangent = reportGeometries.map(g => ({ ...g }));
tangent[1].routes = [[point(0, 10), point(5, 5), point(10, 10)]];
assert.equal(v9.measuredRouteReport(reportView, tangent).crossings, 0);
const incidentView = { ...reportView, edges: reportView.edges.map(e => ({ ...e })) };
incidentView.edges[1].from = 'a';
assert.equal(v9.measuredRouteReport(incidentView, reportGeometries).crossings, 0);
const endpointView = { ...reportView, edges: reportView.edges.map(e => ({ ...e })) };
endpointView.edges[0].to = 'part';
assert.deepEqual(v9.measuredRouteReport(endpointView, reportGeometries).edgesOverParts, [{ edge: 'cd', node: 'part' }]);
await assert.rejects(async () => v9.measuredRouteReport(reportView, []));

const h76 = await readFile(new URL('H76_post_card_subline_width.spec.ts', here), 'utf8');
const probeBody = h76.match(/evaluate\(async el => \{([\s\S]*?)\n  \}\);/)[1];
const probe = new Function(`return ${stripTypeScriptTypes(`async el => {${probeBody}\n}`)}`)();
const leaf = { style: { fontSize: '12.5px', fontFamily: 'Geist', fontWeight: '400' } };
document.createTreeWalker = () => { let first = true; return { nextNode: () => first ? (first = false, { textContent: 'M', parentElement: leaf }) : null }; };
document.fonts.load = async () => [];
const copied = {};
let glyphWidth = 11, removed = 0;
document.createElementNS = () => ({ style: { setProperty: (key, value) => { copied[key] = value; } },
  textContent: '', getBBox() { return { width: this.textContent.length * glyphWidth }; }, remove() { removed++; } });
const baseStyle = globalThis.getComputedStyle;
globalThis.getComputedStyle = el => ({ ...baseStyle(el), getPropertyValue: key => ({ 'font-size': el.style.fontSize, 'font-family': el.style.fontFamily, 'font-weight': el.style.fontWeight })[key] ?? '' });
const candidate = await probe({ closest: () => ({ append() {} }) });
assert.ok(candidate.width > 176);
assert.ok(candidate.sub.length <= 60);
assert.equal(copied['font-size'], '12.5px');
assert.equal(copied['font-family'], 'Geist');
assert.equal(removed, 1);
glyphWidth = 240; leaf.style.fontSize = '300px';
assert.equal((await probe({ closest: () => ({ append() {} }) })).sub, 'M');
assert.equal(removed, 2);
glyphWidth = 1;
assert.equal((await probe({ closest: () => ({ append() {} }) })).sub.length, 60);
assert.equal(removed, 3);
document.createElementNS = () => ({ style: { setProperty() {} }, getBBox() { throw new Error('measurement failed'); }, remove() { removed++; } });
await assert.rejects(probe({ closest: () => ({ append() {} }) }), /measurement failed/);
assert.equal(removed, 4);

const baseline = JSON.parse(await readFile(new URL('review-baseline.json', here), 'utf8'));
for (const id of verify.expected) {
  if (Number(id.slice(1)) > 78) continue; // New scenarios have no historical title to preserve.
  const name = files.find(f => f.name.startsWith(`${id}_`)).name;
  const source = await readFile(new URL(name, here), 'utf8');
  assert.equal(source.match(/test\('([^']+)'/)[1], baseline.files[name].title, `${id} id/title/requirements changed`);
}
const currentBaseline = JSON.parse(await readFile(new URL('review-v11-baseline.json', here), 'utf8'));
for (const id of verify.expected) {
  if (Number(id.slice(1)) > 78) continue;
  const name = files.find(f => f.name.startsWith(`${id}_`)).name;
  const source = await readFile(new URL(name, here), 'utf8');
  assert.equal(source.match(/test\('([^']+)'/)[1], currentBaseline.files[name].title, `${id} current id/title/requirements changed`);
}
// Execute only test-owned geometry/factory helpers; never start a server or import product code.
globalThis.authorV8 = v8;
const factories = helpers.slice(helpers.indexOf('export function component('), helpers.indexOf('export async function workspace('));
globalThis.authorHelpers = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(factories)).toString('base64')}`);
const v13 = await load('helpers-v13.ts', source => source
  .replace(/import \{[^}]+\} from ['"]@playwright\/test['"];?/, 'const expect = globalThis.authorExpect;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers['"];?/, 'const { component, drawing } = globalThis.authorHelpers;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v7['"];?/, 'const { onBorder, routeGeometry } = globalThis.authorV7;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v8['"];?/, 'const { entersBox, routeDistance } = globalThis.authorV8;'));
const smooth = 'M 196 50 C 240 50 260 50 300 50 C 340 50 360 50 400 50';
const smoothSource = { left: 0, right: 196, top: 0, bottom: 100 }, smoothTarget = { left: 400, right: 596, top: 0, bottom: 100 };
// Execute the actual path collector with repeated paint, equivalent encodings,
// transparent hit areas, missing curves and a distinct/malformed visible layer.
globalThis.SVGPathElement = class extends Shape {
  constructor(d, style = {}, matrix = new Matrix()) {
    super('path', []); this.d = d; this.style = style; this.matrix = matrix;
    try { this.points = v13.sampleCubics(v13.parseCubics(d)); }
    catch { const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number); this.points = [point(n[0], n[1]), point(n.at(-2), n.at(-1))]; }
    this.sums = [0];
    for (let i = 1; i < this.points.length; i++) this.sums.push(this.sums.at(-1) + v13.distance(this.points[i - 1], this.points[i]));
  }
  getAttribute(name) { return name === 'd' ? this.d : null; }
  getScreenCTM() { return this.matrix; }
  getTotalLength() { return this.sums.at(-1); }
  getPointAtLength(length) {
    let lo = 1, hi = this.sums.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.sums[mid] < length) lo = mid + 1; else hi = mid; }
    const a = this.points[lo - 1], b = this.points[lo], t = (length - this.sums[lo - 1]) / (this.sums[lo] - this.sums[lo - 1]);
    return new DOMPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
};
const smoothSurface = (paint, sourceBox = smoothSource, targetBox = smoothTarget) => {
  const edge = { querySelectorAll: selector => selector === '*' ? paint : [] };
  return { evaluate: async (fn, input) => fn({ tagName: 'svg', getScreenCTM: () => new Matrix(),
    querySelectorAll: selector => selector.includes('step-badge-') ? [] : [node('start', sourceBox), node('end', targetBox)],
    querySelector: selector => selector.includes('edge-label-') || selector.includes('step-badge-') ? null : edge }, input) };
};
for (const count of [1, 2, 3]) {
  const layers = Array.from({ length: count }, () => new SVGPathElement(smooth));
  layers.push(new SVGPathElement('M196 50 L400 50', { stroke: 'transparent' }));
  const collected = await v13.smoothConnection(smoothSurface(layers), 'paint', 'start', 'end');
  assert.equal(collected.curves.length, 2);
}
await v13.smoothConnection(smoothSurface([new SVGPathElement(smooth),
  new SVGPathElement('m196 50 c44 0 64 0 104 0 40 0 60 0 100 0'),
  new SVGPathElement('M196 50 C240 50 360 50 400 50')]), 'paint', 'start', 'end');
for (const bad of ['M196 50 L400 50', 'M196 50 C240 50 260 50 300 50 C300 90 360 50 400 50',
  'M196 50 C240 50 260 0 300 0 C340 0 360 50 400 50'])
  await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement(smooth), new SVGPathElement(bad)]), 'paint', 'start', 'end'));
await assert.rejects(v13.smoothConnection(smoothSurface([]), 'paint', 'start', 'end'));
// The review's adjoining partial paths, with repeated/reversed/out-of-order paint.
const firstHalf = 'M196 50 C240 50 260 50 300 50', secondHalf = 'M300 50 C340 50 360 50 400 50';
for (const paint of [[firstHalf, secondHalf], [secondHalf, firstHalf, secondHalf],
  ['M400 50 C360 50 340 50 300 50', firstHalf]]) {
  const g = await v13.smoothConnection(smoothSurface(paint.map(d => new SVGPathElement(d))), 'paint', 'start', 'end');
  assert.equal(g.curves.length, 2); assert.equal(g.cubicJoins, 1);
}
await v13.smoothConnection(smoothSurface([new SVGPathElement(smooth), new SVGPathElement('M250 50 C274 50 326 50 350 50')]), 'paint', 'start', 'end');
// A valid glow cannot certify a foreground with short handles or four adjoining cubics.
const fourPieces = Array.from({ length: 4 }, (_, i) => {
  const x = 196 + 51 * i;
  return `M${x} 50 C${x + 24} 50 ${x + 27} 50 ${x + 51} 50`;
});
const threePieces = Array.from({ length: 3 }, (_, i) => {
  const x = 196 + 68 * i;
  return `M${x} 50 C${x + 24} 50 ${x + 44} 50 ${x + 68} 50`;
});
await v13.smoothConnection(smoothSurface([smooth, ...threePieces].map(d => new SVGPathElement(d))), 'paint', 'start', 'end');
for (const bad of [['M196 50 C197 50 399 50 400 50'], fourPieces, [...fourPieces].reverse(),
  fourPieces.map(d => v13.parseCubics(d)[0]).reverse().map(c => {
    const [a, b, z, end] = [...c].reverse();
    return `M${a.x} ${a.y} C${b.x} ${b.y} ${z.x} ${z.y} ${end.x} ${end.y}`;
  }), ['M250 50 C270 50 330 50 350 50']])
  for (const paint of [[smooth, ...bad], [...bad, smooth]])
    await assert.rejects(v13.smoothConnection(smoothSurface(paint.map(d => new SVGPathElement(d))), 'paint', 'start', 'end'));
for (const partial of ['M250 50 L350 50', 'M250 50 C270 90 330 90 350 50'])
  await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement(smooth), new SVGPathElement(partial)]), 'paint', 'start', 'end'));
await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement(firstHalf),
  new SVGPathElement('M300 50 C300 90 360 50 400 50')]), 'paint', 'start', 'end'));
await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement('M196 50 C220 50 250 50 280 50'),
  new SVGPathElement('M320 50 C340 50 360 50 400 50')]), 'paint', 'start', 'end'));
// Review regressions: every connected foreground stroke counts, independent glyphs do not.
class NonPathStroke extends SVGPathElement {
  constructor(d, tag) {
    super(d); this.tag = tag;
    if (tag === 'polyline') {
      const values = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      this.points = Array.from({ length: values.length / 2 }, (_, i) => point(values[i * 2], values[i * 2 + 1]));
      this.sums = [0];
      for (let i = 1; i < this.points.length; i++) this.sums.push(this.sums.at(-1) + v13.distance(this.points[i - 1], this.points[i]));
    }
  }
  getAttribute() { return null; }
}
for (const tag of ['polyline', 'line']) {
  await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement(smooth), new NonPathStroke('M196 50 L240 50 L240 90 L400 90 L400 50', tag)]), 'paint', 'start', 'end'));
  await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement(firstHalf), new NonPathStroke('M300 50 L400 50', tag)]), 'paint', 'start', 'end'));
}
for (const decoration of ['M250 60 C270 60 330 60 350 60', 'M390 42 C395 42 400 46 400 50 C395 54 390 58 390 58'])
  await v13.smoothConnection(smoothSurface([new SVGPathElement(smooth), new SVGPathElement(decoration, { fill: 'black' })]), 'paint', 'start', 'end');
// The shared badge callback accepts promised edge/text identity, with full paint and transforms.
globalThis.SVGGraphicsElement = Shape;
const badgeSurface = (hookOnNumber = false, nested = false, matrix = new Matrix(), sibling = false) => {
  const text = new Shape('text', []); text.tagName = 'text'; text.textContent = '1'; text.getBBox = () => ({ x: 96, y: 44, width: 8, height: 12 });
  const paint = new Shape('circle', []); paint.style = { fill: 'black', fillOpacity: '1' };
  paint.getBBox = () => ({ x: 88.5, y: 38.5, width: 23, height: 23 }); paint.isPointInFill = p => Math.hypot(p.x - 100, p.y - 50) <= 11.5;
  const wrapper = new Shape('g', []); wrapper.querySelectorAll = selector => selector === 'text' ? [text] : [paint, text];
  wrapper.getBBox = paint.getBBox;
  for (const part of [text, paint, wrapper]) part.getScreenCTM = () => matrix;
  const edge = { querySelectorAll: selector => sibling ? [] : selector === 'text' ? [text] : [paint, text] };
  text.parentElement = nested ? wrapper : edge; wrapper.parentElement = edge;
  const root = { tagName: 'svg', getScreenCTM: () => new Matrix(), querySelectorAll: () => [paint, text], querySelector: selector => selector.includes('step-badge-') ? hookOnNumber ? text : null : edge };
  if (sibling) text.parentElement = root;
  return { evaluate: async (fn, input) => fn(root, input) };
};
for (const hook of [false, true]) for (const nested of [false, true]) {
  const badges = await badgeSurface(hook, nested).evaluate(v7.measureEdgeAnnotations, { edgeId: 'badge' });
  assert.deepEqual(badges.badges, [{ left: 88.5, right: 111.5, top: 38.5, bottom: 61.5 }]); assert.deepEqual(badges.labels, []);
}
assert.deepEqual((await badgeSurface(true, false, new Matrix(), true).evaluate(v7.measureEdgeAnnotations, { edgeId: 'badge' })).badges, [{ left: 88.5, right: 111.5, top: 38.5, bottom: 61.5 }]);
const transformedBadge = await badgeSurface(false, false, new Matrix(0.5, 0, 0, 0.5, 42, 20)).evaluate(v7.measureEdgeAnnotations, { edgeId: 'badge', step: 1 });
assert.deepEqual(transformedBadge.badges, [{ left: 86.25, right: 97.75, top: 39.25, bottom: 50.75 }]);
assert.deepEqual((await badgeSurface().evaluate(v7.measureEdgeAnnotations, { edgeId: 'badge', step: null })).badges, []);
assert.deepEqual((await badgeSurface(false, true).evaluate(v7.measureEdgeAnnotations, { edgeId: 'badge', step: null })).labels, [{ text: '1', box: { left: 88.5, right: 111.5, top: 38.5, bottom: 61.5 } }]);
const measuredLine = await v13.smoothConnection(smoothSurface([new SVGPathElement(smooth)]), 'paint', 'start', 'end');
const changedTransform = await v13.smoothConnection(smoothSurface([new SVGPathElement(smooth, {}, new Matrix(1, 0, 0, 1, 0, 10))]), 'paint', 'start', 'end');
assert.throws(() => v8.compareRoutes(measuredLine, changedTransform, false, 0.3));
const equivalentTransform = await v13.smoothConnection(smoothSurface([new SVGPathElement('M0 0 C44 0 64 0 104 0 C144 0 164 0 204 0', {},
  new Matrix(1, 0, 0, 1, 196, 50))]), 'paint', 'start', 'end');
v8.compareRoutes(measuredLine, equivalentTransform, false, 0.3);
// Execute the new parity orchestration with measured public-geometry records.
// Its DOM measurements are the existing v7/v8/v9 helpers tested above.
const parityInfo = { error: false, width: 1600, height: 900, theme: 'dark', format: 'readme', viewBox: '0 0 1600 900',
  xmlns: 'http://www.w3.org/2000/svg', forbidden: false,
  nodes: [{ id: 'start', width: 196, height: 100, paths: ['icon'] }, { id: 'end', width: 196, height: 100, paths: ['icon'] }],
  edges: [{ id: 'paint', paths: [smooth] }] };
const parityRecord = { info: parityInfo, boxes: measuredLine.nodes.map(n => ({ nodeId: n.id, x: n.box.left, y: n.box.top,
  width: n.box.right - n.box.left, height: n.box.bottom - n.box.top })), text: [{ key: 'start', content: [['A', 14]] }],
  routes: { paint: measuredLine } };
const parityRecords = { first: parityRecord, second: structuredClone(parityRecord) };
globalThis.authorParity = {
  svgInfo: async (_page, key) => parityRecords[key].info,
  inDrawingFonts: async (_page, key, fn) => fn(parityRecords[key]),
  routeGeometry: async (surface, id) => surface.routes[id],
  nodeRectBoxes: async surface => surface.boxes,
  visibleTextContent: async surface => surface.text,
};
const parity = await load('helpers-svg-parity.ts', source => source
  .replace(/import \{[^}]+\} from ['"]@playwright\/test['"];?/, 'const expect = globalThis.authorExpect;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers['"];?/, 'const { svgInfo } = globalThis.authorParity;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v5['"];?/, 'const { inDrawingFonts } = globalThis.authorParity;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v7['"];?/, 'const { routeGeometry } = globalThis.authorParity;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v8['"];?/, 'const { compareRoutes } = globalThis.authorV8; const { nodeRectBoxes } = globalThis.authorParity;')
  .replace(/import \{[^}]+\} from ['"]\.\/helpers-v9['"];?/, 'const { visibleTextContent } = globalThis.authorParity;'));
const parityEdges = [{ id: 'paint', from: 'start', to: 'end' }];
parityRecords.second.info.viewBox = '-0 -0 1600 900';
parityRecords.second.info.nodes.reverse(); parityRecords.second.boxes.reverse();
parityRecords.second.info.edges[0].paths = [firstHalf, secondHalf, smooth];
parityRecords.second.routes.paint = equivalentTransform;
await parity.compareSVGs({}, 'first', 'second', parityEdges);
for (const alter of [r => { r.info.viewBox = '1 0 1600 900'; }, r => { r.routes.paint = changedTransform; }, r => { r.info.edges = []; },
  r => { r.info.nodes.pop(); }, r => { r.boxes[0].x += 5; }, r => { r.text[0].content[0][0] = 'B'; }]) {
  parityRecords.second = structuredClone(parityRecord); alter(parityRecords.second);
  await assert.rejects(parity.compareSVGs({}, 'first', 'second', parityEdges));
}
// Execute the raster callback on tiny synthetic canvases: positional tolerance,
// missing curves, angular substitutes and extra foreground paint all discriminate.
const rasterWidth = 120, rasterHeight = 80;
const whiteRaster = () => new Uint8ClampedArray(rasterWidth * rasterHeight * 4).fill(255);
const drawRaster = (angular = false, shift = 0) => {
  const pixels = whiteRaster();
  for (let x = 20; x <= 100; x++) {
    const y = Math.round(20 + (angular ? x > 60 ? 10 : 0 : 10 * Math.sin((x - 20) / 80 * Math.PI))) + shift;
    for (let dy = -1; dy <= 1; dy++) { const i = ((y + dy) * rasterWidth + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; }
  }
  return pixels;
};
const originalImage = globalThis.Image, originalCreate = document.createElement;
let pngPixels = drawRaster();
globalThis.Image = class {
  get naturalWidth() { return this.src === 'svg' ? rasterWidth / 2 : rasterWidth; }
  get naturalHeight() { return this.src === 'svg' ? rasterHeight / 2 : rasterHeight; }
  async decode() {}
};
document.createElement = () => {
  let key;
  return { getContext: () => ({ drawImage: image => { key = image.src; }, getImageData: () => ({ data: key === 'svg' ? drawRaster() : pngPixels }) }) };
};
try {
  const input = { svg: 'svg', png: 'png', region: { left: 10, right: 50, top: 10, bottom: 15 }, masks: [] };
  let result = await parity.measureRasterAgreement(input); assert.ok(result.ink > 40); assert.equal(result.fraction, 0);
  pngPixels = drawRaster(false, 1); assert.equal((await parity.measureRasterAgreement(input)).fraction, 0);
  for (const wrong of [whiteRaster(), drawRaster(true)]) {
    pngPixels = wrong; assert.ok((await parity.measureRasterAgreement(input)).fraction > 0.03);
  }
  pngPixels = drawRaster(); const extra = drawRaster(true);
  for (let i = 0; i < extra.length; i += 4) if (extra[i] === 0) pngPixels[i] = pngPixels[i + 1] = pngPixels[i + 2] = 0;
  assert.ok((await parity.measureRasterAgreement(input)).fraction > 0.03);
} finally { globalThis.Image = originalImage; document.createElement = originalCreate; }
v13.checkSmooth(v13.parseCubics(smooth), smoothSource, smoothTarget, 0.01);
assert.deepEqual(v13.parseCubics('m1.96e2,50 c44 0 64 0 104 0 40 0 60 0 100 0'), v13.parseCubics(smooth));
for (const d of ['', 'M0 0', 'M0 0 L1 1', 'M0 0 H1', 'M0 0 V1', 'M0 0 Q1 1 2 2', 'M0 0 S1 1 2 2',
  'M0 0 A1 1 0 0 0 2 2', 'M0 0 C1 1 2 2 3 3 Z', 'M0 0 1 1', 'M0 0 C1 1 2 2',
  'M0 0 C1 1 2 2 3 3 M3 3 C4 4 5 5 6 6', 'M0 0 C1 1 2 2 3 3 C4 4 5 5 6 6 C7 7 8 8 9 9 C10 10 11 11 12 12'])
  assert.throws(() => v13.parseCubics(d), d);
const corner = v13.parseCubics(smooth); corner[1][1] = point(300, 90);
assert.throws(() => v13.checkSmooth(corner, smoothSource, smoothTarget, 0.01));
for (const degrees of [0.5, 2]) {
  const joint = v13.parseCubics(smooth); joint[1][1] = point(300 + 40 * Math.cos(degrees * Math.PI / 180), 50 + 40 * Math.sin(degrees * Math.PI / 180));
  if (degrees < 1) v13.checkSmooth(joint, smoothSource, smoothTarget, 0.01);
  else assert.throws(() => v13.checkSmooth(joint, smoothSource, smoothTarget, 0.01));
}
v13.checkSmooth(v13.parseCubics(smooth).reverse().map(c => c.reverse()), smoothSource, smoothTarget, 0.01);
const inward = v13.parseCubics(smooth); inward[0][1] = point(150, 50);
assert.throws(() => v13.checkSmooth(inward, smoothSource, smoothTarget, 0.01));
const wrongEnd = v13.parseCubics(smooth); wrongEnd[1][2] = point(430, 50);
assert.throws(() => v13.checkSmooth(wrongEnd, smoothSource, smoothTarget, 0.01));
assert.ok(Math.abs(v13.angle(point(1, 0), point(Math.cos(Math.PI / 360), Math.sin(Math.PI / 360))) - 0.5) < 1e-9);
assert.ok(v13.angle(point(1, 0), point(Math.cos(Math.PI / 90), Math.sin(Math.PI / 90))) > 1);
assert.throws(() => v13.angle(point(0, 0), point(1, 0)));
const short = { source: { left: 0, right: 10, top: 0, bottom: 10 }, target: { left: 30, right: 40, top: 0, bottom: 10 }, scale: 1 };
assert.equal(v13.arcCap(short), 150); // +120 branch, not 1.8 × 30.
assert.equal(v13.arcCap({ ...short, target: { ...short.target, left: 300, right: 310 } }), 540);

const doc = v13.arcDrawing('continue', 1), asBox = n => ({ left: n.x, right: n.x + (n.form === 'compact' ? 140 : 196), top: n.y, bottom: n.y + (n.form === 'compact' ? 46 : 108) });
const parts = doc.views[0].nodes.filter(n => n.id !== 'zone').map(n => ({ id: n.id, box: asBox(n) }));
const candidateGeometry = { nodes: parts, source: { ...parts[0].box }, target: { ...parts[2].box }, scale: 1 };
v13.checkHorizontalObstruction(candidateGeometry, parts[1].box);
assert.throws(() => v13.checkHorizontalObstruction({ ...candidateGeometry, source: { ...candidateGeometry.source, bottom: 348 } }, parts[1].box));
const witnesses = v13.arcWitnesses(candidateGeometry, parts.map(n => n.box));
assert.ok(witnesses.length > 0);
for (const witness of witnesses) {
  v13.checkSmooth(witness.curves, candidateGeometry.source, candidateGeometry.target, 0.01);
  assert.ok(v13.cubicLengthUpperBound(witness.curves) <= v13.arcCap(candidateGeometry) - 0.001 * candidateGeometry.scale);
  v13.checkClear({ ...candidateGeometry, routes: [witness.points] }, parts.map(n => n.box));
}
// At the cap boundary sampled chords can fit while the true-length upper bound does not.
const boundaryCandidate = d => {
  const span = d - 140, h = Math.min(span / 5, 64), a = point(140, 23), b = point(d, 23);
  const bend = point((a.x + b.x) / 2, 23 + span), t = span / 6;
  return [[a, point(a.x + h, 23), point(bend.x - t, bend.y), bend],
    [bend, point(bend.x + t, bend.y), point(b.x - h, 23), b]];
};
const boundaryGeometry = d => ({ nodes: [], scale: 1,
  source: { left: 0, right: 140, top: 0, bottom: 46 },
  target: { left: d, right: d + 140, top: 0, bottom: 46 } });
const boundaryDelta = d => {
  const curves = boundaryCandidate(d);
  return (v13.lineLength(v13.sampleCubics(curves)) + v13.cubicLengthUpperBound(curves)) / 2 - v13.arcCap(boundaryGeometry(d));
};
let capLow = 300, capHigh = 3000;
assert.ok(boundaryDelta(capLow) < 0 && boundaryDelta(capHigh) > 0);
for (let i = 0; i < 48; i++) {
  const mid = (capLow + capHigh) / 2;
  if (boundaryDelta(mid) < 0) capLow = mid; else capHigh = mid;
}
const boundaryD = (capLow + capHigh) / 2;
for (const scale of [0.5, 1, 1.6]) {
  const box = b => Object.fromEntries(Object.entries(b).map(([key, value]) => [key, value * scale]));
  const base = boundaryGeometry(boundaryD), g = { ...base, scale, source: box(base.source), target: box(base.target) };
  const curves = boundaryCandidate(boundaryD).map(c => c.map(p => point(p.x * scale, p.y * scale)));
  assert.ok(v13.lineLength(v13.sampleCubics(curves)) < v13.arcCap(g));
  assert.ok(v13.cubicLengthUpperBound(curves) > v13.arcCap(g));
  v13.checkSmooth(curves, g.source, g.target, 0.3 * scale, scale);
  v13.checkClear({ ...g, routes: [v13.sampleCubics(curves)] }, [], 0);
  const accepted = v13.arcWitnesses(g, []);
  assert.ok(accepted.length > 0);
  for (const witness of accepted)
    assert.ok(v13.cubicLengthUpperBound(witness.curves) <= v13.arcCap(g) - 0.001 * scale);
}
// A candidate through a forbidden name must be filtered, even when no component occupies it.
assert.equal(v13.arcWitnesses(candidateGeometry, [{ left: -10000, right: 10000, top: -10000, bottom: 10000 }]).length, 0);
const middleGeometry = { nodes: [], routes: [[point(0, 0), point(25, 0), point(50, 0), point(75, 0), point(100, 0)]], scale: 1 };
const annotation = x => ({ left: x - 5, right: x + 5, top: -5, bottom: 5 });
v13.checkNearestMiddle(middleGeometry, annotation(50), []);
assert.throws(() => v13.checkNearestMiddle(middleGeometry, annotation(25), []));
assert.throws(() => v13.checkNearestMiddle(middleGeometry, annotation(50), [annotation(50)]));
const middleBlocker = [{ left: 30, right: 110, top: -5, bottom: 5 }];
assert.throws(() => v13.checkNearestMiddle(middleGeometry, annotation(25), middleBlocker));
v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: -19, bottom: -9 }, middleBlocker);
// Review counterexample: retaining the output's -100 px offset must never constrain candidates.
const curvedMiddle = { nodes: [], scale: 1, routes: [v13.sampleCubics(v13.parseCubics(
  'M 0 0 C 100 0 400 -50 500 -50 C 600 -50 900 0 1000 0'))] };
assert.throws(() => v13.checkNearestMiddle(curvedMiddle, { left: 495, right: 505, top: -155, bottom: -145 }, []));
v13.checkNearestMiddle(curvedMiddle, { left: 495, right: 505, top: -55, bottom: -45 }, []);
// The displaced result still fails after scaling/translation, with no product/browser involved.
const displaced = { left: 495, right: 505, top: -155, bottom: -145 };
assert.throws(() => v13.checkNearestMiddle({ nodes: [], scale: 0.5,
  routes: curvedMiddle.routes.map(r => r.map(p => ({ x: 42 + p.x / 2, y: 20 + p.y / 2 }))) },
  { left: 42 + displaced.left / 2, right: 42 + displaced.right / 2, top: 20 + displaced.top / 2, bottom: 20 + displaced.bottom / 2 }, []));
// Execute H81's actual certificate over the full contractual width ranges, not fixed widths.
const h81 = (await readFile(new URL('H81_automatic_room_and_stored_positions.spec.ts', here), 'utf8')).replace(/\r\n/g, '\n');
const nameCertificate = h81.slice(h81.indexOf('const nameGapDeficit = ') + 'const nameGapDeficit = '.length,
  h81.indexOf('\n\n// A three-cubic')).trim().replace(/;$/, '');
const nameGapDeficit = new Function('arcCap', `return ${stripTypeScriptTypes(nameCertificate)}`)(v13.arcCap);
const nameSource = { left: 250, right: 390, top: 0, bottom: 46 };
const nameTarget = { left: 250, right: 390, top: 142, bottom: 188 };
const nameBarrier = { left: 46, right: 700, top: 110, bottom: 128 };
assert.ok(nameGapDeficit(nameSource, nameTarget, nameBarrier, 1) > 1);
assert.ok(nameGapDeficit(nameSource, { ...nameTarget, top: 800, bottom: 846 }, { ...nameBarrier, top: 768, bottom: 786 }, 1) < 0);
assert.equal(nameGapDeficit(nameSource, nameTarget, { ...nameBarrier, left: 300 }, 1), -Infinity);
assert.equal(nameGapDeficit(nameSource, nameTarget, { ...nameBarrier, top: 0 }, 1), -Infinity);
assert.ok(Math.abs(nameGapDeficit(mapBox(nameSource), mapBox(nameTarget), mapBox(nameBarrier), 0.5) -
  nameGapDeficit(nameSource, nameTarget, nameBarrier, 1) / 2) < 1e-9);
const certificateSource = h81.slice(h81.indexOf('  const noShortArc = ') + '  const noShortArc = '.length,
  h81.indexOf('\n\n  const automatic =')).trim().replace(/;$/, '');
const noShortArc = new Function('expect', 'arcCap', `return ${stripTypeScriptTypes(certificateSource)}`)(globalThis.authorExpect, v13.arcCap);
const panelHeight = 24 + 22 + 10 + 26 * 12 + 4 * 11;
assert.equal(panelHeight, 412);
for (const width of [184, 237, 320]) for (const left of [140, 219, 320]) for (const right of [140, 219, 320]) {
  const walls = [-2, -1, 0, 1, 2].map(row => ({ id: row ? `rail-${row}` : 'wall',
    box: { left: 0, right: width, top: row * panelHeight, bottom: (row + 1) * panelHeight } }));
  const g = { source: { left: -left, right: 0, top: 183, bottom: 229 },
    target: { left: width, right: width + right, top: 183, bottom: 229 }, nodes: walls, scale: 1 };
  noShortArc(g);
  // A separated rail destroys the certificate, even if the overall bounds stay large.
  const hole = structuredClone(g); hole.nodes[0].box.bottom -= 2;
  assert.throws(() => noShortArc(hole));
}
const costSource = h77.match(/const cost = (\(points: Point\[\]\) => [^\n]+);/)[1];
const cost = new Function('lineLength', 'span', 'crossingWitness', 'oldLine', 'later', `return ${stripTypeScriptTypes(costSource)}`)(
  v13.lineLength, 100, v9.crossingWitness, [point(50, 0), point(50, 100)], { scale: 1 });
assert.equal(cost([point(0, 50), point(100, 50)]), 1.25);
assert.equal(cost([point(0, -1), point(100, -1)]), 1);
assert.ok(cost([point(0, 50), point(-20, -20), point(120, -20), point(100, 50)]) > 1.25);
const choiceSource = h77.slice(h77.indexOf('const crossingChoiceWitness = ') + 'const crossingChoiceWitness = '.length,
  h77.indexOf('\n\n// A legal but costlier')).trim().replace(/;$/, '');
const crossingChoiceWitness = new Function('centre', `return ${stripTypeScriptTypes(choiceSource)}`)(v13.centre);
for (const width of [140, 230, 320]) for (const reversed of [false, true]) {
  const box = (x, y) => ({ left: x, right: x + width, top: y, bottom: y + 46 });
  const nodes = [{ id: 'high-left', box: box(0, 0) }, { id: 'low-left', box: box(0, 180) },
    { id: 'high-right', box: box(6000, 0) }, { id: 'low-right', box: box(6000, 180) }];
  const g = { nodes, source: nodes[reversed ? 0 : 1].box, target: nodes[reversed ? 3 : 2].box, scale: 1 };
  const earlierSource = nodes[reversed ? 1 : 0].box, earlierTarget = nodes[reversed ? 2 : 3].box;
  const a = point(earlierSource.right, v13.centre(earlierSource).y), b = point(earlierTarget.left, v13.centre(earlierTarget).y);
  const earlier = v13.sampleCubics([[a, point(a.x + 64, a.y), point(b.x - 64, b.y), b]]);
  const curves = crossingChoiceWitness(g, earlierSource), points = v13.sampleCubics(curves);
  v13.checkSmooth(curves, g.source, g.target, 0.3); v13.checkClear({ ...g, routes: [points] }, nodes.map(n => n.box));
  v13.checkCap({ ...g, routes: [points] }); assert.equal(v9.crossingWitness(earlier, points, 16), null);
  const span = v13.distance(v13.centre(g.source), v13.centre(g.target));
  const lowerBound = Math.hypot(g.target.left - g.source.right, 134) / span + 0.25;
  const candidateCost = v13.lineLength(points) / span;
  assert.ok(candidateCost + 0.005 < lowerBound, `${width}/${reversed}: ${candidateCost} < ${lowerBound}`);
  // A zero crossing penalty would select a cheaper crossing witness and fails the certificate's cost bound.
  const p = point(g.source.right, v13.centre(g.source).y), q = point(g.target.left, v13.centre(g.target).y);
  const crossing = v13.sampleCubics([[p, point(p.x + 64, p.y), point(q.x - 64, q.y), q]]);
  assert.ok(v9.crossingWitness(earlier, crossing, 16));
  assert.ok(v13.lineLength(crossing) / span < candidateCost);
  assert.ok(v13.lineLength(crossing) / span + 0.25 > candidateCost + 0.001);
}
// v15: exact clearance boundaries and illegal alternatives cannot bound output.
const clearancePart = { left: 30, right: 70, top: 8, bottom: 20 };
const clearanceGeometry = { ...candidateGeometry, source: { left: -10, right: 0, top: -5, bottom: 5 },
  target: { left: 100, right: 110, top: -5, bottom: 5 },
  nodes: [{ id: 'blocker', box: clearancePart }], routes: [[point(0, 0), point(100, 0)]] };
assert.equal(v13.arcClear(clearanceGeometry, [clearancePart]), true);
assert.equal(v13.arcClear({ ...clearanceGeometry, nodes: [{ id: 'blocker', box: { ...clearancePart, top: 7.5 } }] }, [{ ...clearancePart, top: 7.5 }]), false);
assert.equal(v13.arcClear({ ...clearanceGeometry, routes: [[point(0, 0), point(-5, 0), point(100, 0)]] }, []), false);
assert.equal(v13.segmentBoxDistance(point(0, 0), point(0, 1), { left: 3, right: 4, top: 5, bottom: 6 }), 5);
assert.equal(v13.segmentBoxDistance(point(-10, 0), point(10, 0), { left: -1, right: 1, top: -1, bottom: 1 }), 0);
// A tangent box with zero clearance used to be accepted; a 4 px gap is required.
assert.throws(() => v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: -15, bottom: -5 }, middleBlocker));
v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: -19, bottom: -9 }, middleBlocker);
// A box beyond the label's distance limit must not be accepted even if unobstructed.
assert.throws(() => v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: 30, bottom: 40 }, []));
const tinyBlocker = [{ left: 48, right: 52, top: -2, bottom: 2 }];
v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: -15, bottom: -5 }, tinyBlocker, 'badge');
assert.throws(() => v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: -14, bottom: -4 }, tinyBlocker, 'badge'));
v13.checkNearestMiddle(middleGeometry, { left: 45, right: 55, top: -19, bottom: -9 }, middleBlocker, 'label');
v13.checkNearestMiddle({ ...middleGeometry, scale: 0.5, routes: middleGeometry.routes.map(r => r.map(mapPoint)) },
  mapBox({ left: 45, right: 55, top: -19, bottom: -9 }), middleBlocker.map(mapBox));
// H72-H75: both directions and ordinary/post card sizes still admit legal arcs.
for (const [width, height] of [[196, 108], [176, 84], [204, 104]]) for (const up of [false, true]) for (const side of ['tie', 'left', 'right']) {
  const box = (x, y) => ({ left: x, right: x + width, top: y, bottom: y + height });
  const nodes = [{ id: 'start', box: box(0, up ? 600 : 0) }, { id: 'end', box: box(0, up ? 0 : 600) },
    { id: 'obstacle', box: box(0, 280) }, { id: 'left-bound', box: box(side === 'right' ? 0 : -500, 900) }, { id: 'right-bound', box: box(side === 'left' ? 0 : 500, 1100) }];
  const g = { nodes, source: nodes[0].box, target: nodes[1].box, scale: 1 };
  const alternatives = v13.arcWitnesses(g, nodes.map(n => n.box)); assert.ok(alternatives.length > 0);
  for (const a of alternatives) assert.equal(v13.arcClear({ ...g, routes: [a.points] }, nodes.map(n => n.box)), true);
}
// H77: both paint orders have a legal crossing and a costlier, capped avoidance.
const retentionSource = h77.slice(h77.indexOf('  const retain = drawing('), h77.indexOf('  retain.views.push(retention);'));
const retention = new Function('drawing', 'component', `${stripTypeScriptTypes(retentionSource)} return retention;`)(globalThis.authorHelpers.drawing, globalThis.authorHelpers.component);
const avoidanceSource = h77.slice(h77.indexOf('const costlyAvoidanceWitness = ') + 'const costlyAvoidanceWitness = '.length,
  h77.indexOf('\n\n// Keep the historical')).trim().replace(/;$/, '');
const costlyAvoidanceWitness = new Function('centre', `return ${stripTypeScriptTypes(avoidanceSource)}`)(v13.centre);
for (const scale of [0.5, 1, 1.6]) for (const horizontal of [false, true]) {
  const nodes = retention.nodes.map(n => ({ id: n.id, box: { left: 42 + n.x * scale, right: 42 + (n.x + 140) * scale,
    top: 20 + n.y * scale, bottom: 20 + (n.y + 46) * scale } }));
  const box = id => nodes.find(n => n.id === id).box;
  const later = { source: box(horizontal ? 'left' : 'top'), target: box(horizontal ? 'right' : 'bottom'), scale, nodes };
  const earlierSource = box(horizontal ? 'top' : 'left'), earlierTarget = box(horizontal ? 'bottom' : 'right');
  const first = horizontal ? point(v13.centre(earlierSource).x, earlierSource.bottom) : point(earlierSource.right, v13.centre(earlierSource).y);
  const last = horizontal ? point(v13.centre(earlierTarget).x, earlierTarget.top) : point(earlierTarget.left, v13.centre(earlierTarget).y);
  const a = horizontal ? point(later.source.right, v13.centre(later.source).y) : point(v13.centre(later.source).x, later.source.bottom);
  const b = horizontal ? point(later.target.left, v13.centre(later.target).y) : point(v13.centre(later.target).x, later.target.top);
  const earlier = [first, last], directPoints = [a, b], span = v13.distance(v13.centre(later.source), v13.centre(later.target));
  const curves = costlyAvoidanceWitness(later), points = v13.sampleCubics(curves);
  v13.checkSmooth(curves, later.source, later.target, 0.3 * scale, scale);
  assert.ok(v13.arcClear({ ...later, routes: [points] }, nodes.map(n => n.box)), JSON.stringify({ scale, horizontal,
    clearance: nodes.map(n => [n.id, Math.min(...points.slice(1).map((p, i) => v13.segmentBoxDistance(points[i], p, n.box))) / scale]) }));
  v13.checkClear({ ...later, routes: [points] }, nodes.map(n => n.box), 0); v13.checkCap({ ...later, routes: [points] });
  assert.equal(v9.crossingWitness(earlier, points, 16 * scale), null);
  assert.ok(v9.crossingWitness(earlier, directPoints, 16 * scale));
  const costBounds = h77.slice(h77.indexOf('    const reach = '), h77.indexOf('    expect(crossingCost + 0.005'));
  const { crossingCost, avoidingLowerCost } = new Function('horizontal', 'later', 'first', 'last', 's', 'lineLength', 'directPoints', 'span', 'expect',
    `${stripTypeScriptTypes(costBounds)} return { crossingCost, avoidingLowerCost };`)(horizontal, later, first, last, scale, v13.lineLength, directPoints, span, globalThis.authorExpect);
  assert.ok(crossingCost + 0.005 < avoidingLowerCost);
  // Always choosing zero crossings violates this independently activated bound.
  assert.ok(v13.lineLength(points) / span > crossingCost + 0.001);
}
// H80 v23: execute the delivered helpers and fixtures, from the scenario's own text.
const h80 = (await readFile(new URL('H80_short_clear_arc.spec.ts', here), 'utf8')).replace(/\r\n/g, '\n');
const h80Const = (name, end) => {
  const from = h80.indexOf(`const ${name} = `) + `const ${name} = `.length, to = h80.indexOf(end, from);
  assert.ok(from > `const ${name} = `.length - 1 && to > from, name);
  return stripTypeScriptTypes(h80.slice(from, to).trim().replace(/;$/, ''));
};
const nameEntryBound = new Function('distance', `return ${h80Const('nameEntryBound', '\n// The same bound for every port')}`)(v13.distance);
const gap = new Function(`return ${h80Const('gap', '\nconst anyPortBound')}`)();
const anyPortBound = new Function('gap', `return ${h80Const('anyPortBound', '\n\n// diagram-v2 at spec@3bb5b39')}`)(gap);
const widestNameBox = new Function('groupNameBox', `return ${h80Const('widestNameBox', '\n\n// Side-middle ports')}`)(v13.groupNameBox);
const sideWitness = new Function(`return ${h80Const('sideWitness', '\n\n// LAY-8')}`)();
// The widest box: overhang o <= 0.04 (w + o), i.e. w / 24, of the widest name text.
{
  const group = { left: 0, right: 800, top: 0, bottom: 200 }, painted = { left: 43, right: 43 + 480, top: 15, bottom: 30 };
  assert.equal(widestNameBox(group, [painted], 1).right, 43 + 480 + 2 + 20);
  assert.ok(Math.abs(widestNameBox(group, [painted], 1).right - v13.groupNameBox(group, [painted], 1).right - 0.04 * (480 + 20)) < 1e-9);
}
const shortSetup = h80.slice(h80.indexOf("  const short = drawing('"), h80.indexOf('  const shortFile = '));
const shortFixture = new Function('drawing', 'component', `${stripTypeScriptTypes(shortSetup)} return short;`)(globalThis.authorHelpers.drawing, globalThis.authorHelpers.component);
const feasibleSetup = h80.slice(h80.indexOf('  const feasible = structuredClone(short)'), h80.indexOf('  const capFile = '));
const feasibleFixture = new Function('short', `${stripTypeScriptTypes(feasibleSetup)} return feasible;`)(shortFixture);
// Apply only the contracted compact/group measurements to the actual input.
// Painted width: the builder's Geist measurement of 48 W (x -457 to 217.9 at
// group left -500), scaled per letter; `width` overrides it for range checks.
const shortGeometry = (doc, width) => {
  const input = doc.views[0].nodes, zone = input.find(n => n.id === 'short-zone');
  const children = input.filter(n => n.parent === zone.id);
  assert.deepEqual(children.map(n => n.id).sort(), ['short-anchor', 'short-end']);
  assert.equal(input.find(n => n.id === 'short-end').parent, zone.id);
  assert.equal(zone.x, undefined); assert.equal(zone.y, undefined);
  const nodes = input.filter(n => n.form !== 'group').map(n => ({ id: n.id,
    box: { left: n.x, right: n.x + 140, top: n.y, bottom: n.y + 46 } }));
  const left = Math.min(...children.map(n => n.x)) - 18, top = Math.min(...children.map(n => n.y)) - 46;
  assert.equal(top, input.find(n => n.id === 'short-end').y - 46, 'short-end is in the first row');
  const painted = { left: left + 43, right: left + 43 + (width ?? 674.9 * zone.label.length / 48), top: top + 15, bottom: top + 30 };
  const group = { left, right: Math.max(painted.right + 2, ...children.map(n => n.x + 140 + 18)), top, bottom: Math.max(...children.map(n => n.y + 46)) + 18 };
  return { nodes, source: nodes.find(n => n.id === 'short-start').box, target: nodes.find(n => n.id === 'short-end').box,
    group, name: v13.groupNameBox(group, [painted], 1), witnessName: widestNameBox(group, [painted], 1), scale: 1 };
};
const shortBase = shortGeometry(shortFixture), feasibleBase = shortGeometry(feasibleFixture);
const near = (a, b) => Math.abs(a - b) < 1e-9;
assert.ok(near(shortBase.name.left, -460) && near(shortBase.name.right, 259.9) && shortBase.name.top === 64 && shortBase.name.bottom === 110);
assert.ok(near(shortBase.witnessName.right, 259.9 + 674.9 / 24));
assert.ok(near(feasibleBase.name.left, -18) && near(feasibleBase.name.right, 25 + 337.45 + 2));
assert.equal(feasibleBase.source.left - feasibleBase.name.left, 77);
assert.deepEqual([shortBase.target.top, feasibleBase.target.top], [110, 110]);
assert.throws(() => shortGeometry({ views: [{ nodes: shortFixture.views[0].nodes.map(n => n.id === 'short-end' ? { ...n, parent: null } : n) }] }));
// The premise is width-robust: any painted 48-W width from 647 px clears 231;
// the v22 anchor (-482) at the measured width did not.
assert.ok(near(anyPortBound(shortBase.source, shortBase.name, shortBase.target), Math.hypot(119.9, 18) + 46 + 119.9));
for (const width of [647, 674.9, 720]) { const b = shortGeometry(shortFixture, width); assert.ok(anyPortBound(b.source, b.name, b.target) > 231, `${width}`); }
{ const b = shortGeometry(shortFixture, 640); assert.ok(anyPortBound(b.source, b.name, b.target) < 231); }
{
  const v22 = structuredClone(shortFixture); v22.views[0].nodes.find(n => n.id === 'short-anchor').x = -482;
  const b = shortGeometry(v22); assert.ok(anyPortBound(b.source, b.name, b.target) < 230, 'the v22 case could not prove its premise');
}
let fallbackCapEvidence;
for (const scale of [0.5, 1, 1.6]) {
  const box = b => ({ left: 42 + b.left * scale, right: 42 + b.right * scale, top: 20 + b.top * scale, bottom: 20 + b.bottom * scale });
  const source = box(shortBase.source), target = box(shortBase.target), name = box(shortBase.name);
  const g = { source, target, scale, nodes: shortBase.nodes.map(n => ({ ...n, box: box(n.box) })) };
  const witnessName = box(shortBase.witnessName);
  const curves = sideWitness(g, witnessName, 'right'), points = v13.sampleCubics(curves);
  v13.checkSmooth(curves, source, target, 0.3 * scale, scale);
  v13.checkClear({ ...g, routes: [points] }, [...g.nodes.map(n => n.box), witnessName], 0);
  for (const [end, id] of [[source, 'short-start'], [target, 'short-end']]) for (const other of g.nodes.filter(n => n.id !== id))
    assert.ok(v13.segmentBoxDistance(point(end.right, end.top), point(end.right, end.bottom), other.box) >= 40 * scale);
  const lower = anyPortBound(source, name, target);
  assert.ok(lower > v13.arcCap(g) + scale);
  // Every sampled port pair on the two borders stays above the any-port bound.
  for (const [sx, sy] of [[source.right, source.bottom], [source.right, source.top], [source.left, source.bottom], [(source.left + source.right) / 2, source.bottom]])
    for (const [tx, ty] of [[target.right, target.top], [target.right, target.bottom], [target.left, target.bottom], [(target.left + target.right) / 2, target.bottom]])
      assert.ok(nameEntryBound(point(sx, sy), name, point(tx, ty)) >= lower - 1e-9);
  assert.ok(v13.lineLength(points) > v13.arcCap(g) + scale);
  assert.throws(() => v13.checkCap({ ...g, routes: [points] }));
  if (scale === 1) fallbackCapEvidence = { lower, upper: v13.cubicLengthUpperBound(curves) };
}
// Execute the delivered covered-top guard: a corner with a horizontal handle
// is a free-side entry; an upward handle at that same corner is forbidden.
const freeEntryLine = h80.split('\n').find(line => line.includes("'the covered top is not a legal entry'"));
const checkFreeEntry = new Function('g', 'expect', stripTypeScriptTypes(freeEntryLine));
const entryAt = (p, h) => ({ scale: 1, curves: [[p, p, h, p]] });
checkFreeEntry(entryAt(point(140, 110), point(164, 110)), globalThis.authorExpect);
checkFreeEntry(entryAt(point(0, 110), point(-24, 110)), globalThis.authorExpect);
checkFreeEntry(entryAt(point(70, 156), point(70, 180)), globalThis.authorExpect);
assert.throws(() => checkFreeEntry(entryAt(point(140, 110), point(140, 86)), globalThis.authorExpect));
// The separate feasible case must activate the other cap branch, without losing fallback coverage.
assert.equal(shortFixture.views[0].nodes.find(n => n.id === 'short-anchor').x, -442);
assert.deepEqual(['x', 'y'].map(k => feasibleFixture.views[0].nodes.find(n => n.id === 'short-anchor')[k]), [0, 260]);
assert.deepEqual(['short-start', 'short-end'].map(id => feasibleFixture.views[0].nodes.find(n => n.id === id).x), [59, 59]);
assert.equal(feasibleFixture.views[0].nodes.find(n => n.id === 'short-zone').label, 'W'.repeat(24));
let feasibleCapEvidence;
for (const scale of [0.5, 1, 1.6]) {
  const box = b => ({ left: 42 + b.left * scale, right: 42 + b.right * scale, top: 20 + b.top * scale, bottom: 20 + b.bottom * scale });
  const source = box(feasibleBase.source), target = box(feasibleBase.target), name = box(feasibleBase.name);
  const g = { source, target, scale, nodes: feasibleBase.nodes.map(n => ({ ...n, box: box(n.box) })) };
  const witnessName = box(feasibleBase.witnessName);
  const curves = sideWitness(g, witnessName, 'left'), points = v13.sampleCubics(curves), span = v13.distance(v13.centre(source), v13.centre(target));
  const lower = anyPortBound(source, name, target), upper = v13.cubicLengthUpperBound(curves);
  assert.ok(near(lower / scale, Math.hypot(77, 18) + 46 + 77));
  assert.ok(lower > 1.8 * span + scale);
  assert.ok(upper < span + 120 * scale);
  v13.checkSmooth(curves, source, target, 0.3 * scale, scale);
  v13.checkClear({ ...g, routes: [points] }, [...g.nodes.map(n => n.box), witnessName], 0);
  v13.checkCap({ ...g, routes: [points] });
  for (const [end, id] of [[source, 'short-start'], [target, 'short-end']]) for (const other of g.nodes.filter(n => n.id !== id))
    assert.ok(v13.segmentBoxDistance(point(end.left, end.top), point(end.left, end.bottom), other.box) >= 40 * scale);
  assert.ok(v13.lineLength(points) > 1.8 * span + scale);
  if (scale === 1) feasibleCapEvidence = { lower, upper };
}
// The left witness does not depend on the name's width; the right way stays far longer.
for (const width of [300, 337.45, 400]) {
  const b = shortGeometry(feasibleFixture, width);
  assert.equal(b.name.left, -18);
  const g = { ...b, routes: [] };
  assert.ok(Math.abs(v13.cubicLengthUpperBound(sideWitness(g, b.witnessName, 'left')) - feasibleCapEvidence.upper) < 1e-6);
  assert.ok(Math.hypot(b.name.right - 199, 18) + 46 + (b.name.right - 199) > 260);
}
console.log(`H80_FEASIBLE_CAP anyPortLowerPx=${feasibleCapEvidence.lower.toFixed(3)} witnessUpperPx=${feasibleCapEvidence.upper.toFixed(3)} wrongCapPx=198 capPx=230`);
// H81: actual fixture setup, fixed-placement exclusion, and one permitted 120 px widening.
const ordinarySetup = h81.slice(h81.indexOf("  const ordinary = drawing('Automatic room')"), h81.indexOf('  const layoutControl = '));
const ordinaryFixture = new Function('drawing', 'component', 'feasible', `${stripTypeScriptTypes(ordinarySetup)} return ordinary;`);
for (const feasible of [true, false]) {
  const doc = ordinaryFixture(globalThis.authorHelpers.drawing, globalThis.authorHelpers.component, feasible);
  assert.equal(doc.views[0].nodes.length, feasible ? 6 : 12);
  assert.ok(doc.views[0].nodes.every(n => n.x === undefined && n.y === undefined));
  assert.equal(doc.views[0].nodes.find(n => n.id === 'end-zone').label, 'W'.repeat(feasible ? 34 : 48));
  assert.deepEqual(doc.views[0].nodes.filter(n => n.parent === 'end-zone' && n.place.row === 1).map(n => n.id), []);
  assert.equal(doc.views[0].nodes.find(n => n.id === 'end-1').form, feasible ? 'panel' : 'compact');
}
const roomSource = h81.slice(h81.indexOf('const roomWitness = ') + 'const roomWitness = '.length, h81.indexOf('\n\n// Three-cubic certificate')).trim().replace(/;$/, '');
const roomWitness = new Function('centre', `return ${stripTypeScriptTypes(roomSource)}`)(v13.centre);
const boundedSource = h81.slice(h81.indexOf('const boundedRoomWitness = ') + 'const boundedRoomWitness = '.length, h81.indexOf('\n\n// LAY-8')).trim().replace(/;$/, '');
const boundedRoomWitness = new Function('centre', `return ${stripTypeScriptTypes(boundedSource)}`)(v13.centre);
// Supplied compact cells use 36 px columns and 32 px rows. A one-item panel
// is 184 x 82. The 34-W header stays attached to its first row throughout.
const roomNodes = ['start', 'end'].flatMap((prefix, row) => Array.from({ length: 2 }, (_, col) => ({ id: `${prefix}-${col}`,
  box: { left: 58 + 176 * col + (col > 1 ? 44 : 0), right: 58 + 176 * col + (col > 1 ? 44 : 0) + (col === 1 ? 184 : 140),
    top: row ? 264 : 86, bottom: (row ? 264 : 86) + (col === 1 ? 82 : 46) } })));
const baseRoom = { nodes: roomNodes, source: roomNodes[1].box, target: roomNodes[3].box, scale: 1 };
// The supplied 34-W header ends at x578; also cover the former x571 estimate.
const roomNames = [{ left: 40, right: 578, top: 40, bottom: 86 }, { left: 40, right: 578, top: 218, bottom: 264 }];
const shiftRoom = (id, b) => {
  const col = Number(id.split('-')[1]);
  return { ...b, left: b.left + (col >= 1 ? 120 : 0), right: b.right + (col >= 1 ? 120 : 0) };
};
const widenedRoom = { ...baseRoom, source: shiftRoom('start-1', baseRoom.source), target: shiftRoom('end-1', baseRoom.target),
  nodes: roomNodes.map(n => ({ ...n, box: shiftRoom(n.id, n.box) })) };
const widenedNames = roomNames;
for (const scale of [0.5, 1, 1.6]) for (const right of [571, 578, 584]) {
  const box = b => ({ left: 42 + b.left * scale, right: 42 + b.right * scale, top: 20 + b.top * scale, bottom: 20 + b.bottom * scale });
  const base = { ...baseRoom, source: box(baseRoom.source), target: box(baseRoom.target), scale,
    nodes: baseRoom.nodes.map(n => ({ ...n, box: box(n.box) })) };
  const g = { ...widenedRoom, source: box(widenedRoom.source), target: box(widenedRoom.target), scale,
    nodes: widenedRoom.nodes.map(n => ({ ...n, box: box(n.box) })) };
  const minimumNames = widenedNames.map(n => box({ ...n, right }));
  const names = widenedNames.map(n => v13.groupNameBox(box(n),
    [box({ left: n.left + 43, right: right - 2, top: n.top + 15, bottom: n.top + 30 })], scale, 'maximum'));
  const curves = boundedRoomWitness(g, names);
  assert.ok(nameGapDeficit(base.source, base.target, minimumNames[1], scale) > scale);
  assert.ok(g.target.right < names[1].right);
  assert.ok(nameGapDeficit(g.source, g.target, names[1], scale) < 0);
  v13.checkSmooth(curves, g.source, g.target, 0.3 * scale, scale);
  v13.checkClear({ ...g, routes: [v13.sampleCubics(curves)] }, [...g.nodes.map(n => n.box), ...names], 0);
  assert.ok(v13.cubicLengthUpperBound(curves) < v13.arcCap(g) - scale);
  for (const n of g.nodes.filter(n => n.id !== 'end-1'))
    assert.ok(v13.segmentBoxDistance(point(g.target.right, g.target.top), point(g.target.right, g.target.bottom), n.box) >= 40 * scale - 1e-7);
  // Without widening, the same witness cannot fit the cap; independently,
  // the all-port lower bound rules out every ordinary arc.
  assert.ok(v13.cubicLengthUpperBound(boundedRoomWitness(base, names)) > v13.arcCap(base));
}
const rollbackNodes = ['start', 'end'].flatMap((prefix, row) => Array.from({ length: 5 }, (_, col) => ({ id: `${prefix}-${col}`,
  box: { left: 58 + 176 * col, right: 198 + 176 * col, top: row ? 228 : 86, bottom: row ? 274 : 132 } })));
const rollbackRoom = { nodes: rollbackNodes, source: rollbackNodes[1].box, target: rollbackNodes[6].box, scale: 1 };
const rollbackNames = [{ left: 40, right: 792, top: 40, bottom: 86 }, { left: 40, right: 792, top: 182, bottom: 228 }];
assert.ok(nameGapDeficit(rollbackRoom.source, rollbackRoom.target, rollbackNames[1], 1) > 1);
// The review's 600 px widening is legal despite the fixed-placement deficit.
const escapedNodes = rollbackNodes.map(n => {
  const dx = Number(n.id.split('-')[1]) >= 1 ? 600 : 0;
  return { ...n, box: { ...n.box, left: n.box.left + dx, right: n.box.right + dx } };
});
const escapedRoom = { ...rollbackRoom, nodes: escapedNodes, source: escapedNodes[1].box, target: escapedNodes[6].box };
const escapedCurves = v13.parseCubics('M904 132 C904 156 904 204 904 228');
v13.checkSmooth(escapedCurves, escapedRoom.source, escapedRoom.target, 0.3, 1);
v13.checkClear({ ...escapedRoom, routes: [v13.sampleCubics(escapedCurves)] }, [...escapedNodes.map(n => n.box), ...rollbackNames], 0);
assert.ok(v13.cubicLengthUpperBound(escapedCurves) < v13.arcCap(escapedRoom) - 1);
assert.ok(904 >= rollbackNames[1].right + 10);
assert.equal(v13.lineLength(v13.sampleCubics(escapedCurves)), 96);

console.log(`H80_FALLBACK anyPortLowerPx=${fallbackCapEvidence.lower.toFixed(3)} witnessUpperPx=${fallbackCapEvidence.upper.toFixed(3)} capPx=230`);
console.log(`H81_BOUNDED_ROOM singleGapPx=36->156 freeCorridorPx=546..686 wideningPx=3x40 witnessUpperPx=${v13.cubicLengthUpperBound(boundedRoomWitness(widenedRoom, widenedNames)).toFixed(3)} capPx=${v13.arcCap(widenedRoom)}`);
// The builder's actual v18 second-row layout is not a certificate of success.
const rejectedNodes = ['start', 'end'].flatMap((prefix, row) => Array.from({ length: 5 }, (_, col) => ({ id: `${prefix}-${col}`,
  box: { left: 58 + 176 * col, right: 198 + 176 * col, top: row ? col === 1 ? 306 : 228 : 86, bottom: row ? col === 1 ? 352 : 274 : 132 } })));
for (const grow of [0, 40, 80, 120]) {
  const shifted = (id, b) => ({ ...b, left: b.left + (Number(id.split('-')[1]) >= 3 ? grow : 0), right: b.right + (Number(id.split('-')[1]) >= 3 ? grow : 0) });
  const g = { scale: 1, source: rejectedNodes[1].box, target: rejectedNodes[6].box, nodes: rejectedNodes.map(n => ({ ...n, box: shifted(n.id, n.box) })) };
  const names = [{ left: 40, right: 578, top: 40, bottom: 86 }, { left: 40, right: 578, top: 182, bottom: 228 }];
  const curves = boundedRoomWitness(g, names);
  assert.ok(v13.cubicLengthUpperBound(curves) > v13.arcCap(g) || !v13.arcClear({ ...g, routes: [v13.sampleCubics(curves)] }, [...g.nodes.map(n => n.box), ...names]));
}
// H79: instantiate the delivered guarded fixture and certify a legal multi-cubic alternative.
const h79 = await readFile(new URL('H79_smooth_connections_every_surface.spec.ts', here), 'utf8');
const facingPortSource = h79.slice(h79.indexOf('        const first = g.curves[0]'), h79.indexOf('        // Facing horizontal normals'));
const checkFacingPorts = new Function('g', 'expect', stripTypeScriptTypes(facingPortSource));
const fixtureBody = h79.slice(h79.indexOf('  const doc = arcDrawing();'), h79.indexOf('  const { dir, file }'));
const makeJointFixture = new Function('arcDrawing', 'component', `return ${stripTypeScriptTypes(`() => {${fixtureBody} return doc; }`)}`)(v13.arcDrawing, globalThis.authorHelpers.component);
const jointDoc = makeJointFixture();
for (const view of jointDoc.views) for (const scale of [0.5, 1, 1.6]) {
const prefix = view.postOf ? 'post-' : '';
assert.ok(view.nodes.some(n => n.id === `${prefix}start-top`));
const jointParts = view.nodes.filter(n => n.id !== `${prefix}zone`).map(n => ({ id: n.id.slice(prefix.length), box: {
  left: 42 + n.x * scale, right: 42 + (n.x + (n.form === 'compact' ? 140 : view.postOf ? 176 : 196)) * scale,
  top: 20 + n.y * scale, bottom: 20 + (n.y + (n.form === 'compact' ? 46 : view.postOf ? 84 : 108)) * scale } }));
const jointGeometry = { source: jointParts.find(n => n.id === 'start').box, target: jointParts.find(n => n.id === 'end').box, nodes: jointParts, scale };
v13.checkHorizontalObstruction(jointGeometry, jointParts.find(n => n.id === 'obstacle').box);
for (const [box, prefix, outside] of [[jointGeometry.source, 'start', 'left'], [jointGeometry.target, 'end', 'right']]) {
  const x = outside === 'left' ? box.left : box.right, part = id => jointParts.find(n => n.id === id).box;
  assert.ok(v13.segmentBoxDistance(point(box.left, box.top), point(box.right, box.top), part(`${prefix}-top`)) < 40 * scale);
  assert.ok(v13.segmentBoxDistance(point(box.left, box.bottom), point(box.right, box.bottom), part(`${prefix}-bottom`)) < 40 * scale);
  assert.ok(v13.segmentBoxDistance(point(x, box.top), point(x, box.bottom), part(`${prefix}-${outside}`)) < 40 * scale);
}
const jointName = v13.groupNameBox({ left: 42 + 462 * scale, right: 42 + 676 * scale, top: 20 + 404 * scale, bottom: 20 + 576 * scale },
  [{ left: 42 + 505 * scale, right: 42 + 620 * scale, top: 20 + 419 * scale, bottom: 20 + 434 * scale }], scale, 'maximum');
const jointForbidden = [...jointParts.map(n => n.box), jointName];
const jointWitnesses = v13.arcWitnesses(jointGeometry, jointForbidden); assert.ok(jointWitnesses.length > 0);
for (const witness of jointWitnesses) {
  assert.ok(witness.curves.length > 1); v13.checkSmooth(witness.curves, jointGeometry.source, jointGeometry.target, 0.3 * scale, scale);
  checkFacingPorts({ ...jointGeometry, curves: witness.curves }, globalThis.authorExpect);
  for (const side of ['top', 'bottom', 'outside']) for (const atSource of [true, false]) {
    const wrong = structuredClone(witness.curves), b = atSource ? jointGeometry.source : jointGeometry.target;
    const p = side === 'outside' ? point(atSource ? b.left : b.right, v13.centre(b).y)
      : point(v13.centre(b).x, side === 'top' ? b.top : b.bottom);
    const h = side === 'outside' ? point(p.x + (atSource ? -24 : 24) * scale, p.y)
      : point(p.x, p.y + (side === 'top' ? -24 : 24) * scale);
    if (atSource) { wrong[0][0] = p; wrong[0][1] = h; }
    else { wrong.at(-1)[3] = p; wrong.at(-1)[2] = h; }
    v13.checkSmooth(wrong, jointGeometry.source, jointGeometry.target, 0.3 * scale, scale);
    assert.throws(() => checkFacingPorts({ ...jointGeometry, curves: wrong }, globalThis.authorExpect));
  }
  v13.checkClear({ ...jointGeometry, routes: [witness.points] }, jointForbidden);
  assert.ok(v13.cubicLengthUpperBound(witness.curves) <= v13.arcCap(jointGeometry));
}
}
// H82: execute its actual name-obstructed fallback construction with legal 24 px handles.
// Subdivided control polygons bound this curve, rather than an inadmissible taut string.
const h82 = (await readFile(new URL('H82_unavoidable_overlap_report.spec.ts', here), 'utf8')).replace(/\r\n/g, '\n');
const namedSource = h82.slice(h82.indexOf('const namedFallbackWitness = ') + 'const namedFallbackWitness = '.length, h82.indexOf('\n\n// LAY-8')).trim().replace(/;$/, '');
const namedFallbackWitness = new Function('centre', `return ${stripTypeScriptTypes(namedSource)}`)(v13.centre);
for (const scale of [0.5, 1, 1.7]) {
  const map = p => point(p.x * scale + 42, p.y * scale + 20);
  const box = b => ({ left: b.left * scale + 42, right: b.right * scale + 42, top: b.top * scale + 20, bottom: b.bottom * scale + 20 });
  const header = box({ left: 282, right: 550, top: 182, bottom: 320 });
  const painted = box({ left: 300, right: 450, top: 194, bottom: 212 });
  const minimum = v13.groupNameBox(header, [painted], scale);
  const name = v13.groupNameBox(header, [painted], scale, 'maximum');
  assert.deepEqual(minimum, box({ left: 282, right: 452, top: 182, bottom: 228 }));
  assert.deepEqual(name, box({ left: 282, right: 455, top: 182, bottom: 228 }));
  const a = map(point(256, 204)), b = map(point(600, 204));
  const g = { source: box({ left: 60, right: 256, top: 150, bottom: 258 }), target: box({ left: 600, right: 796, top: 150, bottom: 258 }), routes: [[a, b]], nodes: [], scale };
  assert.ok(v8.entersBox(a, b, name, 0));
  // Passing above the glyphs alone still crosses the contracted 46 px header box.
  const glyphOnly = [map(point(256, 190)), map(point(600, 190))];
  assert.equal(v8.entersBox(...glyphOnly, painted, 0), false);
  assert.equal(v8.entersBox(...glyphOnly, name, 0), true);
  for (const cs of namedFallbackWitness(g, name)) {
    v13.checkSmooth(cs, g.source, g.target, 0.3 * scale, scale);
    assert.ok(v13.arcClear({ ...g, routes: [v13.sampleCubics(cs)] }, [name]));
    const upper = v13.cubicLengthUpperBound(cs), lower = v13.lineLength(v13.sampleCubics(cs));
    const y = cs[0][3].y < name.top ? name.top : name.bottom;
    const geodesic = v13.distance(a, point(name.left, y)) + name.right - name.left + v13.distance(point(name.right, y), b);
    assert.ok(upper >= geodesic);
    assert.ok(upper >= lower && upper - lower < 0.02 * scale);
    assert.ok(v13.shortestHandle(cs) >= 24 * scale - scale * 1e-7);
    // A long fallback still fails; the 0.5 % allowance is applied to a legal curve.
    assert.ok(1.006 * upper > 1.005 * upper + 0.3 * scale);
  }
  const sub = box({ left: 300, right: 470, top: 212, bottom: 224 });
  const marker = box({ left: 480, right: 490, top: 194, bottom: 212 });
  assert.equal(v13.groupNameBox(header, [painted, sub, marker], scale).right, box({ left: 0, right: 492, top: 0, bottom: 0 }).right);
  assert.ok(Math.abs(v13.groupNameBox(header, [painted, sub, marker], scale, 'maximum').right - (42 + 495.4 * scale)) < 1e-9);
}
assert.throws(() => v13.groupNameBox(source, [], 1));
// H83: layout uncertainty cannot reject a legal placement or invent a closer legal one.
for (const scale of [0.5, 1, 1.6]) {
  const box = b => ({ left: 42 + b.left * scale, right: 42 + b.right * scale,
    top: 20 + b.top * scale, bottom: 20 + b.bottom * scale });
  const name = box({ left: 0, right: 100, top: 0, bottom: 46 });
  const maximum = box({ left: 0, right: 120, top: 0, bottom: 46 });
  const g = { nodes: [], scale, routes: [[point(42, 20 + 25 * scale), point(42 + 218 * scale, 20 + 25 * scale)]] };
  const near = box({ left: 104, right: 114, top: 20, bottom: 30 });
  const far = box({ left: 124, right: 134, top: 20, bottom: 30 });
  v13.checkNearestMiddle(g, near, [name], 'label', [maximum]);
  v13.checkNearestMiddle(g, far, [name], 'label', [maximum]);
  assert.throws(() => v13.checkNearestMiddle(g, far, [name]));
  assert.throws(() => v13.checkNearestMiddle(g, near, [maximum]));
  assert.throws(() => v13.checkNearestMiddle(g, box({ left: 99, right: 109, top: 20, bottom: 30 }), [name], 'label', [maximum]));
  const badge = box({ left: 123, right: 129, top: 22, bottom: 28 });
  v13.checkNearestMiddle(g, badge, [name], 'badge', [maximum]);
  assert.throws(() => v13.checkNearestMiddle(g, badge, [name], 'badge'));
}
// v17: a short handle on any cubic cannot be a witness, even when angles are smooth.
for (const scale of [0.5, 1, 1.7]) {
  const map = p => point(p.x * scale + 42, p.y * scale + 20);
  const box = b => ({ left: b.left * scale + 42, right: b.right * scale + 42, top: b.top * scale + 20, bottom: b.bottom * scale + 20 });
  const curves = namedFallbackWitness({ source: box({ left: 60, right: 256, top: 150, bottom: 258 }),
    target: box({ left: 600, right: 796, top: 150, bottom: 258 }), scale }, box({ left: 282, right: 452, top: 182, bottom: 228 }))[0];
  const source = box({ left: 60, right: 256, top: 150, bottom: 258 }), target = box({ left: 600, right: 796, top: 150, bottom: 258 });
  v13.checkSmooth(curves, source, target, scale * 0.3, scale);
  for (let i = 0; i < curves.length; i++) for (const [end, handle] of [[0, 1], [3, 2]]) {
    const bad = structuredClone(curves), c = bad[i], ratio = 23.99 * scale / v13.distance(c[end], c[handle]);
    c[handle] = point(c[end].x + ratio * (c[handle].x - c[end].x), c[end].y + ratio * (c[handle].y - c[end].y));
    assert.throws(() => v13.checkSmooth(bad, source, target, scale * 0.3, scale));
  }
}
assert.equal(v13.arcWitnesses({ ...short, nodes: [] }, []).length, 0);
await v13.smoothConnection(smoothSurface([new SVGPathElement('M196 50 C220 50 376 50 400 50')]), 'handles', 'start', 'end');
await assert.rejects(v13.smoothConnection(smoothSurface([new SVGPathElement('M196 50 C219.99 50 376 50 400 50')]), 'handles', 'start', 'end'));
// Execute both H81 cases: mandatory small-case success; larger-case success or failed-widening rollback.
const outcomeSource = h81.slice(h81.indexOf('  const separation = '), h81.indexOf('  // Retry count'));
const roomOutcome = new Function('expect', 'readDrawing', 'pair', 'checkClear', 'checkCap', 'nameGapDeficit',
  `return ${stripTypeScriptTypes(`async (feasible, roomReport, room, parts, ordinaryBox, baseScale, ordinaryStored, automaticRoom, arcRoom, forbidden, names) => {${outcomeSource.replace(/\n  }\s*$/, '')}}`)}`);
const ordinaryRoomFile = { views: [{ nodes: rollbackNodes.map(n => ({ id: n.id, x: n.box.left, y: n.box.top })) }] };
const runOutcome = (feasible, report, current, stored = ordinaryRoomFile) => {
  const baseline = feasible ? baseRoom : rollbackRoom, names = feasible ? widenedNames : rollbackNames;
  const curves = current === escapedRoom ? escapedCurves : feasible ? boundedRoomWitness(current, names) : roomWitness(current, names);
  const arcRoom = { ...current, curves, routes: [v13.sampleCubics(curves)] };
  return roomOutcome(globalThis.authorExpect, async () => stored, { from: 'start-1' }, v13.checkClear, v13.checkCap, nameGapDeficit)
    (feasible, report, arcRoom, current.nodes, id => baseline.nodes.find(n => n.id === id).box, 1, ordinaryRoomFile,
      { file: 'synthetic-only' }, arcRoom, [...current.nodes.map(n => n.box), ...names], names);
};
await runOutcome(false, { overParts: 1 }, rollbackRoom);
await runOutcome(true, { overParts: 0 }, widenedRoom);
await assert.rejects(runOutcome(true, { overParts: 0 }, baseRoom));
await assert.rejects(runOutcome(true, { overParts: 1 }, baseRoom));
await assert.rejects(runOutcome(true, { overParts: 1 }, widenedRoom));
await assert.rejects(runOutcome(false, { overParts: 0 }, rollbackRoom));
await runOutcome(false, { overParts: 0 }, escapedRoom);
const grownRollback = { ...rollbackRoom, target: { ...rollbackRoom.target, top: 268, bottom: 314 },
  nodes: rollbackNodes.map(n => ({ ...n, box: n.id.startsWith('end-') ? { ...n.box, top: n.box.top + 40, bottom: n.box.bottom + 40 } : n.box })) };
await assert.rejects(runOutcome(false, { overParts: 1 }, grownRollback));
const movedRoomFile = structuredClone(ordinaryRoomFile); movedRoomFile.views[0].nodes[6].y += 10;
await assert.rejects(runOutcome(false, { overParts: 1 }, rollbackRoom, movedRoomFile));
// Execute H81's actual output entry rule without fixing the output's gap:
// side/corner entries pass; a top entry needs the full 10 px name separation.
const entrySource = h81.slice(h81.indexOf('    const last = room.curves.at(-1)!;'), h81.indexOf('    expect(parts.some'));
const checkRoomEntry = new Function('room', 'names', 'expect', stripTypeScriptTypes(entrySource));
checkRoomEntry(entryAt(point(538, 264), point(562, 264)), widenedNames, globalThis.authorExpect);
checkRoomEntry(entryAt(point(588, 264), point(588, 240)), widenedNames, globalThis.authorExpect);
assert.throws(() => checkRoomEntry(entryAt(point(538, 264), point(538, 240)), widenedNames, globalThis.authorExpect));
assert.throws(() => checkRoomEntry(entryAt(point(587, 264), point(587, 240)), widenedNames, globalThis.authorExpect));
// Execute the actual side filter: a close same-row neighbour cannot disqualify
// the facing bottom side, while a blocked alternate left side still fails.
const roomSideSource = h81.slice(h81.indexOf('  const roomSideFree = ') + '  const roomSideFree = '.length,
  h81.indexOf('\n  const legalThree')).trim().replace(/;$/, '');
const roomSidesFree = new Function('room', 'parts', 'pair', 'centre', 'segmentBoxDistance', `return ${stripTypeScriptTypes(roomSideSource)}`);
const sideRoom = { source: { left: 0, right: 140, top: 0, bottom: 46 },
  target: { left: 0, right: 140, top: 300, bottom: 346 }, scale: 1 };
const sideParts = [{ id: 'start', box: sideRoom.source }, { id: 'end', box: sideRoom.target },
  { id: 'neighbour', box: { left: 164, right: 304, top: 0, bottom: 46 } }];
const checkSides = parts => roomSidesFree(sideRoom, parts, { from: 'start', to: 'end' }, v13.centre, v13.segmentBoxDistance);
assert.equal(checkSides(sideParts), true);
assert.equal(checkSides([...sideParts, { id: 'blocked-left', box: { left: -164, right: -24, top: 300, bottom: 346 } }]), false);
// H81: run its actual document-form partition, even when a group id has no zone suffix.
const partitionSource = h81.match(/const parts = (room\.nodes\.filter\([^\n]+);/)[1];
const partitionParts = new Function('room', 'connected', `return ${stripTypeScriptTypes(partitionSource)}`);
const body = { left: -20, right: 120, top: 47.9, bottom: 150 };
const bodyGeometry = { ...clearanceGeometry, nodes: [...clearanceGeometry.nodes,
  { id: 'container', box: body }], routes: [[point(0, 100), point(100, 100)]],
  source: { left: -10, right: 0, top: 95, bottom: 105 }, target: { left: 100, right: 110, top: 95, bottom: 105 } };
bodyGeometry.nodes[0] = { id: 'blocker', box: { left: 30, right: 70, top: 122.5, bottom: 135 } };
const partNodes = partitionParts(bodyGeometry, { views: [{ nodes: [{ id: 'blocker', form: 'compact' }, { id: 'container', form: 'group' }] }] });
assert.deepEqual(partNodes.map(n => n.id), ['blocker']);
const fullName = v13.groupNameBox(body, [{ left: 0, right: 40, top: 60, bottom: 80 }], 1);
const partOnly = { ...bodyGeometry, nodes: partNodes };
v13.checkClear(partOnly, [...partNodes.map(n => n.box), fullName]);
assert.equal(v13.arcClear(partOnly, [...partNodes.map(n => n.box), { ...fullName, bottom: 101 }]), false);
assert.equal(v13.arcClear({ ...partOnly, nodes: [{ id: 'blocker', box: { ...partNodes[0].box, top: 107.5 } }] },
  [{ ...partNodes[0].box, top: 107.5 }, fullName]), false);
// H83: execute the delivered setup and calibration with unequal handles/non-centred ports.
const h83 = (await readFile(new URL('H83_arc_label_and_badge_middle.spec.ts', here), 'utf8')).replace(/\r\n/g, '\n');
const competingSetup = h83.slice(h83.indexOf('    const doc = drawing(`Competing middle'), h83.indexOf('    let fixture!'));
const competingDrawing = new Function('drawing', 'component', 'kind', `${stripTypeScriptTypes(competingSetup)} return doc;`);
const calibrationSource = h83.slice(h83.indexOf('function calibrateMiddle('), h83.indexOf('\n// LAY-8'));
const calibrateMiddle = new Function('arcMiddle', 'distance', `${stripTypeScriptTypes(calibrationSource)} return calibrateMiddle;`)(v13.arcMiddle, v13.distance);
for (const kind of ['earlier-label', 'free-text']) {
  for (const scale of [0.5, 1, 1.7]) {
  const doc = competingDrawing(globalThis.authorHelpers.drawing, globalThis.authorHelpers.component, kind), view = doc.views[0];
  assert.equal(new Set(view.nodes.map(n => n.id)).size, view.nodes.length);
  const pairs = new Set();
  for (const edge of view.edges) {
    assert.notEqual(edge.from, edge.to);
    assert.ok(view.nodes.some(n => n.id === edge.from) && view.nodes.some(n => n.id === edge.to));
    assert.ok(!pairs.has(`${edge.from}/${edge.to}`) && !pairs.has(`${edge.to}/${edge.from}`));
    pairs.add(`${edge.from}/${edge.to}`);
  }
  assert.equal(view.edges.length, kind === 'earlier-label' ? 2 : 1);
  const map = p => point(p.x * scale + 42, p.y * scale + 20);
  const direct = v13.sampleCubics([[point(140, 2), point(204, 2), point(536, 2), point(600, 2)]].map(c => c.map(map)));
  const g = { routes: [direct], scale };
  const before = structuredClone(view);
  if (kind === 'earlier-label') {
    const earlyMiddle = () => {
      const edge = view.edges[0];
      const a = asBox(view.nodes.find(n => n.id === edge.from)), b = asBox(view.nodes.find(n => n.id === edge.to));
      const start = point(a.right, v13.centre(a).y), end = point(b.left, v13.centre(b).y);
      return v13.arcMiddle(v13.sampleCubics([[start, point(start.x + 400, start.y), point(end.x - 24, end.y), end]].map(c => c.map(map))));
    };
    assert.ok(v13.distance(earlyMiddle(), v13.arcMiddle(direct)) > 4 * scale);
    assert.equal(calibrateMiddle(doc, g, earlyMiddle()), false);
    assert.equal(calibrateMiddle(doc, g, earlyMiddle()), true);
    assert.ok(v13.distance(earlyMiddle(), v13.arcMiddle(direct)) <= 0.25 * scale);
    assert.deepEqual(view.nodes.slice(0, 2), before.nodes.slice(0, 2));
    assert.equal(view.nodes[3].x - view.nodes[2].x, before.nodes[3].x - before.nodes[2].x);
    assert.equal(view.nodes[3].y - view.nodes[2].y, before.nodes[3].y - before.nodes[2].y);
  } else {
    assert.equal(view.texts[0].id, 'middle-text');
    // The legal y=2 port is above the old fixed text's y=8 top.
    const textCentre = () => map(point(view.texts[0].x + 60, view.texts[0].y + 15));
    assert.ok(v13.arcMiddle(direct).y < map(point(0, view.texts[0].y)).y);
    assert.equal(calibrateMiddle(doc, g, textCentre()), false);
    assert.equal(calibrateMiddle(doc, g, textCentre()), true);
    assert.deepEqual(view.nodes, before.nodes);
    assert.ok(v13.distance(textCentre(), v13.arcMiddle(direct)) <= 0.25 * scale);
  }
  assert.deepEqual(view.edges, before.edges);
  const frozen = structuredClone(doc);
  assert.equal(calibrateMiddle(doc, g, v13.arcMiddle(direct)), true);
  assert.deepEqual(doc, frozen);
  }
}
// H83: execute its actual text-box reader with fractional widths, rising glyphs and oversized grab paint.
const textBoxSource = h83.slice(h83.indexOf('async function freeTextBox('), h83.indexOf('// Calibrate authored positions'));
const freeTextBox = new Function(`${stripTypeScriptTypes(textBoxSource)} return freeTextBox;`)();
for (const scale of [0.5, 1, 1.7]) for (const encoding of [0.8, 1, 1.4]) for (const drawnWidth of [144.2, 145]) {
  const doc = competingDrawing(globalThis.authorHelpers.drawing, globalThis.authorHelpers.component, 'free-text');
  Object.assign(doc.views[0].texts[0], { x: 300.85, y: 10.46 });
  const text = { textContent: 'Middle work', ownerDocument: { fonts: { ready: Promise.resolve() } }, getScreenCTM: () => new Matrix(scale * encoding, 0, 0, scale * encoding, 42, 20),
    getComputedTextLength: () => drawnWidth / encoding,
    getBBox: () => { throw new Error('Glyph bounds must not define the contracted text box'); } };
  const grab = { getBBox: () => ({ x: 296.85, y: 0.46, width: 153, height: 44 }) };
  const surface = { evaluate: async (fn, input) => fn({ tagName: 'svg', getScreenCTM: () => new Matrix(),
    querySelectorAll: selector => selector === 'text' ? [text] : [grab, text] }, input) };
  const g = { source: { left: 42, top: 20 }, scale };
  const measured = await freeTextBox(surface, doc, g);
  const expected = { left: 42 + 300.85 * scale, right: 42 + (300.85 + 145) * scale,
    top: 20 + 10.46 * scale, bottom: 20 + (10.46 + 30) * scale };
  for (const key of Object.keys(expected)) assert.ok(Math.abs(measured[key] - expected[key]) < 1e-9);
}
// The reported legal clearances stay legal; the grab area and rising glyphs are no blockers.
const contractedText = { left: 300.85, right: 445.85, top: 10.46, bottom: 40.46 };
const middleLabel = { left: 340, right: 400, top: -10, bottom: 6 };
const middleBadge = { left: 350, right: 371, top: -24.08, bottom: -3.08 };
assert.ok(v13.boxGap(middleLabel, contractedText) >= 4);
const badgeCentre = v13.centre(middleBadge);
assert.ok(v13.boxGap({ left: badgeCentre.x, right: badgeCentre.x, top: badgeCentre.y, bottom: badgeCentre.y }, contractedText) >= 13.5);
assert.ok(v13.boxGap(middleLabel, { ...contractedText, left: contractedText.left - 4, right: contractedText.right + 4,
  top: contractedText.top - 10, bottom: contractedText.bottom + 4 }) < 4);
// H77: helper-only regression budget; this does not measure any complete scenario.
// Keep the 6000 px case and 0.1 px samples; exercise the actual collector.
const longStarted = performance.now();
const longTarget = { left: 6000, right: 6196, top: 180, bottom: 280 };
const longCurve = 'M196 50 C900 50 1800 -160 3000 -160 C4200 -160 5900 230 6000 230';
const longGeometry = await v13.smoothConnection(smoothSurface([new SVGPathElement(longCurve)], smoothSource, longTarget), 'long', 'start', 'end');
assert.ok(longGeometry.sampled > 58000); assert.equal(longGeometry.curves.length, 2);
const denseOther = await v13.smoothConnection(smoothSurface([new SVGPathElement('M196 230 C900 230 1800 230 3000 230 C4200 230 5900 50 6000 50')],
  { ...smoothSource, top: 180, bottom: 280 }, { ...longTarget, top: 0, bottom: 100 }), 'other', 'start', 'end');
assert.ok(v9.crossingWitness(longGeometry.routes[0], denseOther.routes[0], 16));
v13.checkClear(longGeometry, longGeometry.nodes.map(n => n.box)); v13.checkCap(longGeometry);
const longElapsed = performance.now() - longStarted;
assert.ok(longElapsed < 10000, `6000 px helper computation took ${Math.round(longElapsed)} ms`);
console.log(`LONG_ROUTE_HELPER helperOnly=true browserHeadroom=unverified elapsedMs=${Math.round(longElapsed)} samples=${longGeometry.sampled + denseOther.sampled}`);
console.log(`PASS: ${files.filter(f => f.isFile() && f.name.endsWith('.ts')).length} TypeScript files parsed; H15–H${last} minus the 6 retired ids (63 scenarios)/settings/imports and H15–H78 historical titles checked; valid-glow/short-foreground and four-piece-foreground counterexamples rejected in either paint order/direction; legal three-piece foreground accepted; H80 feasible d+120 branch and separate impossible short-cap fallback, H79 ordinary/post guarded-joint certificates, bounded 120 px column-room certificate, costlier avoidance in both paint orders, mandatory room success, permitted 600 px success and conditional rollback, facing/alternate side availability, 24 px handle boundaries, legal fallback length bounds, contracted text boxes and actual H83 calibration checked; scaled certificates at 0.5/1/1.6; retained geometry checks plus v15 8/4/r+3 clearance boundaries, label distance limit, legal border witnesses and dense 6000 px collector budget checked; guarded joint and name-obstructed fallback witnesses, non-path foreground rejection, off-line decoration acceptance, export badge paint, signed-zero parity and PNG/SVG raster counterexamples checked. No product/browser or resolved type-check run.`);
