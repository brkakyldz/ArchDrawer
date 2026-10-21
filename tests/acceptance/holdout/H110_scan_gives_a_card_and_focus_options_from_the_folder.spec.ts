import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, plainFolder, token, checkFolder, startScan, finishScan, scanFolder, scanEvents, listedDiagrams, exists, samePath, sorted } from './helpers';

const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} ${i + 1}`).join('\n') + '\n';

// SCAN-1/2/3: a scan reads what code gathers from the folder and answers a card and focus options. With the fixture engine
// the answer is the one the testing contract spells out: three options backed by files of the folder, the fourth, backed
// by a file that does not exist, left out with one warning, and "the whole system" and "something else" never among them.
test('H110 [START-4, SCAN-1, SCAN-2, SCAN-3] a scan of a project folder answers the repository card and the focus options backed by its files, leaves out the option whose file is missing, and writes nothing into the project', async ({ request }) => {
  const auth = await token(request);
  const project = await gitRepo('scan-card');
  const diagramsBefore = await listedDiagrams(request);

  // The folder is checked before it is scanned: where its repository root is, whether it is in git, whether it holds a drawing.
  const checked = await checkFolder(request, auth, `${project.dir}/`);
  expect(checked.status).toBe(200);
  expect(samePath(checked.body.folder, project.dir)).toBe(true); expect(samePath(checked.body.root, project.dir)).toBe(true);
  expect(checked.body).toMatchObject({ git: true, drawing: null });

  const scanId = await startScan(request, auth, project.dir);
  const record = await finishScan(request, scanId);
  expect(record).toMatchObject({ id: scanId, status: 'succeeded', cached: false, error: null });
  expect(samePath(record.folder, project.dir)).toBe(true); expect(samePath(record.root, project.dir)).toBe(true);
  expect((await project.head()).startsWith(record.commit!)).toBe(true);
  expect(record.card).toMatchObject({ name: basename(project.dir), sentence: 'A project scanned by the test engine.', type: 'agent', languages: ['TypeScript'] });
  expect(record.card!.entryPoints).toContain('main.ts'); expect(record.card!.entryPoints.length).toBeLessThanOrEqual(2);
  expect(record.options!.map(o => [o.id, o.kind, o.title, o.sentence, o.files])).toEqual([
    ['o1', 'flow', 'How a request moves through the project', 'Follows one request from the entry point to the store.', ['alpha.ts', 'beta.ts']],
    ['o2', 'mechanism', 'The agent loop', 'How the agent proposes and runs a tool.', ['gamma.ts']],
    ['o3', 'overview', 'The whole architecture', 'Every part and how they connect.', ['alpha.ts']],
  ]);
  expect(record.warnings).toHaveLength(1); expect(record.warnings[0]).toMatch(/missing-file|A path that is not there/);
  expect(record.options!.some(o => /something else|whole system/i.test(o.title))).toBe(false); // the home screen always offers those itself

  // The stream tells the same story: progress in order, then exactly one `done` that carries the answer.
  const events = await scanEvents(scanId);
  const messages = events.filter(e => e.event === 'progress').map(e => e.data.message as string);
  const order = ['Gathering the repository', 'Reading the inputs', 'Writing the card', 'Checking the scan', 'Done'].map(line => messages.indexOf(line));
  expect(order.every(i => i >= 0), messages.join(' | ')).toBe(true); expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(events.filter(e => e.event === 'done')).toHaveLength(1); expect(events.at(-1)!.event).toBe('done');
  expect(events.at(-1)!.data).toMatchObject({ status: 'succeeded', error: null, cached: false, card: record.card, options: record.options, warnings: record.warnings });

  // A folder inside a repository: the listing is that folder's, the paths are the root's.
  const monorepo = await gitRepo('scan-sub', { 'pkg/alpha.ts': sixLines('a'), 'pkg/beta.ts': sixLines('b'), 'pkg/gamma.ts': sixLines('c'), 'other/zzz.ts': sixLines('z'), 'readme.md': '# Mono\n' });
  const inner = await scanFolder(request, auth, join(monorepo.dir, 'pkg'));
  expect(samePath(inner.root, monorepo.dir)).toBe(true); expect(samePath(inner.folder, join(monorepo.dir, 'pkg'))).toBe(true);
  expect(inner.card!.name).toBe('pkg');
  expect(inner.options!.map(o => o.files)).toEqual([['pkg/alpha.ts', 'pkg/beta.ts'], ['pkg/gamma.ts'], ['pkg/alpha.ts']]);
  expect(inner.options!.flatMap(o => o.files).some(f => f.startsWith('other/'))).toBe(false);

  // Fewer than three options is still a success: one file backs all three; no file at all leaves none.
  const solo = await scanFolder(request, auth, await plainFolder('scan-one', { 'solo.ts': sixLines('solo') }));
  expect(solo.options!.map(o => o.files)).toEqual([['solo.ts'], ['solo.ts'], ['solo.ts']]);
  const emptyFolder = await plainFolder('scan-none', {});
  const none = await finishScan(request, await startScan(request, auth, emptyFolder));
  expect(none).toMatchObject({ status: 'succeeded', error: null, options: [] }); expect(none.card!.name).toBe(basename(emptyFolder));
  expect(none.card!.entryPoints).toEqual([]);

  // Must not happen: a scan writing a drawing, a docs folder or any file into the project, or registering a drawing.
  expect(await project.git(['status', '--porcelain'])).toBe(''); expect(await exists(join(project.dir, 'docs'))).toBe(false);
  expect((await monorepo.git(['status', '--porcelain']))).toBe('');
  expect(sorted((await listedDiagrams(request)).map(d => d.id))).toEqual(sorted(diagramsBefore.map(d => d.id)));
  expect(await exists(join(emptyFolder, 'docs'))).toBe(false);
});
