import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { samePath, writeFiles, writeJSON, shopWithoutFiles } from './helpers';
import { jobServer, tempDir, quickRepo, scanOn, sleep, ms } from './helpers-jobs';

const at = (iso: string) => ms(iso);

// SRC-2, SRC-1, START-4 (api contract, *Recent and found*, *Found on this computer*): the git repositories found below the search home (the
// folder `ARCHDRAW_SEARCH_HOME`), below `code`, `src`, `projects`, `repos`, `dev` and `Documents/GitHub` under it and below the parent of each
// registered drawing's repository: at most two levels below a search root, none already in Recent, newest last commit first (no commit last,
// ties by path), at most 50, kept for five minutes and made again at once on request. Hidden folders, the folders the scan skips, `AppData`,
// `Library`, `Applications` and everything inside the data folder are not searched.
test('H223 [SRC-2 SRC-1 START-4 #198] Found lists the git repositories below the home folder two levels deep, skipping what the contract skips, newest commit first, not those in Recent, at most fifty, kept five minutes and made again on request', async () => {
  test.setTimeout(300_000);
  const base = await tempDir('found');
  const home = join(base, 'home'), data = join(home, 'archdrawer-data'), extra = join(base, 'extra');
  const repo = (...parts: string[]) => join(home, ...parts);
  // Counted: one or two levels below a search root.
  await quickRepo(repo('projects', 'alpha'), '2024-01-01T12:00:00Z');
  await quickRepo(repo('projects', 'team', 'beta'), '2025-03-01T12:00:00Z'); // two levels below `projects`
  await quickRepo(repo('src', 'delta'), '2023-01-01T12:00:00Z');
  await quickRepo(repo('dev', 'eps'), '2026-01-01T12:00:00Z');
  await quickRepo(repo('Documents', 'GitHub', 'zeta'), '2022-01-01T12:00:00Z');
  await quickRepo(repo('direct'), '2021-01-01T12:00:00Z'); // one level below the home folder itself
  await quickRepo(repo('a', 'b'), '2020-01-01T12:00:00Z'); // two levels below it
  await quickRepo(repo('projects', 'fresh'), null); await quickRepo(repo('projects', 'fresh2'), null); // no commit yet: listed last, by path
  // Not counted.
  await quickRepo(repo('projects', 'team', 'deep', 'gamma'), '2023-06-01T12:00:00Z'); // three levels below `projects`
  await quickRepo(repo('x', 'y', 'z'), '2019-01-01T12:00:00Z'); // three levels below the home folder
  await quickRepo(repo('direct', 'vendor', 'lib'), '2018-01-01T12:00:00Z'); // inside a repository
  await quickRepo(repo('.hidden', 'h'), '2024-02-01T12:00:00Z');
  for (const skipped of ['node_modules', 'build', 'vendor', 'AppData', 'Library', 'Applications']) await quickRepo(repo(skipped, 'pkg'), '2024-03-01T12:00:00Z');
  await quickRepo(join(data, 'leak'), '2024-04-01T12:00:00Z'); // inside the data folder
  await writeFiles(repo('code', 'plain'), { 'x.txt': 'not a repository\n' });

  const server = await jobServer({ home, data });
  try {
    const sources = async () => (await server.get('/api/sources')).body;
    const foundPaths = (s: { found: { path: string }[] }) => s.found.map(e => e.path);
    const names = (s: { found: { path: string }[] }) => s.found.map(e => basename(e.path));

    // ---- The list: what counts, in the order of the contract.
    const first = await sources();
    expect(names(first), 'newest commit first; no commit last, by path').toEqual(['eps', 'beta', 'alpha', 'delta', 'zeta', 'direct', 'b', 'fresh', 'fresh2']);
    const expectedPaths = [repo('dev', 'eps'), repo('projects', 'team', 'beta'), repo('projects', 'alpha'), repo('src', 'delta'), repo('Documents', 'GitHub', 'zeta'), repo('direct'), repo('a', 'b'), repo('projects', 'fresh'), repo('projects', 'fresh2')];
    first.found.forEach((e: { path: string }, i: number) => expect(samePath(e.path, expectedPaths[i]), `${e.path} is ${expectedPaths[i]}`).toBe(true));
    expect(new Set(foundPaths(first)).size, 'a root reached twice is walked once').toBe(first.found.length);
    expect(first.found[0]).toMatchObject({ name: 'eps', branch: 'main', link: null, diagrams: [], usedAt: null });
    expect(at(first.found[0].lastCommitAt)).toBe(at('2026-01-01T12:00:00Z'));
    expect(first.found.at(-1)).toMatchObject({ name: 'fresh2', lastCommitAt: null, diagrams: [], usedAt: null });
    expect(first.recent).toEqual([]);
    expect(Number.isNaN(ms(first.foundAt))).toBe(false);

    // ---- Kept: a repository made after the list is not in it until it is asked for again.
    await quickRepo(repo('projects', 'late'), '2027-01-01T12:00:00Z');
    await sleep(40);
    const kept = await sources();
    expect(names(kept), 'the list made a moment ago is answered again').toEqual(names(first));
    expect(kept.foundAt).toBe(first.foundAt);
    expect((await server.post('/api/sources/refresh', {}, null)).status, 'a POST needs the token').toBe(403);
    const refreshed = await server.post('/api/sources/refresh');
    expect(refreshed.status).toBe(200);
    expect(names(refreshed.body)).toEqual(['late', 'eps', 'beta', 'alpha', 'delta', 'zeta', 'direct', 'b', 'fresh', 'fresh2']);
    expect(ms(refreshed.body.foundAt), 'made again at once').toBeGreaterThan(ms(first.foundAt));
    expect(Object.keys(refreshed.body).sort()).toEqual(['found', 'foundAt', 'picker', 'recent']);
    expect(names(await sources())).toEqual(names(refreshed.body));

    // ---- Recent wins: a folder scanned moves from Found to Recent.
    await scanOn(server, { folder: repo('projects', 'alpha') });
    const afterScan = (await server.post('/api/sources/refresh')).body;
    expect(names(afterScan)).not.toContain('alpha');
    expect(afterScan.recent.map((e: { path: string }) => basename(e.path))).toEqual(['alpha']);
    expect(afterScan.recent[0]).toMatchObject({ branch: 'main', link: null, diagrams: [] });

    // ---- The parent of a registered drawing's repository is a search root too (and the repository itself is in Recent, so not in Found).
    const r1 = join(extra, 'parent', 'r1');
    await mkdir(join(r1, '.git'), { recursive: true }); await writeFile(join(r1, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeJSON(join(r1, 'architecture.archdraw.json'), shopWithoutFiles('Extra'));
    await quickRepo(join(extra, 'parent', 'r2'), '2024-05-01T12:00:00Z');
    const registered = await server.post('/api/files', { path: join(r1, 'architecture.archdraw.json') });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    const withExtra = (await server.post('/api/sources/refresh')).body;
    expect(withExtra.found.some((e: { path: string }) => samePath(e.path, join(extra, 'parent', 'r2'))), 'a sibling of a registered drawing\'s repository').toBe(true);
    expect(withExtra.found.some((e: { path: string }) => samePath(e.path, r1)), 'the repository of the drawing is in Recent').toBe(false);
    expect(withExtra.recent.some((e: { path: string; diagrams: string[] }) => samePath(e.path, r1) && e.diagrams.length === 1)).toBe(true);

    // ---- At most fifty, the newest first.
    const many = Array.from({ length: 55 }, (_, i) => ({ i, date: new Date(Date.UTC(2028, 0, 1 + i, 12)).toISOString().replace('.000Z', 'Z') }));
    for (let at0 = 0; at0 < many.length; at0 += 11)
      await Promise.all(many.slice(at0, at0 + 11).map(m => quickRepo(repo('repos', `r${String(m.i).padStart(2, '0')}`), m.date)));
    const capped = (await server.post('/api/sources/refresh')).body;
    expect(capped.found).toHaveLength(50);
    expect(names(capped), 'the fifty newest, the newest first').toEqual(many.slice(5).reverse().map(m => `r${String(m.i).padStart(2, '0')}`));
    const times = capped.found.map((e: { lastCommitAt: string }) => at(e.lastCommitAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(capped.recent.length, 'Recent is not cut by Found').toBeGreaterThanOrEqual(2);
  } finally { await server.stop(); }
});
