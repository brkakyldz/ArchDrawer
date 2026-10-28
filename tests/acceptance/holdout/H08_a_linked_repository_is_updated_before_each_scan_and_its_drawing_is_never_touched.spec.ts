import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import { useProduct } from './server';
import { says, makeRemote, copyFolder, partialFolder, startScan, waitScan, scan, startDraw, waitRun, readText, exists, listDir, git, WHOLE } from './helpers';

const product = useProduct();
const LINK = 'github.com/acme/shop';
const short = (commit: string) => commit.slice(0, 7);

// A maintainer drew their repository from its link and keeps coming back as it changes: each scan fetches the newest commit first, a branch
// link switches the copy, a host that cannot be reached leaves the copy as it is, and a repository nobody can see fails in one sentence.
// The drawing written into the copy stays byte for byte through every update.
test('H08 [SRC-5 SRC-4 FILE-1] a later scan of a copy fetches the newest commit, a branch link switches it, an unreachable host scans the copy as it is, and the drawing in the copy never changes', async () => {
  const p = product();
  const remote = await makeRemote(p, LINK, undefined, { branch: 'feature/pay' });
  const copy = copyFolder(p, LINK);

  const first = await scan(p, { link: `https://${LINK}` });
  expect(first.progress[0]).toMatch(new RegExp(`Copying ${LINK}`));
  expect(first.commit).toBe(await remote.head());
  const run = await waitRun(p, await startDraw(p, first.id, [WHOLE], 'readme'));
  const file = join(copy, 'docs', 'architecture.archdraw.json');
  expect(run.path).toBeTruthy();
  const drawing = await readText(file);

  // A new commit on the host: the next scan fetches it first, and the drawing stays.
  const newer = await remote.commit({ 'delta.ts': '// delta\n' });
  const second = await scan(p, { link: `https://${LINK}` });
  expect(says(second.progress, /Fetching the newest commit/)).toBe(true);
  expect(says(second.progress, new RegExp(`Updated to ${short(newer)}`))).toBe(true);
  expect(second.commit).toBe(newer);
  expect(second.cached).toBe(false);
  expect(await readText(file), 'the drawing after an update').toBe(drawing);
  // Nothing new: up to date, and the scan of that commit is answered from the cache.
  const third = await scan(p, { link: `https://${LINK}` });
  expect(says(third.progress, new RegExp(`Up to date at ${short(newer)}`))).toBe(true);
  expect(third.cached).toBe(true);

  // A branch link switches the copy to that branch's newest commit.
  const branchHead = (await git(remote.dir, ['rev-parse', 'feature/pay'])).trim();
  const onBranch = await scan(p, { link: `https://${LINK}/tree/feature/pay` });
  expect(says(onBranch.progress, /Fetching feature.pay of/)).toBe(true);
  expect(says(onBranch.progress, new RegExp(`Switched to feature.pay at ${short(branchHead)}`))).toBe(true);
  expect(onBranch.commit).toBe(branchHead);
  expect((await git(copy, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('feature/pay');
  expect(await exists(join(copy, 'branch-only.ts'))).toBe(true);
  expect(await readText(file), 'the drawing after a switch').toBe(drawing);
  // A branch the repository does not have: the scan fails and the copy stays where it was.
  const missing = await waitScan(p, await startScan(p, { link: `https://${LINK}/tree/nope` }), 'failed');
  expect(missing.error).toMatch(/branch "nope" does not exist in github\.com\/acme\/shop/);
  expect((await git(copy, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('feature/pay');

  // The host cannot be reached: the scan goes on with the copy as it is, and says so.
  const hostDir = join(p.remotes, 'github.com');
  await rename(hostDir, `${hostDir}.away`);
  const offline = await scan(p, { link: `https://${LINK}/tree/feature/pay` });
  expect(offline.progress.join('\n')).toMatch(/Could not fetch the newest commit: Could not reach github\.com/);
  expect(offline.progress.join('\n')).toMatch(new RegExp(`Scanning the copy at ${short(branchHead)} on feature/pay`));
  expect(offline.commit).toBe(branchHead);
  // A repository on a host that cannot be reached is never copied.
  const noHost = await waitScan(p, await startScan(p, { link: 'https://github.com/acme/elsewhere' }), 'failed');
  expect(noHost.error).toMatch(/Could not reach github\.com/);
  await rename(`${hostDir}.away`, hostDir);

  // A repository nobody can see fails at once, with no prompt, and leaves no copy.
  const hidden = await waitScan(p, await startScan(p, { link: 'https://github.com/acme/secret' }), 'failed');
  expect(hidden.error).toBe('This repository is private or does not exist');
  expect(await exists(copyFolder(p, 'github.com/acme/secret'))).toBe(false);
  expect(await exists(copyFolder(p, 'github.com/acme/elsewhere'))).toBe(false);

  // Must not happen: half a copy left in the cache, or the drawing touched.
  expect(await listDir(partialFolder(p))).toEqual([]);
  expect(await readText(file)).toBe(drawing);
});
