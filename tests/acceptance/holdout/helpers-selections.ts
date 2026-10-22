import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  baseURL, fact, part, repo, writeJSON, startKind, finishRun, scanFolder, postJSON, project, token, type Doc3, type Drawing, type Fact,
  type Relation, type Request, type View3,
} from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// Round of ADR 0015 (selections): several choices in one file (`archdraw/diagram@4`), the scan's two kinds, the home screen's
// checkboxes, a draw of several choices, the whole-system map, a part with an inside that opens on a click, the views panel.
// Nothing here reads product code: every helper only uses the surfaces the contracts name.
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// The stored shape, `archdraw/diagram@4` (diagram contract, *Shape* and *Choice*).
// ---------------------------------------------------------------------------------------------------------------
export const SCHEMA4 = 'archdraw/diagram@4';
export type ChoiceKind = 'system' | 'section' | 'flow' | 'custom';
export interface Choice4 { id: string; title: string; kind: ChoiceKind; about?: string; facts: Doc3['facts']; channels: Doc3['channels'] }
export interface Request4 extends Request { choice?: string }
export interface Doc4 {
  schema: string; id?: string; title: string; theme?: string; source?: Doc3['source']; engine?: Doc3['engine'];
  createdAt?: string; updatedAt?: string; choices: Choice4[]; requests?: Request4[]; warnings?: string[];
}
export const CHOICE_ORDER: ChoiceKind[] = ['system', 'section', 'flow', 'custom'];

export function choice4(content: Pick<Doc3, 'facts' | 'channels'>, meta: { id: string; title: string; kind: ChoiceKind; about?: string }): Choice4 {
  return { id: meta.id, title: meta.title, kind: meta.kind, about: meta.about ?? '', facts: content.facts, channels: content.channels };
}
export function doc4(title: string, choices: Choice4[], extra: Partial<Doc4> = {}): Doc4 { return { schema: SCHEMA4, title, choices, ...extra }; }
// What the drawing contract's *Reading `archdraw/diagram@3`* says a format 3 file becomes, built by hand: its facts and channels are the
// one choice `system`, every request names it, nothing else changes.
export function wrapAs4(old: Doc3): Doc4 {
  const { facts, channels, requests, schema: _schema, ...rest } = old;
  return { ...rest, schema: SCHEMA4, choices: [{ id: 'system', title: 'The whole system', kind: 'system', about: '', facts, channels }],
    ...(requests ? { requests: requests.map(r => ({ ...r, choice: 'system' })) } : {}) };
}
// One choice in the shape format 3 held a whole file in, so the older helpers (`joinView`, `viewOf`, `drawn`, `factOf` …) read it.
// The schema says `@3` on purpose: this is a view of one choice, and written back it is a valid format 3 file the server converts.
export function flat3(doc: Doc4 | Doc3, choiceId?: string): Doc3 {
  if (!('choices' in doc) || !Array.isArray((doc as Doc4).choices)) return doc as Doc3;
  const d = doc as Doc4, c = (choiceId ? d.choices.find(x => x.id === choiceId) : d.choices[0]);
  if (!c) throw new Error(`No choice ${choiceId} in the document: ${d.choices.map(x => x.id).join(', ')}`);
  const { choices: _choices, requests, schema: _schema, ...rest } = d;
  const mine = (requests ?? []).filter(r => (r.choice ?? 'system') === c.id);
  return { ...rest, schema: 'archdraw/diagram@3', facts: c.facts, channels: c.channels, ...(requests ? { requests: mine } : {}) };
}
export async function readRaw(file: string): Promise<any> { return JSON.parse(await readFile(file, 'utf8')); }
export async function readChoice(file: string, choiceId?: string): Promise<Doc3> { return flat3(await readRaw(file), choiceId); }
export async function readChoices(file: string): Promise<Doc4> {
  const doc = await readRaw(file); expect(doc.schema, `${file} is format 4`).toBe(SCHEMA4); return doc as Doc4;
}
// The same wait `persisted` makes, over the raw stored document.
export async function persistedRaw(file: string, predicate: (doc: any) => boolean, timeout = 10_000) {
  await expect.poll(async () => { try { return predicate(await readRaw(file)); } catch { return false; } }, { timeout }).toBe(true);
}
// The document as the server returns it, raw (format 4).
export async function getRaw(request: APIRequestContext, id: string, base = baseURL()): Promise<Doc4> {
  const response = await request.get(`${base}/api/diagrams/${id}`); expect(response.status(), await response.text()).toBe(200);
  return await response.json() as Doc4;
}
// Compatible stand-ins for `readDocument`, `readDrawing`, `persisted`, `persistedDoc` and `getDocument` of helpers.ts, which hand
// back the stored file as it is: a file the server wrote is now format 4. These read one choice (the first, or `choice`) in the
// format 3 shape.
export async function readDocument(file: string, choice?: string): Promise<Doc3> { return flat3(await readRaw(file), choice); }
export async function readDrawing(file: string, choice?: string): Promise<Drawing> { return project(await readDocument(file, choice)); }
export async function persistedDoc(file: string, predicate: (doc: Doc3) => boolean, timeout = 10_000, choice?: string) {
  await expect.poll(async () => { try { return predicate(await readDocument(file, choice)); } catch { return false; } }, { timeout }).toBe(true);
}
export async function persisted(file: string, predicate: (doc: Drawing) => boolean, timeout = 10_000, choice?: string) {
  await expect.poll(async () => { try { return predicate(await readDrawing(file, choice)); } catch { return false; } }, { timeout }).toBe(true);
}
export async function getDocument(request: APIRequestContext, id: string, choice?: string, base = baseURL()): Promise<Doc3> { return flat3(await getRaw(request, id, base), choice); }
export async function workspace4(id: string, doc: Doc4 | unknown) { const made = await repo(id); await writeJSON(made.file, doc); return made; }
export const choiceIds = (doc: Doc4) => doc.choices.map(c => c.id);
export const viewIdsOf = (c: Choice4) => (c.channels.overview.views ?? []).map(v => v.id);
export const allViewIds = (doc: Doc4) => doc.choices.flatMap(c => (['overview', 'linkedin', 'readme', 'presentation'] as const).flatMap(ch => (c.channels[ch]?.views ?? []).map(v => v.id)));
export const factIdsOf = (c: Choice4) => c.facts.components.map(f => f.id);
// Every component fact a choice's overview shows or holds, across all its views (diagram contract, rule 16).
export function drawnFacts(c: Choice4): Set<string> {
  return new Set((c.channels.overview.views ?? []).flatMap(v => v.nodes.flatMap(n => [...n.facts, ...(n.held ?? [])])));
}
export const missingFacts = (c: Choice4) => c.facts.components.map(f => f.id).filter(id => !drawnFacts(c).has(id));

