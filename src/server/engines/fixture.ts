import { readFileSync } from "node:fs";
import { EngineError, type Engine, type EngineInfo, type EngineRunRequest } from "./types";
import type { DiagramView } from "../../core/model";
import { PNG_SIGNATURE } from "./revise";

export const FIXTURE_STEPS = ["Reading the drawing", "Reading the code", "Updating the drawing"] as const;
export const FIXTURE_MODELS = [{ id: "fixture-fast", label: "Fast (test)" }, { id: "fixture-careful", label: "Careful (test)" }];

interface Box { x: number; y: number; w: number; h: number }
interface DraftNode { id: string; label: string; kind: string; form: string; icon: string | null; sub: string; items: string[]; description: string; files: string[]; parent: string | null; detail: string | null; place: { row: number; col: number } | null; lane?: unknown; facts?: string[]; box?: Box; at?: { x: number; y: number } | null }
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

/** Whether a file exists and starts with the PNG signature. */
function isPng(file: string | undefined): boolean {
  if (!file) return false;
  try { return readFileSync(file).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE); } catch { return false; }
}

/**
 * The second look on the overview (testing contract, Revise): the view as it is, but its first top-level
 * component that is not a group moves 40 px right of where it is. A view with none changes nothing.
 */
export function fixtureNudge(base: unknown, viewId: string): Draft {
  const draft = structuredClone(base) as Draft;
  for (const v of draft.views) {
    v.relayout = [];
    for (const n of v.nodes) n.at = null;
  }
  const view = draft.views.find((v) => v.id === viewId) ?? draft.views[0];
  const first = view?.nodes.find((n) => !n.parent && n.form !== "group");
  if (first?.box) first.at = { x: first.box.x + 40, y: first.box.y };
  return strip(draft);
}

/** The answer carries no `box` (diagram contract, The instruction engine's answer). */
function strip(d: Draft): Draft {
  for (const v of d.views) for (const n of v.nodes) delete n.box;
  return d;
}

/** The suggestions whose instruction the fixture hears as a story (testing contract, Routing; ui contract, Suggestions). */
export const STORY_SUGGESTIONS = ["Make it shorter for LinkedIn", "Show fewer details", "Use fewer steps"] as const;

/** The fixture's answer to a refine's routing question: the story marker or a story suggestion, else the facts. */
export function fixtureRoute(instruction: string): "facts" | "story" {
  const text = instruction.trim();
  return instruction.includes("[fixture:story]") || STORY_SUGGESTIONS.some((s) => text.startsWith(s)) ? "story" : "facts";
}

const OVERLONG = "[fixture:overlong]", STUBBORN = "[fixture:stubborn]";
/** The markers a repair turn answers without (testing contract, Markers). */
const unbreak = (text: string) => text.split(OVERLONG).join("").split("[fixture:invalid]").join("");
/** The draw stages `[fixture:flaky:<stage>]` has failed once, per folder, for the life of this server process. */
const FLAKED = new Set<string>();
/** The lede of `[fixture:overlong]`: the sentence repeated until it is 250 characters. */
export const OVERLONG_LEDE = (() => {
  const s = "Drawn by the test engine, with a description written far past the limit a story answer may hold.";
  let t = s;
  while (t.length < 250) t += ` ${s}`;
  return t.slice(0, 250);
})();
/** A story answer with `[fixture:overlong]`'s lede; any other answer as it is. */
function overlong<T>(answer: T, on: boolean): T {
  const a = answer as { lede?: unknown; parts?: unknown };
  return on && a && typeof a.lede === "string" && Array.isArray(a.parts) ? { ...answer, lede: OVERLONG_LEDE } : answer;
}

const SCAN_STEPS = ["Reading the inputs", "Writing the card"];
const MARKERS = /\s*\[fixture:[a-z:]+\]\s*/g;

/**
 * The fixed scan answer (testing contract, Scan): a card named after the folder, and four options
 * from the listing, the last naming a file that does not exist (so the check leaves it out).
 */
export function fixtureScan(folderName: string, data: { listing?: string[]; entries?: string[] }) {
  const files = data.listing ?? [];
  const pick = (...i: number[]) => [...new Set(i.map((k) => files[k]).filter((f): f is string => !!f))];
  return {
    card: {
      name: folderName.replace(MARKERS, " ").trim() || folderName, sentence: "A project scanned by the test engine.", type: "agent",
      languages: ["TypeScript"], entryPoints: (data.entries ?? []).slice(0, 2),
    },
    options: [
      { kind: "flow", title: "How a request moves through the project", sentence: "Follows one request from the entry point to the store.", files: pick(0, 1) },
      { kind: "section", title: "The agent loop", sentence: "How the agent proposes and runs a tool.", files: files[2] ? pick(2) : pick(0) },
      { kind: "section", title: "The server side", sentence: "The code that serves requests and keeps state.", files: pick(0) },
      { kind: "flow", title: "A path that is not there", sentence: "Backed by a file that does not exist.", files: ["fixture/missing-file.ts"] },
      // `[fixture:many]`: six more, so one unknown kind becomes a flow and one is past the cap of 8.
      ...(/\[fixture:many\]/.test(folderName) ? [5, 6, 7, 8, 9, 10].map((i) => ({ kind: i === 5 ? "mechanism" : "section", title: `Part ${i}`, sentence: "One more part.", files: pick(0) })) : []),
    ],
  };
}

