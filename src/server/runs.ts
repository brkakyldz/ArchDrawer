import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { applyChannel, joinChannel } from "../core/channels";
import { channelOfView, validateDocument3, type ChannelId, type Document3 } from "../core/file3";
import { isPostView, validateDocument, type DiagramDocument } from "../core/model";
import { startSwitches, type FormatId } from "../core/export/share";
import { layoutReport, type LayoutReport } from "../core/report";
import { intentToChannel, linkedInViewId, parseIntent, STORY_SCHEMA, StoryError } from "../core/intent";
import { postPrompt } from "./engines/prompt";
import { diffDocuments, type Changes } from "../core/diff";
import { CoverageError, keepUnrelatedViews, missingFacts, SIMPLIFY_INSTRUCTION } from "../core/simplify";
import { answerToDocument, documentToDraft, EmptyDiagramError, type RunScope } from "../core/repair";
import { repoFileChecker } from "./files";
import { nowIso, type Store } from "./store";
import { EngineError, type Engine } from "./engines/types";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";
export type RunKind = "refine" | "post" | "simplify";
export type RunEvent =
  | { type: "progress"; message: string }
  | { type: "done"; status: Exclude<RunStatus, "running">; diagramId: string | null; error: string | null; changes: Changes | null; channel: ChannelId; view: string; layoutReport: LayoutReport | null };

export interface RunRecord {
  id: string;
  /** What the run does (api contract, Run kinds). */
  kind: RunKind;
  /** The channel and view the run worked on; on success, the resulting ones. */
  channel: ChannelId;
  view: string;
  status: RunStatus;
  progress: string[];
  diagramId: string | null;
  error: string | null;
  /** The engine and model the run used. */
  engine: string;
  model: string | null;
  /** What the run changed (api contract, the change summary), once it has succeeded. */
  changes: Changes | null;
  /** The saved result's layout report (api contract, Layout report), once it has succeeded. */
  layoutReport: LayoutReport | null;
}

interface Run extends RunRecord {
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
  abort: AbortController;
  finished: Promise<void>;
  timedOut: boolean;
  /** The drawing this run works on. */
  target: string;
}

export interface StartRun {
  engine: Engine;
  model: string | null;
  instruction: string;
  /** The view the user was looking at. */
  view: string;
  /** What the run may change; default the whole document. */
  scope?: RunScope;
  /**
   * The drawing as the engine sees it, as it was when the run started: the run's channel
   * (`joinChannel`, each part's facts as its `from`); for a post, the overview channel it is designed from.
   */
  base: DiagramDocument;
  /** The channel the run changes; default the overview. */
  channel?: ChannelId;
  /** The same drawing as stored. */
  stored: Document3;
  /** The format the result's layout report is measured in; default README (a post: the feed). */
  format?: FormatId;
  /** Default refine: an instruction-box change. A post designs the view's LinkedIn image; simplify makes the overview a map. */
  kind?: RunKind;
  /** A post designed from the facts alone (false: the engine reads no file); default true. */
  readCode?: boolean;
}

