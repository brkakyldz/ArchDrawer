#!/usr/bin/env node
// The `archdrawer` command (docs/contracts/cli.md): runs src/cli/main.ts through tsx.
// An installed plugin is a bare copy of the repository, so the first run installs the
// package's own dependencies next to it (one time, fixed arguments, nothing from the user).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(join(root, "node_modules", "tsx")) || !existsSync(join(root, "node_modules", "vite"))) {
  process.stderr.write("archdrawer: installing its dependencies (first run only)…\n");
  const lock = existsSync(join(root, "package-lock.json"));
  const args = [lock ? "ci" : "install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"];
  // npm is a .cmd shim on Windows; cmd runs it with these fixed arguments. Its output goes to
  // stderr so that stdout carries only the command's own answer.
  const r = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], { cwd: root, stdio: ["ignore", 2, 2] })
    : spawnSync("npm", args, { cwd: root, stdio: ["ignore", 2, 2] });
  if (r.status !== 0) {
    process.stderr.write(`archdrawer: could not install dependencies in ${root}; run "npm ci" there and try again.\n`);
    process.exit(1);
  }
}

const { register } = await import("tsx/esm/api");
register();
const { runCli } = await import(pathToFileURL(join(root, "src", "cli", "main.ts")).href);
process.exitCode = await runCli(process.argv.slice(2));
