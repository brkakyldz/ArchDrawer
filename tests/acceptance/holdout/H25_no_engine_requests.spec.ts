import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drawing, workspace, freePort, cli, openDrawing, readDrawing, persisted, token } from './helpers';

test('H25 [AI-1, AI-2, START-5, SAFE-1, FILE-1] a machine without engines saves a literal request for the next session and stops only its own server', async ({ page, request }) => {
  const { dir, file } = await workspace('offline', drawing('Offline shop'));
  const data = await mkdtemp(join(tmpdir(), 'archdrawer-no-engine-')); const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: '' };
  const openedCLI = await cli(['open', file, '--no-browser'], env); expect(openedCLI.code, openedCLI.stderr).toBe(0);
  try {
    const serverInfo = JSON.parse(await readFile(join(data, 'server.json'), 'utf8'));
    expect(serverInfo.port).toBe(port); expect(serverInfo.pid).toBeGreaterThan(0); expect(serverInfo.token).toBeTruthy();
    expect(serverInfo.token).not.toBe(await token(request)); // A second process has its own token.
    const engines = await (await request.get(`${base}/api/engines`)).json(); expect(engines.engines.filter((e: { available: boolean }) => e.available)).toHaveLength(0);
    const opened = await openDrawing(page, request, file, base); const initial = await readDrawing(file);
    const marker = join(dir, 'shell-must-not-run.txt');
    const instruction = `Add a review gate; node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'bad')"`;
    await expect(page.getByTestId('ask-input')).toHaveCount(0); // the ask box is gone: the AI panel is the one place to type
    await page.getByTestId('ai-button').click();
    await page.getByTestId('ai-input').fill(instruction); await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-saved')).toHaveText('Saved in the file for your next archdrawer session');
    await expect(page.getByTestId('ai-thread').getByTestId('ai-turn')).toHaveCount(1);
    await expect(page.getByTestId('ai-thread').getByTestId('ai-turn').first()).toHaveAttribute('data-state', 'saved');
    await persisted(file, d => d.requests?.length === 1 && d.requests[0].text === instruction);
    const stored = await readDrawing(file); expect(stored.views).toEqual(initial.views);
    // The request names the channel and the view it was typed in (drawing contract, Requests).
    expect(stored.requests![0]).toMatchObject({ text: instruction, channel: 'overview', view: 'overview' }); expect(stored.requests![0].id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(Number.isFinite(Date.parse(stored.requests![0].at))).toBe(true);
    expect(await stat(marker).then(() => true, () => false)).toBe(false); // Shell-looking text is data.
    await page.reload(); await expect(page.getByTestId('repo-name')).toHaveText('Offline shop');
    const fromHTTP = await (await request.get(`${base}/api/diagrams/${opened.id}`)).json(); expect(fromHTTP.requests).toEqual(stored.requests!.map(r => ({ ...r, choice: 'system' }))); // the served @4 request names its choice (api contract)
    // The conversation is the browser's memory: a reload starts it empty, while the request stays in the file.
    await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-thread').getByTestId('ai-turn')).toHaveCount(0);
    await page.getByTestId('ai-input').fill('');
    if (await page.getByTestId('ai-send').isEnabled()) await page.getByTestId('ai-send').click();
    else await expect(page.getByTestId('ai-send')).toBeDisabled();
    expect((await readDrawing(file)).requests).toHaveLength(1); // An empty submission must not queue another request.
    await expect(page.getByTestId('ai-thread').getByTestId('ai-turn')).toHaveCount(0);
    const status = await cli(['status'], env); expect(status.code).toBe(0); expect(status.stdout).toContain(`running on ${base}`);
  } finally {
    await page.goto('about:blank'); const stopped = await cli(['stop'], env); expect(stopped.code, stopped.stderr).toBe(0); expect(stopped.stdout).toMatch(/stopped/);
    await expect.poll(async () => await stat(join(data, 'server.json')).then(() => true, () => false)).toBe(false);
    const status = await cli(['status'], env); expect(status.stdout.trim()).toBe('not running'); expect(status.code).toBe(0);
    const stoppedAgain = await cli(['stop'], env); expect(stoppedAgain.stdout.trim()).toBe('not running');
  }
});
