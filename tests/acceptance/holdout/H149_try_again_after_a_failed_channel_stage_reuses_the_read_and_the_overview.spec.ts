import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, runEvents, listedDiagrams, exists, token, drawFolder, viewOf, baseURL } from './helpers';
import { getDocument } from './helpers-selections'; // a draw writes format 4: this gives the drawn choice in the shape the scenario was written in
import { startedRetry } from './helpers-home';

const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];

// START-6 (ADR 0010) in START-4's home screen: the channel call fails, nothing is written, and `Try again` starts from the channel
// stage: no new read, the overview reused, a drawing written whose warnings are those of a draw that never failed. From ADR 0016
// `Try again` is the retry endpoint of the failed draw (no new draw request) and the draw ends on `Ready`, the editor opening from `Open`.
test('H149 [START-6, START-4, READ-1, START-7, JOB-3, HOME-6, #181, #202] a draw that fails at the channel stage and then Try again from the home screen makes no new read, reuses the overview, writes the drawing and carries the same warnings as a draw that never failed', async ({ page, request }) => {
  test.setTimeout(300_000);
  const auth = await token(request);
  const project = await gitRepo('retry-channel');
  const control = await gitRepo('retry-channel-control');
  const posts: string[] = [];
  page.on('request', req => { const url = new URL(req.url()); if (req.method() === 'POST' && url.pathname.startsWith('/api/')) posts.push(url.pathname); });
  const listedBefore = (await listedDiagrams(request)).length;
  const stageOf = (events: { event: string; data: any }[], stage: string) =>
    events.filter(e => e.event === 'progress' && e.data.stage === stage).map(e => String(e.data.message));

  await page.goto('/'); await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill('The tool loop [fixture:flaky:channel]');
  await page.getByTestId('channel-choice-linkedin').click();

  // The first draw: read and overview succeed, the channel call fails; nothing is written and the panel keeps the draw.
  const first = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false);
  expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  const firstEvents = await runEvents(first.runId);
  expect(stageOf(firstEvents, 'read'), 'the first draw did read').toContain('Reading the code');
  expect(stageOf(firstEvents, 'overview')).toContain('Drawing the overview');
  expect(stageOf(firstEvents, 'channel')).toContain('Drawing the LinkedIn post');
  expect(firstEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null });

  // Try again: the retry endpoint of the first draw, no scan, no new draw request, and a draw that starts from the channel.
  const scans = posts.filter(p => p === '/api/scans').length;
  const retry = await startedRetry(page, () => page.getByTestId('draw-retry').click());
  expect(retry.from).toBe(first.runId); expect(retry.runId).not.toBe(first.runId);
  expect(posts.filter(p => p === '/api/runs'), 'Try again is not a new draw request').toHaveLength(1);
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(800); await expect(page.getByTestId('editor'), 'the editor opens from Open').toHaveCount(0);
  await page.getByTestId('draw-open').click();
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  expect(posts.filter(p => p === '/api/scans'), 'no new scan').toHaveLength(scans);

  const events = await runEvents(retry.runId);
  const read = stageOf(events, 'read'), overview = stageOf(events, 'overview'), channel = stageOf(events, 'channel');
  expect(read).toContain('Using the facts already read'); expect(read).toContain('Checking the facts');
  expect(read.indexOf('Using the facts already read')).toBeLessThan(read.indexOf('Checking the facts'));
  for (const line of ENGINE_LINES) expect(read, `no engine line "${line}" in the read stage`).not.toContain(line);
  expect(overview).toContain('Drawing the overview'); expect(overview).toContain('Using the overview already drawn');
  expect(overview.indexOf('Drawing the overview')).toBeLessThan(overview.indexOf('Using the overview already drawn'));
  for (const line of ENGINE_LINES) expect(overview, `no engine line "${line}" in the overview stage`).not.toContain(line);
  expect(channel).toContain('Drawing the LinkedIn post'); expect(channel.length, 'the channel call is made').toBeGreaterThan(1);
  const stages = events.filter(e => e.event === 'progress').map(e => e.data.stage).filter(Boolean) as string[];
  expect([...new Set(stages)]).toEqual(['read', 'overview', 'channel']);
  expect(events.filter(e => e.event === 'done')).toHaveLength(1);

  // The drawing is written once, registered, and its warnings are the ones of a draw of the same project that never failed.
  const run = await (await request.get(`${baseURL()}/api/runs/${retry.runId}`)).json();
  expect(run).toMatchObject({ status: 'succeeded', error: null, retryOf: first.runId, into: null });
  expect(await exists(join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true);
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  const doc = await getDocument(request, run.diagramId);
  expect(viewOf(doc, 'linkedin')!.nodes.length).toBeGreaterThan(0);
  expect(doc.warnings!.length).toBeGreaterThanOrEqual(4);

  const clean = await drawFolder(request, auth, control.dir, { focus: { kind: 'typed', text: 'The tool loop' }, channel: 'linkedin' });
  const cleanDoc = await getDocument(request, clean.run.diagramId);
  expect(doc.warnings, 'the same warnings as a draw that never failed').toEqual(cleanDoc.warnings);
  expect(viewOf(doc, 'overview')!.nodes.map(n => n.id)).toEqual(viewOf(cleanDoc, 'overview')!.nodes.map(n => n.id));
  expect(doc.facts).toEqual(cleanDoc.facts);
});
