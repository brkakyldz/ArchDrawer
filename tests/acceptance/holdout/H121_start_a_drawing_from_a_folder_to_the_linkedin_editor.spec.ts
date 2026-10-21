import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing, writeExistingDrawing, samePath, exists } from './helpers';

// START-4: the home screen starts a drawing from a local folder through four choices (folder, focus, channel, draw), each
// kept while the user goes on. The user's own drawing in the folder is offered first and never replaced. Journeys that
// open the editor after a draw choose LinkedIn: the editor shows README and presentation from steps F and G on.
test('H121 [START-4, SCAN-1, SCAN-2, SCAN-3, STORY-1, READ-1] type a folder, see its card and focus options, choose a focus and the LinkedIn post, draw it, and land in the editor on the LinkedIn channel, offered the drawing the folder already holds first', async ({ page, request }) => {
  test.setTimeout(240_000);
  const project = await gitRepo('start-flow');
  const first = await writeExistingDrawing(project.dir, 'architecture.archdraw.json', 'Earlier drawing');
  const other = await workspaceRaw('start-home', shop3('Home shop'));
  const server = await isolatedDrawing(page, request, other.file, '600'); // slow enough to watch the stages of a draw
  try {
    const posts: { path: string; body: any }[] = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { let body: any = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; } posts.push({ path: url.pathname, body }); }
    });
    const startFlow = async () => { await page.goto(`${server.base}/`); await expect(page.getByTestId('start')).toBeVisible(); await expect(page.getByTestId('library')).toBeVisible(); };

    // The folder first: it holds a drawing, so the app offers it. Neither choice scans by itself.
    await startFlow();
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('start-existing')).toContainText('This folder already has a drawing.');
    await expect(page.getByTestId('start-open-existing')).toBeVisible(); await expect(page.getByTestId('start-again')).toBeVisible();
    await page.waitForTimeout(800);
    expect(posts.filter(p => p.path === '/api/scans'), 'the offer scans nothing').toEqual([]); await expect(page.getByTestId('scan-card')).toHaveCount(0);
    await page.getByTestId('start-open-existing').click();
    await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('repo-name')).toHaveText('Earlier drawing');
    expect(posts.some(p => p.path === '/api/files' && samePath(p.body.path, first))).toBe(true);
    const openedBytes = await readFile(first, 'utf8'); // opening registers the file in normal form (api.md POST /api/files): this is the content the draw must leave alone

    // Start again: the scan runs, the card and the options appear, the channel is asked only after a focus.
    await startFlow();
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await page.getByTestId('start-again').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
    expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(1);
    expect(samePath(posts.find(p => p.path === '/api/scans')!.body.folder, project.dir)).toBe(true);
    await expect(page.getByTestId('scan-card-name')).toHaveText(basename(project.dir));
    await expect(page.getByTestId('scan-card-sentence')).toHaveText('A project scanned by the test engine.');
    await expect(page.getByTestId('scan-card-type')).toHaveText('AI agent project'); await expect(page.getByTestId('scan-card-type')).toHaveAttribute('data-type', 'agent');
    await expect(page.getByTestId('scan-card-languages')).toContainText('TypeScript');
    await expect(page.getByTestId('scan-card-entry').first()).toContainText('main.ts');
    await expect(page.getByTestId('scan-cached')).toHaveCount(0); // first look at this commit
    const options = page.getByTestId('focus-option');
    await expect(options).toHaveCount(3);
    await expect(options.evaluateAll(els => els.map(el => [el.getAttribute('data-option'), el.getAttribute('data-kind')]))).resolves.toEqual([['o1', 'flow'], ['o2', 'mechanism'], ['o3', 'overview']]);
    await expect(options.nth(1)).toContainText('The agent loop'); await expect(options.nth(1)).toContainText('How the agent proposes and runs a tool.');
    await expect(options.nth(1).getByTestId('focus-option-files')).toContainText('gamma.ts');
    await expect(options.nth(0).getByTestId('focus-option-files')).toContainText('alpha.ts'); await expect(options.nth(0).getByTestId('focus-option-files')).toContainText('beta.ts');
    await expect(page.getByTestId('focus-whole')).toBeVisible(); await expect(page.getByTestId('focus-typed')).toBeVisible();
    for (const c of ['linkedin', 'readme', 'presentation']) await expect(page.getByTestId(`channel-choice-${c}`)).toHaveCount(0); // after a focus
    await expect(page.getByTestId('draw-start')).toBeDisabled();

    // Choose the mechanism, then the channel: none is chosen at first.
    await options.nth(1).click();
    for (const c of ['linkedin', 'readme', 'presentation']) { await expect(page.getByTestId(`channel-choice-${c}`)).toBeVisible(); await expect(page.getByTestId(`channel-choice-${c}`)).not.toBeChecked(); }
    await expect(page.getByTestId('draw-start')).toBeDisabled();
    await page.getByTestId('channel-choice-linkedin').click(); await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(page.getByTestId('draw-start')).toBeEnabled();
    await page.getByTestId('draw-start').click();

    // The draw: its three stages in order, the choices locked while it runs, then the editor on the new drawing.
    await expect(page.getByTestId('draw-progress')).toBeVisible();
    await expect(page.getByTestId('draw-stage')).toHaveCount(3);
    await expect(page.getByTestId('draw-stage').evaluateAll(els => els.map(el => el.getAttribute('data-stage')))).resolves.toEqual(['read', 'overview', 'channel']);
    await expect(page.getByTestId('draw-stage').nth(0)).toContainText('Reading the code'); await expect(page.getByTestId('draw-stage').nth(1)).toContainText('Drawing the overview');
    await expect(page.getByTestId('draw-stage').nth(2)).toContainText('Drawing the LinkedIn post');
    await expect(page.getByTestId('draw-line')).toBeVisible(); await expect(page.getByTestId('draw-cancel')).toBeVisible();
    await expect(page.getByTestId('start-folder')).toBeDisabled(); await expect(page.getByTestId('channel-choice-readme')).toBeDisabled();
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 120_000 });
    const run = posts.find(p => p.path === '/api/runs')!;
    expect(run.body).toMatchObject({ kind: 'draw', focus: { kind: 'option', option: 'o2' }, channel: 'linkedin' });
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await expect(page).toHaveURL(/\/d\/[^/?]+\?channel=linkedin/);
    await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('repo-name')).toHaveText(basename(project.dir));
    await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(page.getByTestId('channel-empty')).toHaveCount(0);
    // The overview is drawn with it: the agent and the runtime that holds it.
    await page.getByTestId('channel-tab-overview').click(); await expect(page.getByTestId('node-agent')).toBeVisible(); await expect(page.getByTestId('node-zone-runtime')).toBeVisible();

    // The new drawing took the next free name; the user's own file is as it was; the library lists both.
    const written = join(project.dir, 'docs', 'architecture-2.archdraw.json');
    expect(await exists(written)).toBe(true); expect(await readFile(first, 'utf8')).toBe(openedBytes); // same bytes as after it was opened, so its facts are the same too
    await page.goto(`${server.base}/`);
    const rows = page.getByTestId('library-item');
    await expect(rows.filter({ has: page.getByTestId('library-item-title').filter({ hasText: basename(project.dir) }) }).getByTestId('library-item-path')).toHaveText(written);
    await expect(rows.filter({ has: page.getByTestId('library-item-title').filter({ hasText: 'Earlier drawing' }) })).toHaveCount(1);
    // Must not happen: the old file replaced, or the project changed beyond the one new file.
    expect((await project.git(['status', '--porcelain'])).trim()).toBe('?? docs/');
  } finally { await server.close(); }
});
