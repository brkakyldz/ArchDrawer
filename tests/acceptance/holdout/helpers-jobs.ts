import { expect } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, freePort, writeFiles, projectFiles, workspace } from './helpers';
import type { ChoiceReq } from './helpers-selections';

// ---------------------------------------------------------------------------------------------------------------
// Round of ADR 0016 and ADR 0017 (jobs and sources on the server): engine slots, a draw of several choices side by
// side, joining, retrying, the activity list, recent and found folders, the folder dialog and repositories from links.
// Nothing here reads product code: it starts the product the way the harness does (`npm start`, with the environment
// of the testing contract) and only uses the HTTP surfaces, the event streams, files on disk and the test doubles the
// contracts name. Every scenario of the round that needs a variable the shared harness server lacks
// (`ARCHDRAW_ENGINE_SLOTS`, `ARCHDRAW_TEST_PICKER`, `ARCHDRAW_TEST_REMOTES`, `ARCHDRAW_SEARCH_HOME`, `ARCHDRAW_JOB_KEEP_MS`,
// `ARCHDRAW_RUN_TIMEOUT_MS`) starts a server of its own with `jobServer` and stops it again.
// ---------------------------------------------------------------------------------------------------------------

export type Ev = { event: string; data: any };
export interface Answer { status: number; body: any }
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
// api contract, Progress lines / Scan record: ISO 8601 in UTC with milliseconds.
export const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
export const HEX16 = /^[0-9a-f]{16}$/;
export const WAITING = 'Waiting for a free engine';
export const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

