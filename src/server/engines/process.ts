import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Command { file: string; prefix: string[] }

/**
 * Find an executable on PATH and turn it into something spawnable without a shell.
 * Windows npm installs produce `.cmd` shims, which Node refuses to spawn without
 * `shell: true` (CVE-2024-27980); we read the shim and run its JS entry with node instead,
 * so user text never passes through cmd.exe (AGENTS.md invariant 1).
 */
export async function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env, timeoutMs = 15_000): Promise<Command | null> {
  const override = env[`ARCHDRAW_${name.toUpperCase()}_BIN`];
  const candidates: string[] = [];
  if (override) candidates.push(override);
  else if (process.platform === "win32") {
    const r = await capture({ file: "where", prefix: [] }, [name], timeoutMs, process.env);
    if (r.code === 0) candidates.push(...r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } else {
    const r = await capture({ file: "sh", prefix: [] }, ["-c", 'command -v "$1"', "sh", name], timeoutMs, process.env);
    if (r.code === 0 && r.stdout.trim()) candidates.push(r.stdout.trim());
  }
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (/\.(js|mjs|cjs)$/i.test(c)) return { file: process.execPath, prefix: [c] };
    if (/\.(cmd|bat)$/i.test(c)) {
      const js = shimTarget(c);
      if (js) return { file: process.execPath, prefix: [js] };
      continue;
    }
    if (process.platform === "win32" && !/\.(exe|com)$/i.test(c)) continue; // extensionless sh shims next to .cmd
    return { file: c, prefix: [] };
  }
  return null;
}

/** The JS entry an npm `.cmd` shim runs, e.g. "%dp0%\node_modules\@openai\codex\bin\codex.js". */
export function shimTarget(cmdPath: string): string | null {
  let text: string;
  try { text = readFileSync(cmdPath, "utf8"); } catch { return null; }
  const m = /"%~?dp0%?\\?([^"%]+?\.(?:js|mjs|cjs))"/i.exec(text);
  if (!m) return null;
  // The shim writes Windows separators; split them so the path also resolves where "\" is not one.
  const target = join(dirname(cmdPath), ...m[1].split(/[\\/]/));
  return existsSync(target) ? target : null;
}

/** Kill a process and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

/**
 * The environment an engine is spawned with: the server's, minus what a launching Claude Code
 * session put there (`CLAUDECODE`, `CLAUDE_CODE_*`, and the `ANTHROPIC_BASE_URL` it set), so
 * the CLI uses the user's own login rather than a desktop session that may have ended.
 * Nothing is added; no credential is read.
 */
export function engineEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const hosted = Object.keys(env).some((k) => k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_"));
  for (const [k, v] of Object.entries(env)) {
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
    if (hosted && k === "ANTHROPIC_BASE_URL") continue;
    out[k] = v;
  }
  return out;
}

export interface RunProcessOptions {
  cwd: string;
  stdin?: string;
  signal: AbortSignal;
  timeoutMs: number;
  onLine: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult { code: number | null; stderr: string; timedOut: boolean; aborted: boolean }

/** Spawn without a shell, stream stdout line by line, kill the whole tree on abort or timeout. */
export function runProcess(cmd: Command, args: string[], opts: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.file, [...cmd.prefix, ...args], {
      cwd: opts.cwd,
      env: opts.env ?? engineEnv(),
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const flush = (final: boolean) => {
      const parts = buf.split(/\r?\n/);
      buf = final ? "" : parts.pop() ?? "";
      for (const p of parts) if (p.trim()) opts.onLine(p);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { buf += d; flush(false); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { stderr = (stderr + d).slice(-20_000); });
    const stop = () => { aborted = true; killTree(child); };
    if (opts.signal.aborted) stop();
    opts.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, opts.timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); opts.signal.removeEventListener("abort", stop); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", stop);
      if (buf) { buf += "\n"; flush(true); }
      resolve({ code, stderr, timedOut, aborted });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin ?? "");
  });
}

/**
 * A short command's exit code and output, spawned without a shell and without blocking the server:
 * every other request and event stream goes on while an engine is detected. After `timeoutMs` the
 * process tree is killed and the code is null.
 */
function capture(cmd: Command, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = engineEnv()): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd.file, [...cmd.prefix, ...args], { env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    } catch { done({ code: null, stdout: "", stderr: "" }); return; }
    let stdout = "", stderr = "", timedOut = false;
    child.stdout!.setEncoding("utf8").on("data", (d: string) => { stdout = (stdout + d).slice(-1_000_000); });
    child.stderr!.setEncoding("utf8").on("data", (d: string) => { stderr = (stderr + d).slice(-100_000); });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); done({ code: null, stdout, stderr }); });
    child.on("close", (code) => { clearTimeout(timer); done({ code: timedOut ? null : code, stdout, stderr }); });
  });
}

export async function versionOf(cmd: Command, timeoutMs = 15_000): Promise<string | null> {
  const r = await capture(cmd, ["--version"], timeoutMs);
  if (r.code !== 0) return null;
  const m = /(\d+\.\d+\.\d+[^\s]*)/.exec(r.stdout);
  return m ? m[1] : r.stdout.trim().split(/\r?\n/)[0] || null;
}

export async function helpText(cmd: Command, args: string[], timeoutMs = 15_000): Promise<string> {
  const r = await capture(cmd, args, timeoutMs);
  return `${r.stdout}\n${r.stderr}`;
}

/** Standard output of a short command, or "" when it fails (model lists). */
export async function outputOf(cmd: Command, args: string[], timeoutMs = 15_000): Promise<string> {
  const r = await capture(cmd, args, timeoutMs);
  return r.code === 0 ? r.stdout : "";
}
