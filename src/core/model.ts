/**
 * The drawing model `archdraw/diagram@2` (docs/contracts/diagram.md).
 * Pure: no Node or DOM APIs (invariant 4).
 */

export const SCHEMA_ID = "archdraw/diagram@2";
export const SCHEMA_V1 = "archdraw/diagram@1";

export const KINDS = ["actor", "client", "api", "service", "worker", "llm", "external", "ops", "gate", "data"] as const;
export type Kind = (typeof KINDS)[number];

export const FORMS = ["card", "compact", "panel", "group"] as const;
export type Form = (typeof FORMS)[number];

export const STYLES = ["call", "async", "dep"] as const;
export type EdgeStyle = (typeof STYLES)[number];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const ICONS = [
  "user", "users", "clipboard", "monitor", "window", "zap", "timer", "spark", "cloud", "shield", "scale", "layers",
  "bell", "db", "chat", "loop", "book", "pen", "receipt", "inbox", "box", "cpu", "cog", "globe", "key", "lock",
  "mail", "file", "folder", "terminal", "code", "server", "queue", "search", "chart", "eye", "git", "plug",
] as const;
export type IconName = (typeof ICONS)[number];

export const KIND_INFO: Record<Kind, { label: string; icon: IconName; hint: string }> = {
  actor: { label: "Person", icon: "user", hint: "a person or role who starts or decides something" },
  client: { label: "Client app", icon: "monitor", hint: "a browser app, mobile app or CLI the user touches" },
  api: { label: "API", icon: "inbox", hint: "an HTTP/RPC surface: routes, request intake" },
  service: { label: "Service", icon: "box", hint: "code this repository owns that decides or does work" },
  worker: { label: "Background job", icon: "zap", hint: "a scheduler, consumer, outbox relay, cron job" },
  llm: { label: "AI agent", icon: "spark", hint: "a model call or an agent loop" },
  external: { label: "External", icon: "cloud", hint: "a third-party API or service" },
  ops: { label: "Monitoring", icon: "timer", hint: "tracing, metrics, logs viewer, evaluation" },
  gate: { label: "Check", icon: "shield", hint: "auth, validation, policy, an approval rule" },
  data: { label: "Data store", icon: "db", hint: "database, cache, queue, file store, event log" },
};

export const FORM_LABELS: Record<Form, string> = { card: "Card", compact: "Compact", panel: "Panel", group: "Group" };
export const STYLE_LABELS: Record<EdgeStyle, string> = { call: "Call", async: "Async", dep: "Dependency" };

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const DOC_ID_RE = /^d_[a-z0-9]{6,}$/;

export const LIMITS = {
  title: 120, viewTitle: 60, captionTitle: 120, lede: 240,
  label: 48, sub: 60, item: 44, items: 12, description: 400, files: 20,
  edgeLabel: 40, text: 500,
  nodesPerView: 60, views: 30, depth: 3, place: 20, request: 4000,
} as const;

export interface Place { row: number; col: number }
export type Lane = { spine: number } | { anchor: string; side: "above" | "below" };
export interface DiagramNode {
  id: string; label: string; kind: Kind; form: Form; icon: IconName | null; sub: string; items: string[];
  description: string; files: string[]; parent: string | null; detail: string | null; place: Place | null;
  x: number; y: number;
  lane?: Lane | null; from?: string[];
}
export interface DiagramEdge { id: string; from: string; to: string; label: string; style: EdgeStyle; both: boolean; step: number | null }
/** A text's font size in drawing px: any value in range; the toolbar offers four presets (diagram contract, Text). */
export const TEXT_SIZE = { min: 8, max: 200, default: 20, note: 16 } as const;
export const TEXT_PRESETS = [{ label: "S", size: 16 }, { label: "M", size: 20 }, { label: "L", size: 28 }, { label: "XL", size: 40 }] as const;
/** Free text the user places: a title, a heading or a remark (diagram contract, Text). */
export interface DiagramText { id: string; text: string; x: number; y: number; size: number }
export interface Caption { title: string; lede: string }
export interface DiagramView {
  id: string; title: string; caption: Caption;
  /** The source view of a generated post (diagram contract, Post-view identity); null otherwise. */
  postOf: string | null;
  nodes: DiagramNode[]; edges: DiagramEdge[]; texts: DiagramText[];
}
export interface DiagramRequest { id: string; text: string; view: string; at: string }
export type DiagramSource = { kind: "local"; path: string };
export interface EngineRef { id: string; model: string | null }

