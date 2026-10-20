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
// diagram contract, Lane: exactly one of these shapes, or null.
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
// A run started with a full request body (kind, format, scope ...); the run id of the accepted run.
export async function startKind(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  const response = await request.post(`${base}/api/runs`, { headers: { 'X-Archdraw-Token': auth }, data });
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()).runId as string;
}
export interface Shape { tag: string; testId: string; nodeId: string; edgeId: string; text: string; x: number; y: number; width: number; height: number }
// Boxes inside an exported SVG (ui contract, The share image): rendered in its own blank page, so a
// downloaded or HTTP image can be measured in image pixels.
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
// ui contract, Layout report: the unrounded values the surface exposes.
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
// ui contract, Layout report: in Share it recomputes when format, part, toggles or caption change. Read it
// only once two consecutive readings agree, so a report still being recomputed is never compared.
export async function settledReport(page: Page, scope = 'share-dialog') {
  let last = await reportAttributes(page, scope);
  await expect.poll(async () => {
    const next = await reportAttributes(page, scope);
    const same = JSON.stringify(next) === JSON.stringify(last); last = next; return same;
  }, { timeout: 15_000, intervals: [200, 200, 300, 500, 1000] }).toBe(true);
  return last;
}

// Match names against the public document, including wrapped lines and explicitly shortened names.
// shortcut: repeated label/detail strings are ambiguous in exports, keep fixtures distinct until a name role is contracted.
export async function previewTextSizes(page: Page) {
  const url = new URL(page.url()), id = url.pathname.split('/').at(-1)!;
  const response = await page.request.get(`${url.origin}/api/diagrams/${id}`);
  expect(response.status()).toBe(200);
  const doc = await response.json() as Drawing;
  const preview = page.getByTestId('share-preview'), viewId = await preview.getAttribute('data-view');
  const drawn = doc.views.find(v => v.id === viewId); expect(drawn).toBeTruthy();
  return await visibleTextSizes(preview, drawn!);
}

export async function visibleTextSizes(surface: Locator, view: View) {
  return await surface.evaluate((element, labels) => {
    const svg = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const toRoot = svg.getScreenCTM()!.inverse();
    const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
    const characters: { source: Node; text: string; nodeId: string | null; name: boolean; font: number; weight: number; opened: number; lineYs: number[] }[] = [];
    const offsets = new Map<SVGTextElement, number>();
    let run: Node | null;
    while ((run = walker.nextNode())) {
      const text = run.parentElement as SVGTextContentElement | null;
      const nameText = text?.closest('text') as SVGTextElement | null;
      if (!text || !nameText) continue;
      const content = run.textContent ?? '', offset = offsets.get(nameText) ?? 0;
      offsets.set(nameText, offset + content.length);
      if (!content.trim() || text.closest('defs, clipPath, mask, marker')) continue;
      const style = getComputedStyle(text);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
      if ((style.fill === 'none' || Number(style.fillOpacity) === 0)
        && (style.stroke === 'none' || Number(style.strokeOpacity) === 0)) continue;
      let hidden = false;
      for (let at: Element | null = text; at && at !== svg.parentElement; at = at.parentElement) {
        const own = getComputedStyle(at);
        if (own.display === 'none' || Number(own.opacity) === 0) { hidden = true; break; }
      }
      if (hidden) continue;
      const matrix = toRoot.multiply(text.getScreenCTM()!);
      const font = parseFloat(style.fontSize), opened = font * Math.hypot(matrix.a, matrix.b);
      if (!Number.isFinite(opened) || opened <= 0) throw new Error('Invalid visible text size');
      const nameMatrix = toRoot.multiply(nameText.getScreenCTM()!);
      for (let i = 0; i < content.length; i++) {
        const y = content[i].trim() ? nameText.getStartPositionOfChar(offset + i).matrixTransform(nameMatrix).y : 0;
        characters.push({ source: run, text: content[i], nodeId: text.closest('g[data-node-id]')?.getAttribute('data-node-id') ?? null,
          name: false, font, weight: Number(style.fontWeight), opened, lineYs: content[i].trim() ? [Math.round(y * 1000) / 1000] : [] });
      }
    }
    for (const group of Array.from(svg.querySelectorAll('g[data-node-id]'))) {
      const id = group.getAttribute('data-node-id')!, label = labels[id].replace(/\s/g, '');
      const own = characters.filter(c => c.nodeId === id && c.text.trim()), actual = own.map(c => c.text).join('');
      let start = actual.indexOf(label), length = label.length;
      if (start < 0) {
        for (let at = 0; at < own.length; at++) {
          const end = actual.indexOf('…', at);
          if (end >= at && label.startsWith(actual.slice(at, end))) { start = at; length = end - at + 1; break; }
        }
      }
      if (start < 0 || !length) throw new Error(`No rendered name for ${id}: ${actual}`);
      own.slice(start, start + length).forEach(c => { c.name = true; });
    }
    const runs: { text: string; nodeId: string | null; name: boolean; font: number; weight: number; opened: number; lineYs: number[] }[] = [];
    for (const source of new Set(characters.map(c => c.source))) {
      const own = characters.filter(c => c.source === source), first = own.findIndex(c => c.name), last = own.map(c => c.name).lastIndexOf(true);
      const slices = first < 0 ? [own] : [own.slice(0, first), own.slice(first, last + 1), own.slice(last + 1)];
      for (const slice of slices) {
        if (!slice.some(c => c.text.trim())) continue;
        const name = slice.some(c => c.name), { nodeId, font, weight, opened } = slice[0];
        runs.push({ text: slice.map(c => c.text).join(''), nodeId, name, font, weight, opened,
          lineYs: name ? slice.flatMap(c => c.lineYs) : [] });
      }
    }
    const minimum = (values: number[]) => values.length ? Math.min(...values) : 0;
    return { opened: minimum(runs.map(r => r.opened)), namesOpened: minimum(runs.filter(r => r.name).map(r => r.opened)), runs };
  }, Object.fromEntries(view.nodes.map(n => [n.id, n.label])));
}

