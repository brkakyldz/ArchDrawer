import { test, expect } from '@playwright/test';
import { basename } from 'node:path';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing } from './helpers';
import { optionBox, SLUG } from './helpers-selections';

// HOME-4, HOME-6, STORY-1 (ui contract, *Following a job*, `draw-progress`, `draw-stage`, `draw-ready`, `draw-open`): the screen half
// of H121's draw. A section ticked on the home screen and drawn for LinkedIn: the panel follows the draw with its one row and its three
// stages in order (the choosing step is not shown), ends on `Ready` with `Open`, and Open lands in the editor on the LinkedIn channel
// of that section, with the overview drawn beside it. H237 holds that nothing opens the editor by itself (JOB-8).
test('H249 [STORY-1 READ-1 HOME-4 HOME-6 #181 #202] a section ticked on the home screen and drawn for LinkedIn is followed in its row and three stages, ends on Ready with Open, and opens in the editor on the LinkedIn channel of that section with its overview drawn', async ({ page, request }) => {
  test.setTimeout(60_000);
  const project = await gitRepo('start-ready');
  const other = await workspaceRaw('start-ready-home', shop3('Ready shop'));
  const server = await isolatedDrawing(page, request, other.file, '600'); // slow enough to watch the stages of a draw
  try {
    const posts: { path: string; body: any }[] = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { let body: any = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; } posts.push({ path: url.pathname, body }); }
    });

    // The folder, its scan, one section and the LinkedIn post (H121 holds the choosing step itself).
    await page.goto(`${server.base}/`); await expect(page.getByTestId('start')).toBeVisible();
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 15_000 });
    const agentLoop = optionBox(page, 'o2');
    await agentLoop.click(); await expect(agentLoop).toBeChecked();
    await page.getByTestId('channel-choice-linkedin').click(); await expect(page.getByTestId('draw-start')).toBeEnabled();
    await page.getByTestId('draw-start').click();

    // The draw: its three stages in order, the panel following it (the choosing step is not shown), then Ready, and the editor from Open.
    await expect(page.getByTestId('draw-progress')).toBeVisible();
    await expect(page.getByTestId('draw-stage')).toHaveCount(3);
    await expect(page.getByTestId('draw-stage').evaluateAll(els => els.map(el => el.getAttribute('data-stage')))).resolves.toEqual(['read', 'overview', 'channel']);
    await expect(page.getByTestId('draw-stage').nth(0)).toContainText('Reading the code'); await expect(page.getByTestId('draw-stage').nth(1)).toContainText('Drawing the overview');
    await expect(page.getByTestId('draw-stage').nth(2)).toContainText('Drawing the LinkedIn post');
    await expect(page.getByTestId('draw-choice')).toHaveCount(1); await expect(page.getByTestId('draw-choice')).toHaveAttribute('data-choice', SLUG.o2); await expect(page.getByTestId('draw-choice-title')).toHaveText('The agent loop');
    await expect(page.getByTestId('draw-line')).toBeVisible(); await expect(page.getByTestId('draw-cancel')).toBeVisible();
    await expect(page.getByTestId('start-folder')).toBeDisabled(); await expect(page.getByTestId('channel-choice-readme')).toHaveCount(0); await expect(page.getByTestId('focus-list')).toHaveCount(0);
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('draw-ready')).toContainText('1 drawing for a LinkedIn post'); await expect(page.getByTestId('draw-open')).toBeVisible();
    await page.getByTestId('draw-open').click();
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 30_000 });
    const run = posts.find(p => p.path === '/api/runs')!;
    expect(run.body).toMatchObject({ kind: 'draw', choices: [{ kind: 'option', option: 'o2' }], channel: 'linkedin' }); expect(run.body).not.toHaveProperty('focus');
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
    await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', SLUG.o2);
    await expect(page).toHaveURL(new RegExp(`/d/[^/?]+\\?choice=${SLUG.o2}&channel=linkedin`));
    await expect(page.getByTestId('views-panel')).toHaveCount(0); // one choice whose overview holds one view: nothing to choose between
    await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('repo-name')).toHaveText(basename(project.dir));
    await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(page.getByTestId('channel-empty')).toHaveCount(0);
    // The overview is drawn with it: the agent and the runtime that holds it.
    await page.getByTestId('channel-tab-overview').click(); await expect(page.getByTestId('node-agent')).toBeVisible(); await expect(page.getByTestId('node-zone-runtime')).toBeVisible();
  } finally { await server.close(); }
});
