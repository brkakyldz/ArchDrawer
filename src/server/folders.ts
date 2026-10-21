import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SCAN_BUDGET, SKIP_DIRS } from "../core/scan";

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

/** `git <args>` in `cwd`, as an argument array; null when git is missing or fails. */
export function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string | null> {
  return new Promise((done) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer, timeout: 20_000 }, (e, out) => done(e ? null : String(out)));
  });
}

/** `HEAD`'s commit when the root is in git (a repository with a commit), else null. */
export async function headCommit(root: string): Promise<string | null> {
  if (!existsSync(join(root, ".git"))) return null;
  const out = await git(root, ["rev-parse", "HEAD"]);
  const sha = out?.trim() ?? "";
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

/**
 * The folder's files, relative to the root, sorted, at most 2000 (`more` counts the rest): from
 * `git ls-files` when in git, else a walk that skips the usual build and dependency folders.
 */
export async function listFolder(f: Folder, inGit: boolean): Promise<{ listing: string[]; more: number }> {
  let all: string[] | null = null;
  if (inGit) {
    const out = await git(f.root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", f.rel || "."]);
    if (out !== null) all = out.split("\0").filter(Boolean).map((p) => p.replace(/\\/g, "/")).filter((p) => existsSync(join(f.root, p)));
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

/** A root-relative file's text, at most `max` characters (with the length it had). */
export function readPart(root: string, rel: string, max: number): string | null {
  try {
    const t = readFileSync(join(root, rel), "utf8");
    return t.length > max * 2 ? t.slice(0, max * 2) : t;
  } catch { return null; }
}