/**
 * The README and presentation stories (testing contract, Story): built from the overview's first
 * view — each part that is not a group and shows a fact, in view order, at most 12, on the spine —
 * and, for the presentation, a step for each of the first three parts plus one naming `ghost-part`.
 */
export function fixtureStory(view: DiagramView, presentation: boolean) {
  const parts = view.nodes.filter((n) => n.form !== "group" && (n.facts?.length ?? 0) > 0).slice(0, 12);
  const ids = new Set(parts.map((p) => p.id));
  return {
    title: view.caption.title, lede: "A detailed drawing made by the test engine.", zones: [],
    parts: parts.map((n, i) => ({
      id: n.id, label: n.label, sub: n.sub, kind: n.kind, chips: [], zone: null, inside: null, spine: i, anchor: null, side: null,
      facts: [...(n.facts ?? [])], held: [...(n.heldIds ?? [])], limits: [...(n.limitIds ?? [])],
    })),
    edges: view.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, label: e.label, style: e.style, step: e.step })),
    steps: presentation
      ? [...parts.slice(0, 3).map((n, i) => ({ parts: [n.id], text: `Step ${i + 1}: ${n.label}`, note: `The test engine explains ${n.label}.` })), { parts: ["ghost-part"], text: "A step about nothing", note: "" }]
      : [],
  };
}

/**
 * The fixed read (testing contract, Draw): an agent project whose files are the listing's first (A)
 * and second (B); `ghost` points to a file that does not exist, so the evidence check drops it and
 * what depends on it.
 */
export function fixtureRead(listing: readonly string[]) {
  const A = listing[0] ?? "fixture/empty.ts", B = listing[1] ?? A;
  const ev = (file: string, lines: [number, number] | null = null) => [{ file, lines }];
  const comp = (id: string, kind: string, label: string, within: string | null, evidence: { file: string; lines: [number, number] | null }[]) =>
    ({ id, label, kind, sub: "", description: `${label} as the test engine read it.`, within, evidence });
  const rel = (from: string, to: string, label = "", style = "call") => ({ from, to, label, style, both: false, evidence: ev([from, to].some((x) => x === "app" || x === "store" || x === "ghost") ? A : B) });
  return {
    components: [
      comp("app", "service", "App", null, ev(A)),
      comp("agent", "llm", "Agent", null, ev(B, [1, 1])),
      comp("model-call", "llm", "Model call", "agent", ev(B, [1, 1])),
      comp("tool-proposal", "service", "Tool proposal", "agent", ev(B, [1, 1])),
      comp("tool-check", "gate", "Tool check", "agent", ev(B, [1, 1])),
      comp("tool-run", "worker", "Tool execution", "agent", ev(B, [1, 1])),
      comp("tool-result", "service", "Tool result", "agent", ev(B, [1, 1])),
      comp("store", "data", "Store", null, ev(A)),
      comp("ghost", "external", "Ghost service", null, ev("fixture/ghost.ts")),
    ],
    relations: [
      rel("app", "agent", "asks"),
      rel("model-call", "tool-proposal"), rel("tool-proposal", "tool-check"), rel("tool-check", "tool-run"), rel("tool-run", "tool-result"),
      rel("tool-result", "model-call", "", "async"),
      rel("agent", "store", "keeps state"),
      rel("app", "ghost"),
    ],
    limits: [
      { id: "turn-limit", on: "agent", text: "Stops after 12 turns", evidence: ev(B, [1, 1]) },
      { id: "ghost-limit", on: "ghost", text: "Answers within 2 s", evidence: ev(B, [1, 1]) },
    ],
  };
}

/** The fixed overview story of a draw (testing contract, Draw); `[fixture:partial]` leaves out `store`. */
export function fixtureOverview(title: string, partial: boolean) {
  const part = (id: string, extra: object) => ({ id, label: "", sub: "", kind: "service", chips: [], zone: null, inside: null, spine: null, anchor: null, side: null, facts: [id], held: [], limits: [], ...extra });
  return {
    title, lede: "Drawn by the test engine.", zones: [{ id: "runtime", label: "Agent runtime" }],
    parts: [
      part("app", { label: "App", spine: 0 }),
      part("agent", { label: "Agent", kind: "llm", spine: 1, zone: "runtime", held: ["model-call", "tool-proposal", "tool-check", "tool-run", "tool-result"], limits: ["turn-limit"] }),
      ...(partial ? [] : [part("store", { label: "Store", kind: "data", zone: "runtime", anchor: "agent", side: "below" })]),
    ],
    edges: [
      { from: "app", to: "agent", label: "asks", style: "call", step: 1 },
      ...(partial ? [] : [{ from: "agent", to: "store", label: "", style: "call", step: null }]),
    ],
    steps: [],
  };
}

