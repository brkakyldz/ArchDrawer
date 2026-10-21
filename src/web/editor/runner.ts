import { useCallback, useEffect, useRef, useState } from "react";
import type { Changes } from "../../core/diff";
import type { LayoutReport } from "../../core/report";
import type { ChannelId, Document3 } from "../../core/file3";
import type { DiagramDocument } from "../../core/model";
import type { RunScope } from "../../core/repair";
import { api, ApiError, type EngineInfo } from "../api";

/** Where a run was started: each place shows its own error and summary; every place shows a run going. */
export type RunOrigin = "ask" | "panel" | "linkedin";

export interface RunRequest {
  instruction: string;
  engine: string | null;
  model: string | null;
  scope: RunScope;
  origin: RunOrigin;
  /** The view the run is for; default the one the editor shows. */
  view?: string;
  /** Edits the stored drawing once the run has succeeded (an undoable edit). */
  after?: (doc: DiagramDocument) => DiagramDocument;
  /** A post run draws the LinkedIn channel (api contract, Run kinds); its instruction may be empty. A simplify run makes the overview a map. */
  kind?: "refine" | "post" | "simplify" | "story";
  /** The channel a story draws (README or presentation; api contract, Run kinds). */
  channel?: ChannelId;
  format?: "feed" | "linkedin";
  /** A post drawn from the facts alone: the engine reads no file (STORY-1). */
  readCode?: boolean;
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
/** What `ai-route` and the ask box's toast say about a refine's route (ui contract, AI panel). */
export const ROUTE_SENTENCE: Record<Route, string> = {
  facts: "Changed the facts: every channel that shows them shows it",
  story: "Redrew this channel from the facts, without reading the code",
};

const IDLE: RunState = { status: "idle", req: null, id: null, lines: [], error: null, changes: null, layoutReport: null, view: null, route: null };
export const ENGINE_KEY = "archdraw-engine";
export const modelKey = (engine: string) => `archdraw-model:${engine}`;
const local = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/** How an engine is named in the editor: the fixture is the test engine, never an AI. */
export const engineName = (e: EngineInfo) => (e.test ? "Test engine (no AI)" : e.label);

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

interface Options {
  /** The drawing of the channel the canvas shows (`joinChannel`), and that channel. */
  doc: DiagramDocument | null;
  channel: ChannelId;
  vid: string | null;
  settle: () => Promise<boolean>;
  /** A run succeeded: show the stored drawing (undo returns to the one before) and what changed. */
  onUpdated: (doc: Document3, changes: Changes | null, req: RunRequest, route: Route | null) => void;
  /** An instruction was saved for the next session (no engine). */
  onSaved: () => void;
}

/** One instruction run at a time, shared by the ask box, the AI panel and the LinkedIn channel. */
export function useRunner({ doc, channel, vid, settle, onUpdated, onSaved }: Options) {
  const [state, setState] = useState<RunState>(IDLE);
  const source = useRef<EventSource | null>(null);
  /** True from the moment a start begins until its run ends: a second start is ignored, never a failure. */
  const busy = useRef(false);
  /** Cancel was pressed before the server gave the run an id. */
  const cancelEarly = useRef(false);
  const live = useRef({ doc, channel, vid, onUpdated, onSaved });
  live.current = { doc, channel, vid, onUpdated, onSaved };
  useEffect(() => () => source.current?.close(), []);

  const start = useCallback(async (req: RunRequest) => {
    const { doc: d } = live.current;
    // A simplification works on the overview, whichever channel the canvas shows (api contract, Run kinds).
    const channel: ChannelId = req.kind === "simplify" ? "overview" : req.channel ?? live.current.channel;
    const v = req.view ?? live.current.vid;
    const instruction = req.instruction.trim();
    if (!d || !v || (!instruction && req.kind !== "post" && req.kind !== "story")) return;
    if (busy.current) return;
    busy.current = true;
    cancelEarly.current = false;
    // Shown as going at once, so every send control is disabled while the start is on its way.
    setState({ ...IDLE, status: "running", req, lines: ["Starting"] });
    const fail = (error: string) => { busy.current = false; setState({ ...IDLE, status: "failed", req, error }); };
    if (!(await settle())) { fail("Your last edit is not saved yet; the instruction was not sent"); return; }
    if (cancelEarly.current) { busy.current = false; setState({ ...IDLE, status: "cancelled", req, error: "Cancelled" }); return; }
    if (!req.engine) {
      try {
        await api.request(d.id, channel, v, instruction);
        busy.current = false;
        setState({ ...IDLE, status: "saved", req });
        live.current.onSaved();
      } catch (e) { fail((e as Error).message); }
      return;
    }
    let id: string;
    try {
      // A post names the LinkedIn channel's view when there is one; the server designs it from the overview.
      // A post or a story draws a channel's one view: the server designs it from the overview.
      const sent = req.kind === "post" ? (channel === "linkedin" ? d.views[0]?.id ?? null : null) : req.kind === "story" ? null : v;
      id = await api.startRun(d.id, channel, sent, instruction, { engine: req.engine, model: req.model, scope: req.scope, kind: req.kind, format: req.format, readCode: req.readCode });
    } catch (e) {
      fail(e instanceof ApiError ? e.message : "Could not start the instruction");
      return;
    }
    setState({ ...IDLE, status: "running", req, id, lines: ["Starting"] });
    if (cancelEarly.current) void api.cancelRun(id).catch(() => {});
    const es = new EventSource(`/api/runs/${id}/events`);
    source.current = es;
    es.addEventListener("progress", (ev) => {
      const line = (JSON.parse((ev as MessageEvent).data) as { message: string }).message;
      setState((s) => (s.id === id ? { ...s, lines: [...s.lines.filter((x) => x !== "Starting"), line].slice(-12) } : s));
    });
    es.addEventListener("done", async (ev) => {
      es.close();
      source.current = null;
      const r = JSON.parse((ev as MessageEvent).data) as { status: string; error: string | null; changes?: Changes | null; layoutReport?: LayoutReport | null; view?: string; route?: Route | null };
      const route = r.route === "facts" || r.route === "story" ? r.route : null;
      if (r.status === "succeeded") {
        try {
          const stored = await api.get(d.id);
          busy.current = false;
          setState({ ...IDLE, status: "succeeded", req, id, changes: r.changes ?? null, layoutReport: r.layoutReport ?? null, view: r.view ?? null, route });
          live.current.onUpdated(stored, r.changes ?? null, req, route);
        } catch (e) { fail((e as Error).message); }
      } else if (r.status === "cancelled") { busy.current = false; setState({ ...IDLE, status: "cancelled", req, id, error: "Cancelled" }); }
      else fail(r.error ?? "The instruction failed");
    });
    // The browser retries a dropped connection by itself; a refused one (the server restarted and
    // no longer knows the run) closes the stream for good, and `done` never comes.
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || source.current !== es) return;
      source.current = null;
      // Nothing may change the drawing behind the editor's back once the run cannot be followed.
      void api.cancelRun(id).catch(() => {});
      fail("Lost the connection to the instruction, so it was stopped");
    };
  }, [settle]);

  const cancel = useCallback(() => {
    if (state.status !== "running") return;
    if (state.id) void api.cancelRun(state.id);
    else cancelEarly.current = true;
  }, [state]);
  const retry = useCallback(() => { if (state.req) void start(state.req); }, [state, start]);
  const clear = useCallback(() => setState((s) => (s.status === "running" ? s : IDLE)), []);

  return { state, start, cancel, retry, clear };
}
export type Runner = ReturnType<typeof useRunner>;
