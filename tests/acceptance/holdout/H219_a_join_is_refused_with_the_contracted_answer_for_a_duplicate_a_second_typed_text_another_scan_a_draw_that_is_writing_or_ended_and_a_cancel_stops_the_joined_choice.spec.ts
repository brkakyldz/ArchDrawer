import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { WHOLE, option, typed, SLUG, readChoices } from './helpers-selections';
import {
  jobServer, scanOn, startScanOn, awaitScan, drawOn, awaitRun, runRec, scanRec, watch, registerDrawing, refineOn, states, until,
} from './helpers-jobs';

const FOCUS = 'Unknown focus: use {"kind": "option" | "whole" | "typed"}';
const HOLD = 'Hold [fixture:slow]', HOLD_ID = 'hold-fixture-slow';
const OTHER_SCAN = 'The draw was started from another scan of this folder';
const ENDED = 'This draw has ended: start a new one';
const WRITING = 'The draw is writing its file: start a new one once it has finished';

// JOB-4, JOB-10, START-7 (api contract, *Joining a running draw*, in the order of its checks): every refusal changes nothing. Duplicates count
// whatever the status of the choice in the draw, a failed one included; a scan of another commit or with other options is refused, a newer scan
// of the same commit and options is accepted and does not forget the scan the draw runs from; once the draw is writing or has ended the join is
// refused; cancelling the draw cancels what joined.
test('H219 [JOB-4 JOB-10 START-7 #197] a join is refused with the contracted answer for a duplicate, a second text, another scan, a draw that is writing or has ended, and cancelling the draw stops the choice that joined', async () => {
  test.setTimeout(360_000);
  const server = await jobServer({ slots: 2, stepMs: 150 });
  try {
    const join_ = (runId: string, body: unknown) => server.post(`/api/runs/${runId}/choices`, body);
    const refused = async (runId: string, body: unknown, status: number, error: string) =>
      expect(await join_(runId, body), JSON.stringify(body)).toEqual({ status, body: { error } });

    // ---- A draw that fails one choice and has another reading: a failed choice still counts as in the draw. Then it writes: a late join is refused.
    const b = await gitRepo('join-writing'), scanB = await scanOn(server, { folder: b.dir });
    const writingRun = await drawOn(server, scanB.id, [typed('Pay [fixture:fail]'), option('o2')], 'linkedin');
    await until(() => runRec(server, writingRun), r => r.choices[0].status === 'failed' && r.status === 'running' && r.choices[1].status === 'running', 'the first choice to have failed while the second reads', 60_000, 30);
    await refused(writingRun, { scan: scanB.id, choices: [typed('Another thing')] }, 400, 'This draw already has a choice in your own words');
    await refused(writingRun, { scan: scanB.id, choices: [option('o2')] }, 400, `The option "o2" is already in this draw`);
    const stream = watch(server, `/api/runs/${writingRun}/events`);
    await stream.wait(e => e.some(x => x.event === 'progress' && x.data.message === 'Writing the drawing'), 'the draw to start writing', 90_000);
    // Joins fired the moment the line is seen: the file is being written, or already written. Never accepted, never another answer.
    const late = await Promise.all(Array.from({ length: 6 }, () => join_(writingRun, { scan: scanB.id, choices: [option('o3')] })));
    for (const answer of late) {
      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect([WRITING, ENDED], 'the contracted sentence for the state the draw was in').toContain(answer.body.error);
    }
    const written = await awaitRun(server, writingRun, 'succeeded', 60_000);
    stream.stop();
    expect(states(written), 'no choice joined').toEqual([`pay-fixture-fail:failed`, `${SLUG.o2}:done`]);
    expect((await readChoices(join(b.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id), 'the file holds what the draw held').toEqual([SLUG.o2]);
    await refused(writingRun, { scan: scanB.id, choices: [option('o3')] }, 409, ENDED);

    // ---- A draw that goes on for a while: every refusal in the order of the checks.
    const a = await gitRepo('join-refusals'), scanA = await scanOn(server, { folder: a.dir });
    const runId = await drawOn(server, scanA.id, [typed(HOLD), WHOLE, option('o2')], 'readme');
    await until(() => runRec(server, runId), r => r.choices[1].status === 'done' && r.choices[2].status === 'done', 'the whole system and the section to be done', 90_000, 50);

    await refused('r_not_a_run', { scan: scanA.id, choices: [option('o3')] }, 404, 'Run not found');
    const reg = await registerDrawing(server, 'join-editor'), refineId = await refineOn(server, reg.id);
    await refused(refineId, { scan: scanA.id, choices: [option('o3')] }, 400, 'Only a draw takes more choices');
    await server.post(`/api/runs/${refineId}/cancel`);

    // The scan comes before the choices: missing, not a string, unknown.
    await refused(runId, { choices: [option('o9')] }, 400, 'Give the scan the choices come from');
    await refused(runId, { scan: 42, choices: [] }, 400, 'Give the scan the choices come from');
    await refused(runId, { scan: 's_unknown', choices: [] }, 400, 'Scan the folder first: that scan is unknown or did not succeed');
    // The choices: one to ten, each valid, in the order given.
    for (const choices of [undefined, [], 'whole', {}, 7, Array.from({ length: 11 }, (_, i) => typed(`Question ${i}`))])
      await refused(runId, { scan: scanA.id, ...(choices === undefined ? {} : { choices }) }, 400, 'Choose what to draw: give 1 to 10 choices');
    await refused(runId, { scan: scanA.id, choices: [{ kind: 'banana' }, option('o9')] }, 400, FOCUS);
    await refused(runId, { scan: scanA.id, choices: [option('o9'), { kind: 'banana' }] }, 400, 'Unknown focus option "o9"');
    await refused(runId, { scan: scanA.id, choices: [typed('   ')] }, 400, 'Say what to focus on: the focus is empty');
    await refused(runId, { scan: scanA.id, choices: [typed('x'.repeat(301))] }, 400, 'The focus is too long (300 characters at most)');
    // Duplicates: inside the body first, then against the draw, whatever the status of the choice there.
    await refused(runId, { scan: scanA.id, choices: [WHOLE, WHOLE] }, 400, 'The whole system is chosen twice');
    await refused(runId, { scan: scanA.id, choices: [option('o3'), option('o3')] }, 400, 'The option "o3" is chosen twice');
    await refused(runId, { scan: scanA.id, choices: [typed('One'), typed('Two')] }, 400, 'Only one choice can be in your own words');
    await refused(runId, { scan: scanA.id, choices: [WHOLE] }, 400, 'The whole system is already in this draw');
    await refused(runId, { scan: scanA.id, choices: [option('o3'), option('o2')] }, 400, 'The option "o2" is already in this draw');
    await refused(runId, { scan: scanA.id, choices: [typed('Anything')] }, 400, 'This draw already has a choice in your own words');
    expect((await runRec(server, runId)).choices.map((c: { id: string }) => c.id), 'a refusal changes nothing').toEqual([HOLD_ID, 'system', SLUG.o2]);

    // A newer scan of the same commit with the same options (a cached one) has a new id and is accepted; the scan the draw runs from is kept.
    const newerId = await startScanOn(server, { folder: a.dir });
    expect(newerId).not.toBe(scanA.id);
    expect((await scanRec(server, newerId)).cached).toBe(true);
    const accepted = await join_(runId, { scan: newerId, choices: [option('o3')] });
    expect(accepted, JSON.stringify(accepted.body)).toEqual({ status: 200, body: { runId, choices: [SLUG.o3] } });
    expect((await scanRec(server, scanA.id)).status, 'the running draw keeps its scan').toBe('succeeded');
    expect((await runRec(server, runId)).choices.map((c: { id: string }) => c.id)).toEqual([HOLD_ID, 'system', SLUG.o2, SLUG.o3]);

    // Another scan of the folder is refused, whatever the choice: the same commit with other options (a file that sorts first)...
    await a.write({ 'aaa.ts': '// new first file\n' });
    const changed = await awaitScan(server, await startScanOn(server, { folder: a.dir }, { refresh: true }), 'succeeded', 90_000);
    expect(changed.commit).toBe(await a.head()); expect(changed.options).not.toEqual(scanA.options);
    await refused(runId, { scan: changed.id, choices: [option('o1')] }, 409, OTHER_SCAN);
    // ...and another commit.
    await a.commit({ 'bbb.ts': '// a commit\n' });
    const later = await awaitScan(server, await startScanOn(server, { folder: a.dir }), 'succeeded', 90_000);
    expect(later.commit).not.toBe(scanA.commit);
    await refused(runId, { scan: later.id, choices: [option('o1')] }, 409, OTHER_SCAN);
    expect((await scanRec(server, scanA.id)).status, 'still kept while the draw runs').toBe('succeeded');
    expect((await runRec(server, runId)).choices.map((c: { id: string }) => c.id)).toEqual([HOLD_ID, 'system', SLUG.o2, SLUG.o3]);

    // Cancelling the draw ends every choice of it, the joined one included; nothing is written; a join to a draw that was cancelled is refused.
    await until(() => runRec(server, runId), r => r.choices[3].status === 'done', 'the joined choice to be done', 60_000, 100);
    const lateJoin = await join_(runId, { scan: scanA.id, choices: [option('o1')] }); // the draw's own scan is always accepted
    expect(lateJoin, JSON.stringify(lateJoin.body)).toEqual({ status: 200, body: { runId, choices: [SLUG.o1] } });
    expect((await server.post(`/api/runs/${runId}/cancel`)).body).toEqual({ ok: true });
    const cancelled = await awaitRun(server, runId, 'cancelled', 60_000);
    expect(cancelled.choices.map((c: { status: string }) => c.status), 'the finished ones stay done, the slow one and the one that joined last are cancelled')
      .toEqual(['cancelled', 'done', 'done', 'done', 'cancelled']);
    expect(cancelled).toMatchObject({ diagramId: null, path: null });
    expect(await exists(join(a.dir, 'docs'))).toBe(false);
    await refused(runId, { scan: 's_unknown', choices: [] }, 409, ENDED);
    await refused(runId, { scan: scanA.id, choices: [typed('After the end')] }, 409, ENDED);
    await until(() => server.get('/api/activity').then(r => r.body), x => x.slots.busy === 0 && x.slots.waiting === 0, 'every slot to be free again', 20_000);
  } finally { await server.stop(); }
});
