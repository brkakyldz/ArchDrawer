import { test, expect } from '@playwright/test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitRepo, plainFolder, markerRepo, token, startScan, finishScan, scanFolder, scanEvents, dataDir, listedDiagrams, exists } from './helpers';
import { OPTIONS } from './helpers-selections';

const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} ${i + 1}`).join('\n') + '\n';
const entries = async () => { try { return (await readdir(join(dataDir(), 'scans'))).filter(name => name.endsWith('.json')).sort(); } catch { return []; } };

// SCAN-2 (ADR 0015): the scan offers the project's own sections and flows, each with a title, one sentence and the files that
// back it, and nothing else: no part count, no start → end line. An option whose files do not exist is left out with one
// warning; more than eight are cut to the first eight with one warning each; an unknown kind (an older `mechanism`) becomes a
// flow with one warning; a cache entry written before sections and flows is not used and is replaced.
test('H190 [SCAN-2 SCAN-4 #180] a scan offers the project\'s sections and flows, each with a title, one sentence and its files, leaves out the option whose file is missing, cuts a long answer to eight with one warning each, and scans again where the cache entry is older than sections and flows', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('scan-kinds');
  const before = await entries();
  const diagramsBefore = (await listedDiagrams(request)).length;

  // The fixture's answer: a flow and two sections, in this order, and a fourth backed by a file that is not there.
  const scanId = await startScan(request, auth, project.dir);
  const record = await finishScan(request, scanId);
  expect(record).toMatchObject({ status: 'succeeded', cached: false, error: null });
  expect(record.options!.map(o => [o.id, o.kind, o.title, o.sentence, o.files])).toEqual([
    ['o1', 'flow', OPTIONS.o1.title, OPTIONS.o1.sentence, [...OPTIONS.o1.files]],
    ['o2', 'section', OPTIONS.o2.title, OPTIONS.o2.sentence, [...OPTIONS.o2.files]],
    ['o3', 'section', OPTIONS.o3.title, OPTIONS.o3.sentence, [...OPTIONS.o3.files]],
  ]);
  // Only the two kinds exist; no older kind survives, and an option carries a title, a sentence and files and nothing else.
  expect(new Set(record.options!.map(o => o.kind))).toEqual(new Set(['flow', 'section']));
  for (const o of record.options!) {
    expect(Object.keys(o).sort(), `${o.id}: no part count, no start → end line`).toEqual(['files', 'id', 'kind', 'sentence', 'title']);
    expect(o.title.length).toBeGreaterThanOrEqual(1); expect(o.title.length).toBeLessThanOrEqual(80);
    expect(o.sentence.length).toBeGreaterThanOrEqual(1); expect(o.sentence.length).toBeLessThanOrEqual(200);
    expect(o.files.length).toBeGreaterThanOrEqual(1); expect(o.files.length).toBeLessThanOrEqual(12);
  }
  expect(record.options!.some(o => /missing-file|A path that is not there/.test(JSON.stringify(o))), 'the option whose file is missing is not shown').toBe(false);
  expect(record.warnings).toHaveLength(1); expect(record.warnings[0]).toMatch(/missing-file|A path that is not there/);
  const events = await scanEvents(scanId);
  expect(events.at(-1)!.data).toMatchObject({ status: 'succeeded', options: record.options, warnings: record.warnings });

  // Fewer than three options is still a success: one file backs them all.
  const solo = await scanFolder(request, auth, await plainFolder('scan-kinds-solo', { 'solo.ts': sixLines('solo') }));
  expect(solo.options!.map(o => [o.kind, o.files])).toEqual([['flow', ['solo.ts']], ['section', ['solo.ts']], ['section', ['solo.ts']]]);
  expect(solo.cached).toBe(false);

  // The cache entry says it was written for sections and flows. An entry without that (written before) is not used: the
  // folder is scanned again, the entry replaced, and the next scan of the commit is cached.
  const created = (await entries()).filter(name => !before.includes(name));
  expect(created, 'the scan of the repository wrote one entry; the folder outside git wrote none').toHaveLength(1);
  const entryPath = join(dataDir(), 'scans', created[0]);
  const entry = JSON.parse(await readFile(entryPath, 'utf8'));
  expect(entry.version).toBe(2);
  delete entry.version; await writeFile(entryPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  const older = await scanFolder(request, auth, project.dir);
  expect(older.cached, 'an entry without a version is not used').toBe(false);
  expect(older.progress).toEqual(expect.arrayContaining(['Reading the inputs', 'Writing the card']));
  expect(older.options).toEqual(record.options);
  const replaced = await entries();
  expect(replaced, 'the entry was replaced, not added').toEqual([...before, ...created].sort());
  expect(JSON.parse(await readFile(entryPath, 'utf8')).version).toBe(2);
  const again = await scanFolder(request, auth, project.dir);
  expect(again.cached).toBe(true); expect(again.options).toEqual(record.options);

  // More than eight options: the first eight after the file check stay, each one left out adds a warning, an older kind
  // becomes a flow with its own warning. Needs a folder named with a marker, which Windows cannot hold.
  if (process.platform !== 'win32') {
    const many = (await markerRepo('[fixture:many]'))!;
    const big = await scanFolder(request, auth, many.dir);
    expect(big.options!.map(o => [o.id, o.kind, o.title])).toEqual([
      ['o1', 'flow', OPTIONS.o1.title], ['o2', 'section', OPTIONS.o2.title], ['o3', 'section', OPTIONS.o3.title],
      ['o4', 'flow', 'Part 5'], ['o5', 'section', 'Part 6'], ['o6', 'section', 'Part 7'], ['o7', 'section', 'Part 8'], ['o8', 'section', 'Part 9'],
    ]);
    expect(big.options!.slice(3).every(o => o.sentence === 'One more part.' && o.files.length === 1)).toBe(true);
    expect(big.warnings, 'one warning for each change').toHaveLength(3);
    expect(big.warnings).toContain('Unknown focus kind "mechanism" for "Part 5", taken as flow');
    expect(big.warnings).toContain('Left out the option "Part 10": at most 8 options');
    expect(big.warnings.filter(w => /missing-file|A path that is not there/.test(w))).toHaveLength(1);
    expect(big.options!.some(o => o.title === 'Part 10')).toBe(false);
  }

  // Must not happen: a scan writing into the project or registering a drawing.
  expect(await project.git(['status', '--porcelain'])).toBe(''); expect(await exists(join(project.dir, 'docs'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(diagramsBefore);
});
