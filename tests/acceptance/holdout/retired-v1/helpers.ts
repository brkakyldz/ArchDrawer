import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { execFileSync } from 'node:child_process';

export { expect };
export const fixtureProgress = ['Listing files', 'Reading README', 'Mapping components', 'Drawing diagram'];
export const fixtureFiles = {
  'README.md': '# Holdout shop\n',
  'web/index.html': '<main>Shop</main>\n',
  'server/api.js': 'export const route = "/orders";\n',
  'server/auth.js': 'export const authenticate = () => true;\n',
  'server/orders.js': 'export const order = () => ({ id: 1 });\n',
  'db/schema.sql': 'CREATE TABLE orders (id INTEGER);\n',
};

export interface NodeDocument {
  id: string; label: string; kind: string; tech: string; description: string;
  group: string | null; files: string[]; x: number; y: number;
}
export interface Diagram {
  schema: string; id: string; title: string; subtitle: string;
  theme: 'dark' | 'light'; showSteps: boolean; direction: 'LR' | 'TB';
  source: { kind: 'local'; path: string } | { kind: 'github'; repo: string; ref: string | null; commit: string | null } | null;
  engine: { id: string; model: string | null } | null;
  instruction: string; createdAt: string; updatedAt: string;
  nodes: NodeDocument[];
  groups: { id: string; label: string; parent: string | null; x: number; y: number; w: number; h: number }[];
  edges: { id: string; from: string; to: string; label: string; style: string; step: number | null }[];
  notes: { id: string; text: string; x: number; y: number }[];
  warnings: string[];
}
export interface Run {
  id: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: string[]; diagramId: string | null; error: string | null;
}

export const test = base.extend<{ workspace: string; source: string; token: string }>({
  workspace: async ({}, use) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'archdraw-holdout-source-'));
    try { await use(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
  },
  source: async ({ workspace }, use) => {
    const directory = path.join(workspace, 'shop');
    await writeFiles(directory, fixtureFiles);
    await use(directory);
  },
  token: async ({ request }, use) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const meta = (await response.text()).match(/<meta\b[^>]*>/gi)?.find(tag => /\bname\s*=\s*["']archdraw-token["']/i.test(tag));
    const token = meta?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    expect(token, 'GET / must expose a non-empty archdraw-token meta value').toBeTruthy();
    await use(token!);
  },
});

