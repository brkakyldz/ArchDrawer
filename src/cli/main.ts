import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { DEFAULT_SHARE, FORMAT_IDS, renderShare, type FormatId } from "../core/export/share";
import { isV1, migrateV1 } from "../core/migrate";
import { newDocumentId, SCHEMA_ID, THEMES, type Theme } from "../core/model";
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
  archdrawer svg <file> [--view <id>] [--format linkedin|readme|slide|square|feed]
                        [--theme light|dark] [--out <path>]
                                             write the share image as SVG
  archdrawer migrate <file>                  rewrite an archdraw/diagram@1 file as @2
  archdrawer status                          is the editor server running?
  archdrawer stop                            stop the editor server
  archdrawer --version | --help`;

class Usage extends Error {}

/** Parse `<file> [--flag value] [--switch]`; unknown flags are usage errors. */
function parse(args: string[], flags: string[], switches: string[] = []) {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const on = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
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

/** The running server of this data directory, if it answers. */
async function running(config: Config): Promise<ServerInfo | null> {
  const info = readServerInfo(config.dataDir);
  return info && (await health(info.port)) ? info : null;
}

/** Ask a server to stop and wait (up to 5 s) until it no longer answers. */
async function shutdown(info: ServerInfo): Promise<void> {
  await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: "POST", headers: { "x-archdraw-token": info.token } }).catch(() => null);
  const until = Date.now() + 5000;
  while (Date.now() < until && (await health(info.port))) await new Promise((r) => setTimeout(r, 100));
}

/**
 * This installation's server: the running one when it runs the same code, else a new one — a server
 * started from older code would serve answers the page no longer understands (cli contract, open).
 */
export async function current(config: Config, io: CliIo, start: (c: Config, io: CliIo) => Promise<ServerInfo> = startServer): Promise<ServerInfo> {
  const info = readServerInfo(config.dataDir);
  const build = info ? await healthBuild(info.port) : null;
  if (info && build === BUILD) return info;
  if (info && build !== null) {
    await shutdown(info);
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
  const log = openSync(join(config.dataDir, "server.log"), "a");
  const child = spawn(process.execPath, [start], {
    cwd: APP_ROOT, env: { ...io.env, PORT: String(config.port), ARCHDRAW_DATA_DIR: config.dataDir },
    detached: true, stdio: ["ignore", log, log], windowsHide: true,
  });
  child.unref();
  closeSync(log);
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 200));
    const info = readServerInfo(config.dataDir);
    if (info && info.pid === child.pid && (await health(info.port))) return info;
  }
  throw new Error(`The editor server did not start within 15 s; see ${join(config.dataDir, "server.log")}`);
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
  const { pos, opt } = parse(args, ["view", "format", "theme", "out"]);
  if (pos.length !== 1) throw new Usage("svg needs exactly one file");
  const format = (opt.format ?? "linkedin") as FormatId;
  if (!FORMAT_IDS.includes(format)) throw new Usage(`Unknown format "${format}"; use one of ${FORMAT_IDS.join(", ")}`);
  if (opt.theme && !THEMES.includes(opt.theme as Theme)) throw new Usage(`Unknown theme "${opt.theme}"; use light or dark`);
  const file = resolve(pos[0]);
  const r = checkFile(file, "warn");
  if (!report(io, r) || !r.file) return 1;
  const { doc } = normaliseFile(r.file, { path: file, id: r.file.id ?? "d_unsaved", now: new Date().toISOString(), text: r.text });
  const view = opt.view ?? doc.views[0].id;
  if (!doc.views.some((v) => v.id === view)) { io.err(`No view "${view}" in ${file}; views: ${doc.views.map((v) => v.id).join(", ")}`); return 1; }
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
  if ((raw as { schema?: unknown })?.schema === SCHEMA_ID) { io.out(`already ${SCHEMA_ID}`); return 0; }
  if (!isV1(raw)) { io.out("ERROR schema: not an archdrawer drawing"); return 1; }
  const { doc, warnings } = migrateV1(raw, new Date().toISOString());
  writeAtomic(file, docText(doc));
  for (const w of warnings) io.out(w);
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
  await shutdown(info);
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

