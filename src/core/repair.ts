import { layoutRects, overlaps } from "./geometry";
import { freeSpot, layoutView } from "./layout";
import {
  FORMS, ICONS, ID_RE, KINDS, LIMITS, STYLES, isRepoRelative,
  type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramText, type DiagramView, type EdgeStyle, type Form,
  type IconName, type Kind, type Lane, type NodeInput, type Place,
} from "./model";

/**
 * The instruction engine's answer → a document (diagram contract § The instruction engine's
 * answer). Unlike a session's file, an engine's answer is repaired; every repair adds exactly one
 * warning (invariant 6). Kept components keep their positions unless the engine moved them
 * with `at`; nothing outside the run's scope changes.
 */

/** What a run may change (api contract, POST /api/runs). */
export type RunScope = { kind: "all" } | { kind: "view" } | { kind: "parts"; ids: string[] };

export class EmptyDiagramError extends Error {
  constructor(what = "The engine returned no usable components") {
    super(what);
  }
}

export interface RepairContext {
  base: DiagramDocument;
  now: string;
  engine: { id: string; model: string | null } | null;
  /** Returns true when the repo-relative path exists. Omit to skip the check. */
  fileExists?: (relPath: string) => boolean;
  /** What the run may change; default the whole document. */
  scope?: RunScope;
  /** The view the run was asked from: the one a `view` or `parts` scope names. */
  view?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const toId = (raw: string) => raw.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
const GRID = 8;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** What the engine sees of a component or a connection, to tell whether it changed one. */
const nodeKey = (n: Record<string, unknown>) => JSON.stringify([n.label, n.kind, n.form, n.icon ?? null, n.sub, n.items, n.description, n.files, n.parent ?? null, n.detail ?? null, n.lane ?? null, n.from ?? []]);
const edgeKey = (e: Record<string, unknown>) => JSON.stringify([e.label, e.style, e.both === true, e.step ?? null]);

export function answerToDocument(raw: unknown, ctx: RepairContext): DiagramDocument {
  const warnings: string[] = [];
  const d = obj(raw);
  const clip = (text: string, max: number, what: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    warnings.push(`Shortened ${what} to ${max} characters`);
    return t.slice(0, max - 1).trimEnd() + "…";
  };
  /** A required text the engine left empty takes `value`, with one warning. */
  const filled = (value: string, warning: string) => { warnings.push(warning); return value; };
  const placeOf = (raw: unknown, id: string): Place | null => {
    if (raw === null || raw === undefined) return null;
    const pl = obj(raw);
    if (!Number.isInteger(pl.row) || !Number.isInteger(pl.col)) { warnings.push(`Component "${id}": its place is not a whole row and column, dropped`); return null; }
    const row = clampPlace(pl.row as number), col = clampPlace(pl.col as number);
    if (row !== pl.row || col !== pl.col) warnings.push(`Component "${id}": place row ${pl.row}, col ${pl.col} is beyond ±${LIMITS.place}, moved to row ${row}, col ${col}`);
    return { row, col };
  };
  // `from` is provenance (diagram contract, Simplification coverage): ids of the input, or provenance it
  // already carries, never invented; what a component already carried is carried forward.
  const known = new Set<string>(), carriedBy = new Map<string, string[]>();
  for (const v of ctx.base.views) for (const n of v.nodes) { known.add(n.id); for (const f of n.from ?? []) known.add(f); if (n.from?.length) carriedBy.set(n.id, n.from); }
  const laneOf = (raw: unknown, id: string): Lane | null | undefined => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    const l = obj(raw);
    if (Number.isInteger(l.spine) && (l.spine as number) >= 0 && l.anchor === undefined && l.side === undefined) return { spine: l.spine as number };
    if (typeof l.anchor === "string" && (l.side === "above" || l.side === "below") && l.spine === undefined) return { anchor: str(l.anchor), side: l.side };
    warnings.push(`Component "${id}": its lane is not a spine order or an anchor with a side, dropped`);
    return null;
  };
  const fromOf = (raw: unknown, id: string, kept: readonly string[]): string[] => {
    const out = [...kept];
    if (raw !== undefined) for (const f of arr(raw).map(str)) {
      if (!known.has(f)) { warnings.push(`Component "${id}": "${f}" in its from is no component of the drawing, dropped`); continue; }
      if (!out.includes(f)) out.push(f);
    }
    for (let i = 0; i < out.length; i++) for (const f of carriedBy.get(out[i]) ?? []) if (!out.includes(f)) out.push(f);
    return out;
  };
  const used = new Set<string>(ctx.base.requests.map((r) => r.id));
  for (const v of ctx.base.views) for (const t of v.texts) used.add(t.id);
  // One warning per id, whatever happened to it; surrounding whitespace alone is no change.
  const claim = (wanted: string, fallback: string, what: string): string => {
    const clean = toId(wanted);
    const id = clean && ID_RE.test(clean) ? clean : fallback;
    let c = id;
    for (let i = 2; used.has(c); i++) c = `${id.slice(0, 64 - String(i).length - 1)}-${i}`;
    used.add(c);
    if (!wanted.trim()) warnings.push(`Gave the ${what} without an id the id "${c}"`);
    else if (id !== clean) warnings.push(`Replaced the invalid ${what} id "${wanted}" with "${c}"`);
    else if (clean !== wanted.trim()) warnings.push(`Renamed the ${what} id "${wanted}" to "${c}": ids use letters, digits, - and _`);
    else if (c !== id) warnings.push(`Renamed the duplicate id "${id}" to "${c}"`);
    return c;
  };

