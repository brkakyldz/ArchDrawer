import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const baseURL = () => `http://127.0.0.1:${process.env.ARCHDRAW_HOLDOUT_PORT}`;
export const kinds = ['actor', 'client', 'api', 'service', 'worker', 'llm', 'external', 'ops', 'gate', 'data'] as const;
export const channelNames = ['overview', 'linkedin', 'readme', 'presentation'] as const;
export type Channel = typeof channelNames[number];
// diagram contract, Lane: exactly one of these shapes, or null.
export type Lane = null | { spine: number } | { anchor: string; side: 'above' | 'below' };

// ---------------------------------------------------------------------------------------------------------------
// The drawn shape ("what a channel draws", diagram contract): a view joined with its facts. Scenarios author
// and compare drawings in this shape; `readDrawing` returns the stored `archdraw/diagram@3` file joined into it
// (the overview views in file order, plus `post`: the LinkedIn channel's view). The stored shape is `Doc3`.
// ---------------------------------------------------------------------------------------------------------------
export interface Component {
  id: string; label: string; kind: string; form: string; icon: string | null; sub: string;
  items: string[]; description: string; files: string[]; parent: string | null;
  detail: string | null; place: { row: number; col: number } | null;
  lane?: Lane; from?: string[]; facts?: string[]; x?: number; y?: number;
  // 0.3: only present when the part draws a mechanism row or a limit row (items then holds the mechanisms' labels first).
  limits?: string[];
}
export interface Connection { id?: string; from: string; to: string; label: string; style: string; both: boolean; step: number | null }
export interface Text { id: string; text: string; x: number; y: number; size: number }
export interface View {
  id: string; title: string; caption: { title: string; lede: string }; postOf?: string | null;
  nodes: Component[]; edges: Connection[]; texts: Text[];
}
export interface Request { id: string; text: string; channel?: string; view: string; at: string }
export interface Drawing {
  schema: string; id?: string; title: string; theme?: string; showSteps?: boolean;
  source?: { kind: string; path: string } | null; engine?: { id: string; model: string | null } | null;
  createdAt?: string; updatedAt?: string; views: View[]; warnings?: string[];
  requests?: Request[]; post?: View | null;
}