/** Runs one instruction-box call end to end and keeps its event log for replay over SSE. */
export class RunManager {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly store: Store,
    private readonly opts: { timeoutMs: number },
  ) {}

  get(id: string): RunRecord | null {
    const r = this.runs.get(id);
    return r ? {
      id: r.id, kind: r.kind, channel: r.channel, view: r.view, status: r.status, progress: [...r.progress], diagramId: r.diagramId, error: r.error,
      engine: r.engine, model: r.model, changes: r.changes, layoutReport: r.layoutReport,
    } : null;
  }

  /** The running run on a drawing, if any (one at a time per drawing). */
  runningOn(diagramId: string): string | null {
    for (const r of this.runs.values()) if (r.target === diagramId && r.status === "running") return r.id;
    return null;
  }

  /** Subscribe to a run: past events are replayed first. Returns an unsubscribe function. */
  subscribe(id: string, fn: (e: RunEvent) => void): (() => void) | null {
    const r = this.runs.get(id);
    if (!r) return null;
    for (const e of r.events) fn(e);
    if (r.status !== "running") return () => {};
    r.listeners.add(fn);
    return () => r.listeners.delete(fn);
  }

  cancel(id: string): boolean {
    const r = this.runs.get(id);
    if (!r) return false;
    if (r.status === "running") r.abort.abort();
    return true;
  }

  cancelAll(): void {
    for (const r of this.runs.values()) if (r.status === "running") r.abort.abort();
  }

  /** Resolves when the run has ended (tests and shutdown). */
  async wait(id: string): Promise<RunRecord | null> {
    await this.runs.get(id)?.finished;
    return this.get(id);
  }

  start(req: StartRun): string {
    const id = `r_${randomBytes(6).toString("hex")}`;
    let resolveFinished!: () => void;
    const run: Run = {
      id, kind: req.kind ?? "refine", channel: (req.kind === "post" ? "linkedin" : channelOfView(req.stored, req.view)) ?? "overview", view: req.kind === "post" ? linkedInViewId(req.stored) : req.view, status: "running", progress: [], diagramId: null, error: null, engine: req.engine.id, model: req.model,
      changes: null, layoutReport: null, target: req.base.id,
      events: [], listeners: new Set(), abort: new AbortController(),
      finished: new Promise((r) => (resolveFinished = r)), timedOut: false,
    };
    const deadline = setTimeout(() => { run.timedOut = true; run.abort.abort(); }, this.opts.timeoutMs);
    deadline.unref?.();
    this.runs.set(id, run);
    const emit = (e: RunEvent) => {
      run.events.push(e);
      for (const l of run.listeners) l(e);
    };
    const progress = (message: string) => {
      if (run.status !== "running") return;
      run.progress.push(message);
      emit({ type: "progress", message });
    };
    const end = (status: Exclude<RunStatus, "running">, diagramId: string | null, error: string | null, changes: Changes | null = null, report: LayoutReport | null = null) => {
      clearTimeout(deadline);
      run.status = status;
      run.diagramId = diagramId;
      run.error = error;
      run.changes = changes;
      run.layoutReport = report;
      emit({ type: "done", status, diagramId, error, changes, channel: run.channel, view: run.view, layoutReport: report });
      run.listeners.clear();
      resolveFinished();
    };
    void this.execute(req, run.abort.signal, progress).then(
      (r) => { run.channel = r.channel; run.view = r.view; end("succeeded", r.diagramId, null, r.changes, r.layoutReport); },
      (err: unknown) => {
        if (run.timedOut) return end("failed", null, `Timed out after ${Math.round(this.opts.timeoutMs / 60_000) || 1} min — try a narrower instruction`);
        if (run.abort.signal.aborted) return end("cancelled", null, null);
        const known = err instanceof EngineError || err instanceof EmptyDiagramError || err instanceof StoryError || err instanceof CoverageError;
        // A product bug: its stack goes to the server log (server.log of a detached server).
        if (!known) console.error(`Run ${id} failed unexpectedly:`, err);
        end("failed", null, known ? (err as Error).message : `Unexpected error: ${(err as Error)?.message ?? String(err)}`);
      },
    );
    // Forget finished runs after an hour so a long-lived server does not grow without bound.
    void run.finished.then(() => setTimeout(() => this.runs.delete(id), 3_600_000).unref());
    return id;
  }

  private async execute(req: StartRun, signal: AbortSignal, progress: (m: string) => void): Promise<{ diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string }> {
    // The root the store checks this drawing's files against, so a repair and a save never disagree.
    const root = this.store.rootOf(req.base.id);
    if (!root) throw new EngineError("This drawing has no repository folder to read");
    if (req.kind === "post") return this.post(req, root, signal, progress);
    // A simplification may change the overview and the detail it links to, nothing else (api contract).
    const simplify = req.kind === "simplify";
    const scope: RunScope = simplify ? { kind: "all" } : req.scope ?? { kind: "all" };
    // The fixed instruction, augmented by what the user adds (the panel sends the fixed one itself).
    const extra = req.instruction.trim().startsWith(SIMPLIFY_INSTRUCTION) ? req.instruction.trim().slice(SIMPLIFY_INSTRUCTION.length).replace(/^[.\s]+/, "") : req.instruction.trim();
    const instruction = simplify ? (extra ? `${SIMPLIFY_INSTRUCTION}. ${extra}` : SIMPLIFY_INSTRUCTION) : req.instruction;
    const inView = req.base.views.find((v) => v.id === req.view)?.nodes ?? [];
    const parts = scope.kind === "parts" ? scope.ids.map((id) => inView.find((n) => n.id === id)?.label ?? id) : [];
    const answer = await req.engine.run({
      cwd: root, folderName: basename(root), instruction, view: req.view, model: req.model, scope, parts,
      base: documentToDraft(req.base), signal, timeoutMs: this.opts.timeoutMs, progress, simplify,
    });
    if (signal.aborted) throw new EngineError("Cancelled");
    progress("Checking the drawing");
    let doc = answerToDocument(answer, { base: req.base, now: nowIso(), engine: { id: req.engine.id, model: req.model }, fileExists: repoFileChecker(root), scope, view: req.view });
    if (simplify) doc = keepUnrelatedViews(req.base, doc).doc;
    // Never replace a readable drawing with one the store would refuse to read back.
    // The view shape is checked on its own: a LinkedIn view's `postOf` (its post style) names no view of its channel.
    const checked = validateDocument({ ...doc, views: doc.views.map((v) => ({ ...v, postOf: null })) });
    if (!checked.ok) throw new EngineError(`The engine's drawing could not be repaired into a valid document: ${checked.error}`);
    if (signal.aborted) throw new EngineError("Cancelled");
    // The answer is a new state of the run's channel: content goes to the facts, appearance stays in the
    // channel, and the other channels are marked (diagram contract, Writing the answer back). Simplify
    // changes the overview's appearance only.
    const channel = req.channel ?? "overview";
    const split = applyChannel(req.stored, channel, { views: doc.views, title: doc.title, engine: doc.engine, warnings: doc.warnings }, { keepFacts: simplify });
    if (!split.ok) throw new EngineError(split.error);
    if (simplify) {
      // After repair and before the save: a fact no part shows fails the run, nothing is saved.
      const missing = missingFacts(req.stored, split.doc);
      if (missing.length) throw new CoverageError(missing);
    }
    const stored = validateDocument3(split.doc);
    if (!stored.ok) throw new EngineError(`The engine's drawing could not be repaired into a valid document: ${stored.error}`);
    // Never overwrite a drawing that changed after the run started (the editor, a session, the CLI).
    const saved = this.store.put(req.base.id, split.doc, { base: req.base.updatedAt, announce: true });
    if (!saved) throw new EngineError("The drawing was removed while the instruction ran.");
    if (!saved.ok) throw new EngineError(saved.conflict ? "The drawing changed while the instruction ran." : `The drawing could not be saved: ${saved.error}`);
    const added = doc.warnings.length - req.base.warnings.length;
    progress(added > 0 ? `Saved with ${added} warning${added === 1 ? "" : "s"}` : "Saved");
    // The report measures the saved result, with the format's default switches (api contract, Layout report).
    const format = req.format ?? "readme";
    const view = doc.views.find((v) => v.id === req.view) ?? doc.views[0];
    const report = layoutReport(doc, view.id, { ...startSwitches(format, isPostView(view)), format, theme: doc.theme });
    return { diagramId: req.base.id, changes: diffDocuments(req.base, doc, scope.kind === "all" ? undefined : [req.view]), layoutReport: report, channel, view: req.view };
  }

  /** A post run: the engine designs the story, code converts, places and measures it. */
  private async post(req: StartRun, root: string, signal: AbortSignal, progress: (m: string) => void) {
    const format = req.format === "linkedin" ? "linkedin" : "feed";
    // The engine designs from the overview's first view (`base` is the overview's draft).
    const source = req.base.views[0].id;
    const answer = await req.engine.run({
      cwd: root, folderName: basename(root), instruction: req.instruction, view: source, model: req.model, scope: { kind: "view" }, parts: [],
      base: documentToDraft(req.base), signal, timeoutMs: this.opts.timeoutMs, progress,
      task: {
        kind: "post", schema: STORY_SCHEMA, tools: req.readCode === false ? "none" : "read",
        prompt: postPrompt({ folderName: basename(root), view: source, base: documentToDraft(req.base), facts: req.stored.facts, format, instruction: req.instruction, readCode: req.readCode }),
      },
    });
    if (signal.aborted) throw new EngineError("Cancelled");
    progress("Checking the post");
    // A post is the LinkedIn channel's one view; it changes no fact (diagram contract, Post answers).
    const { doc, view, warnings } = intentToChannel(req.stored, parseIntent(answer), { portrait: format === "feed" });
    const toSave: Document3 = { ...doc, engine: { id: req.engine.id, model: req.model }, updatedAt: nowIso() };
    if (signal.aborted) throw new EngineError("Cancelled");
    const saved = this.store.put(req.base.id, toSave, { base: req.base.updatedAt, announce: true });
    if (!saved) throw new EngineError("The drawing was removed while the post was designed.");
    if (!saved.ok) throw new EngineError(saved.conflict ? "The drawing changed while the post was designed." : `The drawing could not be saved: ${saved.error}`);
    progress(warnings.length ? `Saved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Saved");
    const after = joinChannel(toSave, "linkedin");
    const report = layoutReport(after, view, { ...startSwitches(format, true), format, theme: toSave.theme });
    return { diagramId: req.base.id, changes: diffDocuments(joinChannel(req.stored, "linkedin"), after, [view]), layoutReport: report, channel: "linkedin" as ChannelId, view };
  }
}

