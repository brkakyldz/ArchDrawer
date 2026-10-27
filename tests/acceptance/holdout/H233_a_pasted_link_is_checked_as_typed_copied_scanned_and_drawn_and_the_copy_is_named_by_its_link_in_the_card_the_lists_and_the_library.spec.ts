import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { exists, samePath } from './helpers';
import { watchPosts, readChoices } from './helpers-selections';
import { homeServer, openHome, makeRemote, copyDir, git, comboOptions, navItems, tickOnHome, runRecordAt } from './helpers-home';
import { startedRun } from './helpers';

const LINK = 'github.com/acme/shop';

// SRC-4, SRC-5, SRC-6, HOME-2, START-4 (ui contract, `start-link`, `start-link-hint`; api contract, *A repository from a link*; testing
// contract, *Test links*): on the Link tab a pasted link is read as it is typed (refused with the server's sentence, or accepted
// with its branch and whether a copy exists), Scan copies it into archdrawer's own folder and scans the copy, the card names the
// link, a newer commit of the remote is fetched by the next scan, the drawing is written into the copy and the library, the
// lists and the card all show the link instead of the copy's folder. Only the test link (a local repository) is ever copied.
test('H233 [SRC-4 SRC-5 SRC-6 HOME-2 START-4 #201] a pasted link is checked as it is typed, copied, scanned and drawn, a newer commit is fetched by the next scan, and the card, the lists and the library name the copy by its link', async ({ page, request }) => {
  test.setTimeout(300_000);
  const server = await homeServer(page, request);
  try {
    const remote = await makeRemote(server, LINK);
    const posts = watchPosts(page);
    const link = page.getByTestId('start-link'), hint = page.getByTestId('start-link-hint'), scan = page.getByTestId('start-scan');
    await openHome(page, server);
    await page.getByTestId('start-source-link').click();
    await expect(link).toHaveAttribute('placeholder', 'https://github.com/owner/repo'); await expect(link).toHaveAccessibleName('Repository link');
    await expect(hint).toHaveText('A github.com, gitlab.com or bitbucket.org link, public or reachable with your own git sign-in.'); await expect(scan).toBeDisabled();

    // Each wrong link gets the server's sentence as an alert, and Scan stays off.
    const refused: [string, string][] = [
      ['http://github.com/acme/shop', 'Not a repository link'], ['git@github.com:acme/shop.git', 'Not a repository link'],
      ['https://example.com/acme/shop', 'Only github.com, gitlab.com and bitbucket.org links can be drawn'],
      ['https://user:secret@github.com/acme/shop', 'Leave the user name and password out of the link'],
    ];
    for (const [text, sentence] of refused) { await link.fill(text); await expect(hint).toHaveText(sentence); await expect(hint).toHaveAttribute('role', 'alert'); await expect(scan).toBeDisabled(); }
    expect(posts.filter(p => p.path === '/api/scans'), 'a refused link starts no scan').toEqual([]);

    // An accepted link: its form, its branch, and that a copy will be made; nothing is copied by the check.
    await link.fill(`https://${LINK}/tree/main`);
    await expect(hint).toHaveText(/^github\.com\/acme\/shop, branch main · copied into archdrawer.s own folder, read-only$/); await expect(scan).toBeEnabled();
    expect(await exists(copyDir(server, LINK)), 'checking copies nothing').toBe(false);
    const first = await remote.head();

    // Scan: the copy is made and scanned; the card names the link; the field shows the link and is off while it is followed.
    await scan.click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 90_000 });
    const body = posts.find(p => p.path === '/api/scans')!.body;
    expect(body.link).toContain(LINK); expect(body.folder ?? null).toBeNull();
    await expect(page.getByTestId('scan-card-link')).toHaveText(LINK); await expect(page.getByTestId('scan-card-name')).toHaveText('shop');
    expect(first.startsWith((await page.getByTestId('scan-card-commit').textContent())!.trim())).toBe(true);
    await expect(link).toBeDisabled(); await expect(link).toHaveValue(new RegExp(LINK.replace(/\./g, '\\.')));
    expect(await exists(join(copyDir(server, LINK), '.git')), 'the copy is on disk').toBe(true);

    // The same link again says a copy is there; a newer commit of the remote is fetched by the next scan.
    await page.getByTestId('start-change-folder').click(); await expect(link).toBeEnabled();
    await link.fill(LINK); await expect(hint).toHaveText(/^github\.com\/acme\/shop · already on this computer$/);
    const second = await remote.commit({ 'later.ts': '// a later commit\n' });
    await scan.click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => second.startsWith(((await page.getByTestId('scan-card-commit').textContent()) ?? 'x').trim()), { timeout: 30_000 }).toBe(true);
    await expect(page.getByTestId('scan-cached')).toHaveCount(0);
    expect((await git(copyDir(server, LINK), ['rev-parse', 'HEAD'])).trim(), 'the copy was brought to the newer commit').toBe(second);
    expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(2);

    // Draw into the copy: the drawing is written under the copy and the editor opens only from Ready.
    await tickOnHome(page, { whole: true }, 'linkedin');
    const run = await startedRun(page, () => page.getByTestId('draw-start').click());
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 240_000 });
    const record = await runRecordAt(request, server.base, run.runId);
    expect(record).toMatchObject({ status: 'succeeded', link: LINK });
    expect(samePath(record.path, join(copyDir(server, LINK), 'docs', 'architecture.archdraw.json'))).toBe(true);
    expect((await readChoices(record.path)).choices.map(c => c.id)).toEqual(['system']);
    await expect(page.getByTestId('editor')).toHaveCount(0);

    // The library names the drawing by the link; the lists name the copy by it too (its folder is the entry's path).
    await page.goto(`${server.base}/`); await expect(page.getByTestId('library')).toBeVisible();
    const card = page.locator(`[data-testid="library-item"][data-diagram-id="${record.diagramId}"]`);
    await expect(card.getByTestId('library-item-path')).toHaveText(LINK);
    await page.getByTestId('start-folder').focus();
    const entry = (await comboOptions(page)).find(o => samePath(o.path, copyDir(server, LINK)));
    expect(entry, 'the copy is in Recent').toBeTruthy(); expect(entry!.text).toContain(LINK);
    const recent = (await navItems(page, 'source-recent')).filter(o => samePath(o.path, copyDir(server, LINK)));
    expect(recent, 'the navigation lists the copy once, by its name').toHaveLength(1); expect(recent[0].text).toContain('shop');
    expect(posts.filter(p => p.path === '/api/runs'), 'one draw').toHaveLength(1);
  } finally { await server.close(); }
});