export interface DiagramDocument {
  schema: typeof SCHEMA_ID;
  id: string;
  title: string;
  theme: Theme;
  showSteps: boolean;
  source: DiagramSource | null;
  engine: EngineRef | null;
  createdAt: string;
  updatedAt: string;
  views: DiagramView[];
  requests: DiagramRequest[];
  warnings: string[];
}

/** A file as a session writes it: positions, edge ids and document fields may be missing. */
export type NodeInput = Omit<DiagramNode, "x" | "y"> & { x?: number; y?: number };
export type EdgeInput = Omit<DiagramEdge, "id"> & { id?: string };
export type TextInput = Omit<DiagramText, "size"> & { size?: number };
export interface ViewInput { id: string; title: string; caption: Caption; postOf?: string | null; nodes: NodeInput[]; edges: EdgeInput[]; texts?: TextInput[] }
export interface DiagramFile {
  schema: typeof SCHEMA_ID; id?: string; title: string; theme?: Theme; showSteps?: boolean;
  source?: DiagramSource | null; engine?: EngineRef | null; createdAt?: string; updatedAt?: string;
  views: ViewInput[]; requests?: DiagramRequest[]; warnings?: string[];
}

export interface FileCheck {
  /** Returns true when the repo-relative path exists. Omit to skip the existence check (rule 10). */
  fileExists?: (relPath: string) => boolean;
  /** A path missing from the repository is an error (`validate`, the default) or a warning (opening a drawing). */
  missingFiles?: "error" | "warn";
}
export interface ValidationReport { ok: boolean; errors: string[]; warnings: string[]; file: DiagramFile | null }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const q = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v));

