import { spawn, spawnSync } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { DEFAULT_SHARE, FORMAT_IDS, renderShare, type FormatId } from "../core/export/share";
import { joinChannel } from "../core/channels";
import { readAnyFile } from "../core/convert";
import { CHANNELS, isChannel, type ChannelId } from "../core/file3";
import { choiceDoc, resolveChoice } from "../core/file4";
import { isV1, migrateV1 } from "../core/migrate";
import { newDocumentId, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, THEMES, type Theme } from "../core/model";
import { APP_ROOT, BUILD, loadConfig, VERSION, type Config } from "../server/config";
import { checkFile, docText, normaliseFile, writeAtomic } from "../server/files";
import { readServerInfo, type ServerInfo } from "../server/serverfile";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const HELP = `archdrawer ${VERSION} — draw and edit a repository's architecture

Usage:
  archdrawer validate <file>                 check a drawing file, list every problem
  archdrawer open <file> [--no-browser]      check, tidy and open the file in the editor
  archdrawer svg <file> [--choice <id>] [--channel <c>] [--view <id>] [--format linkedin|readme|slide|square|feed]
                        [--theme light|dark] [--out <path>]
                                             write the share image as SVG
  archdrawer migrate <file>                  rewrite an archdraw/diagram@1, @2 or @3 file as @4
  archdrawer status                          is the editor server running?
  archdrawer stop                            stop the editor server
  archdrawer --version | --help`;

class Usage extends Error {}

/** Parse `<file> [--flag value] [--switch]`; unknown flags, `-x` among them, are usage errors. */
function parse(args: string[], flags: string[], switches: string[] = []) {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const on = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-") && a !== "-") {
      const name = a.startsWith("--") ? a.slice(2) : "";
      if (switches.includes(name)) on.add(name);
      else if (flags.includes(name) && i + 1 < args.length) opt[name] = args[++i];
      else throw new Usage(`Unknown or incomplete option ${a}`);
    } else pos.push(a);
  }
  return { pos, opt, on };
}

/** Print a validation report as `validate` does; true when the file is valid. */
function report(io: CliIo, r: { ok: boolean; errors: string[]; warnings: string[] }): boolean {
  for (const w of r.warnings) io.out(`WARN  ${w}`);
  if (!r.ok) {
    for (const e of r.errors) io.out(`ERROR ${e}`);
    io.out(`${r.errors.length} error(s)`);
  }
  return r.ok;
}

/** The build an archdrawer server on `port` runs, or null when none answers. */
async function healthBuild(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { app?: string; build?: unknown };
    return res.ok && body.app === "archdrawer" ? (typeof body.build === "string" ? body.build : "") : null;
  } catch {
    return null;
  }
}
const health = async (port: number) => (await healthBuild(port)) !== null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether the server on `info.port` holds `info.token`. A mutating call without the right token gets
 * 403 (api contract); `POST /api/health` is no route, so with the right token it changes nothing.
 */
async function holdsToken(info: ServerInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { method: "POST", headers: { "x-archdraw-token": info.token }, signal: AbortSignal.timeout(1500) });
    return res.status !== 403;
  } catch {
    return false;
  }
}

/**
 * The build of the server `info` names, when that server answers and holds the token in server.json,
 * so it is this data directory's; else null — none answers, or a stale server.json names a port
 * another archdrawer server has since taken.
 */
async function ownBuild(info: ServerInfo): Promise<string | null> {
  const build = await healthBuild(info.port);
  return build !== null && (await holdsToken(info)) ? build : null;
}

/** The running server of this data directory, if it answers. */
async function running(config: Config): Promise<ServerInfo | null> {
  const info = readServerInfo(config.dataDir);
  return info && (await ownBuild(info)) !== null ? info : null;
}

/** Ask a server to stop and wait (up to 5 s) until it no longer answers; the problem when it still does. */
async function shutdown(info: ServerInfo): Promise<string | null> {
  const res = await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: "POST", headers: { "x-archdraw-token": info.token }, signal: AbortSignal.timeout(1500) }).catch(() => null);
  if (res && !res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return `The editor server refused to stop: ${body.error ?? res.status}`;
  }
  const until = Date.now() + 5000;
  while (await health(info.port)) {
    if (Date.now() >= until) return `The editor server on port ${info.port} (pid ${info.pid}) still answers after 5 s`;
    await sleep(100);
  }
  return null;
}

/**
 * This installation's server: the running one when it runs the same code, else a new one — a server
 * started from older code would serve answers the page no longer understands (cli contract, open).
 */