  const scope: RunScope = ctx.scope ?? { kind: "all" };
  const scoped = scope.kind === "all" ? null : ctx.view ?? ctx.base.views[0].id;
  let rawViews = arr(d.views).map(obj);
  if (!rawViews.length) throw new EmptyDiagramError();

  // Outside a `view` or `parts` scope every view stays exactly as it was.
  const frozen = new Map<string, DiagramView>();
  if (scoped !== null) {
    const kept: Record<string, unknown>[] = [];
    for (const v of rawViews) {
      const id = toId(str(v.id));
      const was = ctx.base.views.find((b) => b.id === id);
      if (id === scoped) {
        if (!kept.some((k) => toId(str(k.id)) === id)) kept.push(v);
        else warnings.push(`Ignored a second view "${id}"`);
        continue;
      }
      if (!was) { warnings.push(`Ignored the new view "${str(v.id)}": outside the view the change was asked for`); continue; }
      if (frozen.has(id)) { warnings.push(`Ignored a second view "${id}"`); continue; }
      if (!sameView(was, v)) warnings.push(`Ignored the changes to the view "${id}": outside the view the change was asked for`);
      frozen.set(id, was);
      kept.push(v);
    }
    for (const b of ctx.base.views) {
      if (b.id === scoped) {
        if (!kept.some((k) => toId(str(k.id)) === scoped)) { warnings.push(`Kept the view "${b.id}": the engine left it out`); kept.push(draftOf(b)); }
      } else if (!frozen.has(b.id)) { warnings.push(`Kept the view "${b.id}": outside the view the change was asked for`); frozen.set(b.id, b); kept.push(draftOf(b)); }
    }
    const order = (v: Record<string, unknown>) => { const i = ctx.base.views.findIndex((b) => b.id === toId(str(v.id))); return i < 0 ? 1e9 : i; };
    rawViews = kept.sort((a, b) => order(a) - order(b));
    for (const v of frozen.values()) {
      for (const n of v.nodes) used.add(n.id);
      for (const e of v.edges) used.add(e.id);
    }
  }

  const viewIds = new Map<string, string>();
  const seenViews = new Set<string>();
  rawViews.forEach((v, i) => {
    const wanted = str(v.id), clean = toId(wanted);
    let id = clean || `view-${i + 1}`;
    for (let k = 2; seenViews.has(id); k++) id = `${clean || "view"}-${k}`;
    seenViews.add(id);
    if (!viewIds.has(wanted.trim())) viewIds.set(wanted.trim(), id);
    if (!clean) warnings.push(`Gave the view without an id the id "${id}"`);
    else if (clean !== wanted.trim()) warnings.push(`Renamed the view id "${wanted}" to "${id}": ids use letters, digits, - and _`);
    else if (id !== clean) warnings.push(`Renamed the duplicate view id "${clean}" to "${id}"`);
  });

