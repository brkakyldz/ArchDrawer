// The held-out acceptance suite (testing contract, *Test suites*). Every spec file starts its own product (`server.ts`), so files run
// side by side in four workers with nothing shared; the web client is built once, before any of them starts.
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const escapedDirectory = here.replace(/[\\/]+$/, '').split(/[\\/]/)
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');

export default defineConfig({
  testDir: here,
  // Only the H*.spec.ts files of this folder (an anchored absolute pattern leaves out any subfolder).
  testMatch: new RegExp(`^${escapedDirectory}[\\\\/]H[^\\\\/]*\\.spec\\.ts$`),
  globalSetup: join(here, 'global-setup.ts'),
  fullyParallel: false,
  workers: 4,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: join(root, 'test-results', 'holdout.json') }]],
  outputDir: join(root, 'test-results', 'holdout-artifacts'),
  use: {
    browserName: 'chromium', viewport: { width: 1600, height: 1000 },
    acceptDownloads: true, trace: 'retain-on-failure',
  },
});
