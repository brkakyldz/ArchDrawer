import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const baseURL = () => `http://127.0.0.1:${process.env.ARCHDRAW_HOLDOUT_PORT}`;
export const kinds = ['actor', 'client', 'api', 'service', 'worker', 'llm', 'external', 'ops', 'gate', 'data'] as const;
// diagram-v2, Lane: exactly one of these shapes, or null.
export type Lane = null | { spine: number } | { anchor: string; side: 'above' | 'below' };
export interface Component {
  id: string; label: string; kind: string; form: string; icon: string | null; sub: string;
  items: string[]; description: string; files: string[]; parent: string | null;
  detail: string | null; place: { row: number; col: number } | null;
  lane?: Lane; from?: string[]; x?: number; y?: number;
}
export interface Connection { id?: string; from: string; to: string; label: string; style: string; both: boolean; step: number | null }
export interface Text { id: string; text: string; x: number; y: number; size: number }
export interface View {
  id: string; title: string; caption: { title: string; lede: string }; postOf?: string | null;
  nodes: Component[]; edges: Connection[]; texts: Text[];
}
export interface LayoutReport {
  view: string; format: string; crossings: number;
  edgesOverParts: { edge: string; node: string }[];
  cutText: { id: string; field: string; text: string }[];
  overLimitText: { id: string; field: string; text: string; limit: number }[];
  smallestText: { inPlace: number; opened: number; level: string };
  counts: { parts: number; zones: number; connections: number };
  targets: { parts: number | null; zones: { min: number; max: number } | null; connections: number | null };
  longestConnection: number;
}
export interface Drawing {
  schema: string; id?: string; title: string; theme?: string; showSteps?: boolean;
  source?: { kind: string; path: string } | null; engine?: { id: string; model: string | null } | null;
  createdAt?: string; updatedAt?: string; views: View[]; warnings?: string[];
  requests?: { id: string; text: string; view: string; at: string }[];
}
export function component(id: string, patch: Partial<Component> = {}): Component {
  return { id, label: id, kind: 'service', form: 'card', icon: null, sub: '', items: [],
    description: `Handles ${id}.`, files: [], parent: null, detail: null, place: null, ...patch };
}
export function drawing(title: string): Drawing {
  return { schema: 'archdraw/diagram@2', title, views: [{ id: 'overview', title: 'Overview',
    caption: { title: `How ${title} works`, lede: 'A request becomes a stored order.' },
    nodes: [
      component('web', { label: 'Web app', kind: 'client', sub: 'React', files: ['src/web.ts'], place: { row: 0, col: 0 } }),
      component('api', { label: 'Order API', kind: 'api', form: 'panel', items: ['Validate order', 'Create order'], files: ['src/api.ts'], place: { row: 0, col: 1 } }),
      component('db', { label: 'Orders DB', kind: 'data', sub: 'Postgres', files: ['src/db.ts'], place: { row: 1, col: 1 } }),
    ], edges: [
      { id: 'e1', from: 'web', to: 'api', label: 'POST /orders', style: 'call', both: true, step: 1 },
      { id: 'e2', from: 'api', to: 'db', label: '', style: 'async', both: false, step: 2 },
    ], texts: [] }] };
}
export async function workspace(id: string, doc = drawing(id)) {
  const dir = await mkdtemp(join(tmpdir(), `archdrawer-${id}-`));
  // Keep the contracted repository root independent of the temp folder's ancestors.
  await mkdir(join(dir, '.git'));
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await mkdir(join(dir, 'src'));
  for (const name of ['web', 'api', 'db', 'extra']) await writeFile(join(dir, 'src', `${name}.ts`), '// Acceptance path fixture.\n');
  const file = join(dir, 'architecture.archdraw.json');
  await writeJSON(file, doc);
  return { dir, file };
}
export async function writeJSON(file: string, value: unknown) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
export async function readDrawing(file: string): Promise<Drawing> { return JSON.parse(await readFile(file, 'utf8')); }
export async function outsideWrite(file: string, doc: Drawing) {
  // A session's atomic edit, through the contracted drawing-file surface.
  const next = `${file}.session.tmp`;
  await writeJSON(next, doc); await rename(next, file);
}
export async function token(request: APIRequestContext, base = baseURL()): Promise<string> {
  const response = await request.get(`${base}/`); expect(response.status()).toBe(200);
  const html = await response.text();
  const tag = html.match(/<meta\b(?=[^>]*\bname=["']archdraw-token["'])[^>]*>/i)?.[0];
  const value = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
  expect(value, 'HTML exposes the local process token').toBeTruthy(); return value!;
}
export async function register(request: APIRequestContext, file: string, base = baseURL()) {
  const auth = await token(request, base);
  const response = await request.post(`${base}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: file } });
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json() as { id: string; url: string };
  return { ...result, token: auth };
}
export async function openDrawing(page: Page, request: APIRequestContext, file: string, base = baseURL()) {
  const result = await register(request, file, base);
  await page.goto(new URL(result.url, base).href);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Saved'); return result;
}
export async function saved(page: Page) { await expect(page.getByTestId('save-status')).toHaveText('Saved'); }
export async function callout(page: Page, id: string) {
  const result = page.getByTestId(`callout-${id}`);
  if (!await result.isVisible()) await page.getByTestId(`node-${id}`).getByTestId('node-label').click();
  await expect(result).toBeVisible(); return result;
}
export async function persisted(file: string, predicate: (doc: Drawing) => boolean, timeout = 10_000) {
  await expect.poll(async () => { try { return predicate(await readDrawing(file)); } catch { return false; } }, { timeout }).toBe(true);
}
export async function cli(args: string[], overrides: Record<string, string> = {}) {
  const env = { ...process.env, PORT: process.env.ARCHDRAW_HOLDOUT_PORT,
    ARCHDRAW_DATA_DIR: process.env.ARCHDRAW_HOLDOUT_DATA, ARCHDRAW_ENGINES: 'fixture',
    ARCHDRAW_NO_OPEN: '1', ARCHDRAW_FIXTURE_STEP_MS: '100', ...overrides };
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [join(root, 'bin', 'archdrawer.mjs'), ...args],
      { cwd: root, env, shell: false, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
      });
  });
}
export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port'));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
export async function box(locator: Locator) {
  const result = await locator.boundingBox(); expect(result).not.toBeNull(); return result!;
}
export function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export async function drag(page: Page, locator: Locator, dx: number, dy: number) {
  const b = await box(locator);
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 24));
  await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + Math.min(b.height / 2, 24) + dy, { steps: 8 }); await page.mouse.up();
}
export async function canvasClick(page: Page, x: number, y: number) {
  await page.getByTestId('canvas').click({ position: { x, y } });
}
export async function emptyCanvasPoint(page: Page) {
  const canvas = await box(page.getByTestId('canvas'));
  const occupied = await page.getByTestId('canvas').locator('[data-testid]').evaluateAll(elements => elements.filter(el => /^(node|text)-/.test(el.getAttribute('data-testid') ?? '') && el.hasAttribute('data-selected')).map(el => {
    const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height };
  }));
  for (let y = 120; y < canvas.height - 160; y += 60) for (let x = 100; x < canvas.width - 100; x += 60) {
    if (!occupied.some(b => overlaps({ x: canvas.x + x - 24, y: canvas.y + y - 24, width: 48, height: 48 }, b))) return { x, y };
  }
  throw new Error('No free canvas point in this scenario');
}
export async function svgInfo(page: Page, svg: string) {
  return await page.evaluate(text => {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const attr = (el: Element | null, name: string) => el?.getAttribute(name) ?? '';
    return {
      error: !!xml.querySelector('parsererror'),
      width: Number(attr(xml.documentElement, 'width')), height: Number(attr(xml.documentElement, 'height')),
      theme: attr(xml.documentElement, 'data-theme'), format: attr(xml.documentElement, 'data-format'),
      viewBox: attr(xml.documentElement, 'viewBox'), xmlns: attr(xml.documentElement, 'xmlns'),
      text: Array.from(xml.querySelectorAll('text')).map(el => el.textContent ?? ''),
      forbidden: !!xml.querySelector('foreignObject, script'),
      nodes: Array.from(xml.querySelectorAll('g[data-node-id]')).map(el => {
        const rect = el.querySelector('rect');
        return { id: attr(el, 'data-node-id'), width: Number(attr(rect, 'width')), height: Number(attr(rect, 'height')),
          text: Array.from(el.querySelectorAll('text')).map(t => t.textContent ?? ''),
          paths: Array.from(el.querySelectorAll('path')).map(p => attr(p, 'd')) };
      }),
      edges: Array.from(xml.querySelectorAll('g[data-edge-id]')).map(el => ({ id: attr(el, 'data-edge-id'),
        paths: Array.from(el.querySelectorAll('path')).map(p => attr(p, 'd')) })),
    };
  }, svg);
}
export async function previewSVG(page: Page) {
  const preview = page.getByTestId('share-preview');
  return await preview.evaluate(el => (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg'))!.outerHTML);
}
export async function download(page: Page, testId: string, file: string) {
  const waiting = page.waitForEvent('download'); await page.getByTestId(testId).click();
  const result = await waiting; await result.saveAs(file); expect(await result.failure()).toBeNull(); return result;
}
export async function edgePaths(page: Page, id: string) {
  return await page.getByTestId(`edge-${id}`).evaluate(el => {
    const paths = el.tagName.toLowerCase() === 'path' ? [el] : Array.from(el.querySelectorAll('path'));
    return paths.map(p => p.getAttribute('d'));
  });
}
export async function clickEdge(page: Page, id: string) {
  const edge = page.getByTestId(`edge-${id}`);
  const point = await edge.evaluate(el => {
    const paths = (el.tagName.toLowerCase() === 'path' ? [el] : Array.from(el.querySelectorAll('path'))) as SVGPathElement[];
    const path = paths.sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
    if (!path) return null;
    const point = path.getPointAtLength(path.getTotalLength() * 0.5); const matrix = path.getScreenCTM();
    if (!matrix) return null; const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  if (point) await page.mouse.click(point.x, point.y); else await edge.click();
}
export async function startRun(request: APIRequestContext, id: string, auth: string, instruction: string, view = 'overview') {
  const response = await request.post(`${baseURL()}/api/runs`, {
    headers: { 'X-Archdraw-Token': auth }, data: { diagramId: id, view, instruction, engine: 'fixture', model: null },
  });
  expect(response.status(), await response.text()).toBe(202); return (await response.json()).runId as string;
}
export async function finishRun(request: APIRequestContext, runId: string, status: string, timeout = 90_000, base = baseURL()) {
  await expect.poll(async () => (await (await request.get(`${base}/api/runs/${runId}`)).json()).status, { timeout }).toBe(status);
  return await (await request.get(`${base}/api/runs/${runId}`)).json();
}
export async function isolatedDrawing(page: Page, request: APIRequestContext, file: string, stepMs = '750', engines = 'fixture') {
  const data = await mkdtemp(join(tmpdir(), 'archdrawer-isolated-'));
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env = { PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: engines, ARCHDRAW_FIXTURE_STEP_MS: stepMs };
  const started = await cli(['open', file, '--no-browser'], env);
  const close = async () => {
    await page.goto('about:blank');
    const stopped = await cli(['stop'], env); expect(stopped.code, stopped.stderr).toBe(0);
  };
  try {
    expect(started.code, started.stderr).toBe(0);
    return { ...await openDrawing(page, request, file, base), base, data, env, close };
  } catch (error) { await close(); throw error; }
}
// api-v2, Run kinds: the raw response, so a scenario can assert 202 or a 400 before any engine starts.
export async function postRun(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  return await request.post(`${base}/api/runs`, { headers: { 'X-Archdraw-Token': auth }, data });
}
export async function startKind(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  const response = await postRun(request, auth, data, base);
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()).runId as string;
}
export function viewOf(doc: Drawing, id: string) {
  const result = doc.views.find(v => v.id === id); expect(result, `view ${id}`).toBeTruthy(); return result!;
}
// diagram-v2, Post-view identity: a post is owned through postOf, never found by its name.
export function postViewOf(doc: Drawing, source: string) {
  const owned = doc.views.filter(v => v.postOf === source);
  expect(owned, `exactly one post of ${source}`).toHaveLength(1); return owned[0];
}
export function labelled(view: View, label: string) {
  const found = view.nodes.filter(n => n.label === label);
  expect(found, `one component labelled ${label} in ${view.id}`).toHaveLength(1); return found[0];
}
export function ids(doc: Drawing) {
  return doc.views.flatMap(v => [...v.nodes.map(n => n.id), ...v.edges.map(e => e.id!), ...v.texts.map(t => t.id)]);
}
export interface Shape { tag: string; testId: string; nodeId: string; edgeId: string; text: string; x: number; y: number; width: number; height: number }
// Boxes inside the rendered share preview, in image pixels (its viewBox is 0 0 width height).
export async function previewBoxes(page: Page, selector: string): Promise<Shape[]> {
  return await boxesIn(page.getByTestId('share-preview'), selector);
}
// The same boxes for an exported SVG (ui-v2, The share image): rendered in its own blank page, so a
// downloaded or HTTP image can be measured in image pixels like the preview.
export async function svgBoxes(page: Page, svg: string, selector: string): Promise<Shape[]> {
  const holder = await page.context().newPage();
  try {
    await holder.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await expect(holder.locator('svg').first()).toBeVisible();
    await holder.evaluate(async () => { await document.fonts.ready; }); // measure with the image's own fonts
    return await boxesIn(holder.locator('body'), selector);
  } finally { await holder.close(); }
}
async function boxesIn(locator: Locator, selector: string): Promise<Shape[]> {
  return await locator.evaluate((element, css) => {
    const svg = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const toRoot = svg.getScreenCTM()!.inverse();
    return Array.from(svg.querySelectorAll(css)).map(found => {
      const target = found as SVGGraphicsElement, bbox = target.getBBox();
      const matrix = toRoot.multiply(target.getScreenCTM()!);
      const corners = [[bbox.x, bbox.y], [bbox.x + bbox.width, bbox.y], [bbox.x, bbox.y + bbox.height], [bbox.x + bbox.width, bbox.y + bbox.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
      return { tag: target.tagName.toLowerCase(), testId: target.getAttribute('data-testid') ?? '',
        nodeId: target.getAttribute('data-node-id') ?? '', edgeId: target.getAttribute('data-edge-id') ?? '',
        text: (target.textContent ?? '').replace(/\s+/g, ' ').trim(),
        x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    });
  }, selector);
}
// ui-v2, Readability meter: the smallest visible text actually drawn in the preview, in image pixels
// (each text's own font size after its SVG transform). Empty text contributes nothing; 0 = no text.
export async function smallestPreviewText(page: Page) {
  return await page.getByTestId('share-preview').evaluate(element => {
    const svg = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const toRoot = svg.getScreenCTM()!.inverse();
    let smallest = 0;
    for (const found of Array.from(svg.querySelectorAll('text'))) {
      const text = found as SVGGraphicsElement;
      if (!(text.textContent ?? '').trim()) continue;
      let hidden = false;
      for (let at: Element | null = text; at && at !== svg.parentElement; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) { hidden = true; break; }
      }
      if (hidden) continue;
      const matrix = toRoot.multiply(text.getScreenCTM()!);
      const drawn = parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b);
      if (!Number.isFinite(drawn) || drawn <= 0) continue;
      smallest = smallest === 0 ? drawn : Math.min(smallest, drawn);
    }
    return smallest;
  });
}
export function bounds(boxes: { x: number; y: number; width: number; height: number }[]) {
  expect(boxes.length).toBeGreaterThan(0);
  return { left: Math.min(...boxes.map(b => b.x)), top: Math.min(...boxes.map(b => b.y)),
    right: Math.max(...boxes.map(b => b.x + b.width)), bottom: Math.max(...boxes.map(b => b.y + b.height)) };
}
// ui-v2, Layout report: the unrounded values the surface exposes.
export function reportNumber(raw: string | null, name: string) {
  if (raw === null || raw.trim() === '' || !Number.isFinite(Number(raw)))
    throw new Error(`Missing, empty or non-finite layout-report data-${name}: ${JSON.stringify(raw)}`);
  const value = Number(raw);
  return value === 0 ? 0 : value;
}
export async function reportAttributes(page: Page, scope = 'share-dialog') {
  const report = page.getByTestId(scope).getByTestId('layout-report');
  await expect(report).toBeVisible();
  const read = async (name: string) => await report.getAttribute(`data-${name}`);
  const number = async (name: string) => reportNumber(await read(name), name);
  return {
    crossings: await number('crossings'), overParts: await number('over-parts'), cut: await number('cut'),
    overLimit: await number('over-limit'), inPlace: await number('in-place'), opened: await number('opened'),
    level: await read('level'), parts: await number('parts'), zones: await number('zones'),
    connections: await number('connections'), longest: await number('longest'),
    view: await read('view'), format: await read('format'),
  };
}
// ui-v2, Layout report: in Share it recomputes when format, part, toggles or caption change. Read it
// only once two consecutive readings agree, so a report still being recomputed is never compared.
export async function settledReport(page: Page, scope = 'share-dialog') {
  let last = await reportAttributes(page, scope);
  await expect.poll(async () => {
    const next = await reportAttributes(page, scope);
    const same = JSON.stringify(next) === JSON.stringify(last); last = next; return same;
  }, { timeout: 15_000, intervals: [200, 200, 300, 500, 1000] }).toBe(true);
  return last;
}