  interface Pending { view: DiagramView; placed: Set<string>; fresh: Set<string> }
  const built: (DiagramView | Pending)[] = rawViews.map((v, vi): DiagramView | Pending => {
    const vid = [...seenViews][vi];
    const was = frozen.get(vid);
    if (was) return structuredClone(was);
    const baseView = ctx.base.views.find((b) => b.id === vid);
    const basePos = new Map((baseView?.nodes ?? []).map((n) => [n.id, n]));
    const baseRects = baseView ? layoutRects(baseView) : new Map<string, { x: number; y: number; w: number; h: number }>();
    // A `parts` scope: everything in this view that is not named (or inside a named group) stays as it was.
    const guarded = new Set<string>();
    if (scope.kind === "parts" && vid === scoped && baseView) {
      const open = new Set<string>(scope.ids);
      for (const id of scope.ids) for (const x of descendantsOf(baseView.nodes, id)) open.add(x);
      for (const n of baseView.nodes) if (!open.has(n.id)) guarded.add(n.id);
    }
    let rawNodes = arr(v.nodes).map(obj);
    const restored = new Set<Record<string, unknown>>();
    for (const id of guarded) {
      const b = basePos.get(id)!;
      const back = { ...draftNode(b), at: null } as Record<string, unknown>;
      restored.add(back);
      const i = rawNodes.findIndex((n) => toId(str(n.id)) === id);
      if (i < 0) { warnings.push(`Kept "${b.label}": it is outside the selected parts`); rawNodes.push(back); continue; }
      const n = rawNodes[i], at = obj(n.at);
      const moved = finite(at.x) && finite(at.y) && (Math.abs(at.x - b.x) > 1 || Math.abs(at.y - b.y) > 1);
      if (nodeKey(n) !== nodeKey(back) || moved) warnings.push(`Kept "${b.label}" as it was: it is outside the selected parts`);
      rawNodes[i] = back;
    }
    // Over the limit, components the run may not change stay; the latest of the others go.
    if (rawNodes.length > LIMITS.nodesPerView) {
      let room = LIMITS.nodesPerView - restored.size;
      const dropped: string[] = [];
      rawNodes = rawNodes.filter((n) => {
        if (restored.has(n) || room-- > 0) return true;
        dropped.push(str(n.id));
        return false;
      });
      warnings.push(`Dropped ${dropped.length} components of view "${vid}" over the limit of ${LIMITS.nodesPerView}: ${dropped.map((d) => `"${d}"`).join(", ")}`);
    }

    const idMap = new Map<string, string>();
    const moves = new Map<string, { x: number; y: number }>();
    const groupAt = new Map<string, { x: number; y: number }>();
    const nodes: NodeInput[] = rawNodes.map((n, i) => {
      const original = str(n.id);
      const id = claim(original, `component-${i + 1}`, "component");
      if (!idMap.has(original.trim())) idMap.set(original.trim(), id);
      let kind = str(n.kind) as Kind;
      if (!KINDS.includes(kind)) { warnings.push(`Component "${id}": unknown kind "${str(n.kind)}", drawn as service`); kind = "service"; }
      const said = arr(n.items).map(str);
      let items = said.filter((t) => t.trim());
      let form = str(n.form) as Form;
      if (!FORMS.includes(form)) { warnings.push(`Component "${id}": unknown form "${str(n.form)}", drawn as a card`); form = "card"; }
      if (form === "panel") {
        // Only a panel's items are drawn, so only a panel's items are repaired.
        if (items.length && items.length < said.length) warnings.push(`Component "${id}": dropped ${said.length - items.length} empty items`);
        if (items.length > LIMITS.items) { warnings.push(`Kept the first ${LIMITS.items} items of "${id}"`); items.length = LIMITS.items; }
        items = items.map((t, j) => clip(t, LIMITS.item, `item ${j + 1} of "${id}"`));
        if (!items.length) { warnings.push(`Component "${id}": a panel without items, drawn as a card`); form = "card"; }
      } else if (said.length) { warnings.push(`Component "${id}": items dropped, only a panel shows them`); items = []; }
      let icon: IconName | null = n.icon === null || n.icon === undefined || n.icon === "" ? null : (str(n.icon) as IconName);
      if (icon !== null && !ICONS.includes(icon)) { warnings.push(`Component "${id}": unknown icon "${str(n.icon)}", using the kind's`); icon = null; }
      const files: string[] = [];
      for (const f of arr(n.files).map(str)) {
        // Spelling a path differently (`\`, a leading `./`, surrounding spaces) or listing it twice is no change.
        const p = f.trim().replace(/\\/g, "/").replace(/^\.\//, "");
        if (!p) { warnings.push(`Removed an empty file path from "${id}"`); continue; }
        if (!isRepoRelative(p)) { warnings.push(`Removed the file "${f}" from "${id}": outside the repository`); continue; }
        if (ctx.fileExists && !ctx.fileExists(p) && !guarded.has(id)) { warnings.push(`Removed the file "${p}" from "${id}": not found in the repository`); continue; }
        if (!files.includes(p)) files.push(p);
      }
      if (files.length > LIMITS.files) { warnings.push(`Kept the first ${LIMITS.files} files of "${id}"`); files.length = LIMITS.files; }
      const place = placeOf(n.place, id);
      const label = clip(str(n.label).trim() || filled(id, `Component "${id}": no label, labelled with its id`), LIMITS.label, `the label of "${id}"`);
      const description = clip(str(n.description).trim() || filled("No description yet.", `Component "${id}": no description, set to "No description yet."`), LIMITS.description, `the description of "${id}"`);
      const kept = basePos.get(id);
      const lane = laneOf(n.lane, id);
      const at = obj(n.at);
      if (finite(at.x) && finite(at.y) && !guarded.has(id)) {
        // An `at` where the component already is, is no move (an engine that echoes positions moves nothing).
        const from = kept ? baseRects.get(id) ?? kept : null;
        if (!from || Math.abs(at.x - from.x) > 1 || Math.abs(at.y - from.y) > 1) { moves.set(id, { x: snap(at.x), y: snap(at.y) }); groupAt.set(id, { x: at.x, y: at.y }); }
      }
      return {
        id, label, kind, form, icon, sub: clip(str(n.sub), LIMITS.sub, `the sub-line of "${id}"`), items, description, files,
        parent: str(n.parent) || null, detail: str(n.detail) || null, place,
        // The answer names the facts a part shows in `facts` (diagram contract, Engine answers).
        lane: lane === undefined ? kept?.lane ?? null : lane, from: fromOf(n.facts ?? n.from, id, kept?.from ?? []),
        ...(kept ? { x: kept.x, y: kept.y } : {}),
      };
    });
    if (!nodes.length) throw new EmptyDiagramError(`The engine returned no components for the view "${vid}"`);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (n.parent !== null) {
        const mapped = guarded.has(n.id) ? n.parent : idMap.get(n.parent.trim());
        const par = mapped ? byId.get(mapped) : undefined;
        if (!par || par.form !== "group" || par.id === n.id) { warnings.push(`Component "${n.id}": parent "${n.parent}" is not a group here, moved to top level`); n.parent = null; }
        else n.parent = par.id;
      }
      if (n.detail !== null) {
        const mapped = viewIds.get(n.detail.trim());
        if (!mapped || mapped === vid) { warnings.push(`Component "${n.id}": inside view "${n.detail}" does not exist, link removed`); n.detail = null; }
        else n.detail = mapped;
      }
    }
    // Break parent cycles and over-deep nesting.
    for (const n of nodes) {
      const seen = new Set<string>([n.id]);
      let depth = 0;
      for (let p = n.parent; p; p = byId.get(p)?.parent ?? null) {
        depth++;
        if (seen.has(p) || depth > LIMITS.depth) { warnings.push(`Component "${n.id}": nesting ${seen.has(p) ? "loops" : "is too deep"}, moved to top level`); n.parent = null; break; }
        seen.add(p);
      }
    }

    // Lanes (diagram contract, Lane): spine orders unique among siblings; an anchor names a spine part of
    // this view, never the part itself or one inside it. Anything else is dropped, one warning each.
    const orders = new Set<string>();
    for (const n of nodes) if (n.lane && "spine" in n.lane) {
      const k = `${n.parent ?? ""}:${n.lane.spine}`;
      if (orders.has(k)) { warnings.push(`Component "${n.id}": spine order ${n.lane.spine} is taken among its siblings, lane dropped`); n.lane = null; }
      else orders.add(k);
    }
    for (const n of nodes) if (n.lane && "anchor" in n.lane) {
      const target = byId.get(idMap.get(n.lane.anchor.trim()) ?? n.lane.anchor);
      let inside = false;
      for (let p: NodeInput | undefined = target; p; p = p.parent ? byId.get(p.parent) : undefined) if (p.id === n.id) { inside = true; break; }
      if (!target || !target.lane || !("spine" in target.lane) || inside) {
        warnings.push(`Component "${n.id}": its anchor "${n.lane.anchor}" is not a spine part of this view, lane dropped`);
        n.lane = null;
      } else n.lane = { anchor: target.id, side: n.lane.side };
    }

    // Positions: `relayout` drops a position so the layout places it again; `at` moves.
    for (const r of arr(v.relayout).map(str)) {
      const id = idMap.get(r.trim());
      if (!id || !byId.has(id)) { warnings.push(`Ignored "${r}" in relayout: no such component`); continue; }
      if (guarded.has(id)) { warnings.push(`Ignored "${byId.get(id)!.label}" in relayout: it is outside the selected parts`); continue; }
      const n = byId.get(id)!;
      const ids = n.form === "group" ? [...descendantsOf(nodes, id)] : [id];
      for (const k of ids) { const c = byId.get(k)!; if (c.form !== "group" && !guarded.has(k)) { delete c.x; delete c.y; moves.delete(k); } }
    }
    const placed = new Set<string>();
    for (const [id, to] of moves) {
      const n = byId.get(id)!;
      if (n.form !== "group") { n.x = to.x; n.y = to.y; placed.add(id); continue; }
      // A group moves with everything inside it, by a whole number of grid steps; members with an
      // `at` of their own go to theirs.
      const box = baseRects.get(id);
      if (!box) { warnings.push(`Ignored the position of the new group "${id}": a group takes its place from what it holds`); continue; }
      const raw = groupAt.get(id)!;
      const dx = snap(raw.x - box.x), dy = snap(raw.y - box.y);
      for (const k of descendantsOf(nodes, id)) {
        const c = byId.get(k)!;
        if (moves.has(k) || c.form === "group" || c.x === undefined || c.y === undefined) continue;
        c.x += dx; c.y += dy; placed.add(k);
      }
    }
    const fresh = new Set(nodes.filter((n) => n.x === undefined || n.y === undefined).map((n) => n.id));

    const edges: DiagramEdge[] = [];
    const pairs = new Map<string, DiagramEdge>();
    const fenced = (a: string, b: string) => guarded.has(a) && guarded.has(b);
    for (const e of arr(v.edges).map(obj)) {
      const from = idMap.get(str(e.from).trim()), to = idMap.get(str(e.to).trim());
      if (!from || !to) { warnings.push(`Dropped the connection ${str(e.from)} → ${str(e.to)}: "${!from ? str(e.from) : str(e.to)}" does not exist`); continue; }
      if (from === to) { warnings.push(`Dropped the connection ${from} → ${to}: a component cannot connect to itself`); continue; }
      if (fenced(from, to)) continue; // between two guarded components: the stored connections come back below
      if (pairs.has(`${from}>${to}`)) { warnings.push(`Dropped a second connection ${from} → ${to}`); continue; }
      const back = pairs.get(`${to}>${from}`);
      if (back) { back.both = true; warnings.push(`Merged the connection ${from} → ${to} into ${to} → ${from} as two-way`); continue; }
      let style = str(e.style) as EdgeStyle;
      if (!STYLES.includes(style)) { warnings.push(`Connection ${from} → ${to}: style "${str(e.style)}" drawn as call`); style = "call"; }
      let step: number | null = null;
      if (Number.isInteger(e.step) && (e.step as number) > 0) step = e.step as number;
      else if (e.step !== null && e.step !== undefined) warnings.push(`Connection ${from} → ${to}: step ${JSON.stringify(e.step)} is not a positive whole number, dropped`);
      const edge: DiagramEdge = { id: "", from, to, label: clip(str(e.label), LIMITS.edgeLabel, `the label of ${from} → ${to}`), style, both: e.both === true, step };
      pairs.set(`${from}>${to}`, edge);
      edges.push(edge);
    }
    if (guarded.size && baseView) {
      const said = new Map<string, Record<string, unknown>>();
      for (const e of arr(v.edges).map(obj)) {
        const from = idMap.get(str(e.from).trim()), to = idMap.get(str(e.to).trim());
        if (from && to && fenced(from, to)) said.set(`${from}>${to}`, e);
      }
      for (const b of baseView.edges.filter((x) => fenced(x.from, x.to))) {
        const a = said.get(`${b.from}>${b.to}`);
        said.delete(`${b.from}>${b.to}`);
        if (!a || edgeKey(a) !== edgeKey(b as unknown as Record<string, unknown>)) warnings.push(`Kept the connection ${b.from} → ${b.to} as it was: it is outside the selected parts`);
        edges.push({ ...b, id: "" });
      }
      for (const k of said.keys()) warnings.push(`Ignored the new connection ${k.replace(">", " → ")}: it is outside the selected parts`);
    }
    // Texts are the user's; the engine never sees or changes them.
    const texts: DiagramText[] = (baseView?.texts ?? []).map((t) => ({ ...t }));
    const caption = obj(v.caption);
    const keepCaption = guarded.size > 0 && !!baseView;
    if (keepCaption && (!sameText(v.title, baseView!.title) || !sameText(caption.title, baseView!.caption.title) || !sameText(caption.lede, baseView!.caption.lede))) {
      warnings.push(`Kept the title and caption of view "${vid}" as they were: outside the selected parts`);
    }
    const titled = (said: unknown, fallback: string, what: string) => str(said).trim() || filled(fallback, `View "${vid}": no ${what}, set to "${fallback}"`);
    const view: DiagramView = {
      id: vid,
      // The server owns a post's association: a refine answer keeps it for a surviving view.
      postOf: baseView?.postOf ?? null,
      title: keepCaption ? baseView!.title : clip(titled(v.title, baseView?.title || "View", "title"), LIMITS.viewTitle, `the title of view "${vid}"`),
      caption: keepCaption ? { ...baseView!.caption } : {
        title: clip(titled(caption.title, baseView?.caption.title || ctx.base.title, "caption title"), LIMITS.captionTitle, `the caption of view "${vid}"`),
        lede: clip(str(caption.lede), LIMITS.lede, `the description of view "${vid}"`),
      },
      nodes: nodes as unknown as DiagramNode[],
      edges,
      texts,
    };
    return { view, placed, fresh };
  });

