import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { killTree } from "./engines/process";
import { isRunning } from "./engines/revise";
import { git, GIT_SAFE, gitEnv, headCommit } from "./folders";

/**
 * A repository from a link (api contract, *A repository from a link*; ADR 0017): the link read and
 * checked before git runs, its copy in `<data>/repos/<host>/<owner>/<repo>`, made with one commit and
 * updated by fetch. The link reaches git only as the URL rebuilt from its checked parts, after `--`
 * (AGENTS.md invariant 1). With `ARCHDRAW_TEST_REMOTES` set the URL is a `file://` one into that
 * folder and only the `file` transport is allowed (testing contract, *Test links*).
 */

export interface Link {
  /** `<host>/<owner>/<repo>`, lower-cased: what `link` fields and messages show. */
  link: string;
  host: string; owner: string; repo: string;
  /** The branch the link names, or null. */
  branch: string | null;
  /** `https://<link>.git`: the only form of the link that reaches git (a test link's is rebuilt by `Remotes`). */
  url: string;
}

export const HOSTS = ["github.com", "gitlab.com", "bitbucket.org"] as const;

const GIVE = "Give the link of a repository";
const NOT_A_LINK = "Not a repository link";
const CREDENTIALS = "Leave the user name and password out of the link";
const ONLY_HOSTS = "Only github.com, gitlab.com and bitbucket.org links can be drawn";
export const NEEDS_GIT = "Drawing from a link needs git: install git and try again";

/** The host's branch part after `<owner>/<repo>` (api contract, *Reading a link*). */
const BRANCH_PART: Record<string, string[]> = { "github.com": ["tree"], "gitlab.com": ["-", "tree"], "bitbucket.org": ["src"] };

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const okName = (s: string) => NAME.test(s) && !/^[-.]/.test(s) && !s.endsWith(".") && !DEVICE.test(s);

/** The branch rule: 1–200 of `A–Z a–z 0–9 . _ / -`, a letter, digit or `_` first, no `..` or `//`, no trailing `/`, `.` or `.lock`. */
export function okBranch(b: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._\/-]{0,199}$/.test(b) && !b.includes("..") && !b.includes("//") && !/(\/|\.|\.lock)$/.test(b);
}

/** A link read as the api contract says (checks 1–5; check 6, git on PATH, is `Remotes.gitMissing`). Pure. */
export function readLink(raw: unknown): Link | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: GIVE };
  let rest = raw.trim();
  if (rest.length > 300) return { error: NOT_A_LINK };
  // A scheme other than https (http, ssh, git, file, ext::, …) is no link; neither is `git@host:path`.
  if (/^https:\/\//i.test(rest)) rest = rest.slice(8);
  else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rest) || /^[^/]*@[^/]*:/.test(rest)) return { error: NOT_A_LINK };
  rest = rest.replace(/[?#].*$/s, "");
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  let path = slash < 0 ? "" : rest.slice(slash + 1);
  const at = authority.lastIndexOf("@");
  const hostPart = at < 0 ? authority : authority.slice(at + 1);
  if (hostPart.includes(":")) return { error: NOT_A_LINK };
  if (at >= 0) return { error: CREDENTIALS };
  const host = hostPart.toLowerCase().replace(/^www\./, "");
  if (!(HOSTS as readonly string[]).includes(host)) return { error: ONLY_HOSTS };
  if (path.endsWith("/")) path = path.slice(0, -1);
  const segs = path.split("/");
  if (segs.length < 2) return { error: NOT_A_LINK };
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/i, "");
  if (!okName(owner) || !okName(repo)) return { error: NOT_A_LINK };
  let branch: string | null = null;
  if (segs.length > 2) {
    const part = BRANCH_PART[host];
    const rest2 = segs.slice(2);
    if (rest2.length <= part.length || part.some((p, i) => rest2[i] !== p)) return { error: NOT_A_LINK };
    branch = rest2.slice(part.length).join("/");
    if (!okBranch(branch)) return { error: NOT_A_LINK };
  }
  const link = `${host}/${owner}/${repo}`.toLowerCase();
  return { link, host, owner: owner.toLowerCase(), repo: repo.toLowerCase(), branch, url: `https://${link}.git` };
}

const win = process.platform === "win32";
const sameCase = (s: string) => (win || process.platform === "darwin" ? s.toLowerCase() : s);
const real = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } };

/** `<data>/repos`, as the disk names it (the folder checks resolve folders the same way). */
export const reposDir = (dataDir: string) => real(join(dataDir, "repos"));

