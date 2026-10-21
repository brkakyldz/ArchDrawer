import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing, samePath, exists } from './helpers';

// START-4 and SCAN-3/4 at the home screen: a wrong folder gets one plain sentence and starts nothing; the same commit shows
// its card at once as scanned before, with a way to scan again; a focus in the user's own words is typed; and the whole
// path can be done from the keyboard.
test('H122 [START-4, SCAN-3, SCAN-4, STORY-1] a wrong folder gets a plain sentence and starts nothing, a scanned commit shows its card at once and can be scanned again, and a typed focus is drawn from the keyboard alone', async ({ page, request }) => {
  test.setTimeout(240_000);
  const project = await gitRepo('start-keys');
  const home = await workspaceRaw('start-keys-home', shop3('Keyboard shop'));
  const server = await isolatedDrawing(page, request, home.file, '750'); // a real scan takes at least 2 s here; a cached one must not
  try {
    const posts: { path: string; body: any }[] = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { let body: any = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; } posts.push({ path: url.pathname, body }); }
    });
    const folder = page.getByTestId('start-folder'), error = page.getByTestId('start-error');
    await page.goto(`${server.base}/`); await expect(page.getByTestId('start')).toBeVisible();

    // The folders of the library are offered for the field (each root once); a wrong folder gets one sentence.
    const listId = await folder.getAttribute('list'); expect(listId, 'the field has a list of folders').toBeTruthy();
    const offeredNow = () => page.locator(`datalist[id="${listId}"] option`).evaluateAll(els => els.map(el => (el as HTMLOptionElement).value));
    // the list fills when GET /api/diagrams answers, so wait for the option instead of reading once
    await expect.poll(async () => (await offeredNow()).filter(value => samePath(value, home.dir)).length, { timeout: 30_000 }).toBe(1);
    const wrong: [string, string][] = [
      [join(project.dir, 'no-such-folder'), 'This folder does not exist.'],
      [join(project.dir, 'alpha.ts'), 'This is a file, not a folder.'],
      ['relative/folder', 'Give the whole path, starting from the drive or from /.'],
    ];
    for (const [path, sentence] of wrong) {
      await folder.fill(path); await page.getByTestId('start-scan').click();
      await expect(error).toHaveText(sentence); await expect(error).toHaveAttribute('role', 'alert');
      await expect(page.getByTestId('scan-card')).toHaveCount(0); await expect(page.getByTestId('start-existing')).toHaveCount(0);
    }
    expect(posts.filter(p => p.path === '/api/scans'), 'a refused folder starts no scan').toEqual([]);

    // The right folder, from the keyboard: Enter in the field acts as Scan. A first look at the commit reads the folder.
    await folder.fill(project.dir); await expect(page.getByTestId('start-scan')).toBeVisible();
    await folder.press('Enter');
    await expect(page.getByTestId('scan-progress')).toBeVisible(); await expect(page.getByTestId('scan-cancel')).toBeVisible();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000});
    await expect(error).toHaveCount(0); await expect(page.getByTestId('scan-cached')).toHaveCount(0);
    expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(1);

    // The same commit again, after a reload: the card is there at once and says it was scanned before; Scan again reads it anew.
    const head = await project.head();
    await page.reload(); await expect(page.getByTestId('start')).toBeVisible();
    // A cached scan answers at once with no engine: the engine's first progress line never shows. Folder check and cache
    // lookup spawn git, so on a slow machine the card may take seconds; no engine is pinned, not speed.
    await page.evaluate(() => { (window as any).__gathered = false; const seen = () => { if (document.body.innerText.includes('Gathering the repository')) (window as any).__gathered = true; }; new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await folder.fill(project.dir); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('scan-cached')).toContainText('Scanned before at ');
    const short = ((await page.getByTestId('scan-cached').textContent()) ?? '').replace(/^.*Scanned before at\s*/, '').trim();
    expect(short.length).toBeGreaterThanOrEqual(4); expect(head.startsWith(short)).toBe(true);
    await expect(page.getByTestId('scan-card-name')).toHaveText(basename(project.dir)); await expect(page.getByTestId('focus-option')).toHaveCount(3);
    const scans = posts.filter(p => p.path === '/api/scans');
    expect(scans).toHaveLength(2); expect(scans[1].body.refresh ?? false).toBe(false);
    expect(await page.evaluate(() => (window as any).__gathered), 'no engine ran: no Gathering the repository progress').toBe(false);
    await expect(page.getByTestId('scan-progress')).toHaveCount(0);
    await page.getByTestId('scan-again').click();
    await expect(page.getByTestId('scan-progress')).toBeVisible();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 }); await expect(page.getByTestId('scan-cached')).toHaveCount(0);
    expect(posts.filter(p => p.path === '/api/scans')[2].body).toMatchObject({ refresh: true });

    // A focus in the user's own words: choosing it puts the cursor in its field, and an empty one cannot be drawn.
    await page.getByTestId('focus-typed').click();
    await expect(page.getByTestId('focus-text')).toBeFocused(); await expect(page.getByTestId('focus-text')).toHaveAttribute('maxlength', '300');
    await expect(page.getByTestId('channel-choice-linkedin')).toBeVisible(); await expect(page.getByTestId('draw-start')).toBeDisabled();
    await page.keyboard.type('x'); await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid^="channel-choice-"]'))).toBe(true); // the next stop is the channel
    await page.keyboard.press('Space');
    await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(page.getByTestId('draw-start')).toBeEnabled();
    await page.getByTestId('focus-text').fill(''); await expect(page.getByTestId('draw-start')).toBeDisabled(); // channel chosen, focus empty
    const text = 'How the agent keeps its state between turns';
    await page.getByTestId('focus-text').fill(text); await expect(page.getByTestId('draw-start')).toBeEnabled();
    // Tab on to Draw it and press Enter: the run starts with the typed focus and the chosen channel.
    await page.getByTestId('focus-text').focus();
    for (let i = 0; i < 12 && !(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="draw-start"]'))); i++) await page.keyboard.press('Tab');
    await expect(page.getByTestId('draw-start')).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('draw-progress')).toBeVisible();
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 120_000 });
    const run = posts.find(p => p.path === '/api/runs')!;
    expect(run.body).toMatchObject({ kind: 'draw', focus: { kind: 'typed', text }, channel: 'linkedin' });
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('node-intake')).toBeVisible();
    // Must not happen: more than one drawing written, or a draw before the keyboard asked for it.
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
    expect(await exists(join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true); expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  } finally { await server.close(); }
});
