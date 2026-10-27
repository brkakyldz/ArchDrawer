import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, freePort, token, register, writeJSON, shopWithoutFiles, projectFiles, writeFiles } from './helpers';
import { optionBox, scanThroughHome } from './helpers-selections';
import { startedRun } from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// Round of ADR 0016 and 0017 (the home screen): a server of its own with the contract's test doubles (the test folder dialog,
// test links, a search home), repositories to find and to link, and readers of what the home screen shows: the combobox, the
// Activity list and a draw's rows. Nothing here reads product code: every helper uses only the surfaces the contracts name.
// ---------------------------------------------------------------------------------------------------------------

export function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<string>((resolve, reject) => {
    execFile('git', ['-c', 'user.name=Holdout', '-c', 'user.email=holdout@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, ...env } },
      (error, stdout, stderr) => error ? reject(new Error(`git ${args.join(' ')}: ${stderr || error.message}`)) : resolve(stdout));
  });
}
export interface Repo { dir: string; head: () => Promise<string>; commit: (files: Record<string, string>, message?: string) => Promise<string>; git: (args: string[]) => Promise<string> }
// A real repository on a named branch whose first commit is `daysAgo` days old (its committer date, which the lists show as an age).
export async function makeRepo(dir: string, files: Record<string, string> = projectFiles, opts: { branch?: string; daysAgo?: number } = {}): Promise<Repo> {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init']); await git(dir, ['symbolic-ref', 'HEAD', `refs/heads/${opts.branch ?? 'main'}`]);
  await writeFiles(dir, files); await git(dir, ['add', '--all']);
  const when = new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000).toISOString();
  await git(dir, ['commit', '-m', 'first commit'], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  const head = async () => (await git(dir, ['rev-parse', 'HEAD'])).trim();
  return { dir, head, git: args => git(dir, args), commit: async (more, message = 'next commit') => {
    await writeFiles(dir, more); await git(dir, ['add', '--all']); await git(dir, ['commit', '-m', message]); return await head();
  } };
}

