import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, plainFolder, gitWithoutCommit, writeFiles, writeExistingDrawing, token, checkFolder, scanFolder, scanCacheCount, samePath, projectFiles } from './helpers';

const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} ${i + 1}`).join('\n') + '\n';

// SCAN-4 and the folder rules: a scan is kept only for a folder in git, meaning a repository with at least one commit. A
// folder outside git, a `.git` with no commit, is scanned again every time and leaves nothing in the cache. The listing code
// gathers skips what git ignores and, outside git, the folders nobody draws (node_modules, dist, vendor …).
test('H112 [SCAN-4, START-4, SCAN-1] a folder outside git, or a repository with no commit, is scanned again every time and caches nothing, and the folder check says what git and the folder hold', async ({ request }) => {
  const auth = await token(request);
  const before = await scanCacheCount();

  // Not in git at all: the root is the folder itself, there is no commit, and two scans both read the folder.
  const plain = await plainFolder('nogit', { 'src/app.ts': sixLines('app'), 'node_modules/dep/index.js': sixLines('dep'), 'dist/out.js': sixLines('out'), 'vendor/v.go': 'package v\n' });
  const plainCheck = await checkFolder(request, auth, plain);
  expect(plainCheck.status).toBe(200); expect(plainCheck.body).toMatchObject({ git: false, drawing: null });
  expect(samePath(plainCheck.body.folder, plain)).toBe(true); expect(samePath(plainCheck.body.root, plain)).toBe(true);
  const one = await scanFolder(request, auth, plain), two = await scanFolder(request, auth, plain);
  for (const scan of [one, two]) {
    expect(scan).toMatchObject({ status: 'succeeded', cached: false, commit: null });
    expect(scan.progress).toEqual(expect.arrayContaining(['Gathering the repository', 'Reading the inputs', 'Writing the card']));
    expect(scan.progress.some(line => line.startsWith('Scanned before'))).toBe(false);
    expect(scan.options![0].files, 'the walk skips node_modules, dist and vendor').toEqual(['src/app.ts']);
  }
  expect(await scanCacheCount()).toBe(before);

  // A `.git` with no commit is no better: `git rev-parse HEAD` fails there.
  const fresh = await gitWithoutCommit('nocommit');
  const freshCheck = await checkFolder(request, auth, fresh);
  expect(freshCheck.body).toMatchObject({ git: false, drawing: null }); expect(samePath(freshCheck.body.root, fresh)).toBe(true);
  const fresh1 = await scanFolder(request, auth, fresh), fresh2 = await scanFolder(request, auth, fresh);
  for (const scan of [fresh1, fresh2]) expect(scan).toMatchObject({ cached: false, commit: null });
  expect(await scanCacheCount()).toBe(before);

  // In git, the listing is git's: a file the repository ignores is not in it.
  const project = await gitRepo('git-listing', projectFiles);
  await writeFiles(project.dir, { 'aaa-ignored.ts': sixLines('ignored'), '.git/info/exclude': 'aaa-ignored.ts\n' });
  const listed = await scanFolder(request, auth, project.dir);
  expect(listed.options![0].files).toEqual(['alpha.ts', 'beta.ts']);
  expect(await scanCacheCount()).toBe(before + 1); // this one, in git, is kept

  // The check names the drawing a folder already holds, and the root of a folder inside a repository.
  const none = await checkFolder(request, auth, project.dir); expect(none.body).toMatchObject({ git: true, drawing: null });
  const drawing = await writeExistingDrawing(project.dir);
  const withDrawing = await checkFolder(request, auth, project.dir);
  expect(samePath(withDrawing.body.drawing, drawing)).toBe(true); expect(withDrawing.body.git).toBe(true);
  await writeFiles(project.dir, { 'inner/deep.ts': sixLines('deep') });
  const inner = await checkFolder(request, auth, join(project.dir, 'inner'));
  expect(samePath(inner.body.root, project.dir)).toBe(true); expect(samePath(inner.body.folder, join(project.dir, 'inner'))).toBe(true);
  expect(inner.body.drawing).toBeNull(); // only <folder>/docs/architecture.archdraw.json counts, and `inner` has none

  // Must not happen: a check or a scan creating the drawing it looks for, or a docs folder where there was none.
  const emptyDocs = await plainFolder('nodocs', { 'a.ts': sixLines('a') });
  await checkFolder(request, auth, emptyDocs); await scanFolder(request, auth, emptyDocs);
  expect((await checkFolder(request, auth, emptyDocs)).body.drawing).toBeNull();
  expect(await scanCacheCount()).toBe(before + 1);
});
