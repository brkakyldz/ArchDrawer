import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing, exists, listedDiagrams } from './helpers';

// START-4: when a draw fails, nothing was written and every choice stays, so the user can retry or change one thing. With no
// engine the folder start cannot work: the screen says what to install, disables Scan, and the example drawing is still there.
test('H123 [START-4, READ-1, START-3, START-5] a failed draw writes nothing, keeps the folder, card, focus and channel, and Try again repeats the same request; with no engine the screen says what to install and offers the example', async ({ page, request }) => {
  test.setTimeout(240_000);
  const project = await gitRepo('start-fail');
  const listedBefore = (await listedDiagrams(request)).length;
  const posts: { path: string; body: any }[] = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { let body: any = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; } posts.push({ path: url.pathname, body }); }
  });
  const runs = () => posts.filter(p => p.path === '/api/runs');

  await page.goto('/'); await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill('The tool loop [fixture:fail]');
  await page.getByTestId('channel-choice-linkedin').click();
  await page.getByTestId('draw-start').click();

  // The draw fails at the read: the reason is shown, the choices are all still there, nothing was written or registered.
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  await expect(page.getByTestId('draw-retry')).toHaveText('Try again');
  await expect(page.getByTestId('start-folder')).toHaveValue(project.dir); await expect(page.getByTestId('scan-card')).toBeVisible();
  await expect(page.getByTestId('focus-typed')).toBeChecked(); await expect(page.getByTestId('focus-text')).toHaveValue('The tool loop [fixture:fail]');
  await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);
  expect(runs()).toHaveLength(1);

  // Try again sends the same request again (and does not scan the folder again); it fails the same way.
  const scansBefore = posts.filter(p => p.path === '/api/scans').length;
  await page.getByTestId('draw-retry').click();
  await expect.poll(() => runs().length, { timeout: 30_000 }).toBe(2);
  expect(runs()[1].body).toEqual(runs()[0].body);
  await expect(page.getByTestId('draw-error')).toBeVisible({ timeout: 90_000 }); await expect(page.getByTestId('draw-error')).toContainText('Fixture failure requested');
  expect(posts.filter(p => p.path === '/api/scans')).toHaveLength(scansBefore);

  // Change one choice and draw: the drawing is written and the editor opens on it. The failed tries left nothing behind.
  await page.getByTestId('focus-text').fill('The tool loop');
  await page.getByTestId('draw-start').click();
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  expect(runs()).toHaveLength(3); expect(runs()[2].body).toMatchObject({ kind: 'draw', focus: { kind: 'typed', text: 'The tool loop' }, channel: 'linkedin' });
  expect(await exists(join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true); expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);

  // With no engine on the machine: what to install, Scan off, and the example beside it.
  const home = await workspaceRaw('start-no-engine', shop3('Home shop'));
  const bare = await isolatedDrawing(page, request, home.file, '750', ''); // ARCHDRAW_ENGINES empty: no engine at all
  try {
    const sent: string[] = [];
    page.on('request', req => { const path = new URL(req.url()).pathname; if (req.method() === 'POST' && path.startsWith('/api/') && path !== '/api/example') sent.push(path); });
    const forgotten = await request.delete(`${bare.base}/api/diagrams/${bare.id}`, { headers: { 'X-Archdraw-Token': bare.token } });
    expect(forgotten.status()).toBe(204); // an empty library: the example shows beside the start
    await page.goto(`${bare.base}/`);
    await expect(page.getByTestId('start')).toBeVisible();
    await expect(page.getByTestId('start-no-engine')).toContainText('To draw a project, install Claude Code or Codex and sign in to it.');
    await expect(page.getByTestId('start-no-engine')).toContainText('npm install -g @anthropic-ai/claude-code');
    await expect(page.getByTestId('start-no-engine')).toContainText('npm install -g @openai/codex');
    await expect(page.getByTestId('start-scan')).toBeDisabled(); await expect(page.getByTestId('library-example')).toBeVisible();
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-folder').press('Enter');
    await page.waitForTimeout(600);
    expect(sent.filter(path => path === '/api/scans' || path === '/api/folders/check'), 'no engine, so no scan and no check').toEqual([]);
    await expect(page.getByTestId('scan-card')).toHaveCount(0);
    await page.getByTestId('library-example').click();
    await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('repo-name')).toHaveText('Sample Shop');
  } finally { await bare.close(); }
});
