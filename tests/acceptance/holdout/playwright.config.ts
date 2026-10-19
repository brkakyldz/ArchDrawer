import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = process.env.ARCHDRAW_HOLDOUT_PORT ?? String(await new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') return reject(new Error('No port assigned'));
    probe.close(error => error ? reject(error) : resolve(address.port));
  });
}));
const data = process.env.ARCHDRAW_HOLDOUT_DATA ?? mkdtempSync(join(tmpdir(), 'archdrawer-holdout-'));
process.env.ARCHDRAW_HOLDOUT_PORT = port;
process.env.ARCHDRAW_HOLDOUT_DATA = data;
const baseURL = `http://127.0.0.1:${port}`;
const escapedDirectory = here.replace(/[\\/]+$/, '').split(/[\\/]/)
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');

export default defineConfig({
  testDir: here,
  // An anchored absolute regex excludes H*.spec.ts files in subdirectories.
  testMatch: new RegExp(`^${escapedDirectory}[\\\\/]H[^\\\\/]*\\.spec\\.ts$`),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: join(root, 'test-results', 'holdout.json') }]],
  outputDir: join(root, 'test-results', 'holdout-artifacts'),
  use: {
    browserName: 'chromium', baseURL, viewport: { width: 1600, height: 1000 },
    acceptDownloads: true, trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start', cwd: root, url: `${baseURL}/api/health`,
    reuseExistingServer: false, timeout: 120_000,
    env: {
      PORT: port, ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: 'fixture',
      ARCHDRAW_NO_OPEN: '1', ARCHDRAW_FIXTURE_STEP_MS: '100',
    },
  },
});