// Polls `read` until `ok` accepts what it returned; a timeout names what was waited for and the last value.
export async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string, timeout = 60_000, every = 100): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out after ${timeout} ms waiting for ${what}; last: ${(JSON.stringify(value) ?? 'undefined').slice(0, 800)}`);
    await sleep(every);
  }
}

export async function tempDir(prefix: string) { return await realpath(await mkdtemp(join(tmpdir(), `archdrawer-${prefix}-`))); }

// ---------------------------------------------------------------------------------------------------------------
// A server of the scenario's own.
// ---------------------------------------------------------------------------------------------------------------
export interface JobServerOptions {
  slots?: number; stepMs?: number; timeoutMs?: number; keepMs?: number;
  home?: string; data?: string; // absolute folders (created); `home` is ARCHDRAW_SEARCH_HOME, `data` ARCHDRAW_DATA_DIR
  remotes?: boolean; picker?: boolean; // turn the test links / the test folder dialog on
}
export interface JobServer {
  base: string; port: number; dir: string; data: string; home: string; remotes: string | null; pickerFile: string | null; token: string;
  output(): string;
  get(path: string): Promise<Answer>;
  post(path: string, data?: unknown, auth?: string | null): Promise<Answer>;
  del(path: string): Promise<Answer>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
const SWITCHES = ['ARCHDRAW_ENGINE_SLOTS', 'ARCHDRAW_RUN_TIMEOUT_MS', 'ARCHDRAW_JOB_KEEP_MS', 'ARCHDRAW_TEST_PICKER', 'ARCHDRAW_TEST_REMOTES', 'ARCHDRAW_SEARCH_HOME'];

export async function jobServer(options: JobServerOptions = {}): Promise<JobServer> {
  const dir = await tempDir('jobs');
  const home = options.home ?? join(dir, 'home'), data = options.data ?? join(dir, 'data');
  await mkdir(home, { recursive: true }); await mkdir(data, { recursive: true });
  const remotes = options.remotes ? join(dir, 'remotes') : null;
  if (remotes) await mkdir(remotes, { recursive: true });
  const pickerFile = options.picker ? join(dir, 'picker.txt') : null;
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  for (const name of SWITCHES) delete env[name];
  Object.assign(env, { PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: 'fixture', ARCHDRAW_NO_OPEN: '1',
    ARCHDRAW_FIXTURE_STEP_MS: String(options.stepMs ?? 150), ARCHDRAW_SEARCH_HOME: home });
  if (options.slots) env.ARCHDRAW_ENGINE_SLOTS = String(options.slots);
  if (options.timeoutMs) env.ARCHDRAW_RUN_TIMEOUT_MS = String(options.timeoutMs);
  if (options.keepMs) env.ARCHDRAW_JOB_KEEP_MS = String(options.keepMs);
  if (remotes) env.ARCHDRAW_TEST_REMOTES = remotes;
  if (pickerFile) env.ARCHDRAW_TEST_PICKER = pickerFile;

  let child: ChildProcess | null = null, alive = false, exited: Promise<void> = Promise.resolve(), output = '';
  const call = async (method: string, path: string, data?: unknown, auth?: string | null): Promise<Answer> => {
    const headers: Record<string, string> = {};
    if (data !== undefined) headers['content-type'] = 'application/json';
    const sent = auth === undefined ? server.token : auth;
    if (method !== 'GET' && sent) headers['x-archdraw-token'] = sent;
    const response = await fetch(`${base}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text(); let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  };
  const server: JobServer = {
    base, port, dir, data, home, remotes, pickerFile, token: '',
    output: () => output,
    get: path => call('GET', path),
    post: (path, body = {}, auth) => call('POST', path, body, auth),
    del: path => call('DELETE', path),
    stop: async () => {
      if (!child || !alive) { child = null; return; }
      const current = child;
      try { await call('POST', '/api/shutdown', {}); } catch { /* already gone */ }
      const stopped = await Promise.race([exited.then(() => true), sleep(12_000).then(() => false)]);
      if (!stopped) await new Promise<void>(resolve => {
        if (process.platform === 'win32' && current.pid) execFile('taskkill', ['/pid', String(current.pid), '/T', '/F'], () => resolve());
        else { current.kill('SIGKILL'); resolve(); }
      });
      child = null;
    },
    restart: async () => { await server.stop(); await launch(); },
  };
  const launch = async () => {
    output = '';
    const current = spawn('npm', ['start'], { cwd: root, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = current; alive = true;
    current.stdout!.on('data', chunk => { output += chunk.toString('utf8'); });
    current.stderr!.on('data', chunk => { output += chunk.toString('utf8'); });
    exited = new Promise<void>(resolve => current.once('exit', () => { alive = false; resolve(); }));
    await until(async () => {
      if (!alive) throw new Error(`The server exited before it answered:\n${output.slice(-1500)}`);
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, ok => ok, 'the server to answer /api/health', 120_000, 250);
    const html = await (await fetch(`${base}/`)).text();
    const tag = html.match(/<meta\b(?=[^>]*\bname=["']archdraw-token["'])[^>]*>/i)?.[0];
    server.token = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? '';
    expect(server.token, 'HTML exposes the local process token').toBeTruthy();
  };
  try { await launch(); } catch (error) { await server.stop(); throw error; }
  return server;
}

// ---------------------------------------------------------------------------------------------------------------
// Event streams: read in the background so a running job's stream can be watched while the scenario goes on.
// ---------------------------------------------------------------------------------------------------------------
export interface Watch { events: Ev[]; closed: Promise<void>; stop(): void; wait(predicate: (events: Ev[]) => boolean, what: string, timeout?: number): Promise<Ev[]> }
export function watch(server: JobServer, path: string): Watch {
  const controller = new AbortController(), events: Ev[] = [];
  const closed = (async () => {
    try {
      const response = await fetch(`${server.base}${path}`, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
      if (response.status !== 200) { events.push({ event: 'http', data: { status: response.status } }); return; }
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let at = buffer.search(/\r?\n\r?\n/); at >= 0; at = buffer.search(/\r?\n\r?\n/)) {
          const block = buffer.slice(0, at); buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
          let event = 'message'; const lines: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
          }
          if (lines.length) events.push({ event, data: JSON.parse(lines.join('\n')) });
        }
      }
    } catch { /* aborted, or the server went away */ }
  })();
  return {
    events, closed, stop: () => controller.abort(),
    wait: (predicate, what, timeout = 60_000) => until(() => events, e => predicate(e), what, timeout, 20),
  };
}
// The whole stream of an ended job (or the past of a running one, up to its `done`), read and closed.
export async function eventsOf(server: JobServer, path: string, timeout = 90_000): Promise<Ev[]> {
  const w = watch(server, path);
  try { await w.wait(e => e.some(x => x.event === 'done') || e.some(x => x.event === 'http'), `the done event of ${path}`, timeout); } finally { w.stop(); }
  return [...w.events];
}
export const runEventsOf = (server: JobServer, runId: string, timeout?: number) => eventsOf(server, `/api/runs/${runId}/events`, timeout);
export const scanEventsOf = (server: JobServer, scanId: string, timeout?: number) => eventsOf(server, `/api/scans/${scanId}/events`, timeout);
export const lines = (events: Ev[], choice?: string, stage?: string) =>
  events.filter(e => e.event === 'progress' && (choice === undefined || e.data.choice === choice) && (stage === undefined || e.data.stage === stage)).map(e => String(e.data.message));
// The events that belong to one choice of a draw, in stream order: its progress lines and its `choice` records.
export const ofChoice = (events: Ev[], id: string) => events.filter(e => (e.event === 'progress' && e.data.choice === id) || (e.event === 'choice' && e.data.id === id));

// ---------------------------------------------------------------------------------------------------------------
// Scans, draws and records.
// ---------------------------------------------------------------------------------------------------------------
export const scanRec = async (server: JobServer, id: string) => (await server.get(`/api/scans/${id}`)).body;
export const runRec = async (server: JobServer, id: string) => (await server.get(`/api/runs/${id}`)).body;
export const activityOf = async (server: JobServer) => (await server.get('/api/activity')).body;
export const jobOf = (act: any, id: string) => (act.jobs as any[]).find(j => j.id === id);
export async function startScanOn(server: JobServer, target: { folder?: string; link?: string }, extra: Record<string, unknown> = {}) {
  const answer = await server.post('/api/scans', { engine: 'fixture', model: null, ...target, ...extra });
  expect(answer.status, JSON.stringify(answer.body)).toBe(202); return answer.body.scanId as string;
}
export async function awaitScan(server: JobServer, id: string, status = 'succeeded', timeout = 90_000) {
  const rec = await until(() => scanRec(server, id), r => r.status !== 'running', `scan ${id} to end`, timeout);
  expect(rec.status, JSON.stringify({ error: rec.error, progress: rec.progress })).toBe(status); return rec;
}
export async function scanOn(server: JobServer, target: { folder?: string; link?: string }, extra: Record<string, unknown> = {}) {
  return await awaitScan(server, await startScanOn(server, target, extra));
}
export async function drawOn(server: JobServer, scan: string, choices: ChoiceReq[], channel: string, extra: Record<string, unknown> = {}) {
  const answer = await server.post('/api/runs', { kind: 'draw', scan, choices, channel, engine: 'fixture', model: null, ...extra });
  expect(answer.status, JSON.stringify(answer.body)).toBe(202); return answer.body.runId as string;
}
export async function awaitRun(server: JobServer, id: string, status = 'succeeded', timeout = 180_000) {
  const rec = await until(() => runRec(server, id), r => r.status !== 'running', `run ${id} to end`, timeout);
  expect(rec.status, JSON.stringify({ error: rec.error, choices: rec.choices?.map((c: any) => `${c.id}:${c.status}:${c.error ?? ''}`) })).toBe(status); return rec;
}
export const states = (rec: any) => (rec.choices as any[]).map(c => `${c.id}:${c.status}`);
export const runningOf = (rec: any) => (rec.choices as any[]).filter(c => c.status === 'running').length;
// A run record every `every` ms until it has ended.
export async function sampleRun(server: JobServer, runId: string, every = 100, timeout = 240_000) {
  const samples: any[] = [], end = Date.now() + timeout;
  for (;;) {
    const rec = await runRec(server, runId); samples.push(rec);
    if (rec.status !== 'running') return samples;
    if (Date.now() > end) throw new Error(`Run ${runId} did not end in ${timeout} ms: ${JSON.stringify(states(rec))}`);
    await sleep(every);
  }
}
// A refine run on a registered drawing (an instruction of the editor), accepted: its id.
export async function refineOn(server: JobServer, diagramId: string, instruction = 'add Cache') {
  const answer = await server.post('/api/runs', { diagramId, view: 'overview', instruction, engine: 'fixture', model: null });
  expect(answer.status, JSON.stringify(answer.body)).toBe(202); return answer.body.runId as string;
}
export async function registerDrawing(server: JobServer, name = 'registered') {
  const made = await workspace(name), dir = await realpath(made.dir);
  const answer = await server.post('/api/files', { path: made.file });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200); return { id: answer.body.id as string, dir, file: made.file };
}
export async function diagramIds(server: JobServer): Promise<string[]> { return ((await server.get('/api/diagrams')).body.diagrams as { id: string }[]).map(d => d.id); }
// The views of each choice of a stored `@4` document, as `channel:viewId`, sorted (the order of views inside a channel is not asserted here).
export function viewsByChoice(doc: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of doc.choices) out[c.id] = (['overview', 'linkedin', 'readme', 'presentation'] as const)
    .flatMap(ch => ((c.channels[ch]?.views ?? []) as { id: string }[]).map(v => `${ch}:${v.id}`)).sort();
  return out;
}
export async function readDoc(file: string): Promise<any> { return JSON.parse(await readFile(file, 'utf8')); }

// ---------------------------------------------------------------------------------------------------------------
// git: local repositories for the test links (testing contract, *Test links*) and for the lists of folders.
// ---------------------------------------------------------------------------------------------------------------
export function gitIn(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'user.name=Holdout', '-c', 'user.email=holdout@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
      { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000, env: { ...process.env, ...env } },
      (error, stdout, stderr) => error ? reject(new Error(`git ${args.join(' ')} in ${cwd}: ${stderr || error.message}`)) : resolve(stdout));
  });
}
export async function quickRepo(dir: string, date: string | null, files: Record<string, string> = { 'f.txt': 'one\n' }) {
  await mkdir(dir, { recursive: true });
  await gitIn(dir, ['init', '-q']); await gitIn(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  if (date) {
    await writeFiles(dir, files); await gitIn(dir, ['add', '--all']);
    await gitIn(dir, ['commit', '-q', '-m', 'first'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  return dir;
}
export interface Remote {
  link: string; dir: string; head(): Promise<string>;
  commit(files: Record<string, string>, message?: string): Promise<string>;
  branch(name: string, files: Record<string, string>): Promise<string>;
}
// `<ARCHDRAW_TEST_REMOTES>/<link>`: a repository whose HEAD names `main`, with two commits, so a shallow copy is visible.
export async function makeRemote(server: JobServer, link: string, files: Record<string, string> = projectFiles): Promise<Remote> {
  const dir = join(server.remotes!, ...link.split('/'));
  await mkdir(dir, { recursive: true });
  await gitIn(dir, ['init', '-q']); await gitIn(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await writeFiles(dir, files); await gitIn(dir, ['add', '--all']); await gitIn(dir, ['commit', '-q', '-m', 'first commit']);
  await writeFiles(dir, { 'zz-history.md': 'A second commit, so a shallow copy has one commit of two.\n' });
  await gitIn(dir, ['add', '--all']); await gitIn(dir, ['commit', '-q', '-m', 'second commit']);
  const head = async () => (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
  return {
    link, dir, head,
    commit: async (more, message = 'next commit') => {
      await writeFiles(dir, more); await gitIn(dir, ['add', '--all']); await gitIn(dir, ['commit', '-q', '-m', message]); return await head();
    },
    branch: async (name, more) => {
      await gitIn(dir, ['checkout', '-q', '-b', name]); await writeFiles(dir, more); await gitIn(dir, ['add', '--all']);
      await gitIn(dir, ['commit', '-q', '-m', `work on ${name}`]); const at = await head(); await gitIn(dir, ['checkout', '-q', 'main']); return at;
    },
  };
}
// api contract, *The copy*: `<ARCHDRAW_DATA_DIR>/repos/<host>/<owner>/<repo>`.
export const copyOf = (server: JobServer, link: string) => join(server.data, 'repos', ...link.split('/'));
export const branchOf = async (dir: string) => (await gitIn(dir, ['symbolic-ref', '--short', 'HEAD'])).trim();
export const headOf = async (dir: string) => (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
export const short = (commit: string) => commit.slice(0, 7);
// Names of the entries below `repos/` (not `.partial`), and of `repos/.partial/`, so a leftover copy is visible.
export async function reposListing(server: JobServer): Promise<{ copies: string[]; partial: string[] }> {
  const names = async (dir: string) => { try { return (await readdir(dir)).sort(); } catch { return []; } };
  return { copies: (await names(join(server.data, 'repos'))).filter(n => n !== '.partial'), partial: await names(join(server.data, 'repos', '.partial')) };
}
export async function writePicker(server: JobServer, ...picklines: string[]) { await writeFile(server.pickerFile!, picklines.join('\n'), 'utf8'); }
