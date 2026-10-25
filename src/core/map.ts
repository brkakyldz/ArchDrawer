/**
 * The map (docs/contracts/diagram.md, *The map*; ADR 0015): the overview of a `system` choice is drawn as one
 * view and then split by code into the map — the system's main groups — and one detail view per group that
 * holds parts. Pure (invariant 4). The split adds no warning, except for groups the 30-view limit keeps.
 */
import { draftOf, joinChannel, joinView } from "./channels";
import { freeIdAmong, type Connection, type Document3, type Part, type View3 } from "./file3";
import { layoutView } from "./layout";
import { LIMITS, type DiagramDocument, type EdgeStyle } from "./model";

/** Groups past this many keep their parts on the map (rule 5: an overview holds at most 30 views). */
const MAX_DETAILS = LIMITS.views - 1;

/** Split the overview's one view of `doc` into the map and its detail views. `taken`: view ids other choices hold. */
export function splitMap(doc: Document3, taken: Iterable<string> = []): Document3 {
  const view = doc.channels.overview.views[0];
  if (!view) return doc;
  const byId = new Map(view.nodes.map((p) => [p.id, p]));
  const holds = (id: string) => view.nodes.some((p) => p.parent === id);
  const candidates = view.nodes.filter((p) => p.form === "group" && p.parent === null && holds(p.id));
  const detailed = candidates.slice(0, MAX_DETAILS);
  const kept = candidates.length - detailed.length;
  const warnings = kept ? [`Kept ${kept} groups on the map: an overview holds at most ${LIMITS.views} views`] : [];
  if (!detailed.length) return warnings.length ? { ...doc, warnings: [...doc.warnings, ...warnings] } : doc;

  // Where each part goes: the map ("") or the detail view of the group it lies in.
  const home = new Map<string, string>();
  const topOf = (p: Part): Part => { let cur = p; const seen = new Set<string>(); while (cur.parent && byId.has(cur.parent) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent)!; } return cur; };
  const detailIds = new Set(detailed.map((g) => g.id));
  for (const p of view.nodes) {
    const top = topOf(p);
    home.set(p.id, detailIds.has(top.id) && top.id !== p.id ? top.id : "");
  }
  const used = new Set<string>([...taken, ...Object.values(doc.channels).flatMap((c) => c.views.map((v) => v.id))]);
  const viewOf = new Map<string, string>();
  for (const g of detailed) { const id = freeIdAmong(used, `${g.id}-inside`); used.add(id); viewOf.set(g.id, id); }

  const joined = joinChannel(doc, "overview").views[0];
  const labelOf = (id: string) => joined.nodes.find((n) => n.id === id)?.label ?? id;
  const rels = new Map(doc.facts.relations.map((r) => [r.id, r]));
  const strip = ({ x: _x, y: _y, ...p }: Part) => p as Part;
  const laneIn = (p: Part, inView: Set<string>): Part => {
    // A side lane whose anchor is not in the part's view is dropped.
    if (p.lane && "anchor" in p.lane && !inView.has(p.lane.anchor)) return { ...p, lane: null };
    return p;
  };

  // The map's parts: the plain top-level parts, the groups kept, and one part per detailed group.
  const onMap = view.nodes.filter((p) => home.get(p.id) === "" );
  const mapIds = new Set(onMap.map((p) => p.id));
  const mapNodes: Part[] = onMap.map((p) => {
    if (!detailIds.has(p.id)) return strip(laneIn(p, mapIds));
    // The spine of the group's own level: nested holders number their own spines.
    const spines = view.nodes.filter((q) => q.parent === p.id).flatMap((q) => (q.lane && "spine" in q.lane ? [q.lane.spine] : []));
    const rows = (p.held?.length ?? 0) + (p.limits?.length ?? 0) > 0;
    const zone = p.facts.length === 0;
    const part: Part = {
      id: p.id, facts: [...p.facts], form: rows ? "panel" : "card", icon: p.icon, parent: null, detail: viewOf.get(p.id)!, place: p.place,
      lane: spines.length ? { spine: Math.min(...spines) } : null, x: 0, y: 0,
      ...(zone ? { label: p.label ?? labelOf(p.id), kind: "service" as const, description: "A group of components." } : {}),
      ...(!zone && p.label != null ? { label: p.label } : {}), ...(!zone && p.kind != null ? { kind: p.kind } : {}),
      ...(!zone && p.sub != null ? { sub: p.sub } : {}), ...(!zone && p.description != null ? { description: p.description } : {}),
      ...(!zone && p.held?.length ? { held: [...p.held] } : {}), ...(!zone && p.limits?.length ? { limits: [...p.limits] } : {}),
    };
    return strip(part);
  });

  // Each detail view: the parts inside its group, those directly inside at its top level.
  const details: View3[] = detailed.map((g) => {
    const inside = view.nodes.filter((q) => home.get(q.id) === g.id);
    const ids = new Set(inside.map((q) => q.id));
    const label = labelOf(g.id);
    return {
      id: viewOf.get(g.id)!, title: label.slice(0, 60), caption: { title: label, lede: "" }, texts: [],
      nodes: inside.map((q) => strip(laneIn({ ...q, parent: q.parent === g.id ? null : q.parent, detail: null }, ids))),
      edges: [],
    };
  });

  // Connections: kept in the one view holding both ends, else lifted to the map onto the parts holding them.
  const mapPartOf = (id: string) => home.get(id) || id;
  const factsOf = (id: string) => new Set(byId.get(id)?.facts ?? []);
  const mapEdges: Connection[] = [];
  const lifted = new Map<string, Connection[]>();
  for (const e of view.edges) {
    const a = home.get(e.from) ?? "", b = home.get(e.to) ?? "";
    if (a === b && a !== "") { details.find((d) => d.id === viewOf.get(a))!.edges.push({ ...e }); continue; }
    if (a === "" && b === "") { mapEdges.push({ ...e }); continue; }
    const from = mapPartOf(e.from), to = mapPartOf(e.to);
    if (from === to) continue;
    const key = [from, to].sort().join("\u0000");
    lifted.set(key, [...(lifted.get(key) ?? []), { ...e, from, to }]);
  }
  for (const list of lifted.values()) {
    // A connection already on the map between the same two parts joins them: one connection per pair (rule 12).
    const direct = mapEdges.filter((m) => [m.from, m.to].sort().join("\u0000") === [list[0].from, list[0].to].sort().join("\u0000"));
    for (const d of direct) mapEdges.splice(mapEdges.indexOf(d), 1);
    const merged = mergeLifted([...direct, ...list], factsOf, rels);
    mapEdges.push({ ...merged, id: freeIdAmong(new Set(mapEdges.map((m) => m.id)), merged.id) });
  }

  // Steps are numbered 1, 2, 3 … again in each view, in their order.
  const renumber = (edges: Connection[]) => {
    const stepped = edges.filter((e) => e.step !== null).sort((x, y) => x.step! - y.step!);
    stepped.forEach((e, i) => { e.step = i + 1; });
  };
  renumber(mapEdges);
  for (const d of details) renumber(d.edges);

  const map: View3 = { ...view, nodes: mapNodes, edges: mapEdges };
  const next: Document3 = { ...doc, warnings: [...doc.warnings, ...warnings], channels: { ...doc.channels, overview: { ...doc.channels.overview, views: [map, ...details] } } };
  // Every view is laid out again by its lanes, wide.
  for (const v of next.channels.overview.views) {
    const placed = layoutView(joinView(next, "overview", v));
    const at = new Map(placed.nodes.map((n) => [n.id, n]));
    for (const p of v.nodes) { const n = at.get(p.id); if (n) { p.x = n.x; p.y = n.y; } }
  }
  return next;
}