// ---------------------------------------------------------------------------------------------------------------
// A hand-made drawing of four choices: the file's own order is flow, custom, section, system, so the editor opens on
// `checkout`, and the views panel (system, sections, flows, your own) lists them in another order.
//
//   system   "The whole system"   map `overview`: web, back-end (card, no fact, inside `back-end-inside`)
//                                 `appendix` (no part links to it), `back-end-inside`: api, orders (inside `orders-inside`),
//                                 `orders-inside`: pay, db, mail; channel LinkedIn `system-linkedin`
//   server   "The server side"    section: `server-overview` (api, store) and `server-linkedin`
//   checkout "Checkout"           flow: `checkout-overview` (cart, charge → `checkout-charge`, shop-zone, a group → `checkout-shop`)
//   howto    "How billing works"  custom: `howto-overview` (bill)
// The same fact id `api` is in `system` and in `server`, with the same label: an edit in one must not reach the other.
// Facts hold no file, so the file may sit in any folder.
// ---------------------------------------------------------------------------------------------------------------
const rel = (id: string, from: string, to: string, label = '', style = 'call'): Relation => ({ id, from, to, label, style, both: false });
const view = (id: string, title: string, nodes: View3['nodes'], edges: View3['edges'] = [], caption = title): View3 => ({ id, title, caption: { title: caption, lede: '' }, nodes, edges, texts: [] });
const channel = (views: View3[]) => ({ showSteps: false, outdated: [] as string[], views });
export function fourChoices(title = 'Four choices shop'): Doc4 {
  const system: Choice4 = choice4({
    facts: { components: [
      fact('web', { label: 'Web app', kind: 'client', description: 'The shop pages.' }),
      fact('api', { label: 'Order API', kind: 'api', description: 'Takes orders.' }),
      fact('orders', { label: 'Orders', kind: 'service', description: 'Keeps the orders.' }),
      fact('pay', { label: 'Payments', kind: 'service', description: 'Takes the money.' }),
      fact('db', { label: 'Orders DB', kind: 'data', description: 'Stores the orders.' }),
      fact('mail', { label: 'Mailer', kind: 'external', description: 'Sends receipts.' }),
      fact('notes', { label: 'Release notes', kind: 'service', description: 'Notes no part links to.' }),
    ], relations: [rel('r1', 'web', 'api', 'POST /orders'), rel('r2', 'api', 'orders'), rel('r3', 'orders', 'pay'), rel('r4', 'pay', 'db'), rel('r5', 'pay', 'mail', 'receipt', 'async')] },
    channels: {
      overview: channel([
        view('overview', 'Overview', [part('web', { place: { row: 0, col: 0 } }),
          part('back-end', { facts: [], label: 'Back-end', kind: 'service', description: 'A group of components.', detail: 'back-end-inside', place: { row: 0, col: 1 } })],
          [{ id: 'web-back-end', from: 'web', to: 'back-end', relations: [], step: 1, label: 'orders', style: 'call', both: false }], 'The shop in two parts'),
        view('appendix', 'Appendix', [part('notes')], [], 'Notes'),
        view('back-end-inside', 'Back-end', [part('api', { place: { row: 0, col: 0 } }), part('orders', { detail: 'orders-inside', place: { row: 0, col: 1 } })],
          [{ id: 'api-orders', from: 'api', to: 'orders', relations: ['r2'], step: null }], 'Inside the back-end'),
        view('orders-inside', 'Orders inside', [part('pay', { place: { row: 0, col: 0 } }), part('db', { place: { row: 0, col: 1 } }), part('mail', { place: { row: 1, col: 0 } })],
          [{ id: 'pay-db', from: 'pay', to: 'db', relations: ['r4'], step: null }, { id: 'pay-mail', from: 'pay', to: 'mail', relations: ['r5'], step: null }], 'Inside the orders'),
      ]),
      linkedin: channel([view('system-linkedin', 'LinkedIn', [part('visitor', { facts: ['web'], lane: { spine: 0 } }), part('core', { facts: ['api'], lane: { spine: 1 } }), part('ledger', { facts: ['db'], lane: { spine: 2 } })],
        [{ id: 'visitor-core', from: 'visitor', to: 'core', relations: ['r1'], step: 1 }, { id: 'core-ledger', from: 'core', to: 'ledger', relations: [], step: 2, label: 'saves', style: 'call', both: false }], 'The shop in three steps')]),
    } }, { id: 'system', title: 'The whole system', kind: 'system' });
  const server: Choice4 = choice4({
    facts: { components: [fact('api', { label: 'Order API', kind: 'api', description: 'Takes orders.' }), fact('store', { label: 'Order store', kind: 'data', description: 'Keeps the state.' })], relations: [rel('s1', 'api', 'store', 'keeps state')] },
    channels: {
      overview: channel([view('server-overview', 'Overview', [part('api', { place: { row: 0, col: 0 } }), part('store', { place: { row: 0, col: 1 } })], [{ id: 'api-store', from: 'api', to: 'store', relations: ['s1'], step: 1 }], 'How the server keeps state')]),
      linkedin: channel([view('server-linkedin', 'LinkedIn', [part('entry', { facts: ['api'], lane: { spine: 0 } }), part('keep', { facts: ['store'], lane: { spine: 1 } })],
        [{ id: 'entry-keep', from: 'entry', to: 'keep', relations: ['s1'], step: 1 }], 'The server in two steps')]),
    } }, { id: 'server', title: 'The server side', kind: 'section', about: 'The code that serves requests and keeps state.' });
  const checkout: Choice4 = choice4({
    facts: { components: [fact('cart', { label: 'Cart', kind: 'client', description: 'What the shopper picked.' }), fact('charge', { label: 'Charge', kind: 'service', description: 'Takes the payment.' }),
      fact('gateway', { label: 'Card gateway', kind: 'external', description: 'Moves the money.' }), fact('shop-rules', { label: 'Shop rules', kind: 'service', description: 'Rules the shop follows.' })],
    relations: [rel('c1', 'cart', 'charge', 'pays'), rel('c2', 'charge', 'gateway')] },
    channels: { overview: channel([
      view('checkout-overview', 'Overview', [part('cart', { place: { row: 0, col: 0 } }), part('charge', { detail: 'checkout-charge', place: { row: 0, col: 1 } }),
        part('shop-zone', { facts: [], form: 'group', label: 'Shop', kind: 'service', description: 'The shop as one frame.', detail: 'checkout-shop', place: { row: 1, col: 0 } })],
        [{ id: 'cart-charge', from: 'cart', to: 'charge', relations: ['c1'], step: 1 }], 'How an order is placed'),
      view('checkout-charge', 'Charge', [part('gateway')], [], 'Inside the charge'),
      view('checkout-shop', 'Shop', [part('rules', { facts: ['shop-rules'] })], [], 'Inside the shop'),
    ]) } }, { id: 'checkout', title: 'Checkout', kind: 'flow', about: 'How an order is placed.' });
  const howto: Choice4 = choice4({
    facts: { components: [fact('bill', { label: 'Billing', kind: 'service', description: 'Bills the shopper.' })], relations: [] },
    channels: { overview: channel([view('howto-overview', 'Overview', [part('bill')], [], 'How billing works')]) } }, { id: 'howto', title: 'How billing works', kind: 'custom', about: 'My own question.' });
  return doc4(title, [checkout, howto, server, system], { theme: 'light' });
}
// The views panel's entries for `fourChoices`: `<view id>` with its depth and the text the entry shows, in the panel's order.
export const FOUR_PANEL: { view: string; choice: string; depth: number; text: string }[] = [
  { view: 'overview', choice: 'system', depth: 0, text: 'The whole system' },
  { view: 'back-end-inside', choice: 'system', depth: 1, text: 'Back-end' },
  { view: 'orders-inside', choice: 'system', depth: 2, text: 'Orders inside' },
  { view: 'appendix', choice: 'system', depth: 1, text: 'Appendix' },
  { view: 'server-overview', choice: 'server', depth: 0, text: 'The server side' },
  { view: 'checkout-overview', choice: 'checkout', depth: 0, text: 'Checkout' },
  { view: 'checkout-charge', choice: 'checkout', depth: 1, text: 'Charge' },
  { view: 'checkout-shop', choice: 'checkout', depth: 1, text: 'Shop' },
  { view: 'howto-overview', choice: 'howto', depth: 0, text: 'How billing works' },
];
// The panel's whole structure in document order (headings, choices, entries), as `heading:<kind>`, `choice:<id>`, `entry:<view>`.
export const FOUR_PANEL_STRUCTURE = ['choice:system', 'entry:overview', 'entry:back-end-inside', 'entry:orders-inside', 'entry:appendix',
  'heading:section', 'choice:server', 'entry:server-overview', 'heading:flow', 'choice:checkout', 'entry:checkout-overview', 'entry:checkout-charge', 'entry:checkout-shop',
  'heading:custom', 'choice:howto', 'entry:howto-overview'];

