import { test, expect } from '@playwright/test';
import { gitRepo, token, startScan, scanRecord, scanFolder, scanEvents, scanCacheCount } from './helpers';

const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} ${i + 1}`).join('\n') + '\n';

// SCAN-4: the answer is kept per repository root, folder and commit. The same commit answers at once without the engine,
// a tree with uncommitted changes uses the same entry, `refresh: true` scans again and replaces the entry, a new commit
// is another entry.
test('H111 [SCAN-4, SCAN-1, START-4] a second scan of the same commit answers at once from the cache, refresh scans again, and a new commit is scanned again', async ({ request }) => {
  const auth = await token(request);
  const project = await gitRepo('scan-cache');
  const entriesBefore = await scanCacheCount();
  const firstCommit = await project.head();

  // The first scan reads the folder and keeps its answer.
  const first = await scanFolder(request, auth, project.dir);
  expect(first.cached).toBe(false); expect(firstCommit.startsWith(first.commit!)).toBe(true);
  expect(first.progress).toEqual(expect.arrayContaining(['Reading the inputs', 'Writing the card']));
  expect(await scanCacheCount()).toBe(entriesBefore + 1);

  // The same commit: the record is created already succeeded, says it was scanned before, and no engine ran.
  const secondId = await startScan(request, auth, project.dir);
  const second = await scanRecord(request, secondId); // no waiting: a cached scan answers at once
  expect(second).toMatchObject({ status: 'succeeded', cached: true, error: null });
  expect(second.progress).toHaveLength(1); expect(second.progress[0]).toMatch(/^Scanned before at [0-9a-f]{4,40}$/);
  expect(firstCommit.startsWith(second.progress[0].replace('Scanned before at ', ''))).toBe(true);
  expect(second.card).toEqual(first.card); expect(second.options).toEqual(first.options); expect(second.warnings).toEqual(first.warnings);
  const events = await scanEvents(secondId);
  expect(events.filter(e => e.event === 'progress').map(e => e.data.message)).toEqual(second.progress);
  expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'succeeded', cached: true, card: first.card, options: first.options } });
  expect(await scanCacheCount()).toBe(entriesBefore + 1);

  // Uncommitted changes use the same entry: the new file is not looked at.
  await project.write({ 'aaa.ts': sixLines('aaa') });
  const dirty = await scanFolder(request, auth, project.dir);
  expect(dirty.cached).toBe(true); expect(dirty.options!.map(o => o.files)).toEqual(first.options!.map(o => o.files));

  // `refresh: true` scans again, now sees the new file first in the listing, and replaces the entry.
  const refreshed = await scanFolder(request, auth, project.dir, { refresh: true });
  expect(refreshed.cached).toBe(false); expect(refreshed.progress).toEqual(expect.arrayContaining(['Reading the inputs', 'Writing the card']));
  expect(refreshed.options![0].files).toEqual(['aaa.ts', 'alpha.ts']);
  expect(await scanCacheCount()).toBe(entriesBefore + 1); // replaced, not added
  const afterRefresh = await scanFolder(request, auth, project.dir);
  expect(afterRefresh.cached).toBe(true); expect(afterRefresh.options).toEqual(refreshed.options);

  // A new commit is another entry and is scanned again.
  const secondCommit = await project.commit({ 'delta.ts': sixLines('delta') });
  expect(secondCommit).not.toBe(firstCommit);
  const next = await scanFolder(request, auth, project.dir);
  expect(next.cached).toBe(false); expect(secondCommit.startsWith(next.commit!)).toBe(true); expect(next.commit).not.toBe(first.commit);
  expect(next.options![0].files).toEqual(['aaa.ts', 'alpha.ts']);
  expect(await scanCacheCount()).toBe(entriesBefore + 2);
  expect((await scanFolder(request, auth, project.dir)).cached).toBe(true);

  // Going back to the first commit finds its entry again: opening the same commit again does not rescan.
  await project.git(['checkout', '--detach', firstCommit]);
  const back = await scanFolder(request, auth, project.dir);
  expect(back.cached).toBe(true); expect(back.options).toEqual(refreshed.options); expect(back.progress[0]).toMatch(/^Scanned before at /);
  expect(back.progress).toHaveLength(1);
  // Must not happen: a cached answer starting an engine run, or the cache growing on its own.
  expect(await scanCacheCount()).toBe(entriesBefore + 2);
});
