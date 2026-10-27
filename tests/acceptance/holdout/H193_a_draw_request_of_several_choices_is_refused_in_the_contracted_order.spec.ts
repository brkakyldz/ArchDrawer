import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, startDraw, listedDiagrams, exists, baseURL } from './helpers';
import { WHOLE, option, typed, refusedChoices, startDrawChoices } from './helpers-selections';

const SCAN = 'Scan the folder first: that scan is unknown or did not succeed';
const FOCUS = 'Unknown focus: use {"kind": "option" | "whole" | "typed"}';
const NONE = 'Choose what to draw: give 1 to 10 choices';
const BOTH = 'Give choices or focus, not both';
const CHANNEL = 'Choose the channel: linkedin, readme or presentation';

// START-7, SCAN-3 (api contract, *The draw run*): the checks of a draw come in a fixed order, each a 400 before any engine
// starts: the scan, its folder, choices or focus (not both, one to ten), each choice in order, duplicates, the channel, then the
// model and the engine. A request with `focus` in place of `choices` is the same as a list of that one choice.
test('H193 [START-7 SCAN-3 STORY-1 #181] a draw of several choices is refused with the first fault in the contracted order, a single focus still works as a list of one, and nothing is started or written', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('draw-choices-refusals');
  const scan = await scanFolder(request, auth, project.dir);
  const listedBefore = (await listedDiagrams(request)).length;
  const ask = (data: Record<string, unknown>) => refusedChoices(request, auth, data);
  const good = { scan: scan.id, choices: [WHOLE], channel: 'linkedin' };

  // 1. The scan comes first.
  expect(await ask({ scan: 's_unknown', choices: [{ kind: 'banana' }], focus: { kind: 'whole' }, channel: 'board', model: '--x' })).toEqual({ status: 400, error: SCAN });
  expect(await ask({ choices: [WHOLE], channel: 'linkedin' })).toEqual({ status: 400, error: SCAN });

  // 3. Choices or focus: not both, and one to ten of them. Both is the first fault whatever else is wrong.
  expect(await ask({ scan: scan.id, choices: [WHOLE], focus: { kind: 'whole' }, channel: 'linkedin' })).toEqual({ status: 400, error: BOTH });
  expect(await ask({ scan: scan.id, choices: [{ kind: 'banana' }], focus: { kind: 'banana' }, channel: 'board', model: '--x' })).toEqual({ status: 400, error: BOTH });
  for (const choices of [undefined, [], 'whole', {}, 7, Array.from({ length: 11 }, (_, i) => typed(`Question ${i}`))])
    expect(await ask({ scan: scan.id, ...(choices === undefined ? {} : { choices }), channel: 'board', model: '--x' }), JSON.stringify(choices)?.slice(0, 30)).toEqual({ status: 400, error: NONE });

  // 4. Each choice, in the order given: the first faulty one is reported, whatever follows it.
  expect(await ask({ ...good, choices: [WHOLE, { kind: 'banana' }] })).toEqual({ status: 400, error: FOCUS });
  expect(await ask({ ...good, choices: ['whole'] })).toEqual({ status: 400, error: FOCUS });
  expect(await ask({ ...good, choices: [{ kind: 'banana' }, option('o9'), typed('  ')] })).toEqual({ status: 400, error: FOCUS });
  expect(await ask({ ...good, choices: [option('o9'), { kind: 'banana' }] })).toEqual({ status: 400, error: 'Unknown focus option "o9"' });
  expect(await ask({ ...good, choices: [WHOLE, option('o4')] })).toEqual({ status: 400, error: 'Unknown focus option "o4"' }); // left out of the scan: its file is not there
  expect(await ask({ ...good, choices: [WHOLE, typed('   ')], channel: 'board' })).toEqual({ status: 400, error: 'Say what to focus on: the focus is empty' });
  expect(await ask({ ...good, choices: [option('o1'), typed('x'.repeat(301))] })).toEqual({ status: 400, error: 'The focus is too long (300 characters at most)' });
  expect(await ask({ ...good, choices: [typed('x'.repeat(301)), option('o9')] })).toEqual({ status: 400, error: 'The focus is too long (300 characters at most)' });
  // The single form is checked by the same words.
  expect(await ask({ scan: scan.id, focus: { kind: 'banana' }, channel: 'linkedin' })).toEqual({ status: 400, error: FOCUS });
  expect(await ask({ scan: scan.id, focus: { kind: 'option', option: 'o9' }, channel: 'linkedin' })).toEqual({ status: 400, error: 'Unknown focus option "o9"' });

  // 5. Duplicates, after every choice is valid on its own.
  expect(await ask({ ...good, choices: [WHOLE, WHOLE] })).toEqual({ status: 400, error: 'The whole system is chosen twice' });
  expect(await ask({ ...good, choices: [option('o1'), option('o2'), option('o1')] })).toEqual({ status: 400, error: 'The option "o1" is chosen twice' });
  expect(await ask({ ...good, choices: [typed('One question'), WHOLE, typed('Another question')] })).toEqual({ status: 400, error: 'Only one choice can be in your own words' });
  expect(await ask({ ...good, choices: [WHOLE, WHOLE, { kind: 'banana' }] }), 'a faulty choice comes before a duplicate').toEqual({ status: 400, error: FOCUS });
  expect(await ask({ ...good, choices: [WHOLE, WHOLE], channel: 'board', model: '--x' }), 'a duplicate comes before the channel').toEqual({ status: 400, error: 'The whole system is chosen twice' });

  // 6. The channel, then 7. the model and the engine.
  for (const channel of [undefined, 'overview', 'board', 7]) expect(await ask({ scan: scan.id, choices: [WHOLE, option('o2')], ...(channel === undefined ? {} : { channel }), model: '--x' }), String(channel)).toEqual({ status: 400, error: CHANNEL });
  expect(await ask({ ...good, choices: [WHOLE, option('o2')], model: '--x', engine: 'nope' })).toEqual({ status: 400, error: 'Invalid model name "--x"' });
  const engine = await ask({ ...good, choices: [option('o2'), option('o3')], engine: 'nope' }); expect(engine.status).toBe(400); expect(engine.error).toContain('Unknown engine "nope"');

  // A draw needs the token like any run.
  const noToken = await request.post(`${baseURL()}/api/runs`, { data: { kind: 'draw', ...good, engine: 'fixture', model: null } });
  expect(noToken.status()).toBe(403);
  // Must not happen: a refusal leaving anything behind.
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);

  // The old single focus still works: it is a list of one choice, and the run record says so.
  const runId = await startDraw(request, auth, scan.id, { kind: 'option', option: 'o2' }, 'linkedin');
  const run = await finishRun(request, runId, 'succeeded', 120_000);
  expect(run.choices.map((c: { id: string; kind: string; title: string; status: string }) => [c.id, c.kind, c.title, c.status])).toEqual([['the-agent-loop', 'section', 'The agent loop', 'done']]);
  expect(run.choice).toBe('the-agent-loop');
  // And a list of four valid choices is accepted.
  const second = await gitRepo('draw-choices-four'); const secondScan = await scanFolder(request, auth, second.dir);
  const four = await startDrawChoices(request, auth, secondScan.id, [WHOLE, option('o2'), option('o3'), option('o1')], 'readme');
  expect((await finishRun(request, four, 'succeeded', 240_000)).choices).toHaveLength(4);
});
