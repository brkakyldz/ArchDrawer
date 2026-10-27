import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { readAnyFile } from "../core/convert";
import { markOutside4, normalizeFile4, validateDocument4, type Document4, type File4 } from "../core/file4";
import { DOC_ID_RE, newDocumentId } from "../core/model";
import { checkFile, docText, hashOf, normaliseFile, repoFileChecker, repoRootOf, writeAtomic } from "./files";

export interface DiagramSummary { id: string; title: string; path: string | null; root: string | null; updatedAt: string }
export type ReadResult = { ok: true; doc: Document4 } | { ok: false; error: string; errors: string[] };
export type PutResult = { ok: true; updatedAt: string } | { ok: false; conflict: true; updatedAt: string | null } | { ok: false; conflict: false; error: string; errors: string[] };

export class FileError extends Error {
  constructor(message: string, readonly errors: string[] = []) { super(message); }
}

/** A strictly increasing ISO timestamp, so two writes in the same millisecond still order. */
let last = 0;
export function nowIso(): string {
  const t = Math.max(Date.now(), last + 1);
  last = t;
  return new Date(t).toISOString();
}

const pathKey = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

/**
 * Drawings (api contract § Files on disk): registered files wherever they are, listed
 * in `<dataDir>/files.json`, and imported documents under `<dataDir>/diagrams/`. Every read goes
 * back to the disk; a file whose content differs from what this store last wrote or saw was
 * changed from outside (a session, the CLI): it is normalised, its `updatedAt` moves, and a
 * `changed` event fires. Every write is atomic.
 */