// ---------------------------------------------------------------------------------------------------------------
// The stored shape, `archdraw/diagram@3` (diagram contract, Shape).
// ---------------------------------------------------------------------------------------------------------------
export interface Evidence { file: string; lines: [number, number] | null }
export interface Fact {
  id: string; label: string; kind: string; sub: string; description: string; files: string[]; items: string[];
  within?: string | null; evidence?: Evidence[];
}
export interface Relation { id: string; from: string; to: string; label: string; style: string; both: boolean; evidence?: Evidence[] }
export interface LimitFact { id: string; on: string; text: string; evidence?: Evidence[] }
export interface Part {
  id: string; facts: string[]; form: string; icon: string | null; parent: string | null; detail: string | null;
  place: { row: number; col: number } | null; lane?: Lane; x?: number; y?: number;
  held?: string[]; limits?: string[];
  label?: string | null; kind?: string | null; sub?: string | null; description?: string | null; items?: string[] | null;
}
export interface Link { id?: string; from: string; to: string; relations?: string[]; step: number | null; label?: string | null; style?: string | null; both?: boolean | null }
export interface View3 { id: string; title: string; caption: { title: string; lede: string }; nodes: Part[]; edges: Link[]; texts?: Text[] }
export interface Step { id: string; parts: string[]; text: string; note: string }
export interface ChannelDoc { views?: View3[]; showSteps?: boolean; outdated?: string[]; steps?: Step[] }
export interface Doc3 {
  schema: string; id?: string; title: string; theme?: string; source?: { kind: string; path: string } | null;
  engine?: { id: string; model: string | null } | null; createdAt?: string; updatedAt?: string;
  facts: { components: Fact[]; relations?: Relation[]; limits?: LimitFact[] };
  channels: { overview: ChannelDoc; linkedin?: ChannelDoc; readme?: ChannelDoc; presentation?: ChannelDoc };
  requests?: Request[]; warnings?: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Authoring: the drawn shape (written as `@3` by `workspace`), and the stored shape built directly.
// ---------------------------------------------------------------------------------------------------------------
export function component(id: string, patch: Partial<Component> = {}): Component {
  return { id, label: id, kind: 'service', form: 'card', icon: null, sub: '',
    items: [], description: `Handles ${id}.`, files: [], parent: null, detail: null, place: null, ...patch };
}
// An `archdraw/diagram@2` document (one `views` list, content next to layout). The server converts it when read.
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
// An `@2` document with a detail view and a LinkedIn post (a view with `postOf`, parts that say `from`).
export function legacyWithPost(title: string): Drawing {
  const doc = drawing(title);
  doc.views[0].nodes[1].detail = 'inside-api';
  doc.views.push({ id: 'inside-api', title: 'Inside API', caption: { title: 'Inside order intake', lede: '' },
    nodes: [component('validator', { label: 'Validator', kind: 'gate', files: ['src/extra.ts'] }), component('writer', { label: 'Writer' })],
    edges: [{ id: 'detail-edge', from: 'validator', to: 'writer', label: 'valid', style: 'call', both: false, step: 1 }], texts: [] });
  doc.views.push({ id: 'overview-linkedin', title: 'LinkedIn', postOf: 'overview',
    caption: { title: 'An order in three steps', lede: 'Someone orders and the shop keeps it.' },
    nodes: [
      component('web-linkedin', { label: 'Shop front', kind: 'client', sub: 'start here', description: 'Handles web.', files: ['src/web.ts'], from: ['web'], lane: { spine: 0 } }),
      component('api-linkedin', { label: 'Order API', kind: 'api', form: 'panel', items: ['Validate order'], description: 'Handles api.', files: ['src/api.ts'], from: ['api'], lane: { spine: 1 } }),
      component('db-linkedin', { label: 'Orders DB', kind: 'data', sub: 'Postgres', description: 'Handles db.', files: ['src/db.ts'], from: ['db'], lane: { spine: 2 } }),
    ], edges: [
      { id: 'p1', from: 'web-linkedin', to: 'api-linkedin', label: 'POST /orders', style: 'call', both: true, step: 1 },
      { id: 'p2', from: 'api-linkedin', to: 'db-linkedin', label: '', style: 'async', both: false, step: 2 },
    ], texts: [] });
  return doc;
}
export function fact(id: string, patch: Partial<Fact> = {}): Fact {
  return { id, label: id, kind: 'service', sub: '', description: `Handles ${id}.`, files: [], items: [], ...patch };
}
export function part(id: string, patch: Partial<Part> = {}): Part {
  return { id, facts: [id], form: 'card', icon: null, parent: null, detail: null, place: null, ...patch };
}
// A small valid `@3` shop: three facts, two relations, an overview of three parts and no other channel.
export function shop3(title: string): Doc3 {
  return { schema: 'archdraw/diagram@3', title,
    facts: {
      components: [
        fact('web', { label: 'Web app', kind: 'client', sub: 'React', description: 'The shop pages.', files: ['src/web.ts'] }),
        fact('api', { label: 'Order API', kind: 'api', description: 'Takes orders.', files: ['src/api.ts'], items: ['Validate order', 'Create order'] }),
        fact('db', { label: 'Orders DB', kind: 'data', sub: 'Postgres', description: 'Keeps orders.', files: ['src/db.ts'] }),
      ],
      relations: [
        { id: 'r1', from: 'web', to: 'api', label: 'POST /orders', style: 'call', both: true },
        { id: 'r2', from: 'api', to: 'db', label: '', style: 'async', both: false },
      ],
    },
    channels: { overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview',
      caption: { title: `How ${title} works`, lede: 'A request becomes a stored order.' },
      nodes: [part('web', { place: { row: 0, col: 0 } }), part('api', { form: 'panel', place: { row: 0, col: 1 } }), part('db', { place: { row: 1, col: 1 } })],
      edges: [{ id: 'e1', from: 'web', to: 'api', relations: ['r1'], step: 1 }, { id: 'e2', from: 'api', to: 'db', relations: ['r2'], step: 2 }],
      texts: [] }] } } };
}
// Adds a detail view "Inside API" (parts `validator`, `writer`, reached through the `api` part) to the overview.
export function withDetail(doc: Doc3): Doc3 {
  doc.facts.components.push(fact('validator', { label: 'Validator', kind: 'gate', description: 'Checks each order.' }), fact('writer', { label: 'Writer', description: 'Stores each order.' }));
  doc.facts.relations!.push({ id: 'r3', from: 'validator', to: 'writer', label: 'valid', style: 'call', both: false });
  const views = doc.channels.overview.views!;
  views[0].nodes.find(n => n.id === 'api')!.detail = 'inside-api';
  views.push({ id: 'inside-api', title: 'Inside API', caption: { title: 'Inside order intake', lede: '' },
    nodes: [part('validator'), part('writer')], edges: [{ id: 'detail-edge', from: 'validator', to: 'writer', relations: ['r3'], step: 1 }], texts: [] });
  return doc;
}
// Adds a LinkedIn channel drawn over the same facts: `visitor` (web), `intake` (api, a panel) and `ledger` (db).
// By default `ledger` keeps its own label "Orders ledger"; `visitor` and `intake` show their facts directly.
export function withLinkedIn(doc: Doc3, opts: { id?: string; visitorLabel?: string; ledgerLabel?: string | null; intakeItems?: string[]; outdated?: string[] } = {}): Doc3 {
  const ledgerLabel = opts.ledgerLabel === undefined ? 'Orders ledger' : opts.ledgerLabel;
  doc.channels.linkedin = { showSteps: false, outdated: opts.outdated ?? [], views: [{ id: opts.id ?? 'linkedin-post', title: 'LinkedIn',
    caption: { title: 'An order in three steps', lede: 'Someone orders and the shop keeps it.' },
    nodes: [
      part('visitor', { facts: ['web'], lane: { spine: 0 }, ...(opts.visitorLabel ? { label: opts.visitorLabel } : {}) }),
      part('intake', { facts: ['api'], form: 'panel', lane: { spine: 1 }, ...(opts.intakeItems ? { items: opts.intakeItems } : {}) }),
      part('ledger', { facts: ['db'], lane: { spine: 2 }, ...(ledgerLabel ? { label: ledgerLabel } : {}) }),
    ], edges: [
      { id: 'visitor-intake', from: 'visitor', to: 'intake', relations: ['r1'], step: 1 },
      { id: 'intake-ledger', from: 'intake', to: 'ledger', relations: ['r2'], step: 2 },
    ], texts: [] }] };
  return doc;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading: the join (diagram contract, What a channel draws), and the stored file read back.
// ---------------------------------------------------------------------------------------------------------------
export function joinView(doc: Doc3, view: View3): View {
  const facts = new Map(doc.facts.components.map(f => [f.id, f] as const));
  const relations = new Map((doc.facts.relations ?? []).map(r => [r.id, r] as const));
  const limits = new Map((doc.facts.limits ?? []).map(l => [l.id, l] as const));
  const nodes: Component[] = view.nodes.map(p => {
    const shown = p.facts.map(id => facts.get(id)).filter((f): f is Fact => !!f);
    const single = shown.length === 1 ? shown[0] : null;
    const files: string[] = [];
    for (const f of shown) for (const file of f.files) if (!files.includes(file)) files.push(file);
    // 0.3 (diagram contract, What a channel draws): a panel's rows are its held mechanisms' labels, its shown items, then its
    // limits' texts. `limits` is only set when the part draws one, so a drawing written before 0.3 joins exactly as it did.
    const held = (p.held ?? []).map(id => facts.get(id)?.label ?? id);
    const limitTexts = (p.limits ?? []).map(id => limits.get(id)?.text ?? id);
    return { id: p.id, label: p.label ?? single?.label ?? p.id, kind: p.kind ?? single?.kind ?? 'service', form: p.form, icon: p.icon,
      sub: p.sub ?? single?.sub ?? '', items: p.form === 'panel' ? [...held, ...(p.items ?? single?.items ?? [])] : [],
      description: p.description ?? single?.description ?? '', files: files.slice(0, 20), parent: p.parent, detail: p.detail,
      place: p.place, lane: p.lane ?? null, facts: p.facts,
      ...(limitTexts.length && p.form === 'panel' ? { limits: limitTexts } : {}),
      ...(p.x !== undefined ? { x: p.x } : {}), ...(p.y !== undefined ? { y: p.y } : {}) };
  });
  const edges: Connection[] = view.edges.map(l => {
    const only = (l.relations ?? []).length === 1 ? relations.get(l.relations![0]) : undefined;
    return { ...(l.id ? { id: l.id } : {}), from: l.from, to: l.to, label: l.label ?? only?.label ?? '',
      style: l.style ?? only?.style ?? 'call', both: l.both ?? only?.both ?? false, step: l.step };
  });
  return { id: view.id, title: view.title, caption: view.caption, nodes, edges, texts: view.texts ?? [] };
}
export function project(doc: Doc3): Drawing {
  const post = doc.channels.linkedin?.views?.[0];
  return { schema: doc.schema, id: doc.id, title: doc.title, theme: doc.theme, showSteps: doc.channels.overview.showSteps ?? false,
    source: doc.source, engine: doc.engine, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    views: (doc.channels.overview.views ?? []).map(v => joinView(doc, v)), warnings: doc.warnings, requests: doc.requests,
    post: post ? joinView(doc, post) : null };
}
export function allViews(doc: Doc3): View[] {
  return channelNames.flatMap(c => (doc.channels[c]?.views ?? []).map(v => joinView(doc, v)));
}
export const viewOf = (doc: Doc3, channel: Channel = 'overview', id?: string): View3 | undefined => {
  const views = doc.channels[channel]?.views ?? [];
  return id ? views.find(v => v.id === id) : views[0];
};
export const drawn = (doc: Doc3, channel: Channel = 'overview', id?: string): View => joinView(doc, viewOf(doc, channel, id)!);
export const factOf = (doc: Doc3, id: string) => doc.facts.components.find(f => f.id === id);
export const relationOf = (doc: Doc3, id: string) => (doc.facts.relations ?? []).find(r => r.id === id);
export const partOf = (doc: Doc3, channel: Channel, id: string, view?: string) => viewOf(doc, channel, view)?.nodes.find(n => n.id === id);
export const outdatedOf = (doc: Doc3, channel: Channel): string[] => doc.channels[channel]?.outdated ?? [];
export const sorted = (values: string[]) => [...values].sort();
export const ownText = (p: Part | Link | undefined) => ({ label: p?.label ?? null, kind: (p as Part | undefined)?.kind ?? null, sub: (p as Part | undefined)?.sub ?? null,
  description: (p as Part | undefined)?.description ?? null, items: (p as Part | undefined)?.items ?? null });
// The drawn label of an overview part, set the way an outside writer (a session) would: in the part's own text when
// it has one, else in its fact. The drawn label is then `label` whichever way the product stores a rename.
export function setDrawnLabel(doc: Doc3, partId: string, label: string) {
  const p = viewOf(doc)!.nodes.find(n => n.id === partId)!;
  if (p.label !== undefined && p.label !== null) p.label = label; else factOf(doc, p.facts[0])!.label = label;
}
// A drawing authored in the drawn shape, as a `@3` file (one fact per part, one relation per connection, no own text).
export function fromLegacy(old: Drawing): Doc3 {
  const components: Fact[] = [], relations: Relation[] = [], taken = new Set<string>();
  for (const v of old.views) for (const n of v.nodes) {
    if (taken.has(n.id)) continue; taken.add(n.id);
    components.push({ id: n.id, label: n.label, kind: n.kind, sub: n.sub, description: n.description, files: [...n.files], items: [...n.items] });
  }
  let next = 1; const freeRelation = () => { while (taken.has(`r${next}`)) next++; taken.add(`r${next}`); return `r${next}`; };
  const views: View3[] = old.views.map(v => ({ id: v.id, title: v.title, caption: v.caption,
    nodes: v.nodes.map(n => ({ id: n.id, facts: [n.id], form: n.form, icon: n.icon, parent: n.parent, detail: n.detail, place: n.place,
      ...(n.lane !== undefined ? { lane: n.lane } : {}), ...(n.x !== undefined ? { x: n.x } : {}), ...(n.y !== undefined ? { y: n.y } : {}) })),
    edges: v.edges.map(e => {
      let id: string; if (e.id && !taken.has(e.id)) { id = e.id; taken.add(id); } else id = freeRelation();
      relations.push({ id, from: e.from, to: e.to, label: e.label, style: e.style, both: e.both });
      return { ...(e.id ? { id: e.id } : {}), from: e.from, to: e.to, relations: [id], step: e.step };
    }), texts: v.texts ?? [] }));
  return { schema: 'archdraw/diagram@3', ...(old.id ? { id: old.id } : {}), title: old.title, ...(old.theme ? { theme: old.theme } : {}),
    ...(old.source !== undefined ? { source: old.source } : {}), ...(old.engine !== undefined ? { engine: old.engine } : {}),
    ...(old.createdAt ? { createdAt: old.createdAt } : {}), ...(old.updatedAt ? { updatedAt: old.updatedAt } : {}),
    facts: { components, relations }, channels: { overview: { views, showSteps: old.showSteps ?? false, outdated: [] } },
    ...(old.requests ? { requests: old.requests.map(r => ({ ...r, channel: r.channel ?? 'overview' })) } : {}),
    ...(old.warnings ? { warnings: old.warnings } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Files, the server and the command line.
// ---------------------------------------------------------------------------------------------------------------
// A repository folder: `.git`, `src/{web,api,db,extra}.ts`, and the drawing file path `architecture.archdraw.json`.
export async function repo(id: string) {
  const dir = await mkdtemp(join(tmpdir(), `archdrawer-${id}-`));
  // Keep the contracted repository root independent of the temp folder's ancestors.
  await mkdir(join(dir, '.git'));
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await mkdir(join(dir, 'src'));
  for (const name of ['web', 'api', 'db', 'extra']) await writeFile(join(dir, 'src', `${name}.ts`), '// Acceptance path fixture.\n');
  return { dir, file: join(dir, 'architecture.archdraw.json') };
}
// A repository holding the drawing authored in the drawn shape, stored as `archdraw/diagram@3`.
export async function workspace(id: string, doc: Drawing = drawing(id)) {
  const made = await repo(id); await writeJSON(made.file, fromLegacy(doc)); return made;
}
// A repository holding the given document exactly as it is (`@3`, `@2`, `@1`, or an invalid one).
export async function workspaceRaw(id: string, doc: unknown) {
  const made = await repo(id); await writeJSON(made.file, doc); return made;
}
export async function writeJSON(file: string, value: unknown) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
export async function readDocument(file: string): Promise<Doc3> { return JSON.parse(await readFile(file, 'utf8')); }
export async function readDrawing(file: string): Promise<Drawing> { return project(await readDocument(file)); }
// Replaces the drawing file with a drawing authored in the drawn shape (stored as `@3`).
export async function writeDrawing(file: string, doc: Drawing) { await writeJSON(file, fromLegacy(doc)); }
export async function outsideWrite(file: string, doc: unknown) {
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
// The stored document as the server returns it (re-read from disk; an `@2` file is converted first).
export async function getDocument(request: APIRequestContext, id: string, base = baseURL()): Promise<Doc3> {
  const response = await request.get(`${base}/api/diagrams/${id}`); expect(response.status(), await response.text()).toBe(200);
  return await response.json() as Doc3;
}
// GET export.svg / export.mmd with a query string such as `channel=linkedin&format=feed`.
export async function exportOf(request: APIRequestContext, id: string, kind: 'svg' | 'mmd', query = '', base = baseURL()) {
  return await request.get(`${base}/api/diagrams/${id}/export.${kind}${query ? `?${query}` : ''}`);
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
// The same wait over the stored shape.
export async function persistedDoc(file: string, predicate: (doc: Doc3) => boolean, timeout = 10_000) {
  await expect.poll(async () => { try { return predicate(await readDocument(file)); } catch { return false; } }, { timeout }).toBe(true);
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
// A refine run on the given view (and channel, when given; the default is the overview).
export async function startRun(request: APIRequestContext, id: string, auth: string, instruction: string, view = 'overview', channel?: Channel) {
  const response = await request.post(`${baseURL()}/api/runs`, {
    headers: { 'X-Archdraw-Token': auth },
    data: { diagramId: id, ...(channel ? { channel } : {}), view, instruction, engine: 'fixture', model: null },
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
// A run started with a full request body (kind, format, scope, channel ...); the run id of the accepted run.
export async function startKind(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  const response = await request.post(`${base}/api/runs`, { headers: { 'X-Archdraw-Token': auth }, data });
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()).runId as string;
}
// A run request the server must refuse: its status and error message.
export async function refusedRun(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  const response = await request.post(`${base}/api/runs`, { headers: { 'X-Archdraw-Token': auth }, data });
  const body = await response.json() as { error?: string };
  return { status: response.status(), error: body.error ?? '' };
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
  const doc = await response.json() as Doc3;
  const preview = page.getByTestId('share-preview'), viewId = await preview.getAttribute('data-view');
  const shown = allViews(doc).find(v => v.id === viewId); expect(shown).toBeTruthy();
  return await visibleTextSizes(preview, shown!);
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

// ---------------------------------------------------------------------------------------------------------------
// 0.3: facts with evidence, mechanisms and limits, and a README and a presentation drawn over the same facts.
// ---------------------------------------------------------------------------------------------------------------
// An agent project's facts: `app`, an `agent` that holds the mechanisms `model-call` and `tool-check` (a gate) and has a
// limit, and a `store`; every fact carries evidence in the files `repo()` writes. The overview draws the agent as a panel
// with two mechanism rows and one limit row.
export function agent3(title: string): Doc3 {
  const at = (file: string, lines: [number, number] | null = [1, 1]): Evidence[] => [{ file, lines }];
  return { schema: 'archdraw/diagram@3', title,
    facts: {
      components: [
        fact('app', { label: 'App', kind: 'client', description: 'Starts the work.', files: ['src/web.ts'], evidence: at('src/web.ts', null) }),
        fact('agent', { label: 'Agent', kind: 'llm', description: 'Runs the tool loop.', files: ['src/api.ts'], evidence: at('src/api.ts') }),
        fact('model-call', { label: 'Model call', kind: 'llm', description: 'Asks the model for the next step.', within: 'agent', files: ['src/api.ts'], evidence: at('src/api.ts') }),
        fact('tool-check', { label: 'Tool check', kind: 'gate', description: 'Approves a tool call before it runs.', within: 'agent', files: ['src/extra.ts'], evidence: at('src/extra.ts') }),
        fact('store', { label: 'Store', kind: 'data', description: 'Keeps the run state.', files: ['src/db.ts'], evidence: at('src/db.ts', null) }),
      ],
      relations: [
        { id: 'r1', from: 'app', to: 'agent', label: 'asks', style: 'call', both: false, evidence: at('src/web.ts') },
        { id: 'r2', from: 'agent', to: 'store', label: 'keeps state', style: 'call', both: false, evidence: at('src/db.ts') },
      ],
      limits: [{ id: 'turn-limit', on: 'agent', text: 'Stops after 12 turns', evidence: at('src/api.ts') }],
    },
    channels: { overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview',
      caption: { title: `How ${title} runs`, lede: 'An app asks an agent, which keeps its state.' },
      nodes: [part('app', { place: { row: 0, col: 0 } }),
        part('agent', { form: 'panel', place: { row: 0, col: 1 }, held: ['model-call', 'tool-check'], limits: ['turn-limit'] }),
        part('store', { place: { row: 1, col: 1 } })],
      edges: [{ id: 'e1', from: 'app', to: 'agent', relations: ['r1'], step: 1 }, { id: 'e2', from: 'agent', to: 'store', relations: ['r2'], step: 2 }],
      texts: [] }] } } };
}
function overviewCopy(doc: Doc3, id: string, title: string): View3 {
  return { ...structuredClone(doc.channels.overview.views![0]), id, title, texts: [] };
}
// A README channel drawn over the same facts: the overview's first view under the id `readme`.
export function withReadme(doc: Doc3, opts: { outdated?: string[]; id?: string } = {}): Doc3 {
  doc.channels.readme = { showSteps: false, outdated: opts.outdated ?? [], views: [overviewCopy(doc, opts.id ?? 'readme', 'README')] };
  return doc;
}
// A presentation channel over the same facts: the overview's first view under the id `presentation` and ordered steps
// (by default one per top-level part that shows a fact, the first three).
export function withPresentation(doc: Doc3, opts: { steps?: Step[]; outdated?: string[]; id?: string } = {}): Doc3 {
  const view = overviewCopy(doc, opts.id ?? 'presentation', 'Presentation');
  const shown = view.nodes.filter(n => n.form !== 'group' && n.facts.length > 0).map(n => n.id).slice(0, 3);
  const steps = opts.steps ?? shown.map((id, i) => ({ id: `s${i + 1}`, parts: [id], text: `Look at ${id}`, note: `Say what ${id} does.` }));
  doc.channels.presentation = { showSteps: false, outdated: opts.outdated ?? [], views: [view], steps };
  return doc;
}
// shop3 with no `files`, so a drawing file may sit anywhere (a project folder of a scan) without missing paths.
export function shopWithoutFiles(title: string): Doc3 {
  const doc = shop3(title); for (const f of doc.facts.components) f.files = []; return doc;
}
export const outputLines = (result: { stdout: string; stderr: string }) => `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(line => line.trimEnd());
export const warnLines = (result: { stdout: string; stderr: string }) => outputLines(result).filter(line => /^WARN\s/.test(line));
export const errorLines = (result: { stdout: string; stderr: string }) => outputLines(result).filter(line => /^ERROR /.test(line));
export async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
// The same folder whichever way the platform writes it (case on Windows, separators).
export const samePath = (a: string, b: string) => {
  const flat = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? flat(a).toLowerCase() === flat(b).toLowerCase() : flat(a) === flat(b);
};

// ---------------------------------------------------------------------------------------------------------------
// 0.3: project folders to scan and draw. A folder in git is a real repository with commits (`git` is on PATH).
// ---------------------------------------------------------------------------------------------------------------
export const dataDir = () => process.env.ARCHDRAW_HOLDOUT_DATA!;
function git(cwd: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile('git', ['-c', 'user.name=Holdout', '-c', 'user.email=holdout@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 },
      (error, stdout, stderr) => error ? reject(new Error(`git ${args.join(' ')}: ${stderr || error.message}`)) : resolve(stdout));
  });
}
const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} line ${i + 1}`).join('\n') + '\n';
// The project every scan and draw scenario uses. The names sort the same under every collation, so the fixture's
// "first", "second" and "third" file of the listing are alpha.ts, beta.ts and gamma.ts.
export const projectFiles: Record<string, string> = {
  'alpha.ts': sixLines('alpha'), 'beta.ts': sixLines('beta'), 'gamma.ts': sixLines('gamma'), 'main.ts': sixLines('main'),
  'package.json': '{\n  "name": "holdout-project",\n  "main": "main.ts"\n}\n', 'readme.md': '# Holdout project\n\nA project for the scan.\n',
};
export async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) { const target = join(dir, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }
}
// A repository with one commit holding `files`.
export async function gitRepo(id: string, files: Record<string, string> = projectFiles, folderName?: string) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), `archdrawer-${id}-`)));
  const dir = folderName ? join(parent, folderName) : parent;
  if (folderName) await mkdir(dir);
  await git(dir, ['init']); await writeFiles(dir, files);
  await git(dir, ['add', '--all']); await git(dir, ['commit', '-m', 'first commit']);
  return {
    dir, git: (args: string[]) => git(dir, args), head: async () => (await git(dir, ['rev-parse', 'HEAD'])).trim(),
    write: (more: Record<string, string>) => writeFiles(dir, more),
    commit: async (more: Record<string, string>, message = 'next commit') => {
      await writeFiles(dir, more); await git(dir, ['add', '--all']); await git(dir, ['commit', '-m', message]);
      return (await git(dir, ['rev-parse', 'HEAD'])).trim();
    },
  };
}
// A folder that is not in git at all.
export async function plainFolder(id: string, files: Record<string, string> = projectFiles) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `archdrawer-${id}-`))); await writeFiles(dir, files); return dir;
}
// A repository with no commit yet: `.git` exists, `git rev-parse HEAD` fails, so it is not in git for the product.
export async function gitWithoutCommit(id: string, files: Record<string, string> = projectFiles) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `archdrawer-${id}-`))); await git(dir, ['init']); await writeFiles(dir, files); return dir;
}
// A folder whose last segment carries a fixture marker (testing contract, Scan). A Windows folder cannot be named with
// ":", so there it is null and a scenario skips the part that needs it (the marker also works in a typed focus for a draw).
export async function markerFolder(marker: string, files: Record<string, string> = projectFiles): Promise<string | null> {
  if (process.platform === 'win32') return null;
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'archdrawer-marker-')));
  const dir = join(parent, `shop ${marker}`); await mkdir(dir); await writeFiles(dir, files); return dir;
}
// The same, as a repository with a commit (so a finished scan of it would be cached).
export async function markerRepo(marker: string, files: Record<string, string> = projectFiles) {
  if (process.platform === 'win32') return null;
  return await gitRepo('marker', files, `shop ${marker}`);
}
// A project folder that already holds a drawing at docs/architecture.archdraw.json (api contract, The draw run).
export async function writeExistingDrawing(dir: string, name = 'architecture.archdraw.json', title = 'Earlier drawing') {
  await mkdir(join(dir, 'docs'), { recursive: true }); const file = join(dir, 'docs', name);
  await writeJSON(file, shopWithoutFiles(title)); return file;
}
export async function scanCacheCount() {
  try { return (await readdir(join(dataDir(), 'scans'))).filter(name => name.endsWith('.json')).length; } catch { return 0; }
}