/** The copy folder a path lies in (the copy's own folder or one below it), else null. */
export function copyOfPath(dataDir: string, path: string): string | null {
  const base = reposDir(dataDir);
  const rel = relative(sameCase(base), sameCase(resolve(path)));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const segs = rel.split(sep);
  if (segs.length < 3 || !(HOSTS as readonly string[]).includes(segs[0]) || !okName(segs[1]) || !okName(segs[2])) return null;
  return join(base, segs[0], segs[1], segs[2]);
}

/** The link of the copy a path lies in, `github.com/owner/repo`; else null. */
export function linkOfPath(dataDir: string, path: string): string | null {
  const copy = copyOfPath(dataDir, path);
  return copy ? relative(reposDir(dataDir), copy).split(sep).join("/").toLowerCase() : null;
}

/** Whether `path` is `dir` or lies below it (case-insensitive where the disk is). */
export function isInside(dir: string, path: string): boolean {
  const rel = relative(sameCase(resolve(dir)), sameCase(resolve(path)));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** A sentence a scan fails with when its copy cannot be made or switched (api contract, *When git fails*). */
export class RemoteError extends Error {}

/** git's error output read into the contract's sentence. */
export function gitFailure(stderr: string, l: Link, branch: string | null): string {
  if (/transport '[^']*' not allowed/i.test(stderr)) return `Your git settings send ${l.host} links over another transport than https: archdrawer copies over https only`;
  if (/Remote branch .* not found|couldn't find remote ref/i.test(stderr)) return `The branch "${branch ?? ""}" does not exist in ${l.link}`;
  if (/Could not resolve host|Failed to connect|Connection timed out|Connection refused|Network is unreachable/i.test(stderr)) return `Could not reach ${l.host}`;
  if (/Repository not found|not found|Authentication failed|could not read Username|terminal prompts disabled|403/i.test(stderr)) return "This repository is private or does not exist";
  return `Could not copy ${l.link}: ${lastLine(stderr)}`;
}

const lastLine = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).at(-1) ?? "git failed";
const short = (c: string) => c.slice(0, 7);

/** What a test link answers without starting git (testing contract, *Test links*). */
const REACH = (l: Link) => `Could not reach ${l.host}`;
const PRIVATE = "This repository is private or does not exist";

export interface PrepareContext {
  signal: AbortSignal;
  progress: (message: string) => void;
  /** Whether a run (running or waiting) has its drawing file or repository root in the copy (*In use*). */
  inUse: () => boolean;
  /** The registered drawings whose file lies in the copy: an update never replaces one. */
  drawings: () => string[];
}

/** A git call's outcome: its exit code (null when it could not start) and its output. */
interface Ran { code: number | null; stdout: string; stderr: string }

export class Remotes {
  /** `ARCHDRAW_TEST_REMOTES`: links are copied from the local repositories in it. */
  readonly testRemotes: string | null;
  private gitSeen: { ok: boolean; at: number } | null = null;

  constructor(readonly dataDir: string, testRemotes: string | null = null) {
    this.testRemotes = testRemotes ? resolve(testRemotes) : null;
    try { mkdirSync(join(dataDir, "repos", ".partial"), { recursive: true }); } catch { /* reported when a copy is made */ }
  }

  /** The copy's folder, rebuilt from the link: `<data>/repos/<host>/<owner>/<repo>`. */
  copyDir(l: Link | string): string {
    const link = typeof l === "string" ? l : l.link;
    return join(reposDir(this.dataDir), ...link.toLowerCase().split("/"));
  }

  private partialRoot() { return join(reposDir(this.dataDir), ".partial"); }

  /** Check 6 of *Reading a link*: no git on PATH. Remembered for a minute. */
  async gitMissing(): Promise<boolean> {
    if (this.gitSeen && Date.now() - this.gitSeen.at < 60_000) return !this.gitSeen.ok;
    const ok = await new Promise<boolean>((done) => execFile("git", ["--version"], { windowsHide: true, timeout: 15_000 }, (e) => done(!e)));
    this.gitSeen = { ok, at: Date.now() };
    return !ok;
  }

  /** The `<safe options>` of *Git for a link*; a test link allows `file` instead of `https`. */
  safeOptions(): string[] {
    return [
      ...GIT_SAFE,
      "-c", "protocol.allow=never", "-c", this.testRemotes ? "protocol.file.allow=always" : "protocol.https.allow=always",
      "-c", "core.symlinks=false", "-c", "core.askPass=",
      ...(win ? ["-c", "core.longpaths=true"] : []),
    ];
  }

  /** The URL git gets: the rebuilt `https` one, or a test link's `file://` one. */
  urlOf(l: Link): string {
    return this.testRemotes ? pathToFileURL(join(this.testRemotes, l.host, l.owner, l.repo)).href : l.url;
  }

  /** The environment of *Git for a link*: no redirecting variable, no prompt or sign-in window of any kind. */
  static env(): NodeJS.ProcessEnv {
    const env = gitEnv();
    for (const k of Object.keys(env)) if (/^(GIT_ASKPASS|SSH_ASKPASS|GIT_ALLOW_PROTOCOL|GIT_SSH|GIT_SSH_COMMAND|GIT_PROXY_COMMAND|GIT_EXEC_PATH)$/i.test(k)) delete env[k];
    return { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_LFS_SKIP_SMUDGE: "1", LC_ALL: "C" };
  }

  /** The four calls of *Git for a link*, as argument arrays (exported for the tests that check them exactly). */
  args = {
    clone: (l: Link, branch: string | null, partial: string) =>
      [...this.safeOptions(), "clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet", ...(branch ? ["--branch", branch] : []), "--", this.urlOf(l), partial],
    defaultBranch: (l: Link) => [...this.safeOptions(), "ls-remote", "--symref", "--", this.urlOf(l), "HEAD"],
    fetch: (l: Link, branch: string) => [...this.safeOptions(), "fetch", "--depth", "1", "--no-tags", "--quiet", "--", this.urlOf(l), `refs/heads/${branch}`],
    checkout: (branch: string) => [...this.safeOptions(), "checkout", "--quiet", "-B", branch, "FETCH_HEAD"],
  };

  /** Runs git without a shell; abort kills its process tree. Replaceable in tests. */
  run = (args: string[], cwd: string, signal: AbortSignal): Promise<Ran> => new Promise((done) => {
    if (signal.aborted) return done({ code: null, stdout: "", stderr: "Cancelled" });
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", args, { cwd, env: Remotes.env(), windowsHide: true, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { return done({ code: null, stdout: "", stderr: (e as Error).message }); }
    let stdout = "", stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (d: string) => { stdout = (stdout + d).slice(-1_000_000); });
    child.stderr!.setEncoding("utf8").on("data", (d: string) => { stderr = (stderr + d).slice(-100_000); });
    const stop = () => killTree(child);
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", (e) => { signal.removeEventListener("abort", stop); done({ code: null, stdout, stderr: stderr || e.message }); });
    child.on("close", (code) => { signal.removeEventListener("abort", stop); done({ code, stdout, stderr }); });
  });

  /**
   * Before git starts for a test link: a host folder that is missing cannot be reached, a folder that
   * is no repository with a commit does not exist, and a `.slow` file beside it waits 30 s (abortable).
   * Null when git may start; else the sentence. A real link always starts git.
   */
  private async testGate(l: Link, signal: AbortSignal): Promise<string | null> {
    if (!this.testRemotes) return null;
    if (!existsSync(join(this.testRemotes, l.host))) return REACH(l);
    const dir = join(this.testRemotes, l.host, l.owner, l.repo);
    if (existsSync(`${dir}.slow`)) await abortableSleep(30_000, signal);
    if (signal.aborted) throw new RemoteError("Cancelled");
    if (!existsSync(join(this.testRemotes, l.host))) return REACH(l);
    return hasCommit(dir) ? null : PRIVATE;
  }

  /** A network call (clone, default branch, fetch): its outcome, or the sentence a test link gives instead. */
  private async network(l: Link, args: string[], cwd: string, signal: AbortSignal): Promise<Ran | string> {
    const refused = await this.testGate(l, signal);
    if (refused) return refused;
    return this.run(args, cwd, signal);
  }

  /** The default branch the host names (`ls-remote --symref … HEAD`), or the sentence of why it is unknown. */
  private async defaultBranch(l: Link, cwd: string, signal: AbortSignal): Promise<{ branch: string } | { error: string }> {
    const r = await this.network(l, this.args.defaultBranch(l), cwd, signal);
    if (signal.aborted) throw new RemoteError("Cancelled");
    if (typeof r === "string") return { error: r };
    if (r.code !== 0) return { error: gitFailure(r.stderr, l, null) };
    const m = /^ref: refs\/heads\/(\S+)\s+HEAD\s*$/m.exec(r.stdout);
    if (!m) return { error: PRIVATE };
    if (!okBranch(m[1])) throw new RemoteError(`Could not copy ${l.link}: its default branch "${m[1]}" has a name archdrawer does not take`);
    return { branch: m[1] };
  }

  /**
   * Make or update the copy (api contract, *A scan with a link*): the steps and lines of the contract.
   * `branch` is what the scan follows: a link's branch (null: the default branch), or `"own"` for a
   * folder in the copy given by its path. Throws `RemoteError` with the scan's error; resolves when
   * the scan may go on with the copy.
   */
  async prepare(l: Link, follow: { branch: string | null } | "own", ctx: PrepareContext): Promise<void> {
    const copy = this.copyDir(l);
    const exists = existsSync(copy);
    const intact = exists && (await headCommit(copy)) !== null;
    if (exists && !intact && (ctx.drawings().length > 0 || ctx.inUse())) {
      throw new RemoteError(`The copy of ${l.link} is damaged: remove its drawings from the list and try again`);
    }
    if (!intact) return this.clone(l, follow === "own" ? null : follow.branch, ctx);
    return this.update(l, copy, follow, ctx);
  }

  /** Step 1 (and 2): a clone into `.partial`, renamed into place once git succeeds; nothing is left otherwise. */
  private async clone(l: Link, branch: string | null, ctx: PrepareContext): Promise<void> {
    ctx.progress(`Copying ${l.link}`);
    const root = this.partialRoot();
    mkdirSync(root, { recursive: true });
    const partial = join(root, `${process.pid}-${randomBytes(6).toString("hex")}`);
    try {
      const r = await this.network(l, this.args.clone(l, branch, partial), root, ctx.signal);
      if (ctx.signal.aborted) throw new RemoteError("Cancelled");
      if (typeof r === "string") throw new RemoteError(r);
      if (r.code !== 0) throw new RemoteError(gitFailure(r.stderr, l, branch));
      const copy = this.copyDir(l);
      // A damaged copy (not in git, no drawing in it, not in use) is replaced.
      if (existsSync(copy)) removeTree(copy);
      mkdirSync(dirname(copy), { recursive: true });
      await renameWithRetry(partial, copy);
    } catch (e) {
      removeTree(partial);
      this.pruneEmpty(l);
      throw e;
    }
  }

  /** Step 3: fetch the wanted branch's newest commit, switch to it or update, and never replace a drawing. */
  private async update(l: Link, copy: string, follow: { branch: string | null } | "own", ctx: PrepareContext): Promise<void> {
    const { signal, progress } = ctx;
    progress(`Fetching the newest commit of ${l.link}`);
    const head = (await headCommit(copy))!;
    const own = (await git(copy, ["symbolic-ref", "--short", "HEAD"]))?.trim() || null;
    const asIs = (why: string) => progress(`Could not fetch the newest commit: ${why}. Scanning the copy at ${short(head)} on ${own ?? "HEAD"}`);
    let wanted: string;
    if (follow === "own") {
      // A copy is always on a local branch; one that is not is scanned as it is.
      if (!own) return asIs("the copy is on no branch");
      wanted = own;
    }
    else if (follow.branch) wanted = follow.branch;
    else {
      const d = await this.defaultBranch(l, copy, signal);
      if ("error" in d) return asIs(d.error);
      wanted = d.branch;
    }
    if (wanted !== own) {
      if (ctx.inUse()) throw new RemoteError(`This repository is in use on the branch "${own ?? "HEAD"}": try again when its drawings and instructions have ended`);
      progress(`Fetching ${wanted} of ${l.link}`);
      const r = await this.network(l, this.args.fetch(l, wanted), copy, signal);
      if (signal.aborted) throw new RemoteError("Cancelled");
      if (typeof r === "string") throw new RemoteError(r);
      if (r.code !== 0) throw new RemoteError(gitFailure(r.stderr, l, wanted));
      const replaced = await this.replacedDrawing(copy, ctx.drawings());
      if (replaced) throw new RemoteError(`Could not switch the copy of ${l.link} to "${wanted}": it would replace ${replaced}`);
      const c = await this.run(this.args.checkout(wanted), copy, signal);
      if (signal.aborted) throw new RemoteError("Cancelled");
      if (c.code !== 0) throw new RemoteError(`Could not switch the copy of ${l.link} to "${wanted}": ${lastLine(c.stderr)}`);
      progress(`Switched to ${wanted} at ${short((await headCommit(copy)) ?? "")}`);
      return;
    }
    if (ctx.inUse()) return progress(`This repository is in use: scanning the copy at ${short(head)} on ${own}`);
    const r = await this.network(l, this.args.fetch(l, wanted), copy, signal);
    if (signal.aborted) throw new RemoteError("Cancelled");
    if (typeof r === "string") return asIs(r);
    if (r.code !== 0) return asIs(gitFailure(r.stderr, l, wanted));
    const fetched = (await git(copy, ["rev-parse", "FETCH_HEAD"]))?.trim() ?? "";
    if (fetched === head) return progress(`Up to date at ${short(head)}`);
    const replaced = await this.replacedDrawing(copy, ctx.drawings());
    if (replaced) return progress(`Kept the copy at ${short(head)}: the newest commit would replace ${replaced}`);
    const c = await this.run(this.args.checkout(wanted), copy, signal);
    if (signal.aborted) throw new RemoteError("Cancelled");
    if (c.code !== 0) return progress(`Kept the copy at ${short(head)}: ${lastLine(c.stderr)}`);
    progress(`Updated to ${short((await headCommit(copy)) ?? fetched)}`);
  }

  /**
   * The first registered drawing the fetched commit would replace: one git does not track that the
   * commit holds a file at, or one git tracks that differs from the copy's commit. Null when none.
   */
  private async replacedDrawing(copy: string, drawings: string[]): Promise<string | null> {
    for (const file of drawings) {
      const rel = relative(copy, file).split(sep).join("/");
      if (!rel || rel.startsWith("..")) continue;
      const tracked = ((await git(copy, ["ls-files", "--", rel])) ?? "").trim() !== "";
      if (tracked) {
        if (((await git(copy, ["diff", "--name-only", "HEAD", "--", rel])) ?? "x").trim() !== "") return file;
      } else if ((await git(copy, ["cat-file", "-e", `FETCH_HEAD:${rel}`])) !== null) return file;
    }
    return null;
  }

  /**
   * Delete a copy (api contract, *Deleting a copy*): the folder is rebuilt from the link, removed with
   * everything in it; links inside are removed as links. A copy already gone counts as deleted.
   */
  deleteCopy(link: string): { ok: true } | { error: string } {
    const copy = this.copyDir(link);
    if (!existsSync(copy)) return { ok: true };
    try {
      rmSync(copy, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (e) {
      return { error: `Could not delete the copy at ${copy}: ${(e as Error).message}` };
    }
    if (existsSync(copy)) return { error: `Could not delete the copy at ${copy}: it is still there` };
    const parts = link.toLowerCase().split("/");
    this.pruneEmpty({ host: parts[0], owner: parts[1] });
    return { ok: true };
  }

  /** The owner and host folders left empty by a failed copy or a deletion go too. */
  private pruneEmpty(l: { host: string; owner: string }) {
    const base = reposDir(this.dataDir);
    for (const dir of [join(base, l.host, l.owner), join(base, l.host)]) {
      try { if (readdirSync(dir).length === 0) rmdirSync(dir); else return; } catch { return; }
    }
  }

  /** At start-up, once the port is bound: the partial folders of servers no longer running go. */
  sweepPartial(running: (pid: number) => boolean = isRunning): string[] {
    const root = this.partialRoot();
    let names: string[];
    try { names = readdirSync(root); } catch { return []; }
    const removed: string[] = [];
    for (const name of names) {
      const m = /^(\d+)-/.exec(name);
      if (m && running(Number(m[1]))) continue;
      removeTree(join(root, name));
      removed.push(name);
    }
    return removed;
  }
}

/** A test remote counts when it is a repository whose `HEAD` names a commit (read from its files, no git). */
function hasCommit(dir: string): boolean {
  const gitDir = existsSync(join(dir, ".git", "HEAD")) ? join(dir, ".git") : existsSync(join(dir, "HEAD")) && existsSync(join(dir, "objects")) ? dir : null;
  if (!gitDir) return false;
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return /^[0-9a-f]{40,64}$/.test(head);
    if (existsSync(join(gitDir, ...ref.split("/")))) return true;
    const packed = join(gitDir, "packed-refs");
    return existsSync(packed) && readFileSync(packed, "utf8").split(/\r?\n/).some((line) => line.endsWith(` ${ref}`));
  } catch { return false; }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done();
    const t = setTimeout(finish, ms);
    function finish() { clearTimeout(t); signal.removeEventListener("abort", finish); done(); }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Removes a folder and everything in it, read-only files included; a busy file on Windows is retried for up to 5 s. */
function removeTree(dir: string) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch (e) { console.error(`Could not remove ${dir}:`, (e as Error).message); }
}

async function renameWithRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; } catch (e) {
      // A virus scanner or the indexer may hold a file of the fresh clone for a moment on Windows.
      if (i >= 20 || !["EPERM", "EACCES", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
