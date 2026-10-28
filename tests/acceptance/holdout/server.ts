// The product under test, one per spec file (testing contract, *Start*, *Environment*, *Test suites*).
//
// `startProduct` spawns `npm start` from the repository root with a free `PORT`, a fresh temporary `ARCHDRAW_DATA_DIR`, the fixture engine
// only, no browser opening, `ARCHDRAW_FIXTURE_STEP_MS=100`, and the test folder dialog and the test links pointed at a temp folder of its
// own, so no scenario opens a real dialog or reaches the network. It waits for the start-up line and `GET /api/health`, reads the page's
// token, and stops the server (and its process tree) at the end. `useProduct` wires it into `test.beforeAll` / `test.afterAll`.
import { test, expect } from '@playwright/test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

export const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface ProductOptions {
  engines?: string;          // ARCHDRAW_ENGINES; default `fixture`; `''` offers none
  stepMs?: number;           // ARCHDRAW_FIXTURE_STEP_MS; default 100
  slots?: number;            // ARCHDRAW_ENGINE_SLOTS
  timeoutMs?: number;        // ARCHDRAW_RUN_TIMEOUT_MS
  keepMs?: number;           // ARCHDRAW_JOB_KEEP_MS
  env?: Record<string, string>;
}
export interface Answer { status: number; body: any; text: string }
export interface Product {
  base: string; port: number; data: string; around: string; picker: string; remotes: string; env: Record<string, string>;
  token: string;
  output(): string;
  get(path: string): Promise<Answer>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Answer>;
  put(path: string, body: unknown, headers?: Record<string, string>): Promise<Answer>;
  del(path: string, headers?: Record<string, string>): Promise<Answer>;
  setPicker(...lines: string[]): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('No port assigned'));
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

// Every variable the product reads is set here and nowhere else, so a switch left on in the shell never reaches a scenario.
const OWN = /^(PORT|ARCHDRAW_.*)$/;

function killTree(child: ChildProcess) {
  return new Promise<void>(resolve => {
    if (!child.pid) return resolve();
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } resolve(); }
  });
}

export async function startProduct(options: ProductOptions = {}): Promise<Product> {
  const around = await realpath(await mkdtemp(join(tmpdir(), 'archdrawer-holdout-')));
  const data = join(around, 'data'), remotes = join(around, 'remotes'), picker = join(around, 'picker.txt');
  await mkdir(data, { recursive: true }); await mkdir(remotes, { recursive: true });
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !OWN.test(key)) env[key] = value;
  Object.assign(env, {
    PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: options.engines ?? 'fixture', ARCHDRAW_NO_OPEN: '1',
    ARCHDRAW_FIXTURE_STEP_MS: String(options.stepMs ?? 100), ARCHDRAW_TEST_PICKER: picker, ARCHDRAW_TEST_REMOTES: remotes,
  });
  if (options.slots !== undefined) env.ARCHDRAW_ENGINE_SLOTS = String(options.slots);
  if (options.timeoutMs !== undefined) env.ARCHDRAW_RUN_TIMEOUT_MS = String(options.timeoutMs);
  if (options.keepMs !== undefined) env.ARCHDRAW_JOB_KEEP_MS = String(options.keepMs);
  Object.assign(env, options.env ?? {});

  let child: ChildProcess | null = null, exited: Promise<void> = Promise.resolve(), log = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> => {
    const sent: Record<string, string> = { ...headers };
    if (body !== undefined) sent['content-type'] = 'application/json';
    if (method !== 'GET' && product.token && !Object.keys(sent).some(k => k.toLowerCase() === 'x-archdraw-token')) sent['X-Archdraw-Token'] = product.token;
    const response = await fetch(`${base}${path}`, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: response.status, body: parsed, text };
  };

  const launch = async () => {
    log = '';
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const current = spawn(npm, ['start'], {
      cwd: root, env, shell: process.platform === 'win32', windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = current;
    exited = new Promise<void>(resolve => current.once('exit', () => resolve()));
    // Ready once the start-up line names our port (testing contract, *Start*); a server that exits first fails the scenario with its log.
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`npm start did not print its start-up line within 120 s:\n${log.slice(-2000)}`)), 120_000);
      const look = (chunk: Buffer) => {
        log += chunk.toString('utf8');
        if (log.includes(`archdrawer listening on http://127.0.0.1:${port}`)) { clearTimeout(deadline); resolve(); }
      };
      current.stdout!.on('data', look); current.stderr!.on('data', look);
      current.once('exit', code => { clearTimeout(deadline); reject(new Error(`npm start exited (${code}) before it listened:\n${log.slice(-2000)}`)); });
    });
    const health = await fetch(`${base}/api/health`);
    expect(health.status, 'GET /api/health answers once the server listens').toBe(200);
    const html = await (await fetch(`${base}/`)).text();
    const tag = html.match(/<meta\b(?=[^>]*\bname=["']archdraw-token["'])[^>]*>/i)?.[0];
    product.token = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? '';
    expect(product.token, 'the page carries the per-process token').toBeTruthy();
  };

  const product: Product = {
    base, port, data, around, picker, remotes, env, token: '',
    output: () => log,
    get: path => call('GET', path),
    post: (path, body = {}, headers) => call('POST', path, body, headers),
    put: (path, body, headers) => call('PUT', path, body, headers),
    del: (path, headers) => call('DELETE', path, undefined, headers),
    setPicker: async (...lines) => { await writeFile(picker, lines.join('\n'), 'utf8'); },
    stop: async () => {
      const current = child; if (!current) return;
      child = null;
      if (current.exitCode === null) {
        try { await call('POST', '/api/shutdown', {}); } catch { /* already gone */ }
        // The shutdown is asked once; a server that does not exit in time is killed with its whole process tree.
        let timer: NodeJS.Timeout | undefined;
        const stopped = await Promise.race([exited.then(() => true), new Promise<boolean>(r => { timer = setTimeout(() => r(false), 15_000); })]);
        if (timer) clearTimeout(timer);
        if (!stopped) await killTree(current);
      }
      await killTree(current); // the npm shell and anything it left
    },
    restart: async () => { await product.stop(); await launch(); },
  };
  try { await launch(); } catch (error) { await product.stop(); throw error; }
  return product;
}

// One product per spec file: started before the file's first test, stopped after its last.
export function useProduct(options: ProductOptions = {}): () => Product {
  let product: Product | null = null;
  test.beforeAll(async () => { test.setTimeout(180_000); product = await startProduct(options); });
  test.afterAll(async () => {
    test.setTimeout(60_000);
    const done = product; product = null;
    if (done) { await done.stop(); await rm(done.around, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined); }
  });
  return () => { if (!product) throw new Error('The product is not running'); return product; };
}
