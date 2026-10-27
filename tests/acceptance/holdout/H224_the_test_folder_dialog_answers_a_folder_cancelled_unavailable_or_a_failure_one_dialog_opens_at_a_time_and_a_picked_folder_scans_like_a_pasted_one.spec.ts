import { test, expect } from '@playwright/test';
import { join, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { gitRepo, writeExistingDrawing, exists, samePath, writeFiles, projectFiles } from './helpers';
import { jobServer, tempDir, writePicker, scanOn, activityOf, sleep } from './helpers-jobs';

// SRC-3, START-4 (api contract, *The folder dialog*; testing contract, *The test folder dialog*; AGENTS.md invariant 7): with
// `ARCHDRAW_TEST_PICKER` set no helper runs and the file names the answer at each request. A picked folder is checked as a pasted one and
// answered as the folder check answers it, a cancelled or empty dialog changes nothing, `none` means no dialog, one dialog is open at a time
// and a request that went away frees it. A pick writes and starts nothing; the folder it gives scans like a pasted one.
test('H224 [SRC-3 START-4 #198] the test folder dialog answers a folder, cancelled, unavailable or a failure, one dialog opens at a time, a closed request frees it, and a picked folder is checked and scanned like a pasted one', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ picker: true, stepMs: 100 });
  try {
    const pick = (auth?: string | null) => server.post('/api/folders/pick', {}, auth);
    const picker = async () => (await server.get('/api/sources')).body.picker;
    expect(server.output(), 'the start-up line names the test switch that is on').toMatch(/engines: fixture · test folder dialog/);
    expect(server.output()).not.toMatch(/test links/);

    // ---- Cancelled: no file, an empty file, `cancel`.
    expect(await picker()).toBe(true);
    expect(await pick(), 'no file').toEqual({ status: 200, body: { status: 'cancelled' } });
    await writePicker(server, ''); expect(await pick(), 'an empty file').toEqual({ status: 200, body: { status: 'cancelled' } });
    await writePicker(server, '  cancel  ', 'ignored second line'); expect(await pick()).toEqual({ status: 200, body: { status: 'cancelled' } });

    // ---- A folder: answered as the folder check answers it.
    const repo = await gitRepo('pick-repo'), sub = join(repo.dir, 'src');
    await mkdir(sub); // `gitRepo` writes no `src` folder, and a folder that does not exist is a 400 (api contract, *Folders*)
    await writePicker(server, `${repo.dir}${sep}\n`); // a trailing separator and a line end are dropped
    const picked = await pick();
    expect(picked.status, JSON.stringify(picked.body)).toBe(200);
    expect(picked.body).toMatchObject({ status: 'picked', git: true, drawing: null, link: null, branch: null, copied: false });
    expect(samePath(picked.body.folder, repo.dir), picked.body.folder).toBe(true); expect(picked.body.folder.endsWith(sep)).toBe(false);
    expect(samePath(picked.body.root, repo.dir)).toBe(true);
    expect((await server.post('/api/folders/check', { folder: repo.dir })).body, 'the same answer as the check').toEqual({ ...picked.body, status: undefined });
    await writePicker(server, sub);
    const inside = (await pick()).body;
    expect(inside).toMatchObject({ status: 'picked', git: true }); expect(samePath(inside.folder, sub)).toBe(true); expect(samePath(inside.root, repo.dir)).toBe(true);
    const drawn = await gitRepo('pick-drawing'); const existing = await writeExistingDrawing(drawn.dir);
    await writePicker(server, drawn.dir);
    const withDrawing = (await pick()).body;
    expect(samePath(withDrawing.drawing, existing), String(withDrawing.drawing)).toBe(true);

    // Letters outside ASCII arrive unchanged (the dialog's output is read as UTF-8).
    const turkish = join(await tempDir('pick'), 'Masaüstü', 'dükkan'); await mkdir(turkish, { recursive: true }); await writeFiles(turkish, projectFiles);
    await writePicker(server, turkish);
    const accented = (await pick()).body;
    expect(accented.status).toBe('picked'); expect(accented.folder, 'not turned into another folder').toContain('Masaüstü');
    expect(samePath(accented.folder, turkish), accented.folder).toBe(true);

    // ---- A folder the checks refuse: their sentences, as for a pasted one.
    await writePicker(server, 'some/relative/folder');
    expect(await pick()).toEqual({ status: 400, body: { error: 'The path must be absolute' } });
    await writePicker(server, join(repo.dir, 'nothing-here'));
    const missing = await pick(); expect(missing.status).toBe(400); expect(missing.body.error).toMatch(/^Not found: .*nothing-here$/);
    await writePicker(server, join(repo.dir, 'alpha.ts'));
    const aFile = await pick(); expect(aFile.status).toBe(400); expect(aFile.body.error).toMatch(/^Not a folder: .*alpha\.ts$/);

    // ---- A failure, and no dialog at all.
    await writePicker(server, 'fail');
    expect(await picker()).toBe(true);
    expect(await pick()).toEqual({ status: 500, body: { error: 'The folder dialog failed: Test dialog failure' } });
    await writePicker(server, 'none');
    expect(await picker(), 'the page shows Choose folder… only when this is true').toBe(false);
    expect(await pick()).toEqual({ status: 200, body: { status: 'unavailable' } });
    await writePicker(server, repo.dir); expect(await picker(), 'asked again at every request').toBe(true);

    // A pick needs the token like every POST.
    expect((await pick(null)).status).toBe(403);

    // ---- One dialog at a time: a second pick while a slow one is open is refused and opens nothing.
    await writePicker(server, repo.dir, 'slow');
    const t0 = Date.now(), slow = pick();
    await sleep(500);
    expect(await pick(), 'the dialog is already open').toEqual({ status: 409, body: { error: 'The folder dialog is already open' } });
    const slowAnswer = await slow;
    expect(slowAnswer.body.status).toBe('picked'); expect(Date.now() - t0, 'the slow dialog answered after about 3 s').toBeGreaterThanOrEqual(2_500);
    await writePicker(server, repo.dir); // the file is read at each request: only the picks that need the slow dialog wait 3 s
    expect((await pick()).status, 'the dialog is free again once it answered').toBe(200);

    // A request that went away closes its dialog: the next pick opens at once and is not refused.
    await writePicker(server, repo.dir, 'slow');
    const controller = new AbortController();
    const gone = fetch(`${server.base}/api/folders/pick`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-archdraw-token': server.token }, body: '{}', signal: controller.signal }).catch(() => null);
    await sleep(500); controller.abort(); await gone; await sleep(500);
    await writePicker(server, repo.dir);
    const next = await pick();
    expect(next.status, JSON.stringify(next.body)).toBe(200); expect(next.body.status).toBe('picked');

    // ---- A pick writes and starts nothing; the folder it gave scans like a pasted one and is then in Recent.
    const before = (await server.get('/api/sources')).body;
    expect(before.recent, 'picking is no use of a folder').toEqual([]);
    expect(await exists(join(server.data, 'sources.json'))).toBe(false);
    expect((await activityOf(server)).jobs).toEqual([]);
    await writePicker(server, repo.dir);
    const folder = (await pick()).body.folder as string;
    const scan = await scanOn(server, { folder });
    expect(scan.card).not.toBeNull();
    const after = (await server.get('/api/sources')).body;
    expect(after.recent).toHaveLength(1); expect(samePath(after.recent[0].path, repo.dir)).toBe(true);
  } finally { await server.stop(); }
});
