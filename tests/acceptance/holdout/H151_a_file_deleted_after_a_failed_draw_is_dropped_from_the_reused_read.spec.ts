import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { gitRepo, token, scanFolder, startDraw, finishRun, runEvents, listedDiagrams, exists, samePath } from './helpers';
import { getDocument } from './helpers-selections'; // a draw writes format 4: this gives the drawn choice in the shape the scenario was written in

const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];

// START-6 (ADR 0010) with READ-2: the kept read answer is not trusted as it was. Its evidence is checked again against the folder
// as it is now, so a file that is gone between the failure and `Try again` is dropped with the facts only it backed, and because
// the facts changed the overview is drawn by a call. The scan is not repeated. (That another focus reads again is H154's.)
test('H151 [START-6, READ-2, READ-1, START-4, #181] a file the read cites that is deleted after a failed draw is checked again on Try again: the facts already read are reused, the overview is drawn by a call and the drawing no longer cites the file', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('retry-deleted-file');
  const docs = join(project.dir, 'docs');
  const scan = await scanFolder(request, auth, project.dir);
  const listedBefore = (await listedDiagrams(request)).length;
  const focus = { kind: 'typed', text: 'The tool loop [fixture:flaky:channel]' };
  const stageOf = (events: { event: string; data: any }[], stage: string) =>
    events.filter(e => e.event === 'progress' && e.data.stage === stage).map(e => String(e.data.message));

  // The channel call fails once: the read and the overview were finished and kept, nothing is written.
  const failedRun = await startDraw(request, auth, scan.id, focus, 'linkedin');
  const failed = await finishRun(request, failedRun, 'failed', 30_000);
  expect(failed.error).toContain('Fixture failure requested');
  expect(failed).toMatchObject({ diagramId: null, path: null });
  const failedEvents = await runEvents(failedRun);
  expect(stageOf(failedEvents, 'read')).toContain('Reading the code');
  expect(stageOf(failedEvents, 'channel')).toContain('Drawing the LinkedIn post');
  expect(await exists(docs), 'a failed draw writes nothing').toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore);

  // The first file of the listing backs `app` and `store`. It is deleted from the folder; no new scan is made.
  await rm(join(project.dir, 'alpha.ts'));
  expect(await exists(join(project.dir, 'alpha.ts'))).toBe(false);

  const retryRun = await startDraw(request, auth, scan.id, focus, 'linkedin');
  const retry = await finishRun(request, retryRun, 'succeeded', 30_000);
  expect(retry.error ?? null).toBeNull();
  const events = await runEvents(retryRun);
  const read = stageOf(events, 'read'), overview = stageOf(events, 'overview'), channel = stageOf(events, 'channel');
  expect(read).toContain('Using the facts already read'); expect(read).toContain('Checking the facts');
  expect(read.indexOf('Using the facts already read')).toBeLessThan(read.indexOf('Checking the facts'));
  for (const line of ENGINE_LINES) expect(read, `no engine line "${line}" in the read stage`).not.toContain(line);
  expect(overview).toContain('Drawing the overview');
  expect(overview, 'the facts changed, so the kept overview is not reused').not.toContain('Using the overview already drawn');
  expect(overview.some(m => ENGINE_LINES.includes(m)), 'the overview was drawn by a call: engine lines in its stage').toBe(true);
  expect(channel).toContain('Drawing the LinkedIn post');
  expect(events.filter(e => e.event === 'done')).toHaveLength(1);

  // The written drawing: the deleted file is cited by no fact, and the facts only it backed are gone.
  expect(samePath(retry.path, join(docs, 'architecture.archdraw.json'))).toBe(true);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  const doc = await getDocument(request, retry.diagramId);
  expect(JSON.stringify(doc.facts), 'no fact cites the deleted file').not.toContain('alpha.ts');
  const ids = doc.facts.components.map(c => c.id);
  expect(ids).toContain('agent');
  expect(ids).not.toContain('app'); expect(ids).not.toContain('store'); expect(ids).not.toContain('ghost');
  expect(doc.warnings!.some(w => w.includes('alpha.ts') && w.includes('not found')), 'the missing file is warned about').toBe(true);
});