async function reportFields(page: Page, scope = 'share-dialog') {
  const report = page.getByTestId(scope).getByTestId('layout-report');
  for (const name of ['crossings', 'over-parts', 'cut', 'over-limit', 'in-place', 'opened', 'parts', 'zones', 'connections', 'longest']) {
    await expect.poll(async () => {
      const raw = await report.getAttribute(`data-${name}`);
      return raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0;
    }).toBe(true);
  }
  await expect(report).toHaveAttribute('data-level', /^(good|ok|warn)$/);
}

// The share dialog's layout report and readability level agree with the text actually drawn in the preview.
// The meter's wording and the numbers it prints are not pinned: only its level, which the report also carries.
export async function checkReadability(page: Page, width: number, seen: number) {
  await reportFields(page);
  const surface = page.getByTestId('share-dialog').getByTestId('layout-report');
  await expect(surface).toHaveAttribute('data-view', (await page.getByTestId('share-preview').getAttribute('data-view'))!);
  const format = await page.getByTestId('share-preview').evaluate(el => (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg'))!.getAttribute('data-format'));
  expect(format).toBeTruthy(); await expect(surface).toHaveAttribute('data-format', format!);
  await expect.poll(async () => {
    const report = await settledReport(page);
    return Math.abs(report.opened - (await previewTextSizes(page)).opened);
  }).toBeLessThan(0.001);
  const report = await settledReport(page), measured = await previewTextSizes(page);
  expect(measured.runs.length).toBeGreaterThan(0); expect(measured.namesOpened).toBeGreaterThan(0);
  expect(report.opened).toBeGreaterThan(0);
  expect(report.inPlace).toBeCloseTo(report.opened * seen / width, 6);
  const namesInPlace = measured.namesOpened * seen / width;
  expect(report.level).toBe(namesInPlace >= 9 && report.inPlace >= 6.5 ? 'good' : report.opened >= 8 ? 'ok' : 'warn');
  const meter = page.getByTestId('share-dialog').getByTestId('readability');
  await expect(meter).toHaveAttribute('data-level', report.level!);
  return { ...report, namesInPlace, namesOpened: measured.namesOpened };
}
