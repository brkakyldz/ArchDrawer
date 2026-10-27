import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SKIP_DIRS } from "../core/scan";
import { holdsGit, writeAtomic } from "./files";
import { git, rootOfFolder } from "./folders";
import type { DiagramSummary } from "./store";

/**
 * *Recent* and *Found on this computer* (api contract, *Recent and found*; SRC-1, SRC-2,
 * ADR 0017): the folders used before, kept in `sources.json`, joined with the repositories of
 * the registered drawings; and the git repositories found below the home folder, its usual
 * code folders and the parent of each drawing's repository, walked at most every five minutes.
 */

export interface SourceEntry {
  name: string;
  path: string;
  branch: string | null;
  lastCommitAt: string | null;
  link: string | null;
  diagrams: string[];
  usedAt: string | null;
}

export interface SourcesAnswer { picker: boolean; recent: SourceEntry[]; found: SourceEntry[]; foundAt: string }

export const RECENT_MAX = 20;
export const FOUND_MAX = 50;
export const FOUND_KEEP_MS = 5 * 60_000;
export const WALK_MAX_FOLDERS = 5000;
export const WALK_MAX_MS = 10_000;
/** The usual code folders under the home folder that are search roots too. */
export const CODE_FOLDERS = ["code", "src", "projects", "repos", "dev", join("Documents", "GitHub")];
/** Folders never searched, besides hidden ones and the ones a scan skips. */
const SKIPPED = ["AppData", "Library", "Applications"];
/** The hosts a copy can come from (api contract, *Reading a link*). */
const LINK_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

const caseless = process.platform === "win32" || process.platform === "darwin";
const keyOf = (p: string) => (caseless ? p.toLowerCase() : p);
const samePath = (a: string, b: string) => keyOf(resolve(a)) === keyOf(resolve(b));
/** Whether `p` is `dir` or lies below it. */
export function within(dir: string, p: string): boolean {
  const r = relative(keyOf(resolve(dir)), keyOf(resolve(p)));
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}
/** A path as `POST /api/folders/check` resolves it: symlinks followed, the disk's own letter case. */
const real = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
const isFolder = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/**
 * The copy a path lies in (api contract, *The copy*): `<data>/repos/<host>/<owner>/<repo>` and its
 * link `<host>/<owner>/<repo>`, lower-cased; null for a path in no copy.
 */
export function copyOf(dataDir: string, path: string): { link: string; dir: string } | null {
  // As the disk names it, like the checked folders: a data folder given by its 8.3 short name still matches.
  const repos = real(join(resolve(dataDir), "repos"));
  if (!within(repos, path)) return null;
  const parts = relative(keyOf(repos), keyOf(resolve(path))).split(sep).filter(Boolean);
  if (parts.length < 3 || !LINK_HOSTS.has(parts[0].toLowerCase())) return null;
  const [host, owner, repo] = parts.slice(0, 3).map((s) => s.toLowerCase());
  return { link: `${host}/${owner}/${repo}`, dir: join(repos, host, owner, repo) };
}

/** HEAD's branch and committer date, read in the folder's repository root; both null when it is not in git (*Folders*). */
export async function repoInfo(folder: string): Promise<{ branch: string | null; lastCommitAt: string | null }> {
  const none = { branch: null, lastCommitAt: null };
  const root = rootOfFolder(folder);
  if (!holdsGit(root)) return none;
  // One call for the root check and HEAD's name; it fails on a repository without a commit.
  const out = await git(root, ["rev-parse", "--show-toplevel", "--symbolic-full-name", "HEAD"]);
  const [top, ref] = (out ?? "").split(/\r?\n/);
  if (!top || !samePath(real(top), real(root))) return none;
  const date = (await git(root, ["log", "-1", "--format=%cI"]))?.trim() || null;
  if (!date) return none;
  return { branch: ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null, lastCommitAt: date };
}

/** Run `fn` over `items`, `limit` at a time, keeping their order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export interface FoundRepo { path: string; branch: string | null; lastCommitAt: string | null }

export interface WalkOptions { dataDir: string; maxFolders?: number; maxMs?: number }

/**
 * The git repositories one or two levels below each search root (api contract, *Found on this
 * computer*): the root itself never counts, a repository's own folders are not searched, and
 * hidden, skipped and linked folders and the data folder are left out. Newest commit first, no
 * commit last, ties by path.
 */
