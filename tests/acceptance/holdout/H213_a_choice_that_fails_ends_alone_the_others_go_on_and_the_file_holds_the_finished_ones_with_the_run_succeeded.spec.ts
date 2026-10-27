import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists, cli, errorLines, samePath } from './helpers';
import { WHOLE, option, typed, SLUG, readChoices, missingFacts } from './helpers-selections';
import { jobServer, scanOn, drawOn, sampleRun, runEventsOf, ofChoice, diagramIds, states, viewsByChoice, readDoc } from './helpers-jobs';

const PAY = 'Pay [fixture:fail]', PAY_ID = 'pay-fixture-fail';

// JOB-3, START-7, JOB-2 (api contract, *Deadlines, a choice that fails, and cancel*, *When every choice has ended*, *Ids*): a choice that fails
// ends alone. The others go on, the file is written with every choice that finished, the run is `succeeded` and its record marks the failed
// choice with its error. The failed choice is in no file, the ids are those of a draw that never had it, and the file is valid.
test('H213 [JOB-3 START-7 JOB-2 #196] a choice that fails ends alone while the others go on, and the file holds the finished ones in request order with the run succeeded and the failed choice marked', async () => {
  test.setTimeout(240_000);
  const server = await jobServer({ stepMs: 150 });
  try {
    const project = await gitRepo('one-fails');
    const scan = await scanOn(server, { folder: project.dir });
    const listedBefore = await diagramIds(server);

    const runId = await drawOn(server, scan.id, [WHOLE, typed(PAY), option('o2')], 'readme');
    const samples = await sampleRun(server, runId, 60);
    const run = samples.at(-1)!;

    // The record: run succeeded, the failed choice marked with its stage and error, the others done.
    expect(run.status, run.error).toBe('succeeded');
    expect(states(run)).toEqual(['system:done', `${PAY_ID}:failed`, `${SLUG.o2}:done`]);
    expect(run.choices[1]).toMatchObject({ stage: 'read', title: PAY, kind: 'custom' });
    expect(run.choices[1].error).toContain('Fixture failure requested');
    expect(run.choices[1].endedAt).not.toBeNull();
    for (const i of [0, 2]) expect(run.choices[i]).toMatchObject({ stage: 'channel', error: null });
    expect(run).toMatchObject({ choice: 'system', channel: 'readme', writing: false });
    expect(run.diagramId).toMatch(/^d_[a-z0-9]{6,}$/);

    // It ended alone: the others were still running when it failed, and nothing else stopped.
    expect(samples.some(s => s.choices[1].status === 'failed' && s.choices.some((c: { id: string; status: string }) => c.id !== PAY_ID && c.status === 'running')),
      'a choice was seen failed while another one still ran').toBe(true);
    expect(samples.every(s => s.choices[0].status !== 'failed' && s.choices[0].status !== 'cancelled' && s.choices[2].status !== 'failed' && s.choices[2].status !== 'cancelled')).toBe(true);

    // The stream: the contracted line for the failure with its choice and stage, then its record; the done event lists the failed choice.
    const events = await runEventsOf(server, runId);
    const mine = ofChoice(events, PAY_ID);
    const lost = mine.findIndex(e => e.event === 'progress' && String(e.data.message).startsWith(`Could not draw "${PAY}": `));
    expect(lost, 'the failure line').toBeGreaterThan(0);
    expect(mine[lost].data).toMatchObject({ stage: 'read', choice: PAY_ID, source: 'server', message: `Could not draw "${PAY}": ${run.choices[1].error}` });
    expect(mine[lost + 1]).toMatchObject({ event: 'choice', data: { id: PAY_ID, status: 'failed', stage: 'read', error: run.choices[1].error } });
    expect(mine.at(-1)!.data, 'nothing more is said of it').toMatchObject({ id: PAY_ID, status: 'failed' });
    for (const id of ['system', SLUG.o2]) expect(ofChoice(events, id).some(e => /^Could not draw/.test(String(e.data.message ?? ''))), `${id} did not fail`).toBe(false);
    expect(events.filter(e => e.event === 'done')).toHaveLength(1);
    expect(events.at(-1)!.data).toMatchObject({ status: 'succeeded', diagramId: run.diagramId, path: run.path, choice: 'system' });
    expect(events.at(-1)!.data.choices.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(states(run));

    // The file: the two that finished, in request order; not the failed one; valid; ids as if the failed choice had never been asked.
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    expect(samePath(run.path, file), run.path).toBe(true);
    const doc = await readDoc(file);
    expect(doc.choices.map((c: { id: string }) => c.id)).toEqual(['system', SLUG.o2]);
    expect(JSON.stringify(doc).includes(PAY_ID), 'the failed choice is in no part of the file').toBe(false);
    expect(viewsByChoice(doc)).toEqual({
      system: ['overview:overview', 'overview:zone-runtime-inside', 'readme:readme'],
      [SLUG.o2]: [`overview:${SLUG.o2}-overview`, `readme:${SLUG.o2}-readme`],
    });
    for (const c of (await readChoices(file)).choices) expect(missingFacts(c), `${c.id}: every fact is drawn`).toEqual([]);
    const warnings: string[] = doc.warnings ?? [];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every(w => w.startsWith('The whole system: ') || w.startsWith(`${doc.choices[1].title}: `)), 'only choices in the file are named in its warnings').toBe(true);
    const checked = await cli(['validate', file]); expect(checked.code, checked.stdout + checked.stderr).toBe(0); expect(errorLines(checked)).toEqual([]);

    // Registered once; no second file.
    expect(await diagramIds(server)).toEqual([run.diagramId, ...listedBefore]);
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  } finally { await server.stop(); }
});
