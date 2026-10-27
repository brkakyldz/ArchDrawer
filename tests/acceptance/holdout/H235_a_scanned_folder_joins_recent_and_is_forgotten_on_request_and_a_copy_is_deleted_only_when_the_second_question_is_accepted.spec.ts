import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { exists, samePath } from './helpers';
import { scanThroughHome, watchPosts } from './helpers-selections';
import { homeServer, makeRepo, makeRemote, copyDir, navItems, names, answerDialogs, openHome } from './helpers-home';

const LINK = 'github.com/acme/shop';

// SRC-1, SRC-4, SRC-5, HOME-2 (ui contract, `source-forget`, `source-recent`, `source-found-refresh`; api contract, *Recent and found*, *Forgetting
// an entry*): a scanned folder joins Recent; an entry whose drawings are in the list cannot be forgotten from here; asking to forget
// one is a question the user can answer no to (nothing is sent); yes forgets it and keeps the folder, which Found shows again once
// it is made again; for a copy made from a link a second question asks whether to delete the copy too, and the copy goes only on yes.
test('H235 [SRC-1 SRC-4 SRC-5 HOME-2 #201] a scanned folder joins Recent, an entry with drawings cannot be forgotten, forgetting asks first and keeps the folder, and a copy made from a link is deleted only when the second question is accepted', async ({ page, request }) => {
  test.setTimeout(300_000);
  const server = await homeServer(page, request);
  try {
    const alpha = await makeRepo(join(server.home, 'code', 'alpha-app'));
    await makeRemote(server, LINK);
    const posts = watchPosts(page), answers: boolean[] = [], messages = answerDialogs(page, answers);
    const forgets = () => posts.filter(p => p.path === '/api/sources/forget');
    const recent = page.getByTestId('source-recent').getByTestId('source-item');
    const itemOf = (name: string) => recent.filter({ hasText: new RegExp(`^\\s*${name}(\\s|$)`) }); // `shop` is not `library-shop`

    // A successful scan puts the folder in Recent, above the repository of the registered drawing.
    await scanThroughHome(page, alpha.dir, server.base);
    await page.reload(); await expect(page.getByTestId('start')).toBeVisible();
    await expect.poll(async () => names(await navItems(page, 'source-recent'))).toEqual(['alpha-app', 'library-shop']);

    // An entry with drawings in the list has no forget button, on hover or on focus.
    await itemOf('library-shop').hover(); await expect(itemOf('library-shop').getByTestId('source-forget')).toHaveCount(0);
    await itemOf('library-shop').focus(); await expect(itemOf('library-shop').getByTestId('source-forget')).toHaveCount(0);

    // Forgetting asks; no sends nothing and keeps the entry.
    await itemOf('alpha-app').hover();
    await expect(itemOf('alpha-app').getByTestId('source-forget')).toHaveAccessibleName('Remove alpha-app from Recent');
    answers.push(false);
    await itemOf('alpha-app').getByTestId('source-forget').click(); await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toBe('Remove "alpha-app" from Recent?'); await page.waitForTimeout(500);
    expect(forgets(), 'a no sends nothing').toEqual([]); await expect(itemOf('alpha-app')).toHaveCount(1);

    // Yes: one question, the request says the copy is not to be deleted, the entry goes, the folder stays.
    answers.push(true);
    await itemOf('alpha-app').hover(); await itemOf('alpha-app').getByTestId('source-forget').click();
    await expect(itemOf('alpha-app')).toHaveCount(0); expect(messages).toHaveLength(2);
    expect(forgets()).toHaveLength(1); expect(samePath(forgets()[0].body.path, alpha.dir)).toBe(true); expect(forgets()[0].body.deleteCopy).toBe(false);
    expect(await exists(join(alpha.dir, '.git')), 'the folder is untouched').toBe(true);
    await page.getByTestId('source-found-refresh').click();
    await expect.poll(async () => names(await navItems(page, 'source-found')), { timeout: 60_000 }).toContain('alpha-app'); // no longer in Recent, so Found shows it
    expect(names(await navItems(page, 'source-recent'))).toEqual(['library-shop']);

    // A copy from a link: two questions. Yes then no forgets the entry and keeps the copy on disk, and the link is still known.
    await page.getByTestId('start-source-link').click(); await page.getByTestId('start-link').fill(LINK);
    await expect(page.getByTestId('start-link-hint')).toContainText('copied into'); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 90_000 });
    await page.reload(); await expect.poll(async () => names(await navItems(page, 'source-recent'))).toContain('shop');
    answers.push(true, false);
    await itemOf('shop').hover(); await itemOf('shop').getByTestId('source-forget').click();
    await expect(itemOf('shop')).toHaveCount(0);
    expect(messages.slice(2)).toEqual(['Remove "shop" from Recent?', `Also delete the copy of ${LINK} from this computer?`]);
    expect(forgets()).toHaveLength(2); expect(samePath(forgets()[1].body.path, copyDir(server, LINK))).toBe(true); expect(forgets()[1].body.deleteCopy).toBe(false);
    expect(await exists(join(copyDir(server, LINK), '.git')), 'the copy stays').toBe(true);
    await page.getByTestId('start-source-link').click(); await page.getByTestId('start-link').fill(LINK);
    await expect(page.getByTestId('start-link-hint')).toContainText('already on this computer');

    // Scan it again (the copy is used), forget it with yes and yes: the copy is gone and the same link would be copied anew.
    await page.getByTestId('start-scan').click(); await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 90_000 });
    await page.reload(); await expect.poll(async () => names(await navItems(page, 'source-recent'))).toContain('shop');
    answers.push(true, true);
    await itemOf('shop').hover(); await itemOf('shop').getByTestId('source-forget').click();
    await expect(itemOf('shop')).toHaveCount(0);
    expect(forgets()).toHaveLength(3); expect(forgets()[2].body.deleteCopy).toBe(true);
    await expect.poll(() => exists(copyDir(server, LINK)), { timeout: 15_000, message: 'the copy is deleted' }).toBe(false);
    await openHome(page, server); await page.getByTestId('start-source-link').click(); await page.getByTestId('start-link').fill(LINK);
    await expect(page.getByTestId('start-link-hint')).toContainText('copied into');
    expect(await exists(join(alpha.dir, '.git')), 'nothing else was deleted').toBe(true);
  } finally { await server.close(); }
});
