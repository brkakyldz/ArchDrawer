import { layoutRects, measureNode, postOf, type Rect } from "../../core/geometry";
import { freeSpot } from "../../core/layout";
import {
  allIds, descendants, LIMITS, slugify, TEXT_SIZE,
  type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramText, type DiagramView, type Form, type Kind,
} from "../../core/model";

/**
 * Pure edits of a document (the editor's verbs, ui contract). Every function returns a new
 * document and leaves its input alone, so undo is a stack of documents.
 */

export const viewOf = (doc: DiagramDocument, vid: string): DiagramView => doc.views.find((v) => v.id === vid) ?? doc.views[0];

function mapView(doc: DiagramDocument, vid: string, fn: (v: DiagramView) => DiagramView, sync = true): DiagramDocument {
  return { ...doc, views: doc.views.map((v) => (v.id === vid ? keepLanes(sync ? syncGroups(fn(v)) : fn(v), v) : v)) };
}

/**
 * Lanes stay valid after every edit (diagram contract, Lane; as src/core/repair.ts does for an engine's
 * answer): a spine order already held among the new siblings goes from the part that moved there,
 * and an anchor that is gone, no longer on the spine, or inside the part itself is dropped.
 */
export function keepLanes(v: DiagramView, before?: DiagramView): DiagramView {
  if (!v.nodes.some((n) => n.lane)) return v;
  const was = new Map((before?.nodes ?? []).map((n) => [n.id, n.parent]));
  const stayed = (n: DiagramNode) => was.has(n.id) && was.get(n.id) === n.parent;
  const lanes = new Map(v.nodes.map((n) => [n.id, n.lane]));
  const orders = new Set<string>();
  // Parts still among the same siblings claim their orders first.
  for (const first of [true, false]) for (const n of v.nodes) {
    const l = n.lane;
    if (!l || !("spine" in l) || stayed(n) !== first) continue;
    const k = `${n.parent ?? ""}:${l.spine}`;
    if (orders.has(k)) lanes.set(n.id, null);
    else orders.add(k);
  }
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  for (const n of v.nodes) {
    const l = n.lane;
    if (!l || !("anchor" in l)) continue;
    const target = byId.get(l.anchor);
    const tl = target ? lanes.get(target.id) : null;
    let inside = false;
    const seen = new Set<string>();
    for (let p = target; p && !seen.has(p.id); p = p.parent ? byId.get(p.parent) : undefined) {
      if (p.id === n.id) { inside = true; break; }
      seen.add(p.id);
    }
    if (!tl || !("spine" in tl) || inside) lanes.set(n.id, null);
  }
  if (v.nodes.every((n) => lanes.get(n.id) === n.lane)) return v;
  return { ...v, nodes: v.nodes.map((n) => (lanes.get(n.id) === n.lane ? n : { ...n, lane: null })) };
}

const GRID = 8;
export const snap = (v: number) => Math.round(v / GRID) * GRID;
/** Sizes keep one decimal and stay within the contract's range. */
export const clampTextSize = (s: number) => Math.round(Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, s)) * 10) / 10;

/** A group's stored x/y is its drawn box (diagram contract, Normalisation), so it stays put when emptied. */
export function syncGroups(v: DiagramView): DiagramView {
  if (!v.nodes.some((n) => n.form === "group")) return v;
  const rects = layoutRects(v);
  let changed = false;
  const nodes = v.nodes.map((n) => {
    if (n.form !== "group") return n;
    const r = rects.get(n.id)!;
    if (r.x === n.x && r.y === n.y) return n;
    changed = true;
    return { ...n, x: r.x, y: r.y };
  });
  return changed ? { ...v, nodes } : v;
}

/** Fresh id from a label, unique across the document. */
export function freshId(doc: DiagramDocument, base: string): string {
  const used = allIds(doc);
  const root = slugify(base).slice(0, 48) || "item";
  let id = root;
  for (let i = 2; used.has(id); i++) id = `${root}-${i}`;
  return id;
}

/** The selected components plus everything inside the groups among them. */
function withInside(v: DiagramView, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) { out.add(id); for (const d of descendants(v, id)) out.add(d); }
  return out;
}

