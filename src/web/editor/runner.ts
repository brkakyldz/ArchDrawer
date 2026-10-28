import { useCallback, useEffect, useRef, useState } from "react";
import type { Changes } from "../../core/diff";
import type { LayoutReport } from "../../core/report";
import { CHANNEL_LABELS, type ChannelId } from "../../core/file3";
import type { Document4 } from "../../core/file4";
import type { DiagramDocument } from "../../core/model";
import type { RunScope } from "../../core/repair";
import { api, ApiError, type EngineInfo } from "../api";

/** Where a run was started: a channel's stage shows its own line for the runs started there; the AI panel shows every run. */
export type RunOrigin = "panel" | "linkedin" | "story";

export interface RunRequest {
  instruction: string;
  /** What the conversation calls a run started by a control, not typed (`Draw it`, a suggestion's label). */
  label?: string;
  /** Typed in `ai-input`: it goes back there when the run fails or is cancelled (ui contract, ai-error). */
  typed?: boolean;
  engine: string | null;
  model: string | null;
  scope: RunScope;
  origin: RunOrigin;
  /** The view the run is for; default the one the editor shows. */
  view?: string;
  /** Edits the stored drawing once the run has succeeded (an undoable edit). */
  after?: (doc: DiagramDocument) => DiagramDocument;
  /** A post run draws the LinkedIn channel (api contract, Run kinds); its instruction may be empty. A simplify run makes the overview a map. */
  kind?: "refine" | "post" | "simplify" | "story" | "revise";
  /** The channel a story draws (README; api contract, Run kinds). */
  channel?: ChannelId;
  format?: "feed" | "linkedin";
  /** A post drawn from the facts alone: the engine reads no file (STORY-1). */
  readCode?: boolean;
  /** A revise's image: the view's share PNG in base64 (ui contract, ai-look-again). */
  image?: string;
  /** Set at the first start, with `channel` and `view`: Try again sends the same request on the same channel and view. */
  frozen?: { postView: string | null; choice?: string | null };
}

export interface RunState {
  status: "idle" | "running" | "failed" | "cancelled" | "succeeded" | "saved";
  req: RunRequest | null;
  id: string | null;
  lines: string[];
  error: string | null;
  changes: Changes | null;
  /** The kept result's layout report, once the run has succeeded (never a previous run's). */
  layoutReport: LayoutReport | null;
  /** The view the run's result is in (a post run's actual post id). */
  view: string | null;
  /** Which way a succeeded refine went (api contract, Routing); null for other kinds. */
  route: Route | null;
}

export type Route = "facts" | "story";
/** What `ai-route` says about a refine's route (ui contract, AI panel). */
export const ROUTE_SENTENCE: Record<Route, string> = {
  facts: "Changed the facts: every channel that shows them shows it",
  story: "Redrew this channel from the facts, without reading the code",
};

/** A turn's state (ui contract, The conversation). */
export type TurnState = "running" | "failed" | "cancelled" | "preview" | "accepted" | "undone" | "unchanged" | "saved";

/** One run started on the open drawing, or one request saved without an engine (ui contract, The conversation). */
export interface Turn {
  key: number;
  req: RunRequest;
  /** `ai-turn-text`: the instruction as sent, or the name of the control that started it. */
  text: string;
  /** `ai-turn-where`: `<channel> · <scope>`. */
  where: string;
  state: TurnState;
  runId: string | null;
  lines: string[];
  error: string | null;
  changes: Changes | null;
  layoutReport: LayoutReport | null;
  route: Route | null;
}

const IDLE: RunState = { status: "idle", req: null, id: null, lines: [], error: null, changes: null, layoutReport: null, view: null, route: null };
export const ENGINE_KEY = "archdraw-engine";
export const modelKey = (engine: string) => `archdraw-model:${engine}`;
const local = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/** How an engine is named in the editor: the fixture is the test engine, never an AI. */
export const engineName = (e: EngineInfo) => (e.test ? "Test engine (no AI)" : e.label);

/** `This view`, `Selected parts (2)` or `The whole channel` (ui contract, ai-scope-*). */
export const scopeLabel = (s: RunScope) => (s.kind === "parts" ? `Selected parts (${s.ids.length})` : s.kind === "all" ? "The whole channel" : "This view");

/**
 * The engine a run uses (ui contract, Choosing the engine): the one last chosen in this browser, if
 * available; else the document's, if available and not the fixture; else the first available real
 * engine; else the fixture, when it is the only one offered.
 */

