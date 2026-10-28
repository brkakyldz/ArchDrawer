// Test-owned helpers for the held-out suite. Written from the contracts alone: nothing here imports the product, and nothing mocks it.
// Every wait is on a state a contract names (an auto-retrying assertion or `expect.poll`), never on a clock.
import { expect, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { root, type Product } from './server';

export { root };

// ---------------------------------------------------------------------------------------------------------------
// Paths and folders
// ---------------------------------------------------------------------------------------------------------------
export async function tempDir(tag: string) { return await realpath(await mkdtemp(join(tmpdir(), `archdrawer-${tag}-`))); }
export async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
export async function listDir(path: string) { try { return await readdir(path); } catch { return []; } }
// A path as the system means it: resolved, real, with one kind of separator, and in one case where the disk ignores case.
export async function canonical(path: string) {
  let p = resolvePath(path);
  try { p = await realpath(p); } catch { /* not on disk: compare as resolved */ }
  p = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
}
export async function expectSamePath(actual: string | null | undefined, expected: string, what: string) {
  expect(actual, what).toBeTruthy();
  expect(await canonical(actual!), what).toBe(await canonical(expected));
}
export async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, 'utf8');
  }
}
export async function writeJSON(file: string, value: unknown) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
export async function readJSON(file: string): Promise<any> { return JSON.parse(await readFile(file, 'utf8')); }
export async function readText(file: string) { return await readFile(file, 'utf8'); }
// A session's edit of a drawing file: written aside, then renamed into place (the contracted way a file changes outside the editor).
export async function outsideWrite(file: string, value: unknown) { const next = `${file}.session.tmp`; await writeJSON(next, value); await rename(next, file); }

