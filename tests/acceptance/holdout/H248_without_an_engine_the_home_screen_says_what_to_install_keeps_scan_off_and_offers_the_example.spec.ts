import { test, expect } from '@playwright/test';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing } from './helpers';

// START-3 (ui contract, `start-no-engine`, `library-example`): split from H123. With no engine on the machine the folder start cannot
// work: the screen says what to install, Scan is off, Enter in the folder field sends neither a folder check nor a scan, and the
// example drawing is offered beside it and opens.
test('H248 [START-3 #200 #201] without an engine the home screen says what to install, keeps Scan off and sends nothing for a typed folder, and offers the example drawing, which opens', async ({ page, request }) => {
  test.setTimeout(60_000);
  const project = await gitRepo('start-no-engine-folder'); // a real repository: only its path is typed, nothing may be sent for it
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
    await expect(page.getByTestId('scan-card')).toHaveCount(0);
    await page.getByTestId('library-example').click();
    await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('repo-name')).toHaveText('Sample Shop');
    // The whole window from Enter to the opened example: nothing was checked or scanned.
    expect(sent.filter(path => path === '/api/scans' || path === '/api/folders/check'), 'no engine, so no scan and no check').toEqual([]);
  } finally { await bare.close(); }
});