export function chooseEngine(engines: EngineInfo[], doc: Pick<DiagramDocument, "engine">, chosen = local(ENGINE_KEY)): EngineInfo | null {
  const ok = engines.filter((e) => e.available);
  return ok.find((e) => e.id === chosen) ?? ok.find((e) => e.id === doc.engine?.id && !e.test) ?? ok.find((e) => !e.test) ?? ok[0] ?? null;
}

/** The model remembered for an engine in this browser, when the engine still offers it ("" = Default). */
export function rememberedModel(e: EngineInfo | null): string {
  if (!e) return "";
  const m = local(modelKey(e.id)) ?? "";
  return e.models.some((x) => x.id === m) ? m : "";
}

/** What the editor did with a succeeded run: the state its turn takes. */
export type Outcome = Extract<TurnState, "preview" | "accepted" | "unchanged">;

export interface Done {
  /** The run's turn in the conversation. */
  key: number;
  /** The whole stored document after the run, and the choice the run changed. */
  stored: Document4;
  choice: string;
  changes: Changes | null;
  req: RunRequest;
  route: Route | null;
  /** The channel and view the result is in. */
  channel: ChannelId;
  view: string;
}

interface Options {
  /** The drawing of the channel the canvas shows (`joinChannel`), and that channel. */
  doc: DiagramDocument | null;
  /** The current choice: a run changes it alone. */
  choice: string | null;
  channel: ChannelId;
  vid: string | null;
  settle: () => Promise<boolean>;
  /** A run is about to start (every control's): the editor gets ready for it. */
  onStart?: (req: RunRequest) => void;
  /** A run succeeded: show the stored drawing (undo returns to the one before) and what changed. */
  onUpdated: (done: Done) => Outcome;
  /** An instruction was saved for the next session (no engine). */
  onSaved: () => void;
  /** A run failed or was cancelled. */
  onEnded?: (req: RunRequest) => void;
}

/**
 * One instruction run at a time, shared by the AI panel, the channel stages and the LinkedIn panel,
 * and the conversation of the open drawing: one turn per run or saved request, in memory only.
 */