// ---------------------------------------------------------------------------------------------------------------
// The scan and the draw run of several choices.
// ---------------------------------------------------------------------------------------------------------------
export type ChoiceReq = { kind: 'whole' } | { kind: 'option'; option: string } | { kind: 'typed'; text: string };
export const WHOLE: ChoiceReq = { kind: 'whole' };
export const option = (id: string): ChoiceReq => ({ kind: 'option', option: id });
export const typed = (text: string): ChoiceReq => ({ kind: 'typed', text });
// The fixture scan's options of the shared project (testing contract, Scan): o1 a flow, o2 and o3 sections; the fourth is left out.
export const OPTIONS = {
  o1: { kind: 'flow', title: 'How a request moves through the project', sentence: 'Follows one request from the entry point to the store.', files: ['alpha.ts', 'beta.ts'] },
  o2: { kind: 'section', title: 'The agent loop', sentence: 'How the agent proposes and runs a tool.', files: ['gamma.ts'] },
  o3: { kind: 'section', title: 'The server side', sentence: 'The code that serves requests and keeps state.', files: ['alpha.ts'] },
} as const;
// api contract, *The draw run*: a slug is the text lower-cased, accents removed, every run of other characters one `-`, cut to 40, trimmed.
export const choiceSlug = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'choice';
export const SLUG = { o1: choiceSlug(OPTIONS.o1.title), o2: choiceSlug(OPTIONS.o2.title), o3: choiceSlug(OPTIONS.o3.title) };
export const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found',
  'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped',
  'Dropped "ghost-limit": its component "ghost" was dropped',
];
export const MECHANISMS = ['model-call', 'tool-proposal', 'tool-check', 'tool-run', 'tool-result'];
export const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];
export const CHANNEL_LINE: Record<string, string> = { linkedin: 'Drawing the LinkedIn post', readme: 'Drawing the README drawing', presentation: 'Drawing the presentation' };
export const CHANNEL_REUSED: Record<string, string> = { linkedin: 'Using the LinkedIn post already drawn', readme: 'Using the README drawing already drawn', presentation: 'Using the presentation already drawn' };

