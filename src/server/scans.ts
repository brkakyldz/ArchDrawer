import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checkScan, namedEntries, pickInputs, SCAN_BUDGET, SCAN_SCHEMA, ScanAnswerError, scanText, type FocusOption, type RepoCard, type ScanInput } from "../core/scan";
import { scanPrompt } from "./engines/prompt";
import { EngineError, type Engine } from "./engines/types";
import { writeAtomic } from "./files";
import { headCommit, listFolder, readPart, repoFile, type Folder } from "./folders";

/**
 * Scans (api contract, *Scans*; ADR 0007): a repository card and focus options for a folder, from
 * inputs code gathers, by an engine with no tools. Cached per root, folder and commit. A scan
 * writes no drawing; its lifecycle is a run's.
 */

export type ScanStatus = "running" | "succeeded" | "failed" | "cancelled";
export type ScanEvent =
  | { type: "progress"; message: string }
  | { type: "done"; status: Exclude<ScanStatus, "running">; error: string | null; card: RepoCard | null; options: FocusOption[] | null; cached: boolean; warnings: string[] };

export interface ScanRecord {
  id: string; status: ScanStatus; progress: string[];
  folder: string; root: string; commit: string | null; cached: boolean;
  card: RepoCard | null; options: FocusOption[] | null; warnings: string[];
  error: string | null; engine: string; model: string | null;
}

interface Scan extends ScanRecord {
  events: ScanEvent[];
  listeners: Set<(e: ScanEvent) => void>;
  abort: AbortController;
  finished: Promise<void>;
  key: string;
  /** The folder's root-relative path, for the draw run that follows. */
  rel: string;
}

interface Cached { card: RepoCard; options: FocusOption[]; warnings: string[] }
/** The cache entry's format: 2 since options are sections and flows (ADR 0015). An entry without it is scanned again. */
const CACHE_VERSION = 2;

export class ScanManager {
  private readonly scans = new Map<string, Scan>();
  /** Folders whose scan is being set up (before its record exists): one scan per folder at a time. */
  private readonly starting = new Set<string>();
  private readonly dir: string;

  constructor(dataDir: string, private readonly opts: { timeoutMs: number }) {
    this.dir = join(dataDir, "scans");
  }

  get(id: string): ScanRecord | null {
    const s = this.scans.get(id);
    if (!s) return null;
    const { events: _e, listeners: _l, abort: _a, finished: _f, key: _k, rel: _r, ...record } = s;
    return { ...record, progress: [...s.progress], warnings: [...s.warnings] };
  }

  /** A succeeded scan with the folder it was made of (a draw run starts from it). */
  succeeded(id: string): (ScanRecord & { rel: string }) | null {
    const s = this.scans.get(id);
    return s && s.status === "succeeded" ? { ...this.get(id)!, rel: s.rel } : null;
  }

  /** Whether a scan of this folder is running or being started (one at a time per folder). */
  runningOn(f: Folder): boolean {
    const key = `${f.root}\0${f.rel}`;
    if (this.starting.has(key)) return true;
    for (const s of this.scans.values()) if (s.key === key && s.status === "running") return true;
    return false;
  }

  subscribe(id: string, fn: (e: ScanEvent) => void): (() => void) | null {
    const s = this.scans.get(id);
    if (!s) return null;
    for (const e of s.events) fn(e);
    if (s.status !== "running") return () => {};
    s.listeners.add(fn);
    return () => s.listeners.delete(fn);
  }

  cancel(id: string): boolean {
    const s = this.scans.get(id);
    if (!s) return false;
    if (s.status === "running") s.abort.abort();
    return true;
  }

  /** Cancels every running scan; resolves once they have all ended and their engines are gone. */
  async cancelAll(): Promise<void> {
    const running = [...this.scans.values()].filter((s) => s.status === "running");
    for (const s of running) s.abort.abort();
    await Promise.all(running.map((s) => s.finished));
  }

  async wait(id: string): Promise<ScanRecord | null> {
    await this.scans.get(id)?.finished;
    return this.get(id);
  }

  private entry(f: Folder, commit: string) {
    return join(this.dir, `${createHash("sha256").update(`${f.root}\0${f.rel}\0${commit}`).digest("hex")}.json`);
  }

  /**
   * Start a scan; a cached one is created already succeeded and starts no engine. Null when a scan
   * of the folder is already running: the folder is reserved before anything is awaited.
   */
  async start(f: Folder, engine: Engine, model: string | null, refresh: boolean): Promise<string | null> {
    if (this.runningOn(f)) return null;
    const reserved = `${f.root}\0${f.rel}`;
    this.starting.add(reserved);
    try { return await this.begin(f, engine, model, refresh); } finally { this.starting.delete(reserved); }
  }

