// Shared helpers for the server and CLI tests (not shipped behaviour).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "./app";
import { APP_ROOT, loadConfig } from "./config";
import { RunManager } from "./runs";
import { ScanManager } from "./scans";
import { Store } from "./store";
import { FixtureEngine } from "./engines/fixture";
import type { Engine } from "./engines/types";

export const PORT = 4999;
export const BASE = `http://127.0.0.1:${PORT}`;
export const TOKEN = "test-token";

export function tempDir(prefix = "archdraw-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeFolder(files: Record<string, string>): string {
  const dir = tempDir("archdraw-src-");
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

/** The bundled example (an `@3` file) as an object. */
export const shopFile = (): Record<string, unknown> => JSON.parse(readFileSync(join(APP_ROOT, "examples", "shop.archdraw.json"), "utf8"));
/** The same drawing as an `@2` file, which is converted when read. */
export const shopFile2 = (): Record<string, unknown> => JSON.parse(readFileSync(join(APP_ROOT, "tests", "fixtures", "shop.archdraw.json"), "utf8"));

/** A repository folder holding `shop.archdraw.json` (and `.git`, so it is the repository root). */
export function shopRepo(extra: Record<string, string> = {}): { root: string; file: string } {
  const root = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n", "web/index.html": "<html></html>", ...extra });
  const file = join(root, "shop.archdraw.json");
  writeFileSync(file, JSON.stringify(shopFile(), null, 2));
  return { root, file };
}

export function makeApp(opts: { engines?: Engine[]; stepMs?: number; timeoutMs?: number; keepMs?: number } = {}) {
  const dataDir = tempDir("archdraw-data-");
  const config = loadConfig({ PORT: String(PORT), ARCHDRAW_DATA_DIR: dataDir, ARCHDRAW_ENGINES: "fixture" });
  const store = new Store(dataDir);
  const runs = new RunManager(store, { timeoutMs: opts.timeoutMs ?? 60_000, keepMs: opts.keepMs });
  const scans = new ScanManager(dataDir, { timeoutMs: opts.timeoutMs ?? 60_000, keepMs: opts.keepMs });
  const engines = new Map<string, Engine>((opts.engines ?? [new FixtureEngine(opts.stepMs ?? 1)]).map((e) => [e.id, e]));
  let shutdowns = 0;
  const app = createApp({ config, store, runs, scans, engines, token: TOKEN, onShutdown: () => { shutdowns++; } });
  const req = (path: string, init: RequestInit & { json?: unknown; token?: string | null; host?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("host", init.host ?? `127.0.0.1:${PORT}`);
    const method = (init.method ?? "GET").toUpperCase();
    if (init.token !== null && method !== "GET") headers.set("x-archdraw-token", init.token ?? TOKEN);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    return app.request(`${BASE}${path}`, { ...init, method, headers, body });
  };
  return { app, req, store, runs, scans, dataDir, shutdowns: () => shutdowns };
}