/** Move components (and what they hold) by dx, dy. Live drag: no snapping. */
export function moveNodes(doc: DiagramDocument, vid: string, ids: Iterable<string>, dx: number, dy: number): DiagramDocument {
  return mapView(doc, vid, (v) => {
    const moving = withInside(v, ids);
    return {
      ...v,
      nodes: v.nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
    };
    // Groups keep their stored place while a member is dragged: settleNodes measures a group
    // without the dragged piece, and a group that followed its only member would always hold it.
  }, false);
}

/**
 * After a drag: snap the moved components to the 8 px grid, then give each moved top-level piece
 * the innermost group under its centre as its parent (or none), as deep as nesting allows.
 */
export function settleNodes(doc: DiagramDocument, vid: string, ids: Iterable<string>): DiagramDocument {
  return mapView(doc, vid, (v0) => {
    const moved = withInside(v0, ids);
    const tops = [...moved].filter((id) => { const p = v0.nodes.find((n) => n.id === id)!.parent; return !p || !moved.has(p); });
    let v: DiagramView = { ...v0, nodes: v0.nodes.map((n) => (moved.has(n.id) ? { ...n, x: snap(n.x), y: snap(n.y) } : n)) };
    for (const id of tops) v = { ...v, nodes: v.nodes.map((n) => (n.id === id ? { ...n, parent: groupAt(v, centreOf(v, id), id) } : n)) };
    return v;
  });
}

