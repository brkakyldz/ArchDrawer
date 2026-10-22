import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, runEvents, listedDiagrams, exists, viewOf, baseURL } from './helpers';
import { getDocument } from './helpers-selections'; // a draw writes format 4: this gives the drawn choice in the shape the scenario was written in

const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];
const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found', 'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped', 'Dropped "ghost-limit": its component "ghost" was dropped',
];

type Snapshot = { stages: Record<string, string>; line: string };

// START-6 (ADR 0010) in START-4's home screen, after the OVERVIEW call failed (H149 does the channel call): the read was finished and
// kept, the overview was not. `draw-retry` starts from the overview stage: the read stage is `running` with `Using the facts already
// read`, it is `done` once the overview starts, the overview is drawn by a call, and the drawing opens. The stage list is watched by a
// recorder in the page that logs every state the screen is in, so no sleep decides what was seen.
test('H157 [START-6, START-4, READ-2, START-7, #181] after a draw failed in its overview stage Try again on the home screen shows the read stage running with Using the facts already read, then done once the overview starts, draws the overview by a call and opens the drawing', async ({ page, request }) => {
  test.setTimeout(300_000);
  const project = await gitRepo('retry-overview-ui');
  const docs = join(project.dir, 'docs');
  const posts: string[] = [];
  page.on('request', req => { const url = new URL(req.url()); if (req.method() === 'POST' && url.pathname.startsWith('/api/')) posts.push(url.pathname); });
  const listedBefore = (await listedDiagrams(request)).length;
  const stageOf = (events: { event: string; data: any }[], stage: string) =>
    events.filter(e => e.event === 'progress' && e.data.stage === stage).map(e => String(e.data.message));

  await page.goto('/'); await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill('The tool loop [fixture:flaky:overview]');
  await page.getByTestId('channel-choice-linkedin').click();

  // The first draw: the read succeeds, the overview call fails once; nothing is written and every choice stays.
  const first = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('draw-retry')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await exists(docs), 'a failed draw writes nothing').toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  const firstEvents = await runEvents(first.runId);
  expect(stageOf(firstEvents, 'read'), 'the first draw did read').toContain('Reading the code');
  expect(stageOf(firstEvents, 'overview')).toContain('Drawing the overview');
  expect(stageOf(firstEvents, 'channel'), 'the channel stage never started').toEqual([]);

  // Record every state of the draw's stage list and its latest line from here on.
  await page.evaluate(() => {
    const log: { stages: Record<string, string>; line: string }[] = [];
    const take = () => {
      const stages: Record<string, string> = {};
      document.querySelectorAll('[data-testid="draw-stage"]').forEach(el => { stages[el.getAttribute('data-stage') ?? '?'] = el.getAttribute('data-state') ?? '?'; });
      const line = (document.querySelector('[data-testid="draw-line"]')?.textContent ?? '').trim();
      const last = log.at(-1);
      if (!last || last.line !== line || JSON.stringify(last.stages) !== JSON.stringify(stages)) log.push({ stages, line });
    };
    (window as any).__drawLog = log;
    new MutationObserver(take).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    take();
  });

  // Try again: the same request, no new scan.
  const scans = posts.filter(p => p === '/api/scans').length;
  const retry = await startedRun(page, () => page.getByTestId('draw-retry').click());
  expect(retry.body).toEqual(first.body); expect(retry.runId).not.toBe(first.runId);
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  expect(posts.filter(p => p === '/api/scans'), 'no new scan').toHaveLength(scans);

  // What the screen showed.
  const log = await page.evaluate(() => (window as any).__drawLog as Snapshot[]);
  const rank = (state: string | undefined) => state === 'done' ? 2 : state === 'running' ? 1 : 0;
  expect(log.some(s => s.stages.read === 'running' && s.line.includes('Using the facts already read')),
    'the read stage was running with the line "Using the facts already read"').toBe(true);
  expect(log.some(s => s.stages.read === 'done' && s.stages.overview === 'running'),
    'the read stage was done once the overview stage started').toBe(true);
  expect(log.filter(s => rank(s.stages.overview) >= 1 && s.stages.read !== undefined && s.stages.read !== 'done'),
    'the overview never starts before the read stage is done').toEqual([]);
  expect(log.filter(s => rank(s.stages.channel) >= 1 && s.stages.overview !== 'done' && s.stages.overview !== undefined),
    'the channel never starts before the overview stage is done').toEqual([]);
  expect(log.some(s => s.line.includes('Using the overview already drawn')), 'no overview was kept, so none is shown as reused').toBe(false);

  // The run's own events: the read is reused with no engine line, the overview is drawn by a call, the channel as usual.
  const events = await runEvents(retry.runId);
  const read = stageOf(events, 'read'), overview = stageOf(events, 'overview'), channel = stageOf(events, 'channel');
  expect(read).toContain('Using the facts already read'); expect(read).toContain('Checking the facts');
  expect(read.indexOf('Using the facts already read')).toBeLessThan(read.indexOf('Checking the facts'));
  for (const line of ENGINE_LINES) expect(read, `no engine line "${line}" in the read stage`).not.toContain(line);
  expect(overview).toContain('Drawing the overview');
  expect(overview, 'no overview was kept').not.toContain('Using the overview already drawn');
  expect(overview.some(m => ENGINE_LINES.includes(m)), 'the overview was drawn by a call: engine lines in its stage').toBe(true);
  expect(channel).toContain('Drawing the LinkedIn post');
  const stages = events.filter(e => e.event === 'progress').map(e => e.data.stage).filter(Boolean) as string[];
  expect([...new Set(stages)]).toEqual(['read', 'overview', 'channel']);
  expect(events.filter(e => e.event === 'done')).toHaveLength(1);

  // The drawing: written once, registered once, with the warnings of a draw that never failed.
  const run = await (await request.get(`${baseURL()}/api/runs/${retry.runId}`)).json();
  expect(run).toMatchObject({ status: 'succeeded', error: null, channel: 'linkedin' });
  expect(await exists(join(docs, 'architecture.archdraw.json'))).toBe(true);
  expect(await exists(join(docs, 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  const doc = await getDocument(request, run.diagramId);
  expect(viewOf(doc, 'linkedin')!.nodes.length).toBeGreaterThan(0);
  expect(viewOf(doc, 'overview')!.nodes.length).toBeGreaterThan(0);
  expect(doc.warnings!.slice(0, 4)).toEqual(FOUR_WARNINGS);
});
