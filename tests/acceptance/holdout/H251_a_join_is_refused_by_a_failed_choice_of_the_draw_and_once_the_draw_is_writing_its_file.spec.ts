import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo } from './helpers';
import { option, typed, SLUG, readChoices } from './helpers-selections';
import { jobServer, scanOn, drawOn, awaitRun, runRec, watch, states, until } from './helpers-jobs';

const ENDED = 'This draw has ended: start a new one';
const WRITING = 'The draw is writing its file: start a new one once it has finished';

// JOB-4, START-7 (api contract, *Joining a running draw*, checks 3, 4 and 7; *When every choice has ended*): a choice of the draw that failed still
// counts against a join, as a second text and as the same option. Once the draw is writing its file a join is refused with the writing
// sentence, or with the ended one if the draw is already done; no join is ever accepted then, and the file holds what the draw held.
// (Moved out of H219, original L27–45, so a defect in this writing window does not hide H219's refusals.)
test('H251 [JOB-4 START-7 #197] a choice of the draw that failed still counts against a join, a join made once the draw is writing its file is refused as writing or ended, and the file holds only what the draw held', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ slots: 2, stepMs: 150 });
  try {
    const join_ = (runId: string, body: unknown) => server.post(`/api/runs/${runId}/choices`, body);
    const refused = async (runId: string, body: unknown, status: number, error: string) =>
      expect(await join_(runId, body), JSON.stringify(body)).toEqual({ status, body: { error } });

    // A draw that fails one choice and has another reading: a failed choice still counts as in the draw. Then it writes: a late join is refused.
    const b = await gitRepo('join-writing'), scanB = await scanOn(server, { folder: b.dir });
    const writingRun = await drawOn(server, scanB.id, [typed('Pay [fixture:fail]'), option('o2')], 'linkedin');
    await until(() => runRec(server, writingRun), r => r.choices[0].status === 'failed' && r.status === 'running' && r.choices[1].status === 'running', 'the first choice to have failed while the second reads', 15_000, 30);
    await refused(writingRun, { scan: scanB.id, choices: [typed('Another thing')] }, 400, 'This draw already has a choice in your own words');
    await refused(writingRun, { scan: scanB.id, choices: [option('o2')] }, 400, `The option "o2" is already in this draw`);
    const stream = watch(server, `/api/runs/${writingRun}/events`);
    await stream.wait(e => e.some(x => x.event === 'progress' && x.data.message === 'Writing the drawing'), 'the draw to start writing', 20_000);
    // Joins fired the moment the line is seen: the file is being written, or already written. Never accepted, never another answer.
    const late = await Promise.all(Array.from({ length: 6 }, () => join_(writingRun, { scan: scanB.id, choices: [option('o3')] })));
    for (const answer of late) {
      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect([WRITING, ENDED], 'the contracted sentence for the state the draw was in').toContain(answer.body.error);
    }
    const written = await awaitRun(server, writingRun, 'succeeded', 15_000);
    stream.stop();
    expect(states(written), 'no choice joined').toEqual([`pay-fixture-fail:failed`, `${SLUG.o2}:done`]);
    expect((await readChoices(join(b.dir, 'docs', 'architecture.archdraw.json'))).choices.map(c => c.id), 'the file holds what the draw held').toEqual([SLUG.o2]);
    await refused(writingRun, { scan: scanB.id, choices: [option('o3')] }, 409, ENDED);
  } finally { await server.stop(); }
});
