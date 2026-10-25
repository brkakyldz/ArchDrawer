import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { appearanceOnly } from "../core/appearance";
import { applyChannel, joinChannel } from "../core/channels";
import { storyDraft } from "../core/map";
import { channelOfView, validateDocument3, type ChannelId, type Document3 } from "../core/file3";
import { withChoice, type Document4 } from "../core/file4";
import { isPostView, validateDocument, type DiagramDocument } from "../core/model";
import { startSwitches, type FormatId } from "../core/export/share";
import { isMapView, layoutReport, type LayoutReport } from "../core/report";
import { channelViewId, intentToChannel, STORY_SCHEMA, StoryError, storyRows } from "../core/intent";
import { postPrompt, ROUTE_SCHEMA, routePrompt, storyPrompt } from "./engines/prompt";
import { diffDocuments, type Changes } from "../core/diff";
import { CoverageError, keepUnrelatedViews, missingFacts, SIMPLIFY_INSTRUCTION } from "../core/simplify";
import { answerToDocument, documentToDraft, DRAFT_JSON_SCHEMA, EmptyDiagramError, type RunScope } from "../core/repair";
import { removeReviseFolder, reviseOverviewPrompt, reviseStoryPrompt, type ReviseImage } from "./engines/revise";
import { repoFile } from "./folders";
import { nowIso, type Store } from "./store";
import { EngineError, type Engine } from "./engines/types";
import { ReadAnswerError } from "../core/read";
import { DrawError, drawChoices, keptKey, runDraw, type DrawChoice, type DrawRequest, type KeptChoice } from "./draw";
import { storyAnswer } from "./story-turn";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";
export type RunKind = "refine" | "story" | "post" | "simplify" | "revise" | "draw";
/** The stage of a `draw` run (api contract, The draw run); null on other kinds. */
export type DrawStage = "read" | "overview" | "channel";
/** The channels a story is drawn in (a post is a story on LinkedIn). */
export type StoryChannel = Exclude<ChannelId, "overview">;
export type RunEvent =
  | { type: "progress"; message: string; stage: DrawStage | null; choice: string | null }
  | { type: "done"; status: Exclude<RunStatus, "running">; diagramId: string | null; error: string | null; changes: Changes | null; choice: string; channel: ChannelId; view: string; layoutReport: LayoutReport | null; route: Route | null; path: string | null; choices: DrawChoice[] | null };

export interface RunRecord {
  id: string;
  /** What the run does (api contract, Run kinds). */
  kind: RunKind;
  /** The choice the run changes (api contract, Run record); a draw's first choice. */
  choice: string;
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
  /** Which way a refine went (api contract, Routing); null for other kinds. */
  route: Route | null;
  /** The drawing file a `draw` run wrote, once it has succeeded. */
  path: string | null;
  /** A `draw`'s choices in request order with their state (api contract, Run record); null on other kinds. */
  choices: DrawChoice[] | null;
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

/** Which way a refine went (api contract, Routing). */
export type Route = "facts" | "story";

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
  /** The same drawing as stored: the run's choice as an `@3` document. */
  stored: Document3;
  /** The whole stored document, and the choice the run changes in it. */
  whole: Document4;
  choice: string;
  /** The format the result's layout report is measured in; default README (a post: the feed). */
  format?: FormatId;
  /** Default refine: an instruction-box change. A post designs the view's LinkedIn image; simplify makes the overview a map. */
  kind?: RunKind;
  /** A post designed from the facts alone (false: the engine reads no file); default true. */
  readCode?: boolean;
  /** A revise's image, written by the server; its folder is removed when the run ends, whatever the outcome. */
  image?: ReviseImage;
}

/** What a second look sees: the image and the layout report measured on the same view. */
interface Look { image: ReviseImage; report: LayoutReport }

/** The channel a story or post run draws; null for other kinds. */
const storyChannelOf = (req: StartRun): StoryChannel | null =>
  req.kind === "post" ? "linkedin" : req.kind === "story" ? ((req.channel as StoryChannel | undefined) ?? "linkedin") : null;

