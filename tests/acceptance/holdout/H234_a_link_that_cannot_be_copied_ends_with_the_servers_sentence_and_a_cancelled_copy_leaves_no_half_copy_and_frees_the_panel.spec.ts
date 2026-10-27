import { test, expect } from '@playwright/test';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists } from './helpers';
import { watchPosts } from './helpers-selections';
import { homeServer, openHome, makeRemote, copyDir, stepper } from './helpers-home';

// SRC-4, SRC-5, JOB-10, HOME-4 (ui contract, `scan-progress`, `start-error`; api contract, *A repository from a link*, *When git fails*;
// testing contract, *Test links*): a link whose repository is missing, whose branch is missing or whose host cannot be reached
// ends its scan with the contract's sentence at once and the panel is back on the Folder step with the link kept; while a copy
// is being made the panel follows it (fields off, `Copying <link>`), Cancel ends it with `Cancelled`, and no half copy is left.
test('H234 [SRC-4 SRC-5 JOB-10 HOME-4 #201 #202] a link that cannot be copied ends with the sentence of the contract and the panel is free again, and cancelling a copy in progress leaves no half copy', async ({ page, request }) => {
  test.setTimeout(240_000);
  const server = await homeServer(page, request);
  try {
    await makeRemote(server, 'github.com/acme/other');
    await makeRemote(server, 'github.com/acme/slowpoke');
    await writeFile(join(server.remotes, 'github.com', 'acme', 'slowpoke.slow'), '', 'utf8'); // each copy waits 30 s before git starts
    const posts = watchPosts(page);
    const link = page.getByTestId('start-link'), scan = page.getByTestId('start-scan'), error = page.getByTestId('start-error');
    const partial = async () => { try { return (await readdir(join(server.data, 'repos', '.partial'))).length; } catch { return 0; } };
    await openHome(page, server); await page.getByTestId('start-source-link').click();

    const failures: [string, string, string][] = [
      ['https://github.com/acme/ghostrepo', 'This repository is private or does not exist', 'github.com/acme/ghostrepo'],
      ['https://github.com/acme/other/tree/nope', 'The branch "nope" does not exist in github.com/acme/other', 'github.com/acme/other'],
      ['https://gitlab.com/acme/anything', 'Could not reach gitlab.com', 'gitlab.com/acme/anything'],
    ];
    for (const [text, sentence, linkName] of failures) {
      await link.fill(text); await expect(scan).toBeEnabled(); // a check copies nothing, so it cannot tell yet
      await scan.click();
      await expect(error).toHaveText(sentence, { timeout: 60_000 }); await expect(error).toHaveAttribute('role', 'alert');
      expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Folder') });
      await expect(link).toBeEnabled(); await expect(link).toHaveValue(new RegExp(linkName.replace(/\./g, '\\.'))); await expect(scan).toBeEnabled();
      await expect(page.getByTestId('scan-progress')).toHaveCount(0); await expect(page.getByTestId('scan-card')).toHaveCount(0);
      expect(await exists(copyDir(server, linkName)), `no copy of ${linkName}`).toBe(false);
    }
    expect(await partial(), 'no half copy after the failures').toBe(0);

    // A copy in progress: followed, the fields off, then Cancel ends it and the panel is free with the link kept.
    await link.fill('https://github.com/acme/slowpoke'); await expect(scan).toBeEnabled(); await scan.click();
    const progress = page.getByTestId('scan-progress');
    await expect(progress).toBeVisible(); await expect(progress).toContainText('Scanning'); await expect(progress).toContainText('Copying github.com/acme/slowpoke');
    await expect(link).toBeDisabled(); await expect(scan).toBeDisabled(); await expect(page.getByTestId('start-source-local')).toBeDisabled();
    await expect(error).toHaveCount(0); // the error of the earlier scan is cleared by this one
    await page.getByTestId('scan-cancel').click();
    await expect(error).toHaveText('Cancelled', { timeout: 30_000 });
    await expect(progress).toHaveCount(0); await expect(link).toBeEnabled(); await expect(link).toHaveValue(/acme\/slowpoke/); await expect(scan).toBeEnabled();
    await expect(page.getByTestId('start-source-local')).toBeEnabled();
    expect(await exists(copyDir(server, 'github.com/acme/slowpoke')), 'a cancelled copy leaves no copy').toBe(false);
    await expect.poll(partial, { timeout: 15_000, message: 'and no half copy' }).toBe(0);

    // Must not have happened: a draw, or a scan of a folder.
    expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(4);
    for (const p of posts.filter(p => p.path === '/api/scans')) expect(p.body.folder ?? null).toBeNull();
    expect(posts.filter(p => p.path === '/api/runs')).toEqual([]);
  } finally { await server.close(); }
});
