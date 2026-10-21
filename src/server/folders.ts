import { execFile } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SCAN_BUDGET, SKIP_DIRS } from "../core/scan";
import { holdsGit, repoFileChecker } from "./files";

/**
 * A folder typed on the home screen (api contract, *Folders*): its checks, its repository root,
 * whether it is in git, and its listing. `git` runs with an argument array, never a shell
 * (AGENTS.md invariant 1).
 */

export interface Folder { folder: string; root: string; rel: string }

/** The folder checked and resolved, or the sentence the api contract gives for a refusal. */
export function checkFolder(raw: unknown): Folder | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Give the absolute path of a folder" };
  const typed = raw.trim();
  if (!isAbsolute(typed)) return { error: "The path must be absolute" };
  let folder = resolve(typed);
  if (!existsSync(folder)) return { error: `Not found: ${typed}` };
  try { folder = realpathSync(folder); } catch { return { error: `Not found: ${typed}` }; }
  if (!statSync(folder).isDirectory()) return { error: `Not a folder: ${typed}` };
  const root = rootOfFolder(folder);
  return { folder, root, rel: relative(root, folder).split(sep).join("/") };
}

/** The nearest ancestor of the folder, the folder included, that holds `.git`; else the folder. */
export function rootOfFolder(folder: string): string {
  for (let dir = folder; ; dir = dirname(dir)) {
    if (holdsGit(dir)) return dir;
    if (dirname(dir) === dir) return folder;
  }
}

/**
 * The repository being drawn is untrusted: its own config must not make git run a command
 * (`core.fsmonitor`) or write to it. Every call turns those off and never prompts.
 */
export const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-optional-locks"];

/**
 * The server's own variables that would point git at another repository or add config. The user's
 * global config (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) stays, so `safe.directory` still applies.
 */
const GIT_REDIRECTS = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i;

/** The environment git runs with: no redirecting variable, no prompt, no optional lock. */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!GIT_REDIRECTS.test(k)) env[k] = v;
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
}

/** `git <args>` in `cwd`, as an argument array; null when git is missing or fails. */
export function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string | null> {
  return new Promise((done) => {
    execFile("git", [...GIT_SAFE, ...args], { cwd, windowsHide: true, maxBuffer, timeout: 20_000, env: gitEnv() },
      (e, out) => done(e ? null : String(out)));
  });
}

/**
 * `HEAD`'s commit when the root is in git (a repository with a commit), else null. A `.git` that
 * belongs to a repository above the root (a damaged one, or a worktree file) is not the root's.
 */
export async function headCommit(root: string): Promise<string | null> {
  if (!holdsGit(root)) return null;
  const top = (await git(root, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top || !samePlace(top, root)) return null;
  const out = await git(root, ["rev-parse", "HEAD"]);
  const sha = out?.trim() ?? "";
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

const samePlace = (a: string, b: string) => {
  // The native form expands Windows short names (RUNNER~1), which git never prints.
  const real = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
  const x = real(a), y = real(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/**
 * The folder's files, relative to the root, sorted, at most 2000 (`more` counts the rest): from
 * `git ls-files` when in git, else a walk that skips the usual build and dependency folders.
 */
export async function listFolder(f: Folder, inGit: boolean): Promise<{ listing: string[]; more: number }> {
  let all: string[] | null = null;
  if (inGit) {
    const out = await git(f.root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", f.rel || "."]);
    // A listed path that is a symlink, is not a file, or lies in a folder that resolves outside the root
    // (a junction or a symlinked folder, which git may list through) is no input. One lstat per path and
    // one realpath per folder keep a large repository fast; readPart checks a file again before reading.
    const inside = folderInside(f.root);
    if (out !== null) all = out.split("\0").filter(Boolean).map((p) => p.replace(/\\/g, "/")).filter((p) => isPlainFile(join(f.root, p)) && inside(dirname(p)));
  }
  if (!all) all = walk(f.root, f.folder);
  all = [...new Set(all)].sort();
  return { listing: all.slice(0, SCAN_BUDGET.listing), more: Math.max(0, all.length - SCAN_BUDGET.listing) };
}

function walk(root: string, folder: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (out.length > SCAN_BUDGET.listing * 4) return;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(p); }
      else if (e.isFile()) out.push(relative(root, p).split(sep).join("/"));
    }
  };
  visit(folder);
  return out;
}

const isPlainFile = (p: string) => { try { return lstatSync(p).isFile(); } catch { return false; } };

/** Whether a root-relative folder resolves inside the root, symlinks and junctions followed; cached per folder. */
function folderInside(root: string): (rel: string) => boolean {
  const real = (p: string) => { try { return realpathSync.native(p); } catch { return null; } };
  const base = real(root);
  const seen = new Map<string, boolean>();
  return (rel) => {
    if (rel === "." || rel === "") return true;
    let ok = seen.get(rel);
    if (ok === undefined) {
      const r = real(join(root, rel));
      const out = base && r ? relative(base, r) : "..";
      ok = out !== ".." && !out.startsWith(`..${sep}`) && !isAbsolute(out);
      seen.set(rel, ok);
    }
    return ok;
  };
}

/**
 * A root-relative file's text, read no further than `max` characters need, and the length it has.
 * A path that leads out of the root (a symlink) or is not a file reads nothing.
 */
export function readPart(root: string, rel: string, max: number): { text: string; length: number } | null {
  if (!repoFileChecker(root)(rel)) return null;
  const p = join(root, rel);
  try {
    const size = statSync(p);
    if (!size.isFile()) return null;
    const want = Math.min(size.size, max * 4);
    const buf = Buffer.alloc(want);
    const fd = openSync(p, "r");
    let got = 0;
    try { got = readSync(fd, buf, 0, want, 0); } finally { closeSync(fd); }
    const text = buf.subarray(0, got).toString("utf8");
    // The characters beyond what was read are estimated from the bytes left.
    const length = size.size > got ? text.length + (size.size - got) : text.length;
    return { text: text.slice(0, max * 2), length };
  } catch { return null; }
}
