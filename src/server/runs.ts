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
import { choiceKey, DrawError, drawChoices, keptKey, runDraw, type DrawChoice, type DrawRequest, type KeptChoice } from "./draw";
import { EngineSlots, WAITING } from "./slots";
import { storyAnswer } from "./story-turn";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";
export type RunKind = "refine" | "story" | "post" | "simplify" | "revise" | "draw";
/** The stage of a `draw` run (api contract, The draw run); null on other kinds. */
export type DrawStage = "read" | "overview" | "channel";
/** The channels a story is drawn in (a post is a story on LinkedIn). */
export type StoryChannel = Exclude<ChannelId, "overview">;
export type RunEvent =
  | { type: "progress"; message: string; stage: DrawStage | null; choice: string | null; at: string; source: LineSource }
  /** A draw's choice record after a change (api contract, Choice events). */
  | ({ type: "choice" } & DrawChoice)
  | { type: "done"; status: Exclude<RunStatus, "running">; diagramId: string | null; error: string | null; changes: Changes | null; choice: string; channel: ChannelId; view: string; layoutReport: LayoutReport | null; route: Route | null; path: string | null; choices: DrawChoice[] | null };
/** Who wrote a progress line (api contract, Progress lines). */
export type LineSource = "engine" | "server";
/** A run's progress line; it answers the line's `at`. */
type Line = (message: string, stage?: DrawStage | null, choice?: string | null, source?: LineSource) => string;

export interface RunRecord {
  id: string;
  /** What the run does (api contract, Run kinds). */
  kind: RunKind;
  /** The choice the run changes (api contract, Run record); a draw's first choice, then the one its result shows. */
  choice: string;
  /** The channel and view the run worked on; on success, the resulting ones. */
  channel: ChannelId;
  view: string;
  status: RunStatus;
  progress: string[];
  /** The latest progress line, null before the first. */
  message: string | null;
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
  /** A `draw`'s choices in the draw's order with their state (api contract, Run record); null on other kinds. */
  choices: DrawChoice[] | null;
  /** When it was accepted, took its slot (a draw: its earliest choice's), ended. */
  createdAt: string; startedAt: string | null; endedAt: string | null;
  /** While it waits for a slot (a draw: no choice running, one waiting, not writing). */
  waiting: boolean;
  /** The `at` of its latest engine line. */
  lastEngineEventAt: string | null;
  /** A draw's own fields (api contract, Run record), null on other kinds (`writing` false). */
  folder: string | null; root: string | null; link: string | null; name: string | null; scan: string | null;
  writing: boolean; into: string | null; retryOf: string | null;
}

interface Run extends RunRecord {
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
  abort: AbortController;
  finished: Promise<void>;
  timedOut: boolean;
  /** The drawing this run works on. */
  target: string;
  /** A draw's request, for `Try again`. */
  draw: DrawRequest | null;
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

type Result = { diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string; choice?: string };

/** Runs one instruction-box call or one draw end to end and keeps its event log for replay over SSE. */
export class RunManager {
  private readonly runs = new Map<string, Run>();
  /** The server's engine slots, shared with the scans (api contract, Engine slots). */
  readonly slots: EngineSlots;

  constructor(
    private readonly store: Store,
    private readonly opts: { timeoutMs: number; slots?: EngineSlots },
  ) {
    this.slots = opts.slots ?? new EngineSlots(3);
  }

  get(id: string): RunRecord | null {
    const r = this.runs.get(id);
    if (!r) return null;
    const choices = r.choices ? r.choices.map((c) => ({ ...c })) : null;
    // A draw has started with its first choice, and waits while nothing of it runs and a choice is queued.
    const starts = (choices ?? []).map((c) => c.startedAt).filter((t): t is string => !!t).sort();
    const waiting = choices
      ? r.status === "running" && !r.writing && !choices.some((c) => c.status === "running") && choices.some((c) => c.status === "waiting")
      : r.waiting;
    return {
      id: r.id, kind: r.kind, choice: r.choice, channel: r.channel, view: r.view, status: r.status, progress: [...r.progress], message: r.message,
      diagramId: r.diagramId, error: r.error, engine: r.engine, model: r.model, changes: r.changes, layoutReport: r.layoutReport, route: r.route, path: r.path,
      choices, createdAt: r.createdAt, startedAt: choices ? starts[0] ?? null : r.startedAt, endedAt: r.endedAt, waiting, lastEngineEventAt: r.lastEngineEventAt,
      folder: r.folder, root: r.root, link: r.link, name: r.name, scan: r.scan, writing: r.writing, into: r.into, retryOf: r.retryOf,
    };
  }