// ---------------------------------------------------------------------------------------------------------------
// Git repositories (git is on PATH where the suite runs; testing contract, *Test links*)
// ---------------------------------------------------------------------------------------------------------------
export function git(cwd: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile('git', ['-c', 'user.name=Holdout', '-c', 'user.email=holdout@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
      { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
      (error, stdout, stderr) => error ? reject(new Error(`git ${args.join(' ')}: ${stderr || error.message}`)) : resolve(stdout));
  });
}
const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} line ${i + 1}`).join('\n') + '\n';
// The project scanned and drawn throughout. Its listing, in sorted order, starts alpha.ts, beta.ts, gamma.ts: the fixture's files A and B
// are alpha.ts and beta.ts, and its third file is gamma.ts (testing contract, *Scan*, *Draw*).
export const projectFiles: Record<string, string> = {
  'alpha.ts': sixLines('alpha'), 'beta.ts': sixLines('beta'), 'gamma.ts': sixLines('gamma'), 'main.ts': sixLines('main'),
  'package.json': '{\n  "name": "holdout-project",\n  "main": "main.ts"\n}\n', 'readme.md': '# Holdout project\n\nA project for the scan.\n',
};
export interface Repo { dir: string; git(args: string[]): Promise<string>; head(): Promise<string>; commit(files: Record<string, string>, message?: string): Promise<string> }
function repoAt(dir: string): Repo {
  return {
    dir, git: args => git(dir, args), head: async () => (await git(dir, ['rev-parse', 'HEAD'])).trim(),
    commit: async (files, message = 'next commit') => {
      await writeFiles(dir, files); await git(dir, ['add', '--all']); await git(dir, ['commit', '-q', '-m', message]);
      return (await git(dir, ['rev-parse', 'HEAD'])).trim();
    },
  };
}
// A repository with one commit holding `files`, in a fresh temp folder (named `name` inside it when given).
export async function gitRepo(tag: string, files: Record<string, string> = projectFiles, name?: string): Promise<Repo> {
  const parent = await tempDir(tag), dir = name ? join(parent, name) : parent;
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']); await writeFiles(dir, files);
  await git(dir, ['add', '--all']); await git(dir, ['commit', '-q', '-m', 'first commit']);
  return repoAt(dir);
}
// A remote for a test link: `<ARCHDRAW_TEST_REMOTES>/<host>/<owner>/<repo>`, parts lower-cased, with a commit on `main` (its HEAD), and
// optionally another branch with one more commit (testing contract, *Test links*).
export async function makeRemote(product: Product, link: string, files: Record<string, string> = projectFiles, opts: { branch?: string; branchFiles?: Record<string, string> } = {}) {
  const dir = join(product.remotes, ...link.toLowerCase().split('/'));
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']); await writeFiles(dir, files);
  await git(dir, ['add', '--all']); await git(dir, ['commit', '-q', '-m', 'first commit']);
  const repo = repoAt(dir);
  if (opts.branch) {
    await git(dir, ['checkout', '-q', '-b', opts.branch]);
    await repo.commit(opts.branchFiles ?? { 'branch-only.ts': sixLines('branch') }, `work on ${opts.branch}`);
    await git(dir, ['checkout', '-q', 'main']);
  }
  return repo;
}
// A folder that is not in git at all.
export async function plainFolder(tag: string, files: Record<string, string> = projectFiles) { const dir = await tempDir(tag); await writeFiles(dir, files); return dir; }
export const copyFolder = (product: Product, link: string) => join(product.data, 'repos', ...link.toLowerCase().split('/'));
export const partialFolder = (product: Product) => join(product.data, 'repos', '.partial');

// ---------------------------------------------------------------------------------------------------------------
// Drawing documents (drawing contract, *Shape*; testing contract, *A minimal valid file*)
// ---------------------------------------------------------------------------------------------------------------
export const KINDS = ['actor', 'client', 'api', 'service', 'worker', 'llm', 'external', 'ops', 'gate', 'data'] as const;
export const SHAPE_OF: Record<string, string> = {
  actor: 'person', client: 'window', api: 'port', service: 'card', worker: 'stack', llm: 'agent', external: 'external', ops: 'pulse', gate: 'check', data: 'store',
};
export function comp(id: string, label: string, kind = 'service', extra: Record<string, unknown> = {}) {
  return { id, label, kind, sub: '', description: `${label} does its part.`, files: [] as string[], items: [] as string[], ...extra };
}
export function rel(id: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  return { id, from, to, label: '', style: 'call', both: false, ...extra };
}
export function part(id: string, extra: Record<string, unknown> = {}) {
  return { id, facts: [id], form: 'card', icon: null, parent: null, detail: null, place: null, ...extra } as Record<string, any>;
}
export function link(from: string, to: string, relations: string[], step: number | null = null, extra: Record<string, unknown> = {}) {
  return { from, to, relations, step, ...extra } as Record<string, any>;
}
export function view(id: string, title: string, nodes: any[], edges: any[], extra: Record<string, unknown> = {}) {
  return { id, title, caption: { title, lede: '' }, nodes, edges, ...extra } as Record<string, any>;
}
export function choice(id: string, title: string, kind: string, facts: { components: any[]; relations?: any[]; limits?: any[] }, overview: any[], extra: Record<string, unknown> = {}) {
  return { id, title, kind, about: '', facts: { relations: [], limits: [], ...facts }, channels: { overview: { views: overview, showSteps: false, outdated: [] } }, ...extra } as Record<string, any>;
}
export function doc(title: string, choices: any[], extra: Record<string, unknown> = {}) {
  return { schema: 'archdraw/diagram@4', title, choices, ...extra } as Record<string, any>;
}
// The testing contract's Sample Shop, as one `system` choice of a format 4 file, its parts in a row and a column.
export function shopDoc(title = 'Sample Shop') {
  return doc(title, [choice('system', 'The whole system', 'system', {
    components: [
      comp('web', 'Web app', 'client', { sub: 'React', description: "The shop's pages.", files: ['src/web.ts'] }),
      comp('api', 'Order API', 'api', { description: 'Takes orders.', files: ['src/api.ts'], items: ['Validate order', 'Create order'] }),
      comp('db', 'Orders DB', 'data', { sub: 'Postgres', description: 'Keeps orders.', files: ['src/db.ts'] }),
    ],
    relations: [rel('r1', 'web', 'api', { label: 'POST /orders', both: true }), rel('r2', 'api', 'db')],
  }, [view('overview', 'Overview', [
    part('web', { place: { row: 0, col: 0 } }),
    part('api', { form: 'panel', place: { row: 0, col: 1 } }),
    part('db', { place: { row: 1, col: 1 } }),
  ], [link('web', 'api', ['r1'], 1), link('api', 'db', ['r2'], 2)], { caption: { title: `How an order flows through ${title}`, lede: '' } })])]);
}
export const repoFiles: Record<string, string> = {
  'src/web.ts': '// web\n', 'src/api.ts': '// api\n', 'src/db.ts': '// db\n', 'src/extra.ts': '// extra\n', 'readme.md': '# Shop\n',
};
// A repository holding a drawing file at `<repo>/<name>` (not committed, as a session writes it).
export async function drawingRepo(tag: string, document: unknown, name = 'architecture.archdraw.json', files: Record<string, string> = repoFiles) {
  const repo = await gitRepo(tag, files); const file = join(repo.dir, name); await writeJSON(file, document);
  return { repo, dir: repo.dir, file };
}
export const choiceOf = (document: any, id?: string) => id ? document.choices.find((c: any) => c.id === id) : document.choices[0];
export const viewOf = (document: any, channel = 'overview', viewId?: string, choiceId?: string) => {
  const views = choiceOf(document, choiceId)?.channels?.[channel]?.views ?? [];
  return viewId ? views.find((v: any) => v.id === viewId) : views[0];
};
export const nodeOf = (v: any, id: string) => v?.nodes?.find((n: any) => n.id === id);

// ---------------------------------------------------------------------------------------------------------------
// The API (api contract)
// ---------------------------------------------------------------------------------------------------------------
export async function register(product: Product, file: string) {
  const answer = await product.post('/api/files', { path: file });
  expect(answer.status, answer.text).toBe(200); return answer.body as { id: string; url: string };
}
export async function stored(product: Product, id: string) {
  const answer = await product.get(`/api/diagrams/${id}`); expect(answer.status, answer.text).toBe(200); return answer.body;
}
export async function library(product: Product) {
  const answer = await product.get('/api/diagrams'); expect(answer.status).toBe(200);
  return answer.body.diagrams as { id: string; title: string; path: string | null; root: string | null; link: string | null; updatedAt: string }[];
}
export async function exportSvg(product: Product, id: string, query = '') {
  const response = await fetch(`${product.base}/api/diagrams/${id}/export.svg${query ? `?${query}` : ''}`);
  expect(response.status, `export.svg?${query}`).toBe(200); return await response.text();
}
export const WHOLE = { kind: 'whole' };
export const option = (id: string) => ({ kind: 'option', option: id });
export const typed = (text: string) => ({ kind: 'typed', text });
// The fixture scan's options of `projectFiles` (testing contract, *Scan*), and the ids a draw gives them (api contract, *The choices*).
export const OPTION = {
  o1: { kind: 'flow', title: 'How a request moves through the project', id: 'how-a-request-moves-through-the-project' },
  o2: { kind: 'section', title: 'The agent loop', id: 'the-agent-loop' },
  o3: { kind: 'section', title: 'The server side', id: 'the-server-side' },
} as const;
export const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];
export async function startScan(product: Product, target: { folder?: string; link?: string }, extra: Record<string, unknown> = {}) {
  const answer = await product.post('/api/scans', { engine: 'fixture', model: null, ...target, ...extra });
  expect(answer.status, answer.text).toBe(202); return answer.body.scanId as string;
}
export async function scanRecord(product: Product, id: string) { const a = await product.get(`/api/scans/${id}`); expect(a.status, a.text).toBe(200); return a.body; }
export async function runRecord(product: Product, id: string) { const a = await product.get(`/api/runs/${id}`); expect(a.status, a.text).toBe(200); return a.body; }
export async function waitScan(product: Product, id: string, status = 'succeeded', timeout = 90_000) {
  await expect.poll(async () => (await scanRecord(product, id)).status, { timeout, message: `scan ${id} ends` }).not.toBe('running');
  const record = await scanRecord(product, id);
  expect(record.status, JSON.stringify({ error: record.error, progress: record.progress })).toBe(status); return record;
}
export async function scan(product: Product, target: { folder?: string; link?: string }, extra: Record<string, unknown> = {}) {
  return await waitScan(product, await startScan(product, target, extra));
}
export async function startDraw(product: Product, scanId: string, choices: unknown[], channel: string, extra: Record<string, unknown> = {}) {
  const answer = await product.post('/api/runs', { kind: 'draw', scan: scanId, choices, channel, engine: 'fixture', model: null, ...extra });
  expect(answer.status, answer.text).toBe(202); return answer.body.runId as string;
}
export async function waitRun(product: Product, id: string, status = 'succeeded', timeout = 180_000) {
  await expect.poll(async () => (await runRecord(product, id)).status, { timeout, message: `run ${id} ends` }).not.toBe('running');
  const record = await runRecord(product, id);
  expect(record.status, JSON.stringify({ error: record.error, choices: record.choices?.map((c: any) => `${c.id}:${c.status}:${c.error ?? ''}`) })).toBe(status);
  return record;
}
export async function activity(product: Product) { const a = await product.get('/api/activity'); expect(a.status).toBe(200); return a.body; }
export const states = (record: any) => (record.choices as any[]).map(c => `${c.id}:${c.status}`);

// Event streams (api contract: past events replayed, then new ones, then exactly one `done`).
export interface Ev { event: string; data: any }
export interface Stream { events: Ev[]; stop(): void; closed: Promise<void> }
export function watchStream(product: Product, path: string): Stream {
  const controller = new AbortController(), events: Ev[] = [];
  const closed = (async () => {
    try {
      const response = await fetch(`${product.base}${path}`, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
      if (response.status !== 200) { events.push({ event: 'http', data: { status: response.status } }); return; }
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
          if (data.length) events.push({ event, data: JSON.parse(data.join('\n')) });
          if (event === 'done') { controller.abort(); return; }
        }
      }
    } catch { /* aborted, or the server went away */ }
  })();
  return { events, stop: () => controller.abort(), closed };
}
// The whole stream of a job up to its `done`.
export async function eventsOf(product: Product, path: string, timeout = 180_000): Promise<Ev[]> {
  const stream = watchStream(product, path);
  try {
    await expect.poll(() => stream.events.some(e => e.event === 'done' || e.event === 'http'), { timeout, message: `the done event of ${path}` }).toBe(true);
  } finally { stream.stop(); }
  return [...stream.events];
}
export const runEvents = (product: Product, id: string, timeout?: number) => eventsOf(product, `/api/runs/${id}/events`, timeout);
export const scanEvents = (product: Product, id: string, timeout?: number) => eventsOf(product, `/api/scans/${id}/events`, timeout);
// A progress line is text the user reads: a scenario looks for its key words, never the whole sentence.
export const says = (list: string[], words: RegExp) => list.some(l => words.test(l));
export const saying = (list: string[], words: RegExp) => list.filter(l => words.test(l)).length;
// The progress lines an engine call wrote (`source: "engine"`): none means no engine call was made.
export const engineLines = (events: Ev[], choiceId?: string, stage?: string) => events
  .filter(e => e.event === 'progress' && e.data.source === 'engine' && (choiceId === undefined || e.data.choice === choiceId) && (stage === undefined || e.data.stage === stage));
export const lines = (events: Ev[], choiceId?: string, stage?: string) => events
  .filter(e => e.event === 'progress' && (choiceId === undefined || e.data.choice === choiceId) && (stage === undefined || e.data.stage === stage))
  .map(e => String(e.data.message));

// ---------------------------------------------------------------------------------------------------------------
// The command line (cli contract), against the scenario's own product
// ---------------------------------------------------------------------------------------------------------------
export async function cli(product: Product, args: string[], overrides: Record<string, string> = {}) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [join(root, 'bin', 'archdrawer.mjs'), ...args],
      { cwd: root, env: { ...product.env, ...overrides }, shell: false, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof (error as any).code !== 'number') return reject(error);
        resolve({ code: error ? Number((error as any).code) : 0, stdout, stderr });
      });
  });
}
export const outLines = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------
// The home screen (ui contract, *Home*)
// ---------------------------------------------------------------------------------------------------------------
export async function home(page: Page, product: Product) {
  await page.goto(`${product.base}/`); await expect(page.getByTestId('start')).toBeVisible();
}
export async function scanOnHome(page: Page, product: Product, folder: string) {
  await home(page, product);
  await page.getByTestId('start-folder').fill(folder);
  await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('focus-list')).toBeVisible();
}
export const optionCard = (page: Page, id: string) => page.locator(`[data-testid="focus-option"][data-option="${id}"]`);
export async function tick(page: Page, picks: { whole?: boolean; options?: string[]; typed?: string }, channel?: 'linkedin' | 'readme') {
  if (picks.whole) await page.getByTestId('focus-whole').click();
  for (const id of picks.options ?? []) await optionCard(page, id).click();
  if (picks.typed !== undefined) { await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(picks.typed); }
  if (channel) await page.getByTestId(`channel-choice-${channel}`).click();
}
// The answer to the request a click sends (the click and the request are the user's; the answer is the server's).
export async function answerTo(page: Page, method: string, path: RegExp, trigger: () => Promise<unknown>, timeout = 30_000) {
  const waiting = page.waitForResponse(r => r.request().method() === method && path.test(new URL(r.url()).pathname), { timeout });
  await trigger(); const response = await waiting;
  let body: any = null; try { body = await response.json(); } catch { body = null; }
  let sent: any = null; try { sent = response.request().postDataJSON(); } catch { sent = null; }
  return { status: response.status(), body, sent, path: new URL(response.url()).pathname };
}
export async function startedRun(page: Page, trigger: () => Promise<unknown>) {
  const answer = await answerTo(page, 'POST', /^\/api\/runs$/, trigger);
  expect(answer.status, JSON.stringify(answer.body)).toBe(202); return { runId: answer.body.runId as string, sent: answer.sent };
}
export interface Row { choice: string; kind: string; state: string; stages: { stage: string; state: string }[] }
export async function rows(page: Page): Promise<Row[]> {
  return await page.getByTestId('draw-choice').evaluateAll(els => els.map(row => ({
    choice: row.getAttribute('data-choice') ?? '', kind: row.getAttribute('data-kind') ?? '', state: row.getAttribute('data-state') ?? '',
    stages: Array.from(row.querySelectorAll('[data-testid="draw-stage"]')).map(s => ({ stage: s.getAttribute('data-stage') ?? '', state: s.getAttribute('data-state') ?? '' })),
  })));
}
export const rowStates = async (page: Page) => (await rows(page)).map(r => `${r.choice}:${r.state}`);
export const rowOf = (page: Page, choiceId: string) => page.locator(`[data-testid="draw-choice"][data-choice="${choiceId}"]`);

// ---------------------------------------------------------------------------------------------------------------
// The editor (ui contract, *Editor frame*, *Drawing*)
// ---------------------------------------------------------------------------------------------------------------
export async function saved(page: Page) { await expect(page.getByTestId('save-status')).toHaveText(/^\s*Saved\s*$/); }
export async function openDrawing(page: Page, product: Product, file: string, query = '') {
  const registered = await register(product, file);
  await page.goto(`${product.base}/d/${registered.id}${query}`);
  await expect(page.getByTestId('editor')).toBeVisible(); await saved(page);
  return registered.id;
}
export async function box(locator: Locator) { const b = await locator.boundingBox(); expect(b, 'the element is drawn').not.toBeNull(); return b!; }
export async function drag(page: Page, locator: Locator, dx: number, dy: number, steps = 10) {
  const b = await box(locator), x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 24);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps }); await page.mouse.up();
}
export async function openAi(page: Page) {
  if (!await page.getByTestId('ai-panel').isVisible()) await page.getByTestId('ai-button').click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
}
export async function send(page: Page, text: string) {
  await openAi(page);
  return await startedRun(page, async () => { await page.getByTestId('ai-input').fill(text); await page.getByTestId('ai-send').click(); });
}
export const turn = (page: Page, runId: string) => page.locator(`[data-testid="ai-turn"][data-run-id="${runId}"]`);
// The conversation lives in the AI panel, so it is opened first: a run started from a channel stage is a turn there too.
export async function turnEnds(page: Page, runId: string, timeout = 90_000) {
  await openAi(page);
  await expect(turn(page, runId)).toHaveCount(1, { timeout });
  await expect(turn(page, runId)).not.toHaveAttribute('data-state', 'running', { timeout });
  return (await turn(page, runId).getAttribute('data-state'))!;
}
export const PAUSED = /paused while the instruction runs/i;
export const ACCEPT_FIRST = /accept or undo/i;

// ---------------------------------------------------------------------------------------------------------------
// Geometry: what the editor draws against what an export draws (AGENTS.md invariant 5)
// ---------------------------------------------------------------------------------------------------------------
export interface Point { x: number; y: number }
export interface Box { left: number; right: number; top: number; bottom: number }
export interface Drawn {
  nodes: Record<string, Box>;
  edges: Record<string, { p: Point[] | null; d: string; tone: string | null; hidden: boolean }>;
  trunks: Record<string, Point[] | null>;
}
// Every part's box and every connection's cubic on a surface (the editor's canvas or an exported SVG on a page), in drawing px measured
// from the top-left of the `anchor` part, so two surfaces drawn at different zooms and offsets compare number for number.
export async function drawn(surface: Locator, anchor: string): Promise<Drawn> {
  return await surface.evaluate((element, anchorId) => {
    const rootSvg = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const nodeSelector = 'g[data-node-id], [data-testid^="node-"][data-kind]';
    const idOf = (g: Element) => g.getAttribute('data-node-id') ?? (g.getAttribute('data-testid') ?? '').slice(5);
    const corners = (el: SVGGraphicsElement) => {
      const b = el.getBBox(), m = el.getScreenCTM()!;
      const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return { left: Math.min(...c.map(q => q.x)), right: Math.max(...c.map(q => q.x)), top: Math.min(...c.map(q => q.y)), bottom: Math.max(...c.map(q => q.y)), local: b.width };
    };
    const rects: Record<string, ReturnType<typeof corners>> = {};
    for (const g of Array.from(rootSvg.querySelectorAll(nodeSelector))) {
      const own = Array.from(g.querySelectorAll('rect')).filter(r => !r.closest('defs, clipPath, mask, marker') && r.closest(nodeSelector) === g);
      const rect = (own.find(r => r.classList.contains('box')) ?? own[0]) as SVGRectElement | undefined;
      if (rect) rects[idOf(g)] = corners(rect);
    }
    const a = rects[anchorId]; if (!a) throw new Error(`No part ${anchorId} on this surface`);
    const scale = (a.right - a.left) / a.local;
    const norm = (q: { x: number; y: number }) => ({ x: (q.x - a.left) / scale, y: (q.y - a.top) / scale });
    const nodes: Record<string, { left: number; right: number; top: number; bottom: number }> = {};
    for (const [id, r] of Object.entries(rects)) { const tl = norm({ x: r.left, y: r.top }), br = norm({ x: r.right, y: r.bottom }); nodes[id] = { left: tl.x, top: tl.y, right: br.x, bottom: br.y }; }
    const cubic = (path: SVGPathElement) => {
      const d = path.getAttribute('d') ?? '', n = (d.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
      if (n.length !== 8) return null; const m = path.getScreenCTM()!;
      return [0, 2, 4, 6].map(i => norm(new DOMPoint(n[i], n[i + 1]).matrixTransform(m)));
    };
    const painted = (p: SVGPathElement) => {
      const s = getComputedStyle(p); return s.stroke !== 'none' && !/rgba\([^)]*,\s*0\)|transparent/.test(s.stroke) && parseFloat(s.strokeWidth) > 0;
    };
    const lineOf = (el: Element) => {
      const paths = (el.tagName.toLowerCase() === 'path' ? [el] : Array.from(el.querySelectorAll('path'))) as SVGPathElement[];
      const candidates = paths.filter(p => !p.closest('defs, marker, clipPath, mask, [data-testid^="step-badge-"], [data-testid^="edge-label-"]'));
      const good = candidates.filter(painted);
      return (good.length ? good : candidates).sort((x, y) => y.getTotalLength() - x.getTotalLength())[0] ?? null;
    };
    const edges: Record<string, { p: { x: number; y: number }[] | null; d: string; tone: string | null; hidden: boolean }> = {};
    for (const el of Array.from(rootSvg.querySelectorAll('g[data-edge-id], [data-testid^="edge-"][data-style]'))) {
      const id = el.getAttribute('data-edge-id') ?? (el.getAttribute('data-testid') ?? '').slice(5);
      const line = lineOf(el);
      edges[id] = { p: line ? cubic(line) : null, d: line?.getAttribute('d') ?? '', tone: el.getAttribute('data-tone'), hidden: el.getAttribute('data-hidden') === 'true' };
    }
    const trunks: Record<string, { x: number; y: number }[] | null> = {};
    for (const el of Array.from(rootSvg.querySelectorAll('g[data-trunk], [data-testid="trunk"]'))) {
      const key = el.getAttribute('data-trunk') ?? `${el.getAttribute('data-part')}:${el.getAttribute('data-side')}`;
      const line = lineOf(el); trunks[`${key}|${el.getAttribute('data-edges')}`] = line ? cubic(line) : null;
    }
    return { nodes, edges, trunks };
  }, anchor);
}
// An exported SVG on a page of its own, so it can be measured the way the browser draws it.
export async function svgOnPage(page: Page, svg: string) {
  const other = await page.context().newPage();
  await other.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
  const surface = other.locator('svg').first(); await expect(surface).toBeVisible();
  return { surface, close: () => other.close() };
}
// Invariant 5: the same parts with the same boxes and the same connections with the same cubic, within `tolerance` drawing px.
export function expectSameDrawing(editor: Drawn, image: Drawn, what: string, tolerance = 0.5) {
  expect(Object.keys(editor.nodes).sort(), `${what}: the same parts`).toEqual(Object.keys(image.nodes).sort());
  for (const [id, b] of Object.entries(editor.nodes)) for (const k of ['left', 'right', 'top', 'bottom'] as const)
    expect(Math.abs(b[k] - image.nodes[id][k]), `${what}: ${k} of ${id}`).toBeLessThanOrEqual(tolerance);
  const shown = (d: Drawn) => Object.entries(d.edges).filter(([, e]) => !e.hidden && e.p).map(([id]) => id).sort();
  expect(shown(editor), `${what}: the same connections are drawn`).toEqual(shown(image));
  for (const id of shown(editor)) editor.edges[id].p!.forEach((q, i) => {
    expect(Math.abs(q.x - image.edges[id].p![i].x), `${what}: ${id} point ${i} x`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(q.y - image.edges[id].p![i].y), `${what}: ${id} point ${i} y`).toBeLessThanOrEqual(tolerance);
  });
  expect(Object.keys(editor.trunks).sort(), `${what}: the same trunks`).toEqual(Object.keys(image.trunks).sort());
}
export const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
// One smooth curve: a single `M … C …`, no straight command and no second segment (drawing contract, *Connections*).
export const isOneCubic = (d: string) => /^\s*M[\s,]*-?[\d.eE+-]+[\s,]+-?[\d.eE+-]+[\s,]*C([\s,]*-?[\d.eE+-]+){6}\s*$/.test(d);

// What an exported image holds, read as markup (ui contract, *The share image*; drawing contract, *Geometry*).
export interface ImageNode { id: string; kind: string; form: string; open: string | null; shape: string | null; w: number; h: number; texts: string[]; traces: string[]; usedBy: string | null; openMark: boolean }
export interface Image {
  parsed: boolean; width: number; height: number; theme: string; format: string; viewBox: string; xmlns: string; forbidden: boolean;
  words: string[]; nodes: ImageNode[]; edges: { id: string; tone: string | null; d: string[] }[]; trunks: string[]; heads: string[];
}
export async function readImage(page: Page, svg: string): Promise<Image> {
  return await page.evaluate(text => {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml'), rootEl = xml.documentElement;
    const at = (el: Element | null, n: string) => el?.getAttribute(n) ?? '';
    return {
      parsed: !xml.querySelector('parsererror'), width: Number(at(rootEl, 'width')), height: Number(at(rootEl, 'height')),
      theme: at(rootEl, 'data-theme'), format: at(rootEl, 'data-format'), viewBox: at(rootEl, 'viewBox'), xmlns: at(rootEl, 'xmlns'),
      forbidden: !!xml.querySelector('foreignObject, script'),
      words: Array.from(xml.querySelectorAll('text')).map(t => t.textContent ?? ''),
      nodes: Array.from(xml.querySelectorAll('g[data-node-id]')).map(g => {
        const rect = (g.querySelector('rect.box') ?? g.querySelector('rect'));
        return {
          id: at(g, 'data-node-id'), kind: at(g, 'data-kind'), form: at(g, 'data-form'), open: g.getAttribute('data-open'),
          shape: g.querySelector('.body')?.getAttribute('data-shape') ?? g.querySelector('[data-shape]')?.getAttribute('data-shape') ?? null,
          w: Number(at(rect, 'width')), h: Number(at(rect, 'height')), texts: Array.from(g.querySelectorAll('text')).map(t => t.textContent ?? ''),
          traces: Array.from(g.querySelectorAll('path.trace')).map(p => at(p, 'data-edge-of')),
          usedBy: g.querySelector('[data-used-by]')?.getAttribute('data-used-by') ?? null, openMark: !!g.querySelector('.open-mark'),
        };
      }),
      edges: Array.from(xml.querySelectorAll('g[data-edge-id]')).map(g => ({ id: at(g, 'data-edge-id'), tone: g.getAttribute('data-tone'), d: Array.from(g.querySelectorAll('path')).map(p => at(p, 'd')) })),
      trunks: Array.from(xml.querySelectorAll('g[data-trunk]')).map(g => `${at(g, 'data-trunk')}|${at(g, 'data-edges')}`),
      heads: Array.from(xml.querySelectorAll('g[data-group-head]')).map(g => at(g, 'data-group-head')),
    };
  }, svg);
}
// The connections of a stored view as the editor names them (`edge-<id>`).
export const edgeIds = (v: any) => (v.edges as any[]).map(e => e.id as string);
// A control is disabled when it, or the input it wraps, is disabled or says so (a card that holds a checkbox or a radio).
export async function isDisabled(locator: Locator) {
  return await locator.evaluate(el => {
    const off = (e: Element | null) => !!e && ((e as HTMLInputElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
    return off(el) || off(el.querySelector('input, button, [role="checkbox"], [role="radio"]'));
  });
}
export async function isChecked(locator: Locator) {
  return await locator.evaluate(el => {
    const on = (e: Element | null) => !!e && ((e as HTMLInputElement).checked === true || e.getAttribute('aria-checked') === 'true');
    return on(el) || on(el.querySelector('input, [role="checkbox"], [role="radio"]'));
  });
}
// A click on the middle of a connection's drawn line (where a user clicks it).
export async function clickEdge(page: Page, id: string) {
  const point = await page.getByTestId(`edge-${id}`).evaluate(el => {
    const paths = (el.tagName.toLowerCase() === 'path' ? [el] : Array.from(el.querySelectorAll('path'))) as SVGPathElement[];
    const path = paths.sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
    if (!path) return null;
    const q = path.getPointAtLength(path.getTotalLength() * 0.5), m = path.getScreenCTM();
    if (!m) return null; const s = new DOMPoint(q.x, q.y).matrixTransform(m); return { x: s.x, y: s.y };
  });
  expect(point, `connection ${id} is drawn`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}
