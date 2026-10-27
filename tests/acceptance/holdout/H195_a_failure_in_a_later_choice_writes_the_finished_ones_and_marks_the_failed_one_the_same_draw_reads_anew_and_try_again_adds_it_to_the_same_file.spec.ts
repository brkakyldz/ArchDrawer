import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, listedDiagrams, exists, samePath } from './helpers';
import {
  WHOLE, option, typed, SLUG, startDrawChoices, messagesOf, choiceStates, getRaw, choiceIds, viewIdsOf, type RunChoice,
} from './helpers-selections';

const FLAKY = 'Billing [fixture:flaky:second]';
const FLAKY_ID = 'billing-fixture-flaky-second';

// START-7, START-6, JOB-3 (api contract, *The draw run*, *Trying again*, *What a failed draw keeps*, ADR 0016): a choice that fails ends alone
// and the others finish. The run is `succeeded`, the file holds the choices that finished and the record marks the failed one with its
// stage and error. What the draw wrote is not kept, so the same draw again reads every choice anew and draws what a draw that never failed
// draws. (A choice that fails every time, tried again into the same file, is H252.)
test('H195 [START-7 START-6 STORY-1 READ-1 JOB-3 #181 #196] a failure in the second choice writes the finished choices and marks the failed one, and the same draw again reads every choice anew and draws what a draw that never failed draws', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const lines = (events: { event: string; data: any }[], id: string, stage: string) => messagesOf(events, id, stage);
  const listedBefore = (await listedDiagrams(request)).length;

  // ---- A choice fails once: the first draw goes on without it, writes the other two and succeeds.
  const project = await gitRepo('draw-keeps');
  const control = await gitRepo('draw-keeps-control');
  const scan = await scanFolder(request, auth, project.dir);
  const choices = [WHOLE, typed(FLAKY), option('o2')];
  const firstId = await startDrawChoices(request, auth, scan.id, choices, 'linkedin');
  const first = await finishRun(request, firstId, 'succeeded', 30_000);
  expect(choiceStates(first), 'the second failed, the others finished').toEqual(['system:done', `${FLAKY_ID}:failed`, `${SLUG.o2}:done`]);
  expect((first.choices as RunChoice[]).map(c => c.stage)).toEqual(['channel', 'read', 'channel']);
  expect((first.choices as { error: string | null }[]).map(c => c.error)).toEqual([null, expect.stringContaining('Fixture failure requested'), null]);
  expect(first).toMatchObject({ status: 'succeeded', choice: 'system', channel: 'linkedin' });
  const firstEvents = await runEvents(firstId);
  expect(messagesOf(firstEvents, FLAKY_ID)[0]).toBe(`Drawing "${FLAKY}" (2 of 3)`);
  expect(messagesOf(firstEvents, FLAKY_ID).some(m => m.startsWith(`Could not draw "${FLAKY}": `)), 'the failure is said once, with its choice').toBe(true);
  for (const id of ['system', SLUG.o2]) {
    expect(lines(firstEvents, id, 'read'), `${id} was read`).toContain('Reading the code');
    expect(messagesOf(firstEvents, id).some(m => m.startsWith('Could not draw')), `${id} did not fail`).toBe(false);
  }
  // The file holds the choices that finished, in request order; the failed one is in none of it.
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  expect(samePath(first.path, file)).toBe(true);
  const firstDoc = await getRaw(request, first.diagramId);
  expect(choiceIds(firstDoc)).toEqual(['system', SLUG.o2]);
  expect(JSON.stringify(firstDoc).includes(FLAKY_ID)).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);

  // The same draw again: what the first one wrote is not kept, so every choice reads again (the failed one now answers as usual). A new file.
  const secondId = await startDrawChoices(request, auth, scan.id, choices, 'linkedin');
  const second = await finishRun(request, secondId, 'succeeded', 30_000);
  expect(choiceStates(second)).toEqual(['system:done', `${FLAKY_ID}:done`, `${SLUG.o2}:done`]);
  const events = await runEvents(secondId);
  for (const id of ['system', FLAKY_ID, SLUG.o2]) {
    expect(lines(events, id, 'read'), `${id} reads for the first time`).toContain('Reading the code');
    expect(messagesOf(events, id), `${id}: nothing of an earlier read is used`).not.toContain('Using the facts already read');
  }
  expect(samePath(second.path, join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(true);
  expect(await exists(join(project.dir, 'docs', 'architecture-3.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 2);
  const doc = await getRaw(request, second.diagramId);
  expect(choiceIds(doc)).toEqual(['system', FLAKY_ID, SLUG.o2]);

  // It is the drawing of a draw that never failed: the same facts and the same warnings (titles apart), the same view ids (names apart).
  const cleanRun = await finishRun(request, await startDrawChoices(request, auth, (await scanFolder(request, auth, control.dir)).id, [WHOLE, typed('Billing'), option('o2')], 'linkedin'), 'succeeded', 30_000);
  const clean = await getRaw(request, cleanRun.diagramId);
  doc.choices.forEach((c, i) => expect(c.facts, c.id).toEqual(clean.choices[i].facts));
  expect((doc.warnings ?? []).map(w => w.replace(`${FLAKY}: `, 'Billing: '))).toEqual(clean.warnings ?? []);
  expect(doc.choices.map(c => viewIdsOf(c))).toEqual(clean.choices.map(c => viewIdsOf(c).map(v => v.replace('billing', FLAKY_ID))));
});
