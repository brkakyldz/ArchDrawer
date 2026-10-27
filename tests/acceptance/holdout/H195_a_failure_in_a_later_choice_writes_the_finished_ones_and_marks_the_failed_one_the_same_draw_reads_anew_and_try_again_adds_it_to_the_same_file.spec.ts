import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, listedDiagrams, exists, samePath, postJSON } from './helpers';
import {
  WHOLE, option, typed, SLUG, startDrawChoices, messagesOf, choiceStates, getRaw, choiceIds, viewIdsOf, type RunChoice,
} from './helpers-selections';

const FLAKY = 'Billing [fixture:flaky:second]';
const FLAKY_ID = 'billing-fixture-flaky-second';
const STUBBORN = 'Notes [fixture:fail:second]';
const STUBBORN_ID = 'notes-fixture-fail-second';

// START-7, START-6, JOB-3 (api contract, *The draw run*, *Trying again*, *What a failed draw keeps*, ADR 0016): a choice that fails ends alone
// and the others finish. The run is `succeeded`, the file holds the choices that finished and the record marks the failed one with its
// stage and error. What the draw wrote is not kept, so the same draw again reads every choice anew; the failed choice is tried again into
// the file the draw wrote, and one that fails every time fails that run, which writes nothing and leaves the file as it was.
test('H195 [START-7 START-6 STORY-1 READ-1 JOB-3 #181 #196] a failure in the second choice writes the finished choices and marks the failed one, the same draw again reads every choice anew, and a choice that fails every time is tried again into the same file and fails again without changing it', async ({ request }) => {
  test.setTimeout(480_000);
  const auth = await token(request);
  const lines = (events: { event: string; data: any }[], id: string, stage: string) => messagesOf(events, id, stage);
  const listedBefore = (await listedDiagrams(request)).length;

  // ---- A choice fails once: the first draw goes on without it, writes the other two and succeeds.
  const project = await gitRepo('draw-keeps');
  const control = await gitRepo('draw-keeps-control');
  const scan = await scanFolder(request, auth, project.dir);
  const choices = [WHOLE, typed(FLAKY), option('o2')];
  const firstId = await startDrawChoices(request, auth, scan.id, choices, 'linkedin');
  const first = await finishRun(request, firstId, 'succeeded', 240_000);
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
  const second = await finishRun(request, secondId, 'succeeded', 240_000);
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
  const cleanRun = await finishRun(request, await startDrawChoices(request, auth, (await scanFolder(request, auth, control.dir)).id, [WHOLE, typed('Billing'), option('o2')], 'linkedin'), 'succeeded', 240_000);
  const clean = await getRaw(request, cleanRun.diagramId);
  doc.choices.forEach((c, i) => expect(c.facts, c.id).toEqual(clean.choices[i].facts));
  expect((doc.warnings ?? []).map(w => w.replace(`${FLAKY}: `, 'Billing: '))).toEqual(clean.warnings ?? []);
  expect(doc.choices.map(c => viewIdsOf(c))).toEqual(clean.choices.map(c => viewIdsOf(c).map(v => v.replace('billing', FLAKY_ID))));

  // ---- A choice that fails every time: each draw writes the other two. Try again draws it into that file and fails again; the file is as it was.
  const other = await gitRepo('draw-keeps-other');
  const otherScan = await scanFolder(request, auth, other.dir);
  const stubborn = [WHOLE, typed(STUBBORN), option('o2')];
  const run = await finishRun(request, await startDrawChoices(request, auth, otherScan.id, stubborn, 'linkedin'), 'succeeded', 240_000);
  expect(choiceStates(run)).toEqual(['system:done', `${STUBBORN_ID}:failed`, `${SLUG.o2}:done`]);
  const otherFile = join(other.dir, 'docs', 'architecture.archdraw.json');
  expect(samePath(run.path, otherFile)).toBe(true);
  const written = await readFile(otherFile, 'utf8');
  expect(choiceIds(await getRaw(request, run.diagramId))).toEqual(['system', SLUG.o2]);
  const listedAfter = (await listedDiagrams(request)).length;

  const retry = await postJSON(request, auth, `/api/runs/${run.id}/retry`, {});
  expect(retry.status, JSON.stringify(retry.body)).toBe(202);
  const retried = await finishRun(request, retry.body.runId, 'failed', 240_000);
  expect(retried).toMatchObject({ kind: 'draw', retryOf: run.id, into: run.diagramId, status: 'failed', diagramId: null });
  expect(choiceStates(retried), 'the finished choices are not drawn again').toEqual([`${STUBBORN_ID}:failed`]);
  expect(retried.error).toContain('Fixture failure requested');
  const retryEvents = await runEvents(retry.body.runId);
  for (const id of ['system', SLUG.o2]) expect(messagesOf(retryEvents, id), `${id} is not part of the retry`).toEqual([]);
  expect(await readFile(otherFile, 'utf8'), 'the file is as the first draw wrote it').toBe(written);
  expect(await exists(join(other.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedAfter);
});