export async function walkFound(roots: string[], opts: WalkOptions): Promise<FoundRepo[]> {
  const started = Date.now();
  const maxFolders = opts.maxFolders ?? WALK_MAX_FOLDERS, maxMs = opts.maxMs ?? WALK_MAX_MS;
  const data = real(opts.dataDir);
  const skipped = new Set([...SKIP_DIRS, ...SKIPPED].map(keyOf));
  const found = new Map<string, string>();
  const walked = new Set<string>();
  let looked = 0;
  const spent = () => looked >= maxFolders || Date.now() - started > maxMs;

  const visit = async (dir: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (spent()) return;
      // A symlink or a junction is no directory entry here: neither is followed.
      if (!e.isDirectory() || e.name.startsWith(".") || skipped.has(keyOf(e.name))) continue;
      const p = join(dir, e.name);
      if (within(data, p)) continue;
      looked++;
      if (holdsGit(p)) { if (!found.has(keyOf(p))) found.set(keyOf(p), p); continue; }
      if (depth < 2) await visit(p, depth + 1);
    }
  };
  for (const raw of roots) {
    if (spent()) break;
    if (!isFolder(raw)) continue;
    const root = real(raw);
    if (walked.has(keyOf(root)) || within(data, root)) continue;
    walked.add(keyOf(root));
    await visit(root, 1);
  }
  const repos = await pool([...found.values()], 8, async (p) => ({ path: p, ...(await repoInfo(p)) }));
  return repos.sort((a, b) => {
    if (a.lastCommitAt && b.lastCommitAt) {
      const d = Date.parse(b.lastCommitAt) - Date.parse(a.lastCommitAt);
      if (d) return d;
    } else if (a.lastCommitAt || b.lastCommitAt) return a.lastCommitAt ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** What `Sources` reads of the library. */
export interface Library { list(): DiagramSummary[] }

export interface SourcesOptions {
  dataDir: string;
  library: Library;
  /** The home folder Found searches (`ARCHDRAW_SEARCH_HOME`, else the user's). */
  searchHome: string;
  /**
   * Whether a copy is in use (api contract, *In use*): a scan of a folder in it running, or a run
   * of any kind with its drawing file or repository root in it. Until one is given, every copy is
   * taken as in use, so `deleteCopy` refuses rather than delete a copy under a running job.
   */
  copyInUse?: (copyDir: string) => boolean;
}

export type ForgetAnswer = { status: 200; body: { ok: true; deleted: boolean } } | { status: 400 | 404 | 409 | 500; body: { error: string } };

interface Stored { path: string; usedAt: string }

export class Sources {
  private foundList: { at: number; foundAt: string; repos: FoundRepo[] } | null = null;
  private walking: Promise<{ at: number; foundAt: string; repos: FoundRepo[] }> | null = null;

  constructor(private readonly opts: SourcesOptions) {}

  private get file() { return join(this.opts.dataDir, "sources.json"); }

  /** The folders used before, as `sources.json` holds them; an unreadable file counts as empty. */
  private stored(): Stored[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { recent?: unknown };
      if (!Array.isArray(raw.recent)) return [];
      return raw.recent.filter((e): e is Stored => !!e && typeof e === "object" && typeof (e as Stored).path === "string"
        && typeof (e as Stored).usedAt === "string" && !Number.isNaN(Date.parse((e as Stored).usedAt)));
    } catch { return []; }
  }

  /** Write the list, without the folders that no longer exist. */
  private save(list: Stored[]): void {
    mkdirSync(this.opts.dataDir, { recursive: true });
    const recent = list.filter((e) => isFolder(e.path));
    writeAtomic(this.file, JSON.stringify({ recent }, null, 2) + "\n");
  }

  /**
   * A folder was used (a scan of it succeeded, a cached one too, or a drawing file in it was
   * registered): it goes to the top of Recent with a new `usedAt`.
   */
  use(folder: string, at = new Date()): void {
    const path = real(folder);
    const rest = this.stored().filter((e) => !samePath(e.path, path));
    // Never earlier than what is already there, so two uses in one millisecond still order.
    const newest = Math.max(at.getTime(), ...rest.map((e) => Date.parse(e.usedAt) + 1));
    // The list is a convenience: a folder it cannot write fails neither the scan nor the registration.
    try { this.save([{ path, usedAt: new Date(newest).toISOString() }, ...rest]); } catch (e) { console.error("Could not write the recent folders:", e); }
  }

  /** The registered drawings, each with its repository root as `POST /api/folders/check` resolves it. */
  private drawings(): (DiagramSummary & { file: string; rootReal: string })[] {
    return this.opts.library.list().filter((d) => d.path && d.root)
      .map((d) => ({ ...d, file: d.path!, rootReal: real(d.root!) }));
  }

  private entry(path: string, usedAt: string | null, info: { branch: string | null; lastCommitAt: string | null }, drawings: { id: string; file: string }[]): SourceEntry {
    return {
      name: basename(path) || path,
      path,
      branch: info.branch,
      lastCommitAt: info.lastCommitAt,
      link: copyOf(this.opts.dataDir, path)?.link ?? null,
      // The library's list is newest updatedAt first already.
      diagrams: drawings.filter((d) => within(path, d.file)).map((d) => d.id),
      usedAt,
    };
  }

  /** Recent (SRC-1): made on every request, newest first, at most 20, a folder that is gone left out. */
  async recent(): Promise<SourceEntry[]> {
    const drawings = this.drawings();
    const byKey = new Map<string, { path: string; at: number }>();
    const add = (path: string, at: number) => {
      const k = keyOf(path), had = byKey.get(k);
      if (!had || at > had.at) byKey.set(k, { path: had?.path ?? path, at });
    };
    for (const e of this.stored()) add(e.path, Date.parse(e.usedAt));
    for (const d of drawings) add(d.rootReal, Date.parse(d.updatedAt) || 0);
    const list = [...byKey.values()].filter((e) => isFolder(e.path))
      .sort((a, b) => b.at - a.at || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, RECENT_MAX);
    const infos = await pool(list, 8, (e) => repoInfo(e.path));
    return list.map((e, i) => this.entry(e.path, new Date(e.at).toISOString(), infos[i], drawings));
  }

  /** The search roots (api contract, *Found on this computer*). */
  roots(): string[] {
    const home = this.opts.searchHome;
    const parents = this.drawings().map((d) => resolve(d.rootReal, ".."));
    return [home, ...CODE_FOLDERS.map((f) => join(home, f)), ...parents];
  }

  /** The found list: kept five minutes, walked again at once with `refresh`; concurrent requests share one walk. */
  private async foundRepos(refresh: boolean): Promise<{ foundAt: string; repos: FoundRepo[] }> {
    if (!refresh && this.foundList && Date.now() - this.foundList.at < FOUND_KEEP_MS) return this.foundList;
    if (this.walking && !refresh) return this.walking;
    const previous = this.walking;
    const walk = (async () => {
      if (previous) await previous.catch(() => null);
      const repos = await walkFound(this.roots(), { dataDir: this.opts.dataDir });
      const now = Date.now();
      return { at: now, foundAt: new Date(now).toISOString(), repos };
    })();
    this.walking = walk;
    try {
      const made = await walk;
      if (!this.foundList || made.at >= this.foundList.at) this.foundList = made;
      return made;
    } finally {
      if (this.walking === walk) this.walking = null;
    }
  }

  /** The answer of `GET /api/sources` (or of `POST /api/sources/refresh` with `refresh`). */
  async answer(picker: boolean, refresh = false): Promise<SourcesAnswer> {
    const [recent, made] = await Promise.all([this.recent(), this.foundRepos(refresh)]);
    const drawings = this.drawings();
    const inRecent = new Set(recent.map((e) => keyOf(e.path)));
    const found = made.repos.filter((r) => !inRecent.has(keyOf(r.path))).slice(0, FOUND_MAX)
      .map((r) => this.entry(r.path, null, r, drawings));
    return { picker, recent, found, foundAt: made.foundAt };
  }

  /** `POST /api/sources/forget` (api contract, *Forgetting an entry*): every check before anything changes. */
  async forget(body: unknown): Promise<ForgetAnswer> {
    const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (typeof b.path !== "string") return { status: 400, body: { error: "Give the path of a recent folder" } };
    if (b.deleteCopy !== undefined && typeof b.deleteCopy !== "boolean") return { status: 400, body: { error: "deleteCopy must be true or false" } };
    const asked = b.path;
    const entry = (await this.recent()).find((e) => isAbsolute(asked) && samePath(e.path, asked));
    if (!entry) return { status: 404, body: { error: "Not in the recent list" } };
    if (entry.diagrams.length) return { status: 409, body: { error: "Remove its drawings from the list first" } };
    let copy: { link: string; dir: string } | null = null;
    if (b.deleteCopy === true) {
      copy = copyOf(this.opts.dataDir, entry.path);
      if (!copy) return { status: 400, body: { error: "Only a copy made from a link can be deleted" } };
      const dir = copy.dir;
      if (this.drawings().some((d) => within(dir, d.file))) return { status: 409, body: { error: "Other drawings in the list are in this copy" } };
      if (this.opts.copyInUse?.(dir) ?? true) return { status: 409, body: { error: "This repository is in use: try again when its scans and instructions have ended" } };
    }
    // Deleting a copy takes every entry in it out of the list; otherwise only this one.
    const gone = (p: string) => (copy ? within(copy.dir, p) : samePath(p, entry.path));
    this.save(this.stored().filter((e) => !gone(e.path)));
    if (!copy) return { status: 200, body: { ok: true, deleted: false } };
    const removed = await removeCopy(copy.dir);
    return removed === null ? { status: 200, body: { ok: true, deleted: true } } : { status: 500, body: { error: `Could not delete the copy at ${copy.dir}: ${removed}` } };
  }
}

/**
 * Remove a copy's folder with everything in it (api contract, *Deleting a copy*): read-only files
 * too, a link inside removed as a link and never followed, a busy file on Windows retried for up
 * to 5 s. A folder already gone counts as removed. Null when it is gone, else the reason.
 */
export async function removeCopy(dir: string): Promise<string | null> {
  try {
    // Node waits 100 ms longer on each retry: nine retries come to 4.5 s.
    await rm(dir, { recursive: true, force: true, maxRetries: 9, retryDelay: 100 });
  } catch (e) {
    return (e as Error).message;
  }
  return existsSync(dir) ? "the folder is still there" : null;
}
