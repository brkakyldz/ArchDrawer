import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { option, typed, SLUG, OPTIONS, readChoices } from './helpers-selections';
import {
  jobServer, scanOn, drawOn, awaitRun, runRec, watch, ofChoice, activityOf, states, viewsByChoice, readDoc, until,
} from './helpers-jobs';

const HOLD = 'Hold [fixture:slow]', HOLD_ID = 'hold-fixture-slow';

// JOB-4, START-7 (api contract, *Joining a running draw*; ADR 0016 decision 4): while a draw runs, a second request for its folder is told which
// draw to join, and choices that join take the draw's channel, engine and model, are drawn side by side with its own and land in the one file
// the draw writes, after its own choices, in the order they joined; the draw is not started twice.
test('H218 [JOB-4 START-7 #197] choices that join a running draw take its channel, are drawn beside its own and land in its one file in the order they joined, and a second draw of the folder is told which draw to join', async () => {
  test.setTimeout(270_000);
  const server = await jobServer({ slots: 3, stepMs: 150 });
  try {
    const project = await gitRepo('join-lands');
    const scan = await scanOn(server, { folder: project.dir });

    // A draw is running: one choice done, the slow one still reading.
    const runId = await drawOn(server, scan.id, [option('o2'), typed(HOLD)], 'readme');
    const stream = watch(server, `/api/runs/${runId}/events`);
    await until(() => runRec(server, runId), r => r.choices[0].status === 'done' && r.choices[1].status === 'running', 'the first choice to be done', 15_000, 50);

    // A new draw of the folder is refused and names the draw to join.
    const again = await server.post('/api/runs', { kind: 'draw', scan: scan.id, choices: [{ kind: 'whole' }], channel: 'readme', engine: 'fixture', model: null });
    expect(again).toEqual({ status: 409, body: { error: 'A drawing of this folder is already being made', runId } });

    // Two more choices join. What the body says about the channel, engine and model is ignored: they take the draw's.
    const joined = await server.post(`/api/runs/${runId}/choices`, { scan: scan.id, choices: [option('o3'), option('o1')], channel: 'presentation', engine: 'nope', model: '--x' });
    expect(joined, JSON.stringify(joined.body)).toEqual({ status: 200, body: { runId, choices: [SLUG.o3, SLUG.o1] } });
    const record = await runRec(server, runId);
    expect(record.choices.map((c: { id: string }) => c.id), 'at the end of the draw, in body order').toEqual([SLUG.o2, HOLD_ID, SLUG.o3, SLUG.o1]);
    expect(record).toMatchObject({ channel: 'readme', status: 'running', writing: false });
    expect(['running', 'waiting']).toContain(record.choices[2].status); expect(['running', 'waiting']).toContain(record.choices[3].status);

    // Their lines: said to be added, then started as the draw's own, each with its record, before anything of the answer is needed.
    await stream.wait(e => ofChoice(e, SLUG.o1).some(x => x.event === 'choice' && ['running', 'waiting'].includes(x.data.status)), 'the joined choices to start', 15_000);
    for (const [id, title] of [[SLUG.o3, OPTIONS.o3.title], [SLUG.o1, OPTIONS.o1.title]] as const) {
      const mine = ofChoice(stream.events, id);
      expect(mine[0], `${id}: first the line that says it was added`).toMatchObject({ event: 'progress', data: { message: `Added "${title}" to this draw`, stage: null, choice: id, source: 'server' } });
      const started = mine.find(e => e.event === 'progress' && (String(e.data.message).startsWith('Drawing "') || e.data.message === 'Waiting for a free engine'))!;
      expect(started.data.message === 'Waiting for a free engine' || new RegExp(`^Drawing "${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" \\((3|4) of 4\\)$`).test(started.data.message), String(started.data.message)).toBe(true);
      expect(mine[2].event, 'then its record').toBe('choice');
    }

    // They are drawn while the slow choice still reads, and are done first.
    const mid = await until(() => runRec(server, runId), r => r.choices[2].status === 'done' && r.choices[3].status === 'done', 'the joined choices to be done', 30_000, 100);
    expect(mid.choices[1].status, 'the slow choice is still reading').toBe('running');
    expect(mid.status).toBe('running');
    expect(await exists(join(project.dir, 'docs')), 'nothing is written before the last choice ends').toBe(false);

    // The draw ends once, with one file of all four choices: its own two, then the joined two, all in the draw's channel.
    const run = await awaitRun(server, runId, 'succeeded', 90_000);
    expect(states(run)).toEqual([`${SLUG.o2}:done`, `${HOLD_ID}:done`, `${SLUG.o3}:done`, `${SLUG.o1}:done`]);
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    const doc = await readDoc(file);
    expect(doc.choices.map((c: { id: string }) => c.id)).toEqual([SLUG.o2, HOLD_ID, SLUG.o3, SLUG.o1]);
    expect((await readChoices(file)).choices.map(c => c.title)).toEqual([OPTIONS.o2.title, HOLD, OPTIONS.o3.title, OPTIONS.o1.title]);
    expect(Object.values(viewsByChoice(doc)).flat().filter(v => v.startsWith('presentation:') || v.startsWith('linkedin:')), 'only the draw\'s channel is drawn').toEqual([]);
    expect(viewsByChoice(doc)[SLUG.o3]).toEqual([`overview:${SLUG.o3}-overview`, `readme:${SLUG.o3}-readme`]);
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    const act = await activityOf(server);
    expect(act.jobs.filter((j: { type: string }) => j.type === 'draw'), 'the joined choices did not start a draw of their own').toHaveLength(1);
    stream.stop();
  } finally { await server.stop(); }
});