/**
 * The markers of a copy's repository name in their dashed form (testing contract, *Fixture markers in
 * a copy*): `shop-fixture-fail-overview` is `[fixture:fail:overview]`. Empty outside a copy.
 */
export function copyMarkers(cwd: string): string[] {
  const repo = /[\\/]repos[\\/](?:github\.com|gitlab\.com|bitbucket\.org)[\\/][^\\/]+[\\/]([^\\/]+)[\\/]?$/i.exec(cwd)?.[1];
  const words = repo ? /(?:^|-)fixture-(.*)$/.exec(repo)?.[1] : undefined;
  return words ? words.split("-fixture-").filter(Boolean).map((w) => `[fixture:${w.replace(/-/g, ":")}]`) : [];
}

/** A call in a copy reads its markers from the copy's name too: added to the folder's name (and a scan's instruction, which is that name). */
function withCopyMarkers(req: EngineRunRequest): EngineRunRequest {
  const marks = copyMarkers(req.cwd);
  if (!marks.length) return req;
  const folderName = `${req.folderName} ${marks.join(" ")}`;
  return { ...req, folderName, instruction: req.instruction === req.folderName ? folderName : req.instruction };
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
    req = withCopyMarkers(req);
    // A draw's markers come from the folder's name and the typed focus (testing contract, Draw).
    // The routing question (testing contract, Routing): answered at once, from the marker alone.
    if (req.task?.kind === "route") return { route: fixtureRoute(req.instruction) };
    // A repair turn answers as the call would have without the markers that broke it, unless the engine is stubborn.
    const repair = req.task?.data?.repair === true;
    if (repair && !(req.instruction.includes(STUBBORN) || req.folderName.includes(STUBBORN))) req = { ...req, instruction: unbreak(req.instruction), folderName: unbreak(req.folderName) };
    const stage = req.task?.data?.draw;
    if (stage) return this.drawCall(req, stage, (m) => req.instruction.includes(m) || req.folderName.includes(m));
    // A second look first checks that it has an image to look at (testing contract, Revise); its repair turn has none.
    if (req.task?.kind === "revise" && !repair && !isPng(req.image?.file)) throw new EngineError("Fixture: no image to look at");
    return overlong(await this.answer(req), req.instruction.includes(OVERLONG));
  }

  private async answer(req: EngineRunRequest): Promise<unknown> {
    if (req.instruction.includes("[fixture:slow]")) {
      for (let i = 1; i <= 30; i++) {
        await sleep(2000, req.signal);
        req.progress(`Working ${i}/30`);
      }
    }
    if (req.model) req.progress(`Using model ${req.model}`);
    for (const step of req.task?.kind === "scan" ? SCAN_STEPS : FIXTURE_STEPS) {
      await sleep(this.stepMs, req.signal);
      req.progress(step);
    }
    // One step after the last message too, so each line is on screen for a step (testing contract, Progress).
    await sleep(this.stepMs, req.signal);
    if (req.instruction.includes("[fixture:fail]")) throw new EngineError("Fixture failure requested");
    if (req.task?.kind === "scan") return fixtureScan(req.folderName, req.task.data ?? {});
    if (req.task?.kind === "revise") {
      const channel = req.task.data?.channel;
      if (channel === "linkedin") return fixturePost(req.base, req.view, req.instruction);
      if ((channel === "readme" || channel === "presentation") && req.task.data?.overview) return fixtureStory(req.task.data.overview, channel === "presentation");
      return fixtureNudge(req.base, req.view);
    }
    if (req.task?.kind === "post") return fixturePost(req.base, req.view, req.instruction);
    if (req.task?.kind === "story" && req.task.data?.overview) return fixtureStory(req.task.data.overview, req.task.data.channel === "presentation");
    if (req.simplify) return fixtureSimplify(req.base, req.instruction);
    return fixtureAnswer(req.base, req.view, req.instruction);
  }

  /** One of a draw's three calls: the read, the overview or the channel. */
  private async drawCall(req: EngineRunRequest, stage: "read" | "overview" | "channel", marked: (m: string) => boolean): Promise<unknown> {
    // `:second` markers act on the read of the run's second choice alone (testing contract, Draw).
    const second = stage === "read" && req.task?.data?.choiceIndex === 1;
    if (stage === "read" && (marked("[fixture:slow]") || (second && marked("[fixture:slow:second]")))) {
      for (let i = 1; i <= 30; i++) {
        await sleep(2000, req.signal);
        req.progress(`Working ${i}/30`);
      }
    }
    if (req.model) req.progress(`Using model ${req.model}`);
    // The read reports reading A, then B when it differs, with its `Reading the code` line (testing contract, File reads).
    const listing = req.task?.data?.listing ?? [];
    const reads = stage === "read" ? [...new Set([listing[0] ?? "fixture/empty.ts", listing[1] ?? listing[0] ?? "fixture/empty.ts"])] : undefined;
    for (const step of FIXTURE_STEPS) {
      await sleep(this.stepMs, req.signal);
      req.progress(step, step === "Reading the code" ? reads : undefined);
    }
    await sleep(this.stepMs, req.signal);
    if (marked(stage === "read" ? "[fixture:fail]" : `[fixture:fail:${stage}]`)) throw new EngineError("Fixture failure requested");
    if (second && marked("[fixture:fail:second]")) throw new EngineError("Fixture failure requested");
    // The first read of a second choice this server process makes for the folder fails; every later one answers.
    const secondOnce = `${req.cwd}\0second`;
    if (second && marked("[fixture:flaky:second]") && !FLAKED.has(secondOnce)) { FLAKED.add(secondOnce); throw new EngineError("Fixture failure requested"); }
    // Fails the stage's first call for the folder in this server process, whatever else the draw asks.
    const once = `${req.cwd}\0${stage}`;
    if (stage !== "read" && marked(`[fixture:flaky:${stage}]`) && !FLAKED.has(once)) { FLAKED.add(once); throw new EngineError("Fixture failure requested"); }
    const data = req.task?.data ?? {};
    if (stage === "read") return fixtureRead(data.listing ?? []);
    if (stage === "overview") return overlong(fixtureOverview(data.title ?? req.folderName, marked("[fixture:partial]")), marked(OVERLONG));
    if (req.task?.kind === "post") return fixturePost(req.base, req.view, req.instruction);
    return fixtureStory(data.overview!, data.channel === "presentation");
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
    lane: { spine: 0 }, facts: [], at: null,
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
    { id: "request", label: "Request", sub: "start the work", kind: "client", chips: [], zone: null, spine: 0, anchor: null, side: null, facts: [], inside: null, held: [], limits: [] },
    { id: "intake", label: "Request intake", sub: "check the request", kind: "api", chips: ["Validate input", "Bind the scope"], zone: null, spine: 1, anchor: null, side: null, facts: [], inside: null, held: [], limits: [] },
    { id: "loop", label: "Work loop", sub: "choose the next action", kind: "llm", chips: ["Propose action", "Read tool result"], zone: "runtime", spine: 2, anchor: null, side: null, facts: [], inside: null, held: [], limits: [] },
    { id: "result", label: "Result", sub: "deliver the outcome", kind: "service", chips: [], zone: null, spine: 3, anchor: null, side: null, facts: [], inside: null, held: [], limits: [] },
    { id: "facts", label: "Stored facts", sub: "keep the current state", kind: "data", chips: [], zone: "runtime", spine: null, anchor: "loop", side: "below", facts: [], inside: null, held: [], limits: [] },
    { id: "approval", label: "Approval", sub: "review the action", kind: "actor", chips: [], zone: null, spine: null, anchor: "result", side: "above", facts: [], inside: null, held: [], limits: [] },
  ],
  edges: [
    { from: "request", to: "intake", label: "", style: "call", step: 1 },
    { from: "intake", to: "loop", label: "", style: "call", step: 2 },
    { from: "loop", to: "result", label: "", style: "call", step: 3 },
    { from: "loop", to: "facts", label: "", style: "dep", step: null },
    { from: "result", to: "approval", label: "review", style: "async", step: null },
    { from: "approval", to: "result", label: "decision", style: "call", step: null },
  ],
  steps: [],
};

/** The fixture's post: part i shows the fact the source view's part i shows; markers per the testing contract. */
function fixturePost(base: unknown, view: string, instruction: string): unknown {
  const intent = structuredClone(CANNED_INTENT) as unknown as { parts: { facts: string[]; label: string }[]; edges: Record<string, unknown>[] };
  const src = ((base as { views?: { id: string; nodes?: { facts?: string[] }[] }[] }).views ?? []).find((v) => v.id === view);
  intent.parts.forEach((p, i) => { const facts = src?.nodes?.[i]?.facts ?? []; p.facts = facts.length === 1 ? [...facts] : []; });
  if (instruction.includes("[fixture:long]")) intent.parts[0].label = "A deliberately longer request name";
  if (instruction.includes("[fixture:invalid]")) intent.edges.push({ from: "request", to: "ghost", label: "", style: "call", step: null });
  return intent;
}
