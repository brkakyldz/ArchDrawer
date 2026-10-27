import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing, writeExistingDrawing, samePath, exists, startedRun, finishRun } from './helpers';
import { optionBox } from './helpers-selections';

// START-4: the home screen starts a drawing from a local folder through four steps (folder, what to draw, channel, draw), each
// kept while the user goes on. The user's own drawing in the folder is offered first and never replaced.
// From ADR 0015 the choices are checkboxes, sections first and flows after; H191 and H192 hold the list and several choices at once.
// The draw's outcome is read from the server here; H249 follows the same kind of draw on the screen (its rows, `Ready`, `Open`, the
// editor on the LinkedIn channel), and H237 holds that nothing opens the editor by itself (ADR 0016).
test('H121 [START-4, SCAN-1, SCAN-2, SCAN-3, STORY-1, HOME-2, HOME-3, #180, #181, #200, #201] type a folder, be offered the drawing it already holds first, see its card and choices, tick a section and choose the LinkedIn post, and draw it into the next free name beside that drawing', async ({ page, request }) => {
  test.setTimeout(60_000);
  const project = await gitRepo('start-flow');
  const first = await writeExistingDrawing(project.dir, 'architecture.archdraw.json', 'Earlier drawing');
  const other = await workspaceRaw('start-home', shop3('Home shop'));
  const server = await isolatedDrawing(page, request, other.file, '600'); // the step of the server before the split (H249 watches the stages at it)
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
    await expect(page.getByTestId('scan-card')).toHaveCount(0);
    await page.getByTestId('start-open-existing').click();
    await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('repo-name')).toHaveText('Earlier drawing');
    expect(posts.filter(p => p.path === '/api/scans'), 'neither the offer nor Open it scans').toEqual([]); // the whole window from the offer to the open editor
    expect(posts.some(p => p.path === '/api/files' && samePath(p.body.path, first))).toBe(true);
    const openedBytes = await readFile(first, 'utf8'); // opening registers the file in normal form (api.md POST /api/files): this is the content the draw must leave alone

    // Start again: the scan runs, the card and the options appear, the channel is asked only after a focus.
    await startFlow();
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await page.getByTestId('start-again').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 15_000 });
    expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(1);
    expect(samePath(posts.find(p => p.path === '/api/scans')!.body.folder, project.dir)).toBe(true);
    await expect(page.getByTestId('scan-card-name')).toHaveText(basename(project.dir));
    await expect(page.getByTestId('scan-card-sentence')).toHaveText('A project scanned by the test engine.');
    await expect(page.getByTestId('scan-card-type')).toHaveText('AI agent project'); await expect(page.getByTestId('scan-card-type')).toHaveAttribute('data-type', 'agent');
    await expect(page.getByTestId('scan-card-languages')).toContainText('TypeScript');
    await expect(page.getByTestId('scan-card-entry').first()).toContainText('main.ts');
    await expect(page.getByTestId('scan-cached')).toHaveCount(0); // first look at this commit
    const options = page.getByTestId('focus-option'), agentLoop = optionBox(page, 'o2'), flow = optionBox(page, 'o1');
    await expect(options).toHaveCount(3);
    // The sections come first (in option order), then the flows: the loop and the server side, then the request.
    await expect(options.evaluateAll(els => els.map(el => [el.getAttribute('data-option'), el.getAttribute('data-kind')]))).resolves.toEqual([['o2', 'section'], ['o3', 'section'], ['o1', 'flow']]);
    await expect(agentLoop).toContainText('The agent loop'); await expect(agentLoop).toContainText('How the agent proposes and runs a tool.');
    await expect(agentLoop.getByTestId('focus-option-files')).toContainText('gamma.ts');
    await expect(flow.getByTestId('focus-option-files')).toContainText('alpha.ts'); await expect(flow.getByTestId('focus-option-files')).toContainText('beta.ts');
    await expect(page.getByTestId('focus-whole')).toBeVisible(); await expect(page.getByTestId('focus-typed')).toBeVisible();
    for (const c of ['linkedin', 'readme', 'presentation']) await expect(page.getByTestId(`channel-choice-${c}`)).toHaveCount(0); // after a choice is ticked
    await expect(page.getByTestId('draw-start')).toBeDisabled();

    // Tick the section, then choose the channel: none is chosen at first.
    await agentLoop.click(); await expect(agentLoop).toBeChecked(); await expect(page.getByTestId('focus-count')).toHaveText('1 chosen'); await expect(page.getByTestId('draw-start')).toContainText('Draw it');
    for (const c of ['linkedin', 'readme', 'presentation']) { await expect(page.getByTestId(`channel-choice-${c}`)).toBeVisible(); await expect(page.getByTestId(`channel-choice-${c}`)).not.toBeChecked(); }
    await expect(page.getByTestId('draw-start')).toBeDisabled();
    await page.getByTestId('channel-choice-linkedin').click(); await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(page.getByTestId('draw-start')).toBeEnabled();

    // Draw it: one draw request with the ticked section and the channel, and the run ends on the server (H249 follows it on the screen).
    const started = await startedRun(page, () => page.getByTestId('draw-start').click());
    expect(started.body).toMatchObject({ kind: 'draw', choices: [{ kind: 'option', option: 'o2' }], channel: 'linkedin' }); expect(started.body).not.toHaveProperty('focus');
    await finishRun(request, started.runId, 'succeeded', 30_000, server.base);

    // The new drawing took the next free name; the user's own file is as it was; the library lists both.
    const written = join(project.dir, 'docs', 'architecture-2.archdraw.json');
    expect(await exists(written)).toBe(true); expect(await readFile(first, 'utf8')).toBe(openedBytes); // same bytes as after it was opened, so its facts are the same too
    await page.goto(`${server.base}/`);
    const rows = page.getByTestId('library-item');
    await expect(rows.filter({ has: page.getByTestId('library-item-title').filter({ hasText: basename(project.dir) }) }).getByTestId('library-item-path')).toHaveText(written);
    await expect(rows.filter({ has: page.getByTestId('library-item-title').filter({ hasText: 'Earlier drawing' }) })).toHaveCount(1);
    // Must not happen: the old file replaced, the project changed beyond the one new file, or a second draw request.
    expect((await project.git(['status', '--porcelain'])).trim()).toBe('?? docs/');
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
  } finally { await server.close(); }
});
