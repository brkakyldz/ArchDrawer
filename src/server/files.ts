import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { channelWarnings, normalizeFile3 } from "../core/channels";
import { readAnyFile } from "../core/convert";
import { fillDefaults3, type Document3, type File3 } from "../core/file3";
import { isV1 } from "../core/migrate";

/**
 * Drawing files on disk, shared by the CLI and the server (the cli and diagram contracts):
 * the repository a file belongs to, validation with the repository file check, normalisation
 * and atomic writes.
 */

/**
 * The nearest ancestor of the file's folder that holds `.git`. With none, the file's own folder,
 * except for a file in `docs` whose `source` is that folder's parent, as a `draw` run writes a
 * drawing of a folder outside git (diagram contract rule 14): then that parent.
 */
export function repoRootOf(file: string): string {
  const start = dirname(resolve(file));
  // A draw's file in `docs` names that folder's parent as its source: a `.git` inside docs (a docs
  // submodule) does not make docs the root.
  const parent = dirname(start);
  if (samePath(basename(start), "docs") && parent !== start && holdsGitOrPlain(parent)) {
    try {
      const source = (JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { source?: { path?: unknown } }).source?.path;
      if (typeof source === "string" && samePath(source, parent)) return parent;
    } catch { /* not readable: the walk below */ }
  }
  for (let dir = start; ; dir = dirname(dir)) {
    if (holdsGit(dir)) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/** The parent a draw roots its file at: a repository's root, or a folder outside git. */
const holdsGitOrPlain = (dir: string) => {
  for (let d = dir; ; d = dirname(d)) {
    if (holdsGit(d)) return d === dir;
    if (dirname(d) === d) return true;
  }
};

const samePath = (a: string, b: string) => {
  const x = resolve(a), y = resolve(b);
  return process.platform === "win32" || process.platform === "darwin" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/**
 * Whether a folder holds a repository's `.git` (api contract, Folders): a folder with a `HEAD` file,
 * or a file naming its git folder (`gitdir: …`, a worktree or submodule). An empty or stray `.git`
 * is none, so it never widens a repository root to the folders above it.
 */
export function holdsGit(dir: string): boolean {
  const g = resolve(dir, ".git");
  try {
    const st = statSync(g);
    if (st.isDirectory()) return statSync(resolve(g, "HEAD")).isFile();
    if (!st.isFile()) return false;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(g, "utf8").slice(0, 4096));
    return !!m && statSync(resolve(dir, m[1])).isDirectory();
  } catch { return false; }
}

/** True when a repository-relative path exists inside the root, symlinks resolved. */
export function repoFileChecker(root: string): (rel: string) => boolean {
  const base = resolve(root);
  let realBase = base;
  try { realBase = realpathSync(base); } catch { /* checked per file below */ }
  const within = (from: string, to: string) => {
    const r = relative(from, to);
    return r !== "" && !r.startsWith("..") && !isAbsolute(r) && !r.split(sep).includes("..");
  };
  return (rel) => {
    const target = resolve(base, rel);
    if (!within(base, target) || !existsSync(target)) return false;
    try { return within(realBase, realpathSync(target)); } catch { return false; }
  };
}

export const docText = (doc: unknown) => JSON.stringify(doc, null, 2) + "\n";
export const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

/** Write through a temporary file and a rename, so a reader never sees half a file. */
export function writeAtomic(path: string, text: string, mode?: number): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
  // On Windows a rename over a file another process is reading fails for a moment (EPERM,
  // EACCES, EBUSY): an editor, a session or the watcher reading the drawing. Try again briefly.
  for (let attempt = 0; ; attempt++) {
    try { renameSync(tmp, path); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        try { unlinkSync(tmp); } catch { /* already gone */ }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 + attempt * 10);
    }
  }
}

export interface FileReport {
  ok: boolean;
  /** `<json path>: <message>` per violation. */
  errors: string[];
  warnings: string[];
  /** The file as `@3`: an `@2` file converted (diagram contract, Reading `archdraw/diagram@2`). */
  file: File3 | null;
  /** The raw JSON value when it parsed (for migration). */
  raw: unknown;
  v1: boolean;
  /** The format the text was in, when it was a drawing. */
  from: "@3" | "@2" | "@1" | null;
}

/**
 * Validate a file's text against the diagram contract, checking `files` against the repository root.
 * A missing path is an error for `validate` and a warning wherever a drawing is opened or saved
 * (diagram contract rule 14), so a file deleted from the repository never locks a drawing.
 */
export function checkText(text: string, root: string, missingFiles: "error" | "warn" = "error"): FileReport {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, errors: [`json: ${(e as Error).message}`], warnings: [], file: null, raw: undefined, v1: false, from: null };
  }
  if (isV1(raw)) {
    return { ok: false, errors: ['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"'], warnings: [], file: null, raw, v1: true, from: "@1" };
  }
  return { ...withWarnings(readAnyFile(raw, { fileExists: repoFileChecker(root), missingFiles })), raw, v1: false };
}

/** A read report plus the depth checks on every channel (diagram contract, Warnings). */
export function withWarnings<R extends { ok: boolean; file: File3 | null; warnings: string[] }>(r: R): R {
  if (!r.ok || !r.file) return r;
  return { ...r, warnings: [...r.warnings, ...channelWarnings(fillDefaults3(r.file))] };
}

export function checkFile(path: string, missingFiles: "error" | "warn" = "error"): FileReport & { text: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, errors: [`file: ${code === "ENOENT" ? "not found" : (e as Error).message}`], warnings: [], file: null, raw: undefined, v1: false, from: null, text: "" };
  }
  return { ...checkText(text, repoRootOf(path), missingFiles), text };
}

/**
 * Normalise a valid file (diagram contract, Normalisation): defaults, `source` = the repository
 * root, edge ids, positions. `updatedAt` moves to `now` only when the content changed, so
 * opening an untouched file twice writes nothing.
 */
export function normaliseFile(file: File3, ctx: { path: string; id: string; now: string; text?: string }): { doc: Document3; text: string; changed: boolean } {
  const source = { kind: "local" as const, path: repoRootOf(ctx.path) };
  const doc = normalizeFile3(file, { id: ctx.id, now: ctx.now, source });
  let text = docText(doc);
  const changed = text !== ctx.text;
  if (changed && file.updatedAt) {
    doc.updatedAt = ctx.now;
    text = docText(doc);
  }
  return { doc, text, changed };
}
