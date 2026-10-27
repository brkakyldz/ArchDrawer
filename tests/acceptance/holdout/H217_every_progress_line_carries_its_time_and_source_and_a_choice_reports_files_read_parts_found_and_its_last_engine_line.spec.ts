import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo } from './helpers';
import { option, SLUG, OPTIONS } from './helpers-selections';
import {
  jobServer, scanOn, drawOn, awaitRun, runEventsOf, scanEventsOf, ofChoice, readDoc, ISO_MS, ms,
} from './helpers-jobs';

// JOB-6, JOB-7 (api contract, *Progress lines*, *Choice events*, *Run record*, *Scan record*; testing contract, *File reads*): every progress line
// of a scan and a run carries `at` and `source` (`engine` for the engine's own lines, `server` for the rest); a choice reports the number of
// files its engine read (2 at the read's `Reading the code` line, as the fixture says) and the parts its checked read found (8), each change in
// a `choice` event that follows the line that goes with it; the record keeps the time of the last engine line.
test('H217 [JOB-6 JOB-7 #196 #195] every progress line carries its time and source, and a choice reports files read, parts found and the time of its last engine line in its events and its record', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ stepMs: 120 });
  try {
    const project = await gitRepo('structured-progress');

    // ---- A scan: the engine's lines come from the engine, the others from the server.
    const scanId = (await scanOn(server, { folder: project.dir })).id;
    const scan = (await server.get(`/api/scans/${scanId}`)).body;
    const scanEvents = await scanEventsOf(server, scanId);
    const scanLines = scanEvents.filter(e => e.event === 'progress');
    const sourceOf = new Map(scanLines.map(e => [String(e.data.message), e.data.source]));
    expect([...sourceOf.keys()]).toEqual(expect.arrayContaining(['Gathering the repository', 'Reading the inputs', 'Writing the card', 'Checking the scan', 'Done']));
    for (const server_ of ['Gathering the repository', 'Checking the scan', 'Done']) expect(sourceOf.get(server_), server_).toBe('server');
    for (const engine of ['Reading the inputs', 'Writing the card']) expect(sourceOf.get(engine), engine).toBe('engine');
    for (const e of scanLines) expect(e.data.at, e.data.message).toMatch(ISO_MS);
    const scanAts = scanLines.map(e => ms(e.data.at));
    expect(scanAts, 'lines come in the order of their times').toEqual([...scanAts].sort((a, b) => a - b));
    const lastEngine = scanLines.filter(e => e.data.source === 'engine').at(-1)!;
    expect(scan).toMatchObject({ status: 'succeeded', message: 'Done', waiting: false, link: null, lastEngineEventAt: lastEngine.data.at, name: scan.card.name });
    expect(scan.createdAt).toMatch(ISO_MS); expect(scan.startedAt).toMatch(ISO_MS); expect(scan.endedAt).toMatch(ISO_MS);
    expect(ms(scan.createdAt)).toBeLessThanOrEqual(ms(scan.startedAt)); expect(ms(scan.startedAt)).toBeLessThanOrEqual(ms(scan.endedAt));
    expect(scanEvents.at(-1)).toMatchObject({ event: 'done', data: { status: 'succeeded', cached: false, link: null } });
    expect(scanEvents.at(-1)!.data.card).toEqual(scan.card);

    // ---- A draw of one choice.
    const id = SLUG.o1;
    const runId = await drawOn(server, scanId, [option('o1')], 'linkedin');
    const run = await awaitRun(server, runId, 'succeeded', 15_000);
    const events = await runEventsOf(server, runId);
    const progress = events.filter(e => e.event === 'progress');
    for (const e of progress) { expect(e.data.at, e.data.message).toMatch(ISO_MS); expect(['engine', 'server'], e.data.message).toContain(e.data.source); }
    const engineLines = new Set(['Reading the drawing', 'Reading the code', 'Updating the drawing']);
    for (const e of progress.filter(x => engineLines.has(x.data.message))) expect(e.data.source, e.data.message).toBe('engine');
    for (const e of progress.filter(x => /^(Drawing "|Checking the facts|Drawing the )/.test(x.data.message))) expect(e.data.source, e.data.message).toBe('server');
    const ats = progress.map(e => ms(e.data.at));
    expect(ats, 'the lines come in the order of their times').toEqual([...ats].sort((a, b) => a - b));

    // The lines of the write belong to no choice.
    const writing = progress.find(e => e.data.message === 'Writing the drawing')!;
    expect(writing.data).toMatchObject({ choice: null, stage: null, source: 'server' });
    const saved = progress.at(-1)!;
    const doc = await readDoc(join(project.dir, 'docs', 'architecture.archdraw.json'));
    const count = (doc.warnings ?? []).length;
    expect(saved.data).toMatchObject({ choice: null, stage: null, source: 'server' });
    expect(String(saved.data.message), 'the last line says how many warnings the file holds').toMatch(new RegExp(count ? `^Saved with ${count} warnings?$` : '^Saved$'));

    // The choice's records: nothing read before the read's own line, 2 files read at it, the parts found after the read is checked, then the stages.
    const mine = ofChoice(events, id);
    const at = (pred: (e: { event: string; data: any }) => boolean) => mine.findIndex(pred);
    const readingCode = at(e => e.event === 'progress' && e.data.message === 'Reading the code' && e.data.stage === 'read');
    const checking = at(e => e.event === 'progress' && e.data.message === 'Checking the facts');
    expect(readingCode, 'the read reports the code').toBeGreaterThan(0); expect(checking).toBeGreaterThan(readingCode);
    expect(mine[readingCode].data.source).toBe('engine');
    const records = mine.map((e, i) => ({ e, i })).filter(x => x.e.event === 'choice');
    expect(records[0].e.data, 'its first record: running at its read, nothing found yet').toMatchObject({ id, status: 'running', stage: 'read', filesRead: 0, parts: null, endedAt: null });
    for (const { e, i } of records.filter(x => x.i < readingCode)) expect(e.data, 'before the read reports a file').toMatchObject({ filesRead: 0, parts: null });
    const afterRead = records.filter(x => x.i > readingCode && x.i < checking);
    expect(afterRead.length, 'a record follows the line that reports the files').toBeGreaterThan(0);
    expect(mine[readingCode + 1].event, 'it comes right after that line').toBe('choice');
    for (const { e } of afterRead) expect([1, 2]).toContain(e.data.filesRead);
    expect(afterRead.at(-1)!.e.data.filesRead, 'two different files of the listing, as the fixture reads them').toBe(2);
    const checked = records.find(x => x.e.data.parts !== null)!;
    expect(checked.i, 'the parts are known once the read is checked').toBeGreaterThan(checking);
    expect(checked.e.data.parts, 'the checked read holds 8 components (ghost is dropped)').toBe(8);
    expect(mine.slice(0, checked.i).some(e => e.event === 'progress' && e.data.message === 'Drawing the overview'), 'before the overview starts').toBe(false);
    const stages = records.map(x => x.e.data.stage).filter((s, i, all) => i === 0 || s !== all[i - 1]);
    expect(stages).toEqual(['read', 'overview', 'channel']);
    expect(records.at(-1)!.e.data).toMatchObject({ id, status: 'done', stage: 'channel', filesRead: 2, parts: 8, error: null });
    expect(records.at(-1)!.e.data.endedAt).toMatch(ISO_MS);

    // The record agrees with the stream: the last engine line's time, the counts, the run-level fields.
    const lastEngineOfChoice = progress.filter(e => e.data.choice === id && e.data.source === 'engine').at(-1)!;
    const choice = run.choices[0];
    expect(choice).toMatchObject({ id, kind: 'flow', title: OPTIONS.o1.title, status: 'done', stage: 'channel', error: null, filesRead: 2, parts: 8, lastEngineEventAt: lastEngineOfChoice.data.at });
    expect(ms(choice.startedAt)).toBeLessThanOrEqual(ms(choice.lastEngineEventAt)); expect(ms(choice.lastEngineEventAt)).toBeLessThanOrEqual(ms(choice.endedAt));
    expect(events.at(-1)!.data.choices[0]).toEqual(choice);
    expect(run.lastEngineEventAt, 'a draw reports the last engine line of any of its choices').toBe(lastEngineOfChoice.data.at);
    expect(run.message, 'message is the latest progress line').toBe(saved.data.message);
    for (const key of ['createdAt', 'startedAt', 'endedAt']) expect(run[key], key).toMatch(ISO_MS);
    expect(ms(run.createdAt)).toBeLessThanOrEqual(ms(run.startedAt)); expect(ms(run.startedAt)).toBeLessThanOrEqual(ms(run.endedAt));
    expect(run).toMatchObject({ waiting: false, writing: false, link: null, name: scan.card.name, scan: scanId, into: null, retryOf: null, channel: 'linkedin', choice: id });
    expect(run.folder).toBe(scan.folder); expect(run.root).toBe(scan.root);
  } finally { await server.stop(); }
});
