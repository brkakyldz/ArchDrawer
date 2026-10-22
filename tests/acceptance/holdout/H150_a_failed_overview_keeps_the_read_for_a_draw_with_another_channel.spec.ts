import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, startDraw, finishRun, runEvents, getDocument, listedDiagrams, exists, samePath } from './helpers';

const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];
const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found', 'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped', 'Dropped "ghost-limit": its component "ghost" was dropped',
];

// START-6 (ADR 0010): a draw that fails in the overview stage keeps the checked read but no overview. A later draw of the same
// scan and focus with another channel reuses the read and draws the overview by a call. A success removes what was kept.
test('H150 [START-6, START-4, STORY-1] after an overview call failed, a draw with another channel reuses the read and draws the overview by a call, and once a draw succeeded the next one reads again', async ({ request }) => {
  test.setTimeout(300_000);
  const auth = await token(request);
  const project = await gitRepo('retry-overview');
  const docs = join(project.dir, 'docs');
  const scan = await scanFolder(request, auth, project.dir);
  const listedBefore = (await listedDiagrams(request)).map(d => d.id);
  const focus = { kind: 'typed', text: 'Explain the store [fixture:flaky:overview]' };
  const stageOf = (events: { event: string; data: any }[], stage: string) =>
    events.filter(e => e.event === 'progress' && e.data.stage === stage).map(e => String(e.data.message));

  // The overview call fails once for this folder: LinkedIn was chosen, nothing is written.
  const failedRun = await startDraw(request, auth, scan.id, focus, 'linkedin');
  const failed = await finishRun(request, failedRun, 'failed', 120_000);
  expect(failed.error).toContain('Fixture failure requested');
  expect(failed).toMatchObject({ diagramId: null, path: null });
  expect(stageOf(await runEvents(failedRun), 'read')).toContain('Reading the code');
  expect(await exists(docs), 'a failed draw writes nothing').toBe(false);
  expect((await listedDiagrams(request)).map(d => d.id)).toEqual(listedBefore);

  // The same scan and focus, README instead: the read is reused, the overview is drawn by a call.
  const secondRun = await startDraw(request, auth, scan.id, focus, 'readme');
  const second = await finishRun(request, secondRun, 'succeeded', 120_000);
  const events = await runEvents(secondRun);
  const read = stageOf(events, 'read'), overview = stageOf(events, 'overview'), channel = stageOf(events, 'channel');
  expect(read).toContain('Using the facts already read'); expect(read).toContain('Checking the facts');
  for (const line of ENGINE_LINES) expect(read, `no engine line "${line}" in the read stage`).not.toContain(line);
  expect(overview).toContain('Drawing the overview');
  expect(overview, 'no overview was kept, so none is reused').not.toContain('Using the overview already drawn');
  expect(overview.some(m => ENGINE_LINES.includes(m)), 'the overview was drawn by a call: engine lines in its stage').toBe(true);
  expect(channel).toContain('Drawing the README drawing');
  const doc = await getDocument(request, second.diagramId);
  expect(doc.channels.readme?.views?.length).toBe(1);
  expect(doc.channels.linkedin?.views ?? [], 'the failed draw\'s channel was never drawn').toHaveLength(0);
  expect(doc.warnings!.slice(0, 4)).toEqual(FOUR_WARNINGS);
  expect(samePath(second.path, join(docs, 'architecture.archdraw.json'))).toBe(true);
  expect(await exists(join(docs, 'architecture-2.archdraw.json'))).toBe(false);

  // The success removed the kept read: a third draw of the same scan and focus reads the code again.
  const thirdRun = await startDraw(request, auth, scan.id, focus, 'presentation');
  const third = await finishRun(request, thirdRun, 'succeeded', 120_000);
  const thirdEvents = await runEvents(thirdRun);
  const thirdRead = stageOf(thirdEvents, 'read');
  expect(thirdRead).toContain('Reading the code');
  expect(thirdRead).not.toContain('Using the facts already read');
  expect(stageOf(thirdEvents, 'overview')).not.toContain('Using the overview already drawn');
  expect(third.path).not.toBe(second.path);
  expect(await exists(join(docs, 'architecture-2.archdraw.json'))).toBe(true);
  expect((await listedDiagrams(request)).length).toBe(listedBefore.length + 2);
});
