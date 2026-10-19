import { defineConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const port = process.env.HOLDOUT_PORT || '4399';
// Workers may load the config again; they must inherit the server's directories.
const dataDir = process.env.HOLDOUT_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'archdraw-holdout-data-'));
const githubDir = process.env.HOLDOUT_GITHUB_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'archdraw-holdout-github-'));
process.env.HOLDOUT_DATA_DIR = dataDir;
process.env.HOLDOUT_GITHUB_DIR = githubDir;
process.env.HOLDOUT_PORT = port;

export default defineConfig({
  testDir: '.',
  testMatch: 'H*.spec.ts',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(root, 'test-results', 'holdout.json') }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    acceptDownloads: true,
    viewport: { width: 1600, height: 1100 },
  },
  webServer: {
    command: 'npm start',
    cwd: root,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: port,
      ARCHDRAW_DATA_DIR: dataDir,
      ARCHDRAW_ENGINES: 'fixture',
      ARCHDRAW_NO_OPEN: '1',
      ARCHDRAW_FIXTURE_STEP_MS: '100',
      ARCHDRAW_GITHUB_BASE: pathToFileURL(githubDir).href,
    },
  },
});
