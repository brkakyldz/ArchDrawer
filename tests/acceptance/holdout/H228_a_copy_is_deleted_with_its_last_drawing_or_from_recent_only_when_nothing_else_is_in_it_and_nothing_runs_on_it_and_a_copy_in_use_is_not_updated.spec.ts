import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { exists, samePath, writeExistingDrawing, shopWithoutFiles } from './helpers';
import { option, typed } from './helpers-selections';
import {
  jobServer, makeRemote, copyOf, headOf, branchOf, short, startScanOn, awaitScan, scanOn, drawOn, awaitRun, runRec, registerDrawing, diagramIds, until,
} from './helpers-jobs';

const LINK = 'github.com/acme/shop';
const IN_USE = 'This repository is in use: try again when its scans and instructions have ended';

// SRC-6, SRC-5, JOB-1, START-4 (api contract, *Deleting a copy*, *Recent and found*, *In use*, *A scan with a link*): deleting a copy's drawing
// with `deleteCopy=true` removes the copy too, but only when it is a copy, no other drawing of the list is in it and nothing runs on it; every
// check comes before anything is forgotten. The same through `Recent`. A copy in use is not updated, and a link asking for another branch of it
// is refused with one plain sentence.
test('H228 [SRC-6 SRC-5 START-4 #199] a copy is deleted with its drawing or from Recent only when it is a copy, no other drawing is in it and nothing runs on it, every refusal forgets nothing, and a copy in use is not updated', async () => {
  test.setTimeout(60_000);
  const server = await jobServer({ remotes: true, slots: 3, stepMs: 100 });
  try {
    const shop = await makeRemote(server, LINK);
    await makeRemote(server, 'github.com/acme/second'); await makeRemote(server, 'github.com/acme/third');
    const copy = copyOf(server, LINK);
    const recentEntry = async (path: string) => ((await server.get('/api/sources')).body.recent as { path: string; link: string | null; diagrams: string[] }[]).find(e => samePath(e.path, path));

    // ---- A copy with two drawings in it, one a draw's.
    const scan = await scanOn(server, { link: `https://${LINK}` });
    const run = await awaitRun(server, await drawOn(server, scan.id, [option('o1')], 'readme'), 'succeeded');
    const d1 = run.diagramId as string;
    const secondFile = await writeExistingDrawing(copy, 'other.archdraw.json', 'A second drawing');
    const registered = await server.post('/api/files', { path: secondFile });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    const d2 = registered.body.id as string;
    const listed = (await server.get('/api/diagrams')).body.diagrams as { id: string; link: string | null }[];
    expect(listed.filter(d => d.link === LINK).map(d => d.id).sort(), 'both drawings name the link').toEqual([d1, d2].sort());
    expect((await recentEntry(copy))!.diagrams.sort()).toEqual([d1, d2].sort());

    // ---- Refusals, each leaving everything as it was.
    const intact = async (what: string) => {
      expect(await exists(copy), `${what}: the copy is still there`).toBe(true);
      expect(await diagramIds(server), `${what}: nothing was forgotten`).toContain(d1);
    };
    expect(await server.post('/api/sources/forget', { path: copy, deleteCopy: true }), 'its drawings are in the list').toEqual({ status: 409, body: { error: 'Remove its drawings from the list first' } });
    expect(await server.del(`/api/diagrams/${d1}?deleteCopy=true`), 'another drawing of the list is in the copy').toEqual({ status: 409, body: { error: 'Other drawings in the list are in this copy' } });
    await intact('another drawing is in the copy'); expect(await diagramIds(server)).toContain(d2);
    const local = await registerDrawing(server, 'delete-local');
    expect(await server.del(`/api/diagrams/${local.id}?deleteCopy=true`), 'a drawing outside a copy').toEqual({ status: 400, body: { error: 'This drawing is not in a copy made from a link' } });
    expect(await diagramIds(server)).toContain(local.id);
    const imported = await server.post('/api/diagrams', shopWithoutFiles('Imported'));
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(await server.del(`/api/diagrams/${imported.body.id}?deleteCopy=true`), 'an imported drawing').toEqual({ status: 400, body: { error: 'This drawing is not in a copy made from a link' } });
    expect((await server.del(`/api/diagrams/${imported.body.id}`)).status).toBe(204);

    // A value other than `true` is ignored: the second drawing is only forgotten; its file and the copy stay.
    expect((await server.del(`/api/diagrams/${d2}?deleteCopy=yes`)).status).toBe(204);
    expect(await diagramIds(server)).not.toContain(d2); expect(await exists(secondFile), 'the file stays on disk').toBe(true);
    await intact('deleteCopy=yes');

    // ---- A draw runs on the copy: it is in use. It is not updated, a branch of it is refused, and deleting it is refused.
    const headBefore = await headOf(copy);
    const holdScan = await scanOn(server, { link: `https://${LINK}` });
    const holdRun = await drawOn(server, holdScan.id, [typed('Hold [fixture:slow]')], 'readme');
    await until(() => runRec(server, holdRun), r => r.status === 'running' && r.progress.length > 0, 'the slow draw to run', 15_000);
    const newer = await shop.commit({ 'zz-newer.ts': '// newer\n' });
    await shop.branch('feature/x', { 'x.ts': '// x\n' });
    expect(await server.del(`/api/diagrams/${d1}?deleteCopy=true`), 'a draw runs on the copy').toEqual({ status: 409, body: { error: IN_USE } });
    await intact('the copy is in use');
    const notUpdated = await awaitScan(server, await startScanOn(server, { link: `https://${LINK}` }), 'succeeded', 30_000);
    expect(notUpdated.progress.slice(0, 2)).toEqual([`Fetching the newest commit of ${LINK}`, `This repository is in use: scanning the copy at ${short(headBefore)} on main`]);
    expect(await headOf(copy), 'nothing was fetched while the copy was in use').toBe(headBefore); expect(notUpdated.commit).toBe(headBefore);
    const otherBranch = await awaitScan(server, await startScanOn(server, { link: `https://${LINK}/tree/feature/x` }), 'failed', 30_000);
    expect(otherBranch.error).toBe('This repository is in use on the branch "main": try again when its drawings and instructions have ended');
    expect(await branchOf(copy)).toBe('main'); expect(await headOf(copy)).toBe(headBefore);
    expect((await server.post(`/api/runs/${holdRun}/cancel`)).body).toEqual({ ok: true });
    await awaitRun(server, holdRun, 'cancelled', 15_000);
    // Once nothing runs on it, the same link updates it.
    const updated = await awaitScan(server, await startScanOn(server, { link: `https://${LINK}` }), 'succeeded', 30_000);
    expect(updated.progress.slice(0, 2)).toEqual([`Fetching the newest commit of ${LINK}`, `Updated to ${short(newer)}`]);
    expect(await headOf(copy)).toBe(newer);

    // ---- Nothing in the way: the drawing and its copy go; the folder, its drawings' files and its entry in Recent with them.
    expect((await server.del(`/api/diagrams/${d1}?deleteCopy=true`)).status).toBe(204);
    expect(await exists(copy), 'the copy is deleted').toBe(false);
    expect(await exists(run.path) || await exists(secondFile), 'everything in it went with it').toBe(false);
    expect(await diagramIds(server)).not.toContain(d1);
    expect(await recentEntry(copy), 'its entry left Recent').toBeUndefined();
    expect((await server.post('/api/folders/check', { link: LINK })).body).toMatchObject({ copied: false, git: false, drawing: null });
    const fresh = await awaitScan(server, await startScanOn(server, { link: `https://${LINK}` }), 'succeeded', 30_000);
    expect(fresh.progress[0], 'the link makes a new copy').toBe(`Copying ${LINK}`);

    // ---- Through Recent: a copy with no drawing is deleted when asked, kept when not, and never while a scan runs on it.
    const second = copyOf(server, 'github.com/acme/second');
    await scanOn(server, { link: 'https://github.com/acme/second' });
    expect(await recentEntry(second)).toMatchObject({ link: 'github.com/acme/second', diagrams: [] });
    expect(await server.post('/api/sources/forget', { path: second, deleteCopy: true })).toEqual({ status: 200, body: { ok: true, deleted: true } });
    expect(await exists(second)).toBe(false); expect(await recentEntry(second)).toBeUndefined();

    const third = copyOf(server, 'github.com/acme/third');
    await scanOn(server, { link: 'https://github.com/acme/third' });
    await writeFile(join(server.remotes!, 'github.com', 'acme', 'third.slow'), '', 'utf8'); // the next fetch of it waits 30 s: a scan runs on the copy
    const running = await startScanOn(server, { link: 'https://github.com/acme/third' });
    await until(() => server.get(`/api/scans/${running}`).then(r => r.body), r => r.progress.length > 0, 'the fetch to start', 15_000);
    expect(await server.post('/api/sources/forget', { path: third, deleteCopy: true }), 'a scan runs on the copy').toEqual({ status: 409, body: { error: IN_USE } });
    expect(await exists(third)).toBe(true); expect(await recentEntry(third)).toBeDefined();
    await server.post(`/api/scans/${running}/cancel`); await awaitScan(server, running, 'cancelled', 20_000);
    await rm(join(server.remotes!, 'github.com', 'acme', 'third.slow'));
    expect(await server.post('/api/sources/forget', { path: third })).toEqual({ status: 200, body: { ok: true, deleted: false } });
    expect(await recentEntry(third), 'forgotten from Recent').toBeUndefined();
    expect(await exists(third), 'a copy stays unless it is asked to go').toBe(true);
    const reused = await awaitScan(server, await startScanOn(server, { link: 'https://github.com/acme/third' }), 'succeeded', 30_000);
    expect(reused.progress[0], 'pasting its link again uses the copy that is there').toBe(`Fetching the newest commit of github.com/acme/third`);
  } finally { await server.stop(); }
});