  /** A draw's request, for `Try again` (api contract, Trying again); null for an unknown run or another kind. */
  drawOf(id: string): DrawRequest | null {
    return this.runs.get(id)?.draw ?? null;
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

  /** Cancel: a waiting run leaves the queue; a running one's engines are killed. A draw that is writing goes on. */
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
      ({ signal, line, run }) => this.execute(req, signal, (m, source) => void line(m, null, null, source), (route) => (run.route = route)),
      // A revise's image goes once the run has ended — succeeded, failed, cancelled (a waiting one too) or timed
      // out — and, since every engine call settles only after its process tree has exited, after the engine is gone.
      () => { if (req.image) removeReviseFolder(req.image.dir); },
    );
  }

  /** The running draw of a folder, if any (one at a time per folder). */
  drawingOn(folderKey: string): string | null {
    return this.runningOn(`folder:${folderKey}`);
  }

  /**
   * Start a `draw` run (api contract, The draw run): its choices side by side in the engine slots, then one file
   * holding every choice that finished — a new one, or the one a `Try again` adds to (`into`).
   */
  startDraw(req: DrawRequest): string {
    // What the folder's last failed draw kept, if this draw asks the same (api contract, What a failed draw keeps).
    const key = keptKey(req);
    const last = this.kept.get(req.folderKey);
    const kept = last && last.key === key ? last.records : null;
    const done = new Map<string, KeptChoice>();
    // A choice of a `Try again` that the file already holds gets `-2`, `-3`, … (api contract, Trying again).
    const held = req.into ? this.store.get(req.into)?.choices.map((c) => c.id) ?? [] : [];
    const choices = drawChoices(req.focuses, req.ids, held);
    const keyOf = new Map(choices.map((c, i) => [c.id, choiceKey(req.focuses[i])]));
    return this.launch(
      {
        kind: "draw", choice: choices[0].id, channel: req.channel, view: req.channel, engine: req.engine.id, model: req.model, target: `folder:${req.folderKey}`, choices,
        draw: { ...req, ids: choices.map((c) => c.id) }, folder: req.folder.folder, root: req.folder.root, link: req.link ?? null, name: req.card.name, scan: req.scan,
        into: req.into ?? null, retryOf: req.retryOf ?? null,
      },
      ({ signal, line, run, choice }) => runDraw(req, {
        store: this.store, slots: this.slots, timeoutMs: this.opts.timeoutMs, signal, line, choices, kept, done,
        changed: choice, writing: () => (run.writing = true), wrote: (path) => (run.path = path),
      }).then(
        (r) => { this.keep(req.folderKey, key, done, choices.filter((c) => c.status === "failed").map((c) => keyOf.get(c.id)!), choices.filter((c) => c.status === "done").map((c) => keyOf.get(c.id)!)); return r; },
        (err: unknown) => { this.keep(req.folderKey, key, done, [...done.keys()], []); throw err; },
      ),
    );
  }

  /** One entry per folder: what its draws that ended without drawing a choice had finished, per choice as requested. */
  private readonly kept = new Map<string, { key: string; records: Map<string, KeptChoice> }>();

