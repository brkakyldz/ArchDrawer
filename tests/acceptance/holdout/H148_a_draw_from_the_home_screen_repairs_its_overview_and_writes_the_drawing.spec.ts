import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, listedDiagrams, exists, samePath, viewOf, baseURL } from './helpers';
import { getDocument, startDrawChoices, typed } from './helpers-selections'; // a draw writes format 4: getDocument gives the drawn choice in the shape the scenario was written in

const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found', 'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped', 'Dropped "ghost-limit": its component "ghost" was dropped',
];

// STORY-7 (ADR 0009) in a draw: the overview call of a draw has an answer with an over-long description. The repair turn
// belongs to the overview stage, the draw goes on to the channel and ends in a written drawing, with the engine's own text.
// The draw is started over the API; the same draw from the home screen (`Ready`, `Open`, the editor) is H121, H249 and H237.
test('H148 [STORY-7, STORY-1, #181] a draw whose overview answer is over-long gets one repair turn in the overview stage and ends in a written drawing with the engine\'s own description and no Shortened warning', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('story-home-repair');
  const listedBefore = (await listedDiagrams(request)).length;

  const scan = await scanFolder(request, auth, project.dir);
  const runId = await startDrawChoices(request, auth, scan.id, [typed('The tool loop [fixture:overlong]')], 'linkedin');
  await finishRun(request, runId, 'succeeded');

  // The events: one `Fixing 1 problem in the answer`, in the overview stage, after the read and before the channel.
  const events = (await runEvents(runId)).filter(e => e.event === 'progress');
  const messages = events.map(e => e.data.message as string);
  const fixing = events.filter(e => String(e.data.message).startsWith('Fixing'));
  expect(fixing).toHaveLength(1);
  expect(fixing[0].data).toMatchObject({ message: 'Fixing 1 problem in the answer', stage: 'overview' });
  const at = messages.indexOf('Fixing 1 problem in the answer');
  expect(at).toBeGreaterThan(messages.indexOf('Checking the facts'));
  expect(at).toBeGreaterThan(messages.indexOf('Drawing the overview'));
  expect(at).toBeLessThan(messages.indexOf('Drawing the LinkedIn post'));
  expect(events.slice(at + 1).find(e => e.data.stage === 'overview'), 'the repair turn shows its engine lines in the overview stage').toBeTruthy();
  expect(events.filter(e => e.data.stage === 'channel').some(e => String(e.data.message).startsWith('Fixing')), 'the channel call needed none').toBe(false);
  expect(messages.some(m => m.startsWith('Shortened'))).toBe(false);

  // The drawing: written, registered, with the repaired overview description.
  const run = await (await request.get(`${baseURL()}/api/runs/${runId}`)).json();
  expect(run).toMatchObject({ status: 'succeeded', kind: 'draw', channel: 'linkedin', error: null });
  expect(run.path && await exists(run.path)).toBe(true);
  expect(samePath(run.path, join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true);
  const doc = await getDocument(request, run.diagramId);
  expect(viewOf(doc, 'overview')!.caption.lede).toBe('Drawn by the test engine.');
  expect(doc.warnings!.slice(0, 4)).toEqual(FOUR_WARNINGS);
  expect((doc.warnings ?? []).filter(w => /^Shortened/.test(w)), 'no warning for the length').toEqual([]);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
});
