import { EngineError, type Engine, type EngineInfo, type EngineRunRequest } from "./types";

export const FIXTURE_STEPS = ["Reading the drawing", "Reading the code", "Updating the drawing"] as const;
export const FIXTURE_MODELS = [{ id: "fixture-fast", label: "Fast (test)" }, { id: "fixture-careful", label: "Careful (test)" }];

interface Box { x: number; y: number; w: number; h: number }
interface DraftNode { id: string; label: string; kind: string; form: string; icon: string | null; sub: string; items: string[]; description: string; files: string[]; parent: string | null; detail: string | null; place: { row: number; col: number } | null; lane?: unknown; from?: string[]; box?: Box; at?: { x: number; y: number } | null }
interface DraftEdge { from: string; to: string; label: string; style: string; both: boolean; step: number | null }
interface DraftView { id: string; title: string; caption: { title: string; lede: string }; nodes: DraftNode[]; edges: DraftEdge[]; relayout?: string[] }
interface Draft { title: string; views: DraftView[] }

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new EngineError("Cancelled"));
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new EngineError("Cancelled")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });

const byLabel = (v: DraftView, label: string) => v.nodes.find((n) => n.label.toLowerCase() === label.trim().toLowerCase());

/**
 * The fixture engine's answer (testing contract): the instruction's first line applied to the
 * run's view of the current drawing's draft. Every component answers `at: null` (kept where it is)
 * except the one a `move` or `align` places. Pure; the run pipeline repairs and saves it.
 */
export function fixtureAnswer(base: unknown, viewId: string, instruction: string): Draft {
  const draft = structuredClone(base) as Draft;
  for (const v of draft.views) {
    v.relayout = [];
    for (const n of v.nodes) n.at = null;
  }
  const view = draft.views.find((v) => v.id === viewId) ?? draft.views[0];
  if (!view) return strip(draft);
  const line = instruction.split(/\r?\n/)[0].replace(/\[fixture:[a-z]+\]/g, "").trim();
  let m: RegExpExecArray | null;
  if ((m = /^add\s+(.+)$/i.exec(line))) {
    const label = m[1].trim().replace(/\s+component$/i, "");
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "added";
    const first = view.nodes[0];
    view.nodes.push({ id, label, kind: "service", form: "card", icon: null, sub: "", items: [], description: "Added by the fixture engine.", files: [], parent: null, detail: null, place: null, at: null });
    if (first) view.edges.push({ from: first.id, to: id, label: "", style: "call", both: false, step: null });
  } else if ((m = /^remove\s+(.+)$/i.exec(line))) {
    const n = byLabel(view, m[1]);
    if (n) {
      view.nodes = view.nodes.filter((x) => x !== n);
      view.edges = view.edges.filter((e) => e.from !== n.id && e.to !== n.id);
    }
  } else if ((m = /^rename\s+(.+?)\s+to\s+(.+)$/i.exec(line))) {
    const n = byLabel(view, m[1]);
    if (n) n.label = m[2].trim();
  } else if ((m = /^hold\s+(.+?)\s+in\s+(.+)$/i.exec(line))) {
    const n = byLabel(view, m[2]);
    if (n) { n.items.push(m[1].trim()); if (n.form !== "group") n.form = "panel"; }
  } else if ((m = /^move\s+(.+?)\s+(right of|below)\s+(.+)$/i.exec(line))) {
    const a = byLabel(view, m[1]), b = byLabel(view, m[3]);
    if (a && b?.box) a.at = m[2].toLowerCase() === "below" ? { x: b.box.x, y: b.box.y + b.box.h + 64 } : { x: b.box.x + b.box.w + 64, y: b.box.y };
  } else if ((m = /^align\s+(.+?)\s+with\s+(.+)$/i.exec(line))) {
    const a = byLabel(view, m[1]), b = byLabel(view, m[2]);
    if (a?.box && b?.box) a.at = { x: a.box.x, y: b.box.y };
  }
  if (instruction.includes("[fixture:invalid]") && view.nodes[0]) {
    view.nodes.push({ ...structuredClone(view.nodes[0]), label: "Duplicate", place: null, parent: null, detail: null, at: null });
    view.edges.push({ from: view.nodes[0].id, to: "ghost", label: "", style: "call", both: false, step: null });
  }
  return strip(draft);
}

/** The answer carries no `box` (diagram contract, The instruction engine's answer). */
function strip(d: Draft): Draft {
  for (const v of d.views) for (const n of v.nodes) delete n.box;
  return d;
}

/** The deterministic stand-in engine of docs/contracts/testing.md. */
export class FixtureEngine implements Engine {
  readonly id = "fixture";
  readonly label = "Fixture (test)";
  constructor(private readonly stepMs: number) {}

  async detect(): Promise<EngineInfo> {
    return { id: this.id, label: this.label, available: true, version: "2.0.0", detail: "Deterministic test engine, no model", test: true, models: FIXTURE_MODELS };
  }

