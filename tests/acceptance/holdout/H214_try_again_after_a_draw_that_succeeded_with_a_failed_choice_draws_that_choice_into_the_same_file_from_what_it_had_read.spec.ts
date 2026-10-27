import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists, samePath } from './helpers';
import { WHOLE, option, typed, SLUG, ENGINE_LINES, CHANNEL_LINE } from './helpers-selections';
import { jobServer, scanOn, drawOn, runRec, awaitRun, runEventsOf, lines, diagramIds, states, viewsByChoice, readDoc, watch, ms, until } from './helpers-jobs';

const BILLING = 'Billing [fixture:flaky:channel]', BILLING_ID = 'billing-fixture-flaky-channel';

// JOB-3, START-6, START-7 (api contract, *Trying again*, *What a failed draw keeps*): after a draw that succeeded with a failed choice, Try again
// is `POST /api/runs/:runId/retry`. It draws the failed choice only, from what it had read, and adds it to the file the draw wrote: same
// drawing, same path, the file's other choices exactly as they were, the choice's views numbered after the file's own, `changed` fired.
test('H214 [JOB-3 START-6 START-7 #196] Try again after a draw that succeeded with a failed choice draws that choice into the same file from what it had read, leaves the other choices exactly as they were, and is refused once nothing is left to try', async () => {
  test.setTimeout(240_000);
  const server = await jobServer({ stepMs: 120 });
  try {
    const project = await gitRepo('retry-into');
    const scan = await scanOn(server, { folder: project.dir });
    const first = await awaitRun(server, await drawOn(server, scan.id, [WHOLE, typed(BILLING), option('o2')], 'linkedin'), 'succeeded');
    expect(states(first)).toEqual(['system:done', `${BILLING_ID}:failed`, `${SLUG.o2}:done`]);
    expect(first.choices[1]).toMatchObject({ stage: 'channel' }); expect(first.choices[1].error).toContain('Fixture failure requested');
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    expect(samePath(first.path, file)).toBe(true);
    const before = await readDoc(file);
    expect(before.choices.map((c: { id: string }) => c.id)).toEqual(['system', SLUG.o2]);
    const updatedBefore = (await server.get(`/api/diagrams/${first.diagramId}`)).body.updatedAt as string;
    const changes = watch(server, `/api/diagrams/${first.diagramId}/events`);

    // Try again: a new draw of the failed choice only, with the draw's scan, channel and engine, adding to the file the first draw wrote.
    const answer = await server.post(`/api/runs/${first.id}/retry`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(202);
    const retryId = answer.body.runId as string;
    expect(retryId).not.toBe(first.id);
    const started = await runRec(server, retryId);
    expect(started).toMatchObject({ kind: 'draw', retryOf: first.id, into: first.diagramId, scan: scan.id, channel: 'linkedin' });
    expect(started.choices.map((c: { id: string; kind: string; title: string }) => [c.id, c.kind, c.title])).toEqual([[BILLING_ID, 'custom', BILLING]]);
    const retry = await awaitRun(server, retryId, 'succeeded', 120_000);

    // It read nothing again: the read and the overview come from what the failed draw kept, only the post is drawn by a call.
    const events = await runEventsOf(server, retryId);
    expect(lines(events, BILLING_ID, 'read')).toEqual(expect.arrayContaining(['Using the facts already read', 'Checking the facts']));
    expect(lines(events, BILLING_ID, 'overview')).toContain('Using the overview already drawn');
    for (const stage of ['read', 'overview']) for (const line of ENGINE_LINES) expect(lines(events, BILLING_ID, stage), `no engine call in ${stage}`).not.toContain(line);
    expect(lines(events, BILLING_ID, 'channel')).toContain(CHANNEL_LINE.linkedin);
    expect(lines(events, BILLING_ID, 'channel').some(l => ENGINE_LINES.includes(l)), 'the post was drawn by a call').toBe(true);
    expect(retry.choices[0]).toMatchObject({ status: 'done', filesRead: 0 });
    expect(retry).toMatchObject({ diagramId: first.diagramId, choice: BILLING_ID, channel: 'linkedin', view: `${BILLING_ID}-linkedin`, into: first.diagramId });
    expect(samePath(retry.path, file), retry.path).toBe(true);

    // The same file: its first two choices exactly as they were, the new one after them, views numbered after the file's own.
    const after = await readDoc(file);
    expect(after.choices.map((c: { id: string }) => c.id)).toEqual(['system', SLUG.o2, BILLING_ID]);
    expect(after.choices[0], 'the first choice is exactly as it was').toEqual(before.choices[0]);
    expect(after.choices[1], 'the second choice is exactly as it was').toEqual(before.choices[1]);
    expect(viewsByChoice(after)[BILLING_ID]).toEqual([`linkedin:${BILLING_ID}-linkedin`, `overview:${BILLING_ID}-overview`]);
    const everyView = Object.values(viewsByChoice(after)).flat().map(v => v.split(':')[1]);
    expect(new Set(everyView).size, 'view ids stay unique across the file').toBe(everyView.length);
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json')), 'no second file').toBe(false);
    expect(await diagramIds(server), 'the same single registered drawing').toEqual([first.diagramId]);
    const updatedAfter = (await server.get(`/api/diagrams/${first.diagramId}`)).body.updatedAt as string;
    expect(ms(updatedAfter), 'the drawing was saved').toBeGreaterThan(ms(updatedBefore));
    await changes.wait(e => e.some(x => x.event === 'changed'), 'the changed event of the drawing', 15_000); changes.stop();

    // The first draw's record is history: still succeeded, its choice still marked failed.
    expect(states(await runRec(server, first.id))).toEqual(['system:done', `${BILLING_ID}:failed`, `${SLUG.o2}:done`]);

    // Nothing is left to try in the new draw; and once the drawing is forgotten the first draw cannot add to it.
    expect(await server.post(`/api/runs/${retryId}/retry`)).toMatchObject({ status: 400, body: { error: 'Every choice of this draw was drawn' } });
    expect((await server.del(`/api/diagrams/${first.diagramId}`)).status).toBe(204);
    expect(await server.post(`/api/runs/${first.id}/retry`)).toMatchObject({ status: 409, body: { error: 'The drawing this draw wrote is gone: start a new draw' } });
    await until(() => diagramIds(server), ids => ids.length === 0, 'the list to be empty', 5_000);
    expect(await exists(file), 'forgetting leaves the file on disk').toBe(true);
  } finally { await server.stop(); }
});
