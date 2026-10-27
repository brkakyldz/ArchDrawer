import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists } from './helpers';
import { option, typed } from './helpers-selections';
import {
  jobServer, scanOn, drawOn, awaitRun, runRec, runEventsOf, activityOf, jobOf, diagramIds, lines, until, HEX16, ISO_MS,
} from './helpers-jobs';

const SOLO = 'Solo [fixture:flaky:overview]', SOLO_ID = 'solo-fixture-flaky-overview';
const HOLD = 'Hold [fixture:slow]', HOLD_ID = 'hold-fixture-slow';

// JOB-7, JOB-9, START-6 (api contract, *Activity*: `ARCHDRAW_JOB_KEEP_MS`, *A restart*): a finished scan is listed with its card and options and
// a finished draw with its choices until the keep time has passed after it ended; then the run is forgotten and its id answers 404, what a
// failed draw kept goes too, but the scan stays what a draw can follow. After a restart the list is empty, the instance is another, and every
// old id answers 404.
test('H221 [JOB-7 JOB-9 START-6 #195] finished jobs are listed for the keep time and then forgotten with what a failed draw kept while the scan stays usable, and after a restart the list is empty, the instance changes and old ids answer 404', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ slots: 3, stepMs: 100, keepMs: 3000 });
  try {
    const a = await gitRepo('keep-a'), b = await gitRepo('keep-b');

    // ---- Listed as soon as it ends, with the card and options a page needs to go back to choosing.
    const scan = await scanOn(server, { folder: a.dir });
    const listed = jobOf(await activityOf(server), scan.id);
    expect(listed, 'a finished scan is listed').toMatchObject({ type: 'scan', status: 'succeeded', card: scan.card, options: scan.options });
    expect(listed.endedAt).toMatch(ISO_MS);

    const runId = await drawOn(server, scan.id, [option('o1')], 'linkedin');
    const run = await awaitRun(server, runId, 'succeeded');
    expect(jobOf(await activityOf(server), runId)).toMatchObject({ type: 'draw', status: 'succeeded', diagramId: run.diagramId });

    const failedId = await drawOn(server, scan.id, [typed(SOLO)], 'readme');
    const failed = await awaitRun(server, failedId, 'failed');
    expect(jobOf(await activityOf(server), failedId)).toMatchObject({ type: 'draw', status: 'failed', error: failed.error });

    // ---- Gone after the keep time: not listed, the run's id answers 404, the read the failed draw kept goes with it.
    await until(() => activityOf(server), x => [scan.id, runId, failedId].every(id => !jobOf(x, id)), 'the finished jobs to leave the list', 30_000, 250);
    expect(await server.get(`/api/runs/${runId}`)).toEqual({ status: 404, body: { error: 'Run not found' } });
    expect((await server.get(`/api/runs/${failedId}`)).status).toBe(404);
    expect((await server.get(`/api/runs/${failedId}/events`)).status).toBe(404);
    expect((await server.post(`/api/runs/${failedId}/retry`)).status, 'a forgotten draw cannot be tried again').toBe(404);

    // The scan, though no longer listed, is still what a draw can follow; what the failed draw kept is gone, so the same draw reads again.
    const againId = await drawOn(server, scan.id, [typed(SOLO)], 'readme');
    await awaitRun(server, againId, 'succeeded');
    const againEvents = await runEventsOf(server, againId);
    expect(lines(againEvents, SOLO_ID, 'read'), 'the kept read expired with the draw').toContain('Reading the code');
    expect(lines(againEvents, SOLO_ID, 'read')).not.toContain('Using the facts already read');
    expect(await exists(join(a.dir, 'docs', 'architecture-2.archdraw.json')), 'the second drawing of the folder took the next name').toBe(true);

    // ---- A restart: jobs live in memory only.
    const scanB = await scanOn(server, { folder: b.dir });
    const holdId = await drawOn(server, scanB.id, [typed(HOLD)], 'readme');
    await until(() => runRec(server, holdId), r => r.choices[0].status === 'running' && r.progress.length > 0, 'the slow draw to run', 15_000);
    const before = await activityOf(server);
    expect(before.instance).toMatch(HEX16);
    expect(jobOf(before, holdId)).toMatchObject({ status: 'running' });
    const drawingsBefore = await diagramIds(server);
    expect(drawingsBefore).toHaveLength(2);

    await server.restart();

    const after = await activityOf(server);
    expect(after.instance, 'another server process').toMatch(HEX16); expect(after.instance).not.toBe(before.instance);
    expect(after.jobs, 'nothing of a job survives').toEqual([]);
    expect(after.slots).toEqual({ total: 3, busy: 0, waiting: 0 });
    for (const path of [`/api/runs/${holdId}`, `/api/runs/${holdId}/events`, `/api/scans/${scanB.id}`, `/api/scans/${scanB.id}/events`, `/api/scans/${scan.id}`])
      expect((await server.get(path)).status, path).toBe(404);
    expect(await server.post(`/api/runs/${holdId}/cancel`)).toMatchObject({ status: 404 });
    expect(await diagramIds(server), 'the drawings are files, they stay').toEqual(drawingsBefore);
    expect(await exists(join(b.dir, 'docs')), 'the draw that was stopped wrote nothing').toBe(false);
    expect((await activityOf(server)).instance, 'the same process answers with the same instance').toBe(after.instance);
  } finally { await server.stop(); }
});