/** How long what a failed draw kept stays (api contract, What a failed draw keeps). */
const KEPT_MS = 3_600_000;

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
      id: r.id, kind: r.kind, choice: r.choice, channel: r.channel, view: r.view, status: r.status, progress: [...r.progress], diagramId: r.diagramId, error: r.error,
      engine: r.engine, model: r.model, changes: r.changes, layoutReport: r.layoutReport, route: r.route, path: r.path,
      choices: r.choices ? r.choices.map((c) => ({ ...c })) : null,
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

  /** Cancels every running run; resolves once they have all ended, their engines gone and their images removed. */
  async cancelAll(): Promise<void> {
    const running = [...this.runs.values()].filter((r) => r.status === "running");
    for (const r of running) r.abort.abort();
    await Promise.all(running.map((r) => r.finished));
  }

  /** Resolves when the run has ended (tests and shutdown). */
  async wait(id: string): Promise<RunRecord | null> {
    await this.runs.get(id)?.finished;
    return this.get(id);
  }

  start(req: StartRun): string {
    const story = storyChannelOf(req);
    return this.launch(
      { kind: req.kind ?? "refine", choice: req.choice, channel: story ?? channelOfView(req.stored, req.view) ?? "overview", view: story ? channelViewId(req.stored, story) : req.view, engine: req.engine.id, model: req.model, target: req.base.id },
      // A revise's image goes once the run has ended — succeeded, failed, cancelled or timed out — and,
      // since every engine call settles only after its process tree has exited, after the engine is gone.
      (signal, progress, run) => this.execute(req, signal, (m) => progress(m), (route) => (run.route = route))
        .finally(() => { if (req.image) removeReviseFolder(req.image.dir); }),
    );
  }

  /** The running draw of a folder, if any (one at a time per folder). */
  drawingOn(folderKey: string): string | null {
    return this.runningOn(`folder:${folderKey}`);
  }

  /** Start a `draw` run (api contract, The draw run): a new drawing file from a scanned folder. */
  startDraw(req: DrawRequest): string {
    // What the folder's last failed draw kept, if this draw asks the same (api contract, What a failed draw keeps).
    const key = keptKey(req);
    const last = this.kept.get(req.folderKey);
    const kept = last && last.key === key ? last.records : null;
    const done = new Map<string, KeptChoice>();
    const choices = drawChoices(req.focuses);
    return this.launch(
      { kind: "draw", choice: choices[0].id, channel: req.channel, view: req.channel, engine: req.engine.id, model: req.model, target: `folder:${req.folderKey}`, choices },
      (signal, progress, run, restartDeadline) => runDraw(req, { store: this.store, timeoutMs: this.opts.timeoutMs, signal, progress, wrote: (path) => (run.path = path), choices, kept, done, restartDeadline }).then(
        (r) => { this.kept.delete(req.folderKey); return r; },
        (err: unknown) => {
          // The choice it ended in: failed (a timeout too), or cancelled; the later ones still wait.
          const at = choices.find((c) => c.status === "running");
          if (at) at.status = signal.aborted && !run.timedOut ? "cancelled" : "failed";
          // What was finished is kept: added to the folder's entry when it is for the same scan, engine and model
          // (a choice's newer record replaces its older one), else replacing it (api contract, What a failed draw keeps).
          const same = last && last.key === key && this.kept.get(req.folderKey) === last;
          const records = new Map(same ? last.records : []);
          for (const [k, v] of done) if (v.read !== undefined) records.set(k, v);
          if (!records.size) this.kept.delete(req.folderKey);
          else {
            const entry = { key, at: Date.now(), records };
            this.kept.set(req.folderKey, entry);
            // It goes an hour after the last draw that added to it, unless a newer draw of the folder replaced it first.
            setTimeout(() => { if (this.kept.get(req.folderKey) === entry) this.kept.delete(req.folderKey); }, KEPT_MS).unref();
          }
          throw err;
        },
      ),
    );
  }

  /** One entry per folder: what its draws that ended without a drawing had finished, per choice as requested. */
  private readonly kept = new Map<string, { key: string; at: number; records: Map<string, KeptChoice> }>();

  private launch(
    init: Pick<RunRecord, "kind" | "choice" | "channel" | "view" | "engine" | "model"> & { target: string; choices?: DrawChoice[] },
    exec: (signal: AbortSignal, progress: (m: string, stage?: DrawStage | null, choice?: string | null) => void, run: Run, restartDeadline: () => void) => Promise<{ diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string }>,
  ): string {
    const id = `r_${randomBytes(6).toString("hex")}`;
    let resolveFinished!: () => void;
    const run: Run = {
      id, kind: init.kind, choice: init.choice, channel: init.channel, view: init.view,
      status: "running", progress: [], diagramId: null, error: null, engine: init.engine, model: init.model,
      changes: null, layoutReport: null, route: null, path: null, target: init.target, choices: init.choices ?? null,
      events: [], listeners: new Set(), abort: new AbortController(),
      finished: new Promise((r) => (resolveFinished = r)), timedOut: false,
    };
    const expire = () => { run.timedOut = true; run.abort.abort(); };
    let deadline = setTimeout(expire, this.opts.timeoutMs);
    deadline.unref?.();
    // A draw's choice has its own deadline from its first line (api contract, Deadlines and cancel).
    const restartDeadline = () => { if (run.status !== "running") return; clearTimeout(deadline); deadline = setTimeout(expire, this.opts.timeoutMs); deadline.unref?.(); };
    this.runs.set(id, run);
    const emit = (e: RunEvent) => {
      run.events.push(e);
      for (const l of run.listeners) l(e);
    };
    const progress = (message: string, stage: DrawStage | null = null, choice: string | null = null) => {
      if (run.status !== "running") return;
      run.progress.push(message);
      emit({ type: "progress", message, stage, choice });
    };
    const end = (status: Exclude<RunStatus, "running">, diagramId: string | null, error: string | null, changes: Changes | null = null, report: LayoutReport | null = null) => {
      clearTimeout(deadline);
      // A path is the file a run wrote: only a succeeded draw has one (api contract, Run record).
      if (status !== "succeeded") run.path = null;
      run.status = status;
      run.diagramId = diagramId;
      run.error = error;
      run.changes = changes;
      run.layoutReport = report;
      emit({ type: "done", status, diagramId, error, changes, choice: run.choice, channel: run.channel, view: run.view, layoutReport: report, route: run.route, path: run.path, choices: run.choices ? run.choices.map((c) => ({ ...c })) : null });
      run.listeners.clear();
      resolveFinished();
    };
    void exec(run.abort.signal, progress, run, restartDeadline).then(
      // The report names the channel it measured (api contract, Layout report).
      (r) => { run.channel = r.channel; run.view = r.view; end("succeeded", r.diagramId, null, r.changes, { ...r.layoutReport, choice: run.choice, channel: r.channel }); },
      (err: unknown) => {
        if (run.timedOut) return end("failed", null, `Timed out after ${Math.round(this.opts.timeoutMs / 60_000) || 1} min — try a narrower instruction`);
        if (run.abort.signal.aborted) return end("cancelled", null, null);
        const known = err instanceof EngineError || err instanceof EmptyDiagramError || err instanceof StoryError || err instanceof CoverageError || err instanceof ReadAnswerError || err instanceof DrawError;
        // A product bug: its stack goes to the server log (server.log of a detached server).
        if (!known) console.error(`Run ${id} failed unexpectedly:`, err);
        end("failed", null, known ? (err as Error).message : `Unexpected error: ${(err as Error)?.message ?? String(err)}`);
      },
    );
    // Forget finished runs after an hour so a long-lived server does not grow without bound.
    void run.finished.then(() => setTimeout(() => this.runs.delete(id), 3_600_000).unref());
    return id;
  }

  private async execute(req: StartRun, signal: AbortSignal, progress: (m: string) => void, routed: (route: Route) => void): Promise<{ diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string }> {
    // The root the store checks this drawing's files against, so a repair and a save never disagree.
    const root = this.store.rootOf(req.base.id);
    if (!root) throw new EngineError("This drawing has no repository folder to read");
    const story = storyChannelOf(req);
    if (story) return this.story(req, story, root, signal, progress);
    // The second look (api contract, The second look): on a story channel the channel's story, on the
    // overview an appearance-only draft, both told after looking at the image; it names no route.
    const revise = req.kind === "revise";
    let look: Look | null = null;
    if (revise) {
      if (!req.image) throw new EngineError("A revise needs the drawing's image");
      progress("Looking at the drawing");
      const channel = req.channel ?? "overview";
      const format: FormatId = channel === "linkedin" ? "feed" : channel === "presentation" ? "slide" : "readme";
      const shown = joinChannel(req.stored, channel);
      const view = shown.views.find((v) => v.id === req.view) ?? shown.views[0];
      look = { image: req.image, report: { ...layoutReport(shown, view.id, { ...startSwitches(format, channel === "linkedin"), format, theme: shown.theme }, { map: isMapView(req.stored, view.id) }), channel } };
      if (channel !== "overview") return this.story({ ...req, format, readCode: false, base: storyDraft(req.stored) }, channel, root, signal, progress, look);
    }
    // A simplification may change the overview and the detail it links to, nothing else (api contract).
    const simplify = req.kind === "simplify";
    const scope: RunScope = simplify ? { kind: "all" } : req.scope ?? { kind: "all" };
    // The fixed instruction, augmented by what the user adds (the panel sends the fixed one itself).
    const extra = req.instruction.trim().startsWith(SIMPLIFY_INSTRUCTION) ? req.instruction.trim().slice(SIMPLIFY_INSTRUCTION.length).replace(/^[.\s]+/, "") : req.instruction.trim();
    const instruction = simplify ? (extra ? `${SIMPLIFY_INSTRUCTION}. ${extra}` : SIMPLIFY_INSTRUCTION) : req.instruction;
    // A refine is routed first (api contract, Routing); a parts scope always changes the facts.
    let appearance = revise;
    if ((req.kind ?? "refine") === "refine") {
      const route: Route = scope.kind === "parts" ? "facts" : await this.route(req, root, signal, progress);
      if (signal.aborted) throw new EngineError("Cancelled");
      routed(route);
      progress(route === "facts" ? "Changing the facts" : "Redrawing this channel from the facts");
      const channel = req.channel ?? "overview";
      // Outside the overview the story route is the channel's story run, told from the facts with no code.
      if (route === "story" && channel !== "overview") {
        return this.story({ ...req, kind: "story", readCode: false, base: storyDraft(req.stored) }, channel, root, signal, progress);
      }
      appearance = route === "story";
    }
    const inView = req.base.views.find((v) => v.id === req.view)?.nodes ?? [];
    const parts = scope.kind === "parts" ? scope.ids.map((id) => inView.find((n) => n.id === id)?.label ?? id) : [];
    const base = documentToDraft(req.base);
    const answer = await req.engine.run({
      cwd: root, folderName: basename(root), instruction, view: req.view, model: req.model, scope, parts,
      base, signal, timeoutMs: this.opts.timeoutMs, progress, simplify, appearance,
      ...(look ? {
        image: look.image,
        task: {
          kind: "revise" as const, schema: DRAFT_JSON_SCHEMA, tools: "image" as const, data: { channel: "overview" },
          prompt: reviseOverviewPrompt({ file: look.image.file, report: look.report, instruction: req.instruction, folderName: basename(root), view: req.view, base, facts: req.stored.facts, attached: req.engine.id === "codex" }),
        },
      } : {}),
    });
    if (signal.aborted) throw new EngineError("Cancelled");
    progress("Checking the drawing");
    let doc = answerToDocument(answer, { base: req.base, now: nowIso(), engine: { id: req.engine.id, model: req.model }, fileExists: repoFile(root), scope, view: req.view, facts: req.stored.facts.components.map((c) => c.id), rows: storyRows(req.stored), takenViews: req.stored.ids?.taken });
    if (simplify) doc = keepUnrelatedViews(req.base, doc).doc;
    // The story route on the overview changes how it looks only; each content change is ignored with a warning.
    if (appearance) doc = appearanceOnly(req.base, doc).doc;
    // Never replace a readable drawing with one the store would refuse to read back.
    // The view shape is checked on its own: a LinkedIn view's `postOf` (its post style) names no view of its channel.
    const checked = validateDocument({ ...doc, views: doc.views.map((v) => ({ ...v, postOf: null })) });
    if (!checked.ok) throw new EngineError(`The engine's drawing could not be repaired into a valid document: ${checked.error}`);
    if (signal.aborted) throw new EngineError("Cancelled");
    // The answer is a new state of the run's channel: content goes to the facts, appearance stays in the
    // channel, and the other channels are marked (diagram contract, Writing the answer back). Simplify
    // changes the overview's appearance only.
    const channel = req.channel ?? "overview";
    const split = applyChannel(req.stored, channel, { views: doc.views, title: doc.title, engine: doc.engine, warnings: doc.warnings }, { keepFacts: simplify, answer: true });
    if (!split.ok) throw new EngineError(split.error);
    if (simplify) {
      // After repair and before the save: a fact no part shows fails the run, nothing is saved.
      const missing = missingFacts(req.stored, split.doc);
      if (missing.length) throw new CoverageError(missing);
    }
    // The saved warnings are this run's own, so a clean run leaves none (diagram contract, warnings).
    split.doc.warnings = split.doc.warnings.slice(req.stored.warnings.length);
    const stored = validateDocument3(split.doc);
    if (!stored.ok) throw new EngineError(`The engine's drawing could not be repaired into a valid document: ${stored.error}`);
    // Never overwrite a drawing that changed after the run started (the editor, a session, the CLI).
    const saved = this.store.put(req.base.id, withChoice(req.whole, req.choice, split.doc), { base: req.base.updatedAt, announce: true });
    if (!saved) throw new EngineError("The drawing was removed while the instruction ran.");
    if (!saved.ok) throw new EngineError(saved.conflict ? "The drawing changed while the instruction ran." : `The drawing could not be saved: ${saved.error}`);
    // Counted from the saved file, so the split's own repairs are counted too.
    const added = split.doc.warnings.length;
    progress(added > 0 ? `Saved with ${added} warning${added === 1 ? "" : "s"}` : "Saved");
    // The report measures the saved result, with the format's default switches (api contract, Layout report).
    const format = req.format ?? "readme";
    const view = doc.views.find((v) => v.id === req.view) ?? doc.views[0];
    const report = layoutReport(doc, view.id, { ...startSwitches(format, isPostView(view)), format, theme: doc.theme }, { map: channel === "overview" && isMapView({ ...split.doc, ids: req.stored.ids }, view.id) });
    return { diagramId: req.base.id, changes: diffDocuments(req.base, doc, scope.kind === "all" ? undefined : [req.view]), layoutReport: report, channel, view: req.view };
  }

  /** The routing question (api contract, Routing): asked with no tools; anything but "story" is the facts. */
  private async route(req: StartRun, root: string, signal: AbortSignal, progress: (m: string) => void): Promise<Route> {
    const answer = await req.engine.run({
      cwd: root, folderName: basename(root), instruction: req.instruction, view: req.view, model: req.model, scope: { kind: "view" }, parts: [],
      base: null, signal, timeoutMs: this.opts.timeoutMs, progress,
      task: { kind: "route", schema: ROUTE_SCHEMA, tools: "none", prompt: routePrompt({ channel: req.channel ?? "overview", instruction: req.instruction }) },
    });
    return (answer as { route?: unknown } | null)?.route === "story" ? "story" : "facts";
  }

  /**
   * A story run (a post is one on LinkedIn): the engine tells the channel's story from the facts,
   * code converts, places and measures it. It changes no fact (diagram contract, Story answers).
   */
  private async story(req: StartRun, channel: StoryChannel, root: string, signal: AbortSignal, progress: (m: string) => void, look: Look | null = null) {
    const format: FormatId = channel === "linkedin" ? (req.format === "linkedin" ? "linkedin" : "feed") : channel === "readme" ? "readme" : "slide";
    // A post may read the code unless told not to; any other story reads none unless told to.
    const readCode = req.readCode ?? req.kind === "post";
    // The engine designs from the overview's first view (`base` is the overview's draft).
    const source = req.base.views[0].id;
    const draft = documentToDraft(req.base);
    const current = req.stored.channels[channel].views.length ? documentToDraft(joinChannel(req.stored, channel)) : null;
    const prompt = look
      ? reviseStoryPrompt({ file: look.image.file, report: look.report, instruction: req.instruction, channel, attached: req.engine.id === "codex", folderName: basename(root), view: source, base: current ? { overview: draft, current } : draft, facts: req.stored.facts, format: format as "feed" | "linkedin" })
      : channel === "linkedin"
      ? postPrompt({ folderName: basename(root), view: source, base: draft, facts: req.stored.facts, format: format as "feed" | "linkedin", instruction: req.instruction, readCode })
      : storyPrompt({ channel, folderName: basename(root), view: source, base: current ? { overview: draft, current } : draft, facts: req.stored.facts, instruction: req.instruction, readCode });
    const call = { cwd: root, folderName: basename(root), instruction: req.instruction, view: source, model: req.model, scope: { kind: "view" } as const, parts: [], base: draft, signal, timeoutMs: this.opts.timeoutMs, progress };
    const task = { kind: look ? "revise" as const : channel === "linkedin" ? "post" as const : "story" as const, schema: STORY_SCHEMA, data: { channel, overview: req.base.views[0] } };
    const answer = await req.engine.run({ ...call, ...(look ? { image: look.image } : {}), task: { ...task, tools: look ? "image" : readCode ? "read" : "none", prompt } });
    if (signal.aborted) throw new EngineError("Cancelled");
    progress("Checking the post");
    // One repair turn for an answer with problems: no tools, no image, the same schema (diagram contract).
    const intent = await storyAnswer(answer, {
      channel, progress, check: "Checking the post", signal,
      repair: (prompt) => req.engine.run({ ...call, task: { ...task, tools: "none", prompt, data: { ...task.data, repair: true } } }),
    });
    const { doc, view, warnings } = intentToChannel(req.stored, intent, { portrait: format === "feed", channel });
    const toSave: Document3 = { ...doc, warnings, engine: { id: req.engine.id, model: req.model }, updatedAt: nowIso() };
    if (signal.aborted) throw new EngineError("Cancelled");
    const saved = this.store.put(req.base.id, withChoice(req.whole, req.choice, toSave), { base: req.base.updatedAt, announce: true });
    if (!saved) throw new EngineError("The drawing was removed while the post was designed.");
    if (!saved.ok) throw new EngineError(saved.conflict ? "The drawing changed while the post was designed." : `The drawing could not be saved: ${saved.error}`);
    progress(warnings.length ? `Saved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Saved");
    const after = joinChannel(toSave, channel);
    const report = layoutReport(after, view, { ...startSwitches(format, channel === "linkedin"), format, theme: toSave.theme });
    return { diagramId: req.base.id, changes: diffDocuments(joinChannel(req.stored, channel), after, [view]), layoutReport: report, channel: channel as ChannelId, view };
  }
}

