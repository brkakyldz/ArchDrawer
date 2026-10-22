import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, startDraw, finishRun, runEvents, listedDiagrams, exists } from './helpers';

const ENGINE_LINES = ['Reading the drawing', 'Reading the code', 'Updating the drawing'];

// START-6 (ADR 0010) with READ-2: what a failed draw kept is reused only by a draw of the same scan, the same trimmed focus, the same
// engine and the same model. Another focus or another model reads the code again, then shows `Checking the facts`. The channel is free.
// Every draw here fails at the channel call (`[fixture:fail:channel]` fails it every time), so the kept entry is never removed by a
// success: each step shows whether it was used or not, and nothing is ever written.
test('H154 [START-6, READ-2, START-4] after a failed draw a draw of the same scan with another focus or another model reads the code again and checks the facts, while the same trimmed focus, engine and model with another channel reuses the read, and nothing is ever written', async ({ request }) => {
  test.setTimeout(420_000);
  const auth = await token(request);
  const project = await gitRepo('retry-other-choice');
  const docs = join(project.dir, 'docs');
  const scan = await scanFolder(request, auth, project.dir);
  const listedBefore = (await listedDiagrams(request)).length;
  const stageOf = (events: { event: string; data: any }[], stage: string) =>
    events.filter(e => e.event === 'progress' && e.data.stage === stage).map(e => String(e.data.message));

  const focusA = { kind: 'typed', text: 'Explain the tool loop [fixture:fail:channel]' };
  const focusB = { kind: 'typed', text: 'Explain the store [fixture:fail:channel]' };
  const failing = async (focus: unknown, channel: string, model: string | null) => {
    const runId = await startDraw(request, auth, scan.id, focus, channel, { model });
    const run = await finishRun(request, runId, 'failed', 120_000);
    expect(run).toMatchObject({ status: 'failed', diagramId: null, path: null });
    expect(run.error, 'the channel call failed').toBeTruthy();
    const events = await runEvents(runId);
    return { events, read: stageOf(events, 'read'), overview: stageOf(events, 'overview'), channel: stageOf(events, 'channel') };
  };
  // A draw that started from the top: the engine read the code, the facts were checked, the overview was drawn by a call.
  const readsAgain = (r: Awaited<ReturnType<typeof failing>>, label: string) => {
    expect(r.read, `${label}: the engine reads the code`).toContain('Reading the code');
    expect(r.read, `${label}: the facts are checked`).toContain('Checking the facts');
    expect(r.read, `${label}: nothing of an earlier read is used`).not.toContain('Using the facts already read');
    expect(r.overview, `${label}: the overview is drawn`).toContain('Drawing the overview');
    expect(r.overview, `${label}: no earlier overview is used`).not.toContain('Using the overview already drawn');
    expect(r.overview.some(m => ENGINE_LINES.includes(m)), `${label}: the overview call made its engine lines`).toBe(true);
  };
  // A draw that started from the channel stage: no engine line in the read or the overview stage.
  const reuses = (r: Awaited<ReturnType<typeof failing>>, label: string) => {
    expect(r.read, `${label}: the kept read is used`).toContain('Using the facts already read');
    expect(r.read, `${label}: and checked again`).toContain('Checking the facts');
    for (const line of ENGINE_LINES) expect(r.read, `${label}: no engine line "${line}" in the read stage`).not.toContain(line);
    expect(r.overview, `${label}: the kept overview is used`).toContain('Using the overview already drawn');
    for (const line of ENGINE_LINES) expect(r.overview, `${label}: no engine line "${line}" in the overview stage`).not.toContain(line);
  };

  // 1. The first draw reads the code and fails at the channel; read and overview are kept (focus A, no model).
  const first = await failing(focusA, 'linkedin', null);
  readsAgain(first, 'first draw');
  expect(first.channel).toContain('Drawing the LinkedIn post');

  // 2. The same scan, focus and engine with another model: the kept read is not for this model. It reads again.
  const careful = await failing(focusA, 'linkedin', 'fixture-careful');
  readsAgain(careful, 'another model');
  expect(careful.events.some(e => e.event === 'progress' && e.data.message === 'Using model fixture-careful'), 'the model is the one asked for').toBe(true);

  // 3. That draw replaced the entry: the same focus with spaces around it, the same model and another channel reuses it.
  const padded = await failing({ kind: 'typed', text: `   ${focusA.text}  ` }, 'readme', 'fixture-careful');
  reuses(padded, 'the same trimmed focus, the same model, another channel');
  expect(padded.channel).toContain('Drawing the README drawing');

  // 4. Another focus with the same scan and the same model: reads again.
  const other = await failing(focusB, 'readme', 'fixture-careful');
  readsAgain(other, 'another focus');
  expect(other.channel).toContain('Drawing the README drawing');

  // 5. The same focus B with the other fixture model: the entry is for fixture-careful, so this reads again too.
  const fast = await failing(focusB, 'readme', 'fixture-fast');
  readsAgain(fast, 'another model, the second time');

  // 6. The entry now stands for focus B and fixture-fast: the same choices with the other channel reuse it. The reuse is the control
  //    that the keys are exactly the four named in the contract and nothing wider.
  const again = await failing(focusB, 'linkedin', 'fixture-fast');
  reuses(again, 'the same focus and model, the channel changed');
  expect(again.channel).toContain('Drawing the LinkedIn post');

  // Must not have happened: any file, any drawing in the library, any extra file name.
  expect(await exists(docs), 'no draw wrote anything').toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
});