/** Connections lifted onto one pair of map parts, as one map connection (diagram contract, The map: Connections). */
function mergeLifted(list: Connection[], factsOf: (id: string) => Set<string>, rels: Map<string, { from: string; to: string; label: string; style: EdgeStyle; both: boolean }>): Connection {
  const first = list[0];
  const A = factsOf(first.from), B = factsOf(first.to);
  const joins = (r: { from: string; to: string }) => (A.has(r.from) && B.has(r.to)) || (B.has(r.from) && A.has(r.to));
  const relations = [...new Set(list.flatMap((c) => c.relations))].filter((id) => { const r = rels.get(id); return !!r && joins(r); });
  const single = list.length === 1;
  const own = (c: Connection) => ({ label: c.label ?? (c.relations.length === 1 ? rels.get(c.relations[0])?.label : undefined) ?? "", style: c.style ?? (c.relations.length === 1 ? rels.get(c.relations[0])?.style : undefined) ?? "call", both: c.both ?? (c.relations.length === 1 ? rels.get(c.relations[0])?.both : undefined) ?? false });
  const styles = new Set(list.map((c) => own(c).style));
  const steps = list.flatMap((c) => (c.step === null ? [] : [c.step]));
  const both = single ? own(first).both : list.some((c) => c.from !== first.from) || list.some((c) => own(c).both);
  const label = single ? own(first).label : "";
  const style: EdgeStyle = single ? own(first).style : styles.size === 1 ? [...styles][0] : "call";
  let from = first.from, to = first.to;
  // A connection showing exactly one relation that runs the other way follows the relation (rule 12).
  if (relations.length === 1) { const r = rels.get(relations[0])!; if (!r.both && !both && A.has(r.to) && B.has(r.from)) [from, to] = [to, from]; }
  const out: Connection = { id: `${from}-${to}`, from, to, relations, step: steps.length ? Math.min(...steps) : null };
  if (relations.length !== 1) return { ...out, label, style, both };
  const r = rels.get(relations[0])!;
  return { ...out, ...(label !== r.label ? { label } : {}), ...(style !== r.style ? { style } : {}), ...(both !== r.both ? { both } : {}) };
}

