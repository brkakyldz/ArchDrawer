import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The builder's own end-to-end suite: real server, fixture engine, throwaway data dir.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = process.env.E2E_PORT || "4398";
const dataDir = process.env.E2E_DATA_DIR || mkdtempSync(join(tmpdir(), "archdraw-e2e-"));
process.env.E2E_DATA_DIR = dataDir; // workers re-load this file; keep one data dir
process.env.E2E_PORT = port;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // Its own folder: the held-out run clears test-results/ and would delete these traces.
  outputDir: resolve(root, "test-results-e2e"),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, acceptDownloads: true, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm start",
    cwd: root,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: port, ARCHDRAW_DATA_DIR: dataDir, ARCHDRAW_ENGINES: "fixture", ARCHDRAW_NO_OPEN: "1", ARCHDRAW_FIXTURE_STEP_MS: "60" },
  },
});
