import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists, samePath } from './helpers';
import { option } from './helpers-selections';
import {
  jobServer, makeRemote, copyOf, branchOf, headOf, short, gitIn, reposListing, startScanOn, awaitScan, drawOn, awaitRun, scanEventsOf,
  activityOf, jobOf, until, ISO_MS,
} from './helpers-jobs';

const LINK = 'github.com/acme/shop';

// SRC-4, SRC-5, SRC-6, START-4 (api contract, *A repository from a link*, *A scan with a link*; testing contract, *Test links*; AGENTS.md
// invariant 1): a pasted link is read, checked without copying anything, then copied (one commit, into the data folder), scanned and drawn
// like a folder, its drawing written into the copy and listed with its link. A later scan fetches the newest commit first, whether the link,
// the copy's folder or a branch link is scanned, and never touches the drawing file the copy holds.
test('H225 [SRC-4 SRC-5 SRC-6 START-4 #199] a test link is copied, scanned and drawn into its copy and listed with its link, a second scan fetches the newest commit, and a branch link switches the copy and back', async () => {
  test.setTimeout(300_000);
  const server = await jobServer({ remotes: true, slots: 3, stepMs: 100 });
  try {
    expect(server.output(), 'the start-up line names the test switch that is on').toMatch(/engines: fixture · test links/);
    const shop = await makeRemote(server, LINK);
    const copy = copyOf(server, LINK);

    // ---- Reading a link copies nothing; every way of writing it gives the same link.
    for (const written of ['https://github.com/Acme/Shop', 'www.github.com/acme/shop.git/', 'https://github.com/acme/shop?tab=readme#top', 'github.com/acme/shop', '  https://GitHub.com/acme/shop  ']) {
      const checked = await server.post('/api/folders/check', { link: written });
      expect(checked.status, `${written}: ${JSON.stringify(checked.body)}`).toBe(200);
      expect(checked.body).toMatchObject({ git: false, drawing: null, link: LINK, branch: null, copied: false });
      expect(samePath(checked.body.folder, copy), checked.body.folder).toBe(true); expect(samePath(checked.body.root, copy)).toBe(true);
    }
    expect(await reposListing(server), 'nothing was copied or fetched').toEqual({ copies: [], partial: [] });

    // ---- The first scan copies, then scans the copy.
    const scanId = await startScanOn(server, { link: 'https://github.com/acme/shop' });
    const started = (await server.get(`/api/scans/${scanId}`)).body;
    expect(started).toMatchObject({ status: 'running', link: LINK, name: 'shop' });
    expect(samePath(started.folder, copy) && samePath(started.root, copy), started.folder).toBe(true);
    const scan = await awaitScan(server, scanId);
    expect(scan.progress[0]).toBe(`Copying ${LINK}`);
    expect(scan.progress.indexOf('Gathering the repository')).toBeGreaterThan(0);
    expect(scan.progress, 'a free slot: nothing to wait for').not.toContain('Waiting for a free engine');
    expect(scan).toMatchObject({ link: LINK, cached: false, commit: await shop.head() });
    expect(scan.card.name).toBe('shop'); expect(scan.name).toBe('shop');
    const events = await scanEventsOf(server, scanId);
    const copying = events.find(e => e.event === 'progress' && e.data.message === `Copying ${LINK}`)!;
    expect(copying.data).toMatchObject({ source: 'server' }); expect(copying.data.at).toMatch(ISO_MS);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'succeeded', link: LINK } });
    const firstEngine = events.find(e => e.event === 'progress' && e.data.source === 'engine')!;
    expect(Date.parse(copying.data.at), 'git is no engine: the copy is not an engine line').toBeLessThanOrEqual(Date.parse(firstEngine.data.at));
    expect(scan.lastEngineEventAt).not.toBe(copying.data.at);

    // The copy: one commit of the two, a local branch, the files, nothing left half made.
    expect(await exists(join(copy, '.git')) && await exists(join(copy, 'alpha.ts'))).toBe(true);
    expect((await gitIn(copy, ['rev-parse', '--is-shallow-repository'])).trim()).toBe('true');
    expect((await gitIn(copy, ['rev-list', '--count', 'HEAD'])).trim(), 'one commit').toBe('1');
    expect(await branchOf(copy)).toBe('main'); expect(await headOf(copy)).toBe(await shop.head());
    expect(await reposListing(server)).toEqual({ copies: ['github.com'], partial: [] });

    // ---- Drawn: the file is written into the copy; the run, the library, Recent and the activity name the link, not the folder.
    const run = await awaitRun(server, await drawOn(server, scan.id, [option('o1')], 'readme'), 'succeeded');
    const drawing = join(copy, 'docs', 'architecture.archdraw.json');
    expect(samePath(run.path, drawing), run.path).toBe(true);
    expect(run).toMatchObject({ link: LINK, name: 'shop' }); expect(samePath(run.folder, copy)).toBe(true);
    const listed = ((await server.get('/api/diagrams')).body.diagrams as { id: string; link: string | null; root: string; path: string }[]).find(d => d.id === run.diagramId)!;
    expect(listed.link).toBe(LINK); expect(samePath(listed.root, copy)).toBe(true);
    const recent = (await server.get('/api/sources')).body.recent;
    expect(recent[0]).toMatchObject({ name: 'shop', link: LINK, diagrams: [run.diagramId] }); expect(samePath(recent[0].path, copy)).toBe(true);
    const act = await activityOf(server);
    expect(jobOf(act, scan.id)).toMatchObject({ type: 'scan', link: LINK }); expect(jobOf(act, run.id)).toMatchObject({ type: 'draw', link: LINK });
    const again = await server.post('/api/folders/check', { link: LINK });
    expect(again.body).toMatchObject({ git: true, copied: true, link: LINK }); expect(samePath(again.body.drawing, drawing)).toBe(true);
    expect((await server.post('/api/folders/check', { folder: copy })).body, 'the copy chosen as a folder knows its link').toMatchObject({ link: LINK, branch: null, copied: true });
    const drawingText = await readFile(drawing, 'utf8');

    // ---- A second scan fetches first. Nothing new: up to date, then the cached scan.
    const upToDate = await awaitScan(server, await startScanOn(server, { link: LINK }));
    const wanted = [`Fetching the newest commit of ${LINK}`, `Up to date at ${short(await shop.head())}`, `Scanned before at ${short(await shop.head())}`];
    expect(upToDate.progress.slice(0, 3)).toEqual(wanted);
    expect(upToDate.progress).not.toContain(`Copying ${LINK}`); expect(upToDate.cached).toBe(true);

    // A new commit on the remote: fetched, checked out, scanned again; the drawing is exactly as it was.
    const second = await shop.commit({ 'zz-new.ts': '// new\n' });
    const updated = await awaitScan(server, await startScanOn(server, { link: LINK }));
    expect(updated.progress.slice(0, 2)).toEqual([`Fetching the newest commit of ${LINK}`, `Updated to ${short(second)}`]);
    expect(updated).toMatchObject({ cached: false, commit: second }); expect(updated.progress).toContain('Gathering the repository');
    expect(await headOf(copy)).toBe(second); expect(await exists(join(copy, 'zz-new.ts'))).toBe(true);
    expect(await readFile(drawing, 'utf8'), 'the update leaves the drawing byte for byte').toBe(drawingText);

    // The copy chosen as a folder follows its own branch and updates the same way.
    const third = await shop.commit({ 'zz-newer.ts': '// newer\n' });
    const byFolder = await awaitScan(server, await startScanOn(server, { folder: copy }));
    expect(byFolder.link).toBe(LINK);
    expect(byFolder.progress.slice(0, 2)).toEqual([`Fetching the newest commit of ${LINK}`, `Updated to ${short(third)}`]);
    expect(await headOf(copy)).toBe(third);

    // ---- A branch link: the copy switches to that branch, and a link with no branch brings it back to the default one.
    const featureHead = await shop.branch('feature/pay', { 'pay.ts': '// pay\n' });
    const branchLink = 'https://github.com/acme/shop/tree/feature/pay';
    const checkedBranch = await server.post('/api/folders/check', { link: branchLink });
    expect(checkedBranch.body).toMatchObject({ link: LINK, branch: 'feature/pay', copied: true });
    const onBranch = await awaitScan(server, await startScanOn(server, { link: branchLink }));
    expect(onBranch.progress.slice(0, 3)).toEqual([`Fetching the newest commit of ${LINK}`, `Fetching feature/pay of ${LINK}`, `Switched to feature/pay at ${short(featureHead)}`]);
    expect(await branchOf(copy)).toBe('feature/pay'); expect(await headOf(copy)).toBe(featureHead); expect(await exists(join(copy, 'pay.ts'))).toBe(true);
    expect(onBranch.commit).toBe(featureHead);
    const back = await awaitScan(server, await startScanOn(server, { link: LINK }));
    expect(back.progress.slice(0, 3)).toEqual([`Fetching the newest commit of ${LINK}`, `Fetching main of ${LINK}`, `Switched to main at ${short(third)}`]);
    expect(await branchOf(copy)).toBe('main'); expect(await headOf(copy)).toBe(third); expect(await exists(join(copy, 'pay.ts'))).toBe(false);
    expect(await readFile(drawing, 'utf8'), 'switching leaves the drawing byte for byte').toBe(drawingText);
    await until(() => reposListing(server), l => l.partial.length === 0, 'no partial copy to be left', 5_000);
  } finally { await server.stop(); }
});