export async function startDrawChoices(request: APIRequestContext, auth: string, scan: string, choices: ChoiceReq[], channel: string, extra: Record<string, unknown> = {}, base = baseURL()) {
  return await startKind(request, auth, { kind: 'draw', scan, choices, channel, engine: 'fixture', model: null, ...extra }, base);
}
// A draw request the server must refuse: the status and the sentence.
export async function refusedChoices(request: APIRequestContext, auth: string, data: Record<string, unknown>, base = baseURL()) {
  const answer = await postJSON(request, auth, '/api/runs', { kind: 'draw', engine: 'fixture', model: null, ...data }, base);
  return { status: answer.status as number, error: (answer.body?.error ?? '') as string };
}
export interface RunChoice { id: string; kind: string; title: string; status: string; stage: string | null }
export async function runRecord(request: APIRequestContext, runId: string, base = baseURL()): Promise<any> {
  const response = await request.get(`${base}/api/runs/${runId}`); expect(response.status()).toBe(200); return await response.json();
}
// Scan the folder, draw the choices, wait for the run to end in `status`: the scan, the run id and the finished record.
export async function drawChoices(request: APIRequestContext, auth: string, folder: string, choices: ChoiceReq[], channel = 'linkedin', opts: { status?: string; extra?: Record<string, unknown>; scan?: string } = {}, base = baseURL()) {
  const scan = opts.scan ? { id: opts.scan } as { id: string } : await scanFolder(request, auth, folder, {}, base);
  const runId = await startDrawChoices(request, auth, scan.id, choices, channel, opts.extra ?? {}, base);
  return { scan, runId, run: await finishRun(request, runId, opts.status ?? 'succeeded', 180_000, base) };
}
type Event = { event: string; data: any };
export const progressOf = (events: Event[], choice?: string) => events.filter(e => e.event === 'progress' && (choice === undefined || e.data.choice === choice));
export const messagesOf = (events: Event[], choice?: string, stage?: string) => progressOf(events, choice).filter(e => !stage || e.data.stage === stage).map(e => String(e.data.message));
export const choiceStates = (run: { choices: RunChoice[] | null }) => (run.choices ?? []).map(c => `${c.id}:${c.status}`);