  private async begin(f: Folder, engine: Engine, model: string | null, refresh: boolean): Promise<string> {
    const id = `s_${randomBytes(6).toString("hex")}`;
    const commit = await headCommit(f.root);
    let resolveFinished!: () => void;
    const scan: Scan = {
      id, status: "running", progress: [], folder: f.folder, root: f.root, commit, cached: false,
      card: null, options: null, warnings: [], error: null, engine: engine.id, model,
      events: [], listeners: new Set(), abort: new AbortController(),
      finished: new Promise((r) => (resolveFinished = r)), key: `${f.root}\0${f.rel}`, rel: f.rel,
    };
    this.scans.set(id, scan);
    // The latest finished scan of a folder is kept for a draw; an earlier one goes (api contract, Lifecycle).
    void scan.finished.then(() => {
      // A success replaces every earlier finished scan of the folder; a failure only the earlier failures.
      for (const [other, s] of this.scans) {
        if (other === id || s.key !== scan.key || s.status === "running") continue;
        if (scan.status === "succeeded" || s.status !== "succeeded") this.scans.delete(other);
      }
    });
    const emit = (e: ScanEvent) => { scan.events.push(e); for (const l of scan.listeners) l(e); };
    const progress = (message: string) => { if (scan.status !== "running") return; scan.progress.push(message); emit({ type: "progress", message }); };
    const end = (status: Exclude<ScanStatus, "running">, error: string | null, r: Cached | null = null) => {
      clearTimeout(deadline);
      Object.assign(scan, { status, error, card: r?.card ?? null, options: r?.options ?? null, warnings: r?.warnings ?? [] });
      emit({ type: "done", status, error, card: scan.card, options: scan.options, cached: scan.cached, warnings: [...scan.warnings] });
      scan.listeners.clear();
      resolveFinished();
    };
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; scan.abort.abort(); }, this.opts.timeoutMs);
    deadline.unref?.();

    const cacheFile = commit ? this.entry(f, commit) : null;
    if (cacheFile && !refresh && existsSync(cacheFile)) {
      try {
        const hit = JSON.parse(readFileSync(cacheFile, "utf8")) as Cached & { version?: unknown };
        // An entry of another shape (a corrupted file, an older format) is scanned again.
        if (!hit || typeof hit !== "object" || hit.version !== CACHE_VERSION || !hit.card || typeof hit.card.name !== "string" || !Array.isArray(hit.options) || !Array.isArray(hit.warnings)) throw new Error("not a scan");
        scan.cached = true;
        progress(`Scanned before at ${commit!.slice(0, 7)}`);
        end("succeeded", null, hit);
        return id;
      } catch { /* an unreadable entry is scanned again */ }
    }

    void this.execute(f, engine, model, scan.abort.signal, progress).then(
      (r) => {
        if (cacheFile) {
          try { mkdirSync(this.dir, { recursive: true }); writeAtomic(cacheFile, JSON.stringify({ version: CACHE_VERSION, ...r })); } catch (e) { console.error("Could not cache a scan:", e); }
        }
        end("succeeded", null, r);
      },
      (err: unknown) => {
        if (timedOut) return end("failed", `Timed out after ${Math.round(this.opts.timeoutMs / 60_000) || 1} min`);
        if (scan.abort.signal.aborted) return end("cancelled", "Cancelled");
        const known = err instanceof EngineError || err instanceof ScanAnswerError;
        if (!known) console.error(`Scan ${id} failed unexpectedly:`, err);
        end("failed", known ? (err as Error).message : `Unexpected error: ${(err as Error)?.message ?? String(err)}`);
      },
    );
    return id;
  }

  private async execute(f: Folder, engine: Engine, model: string | null, signal: AbortSignal, progress: (m: string) => void): Promise<Cached> {
    progress("Gathering the repository");
    const commit = await headCommit(f.root);
    const { listing, more } = await listFolder(f, commit !== null);
    const read = (p: string, max: number): ScanInput | null => { const r = readPart(f.root, p, max); return r ? { path: p, text: r.text, length: r.length } : null; };
    const first = pickInputs(listing, f.rel);
    const depTexts = first.deps.map((p) => read(p, SCAN_BUDGET.dep)).filter((x): x is ScanInput => !!x);
    const named = depTexts.flatMap((d) => namedEntries(d.path, d.text));
    const { readme, entries } = pickInputs(listing, f.rel, named);
    const material = {
      listing, more,
      readme: readme ? read(readme, SCAN_BUDGET.readme) : null,
      deps: depTexts,
      entries: entries.map((p) => read(p, SCAN_BUDGET.entry)).filter((x): x is ScanInput => !!x),
    };
    const folderName = basename(f.folder);
    if (signal.aborted) throw new EngineError("Cancelled");
    const answer = await engine.run({
      cwd: f.root, folderName, instruction: folderName, view: "", model, scope: { kind: "view" }, parts: [], base: null,
      signal, timeoutMs: this.opts.timeoutMs, progress,
      task: { kind: "scan", schema: SCAN_SCHEMA, tools: "none", prompt: scanPrompt({ folderName, rel: f.rel, material: scanText(material) }), data: { listing, entries } },
    });
    if (signal.aborted) throw new EngineError("Cancelled");
    progress("Checking the scan");
    const r = checkScan(answer, { folderName, exists: repoFile(f.root) });
    progress("Done");
    return r;
  }
}
