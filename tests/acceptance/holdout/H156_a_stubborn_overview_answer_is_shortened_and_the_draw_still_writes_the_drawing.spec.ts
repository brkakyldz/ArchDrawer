import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, listedDiagrams, exists, samePath, viewOf, baseURL } from './helpers';
import { getDocument, startDrawChoices, typed } from './helpers-selections'; // a draw writes format 4: getDocument gives the drawn choice in the shape the scenario was written in

const OVERLONG_START = 'Drawn by the test engine, with a description written far past the limit a story answer may hold.';
const SHORTENED = 'Shortened the description to 240 characters';
const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found', 'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped', 'Dropped "ghost-limit": its component "ghost" was dropped',
];

// STORY-7 (ADR 0009) in a draw: the overview answer of a draw stays over the lede's limit after its one repair turn. A length
// never fails a run: the text is shortened to 240 characters with `…`, one warning, and the draw goes on to the channel, writes the
// file and registers it. The draw is started over the API; the same draw from the home screen (`Ready`, `Open`) is H121, H249 and H237.
test('H156 [STORY-7, STORY-1, #181] a draw whose overview answer stays over its limit after the repair turn is shortened to 240 characters with one warning and still writes and registers the drawing', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('story-home-stubborn');
  const listedBefore = (await listedDiagrams(request)).length;
  const focus = 'The tool loop [fixture:overlong][fixture:stubborn]';

  const scan = await scanFolder(request, auth, project.dir);
  const runId = await startDrawChoices(request, auth, scan.id, [typed(focus)], 'linkedin');
  const finished = await finishRun(request, runId, 'succeeded');
  expect(finished.choices.map((c: { status: string }) => c.status), 'no choice could not be drawn').toEqual(['done']);

  // The events: one repair turn in the overview stage, never a second, one overview call, and the run went on to the channel.
  const events = (await runEvents(runId)).filter(e => e.event === 'progress');
  const messages = events.map(e => e.data.message as string);
  const fixing = events.filter(e => String(e.data.message).startsWith('Fixing'));
  expect(fixing, 'one repair turn and no second').toHaveLength(1);
  expect(fixing[0].data).toMatchObject({ message: 'Fixing 1 problem in the answer', stage: 'overview' });
  expect(messages.filter(m => m === 'Drawing the overview'), 'the overview is drawn once').toHaveLength(1);
  expect(messages.indexOf('Fixing 1 problem in the answer')).toBeGreaterThan(messages.indexOf('Drawing the overview'));
  expect(messages.indexOf('Fixing 1 problem in the answer')).toBeLessThan(messages.indexOf('Drawing the LinkedIn post'));
  expect(events.slice(messages.indexOf('Fixing 1 problem in the answer') + 1).some(e => e.data.stage === 'overview'), 'the repair turn shows its engine lines in the overview stage').toBe(true);
  expect(events.filter(e => e.data.stage === 'channel').some(e => String(e.data.message).startsWith('Fixing')), 'the channel call needed none').toBe(false);

  // The run: succeeded, written under docs, registered once.
  const run = await (await request.get(`${baseURL()}/api/runs/${runId}`)).json();
  expect(run).toMatchObject({ status: 'succeeded', kind: 'draw', channel: 'linkedin', error: null });
  expect(run.path && await exists(run.path)).toBe(true);
  expect(samePath(run.path, join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);

  // The drawing: the engine's own text, cut at the limit, with exactly one warning for it; nothing else cut.
  const doc = await getDocument(request, run.diagramId);
  const lede = viewOf(doc, 'overview')!.caption.lede;
  expect(lede.length, 'cut to the file\'s limit').toBe(240);
  expect(lede.endsWith('…')).toBe(true);
  expect(lede.startsWith(OVERLONG_START), 'it is the engine\'s own text, cut').toBe(true);
  expect((doc.warnings ?? []).filter(w => /^Shortened/.test(w)), 'exactly one warning for the length').toEqual([SHORTENED]);
  expect(doc.warnings!.slice(0, 4), 'the read\'s warnings come first, in stage order').toEqual(FOUR_WARNINGS);
  expect(doc.warnings!.indexOf(SHORTENED)).toBeGreaterThan(3);
  expect(new Set(doc.warnings).size, 'no warning twice').toBe(doc.warnings!.length);
  expect(viewOf(doc, 'overview')!.caption.title).not.toContain('…');
  // The channel call was not affected by the overview's markers.
  const post = viewOf(doc, 'linkedin')!;
  expect(post.caption.lede).toBe('A request enters the app, is checked, and produces a result.');
  expect(post.nodes.length).toBeGreaterThan(0);
  expect(doc.facts.components.map(c => c.id)).toContain('agent');

  // Must not have happened: a second file, or a shortening warning shown as an error.
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
});
