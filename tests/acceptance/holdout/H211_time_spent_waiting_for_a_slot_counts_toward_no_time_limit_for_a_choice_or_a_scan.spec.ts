import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo } from './helpers';
import { option, typed, SLUG, readChoices } from './helpers-selections';
import { jobServer, scanOn, startScanOn, awaitScan, drawOn, sampleRun, activityOf, states, ms, WAITING } from './helpers-jobs';

// JOB-1, START-7 (api contract, *Engine slots*, *Waiting*): the time spent waiting counts toward no deadline. A run's and a choice's deadline
// start when it takes its slot, and so does a scan's engine deadline. With the shortest limit the server takes (10 s) and one slot, a fourth
// choice waits more than the limit and a scan that asked after it waits longer still; each is drawn without a timeout.
test('H211 [JOB-1 START-7 #196] time spent waiting for a slot counts toward no time limit: a choice and a scan that wait longer than the limit still run and do not time out', async () => {
  test.setTimeout(90_000);
  const server = await jobServer({ slots: 1, stepMs: 350, timeoutMs: 10_000 });
  try {
    const a = await gitRepo('wait-no-deadline-a'), c = await gitRepo('wait-no-deadline-c');
    const scanA = await scanOn(server, { folder: a.dir });
    expect((await activityOf(server)).timeoutMs, 'the limit the page may count with').toBe(10_000);

    const runId = await drawOn(server, scanA.id, [option('o2'), option('o3'), option('o1'), typed('Pay for it')], 'linkedin');
    const scanId = await startScanOn(server, { folder: c.dir }); // asked after every choice: it waits for all four
    const samples = await sampleRun(server, runId, 200);
    const run = samples.at(-1)!;
    expect(run.status, run.error).toBe('succeeded');
    expect(states(run)).toEqual([`${SLUG.o2}:done`, `${SLUG.o3}:done`, `${SLUG.o1}:done`, 'pay-for-it:done']);

    // The test means something only if the wait was longer than the limit and no single choice came near it.
    const created = ms(run.createdAt);
    const waited = ms(run.choices[3].startedAt) - created;
    expect(waited, `the fourth choice waited ${waited} ms`).toBeGreaterThan(10_000);
    for (const choice of run.choices) expect(ms(choice.endedAt) - ms(choice.startedAt), `${choice.id} ran inside the limit`).toBeLessThan(10_000);
    for (const choice of run.choices) expect(choice.error, `${choice.id} did not time out`).toBeNull();
    expect(run.progress.some((line: string) => /^Timed out/.test(line) || line.includes('Timed out after'))).toBe(false);
    expect(samples.some(s => s.choices[3].status === 'waiting' && s.waiting === false), 'the draw was not itself "waiting" while others ran').toBe(true);

    const scan = await awaitScan(server, scanId, 'succeeded', 30_000);
    const scanWaited = ms(scan.startedAt) - ms(scan.createdAt);
    expect(scanWaited, `the scan waited ${scanWaited} ms`).toBeGreaterThan(10_000);
    expect(scan.progress).toContain(WAITING);
    expect(scan.error).toBeNull(); expect(scan.card).not.toBeNull();

    expect((await readChoices(join(a.dir, 'docs', 'architecture.archdraw.json'))).choices.map(x => x.id)).toEqual([SLUG.o2, SLUG.o3, SLUG.o1, 'pay-for-it']);
  } finally { await server.stop(); }
});
