import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gitRepo, projectFiles, writeFiles, token, scanFolder, startDraw, finishRun, runEvents, postJSON, listedDiagrams, cli, errorLines, samePath, exists, viewOf, partOf, factOf, sorted, baseURL } from './helpers';
import { getDocument } from './helpers-selections'; // a draw writes format 4: this gives the drawn choice in the shape the scenario was written in

const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found', 'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped', 'Dropped "ghost-limit": its component "ghost" was dropped',
];

// Any failure, cancel or timeout at any stage writes and registers nothing; a draw succeeds only once the file is written
// and registered. Markers in the typed focus reach the fixture's three calls (the folder name does too, but a Windows
// folder cannot carry ":").
test('H119 [START-4, READ-1, STORY-1, STORY-6, #181] a draw that fails at the read, the overview or the channel, or is cancelled, or cannot write its file, writes and registers nothing, and a draw whose overview leaves a fact out is completed by code with one warning', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('draw-failures');
  const docs = join(project.dir, 'docs');
  const scan = await scanFolder(request, auth, project.dir);
  const listedBefore = await listedDiagrams(request);
  const draw = (text: string, channel = 'readme') => startDraw(request, auth, scan.id, { kind: 'typed', text }, channel);
  const nothingWritten = async (what: string) => {
    expect(await exists(docs), `${what}: no docs folder`).toBe(false);
    expect((await project.git(['status', '--porcelain'])).trim(), `${what}: the project is as it was`).toBe('');
    expect((await listedDiagrams(request)).map(d => d.id), `${what}: no drawing registered`).toEqual(listedBefore.map(d => d.id));
  };

  // The read fails: the run says so, names no file and no drawing, and the later stages never ran.
  const read = await draw('Explain the agent loop [fixture:fail]');
  const failedRead = await finishRun(request, read, 'failed', 90_000);
  expect(failedRead.error).toContain('Fixture failure requested');
  expect(failedRead).toMatchObject({ kind: 'draw', diagramId: null, path: null, changes: null, layoutReport: null });
  expect(failedRead.progress).not.toContain('Drawing the overview');
  const readEvents = await runEvents(read);
  expect(readEvents.filter(e => e.event === 'done')).toHaveLength(1);
  expect(readEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null }); expect(readEvents.at(-1)!.data.error).toContain('Fixture failure requested');
  await nothingWritten('the read failed');

  // The overview call fails after the read succeeded: the facts it read are not kept either.
  const failedOverview = await finishRun(request, await draw('Explain it [fixture:fail:overview]'), 'failed', 90_000);
  expect(failedOverview.error).toBeTruthy(); expect(failedOverview).toMatchObject({ diagramId: null, path: null });
  expect(failedOverview.progress).toContain('Checking the facts'); expect(failedOverview.progress).toContain('Drawing the overview');
  expect(failedOverview.progress).not.toContain('Drawing the README drawing');
  await nothingWritten('the overview failed');

  // The channel call fails after the read and the overview succeeded: a drawing without its channel is not written.
  const failedChannel = await finishRun(request, await draw('Explain it [fixture:fail:channel]'), 'failed', 90_000);
  expect(failedChannel.error).toBeTruthy(); expect(failedChannel).toMatchObject({ diagramId: null, path: null });
  expect(failedChannel.progress).toContain('Drawing the overview');
  await nothingWritten('the channel failed');

  // A draw in progress refuses a second draw of the folder; cancelling stops it, writes nothing, and the folder is free again.
  const slow = await draw('Explain it slowly [fixture:slow]');
  await expect.poll(async () => (await (await request.get(`${baseURL()}/api/runs/${slow}`)).json()).progress.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect((await (await request.get(`${baseURL()}/api/runs/${slow}`)).json()).status).toBe('running');
  const second = await postJSON(request, auth, '/api/runs', { kind: 'draw', scan: scan.id, focus: { kind: 'whole' }, channel: 'readme', engine: 'fixture', model: null });
  expect(second).toMatchObject({ status: 409, body: { error: 'A drawing of this folder is already being made' } });
  expect(await postJSON(request, auth, `/api/runs/${slow}/cancel`, {})).toMatchObject({ status: 200, body: { ok: true } });
  const cancelled = await finishRun(request, slow, 'cancelled', 30_000);
  expect(cancelled).toMatchObject({ diagramId: null, path: null }); expect((await runEvents(slow)).at(-1)!.data).toMatchObject({ status: 'cancelled', diagramId: null });
  await nothingWritten('the draw was cancelled');

  // The overview leaves `store` out: code draws it, with one warning, so the overview still shows every fact.
  const partial = await finishRun(request, await draw('Explain the store [fixture:partial]', 'linkedin'), 'succeeded', 120_000);
  const doc = await getDocument(request, partial.diagramId);
  expect(doc.warnings!.slice(0, 4)).toEqual(FOUR_WARNINGS);
  expect(doc.warnings!.filter(w => w === 'Added "store", which the overview left out')).toHaveLength(1);
  expect(partOf(doc, 'overview', 'store')).toMatchObject({ facts: ['store'], form: 'card' });
  const edge = viewOf(doc, 'overview')!.edges.find(e => (e.from === 'agent' && e.to === 'store') || (e.from === 'store' && e.to === 'agent'));
  expect(edge?.relations, 'the relation agent → store is drawn as a connection').toEqual(['r7']);
  expect(partOf(doc, 'overview', 'agent')).toMatchObject({ held: ['model-call', 'tool-proposal', 'tool-check', 'tool-run', 'tool-result'], limits: ['turn-limit'] });
  const drawnIds = new Set(viewOf(doc, 'overview')!.nodes.flatMap(n => [...n.facts, ...(n.held ?? [])]));
  expect(sorted([...drawnIds])).toEqual(sorted(doc.facts.components.map(f => f.id)));
  expect(factOf(doc, 'store')).toMatchObject({ label: 'Store', kind: 'data' });
  const valid = await cli(['validate', partial.path]); expect(valid.code, valid.stdout + valid.stderr).toBe(0); expect(errorLines(valid)).toEqual([]);

  // The file cannot be written: the run fails with the contracted sentence, names the docs folder, and nothing is registered or
  // changed. Here `docs` is a file of the project; below every name is taken.
  const WRITE = 'Could not write the drawing in ';
  const writeFailure = async (folder: string) => {
    const scanned = await scanFolder(request, auth, folder);
    const run = await finishRun(request, await startDraw(request, auth, scanned.id, { kind: 'whole' }, 'linkedin'), 'failed', 120_000);
    const docsFolder = join(folder, 'docs');
    expect(run.error.startsWith(WRITE), run.error).toBe(true);
    const named = run.error.slice(WRITE.length);
    expect(samePath(named.slice(0, docsFolder.length), docsFolder), `${named} names the docs folder`).toBe(true);
    expect(named.slice(docsFolder.length).startsWith(': '), named).toBe(true); expect(named.length, 'a reason follows').toBeGreaterThan(docsFolder.length + 2);
    expect(run).toMatchObject({ kind: 'draw', diagramId: null, path: null, changes: null, layoutReport: null });
    const events = await runEvents(run.id);
    expect(events.filter(e => e.event === 'done')).toHaveLength(1);
    expect(events.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null }); expect(events.at(-1)!.data.error).toBe(run.error);
    expect((await listedDiagrams(request)).map(d => d.id), 'no drawing registered').toEqual(listedAfterPartial.map(d => d.id));
  };
  const listedAfterPartial = await listedDiagrams(request);
  const blocked = await gitRepo('draw-docs-is-a-file', { ...projectFiles, docs: 'This is a file, not a folder.\n' });
  await writeFailure(blocked.dir);
  expect(await readFile(join(blocked.dir, 'docs'), 'utf8'), 'the file called docs is as it was').toBe('This is a file, not a folder.\n');
  expect((await blocked.git(['status', '--porcelain'])).trim(), 'nothing was added to the project').toBe('');

  const full = await gitRepo('draw-every-name-taken');
  const kept = 'Taken, and kept as it is.\n';
  const names = ['architecture.archdraw.json', ...Array.from({ length: 98 }, (_, i) => `architecture-${i + 2}.archdraw.json`)];
  await writeFiles(full.dir, Object.fromEntries(names.map(name => [`docs/${name}`, kept])));
  await writeFailure(full.dir);
  expect(sorted(await readdir(join(full.dir, 'docs'))), 'nothing written beside the 99 names').toEqual(sorted(names));
  for (const name of names) expect(await readFile(join(full.dir, 'docs', name), 'utf8'), `${name} is untouched`).toBe(kept);

  // Must not happen: the failed attempts leaving anything behind next to the one drawing that succeeded.
  expect((await listedDiagrams(request)).length).toBe(listedBefore.length + 1);
  expect(sorted((await project.git(['status', '--porcelain'])).trim().split(/\r?\n/))).toEqual(['?? docs/']);
});
