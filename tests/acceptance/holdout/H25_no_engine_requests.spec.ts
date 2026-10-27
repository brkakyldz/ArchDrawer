import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drawing, workspace, freePort, cli, token } from './helpers';

// The AI panel without an engine (a saved turn, a literal request, the served request naming its choice, an empty input that queues
// nothing) is H137's; this is the command's own server lifecycle on its own data folder.
test('H25 [START-5] a machine without engines gets a server of its own with its own token from the command and stops only its own server', async ({ request }) => {
  const { file } = await workspace('offline', drawing('Offline shop'));
  const data = await mkdtemp(join(tmpdir(), 'archdrawer-no-engine-')); const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: '' };
  const openedCLI = await cli(['open', file, '--no-browser'], env); expect(openedCLI.code, openedCLI.stderr).toBe(0);
  try {
    const serverInfo = JSON.parse(await readFile(join(data, 'server.json'), 'utf8'));
    expect(serverInfo.port).toBe(port); expect(serverInfo.pid).toBeGreaterThan(0); expect(serverInfo.token).toBeTruthy();
    expect(serverInfo.token).not.toBe(await token(request)); // A second process has its own token.
    const engines = await (await request.get(`${base}/api/engines`)).json(); expect(engines.engines.filter((e: { available: boolean }) => e.available)).toHaveLength(0);
    const status = await cli(['status'], env); expect(status.code).toBe(0); expect(status.stdout).toContain(`running on ${base}`);
  } finally {
    const stopped = await cli(['stop'], env); expect(stopped.code, stopped.stderr).toBe(0); expect(stopped.stdout).toMatch(/stopped/);
    await expect.poll(async () => await stat(join(data, 'server.json')).then(() => true, () => false)).toBe(false);
    const status = await cli(['status'], env); expect(status.stdout.trim()).toBe('not running'); expect(status.code).toBe(0);
    const stoppedAgain = await cli(['stop'], env); expect(stoppedAgain.stdout.trim()).toBe('not running');
  }
});
