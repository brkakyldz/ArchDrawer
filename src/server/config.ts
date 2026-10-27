import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildId } from "../../scripts/build-id.mjs";
import { slotCount } from "./slots";

/** The repository (or installed plugin) root: two levels above this file. */
export const APP_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
export const VERSION: string = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")).version;
/** The code this process runs (api contract health `build`). */
export const BUILD: string = buildId(APP_ROOT);

let fonts: { sans: string; mono: string } | null = null;
/** The Geist fonts as base64, embedded in every share image (ui contract, The share image). */
export function shareFonts(): { sans: string; mono: string } {
  const font = (name: string) => readFileSync(join(APP_ROOT, "src", "web", "fonts", name)).toString("base64");
  return (fonts ??= { sans: font("Geist-Variable.woff2"), mono: font("GeistMono-Variable.woff2") });
}

export interface Config {
  port: number;
  dataDir: string;
  engines: string[];
  fixtureStepMs: number;
  noOpen: boolean;
  runTimeoutMs: number;
  /** How long a finished job is kept and listed (`ARCHDRAW_JOB_KEEP_MS`; api contract, Activity). */
  jobKeepMs: number;
  /** Engine processes at a time for the whole server (api contract, Engine slots). */
  engineSlots: number;
  version: string;
  build: string;
  /** Directory with the built web client (index.html). */
  webDir: string;
}

/** The environment of docs/contracts/testing.md, shared by the server and the CLI. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // A whole decimal number only: parseInt would take "4405abc" as 4405 and "1e3" as 1.
  const portText = (env.PORT ?? "").trim();
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
  const engines = (env.ARCHDRAW_ENGINES ?? "claude,codex")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4317,
    dataDir: resolve(env.ARCHDRAW_DATA_DIR?.trim() || join(homedir(), ".archdraw")),
    engines: [...new Set(engines)],
    fixtureStepMs: Math.max(0, Number.parseInt(env.ARCHDRAW_FIXTURE_STEP_MS ?? "", 10) || 250),
    noOpen: Boolean(env.ARCHDRAW_NO_OPEN),
    runTimeoutMs: Math.max(10_000, Number.parseInt(env.ARCHDRAW_RUN_TIMEOUT_MS ?? "", 10) || 20 * 60_000),
    jobKeepMs: Math.max(1000, Number.parseInt(env.ARCHDRAW_JOB_KEEP_MS ?? "", 10) || 3_600_000),
    engineSlots: slotCount(env.ARCHDRAW_ENGINE_SLOTS),
    version: VERSION,
    build: BUILD,
    webDir: join(APP_ROOT, "dist"),
  };
}