export async function current(config: Config, io: CliIo, start: (c: Config, io: CliIo) => Promise<ServerInfo> = startServer): Promise<ServerInfo> {
  const info = readServerInfo(config.dataDir);
  const build = info ? await ownBuild(info) : null;
  if (info && build === BUILD) return info;
  if (info && build !== null) {
    const problem = await shutdown(info);
    if (problem) throw new Error(problem);
    io.out("Restarted the editor server (it was running older code)");
  }
  return start(config, io);
}

/** Start the server detached, so it outlives this command and the session that ran it. */
async function startServer(config: Config, io: CliIo): Promise<ServerInfo> {
  const start = join(APP_ROOT, "scripts", "start.mjs");
  const built = spawnSync(process.execPath, [start, "--build-only"], { cwd: APP_ROOT, env: io.env, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", windowsHide: true });
  if (built.status !== 0) throw new Error(`The web client failed to build: ${built.stderr?.trim().split(/\r?\n/).slice(-3).join(" ")}`);
  mkdirSync(config.dataDir, { recursive: true });
  const logFile = join(config.dataDir, "server.log");
  const log = openSync(logFile, "a");
  const from = fstatSync(log).size;
  const child = spawn(process.execPath, [start], {
    cwd: APP_ROOT, env: { ...io.env, PORT: String(config.port), ARCHDRAW_DATA_DIR: config.dataDir },
    detached: true, stdio: ["ignore", log, log], windowsHide: true,
  });
  let exited: number | null = null;
  child.on("exit", () => { exited = Date.now(); }).on("error", () => { exited = Date.now(); });
  child.unref();
  closeSync(log);
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    await sleep(200);
    // Whoever started it: another command may have started this data directory's server at the same time.
    // Then ours, still starting, is stopped; else it would take the port once that server stops.
    const info = readServerInfo(config.dataDir);
    if (info && (await ownBuild(info)) === BUILD) {
      if (info.pid !== child.pid && exited === null) child.kill();
      return info;
    }
    // Ours stopped (a port in use, say); the grace lets a server that won the same race write server.json.
    if (exited !== null && Date.now() - exited > 2000) throw new Error(`The editor server did not start: ${lastLine(logFile, from) ?? "it stopped"}; see ${logFile}`);
  }
  throw new Error(`The editor server did not start within 15 s; see ${logFile}`);
}

/** The last non-empty line written to `file` after byte `from`. */
function lastLine(file: string, from: number): string | null {
  try {
    return readFileSync(file).subarray(from).toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

/** Open a URL in the default browser without a shell (the URL is ours: port and id are validated). */
function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
  } catch { /* the URL is printed */ }
}

async function cmdOpen(args: string[], io: CliIo, config: Config): Promise<number> {
  const { pos, on } = parse(args, [], ["no-browser"]);
  if (pos.length !== 1) throw new Usage("open needs exactly one file");
  const file = resolve(pos[0]);
  const r = checkFile(file, "warn");
  if (!report(io, r) || !r.file) return 1;
  const n = normaliseFile(r.file, { path: file, id: r.file.id ?? newDocumentId(), now: new Date().toISOString(), text: r.text });
  if (n.changed) writeAtomic(file, n.text);
  const info = await current(config, io);
  const res = await fetch(`http://127.0.0.1:${info.port}/api/files`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-archdraw-token": info.token },
    body: JSON.stringify({ path: file }),
  });
  const body = (await res.json()) as { id?: string; url?: string; error?: string; errors?: string[] };
  if (!res.ok || !body.url) {
    io.err(`The editor refused the file: ${body.error ?? res.status}`);
    for (const e of body.errors ?? []) io.out(`ERROR ${e}`);
    return 1;
  }
  if (!on.has("no-browser") && !config.noOpen) openBrowser(body.url);
  io.out(`Opened ${file} → ${body.url}`);
  return 0;
}