export function useRunner({ doc, choice, channel, vid, settle, onStart, onUpdated, onSaved, onEnded }: Options) {
  const [state, setState] = useState<RunState>(IDLE);
  const [turns, setTurns] = useState<Turn[]>([]);
  const source = useRef<EventSource | null>(null);
  /** True from the moment a start begins until its run ends: a second start is ignored, never a failure. */
  const busy = useRef(false);
  /** Cancel was pressed before the server gave the run an id. */
  const cancelEarly = useRef(false);
  const nextKey = useRef(0);
  const live = useRef({ doc, choice, channel, vid, onStart, onUpdated, onSaved, onEnded });
  live.current = { doc, choice, channel, vid, onStart, onUpdated, onSaved, onEnded };
  useEffect(() => () => source.current?.close(), []);
  // A drawing's conversation is its own: another drawing starts it empty.
  const docId = doc?.id;
  useEffect(() => setTurns([]), [docId]);

  const patch = useCallback((key: number, p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.key === key ? { ...t, ...p } : t))), []);

  const start = useCallback(async (asked: RunRequest) => {
    const { doc: d } = live.current;
    // A simplification works on the overview, whichever channel the canvas shows (api contract, Run kinds).
    const channel: ChannelId = asked.kind === "simplify" ? "overview" : asked.kind === "post" ? "linkedin" : asked.channel ?? live.current.channel;
    const v = asked.view ?? live.current.vid;
    const instruction = asked.instruction.trim();
    if (!d || !v || (!instruction && asked.kind !== "post" && asked.kind !== "story" && asked.kind !== "revise")) return;
    if (busy.current) return;
    // The channel and view are fixed when a request is first sent, so Try again sends it where it was sent,
    // whichever channel the editor shows then. The canvas shows the overview behind a LinkedIn channel
    // with no view: then a post names none.
    const req: RunRequest = asked.frozen ? asked
      : { ...asked, channel, view: v, frozen: { postView: asked.kind === "post" && live.current.channel === "linkedin" ? d.views[0]?.id ?? null : null, choice: live.current.choice } };
    const choice = req.frozen!.choice ?? live.current.choice;
    if (!choice) return;
    busy.current = true;
    cancelEarly.current = false;
    live.current.onStart?.(req);
    const key = ++nextKey.current;
    setTurns((ts) => [...ts, {
      key, req, text: req.label ?? req.instruction, where: `${CHANNEL_LABELS[channel]} · ${scopeLabel(req.scope)}`, state: "running",
      runId: null, lines: ["Starting"], error: null, changes: null, layoutReport: null, route: null,
    }]);
    // Shown as going at once, so every send control is disabled while the start is on its way.
    setState({ ...IDLE, status: "running", req, lines: ["Starting"] });
    const end = (status: "failed" | "cancelled", error: string, id: string | null = null) => {
      busy.current = false;
      setState({ ...IDLE, status, req, id, error });
      patch(key, { state: status, error, lines: [] });
      live.current.onEnded?.(req);
    };
    const fail = (error: string, id: string | null = null) => end("failed", error, id);
    if (!(await settle())) { fail("Your last edit is not saved yet; the instruction was not sent"); return; }
    if (cancelEarly.current) { end("cancelled", "Cancelled"); return; }
    if (!req.engine) {
      try {
        await api.request(d.id, choice, channel, v, instruction);
        busy.current = false;
        setState({ ...IDLE, status: "saved", req });
        patch(key, { state: "saved", lines: [] });
        live.current.onSaved();
      } catch (e) { fail((e as Error).message); }
      return;
    }
    let id: string;
    try {
      // A post or a story draws a channel's one view: the server designs it from the overview.
      const sent = req.kind === "post" ? req.frozen!.postView : req.kind === "story" ? null : v;
      id = await api.startRun(d.id, choice, channel, sent, instruction, { engine: req.engine, model: req.model, scope: req.scope, kind: req.kind, format: req.format, readCode: req.readCode, image: req.image });
    } catch (e) {
      fail(e instanceof ApiError ? e.message : "Could not start the instruction");
      return;
    }
    setState({ ...IDLE, status: "running", req, id, lines: ["Starting"] });
    patch(key, { runId: id });
    if (cancelEarly.current) void api.cancelRun(id).catch(() => {});
    const es = new EventSource(`/api/runs/${id}/events`);
    source.current = es;
    es.addEventListener("progress", (ev) => {
      const line = (JSON.parse((ev as MessageEvent).data) as { message: string }).message;
      const add = (lines: string[]) => [...lines.filter((x) => x !== "Starting"), line].slice(-12);
      setState((s) => (s.id === id ? { ...s, lines: add(s.lines) } : s));
      setTurns((ts) => ts.map((t) => (t.key === key ? { ...t, lines: add(t.lines) } : t)));
    });
    es.addEventListener("done", async (ev) => {
      es.close();
      source.current = null;
      const r = JSON.parse((ev as MessageEvent).data) as { status: string; error: string | null; changes?: Changes | null; layoutReport?: LayoutReport | null; choice?: string; view?: string; channel?: ChannelId; route?: Route | null };
      const route = r.route === "facts" || r.route === "story" ? r.route : null;
      if (r.status === "succeeded") {
        try {
          const stored = await api.get(d.id);
          busy.current = false;
          const changes = r.changes ?? null, layoutReport = r.layoutReport ?? null;
          setState({ ...IDLE, status: "succeeded", req, id, changes, layoutReport, view: r.view ?? null, route });
          const outcome = live.current.onUpdated({ key, stored, choice: r.choice ?? choice, changes, req, route, channel: r.channel ?? channel, view: r.view ?? v });
          patch(key, { state: outcome, lines: [], changes, layoutReport, route });
        } catch (e) { fail((e as Error).message, id); }
      } else if (r.status === "cancelled") end("cancelled", "Cancelled", id);
      else end("failed", r.error ?? "The instruction failed", id);
    });
    // The browser retries a dropped connection by itself; a refused one (the server restarted and
    // no longer knows the run) closes the stream for good, and `done` never comes.
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || source.current !== es) return;
      source.current = null;
      // Nothing may change the drawing behind the editor's back once the run cannot be followed.
      void api.cancelRun(id).catch(() => {});
      fail("Lost the connection to the instruction, so it was stopped", id);
    };
  }, [settle, patch]);

  const cancel = useCallback(() => {
    if (state.status !== "running") return;
    if (state.id) void api.cancelRun(state.id);
    else cancelEarly.current = true;
  }, [state]);
  const retry = useCallback(() => { if (state.req) void start(state.req); }, [state, start]);
  /** A turn's state after the user chose (accepted, undone). */
  const settleTurn = useCallback((key: number, s: TurnState) => patch(key, { state: s }), [patch]);

  return { state, turns, start, cancel, retry, settleTurn };
}
export type Runner = ReturnType<typeof useRunner>;