  // A connection that was already there keeps its id and its place in the list; new ones follow.
  let n = 1;
  for (const b of built) {
    if (!("view" in b)) continue;
    const base = ctx.base.views.find((x) => x.id === b.view.id);
    const old = new Map((base?.edges ?? []).map((e) => [`${e.from}>${e.to}`, e]));
    const rank = new Map((base?.edges ?? []).map((e, i) => [e.id, i]));
    for (const e of b.view.edges) {
      const o = old.get(`${e.from}>${e.to}`) ?? old.get(`${e.to}>${e.from}`);
      if (o && !used.has(o.id)) { e.id = o.id; used.add(o.id); }
    }
    b.view.edges.sort((p, q) => (rank.get(p.id) ?? 1e9) - (rank.get(q.id) ?? 1e9));
    for (const e of b.view.edges) if (!e.id) { while (used.has(`e${n}`)) n++; e.id = `e${n}`; used.add(e.id); }
  }
  const laid = built.map((b) => {
    if (!("view" in b)) return b;
    const out = layoutView(b.view as unknown as { nodes: NodeInput[]; edges: DiagramEdge[]; texts: DiagramText[]; id: string; title: string; caption: DiagramView["caption"] }) as unknown as DiagramView;
    clearOverlaps(out, b.placed, b.fresh, warnings);
    return out;
  });
  let title: string;
  if (scope.kind === "parts") {
    if (!sameText(d.title, ctx.base.title)) warnings.push(`Kept the drawing's title "${ctx.base.title}": outside the selected parts`);
    title = ctx.base.title;
  } else title = clip(str(d.title).trim() || filled(ctx.base.title, `The drawing has no title, kept "${ctx.base.title}"`), LIMITS.title, "the title");
  return {
    ...ctx.base,
    title,
    engine: ctx.engine,
    updatedAt: ctx.now,
    views: laid,
    warnings: [...ctx.base.warnings, ...warnings],
  };
}