// ---------------------------------------------------------------------------------------------------------------
// A server of its own (testing contract, *Environment*): fresh data directory, the fixture engine, a search home, the test folder
// dialog and test links. `tools` holds everything; `home` is the folder *Found on this computer* walks; `remotes` holds the
// repositories a link is copied from; `picker` is the test dialog's file.
// ---------------------------------------------------------------------------------------------------------------
export interface Seed { title: string; dir: string; file: string; id: string }
export interface HomeServer {
  base: string; data: string; tools: string; home: string; remotes: string; picker: string; env: Record<string, string>; token: string; seeds: Seed[];
  setPicker: (...lines: string[]) => Promise<void>; restart: () => Promise<void>; close: () => Promise<void>;
}
export async function homeServer(page: Page, request: APIRequestContext, opts: {
  stepMs?: string; slots?: number; timeoutMs?: number; keepMs?: number; library?: string[];
} = {}): Promise<HomeServer> {
  const tools = await realpath(await mkdtemp(join(tmpdir(), 'archdrawer-home-')));
  const data = join(tools, 'data'), home = join(tools, 'home'), remotes = join(tools, 'remotes'), picker = join(tools, 'picker.txt');
  for (const dir of [data, home, remotes]) await mkdir(dir);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env: Record<string, string> = { PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: 'fixture', ARCHDRAW_NO_OPEN: '1',
    ARCHDRAW_FIXTURE_STEP_MS: opts.stepMs ?? '400', ARCHDRAW_SEARCH_HOME: home, ARCHDRAW_TEST_PICKER: picker, ARCHDRAW_TEST_REMOTES: remotes,
    ...(opts.slots ? { ARCHDRAW_ENGINE_SLOTS: String(opts.slots) } : {}), ...(opts.timeoutMs ? { ARCHDRAW_RUN_TIMEOUT_MS: String(opts.timeoutMs) } : {}),
    ...(opts.keepMs ? { ARCHDRAW_JOB_KEEP_MS: String(opts.keepMs) } : {}) };
  const titles = opts.library ?? ['Library shop'];
  const seeds: Seed[] = [];
  const seedOne = async (title: string) => {
    const dir = join(tools, 'seed', title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    await makeRepo(dir, { 'readme.md': `# ${title}\n` });
    const file = join(dir, 'architecture.archdraw.json'); await writeJSON(file, shopWithoutFiles(title)); return { title, dir, file };
  };
  const first = await seedOne(titles[0] ?? 'Library shop');
  const started = await cli(['open', first.file, '--no-browser'], env); expect(started.code, started.stderr).toBe(0);
  const auth = await token(request, base);
  const registered = await register(request, first.file, base); seeds.push({ ...first, id: registered.id });
  for (const title of titles.slice(1)) { const more = await seedOne(title); seeds.push({ ...more, id: (await register(request, more.file, base)).id }); }
  if (!titles.length) {
    const gone = await request.delete(`${base}/api/diagrams/${registered.id}`, { headers: { 'X-Archdraw-Token': auth } }); expect(gone.status()).toBe(204); seeds.length = 0;
  }
  const server: HomeServer = { base, data, tools, home, remotes, picker, env, token: auth, seeds,
    setPicker: async (...lines) => { await writeFile(picker, lines.join('\n'), 'utf8'); },
    restart: async () => {
      const stopped = await cli(['stop'], env); expect(stopped.code, stopped.stderr).toBe(0);
      const again = await cli(['open', first.file, '--no-browser'], env); expect(again.code, again.stderr).toBe(0);
    },
    close: async () => { await page.goto('about:blank'); const stopped = await cli(['stop'], env); expect(stopped.code, stopped.stderr).toBe(0); } };
  return server;
}
export async function openHome(page: Page, server: HomeServer) {
  await page.goto(`${server.base}/`); await expect(page.getByTestId('home')).toBeVisible(); await expect(page.getByTestId('start')).toBeVisible();
}
// A repository a link is copied from: `<remotes>/<host>/<owner>/<repo>` (testing contract, *Test links*).
export async function makeRemote(server: HomeServer, link: string, files: Record<string, string> = projectFiles, opts: { branch?: string } = {}) {
  return await makeRepo(join(server.remotes, ...link.toLowerCase().split('/')), files, opts);
}
export const copyDir = (server: HomeServer, link: string) => join(server.data, 'repos', ...link.toLowerCase().split('/'));

// ---------------------------------------------------------------------------------------------------------------
// The home screen: lists, the stepper, the notice, dialogs and the requests the page makes.
// ---------------------------------------------------------------------------------------------------------------
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A relative time older than six days (ui contract, *Times*): `26 Oct`, with the year when it is not this year.
export function dayMonth(date: Date) {
  const text = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date().getFullYear() ? text : `${text} ${date.getFullYear()}`;
}
export const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
export interface ListedPath { path: string; text: string }
export async function comboOptions(page: Page): Promise<ListedPath[]> {
  return await page.getByTestId('start-folder-option').evaluateAll(els => els.map(el => ({ path: el.getAttribute('data-path') ?? '', text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() })));
}
export async function navItems(page: Page, group: 'source-recent' | 'source-found'): Promise<ListedPath[]> {
  return await page.getByTestId(group).getByTestId('source-item').evaluateAll(els => els.map(el => ({ path: el.getAttribute('data-path') ?? '', text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() })));
}
export const names = (items: ListedPath[]) => items.map(item => item.path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1));
// The element of the stepper that is `now`, and how many are `done`.
export async function stepper(page: Page) {
  const steps = page.getByTestId('start-steps');
  return { now: squash(await steps.locator('[data-state="now"]').first().textContent()), nowCount: await steps.locator('[data-state="now"]').count(), done: await steps.locator('[data-state="done"]').count() };
}
// Answers each dialog in turn (true accepts, false dismisses; later ones are dismissed) and returns the messages seen so far.
export function answerDialogs(page: Page, answers: boolean[]) {
  const messages: string[] = [];
  page.on('dialog', dialog => { messages.push(dialog.message()); const yes = answers.shift() ?? false; void (yes ? dialog.accept() : dialog.dismiss()); });
  return messages;
}
export async function startedRetry(page: Page, trigger: () => Promise<unknown>) {
  const waiting = page.waitForResponse(r => r.request().method() === 'POST' && /^\/api\/runs\/[^/]+\/retry$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
  await trigger(); const response = await waiting; expect(response.status(), await response.text()).toBe(202);
  return { runId: (await response.json()).runId as string, from: new URL(response.url()).pathname.split('/')[3], body: response.request().postData() };
}
export async function startedJoin(page: Page, trigger: () => Promise<unknown>) {
  const waiting = page.waitForResponse(r => r.request().method() === 'POST' && /^\/api\/runs\/[^/]+\/choices$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
  await trigger(); const response = await waiting; expect(response.status(), await response.text()).toBe(200);
  const answer = await response.json() as { runId: string; choices: string[] };
  return { runId: answer.runId, choices: answer.choices, to: new URL(response.url()).pathname.split('/')[3], body: response.request().postDataJSON() as Record<string, any> };
}
export async function activityNow(request: APIRequestContext, base: string) {
  const response = await request.get(`${base}/api/activity`); expect(response.status()).toBe(200); return await response.json() as { instance: string; now: string; timeoutMs: number; slots: { total: number; busy: number; waiting: number }; jobs: any[] };
}
export async function runRecordAt(request: APIRequestContext, base: string, runId: string): Promise<any> {
  const response = await request.get(`${base}/api/runs/${runId}`); expect(response.status()).toBe(200); return await response.json();
}

// What Activity shows for each job, in the order shown.
export interface JobRow { id: string; type: string; state: string; name: string; status: string; time: string; current: boolean; open: string | null }
export async function jobsOnScreen(page: Page): Promise<JobRow[]> {
  return await page.getByTestId('activity-job').evaluateAll(els => els.map(el => {
    const text = (id: string) => { const found = el.querySelector(`[data-testid="${id}"]`); return found ? (found.textContent ?? '').replace(/\s+/g, ' ').trim() : ''; };
    return { id: el.getAttribute('data-job') ?? '', type: el.getAttribute('data-type') ?? '', state: el.getAttribute('data-state') ?? '', name: text('activity-job-name'),
      status: text('activity-job-status'), time: text('activity-job-time'), current: el.getAttribute('aria-current') === 'true', open: el.querySelector('[data-testid="activity-open"]') ? text('activity-open') : null };
  }));
}
export const jobIn = (page: Page, id: string) => page.locator(`[data-testid="activity-job"][data-job="${id}"]`);

// What each row of a running draw shows, now and as a record of every change from now on.
export interface RowFacts { choice: string; state: string; time: string; line: string; events: number | null; files: string | null; parts: string | null; quiet: string | null; stages: string[] }
export async function rowFacts(page: Page): Promise<RowFacts[]> {
  return await page.getByTestId('draw-choice').evaluateAll(rows => rows.map(row => {
    const text = (id: string) => { const el = row.querySelector(`[data-testid="${id}"]`); return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null; };
    const pulse = row.querySelector('[data-testid="draw-choice-pulse"]');
    return { choice: row.getAttribute('data-choice') ?? '', state: row.getAttribute('data-state') ?? '', time: text('draw-choice-time') ?? '', line: text('draw-choice-line') ?? '',
      events: pulse ? Number(pulse.getAttribute('data-events')) : null, files: text('draw-choice-files'), parts: text('draw-choice-parts'), quiet: text('draw-choice-quiet'),
      stages: Array.from(row.querySelectorAll('[data-testid="draw-stage"]')).map(s => s.getAttribute('data-state') ?? '') };
  }));
}
export async function recordRowFacts(page: Page) {
  await page.evaluate(() => {
    const seen: unknown[] = ((window as any).__rowFacts = []); let last = '';
    const look = () => {
      const rows = Array.from(document.querySelectorAll('[data-testid="draw-choice"]')).map(row => {
        const text = (id: string) => { const el = row.querySelector(`[data-testid="${id}"]`); return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null; };
        const pulse = row.querySelector('[data-testid="draw-choice-pulse"]');
        return { choice: row.getAttribute('data-choice') ?? '', state: row.getAttribute('data-state') ?? '', time: text('draw-choice-time') ?? '', line: text('draw-choice-line') ?? '',
          events: pulse ? Number(pulse.getAttribute('data-events')) : null, files: text('draw-choice-files'), parts: text('draw-choice-parts'), quiet: text('draw-choice-quiet'),
          stages: Array.from(row.querySelectorAll('[data-testid="draw-stage"]')).map(s => s.getAttribute('data-state') ?? '') };
      });
      const key = JSON.stringify(rows); if (rows.length && key !== last) { last = key; seen.push(rows); }
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); look();
  });
}
export async function recordedFacts(page: Page): Promise<RowFacts[][]> { return await page.evaluate(() => [...(((window as any).__rowFacts as unknown[]) ?? [])]) as RowFacts[][]; }
export const maxRunning = (snapshots: RowFacts[][]) => Math.max(0, ...snapshots.map(rows => rows.filter(r => r.state === 'running').length));
// `mm:ss` as seconds (NaN for anything else).
export const clock = (text: string) => { const m = /^(\d+):(\d{2})$/.exec(text.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

// Ticks what is asked on the choosing step, in the list's own words, and chooses the channel.
export async function tickOnHome(page: Page, picks: { whole?: boolean; options?: string[]; typed?: string }, channel?: 'linkedin' | 'readme' | 'presentation') {
  if (picks.whole) await page.getByTestId('focus-whole').click();
  for (const id of picks.options ?? []) await optionBox(page, id).click();
  if (picks.typed !== undefined) { await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill(picks.typed); }
  if (channel) await page.getByTestId(`channel-choice-${channel}`).click();
}
// Scan a folder through the home screen of `server`, tick, choose the channel and press the draw button: the accepted run.
export async function drawOnHome(page: Page, server: HomeServer, folder: string, picks: { whole?: boolean; options?: string[]; typed?: string },
  channel: 'linkedin' | 'readme' | 'presentation' = 'linkedin') {
  await scanThroughHome(page, folder, server.base);
  await tickOnHome(page, picks, channel);
  return await startedRun(page, () => page.getByTestId('draw-start').click());
}
export { projectFiles };
