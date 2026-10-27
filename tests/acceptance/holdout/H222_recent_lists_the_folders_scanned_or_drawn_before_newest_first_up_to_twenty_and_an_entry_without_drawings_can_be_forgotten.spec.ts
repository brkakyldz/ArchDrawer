import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { rm } from 'node:fs/promises';
import { gitRepo, exists, samePath } from './helpers';
import { option } from './helpers-selections';
import { jobServer, scanOn, drawOn, awaitRun, registerDrawing, sleep, readDoc, until, ms } from './helpers-jobs';

// SRC-1, START-4 (api contract, *Recent and found*, *Forgetting an entry*): `Recent` lists the folders scanned (a cached scan too) or drawn
// before and the repositories of registered drawings, newest first, at most 20, each with name, path, branch, last commit, link and its
// drawings; a folder that is gone is left out; asking writes nothing; an entry with no drawing in the list can be removed, with the
// checks of the contract in their order.
test('H222 [SRC-1 START-4 #198] Recent lists the folders scanned or drawn before newest first with their branch and last commit, leaves out a folder that is gone, holds twenty, and an entry without drawings can be forgotten', async () => {
  test.setTimeout(300_000);
  const server = await jobServer({ slots: 3, stepMs: 100 });
  try {
    const sources = async () => (await server.get('/api/sources')).body;
    const file = join(server.data, 'sources.json');
    const first = await sources();
    expect(Object.keys(first).sort()).toEqual(['found', 'foundAt', 'picker', 'recent']);
    expect(first.recent).toEqual([]); expect(first.found, 'nothing to find under an empty home').toEqual([]);
    expect(typeof first.picker).toBe('boolean'); expect(Number.isNaN(ms(first.foundAt))).toBe(false);
    expect(await exists(file), 'asking writes nothing').toBe(false);

    // ---- A scan puts a folder at the top; a cached scan moves it up again.
    const a = await gitRepo('recent-a'), b = await gitRepo('recent-b'), c = await gitRepo('recent-c');
    await scanOn(server, { folder: a.dir }); await sleep(30); await scanOn(server, { folder: b.dir });
    let recent = (await sources()).recent;
    expect(recent.map((e: { path: string }) => basename(e.path))).toEqual([basename(b.dir), basename(a.dir)]);
    const branchB = (await b.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), commitB = (await b.git(['log', '-1', '--format=%cI'])).trim();
    expect(recent[0]).toMatchObject({ name: basename(b.dir), branch: branchB, link: null, diagrams: [] });
    expect(samePath(recent[0].path, b.dir), recent[0].path).toBe(true);
    expect(ms(recent[0].lastCommitAt), 'the committer date of HEAD').toBe(ms(commitB));
    expect(Number.isNaN(ms(recent[0].usedAt))).toBe(false);
    const usedA = ms(recent[1].usedAt);
    await sleep(30);
    await scanOn(server, { folder: a.dir }); // the same commit: cached, and still a use
    recent = (await sources()).recent;
    expect(recent.map((e: { path: string }) => basename(e.path)), 'a cached scan moves the folder to the top').toEqual([basename(a.dir), basename(b.dir)]);
    expect(ms(recent[0].usedAt)).toBeGreaterThan(usedA);

    // A refused folder is no use; what is kept is a plain list of folders and times.
    expect((await server.post('/api/scans', { folder: join(a.dir, 'nothing-here'), engine: 'fixture', model: null })).status).toBe(400);
    expect((await sources()).recent.map((e: { path: string }) => basename(e.path))).toEqual([basename(a.dir), basename(b.dir)]);
    const stored = await readDoc(file);
    expect(stored.recent.map((e: { path: string }) => basename(e.path))).toEqual(expect.arrayContaining([basename(a.dir), basename(b.dir)]));
    for (const entry of stored.recent) { expect(typeof entry.path).toBe('string'); expect(Number.isNaN(ms(entry.usedAt))).toBe(false); }
    const textBefore = JSON.stringify(stored);
    for (let i = 0; i < 3; i++) await sources();
    expect(JSON.stringify(await readDoc(file)), 'a GET changes nothing on disk').toBe(textBefore);

    // ---- A folder that is gone is left out of the list; the next write drops it from the file.
    await scanOn(server, { folder: c.dir });
    expect((await sources()).recent.map((e: { path: string }) => basename(e.path))[0]).toBe(basename(c.dir));
    await rm(c.dir, { recursive: true, force: true });
    expect((await sources()).recent.map((e: { path: string }) => basename(e.path)), 'a folder that no longer exists').toEqual([basename(a.dir), basename(b.dir)]);
    await scanOn(server, { folder: a.dir });
    expect(JSON.stringify(await readDoc(file)).includes(basename(c.dir)), 'dropped from the file at the next write').toBe(false);

    // ---- A registered drawing puts its repository in the list, with the drawing; so does a draw.
    const reg = await registerDrawing(server, 'recent-registered');
    recent = (await sources()).recent;
    expect(recent[0]).toMatchObject({ name: basename(reg.dir), diagrams: [reg.id], link: null });
    expect(samePath(recent[0].path, reg.dir)).toBe(true);
    const scanA = await scanOn(server, { folder: a.dir });
    const drawn = await awaitRun(server, await drawOn(server, scanA.id, [option('o2')], 'linkedin'), 'succeeded');
    recent = (await sources()).recent;
    expect(recent[0], 'the folder just drawn is at the top, with its drawing').toMatchObject({ name: basename(a.dir), diagrams: [drawn.diagramId] });

    // ---- Forgetting: the checks in their order, each leaving everything as it was.
    const forget = (body: unknown, auth?: string | null) => server.post('/api/sources/forget', body, auth);
    expect(await forget({}), 'no path').toEqual({ status: 400, body: { error: 'Give the path of a recent folder' } });
    expect(await forget({ path: 42 })).toEqual({ status: 400, body: { error: 'Give the path of a recent folder' } });
    expect(await forget({ path: join(b.dir, 'nothing'), deleteCopy: 'yes' }), 'deleteCopy is checked with the path, before the entry').toEqual({ status: 400, body: { error: 'deleteCopy must be true or false' } });
    expect(await forget({ path: join(b.dir, 'nothing') })).toEqual({ status: 404, body: { error: 'Not in the recent list' } });
    expect(await forget({ path: a.dir }), 'its drawing is still in the list').toEqual({ status: 409, body: { error: 'Remove its drawings from the list first' } });
    expect(await forget({ path: a.dir, deleteCopy: true }), 'before it is asked whether it is a copy').toEqual({ status: 409, body: { error: 'Remove its drawings from the list first' } });
    expect(await forget({ path: b.dir, deleteCopy: true }), 'not a copy made from a link').toEqual({ status: 400, body: { error: 'Only a copy made from a link can be deleted' } });
    expect((await forget({ path: b.dir }, null)).status, 'a change needs the token').toBe(403);
    expect((await sources()).recent.map((e: { path: string }) => basename(e.path)), 'nothing changed').toContain(basename(b.dir));

    expect(await forget({ path: b.dir })).toEqual({ status: 200, body: { ok: true, deleted: false } });
    expect((await sources()).recent.map((e: { path: string }) => basename(e.path))).not.toContain(basename(b.dir));
    expect(await exists(b.dir), 'only the list changed, the folder is where it was').toBe(true);
    expect(JSON.stringify(await readDoc(file)).includes(basename(b.dir))).toBe(false);
    expect((await server.del(`/api/diagrams/${drawn.diagramId}`)).status).toBe(204); // the drawing leaves the list; the folder stays in Recent
    expect((await sources()).recent.find((e: { path: string }) => samePath(e.path, a.dir))).toMatchObject({ diagrams: [] });
    expect(await forget({ path: a.dir })).toEqual({ status: 200, body: { ok: true, deleted: false } });

    // ---- At most twenty, the newest first.
    const regs = [] as { id: string; dir: string }[];
    for (let i = 0; i < 22; i++) { regs.push(await registerDrawing(server, `recent-many-${i}`)); await sleep(20); }
    recent = (await sources()).recent;
    expect(recent).toHaveLength(20);
    expect(recent.map((e: { path: string }) => e.path).every((p: string, i: number) => samePath(p, regs[21 - i].dir)), 'the twenty registered last, newest first').toBe(true);
    expect(recent.every((e: { path: string }) => !samePath(e.path, regs[0].dir) && !samePath(e.path, regs[1].dir)), 'the two oldest fell off').toBe(true);
    const times = recent.map((e: { usedAt: string }) => ms(e.usedAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    await until(() => sources(), s => s.recent.length === 20, 'twenty entries', 5_000);
  } finally { await server.stop(); }
});
