import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isV1 } from "../core/migrate";
import { validateFile, type DiagramDocument, type DiagramFile } from "../core/model";
import { normalizeFile } from "../core/normalize";

/**
 * Drawing files on disk, shared by the CLI and the server (the cli and diagram contracts):
 * the repository a file belongs to, validation with the repository file check, normalisation
 * and atomic writes.
 */

/** The nearest ancestor of the file's folder that holds `.git`, else the file's own folder. */
export function repoRootOf(file: string): string {
  const start = dirname(resolve(file));
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(resolve(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
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
  file: DiagramFile | null;
  /** The raw JSON value when it parsed (for migration). */
  raw: unknown;
  v1: boolean;
}

/**
 * Validate a file's text against the diagram contract, checking `files` against the repository root.
 * A missing path is an error for `validate` and a warning wherever a drawing is opened or saved
 * (diagram contract rule 10), so a file deleted from the repository never locks a drawing.
 */
export function checkText(text: string, root: string, missingFiles: "error" | "warn" = "error"): FileReport {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, errors: [`json: ${(e as Error).message}`], warnings: [], file: null, raw: undefined, v1: false };
  }
  if (isV1(raw)) {
    return { ok: false, errors: ['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"'], warnings: [], file: null, raw, v1: true };
  }
  const r = validateFile(raw, { fileExists: repoFileChecker(root), missingFiles });
  return { ...r, raw, v1: false };
}

export function checkFile(path: string, missingFiles: "error" | "warn" = "error"): FileReport & { text: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, errors: [`file: ${code === "ENOENT" ? "not found" : (e as Error).message}`], warnings: [], file: null, raw: undefined, v1: false, text: "" };
  }
  return { ...checkText(text, repoRootOf(path), missingFiles), text };
}

/**
 * Normalise a valid file (diagram contract, Normalisation): defaults, `source` = the repository
 * root, edge ids, positions. `updatedAt` moves to `now` only when the content changed, so
 * opening an untouched file twice writes nothing.
 */
export function normaliseFile(file: DiagramFile, ctx: { path: string; id: string; now: string; text?: string }): { doc: DiagramDocument; text: string; changed: boolean } {
  const source = { kind: "local" as const, path: repoRootOf(ctx.path) };
  const doc = normalizeFile(file, { id: ctx.id, now: ctx.now, source });
  let text = docText(doc);
  const changed = text !== ctx.text;
  if (changed && file.updatedAt) {
    doc.updatedAt = ctx.now;
    text = docText(doc);
  }
  return { doc, text, changed };
}