  /**
   * After a draw (api contract, What a failed draw keeps): the records of the choices `keeping` names that got past
   * their read are added to the folder's entry when it is for the same scan, engine and model (a choice's newer record
   * replaces its older one), else they replace it; the records of the choices the draw wrote leave the entry. An
   * entry left with none goes, and an entry goes an hour after the last draw that added to it.
   */
  private keep(folderKey: string, key: string, done: Map<string, KeptChoice>, keeping: string[], written: string[]) {
    const fresh = [...done].filter(([k, v]) => keeping.includes(k) && v.read !== undefined);
    const last = this.kept.get(folderKey);
    let entry = last && last.key === key ? last : null;
    if (fresh.length) {
      entry = { key, records: new Map(entry ? entry.records : []) };
      for (const [k, v] of fresh) entry.records.set(k, v);
      this.kept.set(folderKey, entry);
      const added = entry;
      setTimeout(() => { if (this.kept.get(folderKey) === added) this.kept.delete(folderKey); }, KEPT_MS).unref();
    }
    if (!entry) return;
    for (const k of written) entry.records.delete(k);
    if (!entry.records.size && this.kept.get(folderKey) === entry) this.kept.delete(folderKey);
  }

  /**
   * A run's life. A draw's choices take their slots themselves; any other run takes one first, saying `Waiting for a
   * free engine` when it has to wait, and its deadline starts once it has it (api contract, Engine slots). Cancel takes
   * a waiting run out of the queue. `cleanup` runs once the run is over, its engines gone.
   */
  private launch(
    init: Pick<RunRecord, "kind" | "choice" | "channel" | "view" | "engine" | "model"> & { target: string; choices?: DrawChoice[]; draw?: DrawRequest }
      & Partial<Pick<RunRecord, "folder" | "root" | "link" | "name" | "scan" | "into" | "retryOf">>,
    exec: (tools: { signal: AbortSignal; line: Line; run: Run; choice: (c: DrawChoice) => void }) => Promise<Result>,
    cleanup: () => void = () => {},
  ): string {
    const id = `r_${randomBytes(6).toString("hex")}`;
    let resolveFinished!: () => void;
    const run: Run = {
      id, kind: init.kind, choice: init.choice, channel: init.channel, view: init.view,
      status: "running", progress: [], message: null, diagramId: null, error: null, engine: init.engine, model: init.model,
      changes: null, layoutReport: null, route: null, path: null, target: init.target, choices: init.choices ?? null,
      createdAt: nowIso(), startedAt: null, endedAt: null, waiting: false, lastEngineEventAt: null,
      folder: init.folder ?? null, root: init.root ?? null, link: init.link ?? null, name: init.name ?? null, scan: init.scan ?? null,
      writing: false, into: init.into ?? null, retryOf: init.retryOf ?? null, draw: init.draw ?? null,
      events: [], listeners: new Set(), abort: new AbortController(),
      finished: new Promise((r) => (resolveFinished = r)), timedOut: false,
    };
    let deadline: NodeJS.Timeout | undefined;
    this.runs.set(id, run);
    const emit = (e: RunEvent) => {
      run.events.push(e);
      for (const l of run.listeners) l(e);
    };
    const line: Line = (message, stage = null, choice = null, source = "server") => {
      const at = nowIso();
      if (run.status !== "running") return at;
      run.progress.push(message);
      run.message = message;
      if (source === "engine") run.lastEngineEventAt = at;
      emit({ type: "progress", message, stage, choice, at, source });
      return at;
    };
    const choiceEvent = (c: DrawChoice) => { if (run.status === "running") emit({ type: "choice", ...c }); };
    const end = (status: Exclude<RunStatus, "running">, diagramId: string | null, error: string | null, changes: Changes | null = null, report: LayoutReport | null = null) => {
      clearTimeout(deadline);
      // A path is the file a run wrote: only a succeeded draw has one (api contract, Run record).
      if (status !== "succeeded") run.path = null;
      run.status = status;
      // `writing` lasts until the run ends (api contract, Run record).
      run.waiting = false;
      run.writing = false;
      run.endedAt = nowIso();
      run.diagramId = diagramId;
      run.error = error;
      run.changes = changes;
      run.layoutReport = report;
      emit({ type: "done", status, diagramId, error, changes, choice: run.choice, channel: run.channel, view: run.view, layoutReport: report, route: run.route, path: run.path, choices: run.choices ? run.choices.map((c) => ({ ...c })) : null });
      run.listeners.clear();
      resolveFinished();
    };
    const tools = { signal: run.abort.signal, line, run, choice: choiceEvent };
    const go = async (): Promise<Result> => {
      if (run.choices) return exec(tools);
      const ticket = await this.slots.take(run.abort.signal, () => { run.waiting = true; line(WAITING); });
      run.waiting = false;
      run.startedAt = nowIso();
      deadline = setTimeout(() => { run.timedOut = true; run.abort.abort(); }, this.opts.timeoutMs);
      deadline.unref?.();
      try { return await exec(tools); } finally { ticket.release(); }
    };
    void go().finally(cleanup).then(
      // The report names the choice and channel it measured (api contract, Layout report).
      (r) => {
        if (r.choice) run.choice = r.choice;
        run.channel = r.channel; run.view = r.view;
        end("succeeded", r.diagramId, null, r.changes, { ...r.layoutReport, choice: run.choice, channel: r.channel });
      },
      (err: unknown) => {
        if (run.timedOut) return end("failed", null, `Timed out after ${Math.round(this.opts.timeoutMs / 60_000) || 1} min — try a narrower instruction`);
        // A cancel asked while a draw writes its file changes nothing (api contract, The draw run).
        if (run.abort.signal.aborted && !run.writing) return end("cancelled", null, null);
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

  private async execute(req: StartRun, signal: AbortSignal, progress: (m: string, source?: LineSource) => void, routed: (route: Route) => void): Promise<{ diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string }> {
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
      base, signal, timeoutMs: this.opts.timeoutMs, progress: (m) => progress(m, "engine"), simplify, appearance,
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
    // Requests may name views of other channels: they are checked with the whole file below.
    const checked = validateDocument({ ...doc, requests: [], views: doc.views.map((v) => ({ ...v, postOf: null })) });
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
  private async route(req: StartRun, root: string, signal: AbortSignal, progress: (m: string, source?: LineSource) => void): Promise<Route> {
    const answer = await req.engine.run({
      cwd: root, folderName: basename(root), instruction: req.instruction, view: req.view, model: req.model, scope: { kind: "view" }, parts: [],
      base: null, signal, timeoutMs: this.opts.timeoutMs, progress: (m) => progress(m, "engine"),
      task: { kind: "route", schema: ROUTE_SCHEMA, tools: "none", prompt: routePrompt({ channel: req.channel ?? "overview", instruction: req.instruction }) },
    });
    return (answer as { route?: unknown } | null)?.route === "story" ? "story" : "facts";
  }

  /**
   * A story run (a post is one on LinkedIn): the engine tells the channel's story from the facts,
   * code converts, places and measures it. It changes no fact (diagram contract, Story answers).
   */
  private async story(req: StartRun, channel: StoryChannel, root: string, signal: AbortSignal, progress: (m: string, source?: LineSource) => void, look: Look | null = null) {
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
    const call = { cwd: root, folderName: basename(root), instruction: req.instruction, view: source, model: req.model, scope: { kind: "view" } as const, parts: [], base: draft, signal, timeoutMs: this.opts.timeoutMs, progress: (m: string) => progress(m, "engine") };
    const task = { kind: look ? "revise" as const : channel === "linkedin" ? "post" as const : "story" as const, schema: STORY_SCHEMA, data: { channel, overview: req.base.views[0] } };
    const answer = await req.engine.run({ ...call, ...(look ? { image: look.image } : {}), task: { ...task, tools: look ? "image" : readCode ? "read" : "none", prompt } });
    if (signal.aborted) throw new EngineError("Cancelled");
    progress("Checking the post");
    // One repair turn for an answer with problems: no tools, no image, the same schema (diagram contract).
    const intent = await storyAnswer(answer, {
      channel, progress: (m) => progress(m), check: "Checking the post", signal,
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

