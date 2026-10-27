import { test, expect } from '@playwright/test';
import { gitRepo, samePath } from './helpers';
import { WHOLE, option, typed } from './helpers-selections';
import {
  jobServer, scanOn, startScanOn, awaitScan, drawOn, refineOn, registerDrawing, runRec, scanRec, activityOf, jobOf, watch, eventsOf, until,
  ISO_MS, HEX16, WAITING, ms,
} from './helpers-jobs';

const HOLD = 'Hold [fixture:slow]';

// JOB-7, JOB-5, START-4 (api contract, *Activity*, *Scans*): `GET /api/activity` lists every scan and draw that is running or ended within the
// keep time, newest first, each as its record with `type` and `events` added; a scan that waits for a slot is listed as running and waiting;
// an instruction run of the editor is no job; a listed job's events replay from the start; a finished scan keeps its card and options; a second
// scan of a folder being scanned is refused with the running scan's id, and a second draw with the running draw's.
test('H220 [JOB-7 JOB-5 START-4 #195] the activity list shows a running draw, a waiting scan and a finished scan with their fields and event streams, leaves out instruction runs, and a second scan or draw of a busy folder is refused naming the job to follow', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ slots: 1, stepMs: 300 });
  try {
    const a = await gitRepo('activity-a'), b = await gitRepo('activity-b');
    const reg = await registerDrawing(server, 'activity-editor');
    const empty = await activityOf(server);
    expect(empty).toMatchObject({ jobs: [], slots: { total: 1, busy: 0, waiting: 0 }, timeoutMs: 1_200_000 });
    expect(empty.instance).toMatch(HEX16); expect(empty.now).toMatch(ISO_MS);

    const s1 = await scanOn(server, { folder: a.dir });
    const drawId = await drawOn(server, s1.id, [typed(HOLD), option('o2')], 'linkedin');
    await until(() => runRec(server, drawId), r => r.progress.some((l: string) => /^Working \d+\/30$/.test(l)), 'the slow read to count', 30_000);

    // Another folder: its scan waits for the only slot, behind the draw's second choice; it is running, not failed or refused.
    const bScanId = await startScanOn(server, { folder: b.dir });
    await until(() => scanRec(server, bScanId), r => r.waiting === true, 'the scan to wait', 15_000);
    const refineId = await refineOn(server, reg.id);
    await until(() => runRec(server, refineId), r => r.waiting === true, 'the instruction run to wait', 15_000);

    // A second scan of the folder being scanned, and a second draw of the folder being drawn, name what to follow.
    expect(await server.post('/api/scans', { folder: b.dir, engine: 'fixture', model: null })).toEqual({ status: 409, body: { error: 'A scan of this folder is already running', scanId: bScanId } });
    expect(await server.post('/api/runs', { kind: 'draw', scan: s1.id, choices: [WHOLE], channel: 'linkedin', engine: 'fixture', model: null }))
      .toEqual({ status: 409, body: { error: 'A drawing of this folder is already being made', runId: drawId } });

    // The list.
    const act = await activityOf(server);
    expect(act.instance).toMatch(HEX16); expect(act.instance, 'the same server process answers with the same instance').toBe(empty.instance);
    expect(act.now).toMatch(ISO_MS); expect(act.timeoutMs).toBe(1_200_000);
    expect(act.slots, 'the slow read, and the draw\'s second choice, the scan and the instruction run in the queue').toEqual({ total: 1, busy: 1, waiting: 3 });
    expect(act.jobs.map((j: { id: string }) => j.id), 'newest first; instruction runs are no job').toEqual([bScanId, drawId, s1.id]);
    expect(jobOf(act, refineId)).toBeUndefined();
    const createds = act.jobs.map((j: { createdAt: string }) => ms(j.createdAt));
    expect(createds).toEqual([...createds].sort((x, y) => y - x));

    const waitingScan = jobOf(act, bScanId);
    expect(waitingScan).toMatchObject({ type: 'scan', events: `/api/scans/${bScanId}/events`, status: 'running', waiting: true, startedAt: null, endedAt: null, card: null, options: null, link: null });
    expect(waitingScan.progress[0]).toBe(WAITING);
    const draw = jobOf(act, drawId);
    expect(draw).toMatchObject({ type: 'draw', kind: 'draw', events: `/api/runs/${drawId}/events`, status: 'running', writing: false, scan: s1.id, name: s1.card.name, link: null, endedAt: null, channel: 'linkedin' });
    expect(samePath(draw.folder, a.dir)).toBe(true); expect(samePath(draw.root, a.dir)).toBe(true);
    expect(draw.choices.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(['hold-fixture-slow:running', 'the-agent-loop:waiting']);
    // A finished scan is listed with its card and options, and is exactly the record the scan answers with, plus its type and its stream.
    const finished = jobOf(act, s1.id);
    expect(finished).toMatchObject({ type: 'scan', events: `/api/scans/${s1.id}/events`, status: 'succeeded', cached: false, link: null });
    expect(finished.card).toEqual(s1.card); expect(finished.options).toEqual(s1.options); expect(finished.endedAt).toMatch(ISO_MS);
    const { type: _type, events: _events, ...record } = finished;
    expect(record).toEqual(await scanRec(server, s1.id));

    // A listed job's stream replays the past, then goes on: the draw's own first lines and records, the scan's lines and its done event.
    const live = watch(server, draw.events);
    await live.wait(e => e.some(x => x.event === 'progress' && /^Working \d+\/30$/.test(x.data.message)), 'the replayed lines of the draw', 15_000);
    expect(live.events[0]).toMatchObject({ event: 'progress', data: { message: `Drawing "${HOLD}" (1 of 2)`, stage: 'read', choice: 'hold-fixture-slow', source: 'server' } });
    expect(live.events[1]).toMatchObject({ event: 'choice', data: { id: 'hold-fixture-slow', status: 'running' } });
    expect(live.events.some(e => e.event === 'choice' && e.data.id === 'the-agent-loop' && e.data.status === 'waiting'), 'the choice that waits is replayed too').toBe(true);
    expect(live.events.filter(e => e.event === 'done'), 'a running job has not said done').toEqual([]);
    live.stop();
    const past = await eventsOf(server, finished.events);
    expect(past.at(-1)).toMatchObject({ event: 'done', data: { status: 'succeeded', cached: false, link: null } });
    expect(past.at(-1)!.data.card).toEqual(s1.card); expect(past.at(-1)!.data.options).toEqual(s1.options);

    // Cancel what is waiting and what is running: both stay listed, ended, with their last state; the slot is free.
    await server.post(`/api/scans/${bScanId}/cancel`); await server.post(`/api/runs/${refineId}/cancel`); await server.post(`/api/runs/${drawId}/cancel`);
    await until(() => activityOf(server), x => x.slots.busy === 0 && x.slots.waiting === 0 && x.jobs.every((j: { status: string }) => j.status !== 'running'), 'every job to have ended', 15_000);
    const after = await activityOf(server);
    expect(jobOf(after, drawId)).toMatchObject({ status: 'cancelled', waiting: false });
    expect(jobOf(after, bScanId)).toMatchObject({ status: 'cancelled', card: null });
    expect(jobOf(after, drawId).endedAt).toMatch(ISO_MS); expect(jobOf(after, bScanId).endedAt).toMatch(ISO_MS);
    expect(jobOf(after, refineId), 'still no job').toBeUndefined();
    expect((await eventsOf(server, jobOf(after, drawId).events)).at(-1)).toMatchObject({ event: 'done', data: { status: 'cancelled' } });
    expect((await eventsOf(server, jobOf(after, bScanId).events)).at(-1)).toMatchObject({ event: 'done', data: { status: 'cancelled', card: null } });

    // A newer success forgets the older scans of the folder: once the draw has ended its first scan is replaced and no longer listed.
    const newer = await awaitScan(server, await startScanOn(server, { folder: a.dir }, { refresh: true }), 'succeeded', 30_000);
    const last = await activityOf(server);
    expect(jobOf(last, newer.id)).toMatchObject({ type: 'scan', status: 'succeeded' });
    expect(jobOf(last, s1.id), 'the older scan of the folder is forgotten').toBeUndefined();
    expect((await server.get(`/api/scans/${s1.id}`))).toEqual({ status: 404, body: { error: 'Scan not found' } });
    expect(jobOf(last, drawId), 'the draw that ran from it is still listed').toBeDefined();
  } finally { await server.stop(); }
});
