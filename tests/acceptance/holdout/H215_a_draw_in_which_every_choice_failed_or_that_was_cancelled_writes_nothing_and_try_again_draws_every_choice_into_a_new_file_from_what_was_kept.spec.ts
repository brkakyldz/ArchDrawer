import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { option, typed, SLUG, ENGINE_LINES, readChoices } from './helpers-selections';
import {
  jobServer, scanOn, drawOn, awaitRun, runRec, runEventsOf, lines, diagramIds, states, registerDrawing, refineOn, until,
} from './helpers-jobs';

const SOLO = 'Solo [fixture:flaky:overview]', SOLO_ID = 'solo-fixture-flaky-overview';

// JOB-3, JOB-10, START-6, START-7 (api contract, *When every choice has ended*, *Trying again*, *What a failed draw keeps*): a draw in which every
// choice failed ends `failed` and writes nothing, as does a cancelled one, and Try again then draws every choice of it into a new file, the
// choices that finished from what was kept with no engine call. Try again is refused in the contracted order: unknown run, not a draw, still
// running, nothing left to try, a draw of the folder already running.
test('H215 [JOB-3 JOB-10 START-6 START-7 #196] a draw whose every choice failed, and a cancelled draw, write nothing, and Try again draws every choice into a new file from what was kept, with its refusals in the contracted order', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ slots: 1, stepMs: 200 });
  try {
    const reg = await registerDrawing(server, 'retry-editor');
    const registered = await diagramIds(server);

    // ---- Every choice failed: the run fails with the first choice's error and writes nothing.
    const p = await gitRepo('retry-all-failed'), scanP = await scanOn(server, { folder: p.dir });
    const failedId = await drawOn(server, scanP.id, [typed(SOLO)], 'readme');
    const failed = await awaitRun(server, failedId, 'failed');
    expect(states(failed)).toEqual([`${SOLO_ID}:failed`]);
    expect(failed.choices[0]).toMatchObject({ stage: 'overview' }); expect(failed.choices[0].error).toContain('Fixture failure requested');
    expect(failed.error, 'the first choice\'s error').toBe(failed.choices[0].error);
    expect(failed).toMatchObject({ diagramId: null, path: null, changes: null, layoutReport: null });
    expect(await exists(join(p.dir, 'docs'))).toBe(false); expect((await p.git(['status', '--porcelain'])).trim()).toBe('');
    expect(await diagramIds(server), 'no drawing registered').toEqual(registered);
    const failedEvents = await runEventsOf(server, failedId);
    expect(failedEvents.filter(e => e.event === 'done')).toHaveLength(1);
    expect(failedEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null, error: failed.error });
    expect(lines(failedEvents)).not.toContain('Writing the drawing');

    // Try again: every choice of the draw, into a new file; the read it had is reused.
    const retried = await server.post(`/api/runs/${failedId}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    const retryA = await runRec(server, retried.body.runId);
    expect(retryA).toMatchObject({ kind: 'draw', retryOf: failedId, into: null, scan: scanP.id, channel: 'readme' });
    expect(retryA.choices.map((c: { id: string }) => c.id)).toEqual([SOLO_ID]);
    const doneA = await awaitRun(server, retried.body.runId, 'succeeded');
    expect(lines(await runEventsOf(server, retried.body.runId), SOLO_ID, 'read')).toContain('Using the facts already read');
    expect((await readChoices(join(p.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual([SOLO_ID]);
    expect(await diagramIds(server)).toEqual([doneA.diagramId, ...registered]);

    // ---- A cancelled draw: the first choice finished, the second is cancelled in its read, the third never started.
    const q = await gitRepo('retry-cancelled'), scanQ = await scanOn(server, { folder: q.dir });
    const cancelledId = await drawOn(server, scanQ.id, [option('o2'), option('o3'), option('o1')], 'linkedin');
    await until(() => runRec(server, cancelledId), r => r.choices[0].status === 'done' && r.choices[1].status === 'running', 'the second choice to be running', 30_000, 50);
    expect((await server.post(`/api/runs/${cancelledId}/cancel`)).body).toEqual({ ok: true });
    const cancelled = await awaitRun(server, cancelledId, 'cancelled', 15_000);
    expect(states(cancelled)).toEqual([`${SLUG.o2}:done`, `${SLUG.o3}:cancelled`, `${SLUG.o1}:waiting`]);
    expect(cancelled).toMatchObject({ diagramId: null, path: null });
    expect(await exists(join(q.dir, 'docs'))).toBe(false); expect((await q.git(['status', '--porcelain'])).trim()).toBe('');

    // Try again after a cancel: all three choices, in their order, into a new file; the one that finished is not read again.
    const second = await server.post(`/api/runs/${cancelledId}/retry`);
    expect(second.status, JSON.stringify(second.body)).toBe(202);
    const retryId = second.body.runId as string;
    expect(await runRec(server, retryId)).toMatchObject({ retryOf: cancelledId, into: null, channel: 'linkedin' });
    expect((await runRec(server, retryId)).choices.map((c: { id: string }) => c.id)).toEqual([SLUG.o2, SLUG.o3, SLUG.o1]);

    // While it runs: a second Try again of the cancelled draw finds the folder busy and names the running draw; Try again of the running one is refused.
    expect(await server.post(`/api/runs/${cancelledId}/retry`)).toEqual({ status: 409, body: { error: 'A drawing of this folder is already being made', runId: retryId } });
    expect(await server.post(`/api/runs/${retryId}/retry`)).toMatchObject({ status: 409, body: { error: 'The draw is still running' } });
    const retry = await awaitRun(server, retryId, 'succeeded', 60_000);
    const events = await runEventsOf(server, retryId);
    expect(lines(events, SLUG.o2, 'read'), 'the finished choice goes through what was kept').toContain('Using the facts already read');
    for (const line of ENGINE_LINES) expect(lines(events, SLUG.o2), `no engine call for the finished choice: "${line}"`).not.toContain(line);
    expect(lines(events, SLUG.o1, 'read'), 'the choice that never started reads for the first time').toContain('Reading the code');
    expect(states(retry)).toEqual([`${SLUG.o2}:done`, `${SLUG.o3}:done`, `${SLUG.o1}:done`]);
    expect((await readChoices(join(q.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual([SLUG.o2, SLUG.o3, SLUG.o1]);

    // ---- The other refusals, in the contracted order.
    expect(await server.post('/api/runs/r_nothing_here/retry')).toEqual({ status: 404, body: { error: 'Run not found' } });
    const refineId = await refineOn(server, reg.id); await awaitRun(server, refineId, 'succeeded', 15_000);
    expect(await server.post(`/api/runs/${refineId}/retry`)).toEqual({ status: 400, body: { error: 'Only a draw can be tried again' } });
    expect(await server.post(`/api/runs/${retryId}/retry`), 'a draw that drew every choice').toEqual({ status: 400, body: { error: 'Every choice of this draw was drawn' } });
    expect(await server.post(`/api/runs/${retried.body.runId}/retry`)).toEqual({ status: 400, body: { error: 'Every choice of this draw was drawn' } });
  } finally { await server.stop(); }
});