/** True when `p` is repository-relative: no leading slash, no drive letter, no `..` segment. */
export function isRepoRelative(p: string): boolean {
  if (!p || p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return false;
  return !p.replace(/\\/g, "/").split("/").some((s) => s === "..");
}

/**
 * Check a drawing file against docs/contracts/diagram.md. Lists every violation as
 * `<json path>: <message>`, plus the depth warnings. Never repairs.
 */
export function validateFile(raw: unknown, check: FileCheck = {}): ValidationReport {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  const missing: string[] = [];
  const absent = check.missingFiles === "warn" ? (path: string, msg: string) => { missing.push(`${path}: ${msg}`); } : err;
  if (!isObj(raw)) return { ok: false, errors: ["(root): must be a JSON object"], warnings: [], file: null };
  if (raw.schema === SCHEMA_V1) {
    return { ok: false, errors: ['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"'], warnings: [], file: null };
  }
  if (raw.schema !== SCHEMA_ID) err("schema", `must be "${SCHEMA_ID}"`);

  const str = (v: unknown, path: string, min: number, max: number) => {
    if (typeof v !== "string") return err(path, "must be a string");
    if (v.trim().length < min) return err(path, "must not be empty");
    if (v.length > max) err(path, `is ${v.length} characters; at most ${max}`);
  };
  const oneOf = (v: unknown, path: string, allowed: readonly string[], what: string) => {
    if (typeof v !== "string" || !allowed.includes(v)) err(path, `${q(v)} is not ${what}; use one of ${allowed.join(", ")}`);
  };
  const idOk = (v: unknown, path: string) => {
    if (typeof v !== "string" || !ID_RE.test(v)) { err(path, `${q(v)} is not a valid id (letters, digits, _ and -, 1–64 characters)`); return false; }
    return true;
  };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

  if (raw.id !== undefined && (typeof raw.id !== "string" || !DOC_ID_RE.test(raw.id))) err("id", "must look like d_xxxxxx (lower-case letters and digits)");
  str(raw.title, "title", 1, LIMITS.title);
  if (raw.theme !== undefined) oneOf(raw.theme, "theme", THEMES, "a theme");
  if (raw.showSteps !== undefined && typeof raw.showSteps !== "boolean") err("showSteps", "must be true or false");
  if (raw.source !== undefined && raw.source !== null) {
    if (!isObj(raw.source) || raw.source.kind !== "local" || typeof raw.source.path !== "string" || !raw.source.path) err("source", 'must be null or {"kind": "local", "path": "<folder>"}');
  }
  if (raw.engine !== undefined && raw.engine !== null) {
    if (!isObj(raw.engine) || typeof raw.engine.id !== "string" || !(raw.engine.model === null || typeof raw.engine.model === "string")) err("engine", 'must be null or {"id": string, "model": string | null}');
  }
  for (const k of ["createdAt", "updatedAt"] as const) if (raw[k] !== undefined && typeof raw[k] !== "string") err(k, "must be an ISO date string");
  if (raw.warnings !== undefined && (!Array.isArray(raw.warnings) || raw.warnings.some((w) => typeof w !== "string"))) err("warnings", "must be an array of strings");

  const views = Array.isArray(raw.views) ? raw.views : null;
  if (!views || views.length === 0) err("views", "must be a non-empty array of views");
  else if (views.length > LIMITS.views) err("views", `has ${views.length} views; at most ${LIMITS.views}`);
  const viewIds = new Set<string>();
  for (const v of views ?? []) if (isObj(v) && typeof v.id === "string") viewIds.add(v.id);
  const globalIds = new Set<string>();
  const seenViews = new Set<string>();

  (views ?? []).forEach((v, vi) => {
    const P = `views[${vi}]`;
    if (!isObj(v)) return err(P, "must be an object");
    if (idOk(v.id, `${P}.id`)) {
      if (seenViews.has(v.id as string)) err(`${P}.id`, `view id ${q(v.id)} is used twice`);
      seenViews.add(v.id as string);
    }
    str(v.title, `${P}.title`, 1, LIMITS.viewTitle);
    if (!isObj(v.caption)) err(`${P}.caption`, 'must be {"title": string, "lede": string}');
    else { str(v.caption.title, `${P}.caption.title`, 1, LIMITS.captionTitle); str(v.caption.lede, `${P}.caption.lede`, 0, LIMITS.lede); }
    // A post belongs to one other, non-post view: no chains, no cycles, one post per source.
    if (v.postOf !== undefined && v.postOf !== null) {
      const src = (views ?? []).find((w) => isObj(w) && w.id === v.postOf) as Record<string, unknown> | undefined;
      if (typeof v.postOf !== "string") err(`${P}.postOf`, "must be a view id or null");
      else if (v.postOf === v.id) err(`${P}.postOf`, "a post cannot be its own source");
      else if (!src) err(`${P}.postOf`, `names no view ${q(v.postOf)} in this file`);
      else if (src.postOf !== undefined && src.postOf !== null) err(`${P}.postOf`, `${q(v.postOf)} is itself a post; a post's source is an ordinary view`);
      else if ((views ?? []).findIndex((w) => isObj(w) && w.postOf === v.postOf) !== vi) err(`${P}.postOf`, `${q(v.postOf)} already has a post; a view has at most one`);
    }

    const nodes = Array.isArray(v.nodes) ? v.nodes : (err(`${P}.nodes`, "must be an array"), []);
    if (nodes.length > LIMITS.nodesPerView) err(`${P}.nodes`, `has ${nodes.length} components; at most ${LIMITS.nodesPerView}`);
    const byId = new Map<string, Record<string, unknown>>();
    nodes.forEach((n, i) => {
      const p = `${P}.nodes[${i}]`;
      if (!isObj(n)) return err(p, "must be an object");
      if (idOk(n.id, `${p}.id`)) {
        if (globalIds.has(n.id as string)) err(`${p}.id`, `${q(n.id)} is used twice; ids are unique across the whole file`);
        globalIds.add(n.id as string);
        byId.set(n.id as string, n);
      }
      str(n.label, `${p}.label`, 1, LIMITS.label);
      oneOf(n.kind, `${p}.kind`, KINDS, "a kind");
      oneOf(n.form, `${p}.form`, FORMS, "a form");
      if (n.icon !== null) oneOf(n.icon, `${p}.icon`, ICONS, "an icon (use null for the kind's default)");
      str(n.sub, `${p}.sub`, 0, LIMITS.sub);
      if (!Array.isArray(n.items)) err(`${p}.items`, "must be an array of short strings ([] when none)");
      else {
        if (n.items.length > LIMITS.items) err(`${p}.items`, `has ${n.items.length} items; at most ${LIMITS.items}`);
        n.items.forEach((t, j) => str(t, `${p}.items[${j}]`, 1, LIMITS.item));
        if (n.form === "panel" && n.items.length === 0) err(`${p}.items`, 'a panel lists what the component holds; add items or use form "card"');
        if (n.form !== "panel" && n.items.length > 0 && FORMS.includes(n.form as Form)) err(`${p}.items`, `only a panel shows held items; set form to "panel" or remove the items`);
      }
      str(n.description, `${p}.description`, 1, LIMITS.description);
      if (!Array.isArray(n.files)) err(`${p}.files`, "must be an array of repository-relative paths ([] when none)");
      else {
        if (n.files.length > LIMITS.files) err(`${p}.files`, `has ${n.files.length} paths; at most ${LIMITS.files}`);
        n.files.forEach((f, j) => {
          if (typeof f !== "string" || !isRepoRelative(f)) err(`${p}.files[${j}]`, `${q(f)} must be a repository-relative path (no leading /, drive letter or ..)`);
          else if (check.fileExists && !check.fileExists(f.replace(/\\/g, "/"))) absent(`${p}.files[${j}]`, `${q(f)} does not exist in the repository`);
        });
      }
      if (!("parent" in n)) err(`${p}.parent`, "is required (null for top level)");
      if (!("detail" in n)) err(`${p}.detail`, "is required (null when the component has no inside view)");
      else if (n.detail !== null) {
        if (typeof n.detail !== "string" || !viewIds.has(n.detail)) err(`${p}.detail`, `view ${q(n.detail)} does not exist`);
        else if (n.detail === v.id) err(`${p}.detail`, "must name a view other than the one the component is in");
      }
      if (!("place" in n)) err(`${p}.place`, "is required (null when the layout should choose)");
      else if (n.place !== null) {
        const pl = n.place;
        const okInt = (x: unknown) => Number.isInteger(x) && Math.abs(x as number) <= LIMITS.place;
        if (!isObj(pl) || !okInt(pl.row) || !okInt(pl.col)) err(`${p}.place`, `must be null or {"row": integer, "col": integer} within ±${LIMITS.place}`);
      }
      if (n.lane !== undefined && n.lane !== null) {
        const l = n.lane;
        const spine = isObj(l) && Object.keys(l).length === 1 && Number.isInteger(l.spine) && (l.spine as number) >= 0;
        const side = isObj(l) && Object.keys(l).length === 2 && typeof l.anchor === "string" && (l.side === "above" || l.side === "below");
        if (!spine && !side) err(`${p}.lane`, 'must be null, {"spine": non-negative integer}, or {"anchor": id, "side": "above" | "below"}');
      }
      if (n.from !== undefined && (!Array.isArray(n.from) || n.from.some((id) => typeof id !== "string" || !ID_RE.test(id)) || new Set(n.from).size !== n.from.length)) err(`${p}.from`, "must be distinct original component ids");
      const hasX = n.x !== undefined, hasY = n.y !== undefined;
      if (hasX !== hasY) err(`${p}.${hasX ? "y" : "x"}`, "x and y are both present or both absent");
      else if (hasX && (!finite(n.x) || !finite(n.y))) err(`${p}.x`, "x and y must be finite numbers");
    });
    // Parents need every node of the view known first.
    const spineOrders = new Set<string>();
    nodes.forEach((n, i) => {
      if (!isObj(n) || !isObj(n.lane)) return;
      const p = `${P}.nodes[${i}].lane`;
      if (Number.isInteger(n.lane.spine)) {
        const key = `${n.parent ?? ""}:${n.lane.spine}`;
        if (spineOrders.has(key)) err(p, "spine order must be unique among siblings");
        spineOrders.add(key);
      } else if (typeof n.lane.anchor === "string") {
        const anchor = byId.get(n.lane.anchor);
        if (!anchor || !isObj(anchor.lane) || !Number.isInteger(anchor.lane.spine)) err(p, "anchor must name a spine component in this view");
        const seen = new Set<string>();
        for (let cur = anchor; cur && !seen.has(cur.id as string); cur = typeof cur.parent === "string" ? byId.get(cur.parent) : undefined) {
          if (cur.id === n.id) { err(p, "anchor cannot be itself or a descendant"); break; }
          seen.add(cur.id as string);
        }
      }
    });
    nodes.forEach((n, i) => {
      if (!isObj(n) || n.parent === null || n.parent === undefined) return;
      const p = `${P}.nodes[${i}].parent`;
      const par = typeof n.parent === "string" ? byId.get(n.parent) : undefined;
      if (!par) return err(p, `${q(n.parent)} is not a component in this view`);
      if (par.form !== "group") return err(p, `${q(n.parent)} is a ${String(par.form)}; only a group holds components`);
      let depth = 1;
      const seen = new Set<string>([n.id as string]);
      for (let cur: Record<string, unknown> | undefined = par; cur; ) {
        if (seen.has(cur.id as string)) return err(p, "a component cannot be inside itself");
        seen.add(cur.id as string);
        const up: unknown = cur.parent;
        if (up === null || up === undefined) break;
        depth++;
        cur = typeof up === "string" ? byId.get(up) : undefined;
      }
      if (depth > LIMITS.depth) err(p, `nests ${depth} groups deep; at most ${LIMITS.depth}`);
    });

    const edges = Array.isArray(v.edges) ? v.edges : (err(`${P}.edges`, "must be an array"), []);
    const pairs = new Set<string>();
    edges.forEach((e, i) => {
      const p = `${P}.edges[${i}]`;
      if (!isObj(e)) return err(p, "must be an object");
      if (e.id !== undefined && idOk(e.id, `${p}.id`)) {
        if (globalIds.has(e.id as string)) err(`${p}.id`, `${q(e.id)} is used twice; ids are unique across the whole file`);
        globalIds.add(e.id as string);
      }
      const fromOk = typeof e.from === "string" && byId.has(e.from);
      const toOk = typeof e.to === "string" && byId.has(e.to);
      if (!fromOk) err(`${p}.from`, `${q(e.from)} is not a component in this view`);
      if (!toOk) err(`${p}.to`, `${q(e.to)} is not a component in this view`);
      if (fromOk && toOk && e.from === e.to) err(p, "a component cannot connect to itself");
      str(e.label, `${p}.label`, 0, LIMITS.edgeLabel);
      oneOf(e.style, `${p}.style`, STYLES, "a style");
      if (typeof e.both !== "boolean") err(`${p}.both`, "must be true or false");
      if (e.step !== null && !(Number.isInteger(e.step) && (e.step as number) > 0)) err(`${p}.step`, "must be null or a positive integer");
      if (fromOk && toOk) {
        const k = `${e.from}>${e.to}`, back = `${e.to}>${e.from}`;
        if (pairs.has(k)) err(p, `a second connection ${e.from} → ${e.to}; fold it into one label`);
        else if (pairs.has(back)) err(p, `${e.from} → ${e.to} reverses an earlier connection; make that one two-way ("both": true) instead`);
        pairs.add(k);
      }
    });

    const texts = v.texts === undefined ? [] : Array.isArray(v.texts) ? v.texts : (err(`${P}.texts`, "must be an array"), []);
    texts.forEach((t, i) => {
      const p = `${P}.texts[${i}]`;
      if (!isObj(t)) return err(p, "must be an object");
      if (idOk(t.id, `${p}.id`)) {
        if (globalIds.has(t.id as string)) err(`${p}.id`, `${q(t.id)} is used twice; ids are unique across the whole file`);
        globalIds.add(t.id as string);
      }
      str(t.text, `${p}.text`, 1, LIMITS.text);
      if (!finite(t.x) || !finite(t.y)) err(`${p}.x`, "x and y must be finite numbers");
      if (t.size !== undefined && (!finite(t.size) || (t.size as number) < TEXT_SIZE.min || (t.size as number) > TEXT_SIZE.max)) err(`${p}.size`, `must be a number from ${TEXT_SIZE.min} to ${TEXT_SIZE.max}`);
    });
    // Notes of older @2 files are still read; they become texts (diagram contract, Text).
    if (v.notes !== undefined) {
      const notes = Array.isArray(v.notes) ? v.notes : (err(`${P}.notes`, "must be an array"), []);
      notes.forEach((t, i) => {
        const p = `${P}.notes[${i}]`;
        if (!isObj(t)) return err(p, "must be an object");
        if (idOk(t.id, `${p}.id`)) {
          if (globalIds.has(t.id as string)) err(`${p}.id`, `${q(t.id)} is used twice; ids are unique across the whole file`);
          globalIds.add(t.id as string);
        }
        if (typeof t.text !== "string") err(`${p}.text`, "must be a string");
        else if (t.text.length > LIMITS.text) err(`${p}.text`, `is ${t.text.length} characters; at most ${LIMITS.text}`);
        if (!finite(t.x) || !finite(t.y)) err(`${p}.x`, "x and y must be finite numbers");
      });
    }
  });

  if (raw.requests !== undefined) {
    if (!Array.isArray(raw.requests)) err("requests", "must be an array");
    else raw.requests.forEach((r, i) => {
      const p = `requests[${i}]`;
      if (!isObj(r)) return err(p, "must be an object");
      if (idOk(r.id, `${p}.id`)) {
        if (globalIds.has(r.id as string)) err(`${p}.id`, `${q(r.id)} is used twice; ids are unique across the whole file`);
        globalIds.add(r.id as string);
      }
      str(r.text, `${p}.text`, 1, LIMITS.request);
      if (typeof r.view !== "string" || !viewIds.has(r.view)) err(`${p}.view`, `view ${q(r.view)} does not exist`);
      if (typeof r.at !== "string") err(`${p}.at`, "must be an ISO date string");
    });
  }

  if (errors.length) return { ok: false, errors, warnings: [], file: null };
  const { file, changed } = notesToTexts(raw as unknown as LegacyFile);
  return { ok: true, errors: [], warnings: [...missing, ...changed.map((w) => `${w}; "archdrawer open" writes them as texts`), ...depthWarnings(file)], file };
}

/** Notes of older @2 files become body texts at their place; one warning per view that had any. */
type LegacyView = ViewInput & { notes?: { id: string; text: string; x: number; y: number }[] };
type LegacyFile = Omit<DiagramFile, "views"> & { views: LegacyView[] };
function notesToTexts(raw: LegacyFile): { file: DiagramFile; changed: string[] } {
  if (!raw.views.some((v) => v.notes !== undefined)) return { file: raw as DiagramFile, changed: [] };
  const changed: string[] = [];
  const views = raw.views.map((v) => {
    const { notes, ...rest } = v;
    if (!notes?.length) return rest;
    changed.push(`View "${v.id}": ${notes.length} note${notes.length === 1 ? "" : "s"} became text${notes.length === 1 ? "" : "s"}`);
    const kept = notes.filter((t) => t.text.trim()).map((t): TextInput => ({ id: t.id, text: t.text, x: t.x, y: t.y, size: TEXT_SIZE.note }));
    return { ...rest, texts: [...(rest.texts ?? []), ...kept] };
  });
  const file: DiagramFile = { ...raw, views, ...(changed.length ? { warnings: [...(raw.warnings ?? []), ...changed] } : {}) };
  return { file, changed };
}

/** Units that make a number a tuning value ("6 turns", "90 s", "5 MB", "2 retries"). */
const TUNING = /\d+(?:[.,]\d+)?\s*(?:%|(?:ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|turns?|tokens?|retries|retry|attempts?|requests?|calls?|workers?|threads?|kb|mb|gb|tb)\b)/i;

/**
 * A LinkedIn view is the share version of another view (ui contract, Share): its id is that view's id
 * plus `-linkedin`. It holds few cards in plain words, so the depth checks on panels and flat
 * pipelines do not apply to it.
 */
export const LINKEDIN_SUFFIX = "-linkedin";
export const isLinkedInView = (viewId: string) => viewId.endsWith(LINKEDIN_SUFFIX);
/** A post view draws with the dense post style: one with a `postOf`, or a LinkedIn view. */
export const isPostView = (v: { id?: string; postOf?: string | null }) => !!v.postOf || (!!v.id && isLinkedInView(v.id));
export const linkedInViewId = (viewId: string) => `${viewId.slice(0, 64 - LINKEDIN_SUFFIX.length)}${LINKEDIN_SUFFIX}`;

/** The overview's targets (diagram contract, Overview targets): 4–6 top-level zones, at most 15 connections. */
export const OVERVIEW_TARGETS = { zones: { min: 4, max: 6 }, connections: 15 } as const;

/** The overview's counts when they miss its targets, else null. Counts every connection, zone interiors too. */
export function overviewMiss(view: { nodes: readonly { parent?: string | null; form: string }[]; edges: readonly unknown[] }): { zones: number; connections: number } | null {
  const zones = view.nodes.filter((n) => !n.parent && n.form === "group").length, connections = view.edges.length;
  const T = OVERVIEW_TARGETS;
  return zones < T.zones.min || zones > T.zones.max || connections > T.connections ? { zones, connections } : null;
}

/** The depth checks: they never make a file invalid. */
export function depthWarnings(file: Pick<DiagramFile, "views">): string[] {
  const out: string[] = [];
  file.views.forEach((v, vi) => {
    const P = `views[${vi}]`;
    const miss = vi === 0 && !isPostView(v) ? overviewMiss(v) : null;
    if (miss) {
      out.push(`${P}: the overview has ${miss.zones} zone${miss.zones === 1 ? "" : "s"} and ${miss.connections} connection${miss.connections === 1 ? "" : "s"}; it targets 4–6 zones and at most 15 connections — simplify it, with finer detail in detail views`);
    }
    const top = v.nodes.filter((n) => n.parent === null);
    const stepped = v.edges.filter((e) => e.step !== null);
    const share = typeof v.id === "string" && isLinkedInView(v.id);
    if (top.length >= 6 && !share) {
      const hinted = top.filter((n) => n.place);
      const rows = new Set(hinted.map((n) => n.place!.row));
      if (hinted.length === top.length && rows.size === 1) {
        out.push(`${P}: all ${top.length} top-level components share row ${[...rows][0]} — a flat pipeline; put side paths (stores, approvals, notifications, monitoring) on rows above or below the main path`);
      } else if (hinted.length === 0) {
        const onPath = new Set(stepped.flatMap((e) => [e.from, e.to]));
        if (top.every((n) => onPath.has(n.id))) out.push(`${P}: every component is on the main path and none has a place — a flat pipeline; add place hints with side paths above or below`);
      }
    }
    if (v.nodes.length >= 6 && !share && !v.nodes.some((n) => n.form === "panel")) {
      out.push(`${P}: no component lists what it holds; use form "panel" with items where the code shows distinct mechanisms`);
    }
    v.nodes.forEach((n, i) => {
      for (const [field, text] of [["label", n.label], ["sub", n.sub], ...n.items.map((t, j) => [`items[${j}]`, t])] as [string, string][]) {
        if (TUNING.test(text)) out.push(`${P}.nodes[${i}].${field}: ${q(text)} looks like a tuning number; leave limits, timeouts and counts out`);
      }
    });
    if (v.edges.length >= 3 && stepped.length === 0) out.push(`${P}: no main path; number the connections of the request that defines the system with step 1, 2, 3 …`);
    const counts = new Map<string, number>();
    for (const e of v.edges) if (e.label.trim()) counts.set(e.label.trim().toLowerCase(), (counts.get(e.label.trim().toLowerCase()) ?? 0) + 1);
    for (const [label, c] of counts) if (c >= 3) out.push(`${P}: the label ${q(label)} repeats on ${c} connections; keep it where it adds something`);
  });
  return out;
}

/** Validate a stored document (PUT, the store): the file rules, plus the fields normalisation guarantees. */
export function validateDocument(raw: unknown, check: FileCheck = {}): { ok: true; doc: DiagramDocument } | { ok: false; error: string; errors: string[] } {
  const r = validateFile(raw, check);
  const errors = [...r.errors];
  if (r.ok) {
    const d = raw as Record<string, unknown>;
    if (typeof d.id !== "string") errors.push("id: is required in a stored document");
    r.file!.views.forEach((v, vi) => v.nodes.forEach((n, i) => {
      if (n.x === undefined) errors.push(`views[${vi}].nodes[${i}].x: a stored component needs a position`);
    }));
    r.file!.views.forEach((v, vi) => v.edges.forEach((e, i) => {
      if (e.id === undefined) errors.push(`views[${vi}].edges[${i}].id: a stored connection needs an id`);
    }));
  }
  if (errors.length) return { ok: false, error: `Invalid diagram — ${errors[0]}`, errors };
  return { ok: true, doc: fillDefaults(r.file!) as DiagramDocument };
}

/**
 * Defaults for every optional field except positions and edge ids (normalisation, diagram
 * contract). Returns a new object; positions stay as they are.
 */
export function fillDefaults(file: DiagramFile, ctx: { id?: string; now?: string; source?: DiagramSource | null } = {}): DiagramFile & Omit<DiagramDocument, "views"> {
  const now = ctx.now ?? new Date(0).toISOString();
  const copy = structuredClone(file);
  return {
    ...copy,
    schema: SCHEMA_ID,
    id: copy.id ?? ctx.id ?? "d_unsaved",
    theme: copy.theme ?? "light",
    showSteps: copy.showSteps ?? false,
    source: ctx.source !== undefined ? ctx.source : copy.source ?? null,
    engine: copy.engine ?? null,
    createdAt: copy.createdAt ?? now,
    updatedAt: copy.updatedAt ?? now,
    requests: copy.requests ?? [],
    warnings: copy.warnings ?? [],
    views: copy.views.map((v) => ({
      ...v,
      postOf: v.postOf ?? null,
      nodes: v.nodes.map((n) => ({ ...n, lane: n.lane ?? null, from: n.from ?? [] })),
      texts: (v.texts ?? []).map((t) => ({ ...t, size: t.size ?? TEXT_SIZE.default })),
    })),
  };
}

/** Give every connection without an id the next free `e<n>` (normalisation). */
export function assignEdgeIds(file: DiagramFile): void {
  const used = allIds(file);
  let n = 1;
  for (const v of file.views) for (const e of v.edges) {
    if (e.id) continue;
    while (used.has(`e${n}`)) n++;
    e.id = `e${n}`;
    used.add(e.id);
  }
}

export function allIds(file: Pick<DiagramFile, "views" | "requests">): Set<string> {
  const s = new Set<string>();
  for (const v of file.views) {
    for (const n of v.nodes) s.add(n.id);
    for (const e of v.edges) if (e.id) s.add(e.id);
    for (const t of v.texts ?? []) s.add(t.id);
  }
  for (const r of file.requests ?? []) s.add(r.id);
  return s;
}

export function newDocumentId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "d_";
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return s;
}

export function slugify(title: string): string {
  const s = title.toLowerCase().replace(/ı/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "diagram";
}

export const iconOf = (n: Pick<DiagramNode, "icon" | "kind">): IconName => n.icon ?? KIND_INFO[n.kind].icon;
export const viewById = (doc: Pick<DiagramDocument, "views">, id: string) => doc.views.find((v) => v.id === id) ?? null;

/** Ids of a component's descendants (children, grandchildren …) in its view. */
export function descendants(view: Pick<DiagramView, "nodes">, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const n of view.nodes) if (n.parent === pid && !out.has(n.id)) { out.add(n.id); walk(n.id); }
  };
  walk(id);
  return out;
}

/** Depth of a component: 0 at top level, 1 inside one group, … */
export function depthOf(view: Pick<DiagramView, "nodes">, id: string): number {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  let d = 0;
  for (let cur = byId.get(id); cur?.parent; cur = byId.get(cur.parent)) d++;
  return d;
}
