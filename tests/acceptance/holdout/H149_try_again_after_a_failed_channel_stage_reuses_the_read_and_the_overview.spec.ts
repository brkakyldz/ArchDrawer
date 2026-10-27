import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, scanFolder, finishRun, postJSON, runEvents, listedDiagrams, exists, token, drawFolder, viewOf, baseURL } from './helpers';
import { getDocument, startDrawChoices, typed } from './helpers-selections'; // a draw writes format 4: getDocument gives the drawn choice in the shape the scenario was written in

const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];

// START-6 (ADR 0010): the channel call of a one-choice draw fails, nothing is written, and `Try again` (the retry endpoint of the
// failed draw, ADR 0016) starts from the channel stage: no new read, the overview reused, a drawing written whose warnings are those of
// a draw that never failed. Everything here is read over the API; the home-screen retry journey is H157 (after an overview failure).
test('H149 [START-6, START-7, JOB-3, READ-1, #181, #196] a draw that fails at the channel stage and then Try again makes no new read, reuses the overview, writes the drawing and carries the same warnings as a draw that never failed', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('retry-channel');
  const control = await gitRepo('retry-channel-control');
  const listedBefore = (await listedDiagrams(request)).length;
  const stageOf = (events: { event: string; data: any }[], stage: string) =>
    events.filter(e => e.event === 'progress' && e.data.stage === stage).map(e => String(e.data.message));

  // The first draw: read and overview succeed, the channel call fails; nothing is written.
  const scan = await scanFolder(request, auth, project.dir);
  const first = { runId: await startDrawChoices(request, auth, scan.id, [typed('The tool loop [fixture:flaky:channel]')], 'linkedin') };
  const failed = await finishRun(request, first.runId, 'failed');
  expect(failed.error).toContain('Fixture failure requested');
  expect(await exists(join(project.dir, 'docs'))).toBe(false);
  expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  const firstEvents = await runEvents(first.runId);
  expect(stageOf(firstEvents, 'read'), 'the first draw did read').toContain('Reading the code');
  expect(stageOf(firstEvents, 'overview')).toContain('Drawing the overview');
  expect(stageOf(firstEvents, 'channel')).toContain('Drawing the LinkedIn post');
  expect(firstEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null });

  // Try again: the retry endpoint of the first draw (no body), a new run that starts from the channel.
  const retried = await postJSON(request, auth, `/api/runs/${first.runId}/retry`, {});
  expect(retried.status, JSON.stringify(retried.body)).toBe(202);
  const retry = { runId: retried.body.runId as string };
  expect(retry.runId).not.toBe(first.runId);
  await finishRun(request, retry.runId, 'succeeded');

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