/** Equal but for whitespace, which normalisation changes silently. */
const sameText = (said: unknown, stored: string) => str(said).replace(/\s+/g, " ").trim() === stored.replace(/\s+/g, " ").trim();
const clampPlace = (v: number) => Math.max(-LIMITS.place, Math.min(LIMITS.place, v));

/** Ids of everything inside `id` (children, their children …). */
function descendantsOf(nodes: readonly { id: string; parent: string | null }[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (p: string) => { for (const n of nodes) if (n.parent === p && !out.has(n.id)) { out.add(n.id); walk(n.id); } };
  walk(id);
  return out;
}

/**
 * A component the engine moved (or placed with `at`) that would cover one that stayed goes to the
 * nearest free spot, one warning each; groups then take their boxes again.
 */
function clearOverlaps(view: DiagramView, placed: Set<string>, fresh: Set<string>, warnings: string[]): void {
  if (!placed.size) return;
  const byId = new Map(view.nodes.map((x) => [x.id, x]));
  const ancestors = (id: string) => { const s = new Set<string>(); for (let p = byId.get(id)?.parent; p && !s.has(p); p = byId.get(p)?.parent) s.add(p); return s; };
  const holds = (g: DiagramNode, id: string) => g.form === "group" && descendantsOf(view.nodes, g.id).has(id);
  for (const id of placed) {
    const me0 = byId.get(id);
    if (!me0 || me0.form === "group") continue;
    const up = ancestors(id);
    const rects = layoutRects(view);
    const me = rects.get(id)!;
    const hit = view.nodes.find((o) => o.id !== id && !placed.has(o.id) && !fresh.has(o.id) && !up.has(o.id) && !holds(o, id) && overlaps(me, rects.get(o.id)!, 8));
    if (!hit) continue;
    const others = view.nodes.filter((o) => o.id !== id && !up.has(o.id) && !holds(o, id)).map((o) => rects.get(o.id)!);
    const p = freeSpot(others, { x: me.x + me.w / 2, y: me.y + me.h / 2 }, me.w, me.h);
    me0.x = p.x; me0.y = p.y;
    warnings.push(`Moved "${me0.label}" to the nearest free spot: where the engine put it, it covered "${hit.label}"`);
  }
  const rects = layoutRects(view);
  for (const g of view.nodes) if (g.form === "group") { const r = rects.get(g.id)!; g.x = Math.round(r.x); g.y = Math.round(r.y); }
}

/** A component as the engine sees it (no position); `facts` names the facts it shows (its `from` here). */
function draftNode(n: DiagramNode) {
  const { id, label, kind, form, icon, sub, items, description, files, parent, detail, place } = n;
  return { id, label, kind, form, icon, sub, items: [...items], description, files: [...files], parent, detail, place, lane: n.lane ?? null, facts: [...(n.from ?? [])] };
}

/** A stored view as the engine would have written it back unchanged. */
function draftOf(v: DiagramView): Record<string, unknown> {
  return {
    id: v.id, title: v.title, caption: { ...v.caption }, relayout: [],
    nodes: v.nodes.map((x) => ({ ...draftNode(x), at: null })),
    edges: v.edges.map(({ from, to, label, style, both, step }) => ({ from, to, label, style, both, step })),
  };
}

/** True when the engine's version of a view says what the stored one says: no change, no move. */
function sameView(was: DiagramView, raw: Record<string, unknown>): boolean {
  const nodes = arr(raw.nodes).map(obj), edges = arr(raw.edges).map(obj);
  if (nodes.length !== was.nodes.length || edges.length !== was.edges.length || arr(raw.relayout).length) return false;
  const rects = layoutRects(was);
  for (const x of nodes) {
    const b = was.nodes.find((y) => y.id === str(x.id));
    if (!b || nodeKey(x) !== nodeKey(draftNode(b))) return false;
    const at = obj(x.at), r = rects.get(b.id)!;
    if (finite(at.x) && finite(at.y) && (Math.abs(at.x - r.x) > 1 || Math.abs(at.y - r.y) > 1)) return false;
  }
  for (const e of edges) {
    const b = was.edges.find((y) => y.from === str(e.from) && y.to === str(e.to));
    if (!b || edgeKey(e) !== edgeKey(b as unknown as Record<string, unknown>)) return false;
  }
  const c = obj(raw.caption);
  return str(raw.title) === was.title && str(c.title) === was.caption.title && str(c.lede) === was.caption.lede;
}

/**
 * The engine-facing projection of a document: every component with its current `box`
 * (top-left and size; a group's from its members) in place of `x`/`y`; no edge ids, texts,
 * timestamps or requests.
 */
export function documentToDraft(doc: DiagramDocument): unknown {
  return {
    title: doc.title,
    views: doc.views.map((v) => {
      const rects = layoutRects(v);
      return {
        id: v.id, title: v.title, caption: { ...v.caption },
        nodes: v.nodes.map((x) => {
          const r = rects.get(x.id)!;
          return { ...draftNode(x), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } };
        }),
        edges: v.edges.map(({ from, to, label, style, both, step }) => ({ from, to, label, style, both, step })),
      };
    }),
  };
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

/**
 * JSON Schema of the engine's answer in the strict dialect both CLIs accept: every property
 * required, `additionalProperties: false`, absence as null.
 */
export const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "views"],
  properties: {
    title: { type: "string" },
    views: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "caption", "nodes", "edges", "relayout"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          caption: { type: "object", additionalProperties: false, required: ["title", "lede"], properties: { title: { type: "string" }, lede: { type: "string" } } },
          nodes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "kind", "form", "icon", "sub", "items", "description", "files", "parent", "detail", "place", "lane", "facts", "at"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                kind: { type: "string", enum: [...KINDS] },
                form: { type: "string", enum: [...FORMS] },
                icon: nullable({ type: "string", enum: [...ICONS] }),
                sub: { type: "string" },
                items: { type: "array", items: { type: "string" } },
                description: { type: "string" },
                files: { type: "array", items: { type: "string" } },
                parent: nullable({ type: "string" }),
                detail: nullable({ type: "string" }),
                place: nullable({ type: "object", additionalProperties: false, required: ["row", "col"], properties: { row: { type: "integer" }, col: { type: "integer" } } }),
                lane: { anyOf: [
                  { type: "object", additionalProperties: false, required: ["spine"], properties: { spine: { type: "integer" } } },
                  { type: "object", additionalProperties: false, required: ["anchor", "side"], properties: { anchor: { type: "string" }, side: { type: "string", enum: ["above", "below"] } } },
                  { type: "null" },
                ] },
                facts: { type: "array", items: { type: "string" } },
                at: nullable({ type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "integer" }, y: { type: "integer" } } }),
              },
            },
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to", "label", "style", "both", "step"],
              properties: {
                from: { type: "string" }, to: { type: "string" }, label: { type: "string" },
                style: { type: "string", enum: [...STYLES] }, both: { type: "boolean" },
                step: nullable({ type: "integer" }),
              },
            },
          },
          relayout: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
