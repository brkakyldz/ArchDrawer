import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitRepo, scanFolder, finishRun, runEvents, listedDiagrams, exists, samePath, postJSON } from './helpers';
import { WHOLE, option, typed, SLUG, startDrawChoices, messagesOf, choiceStates, getRaw, choiceIds } from './helpers-selections';
import { jobServer } from './helpers-jobs';

// A typed `[fixture:fail]` fails that choice's read every time, whatever its place in the run (testing contract, *Draw*), so it also fails in
// the retry, where it is the run's first and only choice.
const STUBBORN = 'Notes [fixture:fail]';
const STUBBORN_ID = 'notes-fixture-fail';

// START-7, START-6, JOB-3 (api contract, *The draw run*, *Trying again*, ADR 0016): a choice that fails every time ends alone; the draw writes
// the other two and succeeds. Try again draws only that choice, into the file the draw wrote, and fails again: the retry run fails, draws
// none of the finished choices, writes nothing, and the file is as the draw wrote it. (Moved out of H195, original L72–94, onto a server of its own.)
test('H252 [START-7 START-6 JOB-3 #196] a choice that fails every time is tried again into the same file and fails again, drawing none of the finished choices and leaving the file as it was', async ({ request }) => {
  test.setTimeout(60_000);
  const server = await jobServer({ stepMs: 100 });
  try {
    const auth = server.token, base = server.base;
    const other = await gitRepo('draw-keeps-other');
    const otherScan = await scanFolder(request, auth, other.dir, {}, base);
    const stubborn = [WHOLE, typed(STUBBORN), option('o2')];
    const run = await finishRun(request, await startDrawChoices(request, auth, otherScan.id, stubborn, 'linkedin', {}, base), 'succeeded', 30_000, base);
    expect(choiceStates(run)).toEqual(['system:done', `${STUBBORN_ID}:failed`, `${SLUG.o2}:done`]);
    const otherFile = join(other.dir, 'docs', 'architecture.archdraw.json');
    expect(samePath(run.path, otherFile)).toBe(true);
    const written = await readFile(otherFile, 'utf8');
    expect(choiceIds(await getRaw(request, run.diagramId, base))).toEqual(['system', SLUG.o2]);
    const listedAfter = (await listedDiagrams(request, base)).length;

    const retry = await postJSON(request, auth, `/api/runs/${run.id}/retry`, {}, base);
    expect(retry.status, JSON.stringify(retry.body)).toBe(202);
    const retried = await finishRun(request, retry.body.runId, 'failed', 30_000, base);
    expect(retried).toMatchObject({ kind: 'draw', retryOf: run.id, into: run.diagramId, status: 'failed', diagramId: null });
    expect(choiceStates(retried), 'the finished choices are not drawn again').toEqual([`${STUBBORN_ID}:failed`]);
    expect(retried.error).toContain('Fixture failure requested');
    const retryEvents = await runEvents(retry.body.runId, base);
    for (const id of ['system', SLUG.o2]) expect(messagesOf(retryEvents, id), `${id} is not part of the retry`).toEqual([]);
    expect(await readFile(otherFile, 'utf8'), 'the file is as the first draw wrote it').toBe(written);
    expect(await exists(join(other.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    expect((await listedDiagrams(request, base)).length).toBe(listedAfter);
  } finally { await server.stop(); }
});
