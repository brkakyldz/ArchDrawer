import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { rename, writeFile, mkdir } from 'node:fs/promises';
import { exists } from './helpers';
import {
  jobServer, makeRemote, copyOf, headOf, branchOf, short, reposListing, startScanOn, awaitScan, scanRec, scanEventsOf, until, sleep,
} from './helpers-jobs';

// SRC-4, SRC-5, JOB-5, JOB-10, START-4 (api contract, *When git fails*, *A scan with a link*, *The copy*; testing contract, *Test links*): a host
// that cannot be reached, a repository that is missing or not a repository, a branch it does not have and a fixture marker in the name each
// fail the scan with the contracted sentence and leave no copy and no partial folder. A copy being made is cancelled at once and leaves
// nothing; one scan at a time per copy, but another repository copies at the same time. An update that cannot fetch goes on with the copy it
// has and says so, while a branch it cannot fetch fails.
test('H227 [SRC-4 SRC-5 JOB-5 JOB-10 START-4 #199] a link that cannot be copied fails with one plain sentence and leaves no copy, a copy being made is cancelled at once and frees its lock while another copy goes on, and an update that cannot fetch scans the copy it has', async () => {
  test.setTimeout(300_000);
  const server = await jobServer({ remotes: true, slots: 3, stepMs: 100 });
  try {
    const remotes = server.remotes!;
    const shop = await makeRemote(server, 'github.com/acme/shop');
    await makeRemote(server, 'github.com/acme/slowrepo'); await writeFile(join(remotes, 'github.com', 'acme', 'slowrepo.slow'), '', 'utf8');
    await makeRemote(server, 'github.com/acme/other');
    await makeRemote(server, 'github.com/acme/shop-fixture-fail');
    await mkdir(join(remotes, 'github.com', 'acme', 'plain-folder'), { recursive: true }); // there, but not a repository
    const nothingLeft = async (what: string) => expect(await reposListing(server), `${what}: no copy and no partial folder`).toEqual({ copies: [], partial: [] });

    // ---- Each failure, with its sentence; the scan is `failed`, with no card, and the cache holds no copy.
    const failures: [string, string, string][] = [
      ['a host that cannot be reached', 'https://gitlab.com/acme/shop', 'Could not reach gitlab.com'],
      ['a repository that is not there', 'https://github.com/acme/ghost', 'This repository is private or does not exist'],
      ['a folder that is not a repository', 'https://github.com/acme/plain-folder', 'This repository is private or does not exist'],
      ['a branch it does not have', 'https://github.com/acme/shop/tree/nope', 'The branch "nope" does not exist in github.com/acme/shop'],
    ];
    for (const [what, link, error] of failures) {
      const id = await startScanOn(server, { link });
      const failed = await awaitScan(server, id, 'failed', 60_000);
      expect(failed.error, what).toBe(error);
      expect(failed).toMatchObject({ card: null, options: null, link: link.replace('https://', '').replace(/\/tree\/.*/, ''), waiting: false });
      expect(failed.progress[0], what).toMatch(/^Copying (github|gitlab)\.com\/acme\//);
      expect(failed.progress, `${what}: no engine ever started`).not.toContain('Gathering the repository');
      const events = await scanEventsOf(server, id);
      expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'failed', error, card: null } });
      await nothingLeft(what);
    }
    // A fixture marker in the repository's name acts as the bracketed marker (testing contract): the scan itself fails, after the copy was made.
    const marked = await awaitScan(server, await startScanOn(server, { link: 'https://github.com/acme/shop-fixture-fail' }), 'failed', 60_000);
    expect(marked.error).toBeTruthy(); expect(marked.card).toBeNull(); expect(marked.progress[0]).toBe('Copying github.com/acme/shop-fixture-fail');
    expect((await server.get('/api/sources')).body.recent, 'a failed scan is no use of the folder').toEqual([]);

    // ---- A copy being made is cancelled at once; its lock is freed; another repository copies at the same time.
    const slowLink = 'https://github.com/acme/slowrepo';
    const slowId = await startScanOn(server, { link: slowLink });
    const slow = await until(() => scanRec(server, slowId), r => r.progress.length > 0, 'the copy to start', 15_000);
    expect(slow).toMatchObject({ status: 'running', link: 'github.com/acme/slowrepo' }); expect(slow.progress[0]).toBe('Copying github.com/acme/slowrepo');
    expect(await server.post('/api/scans', { link: slowLink, engine: 'fixture', model: null }), 'one scan at a time per copy')
      .toEqual({ status: 409, body: { error: 'A scan of this repository is already running', scanId: slowId } });
    const otherId = await startScanOn(server, { link: 'https://github.com/acme/other' }); // another copy: not held up by the first
    const other = await awaitScan(server, otherId, 'succeeded', 60_000);
    expect(other.link).toBe('github.com/acme/other');
    expect((await scanRec(server, slowId)).status, 'the slow copy is still going on').toBe('running');
    const cancelAt = Date.now();
    expect((await server.post(`/api/scans/${slowId}/cancel`)).body).toEqual({ ok: true });
    const cancelled = await awaitScan(server, slowId, 'cancelled', 20_000);
    expect(Date.now() - cancelAt, 'cancelled long before the 30 s the copy would wait').toBeLessThan(15_000);
    expect(cancelled).toMatchObject({ card: null, options: null });
    expect(await exists(copyOf(server, 'github.com/acme/slowrepo')), 'a cancelled copy leaves nothing in the cache').toBe(false);
    expect(await reposListing(server), 'only the copy that finished is in the cache').toEqual({ copies: ['github.com'], partial: [] });
    expect(await exists(join(copyOf(server, 'github.com/acme/other'), '.git'))).toBe(true);
    // The lock is free again: a new scan of the same repository is accepted (and cancelled in its turn).
    const again = await startScanOn(server, { link: slowLink });
    await server.post(`/api/scans/${again}/cancel`); await awaitScan(server, again, 'cancelled', 20_000);
    expect(await reposListing(server)).toEqual({ copies: ['github.com'], partial: [] });

    // ---- A copy exists; the host goes away. An update that cannot fetch scans the copy it has, and says so.
    const first = await awaitScan(server, await startScanOn(server, { link: 'https://github.com/acme/shop' }), 'succeeded', 60_000);
    const copy = copyOf(server, 'github.com/acme/shop'), head = await headOf(copy);
    expect(head).toBe(await shop.head());
    await rename(join(remotes, 'github.com'), join(remotes, 'github.com.off'));
    const offline = await awaitScan(server, await startScanOn(server, { link: 'https://github.com/acme/shop' }), 'succeeded', 60_000);
    expect(offline.progress.slice(0, 2)).toEqual(['Fetching the newest commit of github.com/acme/shop',
      `Could not fetch the newest commit: Could not reach github.com. Scanning the copy at ${short(head)} on main`]);
    expect(offline.commit).toBe(head); expect(offline.cached, 'the commit was scanned before').toBe(true); expect(first.commit).toBe(head);
    // A branch it cannot fetch is another matter: the scan fails, and the copy stays as it was.
    const branch = await awaitScan(server, await startScanOn(server, { link: 'https://github.com/acme/shop/tree/feature/x' }), 'failed', 60_000);
    expect(branch.error).toBe('Could not reach github.com');
    expect(await branchOf(copy)).toBe('main'); expect(await headOf(copy)).toBe(head);
    await rename(join(remotes, 'github.com.off'), join(remotes, 'github.com'));
    await sleep(100);
    const online = await awaitScan(server, await startScanOn(server, { link: 'https://github.com/acme/shop' }), 'succeeded', 60_000);
    expect(online.progress.slice(0, 2)).toEqual(['Fetching the newest commit of github.com/acme/shop', `Up to date at ${short(head)}`]);
    expect(await reposListing(server)).toEqual({ copies: ['github.com'], partial: [] });
  } finally { await server.stop(); }
});