function cmdSvg(args: string[], io: CliIo): number {
  const { pos, opt } = parse(args, ["choice", "channel", "view", "format", "theme", "out"]);
  if (pos.length !== 1) throw new Usage("svg needs exactly one file");
  if (opt.channel !== undefined && !isChannel(opt.channel)) throw new Usage(`Unknown channel "${opt.channel}"; use one of ${CHANNELS.join(", ")}`);
  const format = (opt.format ?? "linkedin") as FormatId;
  if (!FORMAT_IDS.includes(format)) throw new Usage(`Unknown format "${format}"; use one of ${FORMAT_IDS.join(", ")}`);
  if (opt.theme !== undefined && !THEMES.includes(opt.theme as Theme)) throw new Usage(`Unknown theme "${opt.theme}"; use light or dark`);
  const file = resolve(pos[0]);
  const r = checkFile(file, "warn");
  if (!report(io, r) || !r.file) return 1;
  const { doc: whole } = normaliseFile(r.file, { path: file, id: r.file.id ?? "d_unsaved", now: new Date().toISOString(), text: r.text });
  // The choice named, else the one holding the view, else the first (cli contract, svg).
  const chosen = resolveChoice(whole, opt.choice, opt.view);
  if (typeof chosen === "string") { io.err(`No choice "${opt.choice}" in ${file}; choices: ${whole.choices.map((c) => c.id).join(", ")}`); return 1; }
  const stored = choiceDoc(whole, chosen.id);
  const channel = (opt.channel ?? "overview") as ChannelId;
  const doc = joinChannel(stored, channel);
  if (doc.views.length === 0) { io.err(`The channel "${channel}" has no drawing in ${file}`); return 1; }
  const view = opt.view ?? doc.views[0].id;
  if (!doc.views.some((v) => v.id === view)) { io.err(`No view "${view}" in the ${channel} channel of ${file}; views: ${doc.views.map((v) => v.id).join(", ")}`); return 1; }
  const font = (name: string) => readFileSync(join(APP_ROOT, "src", "web", "fonts", name)).toString("base64");
  const img = renderShare(doc, view, { ...DEFAULT_SHARE, format, theme: (opt.theme as Theme) ?? doc.theme, fonts: { sans: font("Geist-Variable.woff2"), mono: font("GeistMono-Variable.woff2") } });
  const out = resolve(opt.out ?? join(dirname(file), `${basename(file, extname(file)).replace(/\.archdraw$/, "")}-${view}-${format}.svg`));
  writeFileSync(out, img.svg);
  io.out(out);
  return 0;
}

function cmdMigrate(args: string[], io: CliIo): number {
  const { pos } = parse(args, []);
  if (pos.length !== 1) throw new Usage("migrate needs exactly one file");
  const file = resolve(pos[0]);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")); } catch (e) { io.out(`ERROR json: ${(e as Error).message}`); return 1; }
  const schema = (raw as { schema?: unknown })?.schema;
  if (schema === SCHEMA_V4) { io.out(`already ${SCHEMA_V4}`); return 0; }
  if (!isV1(raw) && schema !== SCHEMA_V2 && schema !== SCHEMA_V3) { io.out("ERROR schema: not an archdrawer drawing"); return 1; }
  const now = new Date().toISOString();
  // @1 converts through @2 (diagram contract, Reading archdraw/diagram@1).
  const v1 = isV1(raw) ? migrateV1(raw, now) : null;
  const r = readAnyFile(v1 ? v1.doc : raw);
  if (!r.ok || !r.file) { for (const e of r.errors) io.out(`ERROR ${e}`); io.out(`${r.errors.length} error(s)`); return 1; }
  writeAtomic(file, docText(r.file));
  for (const w of [...(v1?.warnings ?? []), ...r.warnings]) io.out(w);
  io.out("migrated");
  return 0;
}

async function cmdStatus(io: CliIo, config: Config): Promise<number> {
  const info = await running(config);
  io.out(info ? `running on http://127.0.0.1:${info.port} (pid ${info.pid})` : "not running");
  return 0;
}

async function cmdStop(io: CliIo, config: Config): Promise<number> {
  const info = await running(config);
  if (!info) { io.out("not running"); return 0; }
  const problem = await shutdown(info);
  if (problem) { io.err(problem); return 1; }
  io.out("stopped");
  return 0;
}

/** The whole CLI; returns the exit code (0 success, 1 invalid file or failure, 2 usage). */
export async function runCli(argv: string[], io: CliIo = { out: (l) => console.log(l), err: (l) => console.error(l), env: process.env }): Promise<number> {
  const [cmd, ...rest] = argv;
  const config = loadConfig(io.env);
  try {
    switch (cmd) {
      case undefined: io.out(HELP); return 2;
      case "--help": case "-h": case "help": io.out(HELP); return 0;
      case "--version": case "-v": io.out(VERSION); return 0;
      case "validate": {
        const { pos } = parse(rest, []);
        if (pos.length !== 1) throw new Usage("validate needs exactly one file");
        const r = checkFile(resolve(pos[0]));
        if (!report(io, r)) return 1;
        io.out(r.warnings.length ? `valid with ${r.warnings.length} warning(s)` : "valid");
        return 0;
      }
      case "open": return await cmdOpen(rest, io, config);
      case "svg": return cmdSvg(rest, io);
      case "migrate": return cmdMigrate(rest, io);
      case "status": return await cmdStatus(io, config);
      case "stop": return await cmdStop(io, config);
      default: throw new Usage(`Unknown command "${cmd}"`);
    }
  } catch (e) {
    if (e instanceof Usage) { io.err(e.message); io.err('Run "archdrawer --help" for the commands.'); return 2; }
    io.err((e as Error).message);
    return 1;
  }
}