// ---------------------------------------------------------------------------------------------------------------
// The home screen: the scan, the checkboxes and the rows of a running draw.
// ---------------------------------------------------------------------------------------------------------------
export async function scanThroughHome(page: Page, folder: string, base = '') {
  await page.goto(`${base}/`); await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start-folder').fill(folder); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('focus-list')).toBeVisible();
}
export const optionBox = (page: Page, id: string) => page.locator(`[data-testid="focus-option"][data-option="${id}"]`);
// The control inside a choice (the element itself, or the input it holds) and what kind it is.
export async function controlOf(locator: Locator): Promise<{ type: string | null; role: string | null }> {
  return await locator.evaluate(el => {
    const input = (el.matches('input') ? el : el.querySelector('input')) as HTMLInputElement | null;
    return { type: input ? input.type : null, role: input ? input.getAttribute('role') : el.getAttribute('role') };
  });
}
export async function isCheckbox(locator: Locator) { const c = await controlOf(locator); return c.type === 'checkbox' || c.role === 'checkbox'; }
export async function isRadio(locator: Locator) { const c = await controlOf(locator); return c.type === 'radio' || c.role === 'radio'; }
// The order of the four parts of `focus-list` in the document.
export async function focusListOrder(page: Page) {
  return await page.getByTestId('focus-list').evaluate(list => {
    const ids = ['focus-whole', 'focus-sections', 'focus-flows', 'focus-typed'];
    const found = ids.map(id => ({ id, el: list.querySelector(`[data-testid="${id}"]`) })).filter(x => x.el);
    return found.sort((a, b) => (a.el!.compareDocumentPosition(b.el!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map(x => x.id);
  });
}
// The `data-option` and `data-kind` of every `focus-option`, in the document's order.
export async function optionsOnScreen(page: Page) {
  return await page.getByTestId('focus-option').evaluateAll(els => els.map(el => [el.getAttribute('data-option'), el.getAttribute('data-kind')]));
}
export interface DrawRow { choice: string | null; kind: string | null; state: string | null; title: string; stages: { stage: string | null; state: string | null; text: string }[] }
export async function drawRows(page: Page): Promise<DrawRow[]> {
  return await page.getByTestId('draw-choice').evaluateAll(rows => rows.map(row => ({
    choice: row.getAttribute('data-choice'), kind: row.getAttribute('data-kind'), state: row.getAttribute('data-state'),
    title: (row.querySelector('[data-testid="draw-choice-title"]')?.textContent ?? '').trim(),
    stages: Array.from(row.querySelectorAll('[data-testid="draw-stage"]')).map(s => ({ stage: s.getAttribute('data-stage'), state: s.getAttribute('data-state'), text: (s.textContent ?? '').trim() })),
  })));
}
export const rowStates = (rows: DrawRow[]) => rows.map(r => `${r.choice}:${r.state}`);
// Every distinct state of the rows and of `draw-line` from now on (a draw's rows change fast): one string per change,
// `<choice>:<state>:<stage>=<state>,… | … || <the latest line>`.
export async function recordDrawRows(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = ((window as any).__drawRows = []);
    const look = () => {
      const rows = Array.from(document.querySelectorAll('[data-testid="draw-choice"]')).map(row => `${row.getAttribute('data-choice')}:${row.getAttribute('data-state')}:`
        + Array.from(row.querySelectorAll('[data-testid="draw-stage"]')).map(s => `${s.getAttribute('data-stage')}=${s.getAttribute('data-state')}`).join(','));
      const line = `${rows.join(' | ')} || ${(document.querySelector('[data-testid="draw-line"]')?.textContent ?? '').trim()}`;
      if (rows.length && seen[seen.length - 1] !== line) seen.push(line);
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); look();
  });
}
export interface RowSnapshot { rows: { choice: string; state: string; stages: string[]; stageNames: string[] }[]; line: string }
export async function recordedRows(page: Page): Promise<RowSnapshot[]> {
  const raw = await page.evaluate(() => [...(((window as any).__drawRows as string[]) ?? [])]);
  return raw.map(entry => {
    const [rows, ...rest] = entry.split(' || ');
    return { line: rest.join(' || '), rows: rows.split(' | ').map(r => {
      const [choice, state, ...more] = r.split(':'); const stages = more.join(':').split(',').map(s => s.split('='));
      return { choice, state, stageNames: stages.map(s => s[0]), stages: stages.map(s => s[1]) };
    }) };
  });
}
// The invariants of a draw screen: a choice runs or is done only when every choice before it is done, only one runs at a time, and
// within a choice a stage runs or is done only when every stage before it is done.
export function rowsAreInOrder(snapshots: RowSnapshot[]) {
  const problems: string[] = [];
  for (const { rows } of snapshots) {
    const states = rows.map(r => r.state);
    states.forEach((s, j) => { if (s === 'running' || s === 'done') for (let i = 0; i < j; i++) if (states[i] !== 'done') problems.push(`choice ${j + 1} is ${s} while choice ${i + 1} is ${states[i]}: ${states.join(',')}`); });
    if (states.filter(s => s === 'running').length > 1) problems.push(`two choices run: ${states.join(',')}`);
    for (const row of rows) row.stages.forEach((s, k) => { if (s === 'running' || s === 'done') for (let i = 0; i < k; i++) if (row.stages[i] !== 'done') problems.push(`${row.choice}: stage ${k + 1} is ${s} while stage ${i + 1} is ${row.stages[i]}`); });
  }
  return problems;
}
// Every `/api/` POST of the page, with its parsed body.
export function watchPosts(page: Page) {
  const posts: { path: string; body: any }[] = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { let body: any = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; } posts.push({ path: url.pathname, body }); }
  });
  return posts;
}
// The state of the focused element: its test id, and its `data-option` when it has one.
export async function focusedChoice(page: Page) {
  return await page.evaluate(() => {
    const el = document.activeElement?.closest('[data-testid]') as HTMLElement | null;
    return el ? `${el.getAttribute('data-testid')}${el.getAttribute('data-option') ? `:${el.getAttribute('data-option')}` : ''}` : null;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The editor: choices, the views panel, a part with an inside.
// ---------------------------------------------------------------------------------------------------------------
export async function where(page: Page) {
  const editor = page.getByTestId('editor');
  return { choice: await editor.getAttribute('data-choice'), channel: await editor.getAttribute('data-channel'), view: await editor.getAttribute('data-view') };
}
export interface PanelEntry { view: string; choice: string; depth: number; text: string; current: boolean; testId: string; tag: string }
export async function panelEntries(page: Page): Promise<PanelEntry[]> {
  return await page.getByTestId('views-panel').locator('[data-testid^="views-entry-"]').evaluateAll(els => els.map(el => ({
    view: el.getAttribute('data-view') ?? '', choice: el.getAttribute('data-choice') ?? '', depth: Number(el.getAttribute('data-depth')),
    text: (el.textContent ?? '').trim(), current: el.getAttribute('aria-current') === 'true', testId: el.getAttribute('data-testid') ?? '', tag: el.tagName.toLowerCase(),
  })));
}
export async function panelStructure(page: Page): Promise<string[]> {
  return await page.getByTestId('views-panel').evaluate(panel => Array.from(panel.querySelectorAll('[data-testid^="views-heading-"], [data-testid^="views-choice-"], [data-testid^="views-entry-"]')).map(el => {
    const id = el.getAttribute('data-testid')!;
    return id.startsWith('views-heading-') ? `heading:${id.slice('views-heading-'.length)}` : id.startsWith('views-choice-') ? `choice:${id.slice('views-choice-'.length)}` : `entry:${el.getAttribute('data-view')}`;
  }));
}
// The whole panel reduced to what the contract fixes, for comparing with `FOUR_PANEL`.
export const panelRows = (entries: PanelEntry[]) => entries.map(e => ({ view: e.view, choice: e.choice, depth: e.depth, text: e.text }));
// The part's open mark and what it says about the part, in the editor.
export async function openState(page: Page, id: string) {
  return await page.getByTestId(`node-${id}`).evaluate((el, pid) => {
    const mark = el.querySelector('[data-testid="node-inside"]') ?? document.querySelector(`[data-testid="node-head-${pid}"] [data-testid="node-inside"]`);
    return { open: el.getAttribute('data-open'), mark: !!mark, markClass: mark?.getAttribute('class') ?? '', selected: el.getAttribute('data-selected'),
      tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), label: el.getAttribute('aria-label') };
  }, id);
}
// A click on a place with no movement between press and release (Playwright's click is exactly that).
export async function plainClick(page: Page, locator: Locator, offset?: { x: number; y: number }) {
  const b = await locator.boundingBox(); expect(b).not.toBeNull();
  const x = b!.x + (offset?.x ?? b!.width / 2), y = b!.y + (offset?.y ?? b!.height / 2);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
}
// A drag with a press, `steps` moves and a release; returns nothing.
export async function dragBy(page: Page, locator: Locator, dx: number, dy: number, steps = 8) {
  const b = await locator.boundingBox(); expect(b).not.toBeNull();
  const x = b!.x + b!.width / 2, y = b!.y + Math.min(b!.height / 2, 24);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps }); await page.mouse.up();
}
export async function nodeBox(page: Page, id: string) { const b = await page.getByTestId(`node-${id}`).boundingBox(); expect(b).not.toBeNull(); return b!; }
export async function openFourChoices(page: Page, request: APIRequestContext, file: string, base = baseURL()) {
  const auth = await token(request, base);
  const response = await request.post(`${base}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: file } });
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json() as { id: string; url: string };
  await page.goto(new URL(result.url, base).href); await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('save-status')).toHaveText('Saved');
  return { ...result, token: auth };
}

// ---------------------------------------------------------------------------------------------------------------
// Images: the open mark and the choice an export draws.
// ---------------------------------------------------------------------------------------------------------------
export async function svgOpenInfo(page: Page, svg: string) {
  return await page.evaluate(text => {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const marks = (el: Element) => el.querySelectorAll('[class~="open-mark"]').length;
    return {
      error: !!xml.querySelector('parsererror'),
      nodes: Array.from(xml.querySelectorAll('g[data-node-id]')).map(g => ({ id: g.getAttribute('data-node-id') ?? '', open: g.getAttribute('data-open'), marks: marks(g) })),
      heads: Array.from(xml.querySelectorAll('g[data-group-head]')).map(g => ({ id: g.getAttribute('data-group-head') ?? '', marks: marks(g) })),
      nodeIds: Array.from(xml.querySelectorAll('g[data-node-id]')).map(g => g.getAttribute('data-node-id') ?? ''),
      edgeIds: Array.from(xml.querySelectorAll('g[data-edge-id]')).map(g => g.getAttribute('data-edge-id') ?? ''),
      text: Array.from(xml.querySelectorAll('text')).map(t => t.textContent ?? ''),
    };
  }, svg);
}
export async function exportText(request: APIRequestContext, id: string, kind: 'svg' | 'mmd', query = '', base = baseURL()) {
  const response = await request.get(`${base}/api/diagrams/${id}/export.${kind}${query ? `?${query}` : ''}`);
  return { status: response.status(), body: await response.text() };
}
export async function exportError(request: APIRequestContext, id: string, kind: 'svg' | 'mmd', query: string, base = baseURL()) {
  const response = await request.get(`${base}/api/diagrams/${id}/export.${kind}?${query}`);
  let error = ''; try { error = (await response.json()).error ?? ''; } catch { error = ''; }
  return { status: response.status(), error };
}
export const near = (a: number, b: number, by = 0.6) => Math.abs(a - b) <= by;

// What a document draws, in a comparable form: facts, relations, and per channel its marks, steps and views with their parts' places. Used
// to say that a conversion lost nothing; defaults a conversion may add (a null lane, an empty list) are not part of it.
export function signature(doc: Doc3, places = true) {
  return {
    facts: doc.facts.components.map(f => [f.id, f.label, f.kind, f.sub, f.description, f.files, f.items, f.within ?? null]),
    relations: (doc.facts.relations ?? []).map(r => [r.id, r.from, r.to, r.label, r.style, r.both]),
    limits: (doc.facts.limits ?? []).map(l => [l.id, l.on, l.text]),
    channels: Object.fromEntries(Object.entries(doc.channels).map(([name, c]) => [name, {
      showSteps: c.showSteps ?? false, outdated: c.outdated ?? [], steps: c.steps ?? [],
      views: (c.views ?? []).map(v => ({ id: v.id, title: v.title, caption: v.caption, subLines: (v as { subLines?: boolean }).subLines ?? true, texts: v.texts ?? [],
        nodes: v.nodes.map(n => [n.id, n.facts, n.form, n.icon, n.parent, n.detail, places ? n.x ?? null : 0, places ? n.y ?? null : 0, n.held ?? [], n.limits ?? []]),
        edges: v.edges.map(e => [e.id ?? null, e.from, e.to, e.relations ?? [], e.step]) })),
    }])),
  };
}
// Gives every part of every view a stored place (a grid of 420 × 220), so a drawing needs no layout and draws the same wherever it is read.
export function stampPositions<T extends Doc3 | Choice4>(doc: T): T {
  for (const c of Object.values(doc.channels)) for (const v of c?.views ?? []) v.nodes.forEach((n, i) => { n.x = (i % 3) * 420; n.y = Math.floor(i / 3) * 220; });
  return doc;
}

// A draw's parts in the shape the older helpers read: the choice's own Doc3 view of a drawn file, by choice id.
export function choiceOf(doc: Doc4, id: string): Choice4 {
  const found = doc.choices.find(c => c.id === id); if (!found) throw new Error(`No choice ${id}: ${doc.choices.map(c => c.id).join(', ')}`); return found;
}
export type { Fact };