  async run(req: EngineRunRequest): Promise<unknown> {
    if (req.instruction.includes("[fixture:slow]")) {
      for (let i = 1; i <= 30; i++) {
        await sleep(2000, req.signal);
        req.progress(`Working ${i}/30`);
      }
    }
    if (req.model) req.progress(`Using model ${req.model}`);
    for (const step of FIXTURE_STEPS) {
      await sleep(this.stepMs, req.signal);
      req.progress(step);
    }
    // One step after the last message too, so each line is on screen for a step (testing contract, Progress).
    await sleep(this.stepMs, req.signal);
    if (req.instruction.includes("[fixture:fail]")) throw new EngineError("Fixture failure requested");
    if (req.task?.kind === "post") return fixturePost(req.base, req.view, req.instruction);
    if (req.simplify) return fixtureSimplify(req.base, req.instruction);
    return fixtureAnswer(req.base, req.view, req.instruction);
  }
}

/**
 * The canned simplification (testing contract): the overview becomes one group, "System map", whose
 * detail is a new view "Inside the system" holding every component the overview had, with its
 * connections, placed again. A repeat finds the map already there and changes nothing.
 */
export function fixtureSimplify(base: unknown, instruction: string): Draft {
  const draft = structuredClone(base) as Draft;
  for (const v of draft.views) {
    v.relayout = [];
    for (const n of v.nodes) n.at = null;
  }
  const overview = draft.views[0];
  if (!overview) return strip(draft);
  const [only] = overview.nodes;
  if (overview.nodes.length === 1 && only.form === "group" && only.detail && draft.views.some((v) => v.id === only.detail)) return strip(draft);
  const taken = new Set<string>(draft.views.flatMap((v) => [v.id, ...v.nodes.map((n) => n.id)]));
  const fresh = (want: string) => { let id = want; for (let i = 2; taken.has(id); i++) id = `${want}-${i}`; taken.add(id); return id; };
  const viewId = fresh("inside-the-system"), groupId = fresh("system-map");
  let nodes = overview.nodes, edges = overview.edges;
  if (instruction.includes("[fixture:lose]") && nodes.length) {
    const last = nodes[nodes.length - 1].id;
    nodes = nodes.filter((n) => n.id !== last);
    edges = edges.filter((e) => e.from !== last && e.to !== last);
  }
  const files = [...new Set(overview.nodes.flatMap((n) => n.files))];
  const detail: DraftView = { id: viewId, title: "Inside the system", caption: { title: "Inside the system", lede: "" }, nodes, edges, relayout: nodes.map((n) => n.id) };
  if (instruction.includes("[fixture:invalid]") && nodes[0]) {
    nodes.push({ ...structuredClone(nodes[0]), label: "Duplicate", place: null, parent: null, detail: null, at: null });
    edges.push({ from: nodes[0].id, to: "ghost", label: "", style: "call", both: false, step: null });
  }
  overview.nodes = [{
    id: groupId, label: "System map", kind: "service", form: "group", icon: null, sub: "", items: [],
    description: "The whole system; open it for its parts.", files, parent: null, detail: viewId, place: null,
    lane: { spine: 0 }, from: [], at: null,
  }];
  overview.edges = [];
  draft.views.push(detail);
  return strip(draft);
}

/** The canned story intent (testing contract): the same story every time, its spine labels empty. */
export const CANNED_INTENT = {
  title: "How a request becomes a result",
  lede: "A request enters the app, is checked, and produces a result.",
  zones: [{ id: "runtime", label: "App runtime" }],
  parts: [
    { id: "request", label: "Request", sub: "start the work", kind: "client", chips: [], zone: null, spine: 0, anchor: null, side: null, from: [] },
    { id: "intake", label: "Request intake", sub: "check the request", kind: "api", chips: ["Validate input", "Bind the scope"], zone: null, spine: 1, anchor: null, side: null, from: [] },
    { id: "loop", label: "Work loop", sub: "choose the next action", kind: "llm", chips: ["Propose action", "Read tool result"], zone: "runtime", spine: 2, anchor: null, side: null, from: [] },
    { id: "result", label: "Result", sub: "deliver the outcome", kind: "service", chips: [], zone: null, spine: 3, anchor: null, side: null, from: [] },
    { id: "facts", label: "Stored facts", sub: "keep the current state", kind: "data", chips: [], zone: "runtime", spine: null, anchor: "loop", side: "below", from: [] },
    { id: "approval", label: "Approval", sub: "review the action", kind: "actor", chips: [], zone: null, spine: null, anchor: "result", side: "above", from: [] },
  ],
  edges: [
    { from: "request", to: "intake", label: "", style: "call", step: 1 },
    { from: "intake", to: "loop", label: "", style: "call", step: 2 },
    { from: "loop", to: "result", label: "", style: "call", step: 3 },
    { from: "loop", to: "facts", label: "", style: "dep", step: null },
    { from: "result", to: "approval", label: "review", style: "async", step: null },
    { from: "approval", to: "result", label: "decision", style: "call", step: null },
  ],
};

/** The fixture's post: part i stands for the source view's component i; markers per the testing contract. */
function fixturePost(base: unknown, view: string, instruction: string): unknown {
  const intent = structuredClone(CANNED_INTENT) as unknown as { parts: { from: string[]; label: string }[]; edges: Record<string, unknown>[] };
  const src = ((base as { views?: { id: string; nodes?: { id: string }[] }[] }).views ?? []).find((v) => v.id === view);
  intent.parts.forEach((p, i) => { const id = src?.nodes?.[i]?.id; p.from = id ? [id] : []; });
  if (instruction.includes("[fixture:long]")) intent.parts[0].label = "A deliberately longer request name";
  if (instruction.includes("[fixture:invalid]")) intent.edges.push({ from: "request", to: "ghost", label: "", style: "call", step: null });
  return intent;
}
