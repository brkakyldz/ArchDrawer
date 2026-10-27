import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, samePath, exists } from './helpers';
import { WHOLE, option, SLUG, OPTIONS, readChoices } from './helpers-selections';
import {
  jobServer, scanOn, drawOn, runRec, sampleRun, runEventsOf, activityOf, runningOf, states, until, ISO_MS, WAITING, ms,
} from './helpers-jobs';

// JOB-1, JOB-2, JOB-6, START-7 (api contract, *Engine slots*, *The draw run*, *Choice events*, ADR 0016): three engine processes at a time.
// A draw of four choices starts three at once and the fourth waits and says so; the first events of the stream are the contracted eight; the
// waiting one starts when a slot is free, never before one of the others has ended; one file holds all four in the order asked.
test('H209 [JOB-1 JOB-2 JOB-6 START-7 #196] a draw of four choices on three slots starts three side by side, the fourth waits and says so, starts when a slot is free, and one file holds all four in request order', async () => {
  test.setTimeout(240_000);
  const server = await jobServer({ slots: 3, stepMs: 300 });
  try {
    const project = await gitRepo('slots-three');
    const scan = await scanOn(server, { folder: project.dir });
    const wanted = [{ id: 'system', title: 'The whole system' }, { id: SLUG.o2, title: OPTIONS.o2.title }, { id: SLUG.o1, title: OPTIONS.o1.title }, { id: SLUG.o3, title: OPTIONS.o3.title }];

    const runId = await drawOn(server, scan.id, [WHOLE, option('o2'), option('o1'), option('o3')], 'linkedin');

    // The record at once: three choices running at their read, the fourth waiting with no start and no stage.
    const early = await runRec(server, runId);
    expect(early.choices.map((c: { id: string }) => c.id)).toEqual(wanted.map(w => w.id));
    expect(states(early)).toEqual(['system:running', `${SLUG.o2}:running`, `${SLUG.o1}:running`, `${SLUG.o3}:waiting`]);
    expect(early.choices.map((c: { stage: string | null }) => c.stage)).toEqual(['read', 'read', 'read', null]);
    for (const c of early.choices.slice(0, 3)) expect(c.startedAt, `${c.id} has started`).toMatch(ISO_MS);
    expect(early.choices[3]).toMatchObject({ startedAt: null, endedAt: null, error: null, filesRead: 0, parts: null });
    expect(early).toMatchObject({ kind: 'draw', status: 'running', waiting: false, writing: false });
    expect((await activityOf(server)).slots, 'three slots busy, one choice in the queue').toEqual({ total: 3, busy: 3, waiting: 1 });

    // The stream, from its first event: each choice in request order gets its line and its `choice` event.
    const samples = await sampleRun(server, runId, 100);
    const events = await runEventsOf(server, runId);
    const head = events.slice(0, 8);
    expect(head.map(e => e.event)).toEqual(['progress', 'choice', 'progress', 'choice', 'progress', 'choice', 'progress', 'choice']);
    wanted.slice(0, 3).forEach((w, i) => {
      expect(head[i * 2].data).toMatchObject({ message: `Drawing "${w.title}" (${i + 1} of 4)`, stage: 'read', choice: w.id, source: 'server' });
      expect(head[i * 2 + 1].data).toMatchObject({ id: w.id, status: 'running', stage: 'read' });
    });
    expect(head[6].data).toMatchObject({ message: WAITING, stage: null, choice: SLUG.o3, source: 'server' });
    expect(head[7].data).toMatchObject({ id: SLUG.o3, status: 'waiting', stage: null });
    for (const e of events.filter(x => x.event === 'progress')) { expect(e.data.at, e.data.message).toMatch(ISO_MS); expect(['engine', 'server']).toContain(e.data.source); }

    // The waiting choice takes a slot only after another choice ended: its line comes after a `done` record, then its `running` record.
    const fourth = events.findIndex(e => e.event === 'progress' && e.data.choice === SLUG.o3 && String(e.data.message).startsWith('Drawing "'));
    expect(fourth, 'the fourth choice starts').toBeGreaterThan(7);
    expect(events[fourth].data.message).toBe(`Drawing "${OPTIONS.o3.title}" (4 of 4)`);
    expect(events[fourth + 1]).toMatchObject({ event: 'choice', data: { id: SLUG.o3, status: 'running', stage: 'read' } });
    expect(events.slice(0, fourth).some(e => e.event === 'choice' && e.data.id !== SLUG.o3 && e.data.status === 'done'), 'a slot was freed first').toBe(true);

    // Never more than three running; three at once did happen; when the fourth ran, another choice had ended.
    expect(Math.max(...samples.map(runningOf))).toBeLessThanOrEqual(3);
    expect(samples[0].choices.filter((c: { status: string }) => c.status === 'running').length).toBe(3);
    const withFourth = samples.find(s => s.choices[3].status === 'running');
    if (withFourth) expect(withFourth.choices.some((c: { id: string; status: string }) => c.id !== SLUG.o3 && c.status === 'done'), 'a slot was freed first').toBe(true);

    // The end: everything done, one file in the order asked, the fourth started no earlier than the first end.
    const run = samples.at(-1)!;
    expect(run.status).toBe('succeeded');
    expect(states(run)).toEqual(wanted.map(w => `${w.id}:done`));
    expect(Math.min(...run.choices.slice(0, 3).map((c: { endedAt: string }) => ms(c.endedAt)))).toBeLessThanOrEqual(ms(run.choices[3].startedAt));
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    expect(samePath(run.path, file), run.path).toBe(true);
    expect((await readChoices(file)).choices.map(c => c.id), 'one file, the choices in request order').toEqual(wanted.map(w => w.id));
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'succeeded', diagramId: run.diagramId } });
    await until(() => activityOf(server), a => a.slots.busy === 0 && a.slots.waiting === 0, 'every slot to be free again', 15_000);
    expect((await activityOf(server)).slots).toEqual({ total: 3, busy: 0, waiting: 0 });
  } finally { await server.stop(); }
});
