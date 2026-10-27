import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo } from './helpers';
import { option, SLUG, OPTIONS, readChoices } from './helpers-selections';
import {
  jobServer, scanOn, startScanOn, awaitScan, awaitRun, drawOn, refineOn, registerDrawing, runRec, scanRec, sampleRun, runEventsOf, activityOf,
  runningOf, states, until, WAITING, ms, lines,
} from './helpers-jobs';

// JOB-1, JOB-5, START-7 (api contract, *Engine slots*: the queue is one for the whole server and first come first served; a scan whose result
// is cached takes no slot; an instruction run of the editor holds one): with one slot a draw of three choices goes one after another, a scan of
// another folder and an instruction run on another drawing wait behind the choices that asked first, say so, and take the slot in that order.
test('H210 [JOB-1 JOB-5 START-7 #196] with one slot the choices of a draw, a scan of another folder and an instruction run go one after another in the order they asked, each waiting one says so, and a cached scan takes no slot', async () => {
  test.setTimeout(300_000);
  const server = await jobServer({ slots: 1, stepMs: 400 });
  try {
    const a = await gitRepo('one-slot-a'), b = await gitRepo('one-slot-b');
    const scanA = await scanOn(server, { folder: a.dir });
    const reg = await registerDrawing(server, 'one-slot-editor');

    const runId = await drawOn(server, scanA.id, [option('o2'), option('o3'), option('o1')], 'readme');
    const first = await runRec(server, runId);
    expect(states(first)).toEqual([`${SLUG.o2}:running`, `${SLUG.o3}:waiting`, `${SLUG.o1}:waiting`]);
    expect((await activityOf(server)).slots, 'one engine, two choices queued').toEqual({ total: 1, busy: 1, waiting: 2 });

    // A scan of the folder just scanned is cached: it ends at once, holds no slot and is not queued behind the draw.
    const cachedId = await startScanOn(server, { folder: a.dir });
    const cached = await scanRec(server, cachedId);
    expect(cached).toMatchObject({ status: 'succeeded', cached: true, waiting: false });
    expect(cached.progress, 'its only line').toEqual([expect.stringMatching(/^Scanned before at [0-9a-f]{7,40}$/)]);
    expect((await activityOf(server)).slots, 'a cached scan neither takes a slot nor waits for one').toEqual({ total: 1, busy: 1, waiting: 2 });

    // A scan of another folder that needs an engine waits, and says so, behind the two choices; so does an instruction run on another drawing.
    const bScanId = await startScanOn(server, { folder: b.dir });
    const waitingScan = await until(() => scanRec(server, bScanId), r => r.waiting === true, 'the second scan to wait', 15_000);
    expect(waitingScan).toMatchObject({ status: 'running', waiting: true, startedAt: null, card: null });
    expect(waitingScan.progress[0]).toBe(WAITING); expect(waitingScan.progress).not.toContain('Gathering the repository');
    const refineId = await refineOn(server, reg.id);
    const waitingRun = await until(() => runRec(server, refineId), r => r.waiting === true, 'the instruction run to wait', 15_000);
    expect(waitingRun).toMatchObject({ kind: 'refine', status: 'running', waiting: true, startedAt: null });
    expect(waitingRun.progress[0]).toBe(WAITING);
    expect((await activityOf(server)).slots).toEqual({ total: 1, busy: 1, waiting: 4 });

    // Everything ends. At no moment is a choice running while the one before it has not finished.
    const samples = await sampleRun(server, runId, 80);
    expect(Math.max(...samples.map(runningOf)), 'one engine at a time').toBeLessThanOrEqual(1);
    for (const s of samples) for (let i = 1; i < 3; i++)
      if (s.choices[i].status === 'running') expect(s.choices[i - 1].status, `choice ${i + 1} runs only after choice ${i}`).toBe('done');
    const run = samples.at(-1)!;
    expect(run.status).toBe('succeeded'); expect(states(run)).toEqual([`${SLUG.o2}:done`, `${SLUG.o3}:done`, `${SLUG.o1}:done`]);
    const doneScan = await awaitScan(server, bScanId), doneRefine = await awaitRun(server, refineId);

    // First come, first served: the three choices, then the scan, then the instruction run.
    const starts = [...run.choices.map((c: { startedAt: string }) => ms(c.startedAt)), ms(doneScan.startedAt), ms(doneRefine.startedAt)];
    expect(starts.every(Number.isFinite), JSON.stringify(starts)).toBe(true);
    expect(starts, 'the order they asked in').toEqual([...starts].sort((x, y) => x - y));
    expect(ms(doneScan.startedAt), 'the scan took its slot after the last choice had one').toBeGreaterThan(ms(run.choices[2].startedAt));
    expect(doneScan.progress.indexOf('Gathering the repository')).toBeGreaterThan(doneScan.progress.indexOf(WAITING));
    expect(doneScan.card).not.toBeNull();

    // The stream of the draw: the two choices that waited say so once, with their choice and no stage; the first does not.
    const events = await runEventsOf(server, runId);
    expect(lines(events, SLUG.o2)).not.toContain(WAITING);
    for (const id of [SLUG.o3, SLUG.o1]) {
      const waits = events.filter(e => e.event === 'progress' && e.data.choice === id && e.data.message === WAITING);
      expect(waits, id).toHaveLength(1); expect(waits[0].data).toMatchObject({ stage: null, source: 'server' });
    }
    expect(lines(events, SLUG.o1).find(l => l.startsWith('Drawing "'))).toBe(`Drawing "${OPTIONS.o1.title}" (3 of 3)`);

    // Must not happen: a lost or doubled choice; one file in the order asked.
    expect((await readChoices(join(a.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id)).toEqual([SLUG.o2, SLUG.o3, SLUG.o1]);
    await until(() => activityOf(server), x => x.slots.busy === 0 && x.slots.waiting === 0, 'every slot to be free again', 15_000);
  } finally { await server.stop(); }
});