export async function writeFiles(directory: string, files: Record<string, string>) {
  await fs.mkdir(directory, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(directory, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  }
}

export function auth(token: string) { return { 'X-Archdraw-Token': token }; }

export async function document(request: APIRequestContext, id: string): Promise<Diagram> {
  const response = await request.get(`/api/diagrams/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}

export async function library(request: APIRequestContext): Promise<{ id: string; title: string; source: unknown; updatedAt: string }[]> {
  const response = await request.get('/api/diagrams');
  expect(response.status()).toBe(200);
  return (await response.json()).diagrams;
}

export async function startRun(request: APIRequestContext, token: string, source: string, instruction = 'Draw the order architecture', extra: Record<string, unknown> = {}) {
  const response = await request.post('/api/runs', {
    headers: auth(token),
    data: { source, ref: null, engine: 'fixture', model: null, instruction, diagramId: null, ...extra },
  });
  expect(response.status()).toBe(202);
  const { runId } = await response.json();
  expect(runId).toEqual(expect.any(String));
  return runId as string;
}

export async function waitRun(request: APIRequestContext, id: string, status: Run['status'] = 'succeeded'): Promise<Run> {
  let latest: Run | undefined;
  await expect.poll(async () => {
    const response = await request.get(`/api/runs/${id}`);
    expect(response.status()).toBe(200);
    latest = await response.json();
    return latest!.status;
  }, { timeout: 15_000, intervals: [50, 100, 200] }).toBe(status);
  expect(latest!.id).toBe(id);
  if (status === 'succeeded') {
    expect(latest!.diagramId).toEqual(expect.any(String));
    expect(latest!.error).toBeNull();
  }
  return latest!;
}

export async function generate(request: APIRequestContext, token: string, source: string, instruction?: string) {
  const runId = await startRun(request, token, source, instruction);
  const run = await waitRun(request, runId);
  return { runId, diagram: await document(request, run.diagramId!) };
}

export async function openEditor(page: Page, id: string) {
  await page.goto(`/d/${id}`);
  await expect(page.getByTestId('editor')).toBeVisible();
}

export async function saved(page: Page, request: APIRequestContext, id: string, predicate: (diagram: Diagram) => boolean): Promise<Diagram> {
  let latest: Diagram | undefined;
  await expect.poll(async () => {
    latest = await document(request, id);
    return predicate(latest);
  }, { intervals: [50, 100, 200] }).toBe(true);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  return latest!;
}

export function makeDiagram(title = 'Holdout order flow'): Diagram {
  const now = new Date().toISOString();
  return {
    schema: 'archdraw/diagram@1', id: 'd_holdoutseed', title, subtitle: 'From browser to storage',
    theme: 'dark', showSteps: true, direction: 'LR', source: null, engine: null, instruction: '',
    createdAt: now, updatedAt: now,
    nodes: [
      { id: 'web', label: 'Browser', kind: 'ui', tech: 'HTML', description: 'Starts an order', group: null, files: [], x: 80, y: 160 },
      { id: 'api', label: 'Order API', kind: 'service', tech: 'Node', description: 'Handles orders', group: null, files: [], x: 400, y: 160 },
      { id: 'db', label: 'SQL store', kind: 'data', tech: 'SQL', description: 'Persists orders', group: null, files: [], x: 720, y: 160 },
    ],
    groups: [],
    edges: [{ id: 'request', from: 'web', to: 'api', label: 'submit', style: 'call', step: 2 }],
    notes: [{ id: 'explanation', text: 'Orders are durable', x: 100, y: 430 }],
    warnings: [],
  };
}

export async function createDiagram(request: APIRequestContext, token: string, draft = makeDiagram()): Promise<Diagram> {
  const response = await request.post('/api/diagrams', { headers: auth(token), data: draft });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  expect(id).toMatch(/^d_[a-z0-9]{6,}$/);
  expect(id).not.toBe(draft.id);
  return document(request, id);
}

export function item(page: Page, id: string) {
  return page.locator(`[data-testid="library-item"][data-diagram-id="${id}"]`);
}

export async function inline(page: Page, target: string, input: string, value: string) {
  await page.getByTestId(target).dblclick();
  await page.getByTestId(input).fill(value);
  await page.getByTestId(input).press('Enter');
}

export async function drag(page: Page, testId: string, dx: number, dy: number) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + Math.min(18, box!.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

export async function connect(page: Page, from: string, to: string) {
  const source = await page.getByTestId(`handle-source-${from}`).boundingBox();
  const target = await page.getByTestId(`handle-target-${to}`).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 16 });
  await page.mouse.up();
}

export async function download(page: Page, format: 'svg' | 'png' | 'mermaid' | 'json') {
  if (!(await page.getByTestId(`export-${format}`).isVisible())) await page.getByTestId('export-button').click();
  const pending = page.waitForEvent('download');
  await page.getByTestId(`export-${format}`).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  const stream = await file.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

export function content(diagram: Diagram) {
  const { id, createdAt, updatedAt, ...rest } = diagram;
  return rest;
}

export async function events(request: APIRequestContext, runId: string) {
  const response = await request.get(`/api/runs/${runId}/events`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/event-stream');
  return (await response.text()).replace(/\r\n/g, '\n').split(/\n\n+/).filter(block => /^event:/m.test(block)).map(block => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1];
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    expect(data).toBeTruthy();
    return { event, data: JSON.parse(data!) };
  });
}

export async function bareRepo(workspace: string, owner: string, name: string) {
  const githubRoot = process.env.HOLDOUT_GITHUB_DIR;
  expect(githubRoot, 'the config must export its offline GitHub directory').toBeTruthy();
  const working = path.join(workspace, 'git-working');
  await writeFiles(working, fixtureFiles);
  const git = (args: string[]) => execFileSync('git', args, { cwd: working, encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Holdout Author']);
  git(['config', 'user.email', 'holdout@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  const hooks = path.join(workspace, 'empty-hooks');
  await fs.mkdir(hooks);
  git(['config', 'core.hooksPath', hooks]);
  git(['add', '--', ...Object.keys(fixtureFiles)]);
  git(['commit', '-m', 'Initial offline fixture']);
  git(['tag', 'v1']);
  const destination = path.join(githubRoot!, owner, `${name}.git`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  execFileSync('git', ['clone', '--bare', working, destination], { encoding: 'utf8', windowsHide: true });
  git(['remote', 'add', 'origin', destination]);
  return {
    working, destination, commit: git(['rev-parse', 'HEAD']),
    async advance() {
      await fs.appendFile(path.join(working, 'README.md'), '\nSecond revision\n');
      await fs.unlink(path.join(working, 'server', 'auth.js'));
      git(['add', '--', 'README.md', 'server/auth.js']);
      git(['commit', '-m', 'Advance main for cache refresh']);
      git(['push', 'origin', 'main']);
      return git(['rev-parse', 'HEAD']);
    },
  };
}

export async function rawHTTP(method: string, pathname: string, headers: Record<string, string | undefined>, body?: unknown) {
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port: Number(process.env.HOLDOUT_PORT || 4399), method, path: pathname,
      headers: { ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': String(bytes.length) } : {}), ...headers },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error(`HTTP timeout: ${method} ${pathname}`)));
    request.on('error', reject);
    request.end(bytes);
  });
}
