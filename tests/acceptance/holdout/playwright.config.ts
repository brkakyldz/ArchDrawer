import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
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
// The testing contract (*Test suites*): the browser suites point the search home, the test folder dialog and the test links at a temp
// folder of their own, so no scenario walks the real home folder, opens a real dialog or reaches the network. The search home is empty,
// no picker file exists (the dialog answers `cancelled`) and the remotes folder is empty. The scenarios of the ADR 0016–0017 round that
// need other values start a server of their own.
const around = process.env.ARCHDRAW_HOLDOUT_AROUND ?? mkdtempSync(join(tmpdir(), 'archdrawer-holdout-around-'));
const searchHome = join(around, 'home'), remotes = join(around, 'remotes');
mkdirSync(searchHome, { recursive: true }); mkdirSync(remotes, { recursive: true });
process.env.ARCHDRAW_HOLDOUT_PORT = port;
process.env.ARCHDRAW_HOLDOUT_DATA = data;
process.env.ARCHDRAW_HOLDOUT_AROUND = around;
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
      ARCHDRAW_SEARCH_HOME: searchHome, ARCHDRAW_TEST_PICKER: join(around, 'picker.txt'), ARCHDRAW_TEST_REMOTES: remotes,
    },
  },
});
