import { execFile } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SCAN_BUDGET, SKIP_DIRS } from "../core/scan";
import { repoFileChecker } from "./files";

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
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return folder;
  }
}

/**
 * The repository being drawn is untrusted: its own config must not make git run a command
 * (`core.fsmonitor`) or write to it. Every call turns those off and never prompts.
 */
export const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-optional-locks"];

/**
 * The environment git runs with: none of the server's own `GIT_*` variables, which could point it at
 * another repository (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, …) or add config.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
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
  if (!existsSync(join(root, ".git"))) return null;
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
    // A listed path that is a symlink, or not a file, is no input (it could quote a file outside the
    // root). One lstat per path: git lists no path through a symlinked folder, and readPart checks again.
    if (out !== null) all = out.split("\0").filter(Boolean).map((p) => p.replace(/\\/g, "/")).filter((p) => isPlainFile(join(f.root, p)));
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