// ---------------------------------------------------------------------------------------------------------------
// 0.3: the scan resource, the draw run and event streams.
// ---------------------------------------------------------------------------------------------------------------
export interface ScanOption { id: string; kind: string; title: string; sentence: string; files: string[] }
export interface ScanRecord {
  id: string; status: string; progress: string[]; folder: string; root: string; commit: string | null; cached: boolean;
  card: { name: string; sentence: string; type: string; languages: string[]; entryPoints: string[] } | null;
  options: ScanOption[] | null; warnings: string[]; error: string | null; engine: string | null; model: string | null;
}
// A POST that carries the token; the status and the parsed body, whatever they are.
export async function postJSON(request: APIRequestContext, auth: string, path: string, data: unknown, base = baseURL()) {
  const response = await request.post(`${base}${path}`, { headers: { 'X-Archdraw-Token': auth }, data });
  let body: any = null; try { body = await response.json(); } catch { body = null; }
  return { status: response.status(), body };
}
export const checkFolder = (request: APIRequestContext, auth: string, folder: unknown, base = baseURL()) => postJSON(request, auth, '/api/folders/check', { folder }, base);
export async function startScan(request: APIRequestContext, auth: string, folder: string, extra: Record<string, unknown> = {}, base = baseURL()) {
  const started = await postJSON(request, auth, '/api/scans', { folder, engine: 'fixture', model: null, ...extra }, base);
  expect(started.status, JSON.stringify(started.body)).toBe(202); return started.body.scanId as string;
}
export async function scanRecord(request: APIRequestContext, scanId: string, base = baseURL()): Promise<ScanRecord> {
  const response = await request.get(`${base}/api/scans/${scanId}`); expect(response.status()).toBe(200); return await response.json() as ScanRecord;
}
export async function finishScan(request: APIRequestContext, scanId: string, status = 'succeeded', timeout = 60_000, base = baseURL()) {
  await expect.poll(async () => (await scanRecord(request, scanId, base)).status, { timeout }).toBe(status);
  return await scanRecord(request, scanId, base);
}
// Starts a scan and waits for it to succeed.
export async function scanFolder(request: APIRequestContext, auth: string, folder: string, extra: Record<string, unknown> = {}, base = baseURL()) {
  return await finishScan(request, await startScan(request, auth, folder, extra, base), 'succeeded', 60_000, base);
}
// Starts a `draw` run (api contract, The draw run) and returns its id.
export async function startDraw(request: APIRequestContext, auth: string, scan: string, focus: unknown, channel: string, extra: Record<string, unknown> = {}, base = baseURL()) {
  return await startKind(request, auth, { kind: 'draw', scan, focus, channel, engine: 'fixture', model: null, ...extra }, base);
}
export async function refusedDraw(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  return await refusedRun(request, auth, { kind: 'draw', engine: 'fixture', model: null, ...data }, base);
}
// Scan, then draw, then wait: the finished run record.
export async function drawFolder(request: APIRequestContext, auth: string, folder: string, opts: { focus?: unknown; channel?: string; status?: string; extra?: Record<string, unknown> } = {}, base = baseURL()) {
  const scan = await scanFolder(request, auth, folder, {}, base);
  const runId = await startDraw(request, auth, scan.id, opts.focus ?? { kind: 'option', option: 'o1' }, opts.channel ?? 'linkedin', opts.extra ?? {}, base);
  return { scan, runId, run: await finishRun(request, runId, opts.status ?? 'succeeded', 120_000, base) };
}
// The events of a scan or a run: the stream is read until its `done` event, then closed.
export async function sseEvents(url: string, until = 'done', timeoutMs = 60_000): Promise<{ event: string; data: any }[]> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs), events: { event: string; data: any }[] = [];
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let at = buffer.search(/\r?\n\r?\n/); at >= 0; at = buffer.search(/\r?\n\r?\n/)) {
        const block = buffer.slice(0, at); buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
        let event = 'message'; const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        events.push({ event, data: JSON.parse(data.join('\n')) });
        if (event === until) { controller.abort(); return events; }
      }
    }
    return events;
  } catch (error) {
    if (events.some(e => e.event === until)) return events; throw error;
  } finally { clearTimeout(timer); }
}
export const scanEvents = (scanId: string, base = baseURL()) => sseEvents(`${base}/api/scans/${scanId}/events`, 'done');
export const runEvents = (runId: string, base = baseURL()) => sseEvents(`${base}/api/runs/${runId}/events`, 'done');
export async function listedDiagrams(request: APIRequestContext, base = baseURL()) {
  const response = await request.get(`${base}/api/diagrams`); expect(response.status()).toBe(200);
  return (await response.json()).diagrams as { id: string; title: string; path: string | null; updatedAt: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// 0.3: the editor's start flow, the steps panel and the keyboard.
// ---------------------------------------------------------------------------------------------------------------
// Tab until the element with this test id (or one inside it) has the focus; fails when it is not reached.
export async function tabTo(page: Page, testId: string, max = 60) {
  for (let i = 0; i < max; i++) {
    const there = await page.evaluate(id => !!document.activeElement?.closest(`[data-testid="${id}"]`), testId);
    if (there) return; await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${testId}`);
}
export async function stepIds(page: Page) {
  return await page.getByTestId('step-item').evaluateAll(items => items.map(item => item.getAttribute('data-step-id')));
}
// The ids of the parts a step lights (`data-step="on"`) and of those it dims, on the canvas.
export async function litParts(page: Page) {
  return await page.getByTestId('canvas').locator('[data-testid^="node-"][data-form]').evaluateAll(nodes => {
    const id = (el: Element) => (el.getAttribute('data-testid') ?? '').slice('node-'.length);
    return { on: nodes.filter(n => n.getAttribute('data-step') === 'on').map(id).sort(),
      dim: nodes.filter(n => n.getAttribute('data-dim') === 'true').map(id).sort(),
      all: nodes.map(id).sort() };
  });
}
export async function nodeSizes(page: Page, ids: string[]) {
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const id of ids) { const b = await box(page.getByTestId(`node-${id}`)); sizes[id] = { width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 }; }
  return sizes;
}
