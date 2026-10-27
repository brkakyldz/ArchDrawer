import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { option, typed, SLUG, readChoices } from './helpers-selections';
import {
  jobServer, scanOn, startScanOn, awaitRun, drawOn, runRec, scanRec, runEventsOf, activityOf, diagramIds, states, until, ms, lines, WAITING,
} from './helpers-jobs';

// JOB-10, JOB-1, START-7 (api contract, *Engine slots*, *Deadlines, a choice that fails, and cancel*): cancel stops the draw's running engine and
// frees its slot, takes its waiting choices out of the queue without starting them, writes nothing, and the next job in the queue starts at once.
// A waiting scan that is cancelled leaves the queue without ever starting an engine.
test('H212 [JOB-10 JOB-1 START-7 #196] cancelling a draw frees its slot for the next draw in the queue, its waiting choices never start, a cancelled waiting scan never starts an engine, and nothing is written', async () => {
  test.setTimeout(240_000);
  const server = await jobServer({ slots: 1, stepMs: 300 });
  try {
    const a = await gitRepo('cancel-a'), b = await gitRepo('cancel-b'), c = await gitRepo('cancel-c');
    const scanA = await scanOn(server, { folder: a.dir }), scanB = await scanOn(server, { folder: b.dir });
    const before = await diagramIds(server);

    // One slot, held by a slow read. Three more things queue behind it: two of its own choices, another folder's draw and a scan.
    const HOLD = 'Hold [fixture:slow]', HOLD_ID = 'hold-fixture-slow';
    const holdRun = await drawOn(server, scanA.id, [typed(HOLD), option('o2'), option('o3')], 'readme');
    const queuedRun = await drawOn(server, scanB.id, [option('o2')], 'readme');
    const cScanId = await startScanOn(server, { folder: c.dir });
    expect(states(await runRec(server, holdRun))).toEqual([`${HOLD_ID}:running`, `${SLUG.o2}:waiting`, `${SLUG.o3}:waiting`]);
    const queued = await runRec(server, queuedRun);
    expect(states(queued)).toEqual([`${SLUG.o2}:waiting`]); expect(queued.waiting, 'a draw whose choices all wait is waiting').toBe(true);
    const waitingScan = await until(() => scanRec(server, cScanId), r => r.waiting === true, 'the scan to wait', 15_000);
    expect(waitingScan.progress).toEqual([WAITING]);
    expect((await activityOf(server)).slots).toEqual({ total: 1, busy: 1, waiting: 4 });
    await until(() => runRec(server, holdRun), r => r.progress.some((l: string) => /^Working \d+\/30$/.test(l)), 'the slow read to count', 90_000);

    // Cancelling the waiting scan takes it out of the queue; no engine ever started for it.
    expect((await server.post(`/api/scans/${cScanId}/cancel`)).body).toEqual({ ok: true });
    const cancelledScan = await until(() => scanRec(server, cScanId), r => r.status !== 'running', 'the scan to be cancelled', 15_000);
    expect(cancelledScan).toMatchObject({ status: 'cancelled', card: null, options: null, waiting: false });
    expect(cancelledScan.progress, 'it never gathered anything').not.toContain('Gathering the repository');
    expect((await activityOf(server)).slots).toEqual({ total: 1, busy: 1, waiting: 3 });

    // Cancelling the draw: the running choice is cancelled, the waiting ones stay waiting, nothing is written.
    const cancelAt = Date.now();
    expect((await server.post(`/api/runs/${holdRun}/cancel`)).body).toEqual({ ok: true });
    const hold = await awaitRun(server, holdRun, 'cancelled', 60_000);
    expect(states(hold)).toEqual([`${HOLD_ID}:cancelled`, `${SLUG.o2}:waiting`, `${SLUG.o3}:waiting`]);
    expect(hold).toMatchObject({ diagramId: null, path: null, changes: null, writing: false });
    expect(hold.choices[1]).toMatchObject({ startedAt: null, endedAt: null, stage: null });
    const holdEvents = await runEventsOf(server, holdRun);
    for (const id of [SLUG.o2, SLUG.o3]) expect(lines(holdEvents, id), `${id} never started`).toEqual([WAITING]);
    expect(holdEvents.at(-1)).toMatchObject({ event: 'done', data: { status: 'cancelled', diagramId: null, path: null } });
    expect(lines(holdEvents)).not.toContain('Writing the drawing');
    expect(await exists(join(a.dir, 'docs'))).toBe(false); expect((await a.git(['status', '--porcelain'])).trim()).toBe('');

    // The freed slot went to the next in the queue: the other folder's draw runs now and writes its own file.
    const queuedDone = await awaitRun(server, queuedRun, 'succeeded', 90_000);
    expect(ms(queuedDone.choices[0].startedAt), 'it started only once the slot was freed').toBeGreaterThanOrEqual(cancelAt - 100);
    expect(states(queuedDone)).toEqual([`${SLUG.o2}:done`]);
    expect((await readChoices(join(b.dir, 'docs', 'architecture.archdraw.json'))).choices.map(x => x.id)).toEqual([SLUG.o2]);
    expect(await diagramIds(server), 'only the draw that finished registered a drawing').toEqual([queuedDone.diagramId, ...before]);
    await until(() => activityOf(server), x => x.slots.busy === 0 && x.slots.waiting === 0, 'every slot to be free again', 15_000);
  } finally { await server.stop(); }
});
