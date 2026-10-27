import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { samePath, writeFiles } from './helpers';
import { watchPosts } from './helpers-selections';
import { homeServer, openHome, makeRepo, comboOptions, navItems, names, dayMonth } from './helpers-home';

const AGE = /(just now|\d+ min ago)/;

// SRC-1, SRC-2, HOME-2 (ui contract, *Choosing a repository*; api contract, *Recent and found*): the combobox and the navigation list
// the folders used before (Recent, here the repository of a registered drawing) and the repositories found on the computer (one or
// two levels below the search roots, newest commit first; hidden folders, `node_modules`, plain folders and deeper ones left out),
// each with its branch and the age of its last commit. Typing filters, a heading with nothing under it goes, a pasted path closes
// the list, Enter takes the highlighted entry, and taking an entry puts its path in the field and scans nothing.
test('H231 [SRC-1 SRC-2 HOME-2 START-4 #201] the folder combobox and the navigation list recent and found repositories with branch and age, typing filters them, a pasted path closes the list, and choosing one puts its path in the field and scans nothing', async ({ page, request }) => {
  test.setTimeout(60_000);
  const server = await homeServer(page, request);
  try {
    const at = (...parts: string[]) => join(server.home, ...parts);
    const alpha = await makeRepo(at('code', 'alpha-app'), undefined, { branch: 'main' });
    const beta = await makeRepo(at('code', 'beta-api'), undefined, { branch: 'develop', daysAgo: 10 });
    await makeRepo(at('code', 'group', 'delta-svc'), undefined, { branch: 'main', daysAgo: 20 });
    await makeRepo(at('projects', 'gamma'), undefined, { branch: 'main', daysAgo: 40 });
    // Not found: a plain folder, a hidden repository, one in node_modules and one three levels below a search root.
    await mkdir(at('code', 'notes'), { recursive: true }); await writeFiles(at('code', 'notes'), { 'a.md': 'notes\n' });
    await makeRepo(at('code', '.hidden-repo')); await makeRepo(at('code', 'node_modules', 'pkg')); await makeRepo(at('code', 'deep', 'a', 'b', 'c'));
    const posts = watchPosts(page);
    await openHome(page, server);

    // The navigation: Recent holds the repository of the registered drawing; Found the four, newest commit first, with branch and age.
    await expect.poll(async () => (await navItems(page, 'source-found')).length, { timeout: 60_000 }).toBe(4);
    expect(names(await navItems(page, 'source-recent'))).toEqual(['library-shop']);
    const found = await navItems(page, 'source-found');
    expect(names(found), 'newest last commit first; no hidden, node_modules, plain or too deep folder').toEqual(['alpha-app', 'beta-api', 'delta-svc', 'gamma']);
    expect(found[0].text).toMatch(new RegExp(`alpha-app main · ${AGE.source}`));
    expect(found[1].text).toContain(`develop · ${dayMonth(new Date(Date.now() - 10 * 86_400_000))}`);
    expect(found[3].text).toContain(`main · ${dayMonth(new Date(Date.now() - 40 * 86_400_000))}`);
    expect(samePath(found[0].path, alpha.dir)).toBe(true);

    // The combobox: Recent first, then Found on this computer; each entry with its name, path, branch and age.
    const folder = page.getByRole('combobox', { name: 'Folder of the project' });
    await expect(folder).toHaveCount(1); await expect(folder).toHaveAttribute('placeholder', 'Search your repositories, or paste a path');
    await folder.focus();
    const list = page.getByTestId('start-folder-list'); await expect(list).toBeVisible(); await expect(list).toHaveAttribute('role', 'listbox');
    await expect(list).toContainText('Recent'); await expect(list).toContainText('Found on this computer');
    const options = await comboOptions(page);
    expect(names(options)).toEqual(['library-shop', 'alpha-app', 'beta-api', 'delta-svc', 'gamma']);
    expect(options[2].text).toContain('beta-api'); expect(options[2].text).toContain(`develop · ${dayMonth(new Date(Date.now() - 10 * 86_400_000))}`);
    expect(options[2].text.replace(/\\/g, '/')).toContain(beta.dir.replace(/\\/g, '/'));

    // Typing filters by name or path, any case; a heading with no entry goes; no match gives the sentence.
    await folder.fill('BETA'); await expect.poll(async () => names(await comboOptions(page))).toEqual(['beta-api']); await expect(list).not.toContainText('Recent');
    await folder.fill('projects'); await expect.poll(async () => names(await comboOptions(page))).toEqual(['gamma']);
    await folder.fill('library'); await expect.poll(async () => names(await comboOptions(page))).toEqual(['library-shop']); await expect(list).not.toContainText('Found on this computer');
    await folder.fill('zzz'); await expect.poll(() => comboOptions(page)).toEqual([]);
    await expect(page.getByTestId('start-folder-none')).toHaveText('No repository here matches "zzz". Paste the whole path, or choose the folder.');

    // Enter takes the highlighted entry: the path is in the field, the list is closed and Scan has the focus; nothing was scanned.
    await folder.fill('alpha'); await folder.press('ArrowDown'); await folder.press('Enter');
    await expect(folder).toHaveValue(alpha.dir); await expect(list).toBeHidden(); await expect(page.getByTestId('start-scan')).toBeFocused();
    await page.waitForTimeout(500);
    expect(posts.filter(p => p.path === '/api/scans' || p.path === '/api/folders/check'), 'choosing an entry scans nothing').toEqual([]);

    // Escape closes the list and keeps the text; a pasted path (it starts like one) keeps the list closed.
    await folder.fill(''); await expect(list).toBeVisible(); await folder.press('Escape'); await expect(list).toBeHidden();
    await folder.fill('alp'); await expect(list).toBeVisible(); await folder.press('Escape'); await expect(list).toBeHidden(); await expect(folder).toHaveValue('alp');
    await folder.fill(beta.dir); await folder.focus(); await expect(list).toBeHidden();

    // An entry of the navigation does the same: its path in the field, the panel in view, Scan focused, nothing scanned.
    await page.getByTestId('source-found').getByTestId('source-item').filter({ hasText: 'gamma' }).click();
    expect(samePath(await folder.inputValue(), found[3].path)).toBe(true); await expect(page.getByTestId('start-scan')).toBeFocused(); await expect(page.getByTestId('start')).toBeInViewport();
    await page.waitForTimeout(500);
    expect(posts.filter(p => p.path === '/api/scans'), 'pressing a source scans nothing').toEqual([]);

    // A repository made after the page loaded appears once the found list is made again (`Look again`).
    await makeRepo(at('code', 'omega-new'), undefined, { branch: 'main' });
    await expect(page.getByTestId('source-found-refresh')).toHaveAccessibleName('Look again');
    await page.getByTestId('source-found-refresh').click();
    await expect.poll(async () => names(await navItems(page, 'source-found'))[0], { timeout: 60_000 }).toBe('omega-new');
    expect(names(await navItems(page, 'source-found'))).toEqual(['omega-new', 'alpha-app', 'beta-api', 'delta-svc', 'gamma']);
    expect(posts.filter(p => p.path === '/api/sources/refresh')).toHaveLength(1);
  } finally { await server.close(); }
});
