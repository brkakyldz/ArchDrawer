import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { box, fact, part, joinView, baseURL, type Channel, type Doc3, type Fact, type Lane, type Part, type Link, type LimitFact, type View, type View3 } from './helpers';
import { inDrawingFonts, type Box, type Point } from './helpers-svg-parity';

// ---------------------------------------------------------------------------------------------------------------
// Drawing round (ADR 0013 calm connections and a steady drag, ADR 0014 an outline per kind and no rows on the canvas).
// Nothing in helpers.ts or helpers-svg-parity.ts changed. These helpers only read the surfaces the contracts name:
// the stored file, the editor's test ids and data attributes, and the exported image's markup.
//
// Reading a stored file: after the server has opened a drawing it is `archdraw/diagram@4` (`choices`), whatever was written.
// `readChoice` / `persistedChoice` return one choice in the shape of an `@3` file (`facts`, `channels`, the document's own keys),
// so a scenario reads `doc.facts` and `doc.channels` whichever format is on disk. A drawing is authored as `@3` (`sketch`,
// `shop3`, ...): the server converts it into one choice, `system` (drawing contract, *Reading archdraw/diagram@3*).
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// 1. The stored file, whichever format it has
// ---------------------------------------------------------------------------------------------------------------
// One choice of a parsed document, in the `@3` shape. An `@3` document is returned as it is.
export function choiceDoc(raw: any, choiceId?: string): Doc3 {
  if (!raw || !Array.isArray(raw.choices)) return raw as Doc3;
  const { choices, ...rest } = raw;
  const choice = (choiceId ? choices.find((c: any) => c.id === choiceId) : choices[0]) ?? choices[0];
  return { ...rest, facts: choice.facts, channels: choice.channels } as Doc3;
}
export async function readChoice(file: string, choiceId?: string): Promise<Doc3> {
  return choiceDoc(JSON.parse(await readFile(file, 'utf8')), choiceId);
}
export async function persistedChoice(file: string, predicate: (doc: Doc3) => boolean, timeout = 10_000, choiceId?: string) {
  await expect.poll(async () => { try { return predicate(await readChoice(file, choiceId)); } catch { return false; } }, { timeout }).toBe(true);
}
export const viewIn = (doc: Doc3, channel: Channel = 'overview', id?: string): View3 | undefined => {
  const views = doc.channels[channel]?.views ?? [];
  return id ? views.find(v => v.id === id) : views[0];
};
export async function readView(file: string, channel: Channel = 'overview', id?: string): Promise<View3> {
  const found = viewIn(await readChoice(file), channel, id); expect(found, `the ${channel} channel has the view ${id ?? '(first)'}`).toBeTruthy(); return found!;
}
// The view joined with its facts (the drawn shape of `helpers.ts`).
export async function readDrawn(file: string, channel: Channel = 'overview', id?: string): Promise<View> {
  const doc = await readChoice(file); const found = viewIn(doc, channel, id); expect(found).toBeTruthy(); return joinView(doc, found!);
}
// `[id, x, y]` of every part of a stored view, in file order.
export async function positionsOf(file: string, channel: Channel = 'overview', id?: string): Promise<[string, number | undefined, number | undefined][]> {
  return (await readView(file, channel, id)).nodes.map(n => [n.id, n.x, n.y]);
}
export async function nodeOf(file: string, partId: string, channel: Channel = 'overview', id?: string): Promise<Part> {
  const found = (await readView(file, channel, id)).nodes.find(n => n.id === partId); expect(found, `part ${partId} is stored`).toBeTruthy(); return found!;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Authoring: a sketch of parts at stored positions and connections that carry their own values
// ---------------------------------------------------------------------------------------------------------------
export interface SketchPart {
  id: string; label?: string; kind?: string; sub?: string; form?: string; x?: number; y?: number;
  place?: { row: number; col: number } | null; parent?: string | null; detail?: string | null; lane?: Lane; description?: string;
  // Rows of a panel: shown items (on the fact), held mechanisms (labels of facts `within` the part's fact) and limits (texts).
  items?: string[]; held?: string[]; limits?: string[];
}
export interface SketchEdge { id: string; from: string; to: string; label?: string; style?: string; both?: boolean; step?: number | null }
export interface SketchOptions { subLines?: boolean; showSteps?: boolean; theme?: string; viewId?: string; lede?: string; viewTitle?: string }
// An `@3` document: one fact per part (a group has none and keeps its own label), the connections with their own label, style and
// two-way flag and no relation, one overview view. A part with `x` and `y` is stored there; the others are laid out by code.
export function sketch(title: string, parts: SketchPart[], edges: SketchEdge[] = [], opts: SketchOptions = {}): Doc3 {
  const facts: Fact[] = [], limitFacts: LimitFact[] = [], nodes: Part[] = [];
  for (const p of parts) {
    const isGroup = p.form === 'group';
    if (isGroup) {
      nodes.push(part(p.id, { facts: [], form: 'group', label: p.label ?? p.id, kind: p.kind ?? 'service', description: p.description ?? 'A group of parts.',
        sub: p.sub ?? '', parent: p.parent ?? null, detail: p.detail ?? null, place: p.place ?? null, ...(p.lane !== undefined ? { lane: p.lane } : {}),
        ...(p.x !== undefined ? { x: p.x, y: p.y } : {}) }));
      continue;
    }
    facts.push(fact(p.id, { label: p.label ?? p.id, kind: p.kind ?? 'service', sub: p.sub ?? '', description: p.description ?? `Handles ${p.id}.`, items: p.items ?? [] }));
    const held: string[] = [], limits: string[] = [];
    (p.held ?? []).forEach((label, i) => { const id = `${p.id}-held-${i + 1}`; facts.push(fact(id, { label, kind: 'service', within: p.id })); held.push(id); });
    (p.limits ?? []).forEach((text, i) => { const id = `${p.id}-limit-${i + 1}`; limitFacts.push({ id, on: p.id, text }); limits.push(id); });
    nodes.push(part(p.id, { form: p.form ?? 'card', parent: p.parent ?? null, detail: p.detail ?? null, place: p.place ?? null,
      ...(p.lane !== undefined ? { lane: p.lane } : {}), ...(p.x !== undefined ? { x: p.x, y: p.y } : {}),
      ...(held.length ? { held } : {}), ...(limits.length ? { limits } : {}) }));
  }
  const links: Link[] = edges.map(e => ({ id: e.id, from: e.from, to: e.to, relations: [], step: e.step ?? null, label: e.label ?? '', style: e.style ?? 'call', both: e.both ?? false }));
  const view: View3 & { subLines?: boolean } = { id: opts.viewId ?? 'overview', title: opts.viewTitle ?? 'Overview', caption: { title: `How ${title} works`, lede: opts.lede ?? '' },
    nodes, edges: links, texts: [], ...(opts.subLines === false ? { subLines: false } : {}) };
  return { schema: 'archdraw/diagram@3', title, ...(opts.theme ? { theme: opts.theme } : {}),
    facts: { components: facts, relations: [], ...(limitFacts.length ? { limits: limitFacts } : {}) },
    channels: { overview: { showSteps: opts.showSteps ?? false, outdated: [], views: [view] } } };
}
// Adds a LinkedIn channel whose one view is the given parts and connections (post style), over the sketch's facts.
export function withPost(doc: Doc3, parts: Part[], edges: Link[], opts: { id?: string } = {}): Doc3 {
  doc.channels.linkedin = { showSteps: false, outdated: [], views: [{ id: opts.id ?? 'linkedin-post', title: 'LinkedIn', caption: { title: 'A post', lede: 'The same parts as the map.' }, nodes: parts, edges, texts: [] }] };
  return doc;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Shapes (diagram contract, Geometry, Shapes and Content box)
// ---------------------------------------------------------------------------------------------------------------
export const ALL_KINDS = ['actor', 'client', 'api', 'service', 'worker', 'llm', 'external', 'ops', 'gate', 'data'] as const;
export const SHAPE_BY_KIND: Record<string, string> = { actor: 'person', client: 'window', api: 'port', service: 'card', worker: 'stack', llm: 'agent',
  external: 'external', ops: 'pulse', gate: 'check', data: 'store' };
export const SHAPES = ['person', 'window', 'port', 'card', 'stack', 'agent', 'external', 'pulse', 'check', 'store'] as const;
// The `data-shape` of a part: its kind's, for a card, a compact and a panel alike; a group is `group`.
export function shapeForKind(kind: string, form: string): string { return form === 'group' ? 'group' : (SHAPE_BY_KIND[kind] ?? 'card'); }
type Insets = [top: number, right: number, bottom: number, left: number];
// Card insets (top / right / bottom / left), plain and post style, and the card's extra width (plain, post).
const CARD: Record<string, { plain: Insets; post: Insets; extra: [number, number] }> = {
  card: { plain: [19, 12, 19, 12], post: [6, 12, 6, 12], extra: [0, 0] },
  person: { plain: [48, 12, 24, 12], post: [42, 12, 6, 12], extra: [0, 0] },
  window: { plain: [19, 12, 19, 12], post: [14, 12, 6, 12], extra: [0, 0] },
  port: { plain: [19, 26, 19, 26], post: [6, 24, 6, 24], extra: [28, 24] },
  stack: { plain: [27, 20, 19, 12], post: [14, 20, 6, 12], extra: [8, 8] },
  agent: { plain: [19, 12, 19, 12], post: [6, 12, 6, 12], extra: [0, 0] },
  external: { plain: [29, 12, 19, 12], post: [14, 12, 6, 12], extra: [0, 0] },
  pulse: { plain: [19, 12, 19, 12], post: [6, 12, 16, 12], extra: [0, 0] },
  check: { plain: [19, 12, 37, 12], post: [6, 12, 20, 12], extra: [0, 0] },
  store: { plain: [27, 15, 27, 15], post: [12, 15, 12, 15], extra: [0, 0] },
};
// Compact: height, extra width.
const COMPACT: Record<string, { height: number; extra: number }> = {
  card: { height: 46, extra: 0 }, person: { height: 46, extra: 0 }, window: { height: 46, extra: 0 }, port: { height: 46, extra: 20 }, stack: { height: 52, extra: 6 },
  agent: { height: 46, extra: 0 }, external: { height: 52, extra: 0 }, pulse: { height: 46, extra: 0 }, check: { height: 54, extra: 0 }, store: { height: 54, extra: 0 },
};
// The size of a card (or a panel) of a shape with a label of `labelLines` lines, in drawing px: top inset + icon and gap (not for `person`)
// + 18 per label line (post 20) + the sub-line row (18, when sub-lines are on) + bottom inset. The width is the plain card's (196, post 176) plus the
// shape's extra width; a short sub-line never widens it (the post card widens up to 204 only for a long one).
export function cardSize(shape: string, opts: { post?: boolean; subLine?: boolean; labelLines?: number } = {}): { width: number; height: number } {
  const row = CARD[shape]; const insets = opts.post ? row.post : row.plain;
  const height = insets[0] + insets[2] + (shape === 'person' ? 0 : 34) + (opts.post ? 20 : 18) * (opts.labelLines ?? 1) + (opts.subLine === false ? 0 : 18);
  return { width: (opts.post ? 176 : 196) + row.extra[opts.post ? 1 : 0], height };
}
// A compact part: its height, and the extra width that is added to its (140–320) row width.
export const compactHeight = (shape: string) => COMPACT[shape].height;
export const compactExtraWidth = (shape: string) => COMPACT[shape].extra;
// With a label and no sub-line short enough for the 140 px minimum, a compact part is 140 plus its shape's extra width wide.
export const compactShortWidth = (shape: string) => 140 + COMPACT[shape].extra;

// ---------------------------------------------------------------------------------------------------------------
// 4. The editor: zoom, boxes and sizes in drawing px
// ---------------------------------------------------------------------------------------------------------------
export async function zoomFactor(page: Page): Promise<number> {
  return Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')) / 100;
}
// Zooms in until the canvas draws everything (`data-detail` is `full`).
export async function fullDetail(page: Page) {
  for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
    const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
  }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
}
// The first `rect` of a part (its box, the parity surface of the contracts) on screen.
export async function nodeRect(page: Page, id: string) { return await box(page.getByTestId(`node-${id}`).locator('rect').first()); }
// A part's box in drawing px (screen size ÷ zoom), the zoom read from `zoom-level` (a whole percent, so within 0.5 %).
export async function nodeSize(page: Page, id: string) {
  const b = await nodeRect(page, id), zoom = await zoomFactor(page); return { width: b.width / zoom, height: b.height / zoom };
}
export const within = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
// A size in drawing px against a contracted one: the zoom is a whole percent, so allow 0.6 % of the size and 1 px.
export function sizeIs(actual: { width: number; height: number }, expected: { width: number; height: number }, what: string) {
  expect(Math.abs(actual.width - expected.width), `${what}: width ${actual.width} vs ${expected.width}`).toBeLessThanOrEqual(expected.width * 0.006 + 1);
  expect(Math.abs(actual.height - expected.height), `${what}: height ${actual.height} vs ${expected.height}`).toBeLessThanOrEqual(expected.height * 0.006 + 1);
}
// Screen boxes of every part (`node-<id>` with a `data-kind`), by id.
export async function nodeSnaps(page: Page): Promise<Record<string, Box>> {
  return await page.getByTestId('canvas').evaluate(root => {
    const out: Record<string, { left: number; right: number; top: number; bottom: number }> = {};
    for (const el of Array.from(root.querySelectorAll('[data-testid^="node-"][data-kind]'))) {
      const r = el.getBoundingClientRect(); out[(el.getAttribute('data-testid') ?? '').slice(5)] = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    return out;
  });
}
export const sameBox = (a: Box | null | undefined, b: Box | null | undefined, tolerance = 0.6) =>
  !!a && !!b && (['left', 'right', 'top', 'bottom'] as const).every(k => Math.abs(a[k] - b[k]) <= tolerance);

// ---------------------------------------------------------------------------------------------------------------
// 5. Dragging (ui contract, Dragging)
// ---------------------------------------------------------------------------------------------------------------
export interface Held {
  // The pointer, in screen px, and how far it has moved since it went down.
  x: number; y: number; dx: number; dy: number;
  by(dx: number, dy: number, steps?: number): Promise<void>;
  to(x: number, y: number, steps?: number): Promise<void>;
  release(): Promise<void>;
}
// Presses the pointer on a part (at its horizontal middle, near the top, clear of the label's double-click target... as `drag` does)
// and returns a handle: the pointer stays down until `release`. With `alt` the Alt key is down from the start (no guide, no snap).
export async function pickUp(page: Page, partId: string, opts: { alt?: boolean; at?: { x: number; y: number } } = {}): Promise<Held> {
  const b = await nodeRect(page, partId);
  const start = opts.at ?? { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 24) };
  await page.mouse.move(start.x, start.y);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  const held: Held = { x: start.x, y: start.y, dx: 0, dy: 0,
    async to(x, y, steps = 8) { await page.mouse.move(x, y, { steps }); held.dx += x - held.x; held.dy += y - held.y; held.x = x; held.y = y; },
    async by(dx, dy, steps = 8) { await held.to(held.x + dx, held.y + dy, steps); },
    async release() { await page.mouse.up(); if (opts.alt) await page.keyboard.up('Alt'); } };
  return held;
}
// The marks of a drag in the canvas (ui contract, Dragging).
export interface DragMarks {
  lifted: string[]; dimmedParts: string[]; dimmedEdges: string[]; litEdges: string[]; dropTargets: string[];
  guides: { axis: string | null; at: number }[]; gaps: { axis: string | null; size: number }[];
}
export async function dragMarks(page: Page): Promise<DragMarks> {
  return await page.getByTestId('canvas').evaluate(root => {
    const id = (el: Element, n: number) => (el.getAttribute('data-testid') ?? '').slice(n);
    const nodes = Array.from(root.querySelectorAll('[data-testid^="node-"][data-kind]')), edges = Array.from(root.querySelectorAll('[data-testid^="edge-"][data-style]'));
    return {
      lifted: nodes.filter(n => n.getAttribute('data-lifted') === 'true').map(n => id(n, 5)).sort(),
      dimmedParts: nodes.filter(n => n.getAttribute('data-drag-dim') === 'true').map(n => id(n, 5)).sort(),
      dimmedEdges: edges.filter(n => n.getAttribute('data-drag-dim') === 'true').map(n => id(n, 5)).sort(),
      litEdges: edges.filter(n => n.getAttribute('data-focus') === 'true').map(n => id(n, 5)).sort(),
      dropTargets: nodes.filter(n => n.getAttribute('data-drop-target') === 'true').map(n => id(n, 5)).sort(),
      guides: Array.from(root.querySelectorAll('[data-testid="drag-guide"]')).map(g => ({ axis: g.getAttribute('data-axis'), at: Number(g.getAttribute('data-at')) })),
      gaps: Array.from(root.querySelectorAll('[data-testid="drag-gap"]')).map(g => ({ axis: g.getAttribute('data-axis'), size: Number(g.getAttribute('data-size')) })),
    };
  });
}
// `drag-guide`, `drag-gap` and the lifted look are the editor's alone: they appear in no export, share preview or slide.
export const dragMarkTestIds = ['drag-guide', 'drag-gap'];
export const dragAttributes = ['data-lifted', 'data-drag-dim', 'data-drop-target'];
// What each connection, label and badge looks like on screen (the path of its longest painted line, the boxes of its label and badge).
export interface EdgeSnap { d: string | null; label: Box | null; badge: Box | null; tone: string | null; focus: boolean; hidden: boolean; dragDim: boolean; style: string | null }
export async function edgeSnaps(page: Page): Promise<Record<string, EdgeSnap>> {
  return await page.getByTestId('canvas').evaluate(root => {
    const out: Record<string, any> = {};
    const rect = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; };
    for (const el of Array.from(root.querySelectorAll('[data-testid^="edge-"][data-style]'))) {
      const id = (el.getAttribute('data-testid') ?? '').slice(5);
      const paths = (el.tagName.toLowerCase() === 'path' ? [el] : Array.from(el.querySelectorAll('path'))) as SVGPathElement[];
      const painted = paths.filter(p => { const s = getComputedStyle(p); return s.stroke !== 'none' && s.stroke !== 'transparent' && parseFloat(s.strokeWidth) > 0 && Number(s.strokeOpacity) > 0; });
      const line = (painted.length ? painted : paths).sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
      out[id] = { d: line?.getAttribute('d') ?? null, label: rect(root.querySelector(`[data-testid="edge-label-${id}"]`)), badge: rect(root.querySelector(`[data-testid="step-badge-${id}"]`)),
        tone: el.getAttribute('data-tone'), focus: el.getAttribute('data-focus') === 'true', hidden: el.getAttribute('data-hidden') === 'true',
        dragDim: el.getAttribute('data-drag-dim') === 'true', style: el.getAttribute('data-style') };
    }
    return out;
  });
}
// Waits until no connection, label or badge has moved for `ms` (the 120 ms glide of an end has finished).
export async function settleEdges(page: Page, ms = 400) {
  let last = JSON.stringify(await edgeSnaps(page)), since = Date.now();
  await expect.poll(async () => {
    const now = JSON.stringify(await edgeSnaps(page));
    if (now !== last) { last = now; since = Date.now(); return false; }
    return Date.now() - since >= ms;
  }, { timeout: 15_000, intervals: [100] }).toBe(true);
}
// Counts the saves (`PUT /api/diagrams/<id>`) the page makes from now on.
export function countPuts(page: Page) {
  const urls: string[] = [];
  page.on('request', r => { if (r.method() === 'PUT' && /\/api\/diagrams\//.test(r.url())) urls.push(r.url()); });
  return { get count() { return urls.length; }, reset() { urls.length = 0; } };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Paths and colours
// ---------------------------------------------------------------------------------------------------------------
// `M x y C x y x y x y` as its four points; null when the path is anything else.
export function cubicPoints(d: string | null | undefined): Point[] | null {
  if (!d) return null;
  const numbers = (d.replace(/(\d)[eE]([-+]?\d)/g, '$1$2').match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const letters = d.replace(/(\d)[eE]([-+]?\d)/g, '$1$2').match(/[A-Za-z]/g) ?? [];
  if (letters.join('') !== 'MC' || numbers.length !== 8) return null;
  return [0, 2, 4, 6].map(i => ({ x: numbers[i], y: numbers[i + 1] }));
}
// A cubic whose four points lie on one line (a straight connection), within `tolerance` px.
export function isStraight(d: string | null | undefined, tolerance = 0.05): boolean {
  const p = cubicPoints(d); if (!p) return false;
  const [a, , , e] = p, length = Math.hypot(e.x - a.x, e.y - a.y) || 1;
  return p.every(q => Math.abs((e.x - a.x) * (a.y - q.y) - (a.x - q.x) * (e.y - a.y)) / length <= tolerance);
}
// The theme's neutral colour for connections (diagram contract, Colour).
export const EDGE_NEUTRAL: Record<string, string> = { light: 'rgb(132, 139, 152)', dark: 'rgb(99, 106, 119)' };
// Any CSS colour as the browser writes it (`rgb(r, g, b)` or `rgba(...)`).
export async function cssColour(page: Page, value: string): Promise<string> {
  return await page.evaluate(v => { const el = document.createElement('span'); el.style.color = v; document.body.append(el); const out = getComputedStyle(el).color; el.remove(); return out; }, value);
}
// The paint of a connection's line: the computed style of its longest stroked, visible path. Works on the canvas (`edge-<id>`) and in an exported image
// (`g[data-edge-id]`, with the surface from `inDrawingFonts`).
export interface LineStyle { d: string; stroke: string; strokeWidth: string; dash: string; linecap: string; opacity: number; circles: number; tone: string | null; focus: boolean; paths: number }
export async function lineStyle(surface: Locator, edgeId: string): Promise<LineStyle> {
  return await surface.evaluate((element, id) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const edge = root.querySelector(`g[data-edge-id="${id}"], [data-testid="edge-${id}"]`)!;
    const visible = (el: Element) => { for (let p: Element | null = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; } return true; };
    const all = [edge, ...Array.from(edge.querySelectorAll('*'))];
    const paths = all.filter((el): el is SVGPathElement => el instanceof SVGPathElement && !el.closest('defs, marker, clipPath, mask, [data-testid^="step-badge-"], [data-testid^="edge-label-"]') && visible(el)
      && getComputedStyle(el).stroke !== 'none' && getComputedStyle(el).stroke !== 'transparent' && parseFloat(getComputedStyle(el).strokeWidth) > 0 && el.getTotalLength() > 0).sort((a, b) => b.getTotalLength() - a.getTotalLength());
    const line = paths[0];
    if (!line) throw new Error(`No visible line for ${id}`);
    const s = getComputedStyle(line);
    // A circle that is not inside a step badge or a label is a start ring (removed by ADR 0013).
    const circles = all.filter(el => el instanceof SVGCircleElement && !el.closest('[data-testid^="step-badge-"], [data-testid^="edge-label-"], defs, marker')).length;
    return { d: line.getAttribute('d') ?? '', stroke: s.stroke, strokeWidth: s.strokeWidth, dash: s.strokeDasharray, linecap: s.strokeLinecap,
      opacity: Number(s.opacity) * Number(s.strokeOpacity), circles, tone: edge.getAttribute('data-tone'), focus: edge.getAttribute('data-focus') === 'true', paths: paths.length };
  }, edgeId);
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Routes of a surface, in drawing px, without the border test of `routeGeometry`
//    (a shaped part's end may lie on the outline inside its box, so `routeGeometry` could not follow it there)
// ---------------------------------------------------------------------------------------------------------------
export interface DrawnRoute { id: string; p: Point[]; d: string; tone: string | null; hidden: boolean }
export interface DrawnTrunk { part: string; side: string; edges: string[]; p: Point[]; tone: string | null }
export interface Drawn { scale: number; nodes: Record<string, Box>; edges: Record<string, DrawnRoute>; trunks: DrawnTrunk[] }
// Every part's box (its first `rect`), every connection's cubic and every trunk's cubic, normalised the way `compareRoutes(.., fitted)` does:
// origin the top-left of `anchor`'s box, unit the width of its rect in its own coordinates. Both the editor's canvas and an exported image
// (from `inDrawingFonts`) are read the same way, so two surfaces can be compared point by point.
export async function drawnRoutes(surface: Locator, anchor: string): Promise<Drawn> {
  return await surface.evaluate((element, anchorId) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const nodeSelector = 'g[data-node-id], [data-testid^="node-"][data-kind]';
    const idOf = (g: Element) => g.getAttribute('data-node-id') ?? (g.getAttribute('data-testid') ?? '').slice(5);
    const visible = (el: Element) => { for (let p: Element | null = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; } return true; };
    const rawBox = (el: SVGGraphicsElement) => {
      const b = el.getBBox(), m = inverse.multiply(el.getScreenCTM()!);
      const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { left: Math.min(...c.map(q => q.x)), right: Math.max(...c.map(q => q.x)), top: Math.min(...c.map(q => q.y)), bottom: Math.max(...c.map(q => q.y)) };
    };
    const rects: Record<string, { box: { left: number; right: number; top: number; bottom: number }; local: number }> = {};
    for (const g of Array.from(root.querySelectorAll(nodeSelector))) {
      const rect = Array.from(g.querySelectorAll('rect')).find(r => !r.closest('defs, clipPath, mask, marker') && r.closest(nodeSelector) === g);
      if (rect) rects[idOf(g)] = { box: rawBox(rect), local: rect.getBBox().width };
    }
    const a = rects[anchorId]; if (!a) throw new Error(`No part ${anchorId}`);
    const scale = (a.box.right - a.box.left) / a.local;
    const norm = (q: { x: number; y: number }) => ({ x: (q.x - a.box.left) / scale, y: (q.y - a.box.top) / scale });
    const cubic = (path: SVGPathElement) => {
      const d = path.getAttribute('d') ?? '', n = (d.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
      if (n.length !== 8) return null;
      const m = inverse.multiply(path.getScreenCTM()!);
      return [0, 2, 4, 6].map(i => norm(new DOMPoint(n[i], n[i + 1]).matrixTransform(m)));
    };
    const stroked = (p: SVGPathElement) => { const s = getComputedStyle(p); return s.stroke !== 'none' && s.stroke !== 'transparent' && parseFloat(s.strokeWidth) > 0 && p.getTotalLength() > 0; };
    const longest = (el: Element) => {
      const paths = (el.tagName.toLowerCase() === 'path' ? [el] : Array.from(el.querySelectorAll('path'))) as SVGPathElement[];
      const good = paths.filter(p => !p.closest('defs, marker, clipPath, mask, [data-testid^="step-badge-"], [data-testid^="edge-label-"]') && stroked(p) && (el.getAttribute('data-hidden') === 'true' || visible(p)));
      return (good.length ? good : paths).sort((x, y) => y.getTotalLength() - x.getTotalLength())[0] ?? null;
    };
    const edges: Record<string, { id: string; p: { x: number; y: number }[]; d: string; tone: string | null; hidden: boolean }> = {};
    for (const el of Array.from(root.querySelectorAll('g[data-edge-id], [data-testid^="edge-"][data-style]'))) {
      const id = el.getAttribute('data-edge-id') ?? (el.getAttribute('data-testid') ?? '').slice(5);
      const line = longest(el); const p = line ? cubic(line) : null; if (!p) continue;
      edges[id] = { id, p, d: line!.getAttribute('d') ?? '', tone: el.getAttribute('data-tone'), hidden: el.getAttribute('data-hidden') === 'true' };
    }
    const trunks: { part: string; side: string; edges: string[]; p: { x: number; y: number }[]; tone: string | null }[] = [];
    for (const el of Array.from(root.querySelectorAll('g[data-trunk], [data-testid="trunk"]'))) {
      const line = longest(el); const p = line ? cubic(line) : null; if (!p) continue;
      const key = el.getAttribute('data-trunk') ?? '', [part, side] = key ? key.split(':') : [el.getAttribute('data-part') ?? '', el.getAttribute('data-side') ?? ''];
      trunks.push({ part, side, edges: (el.getAttribute('data-edges') ?? '').split(/\s+/).filter(Boolean), p, tone: el.getAttribute('data-tone') });
    }
    const nodes: Record<string, { left: number; right: number; top: number; bottom: number }> = {};
    for (const [id, r] of Object.entries(rects)) { const lt = norm({ x: r.box.left, y: r.box.top }), rb = norm({ x: r.box.right, y: r.box.bottom }); nodes[id] = { left: lt.x, top: lt.y, right: rb.x, bottom: rb.y }; }
    return { scale, nodes, edges, trunks };
  }, anchor);
}
// Two surfaces drew the same connections: every cubic's four points agree within `tolerance` drawing px (0.3 by default).
export function expectSameRoutes(a: Drawn, b: Drawn, what: string, tolerance = 0.3) {
  expect(Object.keys(a.edges).sort(), `${what}: the same connections are drawn`).toEqual(Object.keys(b.edges).sort());
  for (const [id, route] of Object.entries(a.edges)) route.p.forEach((q, i) => {
    expect(Math.abs(q.x - b.edges[id].p[i].x), `${what}: ${id} point ${i} x`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(q.y - b.edges[id].p[i].y), `${what}: ${id} point ${i} y`).toBeLessThanOrEqual(tolerance);
  });
  expect(a.trunks.map(t => `${t.part}:${t.side}:${t.edges.join(' ')}`).sort(), `${what}: the same trunks`).toEqual(b.trunks.map(t => `${t.part}:${t.side}:${t.edges.join(' ')}`).sort());
  for (const t of a.trunks) {
    const other = b.trunks.find(o => o.part === t.part && o.side === t.side && o.edges.join(' ') === t.edges.join(' '))!;
    t.p.forEach((q, i) => { expect(Math.abs(q.x - other.p[i].x), `${what}: trunk ${t.part}:${t.side} point ${i} x`).toBeLessThanOrEqual(tolerance); expect(Math.abs(q.y - other.p[i].y), `${what}: trunk ${t.part}:${t.side} point ${i} y`).toBeLessThanOrEqual(tolerance); });
  }
}
// The parts' boxes, in the same units, agree within `tolerance`.
export function expectSameBoxes(a: Drawn, b: Drawn, what: string, tolerance = 0.3) {
  expect(Object.keys(a.nodes).sort(), `${what}: the same parts`).toEqual(Object.keys(b.nodes).sort());
  for (const [id, r] of Object.entries(a.nodes)) for (const k of ['left', 'right', 'top', 'bottom'] as const)
    expect(Math.abs(r[k] - b.nodes[id][k]), `${what}: ${id} ${k}`).toBeLessThanOrEqual(tolerance);
}
export const boxCentre = (b: Box): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
// The side of a part's box a point on its outline lies nearest, in the box's own units (a point inside the box by a shape's inset counts).
export function nearestSide(p: Point, b: Box): 'left' | 'right' | 'top' | 'bottom' {
  const gaps = { left: Math.abs(p.x - b.left), right: Math.abs(p.x - b.right), top: Math.abs(p.y - b.top), bottom: Math.abs(p.y - b.bottom) };
  return (Object.entries(gaps).sort((x, y) => x[1] - y[1])[0][0]) as 'left' | 'right' | 'top' | 'bottom';
}
// A polyline of a cubic, for tests that need samples (distance to a box, crossings).
export function sampleCubic(p: Point[], n = 64): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t;
    return { x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x, y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y }; });
}

// ---------------------------------------------------------------------------------------------------------------
// 8. An exported image, read for what ADR 0013 and ADR 0014 draw
// ---------------------------------------------------------------------------------------------------------------
export interface ImageNodeInfo {
  id: string; kind: string; form: string; shape: string | null; open: string | null; box: Box | null; texts: string[];
  openMark: { width: number; height: number; right: number; top: number; centreY: number } | null;
  usedBy: { count: string | null; text: string } | null;
  traces: { edge: string; d: string; strokeWidth: string; opacity: number; dash: string; afterBody: boolean; beforeText: boolean }[];
}
export interface ImageHeadInfo {
  id: string; names: { text: string; stroke: string; strokeWidth: string; linejoin: string; paintOrder: string; fill: string }[]; openMark: boolean;
}
export interface ImageInfo {
  nodes: ImageNodeInfo[]; heads: ImageHeadInfo[]; trunks: { part: string; side: string; edges: string[]; paths: number; tone: string | null }[];
  edges: { id: string; tone: string | null }[];
  // Document order (ui contract, The share image): groups' frames, then connections and trunks, then group heads, then the other parts.
  order: { framesBeforeEdges: boolean; headsAfterEdges: boolean; headsBeforeParts: boolean };
  // Elements that cut something out of the drawing: a `clip-path` or `mask` on a connection or on one of its ancestors, anywhere in the image.
  clippedEdges: string[];
  words: string[];
}
export async function inspectImage(page: Page, svg: string): Promise<ImageInfo> {
  return await inDrawingFonts(page, svg, async surface => await surface.evaluate(element => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const bboxOf = (el: SVGGraphicsElement) => {
      const b = el.getBBox(), m = inverse.multiply(el.getScreenCTM()!);
      const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { left: Math.min(...c.map(q => q.x)), right: Math.max(...c.map(q => q.x)), top: Math.min(...c.map(q => q.y)), bottom: Math.max(...c.map(q => q.y)) };
    };
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const nodeGroups = Array.from(root.querySelectorAll('g[data-node-id]'));
    const nodes = nodeGroups.map(g => {
      const body = g.querySelector(':scope > [class~="body"]');
      const rect = g.querySelector('rect') as SVGRectElement | null;
      const mark = g.querySelector('[class~="open-mark"]') as SVGGraphicsElement | null;
      const used = g.querySelector('g[data-used-by]');
      const texts = Array.from(g.querySelectorAll('text')).map(t => (t.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const b = rect ? bboxOf(rect) : null;
      let openMark = null as ImageNodeInfo['openMark'];
      if (mark && b) { const m = bboxOf(mark); openMark = { width: m.right - m.left, height: m.bottom - m.top, right: b.right - m.right, top: m.top - b.top, centreY: (m.top + m.bottom) / 2 - b.top }; }
      const traces = Array.from(g.querySelectorAll('path.trace')).map(t => {
        const s = getComputedStyle(t);
        const firstText = g.querySelector('text');
        return { edge: t.getAttribute('data-edge-of') ?? '', d: t.getAttribute('d') ?? '', strokeWidth: s.strokeWidth, opacity: Number(s.opacity) * Number(s.strokeOpacity), dash: s.strokeDasharray,
          afterBody: body ? before(body, t) : false, beforeText: firstText ? before(t, firstText) : true };
      });
      return { id: g.getAttribute('data-node-id') ?? '', kind: g.getAttribute('data-kind') ?? '', form: g.getAttribute('data-form') ?? '', shape: body ? body.getAttribute('data-shape') : null,
        open: g.getAttribute('data-open'), box: b, texts, openMark,
        usedBy: used ? { count: used.getAttribute('data-used-by'), text: (used.textContent ?? '').replace(/\s+/g, ' ').trim() } : null, traces };
    });
    const heads = Array.from(root.querySelectorAll('g[data-group-head]')).map(h => ({
      id: h.getAttribute('data-group-head') ?? '',
      names: Array.from(h.querySelectorAll('text')).map(t => { const s = getComputedStyle(t);
        return { text: (t.textContent ?? '').replace(/\s+/g, ' ').trim(), stroke: s.stroke, strokeWidth: s.strokeWidth, linejoin: s.strokeLinejoin, paintOrder: s.paintOrder, fill: s.fill }; }),
      openMark: !!h.querySelector('[class~="open-mark"]') }));
    const edgeGroups = Array.from(root.querySelectorAll('g[data-edge-id]')), trunkGroups = Array.from(root.querySelectorAll('g[data-trunk]'));
    const lines = [...edgeGroups, ...trunkGroups], headEls = Array.from(root.querySelectorAll('g[data-group-head]'));
    const frames = nodeGroups.filter(g => g.getAttribute('data-form') === 'group'), others = nodeGroups.filter(g => g.getAttribute('data-form') !== 'group');
    const order = {
      framesBeforeEdges: frames.every(f => lines.every(l => before(f, l))),
      headsAfterEdges: headEls.every(h => lines.every(l => before(l, h))),
      headsBeforeParts: headEls.every(h => others.every(o => before(h, o))),
    };
    const clippedEdges = lines.filter(l => !!l.closest('[clip-path], [mask]') || Array.from(l.querySelectorAll('[clip-path], [mask]')).length > 0).map(l => l.getAttribute('data-edge-id') ?? l.getAttribute('data-trunk') ?? '');
    return {
      nodes, heads,
      trunks: trunkGroups.map(t => ({ part: (t.getAttribute('data-trunk') ?? '').split(':')[0], side: (t.getAttribute('data-trunk') ?? '').split(':')[1] ?? '', edges: (t.getAttribute('data-edges') ?? '').split(/\s+/).filter(Boolean),
        paths: t.querySelectorAll('path').length, tone: t.getAttribute('data-tone') })),
      edges: edgeGroups.map(e => ({ id: e.getAttribute('data-edge-id') ?? '', tone: e.getAttribute('data-tone') })),
      order, clippedEdges,
      words: Array.from(root.querySelectorAll('text')).map(t => (t.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
  }));
}
// An exported image over HTTP (`export.svg`), for the first choice of a drawing: its markup.
export async function imageOf(request: APIRequestContext, id: string, query = 'channel=overview&view=overview&format=readme', base = baseURL()): Promise<string> {
  const response = await request.get(`${base}/api/diagrams/${id}/export.svg?${query}`);
  expect(response.status(), await response.text()).toBe(200); return await response.text();
}
// Markup that only the editor may draw: marks of focus, dragging, guides and the drop target (ui contract, Drawing).
export function editorOnlyMarks(svg: string): string[] {
  return ['data-lifted', 'data-drag-dim', 'data-drop-target', 'data-focus', 'drag-guide', 'drag-gap', 'data-hidden'].filter(mark => svg.includes(mark));
}

// ---------------------------------------------------------------------------------------------------------------
// 9. The share dialog and the layout report
// ---------------------------------------------------------------------------------------------------------------
export async function openShare(page: Page, format: 'format-feed' | 'format-readme' | 'format-slide' | 'format-square' = 'format-readme') {
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
  await page.getByTestId(format).click();
}
export async function closeShare(page: Page) { await page.getByTestId('share-close').click(); await expect(page.getByTestId('share-dialog')).toHaveCount(0); }
export async function advancedOptions(page: Page) {
  const advanced = page.getByTestId('share-advanced');
  if (!await advanced.isVisible()) await page.getByTestId('share-advanced-toggle').click();
  await expect(advanced).toBeVisible(); return advanced;
}
// The advanced options' checkboxes (`show-<name>`) as they stand.
export async function toggleStates(page: Page, names: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const name of names) out[name] = await page.getByTestId(`show-${name}`).isChecked();
  return out;
}
// The toggles of the advanced options of the share dialog (ui contract, Share): there is no `show-items`, and `show-sub` is new.
export const SHARE_TOGGLES = ['title', 'lede', 'sub', 'steps', 'labels', 'legend', 'texts'];