const centreOf = (v: DiagramView, id: string) => { const r = layoutRects(v).get(id)!; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

const depth = (v: DiagramView, id: string | null): number => {
  let d = 0;
  for (let p = id; p; p = v.nodes.find((n) => n.id === p)?.parent ?? null) d++;
  return d;
};
/** Levels of nesting a component brings with it (1 for a plain component). */
const height = (v: DiagramView, id: string): number => 1 + Math.max(0, ...v.nodes.filter((n) => n.parent === id).map((n) => height(v, n.id)));

/** The innermost group whose box holds the point, excluding `self` and what it holds; null for none. */
export function groupAt(v: DiagramView, p: { x: number; y: number }, self: string | null = null): string | null {
  // Measure the groups without the piece being placed, or a group would stretch to follow it.
  const rects = layoutRects(self ? { nodes: v.nodes.map((n) => (n.id === self ? { ...n, parent: null } : n)) } : v);
  const excluded = self ? withInside(v, [self]) : new Set<string>();
  let best: { id: string; d: number } | null = null;
  for (const n of v.nodes) {
    if (n.form !== "group" || excluded.has(n.id)) continue;
    const r = rects.get(n.id)!;
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
    if (self && depth(v, n.id) + height(v, self) > LIMITS.depth + 1) continue;
    const d = depth(v, n.id);
    if (!best || d > best.d) best = { id: n.id, d };
  }
  return best?.id ?? null;
}

const takenRects = (v: DiagramView, except: Set<string> = new Set()): Rect[] => {
  const rects = layoutRects(v);
  return v.nodes.filter((n) => n.form !== "group" && !except.has(n.id)).map((n) => rects.get(n.id)!);
};

/** Add a component labelled "New component" centred at `at` (nudged to a free spot), inside the group there. */
export function addNode(doc: DiagramDocument, vid: string, kind: Kind, form: Form, at: { x: number; y: number }): { doc: DiagramDocument; id: string } {
  const id = freshId(doc, "new-component");
  const next = mapView(doc, vid, (v) => {
    const base: DiagramNode = {
      id, label: "New component", kind, form, icon: null, sub: "", items: form === "panel" ? ["New item"] : [], description: "No description yet.",
      files: [], parent: groupAt(v, at), detail: null, place: null, x: 0, y: 0,
    };
    const box = form === "group" ? { w: 260, h: 140 } : measureNode(base, { post: postOf(v) });
    const spot = freeSpot(takenRects(v), at, box.w, box.h, 16);
    return { ...v, nodes: [...v.nodes, { ...base, x: spot.x, y: spot.y }] };
  });
  return { doc: next, id };
}

/** Delete components: their connections go, a group's members move to its parent. */
export function deleteNodes(doc: DiagramDocument, vid: string, ids: Iterable<string>): DiagramDocument {
  const gone = new Set(ids);
  return mapView(doc, vid, (v) => {
    const parentOf = (id: string | null): string | null => {
      let p = id;
      while (p && gone.has(p)) p = v.nodes.find((n) => n.id === p)?.parent ?? null;
      return p;
    };
    return {
      ...v,
      nodes: v.nodes.filter((n) => !gone.has(n.id)).map((n) => (n.parent && gone.has(n.parent) ? { ...n, parent: parentOf(n.parent) } : n)),
      edges: v.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
    };
  });
}

export type NodePatch = Partial<Pick<DiagramNode, "label" | "kind" | "form" | "icon" | "sub" | "items" | "description" | "files" | "parent" | "detail">>;

/**
 * Change a component's fields with the form rules of the ui contract: becoming a panel without items adds
 * `New item`; a panel whose last item goes becomes a card; leaving `group` moves its members to its parent.
 */
export function setNode(doc: DiagramDocument, vid: string, id: string, patch: NodePatch): DiagramDocument {
  return mapView(doc, vid, (v) => {
    const old = v.nodes.find((n) => n.id === id);
    if (!old) return v;
    const n: DiagramNode = { ...old, ...patch };
    if (patch.label !== undefined && !patch.label.trim()) n.label = old.label;
    n.label = n.label.trim().slice(0, LIMITS.label);
    // Becoming a panel shows what the part holds, or `New item` when it holds nothing; emptying a
    // panel makes it a card; leaving the panel form only hides the items (diagram contract, Items).
    if (n.form === "panel" && n.items.length === 0) {
      if (patch.form === "panel") n.items = old.held?.length ? [...old.held] : ["New item"];
      else n.form = "card";
    }
    let nodes = v.nodes.map((m) => (m.id === id ? n : m));
    if (old.form === "group" && n.form !== "group") nodes = nodes.map((m) => (m.parent === id ? { ...m, parent: old.parent } : m));
    if (patch.parent !== undefined && patch.parent !== old.parent) {
      const p = patch.parent && v.nodes.find((m) => m.id === patch.parent);
      if (patch.parent && (!p || p.form !== "group" || withInside(v, [id]).has(patch.parent) || depth(v, patch.parent) + height(v, id) > LIMITS.depth + 1)) return v;
      // Moving into a group places the component inside its box, at a free spot.
      if (p) {
        const r = layoutRects(v).get(p.id)!;
        const box = layoutRects(v).get(id)!;
        const others = v.nodes.filter((m) => m.parent === p.id && m.form !== "group");
        const rects = layoutRects(v);
        const spot = freeSpot(others.map((m) => rects.get(m.id)!), { x: r.x + r.w / 2, y: r.y + r.h / 2 }, box.w, box.h, 16);
        const dx = spot.x - box.x, dy = spot.y - box.y;
        const moving = withInside(v, [id]);
        nodes = nodes.map((m) => (moving.has(m.id) ? { ...m, x: m.x + dx, y: m.y + dy } : m));
      }
    }
    return { ...v, nodes };
  });
}

export type ConnectResult = { doc: DiagramDocument; id: string | null; message: string | null };

/** Connect two components (ui contract Connections): a reverse connection becomes two-way; a duplicate or a loop does nothing. */
export function connect(doc: DiagramDocument, vid: string, from: string, to: string): ConnectResult {
  if (from === to) return { doc, id: null, message: null };
  const v = viewOf(doc, vid);
  if (v.edges.some((e) => e.from === from && e.to === to)) return { doc, id: null, message: "Already connected" };
  const back = v.edges.find((e) => e.from === to && e.to === from);
  if (back) {
    if (back.both) return { doc, id: back.id, message: "Already connected both ways" };
    return { doc: setEdge(doc, vid, back.id, { both: true }), id: back.id, message: "Made the connection two-way" };
  }
  const used = allIds(doc);
  let k = 1;
  while (used.has(`e${k}`)) k++;
  const edge: DiagramEdge = { id: `e${k}`, from, to, label: "", style: "call", both: false, step: null };
  return { doc: mapView(doc, vid, (x) => ({ ...x, edges: [...x.edges, edge] })), id: edge.id, message: null };
}

export function setEdge(doc: DiagramDocument, vid: string, id: string, patch: Partial<Pick<DiagramEdge, "label" | "style" | "both" | "step">>): DiagramDocument {
  const p = { ...patch };
  if (p.label !== undefined) p.label = p.label.trim().slice(0, LIMITS.edgeLabel);
  if (p.step !== undefined && p.step !== null && (!Number.isInteger(p.step) || p.step < 1)) p.step = null;
  return mapView(doc, vid, (v) => ({ ...v, edges: v.edges.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
}

export function reverseEdge(doc: DiagramDocument, vid: string, id: string): DiagramDocument {
  return mapView(doc, vid, (v) => {
    const e = v.edges.find((x) => x.id === id);
    if (!e || v.edges.some((x) => x.from === e.to && x.to === e.from && x.id !== id)) return v;
    return { ...v, edges: v.edges.map((x) => (x.id === id ? { ...x, from: x.to, to: x.from } : x)) };
  });
}

export function deleteEdges(doc: DiagramDocument, vid: string, ids: Iterable<string>): DiagramDocument {
  const gone = new Set(ids);
  return mapView(doc, vid, (v) => ({ ...v, edges: v.edges.filter((e) => !gone.has(e.id)) }));
}

/** Free text at a point: `body` size unless asked, its top-left on the grid. */
/** A text lands exactly where it was typed (the canvas snaps the click before the editor opens). */
export function addText(doc: DiagramDocument, vid: string, at: { x: number; y: number }, text: string, size: number = TEXT_SIZE.default): { doc: DiagramDocument; id: string } {
  const used = allIds(doc);
  let k = 1;
  while (used.has(`t${k}`)) k++;
  const t: DiagramText = { id: `t${k}`, text: text.slice(0, LIMITS.text), x: at.x, y: at.y, size: clampTextSize(size) };
  return { doc: mapView(doc, vid, (v) => ({ ...v, texts: [...v.texts, t] })), id: t.id };
}

export function setText(doc: DiagramDocument, vid: string, id: string, patch: Partial<Pick<DiagramText, "text" | "x" | "y" | "size">>): DiagramDocument {
  const p = { ...patch };
  if (p.text !== undefined) p.text = p.text.slice(0, LIMITS.text);
  if (p.size !== undefined) p.size = clampTextSize(p.size);
  return mapView(doc, vid, (v) => ({ ...v, texts: v.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
}

export function deleteTexts(doc: DiagramDocument, vid: string, ids: Iterable<string>): DiagramDocument {
  const gone = new Set(ids);
  return mapView(doc, vid, (v) => ({ ...v, texts: v.texts.filter((t) => !gone.has(t.id)) }));
}

export function moveTexts(doc: DiagramDocument, vid: string, ids: Iterable<string>, dx: number, dy: number, settle = false): DiagramDocument {
  const moving = new Set(ids);
  return mapView(doc, vid, (v) => ({
    ...v,
    texts: v.texts.map((t) => (moving.has(t.id) ? { ...t, x: settle ? snap(t.x + dx) : t.x + dx, y: settle ? snap(t.y + dy) : t.y + dy } : t)),
  }), settle);
}

/** A new view for a component's inside: titled after it, holding one copy of it; the component links to it. */
export function createInside(doc: DiagramDocument, vid: string, id: string): { doc: DiagramDocument; view: string } {
  const src = viewOf(doc, vid).nodes.find((n) => n.id === id);
  if (!src) return { doc, view: vid };
  const view = freshId(doc, `${src.label}-inside`);
  const copyId = freshId({ ...doc, views: [...doc.views, { id: view, title: "", caption: { title: "", lede: "" }, postOf: null, nodes: [], edges: [], texts: [] }] }, src.id);
  const copy: DiagramNode = { ...src, id: copyId, parent: null, detail: null, place: { row: 0, col: 0 }, x: 40, y: 40, form: src.form === "group" ? "card" : src.form };
  const next: DiagramDocument = {
    ...doc,
    views: [
      ...doc.views.map((v) => (v.id === vid ? { ...v, nodes: v.nodes.map((n) => (n.id === id ? { ...n, detail: view } : n)) } : v)),
      keepLanes({ id: view, title: src.label.slice(0, LIMITS.viewTitle), caption: { title: src.label, lede: "" }, postOf: null, nodes: [copy], edges: [], texts: [] }),
    ],
  };
  return { doc: next, view };
}

/** The breadcrumb from the first view to `vid`, following the components whose `detail` leads there. */
export function crumbsTo(doc: DiagramDocument, vid: string): string[] {
  const top = doc.views[0].id;
  const parentOf = new Map<string, string>();
  const queue = [top];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of viewOf(doc, cur).nodes) {
      if (n.detail && !parentOf.has(n.detail) && n.detail !== top) { parentOf.set(n.detail, cur); queue.push(n.detail); }
    }
  }
  const path = [vid];
  for (let p = parentOf.get(vid); p && !path.includes(p); p = parentOf.get(p)) path.unshift(p);
  if (path[0] !== top) path.unshift(top);
  return path;
}