/**
 * An overview's views in the views panel's order (ui contract, Choices and the views panel): the first view; then
 * the views `detail` links reach from it, depth first, each after the view linking to it, in the order of the
 * linking parts; then the views no link reaches, in file order.
 */
export function panelOrder<V extends { id: string; nodes: { detail: string | null }[] }>(views: V[]): V[] {
  if (!views.length) return views;
  const byId = new Map(views.map((v) => [v.id, v]));
  const out: V[] = [];
  const seen = new Set<string>();
  const visit = (v: V) => {
    if (seen.has(v.id)) return;
    seen.add(v.id); out.push(v);
    for (const n of v.nodes) { const next = n.detail ? byId.get(n.detail) : undefined; if (next) visit(next); }
  };
  visit(views[0]);
  return [...out, ...views.filter((v) => !seen.has(v.id))];
}

/**
 * The map and its detail views as the one view a channel is told from (diagram contract, The map; ui contract,
 * Simple versions): every part of the views in panel order but those whose inside is one of them, with the
 * connections between the parts kept. The first view's id, title and caption.
 */
export function mapAsOneView<V extends { id: string; nodes: { id: string; detail: string | null }[]; edges: { from: string; to: string }[] }>(views: V[]): V {
  const ordered = panelOrder(views);
  const [map] = ordered;
  if (!map || ordered.length === 1) return map;
  const inside = new Set(ordered.map((v) => v.id));
  const nodes = ordered.flatMap((v) => v.nodes.filter((n) => !n.detail || !inside.has(n.detail)));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = ordered.flatMap((v) => v.edges).filter((e) => ids.has(e.from) && ids.has(e.to));
  return { ...map, nodes, edges };
}

/** The overview's views a channel is told from, as one view: the first view; for the `system` choice the map and its detail views. */
export const toldFrom = <V extends { id: string; nodes: { id: string; detail: string | null }[]; edges: { from: string; to: string }[] }>(stored: Pick<Document3, "ids">, views: V[]): V =>
  stored.ids?.system ? mapAsOneView(views) : views[0];

/** The overview draft a channel's story is told from (`draftOf`), its one view `toldFrom`. */
export function storyDraft(stored: Document3): DiagramDocument {
  const d = draftOf(stored, "overview");
  return stored.ids?.system && d.views.length > 1 ? { ...d, views: [mapAsOneView(d.views)] } : d;
}