export class Store extends EventEmitter {
  readonly importsDir: string;
  private readonly registryFile: string;
  private readonly files = new Map<string, string>();
  /** Hash of the text this store last wrote or accepted, per id. */
  private readonly known = new Map<string, string>();
  /** The `updatedAt` last stored per document, to tell a writer's own new version from a stale one. */
  private readonly versions = new Map<string, string>();
  private readonly stamps = new Map<string, string>();
  /** When each stamp was taken: a same-size write soon after can keep the file's mtime. */
  private readonly stampedAt = new Map<string, number>();
  /** The document as this store last wrote or read it, to mark what an outside write changed. */
  private readonly last = new Map<string, Document4>();
  /** Normalised documents whose file could not be written back yet (locked or read-only), per id. */
  private readonly unwritten = new Map<string, { doc: Document4; text: string }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly dataDir: string) {
    super();
    this.importsDir = join(dataDir, "diagrams");
    this.registryFile = join(dataDir, "files.json");
    mkdirSync(this.importsDir, { recursive: true });
    this.loadRegistry();
  }

  /**
   * Take the registry from disk: another server on the same data folder may have registered or
   * forgotten files since (api contract, Files on disk). An unreadable registry keeps this one's list.
   */
  private loadRegistry() {
    let list: unknown;
    try { list = JSON.parse(readFileSync(this.registryFile, "utf8")); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") this.files.clear();
      return;
    }
    if (!Array.isArray(list)) return;
    this.files.clear();
    for (const e of list) if (typeof e?.id === "string" && DOC_ID_RE.test(e.id) && typeof e.path === "string") this.files.set(e.id, e.path);
  }

  private saveRegistry() {
    writeAtomic(this.registryFile, docText([...this.files].map(([id, path]) => ({ id, path }))));
  }

  private importFile(id: string): string | null {
    return DOC_ID_RE.test(id) ? join(this.importsDir, `${id}.json`) : null;
  }

  /** The file a document lives in, or null when the id is unknown. */
  pathOf(id: string): string | null {
    const p = this.files.get(id);
    if (p) return p;
    const f = this.importFile(id);
    return f && existsSync(f) ? f : null;
  }

  isRegistered(id: string): boolean {
    return this.files.has(id);
  }

  exists(id: string): boolean {
    return this.pathOf(id) !== null;
  }

  /** Register a drawing file (POST /api/files, `archdrawer open`): validated, given a unique id, normalised. */
  register(path: string): Document4 {
    if (!isAbsolute(path)) throw new FileError("The path must be absolute");
    const abs = resolve(path);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new FileError(`Not found: ${abs}`);
    const report = checkFile(abs, "warn");
    if (!report.ok || !report.file) throw new FileError("The file is not a valid drawing", report.errors);
    this.loadRegistry();
    const key = pathKey(abs);
    const known = [...this.files].find(([, p]) => pathKey(p) === key)?.[0];
    let id = known;
    if (!id) {
      const own = report.file.id;
      const taken = (x: string) => this.files.has(x) || existsSync(this.importFile(x) ?? "");
      id = own && DOC_ID_RE.test(own) && !taken(own) ? own : newDocumentId();
      this.files.set(id, abs);
    }
    // The registry keeps a new file only once it is read and written back (api contract, POST /api/files).
    const fresh = id;
    const drop = () => { if (!known) { this.files.delete(fresh); this.forget(fresh); } };
    let r: ReadResult | null;
    try { r = this.read(id); } catch (e) { drop(); throw e; }
    if (!r?.ok || (!known && this.unwritten.has(id))) {
      drop();
      if (!r) throw new FileError(`Not found: ${abs}`);
      if (!r.ok) throw new FileError(r.error, r.errors);
      throw new Error(`The file ${abs} cannot be written`);
    }
    if (!known) this.saveRegistry();
    // Its repository becomes a recent folder (api contract, Recent and found).
    this.emit("registered", abs);
    return r.doc;
  }

  /** Import a document (archdraw/diagram@4, @3, @2 or @1; older ones converted) into the data directory under a new id. */
  import(raw: unknown): { ok: true; id: string } | { ok: false; error: string; errors: string[] } {
    const id = newDocumentId();
    const now = nowIso();
    const r = readAnyFile(raw, {}, { allowV1: true, now });
    if (!r.ok || !r.file) return { ok: false, error: "Invalid diagram", errors: r.errors };
    const doc = normalizeFile4({ ...r.file, id: undefined, createdAt: undefined, updatedAt: undefined }, { id, now, source: r.file.source ?? null });
    const text = docText(doc);
    writeAtomic(this.importFile(id)!, text);
    this.known.set(id, hashOf(text));
    return { ok: true, id };
  }

  /** The document as stored now. Detects, normalises and announces changes made from outside. */
  read(id: string): ReadResult | null {
    const path = this.pathOf(id);
    if (!path) return null;
    let text: string;
    try { text = readFileSync(path, "utf8"); } catch { return { ok: false, error: `The file ${path} cannot be read`, errors: [] }; }
    const h = hashOf(text);
    const seen = this.known.get(id);
    const pending = this.unwritten.get(id);
    if (seen === h && pending) {
      // The file is as it was when its write-back failed: the normalised document stands, written now if it can be.
      this.writeBack(id, path, pending.doc, pending.text, text);
      return { ok: true, doc: pending.doc };
    }
    if (seen === h) {
      const v = validateDocument4(JSON.parse(text));
      if (v.ok) { this.versions.set(id, v.doc.updatedAt); this.last.set(id, v.doc); return { ok: true, doc: v.doc }; }
    }
    const report = this.files.has(id) ? checkFile(path, "warn") : this.checkImport(text);
    if (!report.ok || !report.file) return { ok: false, error: `The file ${basename(path)} is not a valid drawing`, errors: report.errors };
    const now = nowIso();
    let n = normaliseFile({ ...report.file, id }, { path, id, now, text });
    if (!this.files.has(id)) n.doc.source = report.file.source ?? null;
    const outside = seen !== undefined;
    const prev = this.last.get(id);
    // An outside write marks the channels it did not draw (diagram contract, Edits: facts or channel).
    if (outside && prev) n = { ...n, doc: markOutside4(prev, n.doc) };
    if (outside) {
      // A writer that set its own new `updatedAt` keeps it; one that left the old value gets now.
      const theirs = report.file.updatedAt;
      n.doc.updatedAt = theirs && theirs !== this.versions.get(id) && !Number.isNaN(Date.parse(theirs)) ? theirs : now;
    }
    this.writeBack(id, path, n.doc, docText(n.doc), text);
    this.versions.set(id, n.doc.updatedAt);
    this.last.set(id, n.doc);
    if (outside) this.emit("changed", id, n.doc.updatedAt);
    return { ok: true, doc: n.doc };
  }

  /**
   * Write a read's normalised text over the file's. A file that cannot be written (read-only, or held
   * open by another process) keeps its text: the document stands in memory, and a later read or
   * poll writes it. A failed write never stops the server.
   */
  private writeBack(id: string, path: string, doc: Document4, out: string, text: string) {
    if (out !== text) {
      try { writeAtomic(path, out); } catch (e) {
        if (!this.unwritten.has(id)) console.error(`Could not write back ${path}; trying again later:`, (e as Error).message);
        this.unwritten.set(id, { doc, text: out });
        this.known.set(id, hashOf(text));
        this.stamp(id, path);
        return;
      }
    }
    this.unwritten.delete(id);
    this.known.set(id, hashOf(out));
    this.stamp(id, path);
  }

  /** Imported documents keep their own `source`; their `files` are not checked against a folder. */
  private checkImport(text: string): { ok: boolean; errors: string[]; file: File4 | null } {
    try { return readAnyFile(JSON.parse(text)); } catch (e) { return { ok: false, errors: [`json: ${(e as Error).message}`], file: null }; }
  }

  get(id: string): Document4 | null {
    const r = this.read(id);
    return r?.ok ? r.doc : null;
  }

  /**
   * Save a document. With `base` (the `updatedAt` the writer started from), a stored document
   * that moved on since is a conflict and nothing is written. `announce` fires `changed` (runs).
   */
  put(id: string, body: unknown, opts: { base?: string | null; announce?: boolean } = {}): PutResult | null {
    const cur = this.read(id);
    if (!cur) return null;
    if (!cur.ok) return { ok: false, conflict: true, updatedAt: null };
    if (opts.base && cur.doc.updatedAt !== opts.base) return { ok: false, conflict: true, updatedAt: cur.doc.updatedAt };
    if (!body || typeof body !== "object" || (body as { id?: unknown }).id !== id) return { ok: false, conflict: false, error: "The document id does not match the URL", errors: [] };
    const updatedAt = nowIso();
    const path = this.pathOf(id)!;
    // A path missing from the repository does not block a save (diagram contract rule 14); the
    // editor marks it (`POST /api/diagrams/:id/check-files`). A registered file's source stays its
    // repository, the one root its files are checked and its runs read against.
    const source = this.files.has(id) ? { source: { kind: "local", path: repoRootOf(path) } } : {};
    const v = validateDocument4({ ...(body as object), ...source, updatedAt });
    if (!v.ok) return { ok: false, conflict: false, error: v.error, errors: v.errors };
    const text = docText(v.doc);
    // A short sentence for the editor's save status; the system error stays in the server log.
    try { writeAtomic(path, text); } catch (e) { throw new Error("The drawing file cannot be written", { cause: e }); }
    this.unwritten.delete(id);
    this.known.set(id, hashOf(text));
    this.versions.set(id, updatedAt);
    this.last.set(id, v.doc);
    this.stamp(id, path);
    if (opts.announce) this.emit("changed", id, updatedAt);
    return { ok: true, updatedAt };
  }

  /** The repository a drawing's files are checked and its runs read against: a registered file's, else the document's source. */
  rootOf(id: string): string | null {
    const p = this.files.get(id);
    if (p) return repoRootOf(p);
    return this.get(id)?.source?.path ?? null;
  }

  /** The repository-relative paths among `files` that are not in the drawing's repository (none without a local one). */
  missingFiles(id: string, files: string[]): string[] {
    const root = this.rootOf(id);
    if (!root || !existsSync(root)) return [];
    const has = repoFileChecker(root);
    return [...new Set(files)].filter((f) => !has(f.replace(/\\/g, "/")));
  }

  /** Forget a registered file (it stays on disk) or delete an imported document. */
  delete(id: string): boolean {
    // Another server may have registered or forgotten it meanwhile; its other entries stay.
    const had = this.files.has(id);
    this.loadRegistry();
    if (this.files.delete(id) || had) {
      this.saveRegistry();
      this.forget(id);
      return true;
    }
    const f = this.importFile(id);
    if (!f || !existsSync(f)) return false;
    rmSync(f, { force: true });
    this.forget(id);
    return true;
  }

  private forget(id: string) {
    for (const m of [this.known, this.versions, this.stamps, this.stampedAt, this.last, this.unwritten]) m.delete(id);
  }

  list(): DiagramSummary[] {
    const out: DiagramSummary[] = [];
    const add = (id: string, path: string | null) => {
      const r = this.read(id);
      const root = path ? repoRootOf(path) : null;
      if (r?.ok) out.push({ id, title: r.doc.title, path, root, updatedAt: r.doc.updatedAt });
      else if (r && path) out.push({ id, title: basename(path), path, root, updatedAt: new Date(statSync(path).mtimeMs).toISOString() });
    };
    // A drawing that cannot be read is listed by its file name, or left out; the others still are.
    const each = (id: string, path: string | null) => {
      try { add(id, path); } catch (e) {
        console.error(`Could not list ${path ?? id}:`, (e as Error).message);
        try { if (path) out.push({ id, title: basename(path), path, root: repoRootOf(path), updatedAt: new Date(statSync(path).mtimeMs).toISOString() }); } catch { /* gone */ }
      }
    };
    for (const [id, path] of this.files) if (existsSync(path)) each(id, path);
    for (const name of readdirSync(this.importsDir)) if (name.endsWith(".json")) each(name.slice(0, -5), null);
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  private stamp(id: string, path: string) {
    try { const s = statSync(path); this.stamps.set(id, `${s.mtimeMs}:${s.size}`); this.stampedAt.set(id, Date.now()); } catch { this.stamps.delete(id); }
  }

  /** Look for files changed from outside since the last look; `read` announces them. */
  poll(): void {
    for (const [id, path] of this.files) {
      try { this.pollOne(id, path); } catch (e) { console.error(`Could not check ${path}:`, (e as Error).message); }
    }
  }

  private pollOne(id: string, path: string) {
    let now: string;
    try { const s = statSync(path); now = `${s.mtimeMs}:${s.size}`; } catch { return; }
    // Within 2 s of the last stamp the time and size can match a new same-size text, so the text decides.
    const fresh = Date.now() - (this.stampedAt.get(id) ?? 0) < 2000;
    const differs = this.stamps.get(id) !== now || (fresh && this.known.has(id) && (() => { try { return hashOf(readFileSync(path, "utf8")) !== this.known.get(id); } catch { return false; } })());
    // A write-back that failed is tried again on every poll.
    if ((differs || this.unwritten.has(id)) && this.known.has(id)) this.read(id);
    else if (!this.stamps.has(id)) this.stamps.set(id, now);
  }

  watch(intervalMs = 400): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), intervalMs);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
