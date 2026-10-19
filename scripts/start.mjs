#!/usr/bin/env node
// `npm start`: build the web client when it is missing or older than its sources, then run the
// server in this process (TypeScript through tsx, so users need no separate compile step).
// `--build-only` stops after the build (the CLI runs it before starting a detached server).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
process.chdir(root);

const newest = (p) => {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.mtimeMs;
  let m = 0;
  for (const name of readdirSync(p)) m = Math.max(m, newest(join(p, name)));
  return m;
};

const built = join(root, "dist", "index.html");
// src/server too: the page carries the build id of all three (scripts/build-id.mjs).
const sources = Math.max(newest(join(root, "src", "web")), newest(join(root, "src", "core")), newest(join(root, "src", "server")), newest(join(root, "index.html")), newest(join(root, "vite.config.ts")));
if (!existsSync(built) || statSync(built).mtimeMs < sources) {
  console.error("Building the web client…");
  const vite = join(root, "node_modules", "vite", "bin", "vite.js");
  const r = spawnSync(process.execPath, [vite, "build", "--logLevel", "warn"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("The web client failed to build.");
    process.exit(r.status ?? 1);
  }
}

if (process.argv.includes("--build-only")) process.exit(0);

const { register } = await import("tsx/esm/api");
register();
await import(pathToFileURL(join(root, "src", "server", "main.ts")).href);
