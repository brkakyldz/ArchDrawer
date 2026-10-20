import { applyChannel, clearOutdated, joinChannel, type ApplyResult } from "../channels";
import { freeIdAmong, type Document3 } from "../file3";
import { measureNode } from "../geometry";
import { linkedInViewId, postSource, postViewId } from "../intent";
import {
  allIds, LIMITS, slugify,
  type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramView,
} from "../model";

/**
 * The LinkedIn version of a view: a view of its own that the editor opens and the user
 * edits, laid out for the tall 1080×1350 feed image. Groups fold into one part and texts are left
 * out; the parts that explain the system stay open as panels, the rest of the main path are cards
 * and everything else is compact. The numbered path is renumbered 1, 2, 3 … and snakes
 * across the grid, and every other part sits beside what it talks to, keeping the side it was on;
 * then moves and swaps improve it. The source view is never changed.
 */

export interface FoldOptions {
  /** Keep each part's form and items (re-arranging a LinkedIn view the user edited). Default false: forms by importance. */
  keepForms?: boolean;
}

/** The description a part has when nobody wrote one (normalize, repair). */
const PLACEHOLDER = "No description yet.";
/** Open parts: at least this score, at most this many; at most this many items each. */
const OPEN = { min: 5, max: 4, items: 5 } as const;

/**
 * The importance of each part of a folded view: 4 on the numbered main path, 1 per
 * connection (at most 4), 2 when it holds something, 1 for a description of its own.
 */
export function importance(parts: readonly DiagramNode[], edges: readonly DiagramEdge[], holds: (n: DiagramNode) => string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of parts) {
    const touching = edges.filter((e) => e.from === n.id || e.to === n.id);
    const main = touching.some((e) => e.step !== null);
    out.set(n.id, (main ? 4 : 0) + Math.min(4, touching.length) + (holds(n).length ? 2 : 0) + (n.description.trim() && n.description.trim() !== PLACEHOLDER ? 1 : 0));
  }
  return out;
}

/** What an open part lists: at most five entries, a longer list ending with `+ <n> more`. */
const listed = (all: string[]) => (all.length > OPEN.items ? [...all.slice(0, OPEN.items - 1), `+ ${all.length - (OPEN.items - 1)} more`] : all).map((t) => t.slice(0, LIMITS.item));

/** A card whose sub-line its width would cut short. */
const cardClips = (n: DiagramNode) => !!n.sub && measureNode({ ...n, form: "card" }, { post: true }).sub !== n.sub;

/** Fold groups into their top-level part and merge the connections that land on the same pair. Ids stay. */
export function foldForFeed(v: DiagramView, o: FoldOptions = {}): DiagramView {
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const top = (id: string): string => {
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur?.parent && byId.has(cur.parent) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent); }
    return cur?.id ?? id;
  };
  const parts = v.nodes.filter((n) => !n.parent || !byId.has(n.parent));

  const edges: DiagramEdge[] = [];
  const pair = new Map<string, DiagramEdge>();
  const fold = (into: DiagramEdge, e: DiagramEdge) => {
    if (e.step !== null && (into.step === null || e.step < into.step)) { into.step = e.step; if (e.label) into.label = e.label; }
    else if (!into.label && e.label) into.label = e.label;
    // A folded connection shows every relation the connections it folds showed.
    if (e.relations?.length) into.relations = [...new Set([...(into.relations ?? []), ...e.relations])];
  };
  for (const e of v.edges) {
    const a = top(e.from), b = top(e.to);
    if (a === b) continue;
    const back = pair.get(`${b}>${a}`);
    if (back) { back.both = true; fold(back, e); continue; }
    const same = pair.get(`${a}>${b}`);
    if (same) { fold(same, e); continue; }
    const x: DiagramEdge = { ...e, from: a, to: b };
    pair.set(`${a}>${b}`, x);
    edges.push(x);
  }
  // A step whose both ends folded into one part is gone; the path is numbered 1, 2, 3 … again.
  edges.filter((e) => e.step !== null).sort((p, q) => p.step! - q.step!).forEach((e, i) => { e.step = i + 1; });

  if (o.keepForms) {
    const nodes = parts.map((n): DiagramNode => {
      const keep = n.form !== "group";
      return { ...n, form: keep ? n.form : "card", items: keep ? n.items : [], parent: null, detail: null, place: null };
    });
    return { ...v, nodes, edges, texts: [] };
  }

  // Forms by importance. A folded group holds its members: every part inside it that is
  // not itself a group, in view order.
  const inside = (id: string): DiagramNode[] => v.nodes.filter((m) => m.parent === id).flatMap((m) => (m.form === "group" ? inside(m.id) : [m]));
  const holds = (n: DiagramNode) => (n.form === "group" ? inside(n.id).map((m) => m.label) : n.form === "panel" ? n.items : []);
  const score = importance(parts, edges, holds);
  const path: string[] = [];
  for (const e of edges.filter((x) => x.step !== null).sort((p, q) => p.step! - q.step!)) for (const id of [e.from, e.to]) if (!path.includes(id)) path.push(id);
  const rank = (id: string) => (path.includes(id) ? path.indexOf(id) : path.length);
  const order = [...parts].sort((p, q) => score.get(q.id)! - score.get(p.id)! || rank(p.id) - rank(q.id) || parts.indexOf(p) - parts.indexOf(q));
  const open = new Set(order.filter((n) => score.get(n.id)! >= OPEN.min).slice(0, OPEN.max).map((n) => n.id));
  const nodes = parts.map((n): DiagramNode => {
    const base = { ...n, parent: null, detail: null, place: null };
    const held = holds(n);
    if (open.has(n.id) && held.length) return { ...base, form: "panel", items: listed(held) };
    const card: DiagramNode = { ...base, form: "card", items: [] };
    if ((open.has(n.id) || path.includes(n.id)) && !cardClips(card)) return card;
    return { ...base, form: "compact", items: [] };
  });
  return { ...v, nodes, edges, texts: [] };
}

/** Grid cells, in drawing px. */
const GAP_X = 96, GAP_Y = 84;
/** The room the drawing gets inside the feed image, under the header and over the steps list. */
const ROOM = { w: 976, h: 760 };

/** Place a flat view's parts for the feed image; ids, forms and connections stay. */
export function layoutForFeed(v: DiagramView): DiagramView {
  if (!v.nodes.length) return v;
  const tries = [3, 2].map((cols) => placeOnGrid(v, cols));
  const scale = (t: DiagramView) => {
    const xs = t.nodes.map((n) => n.x), ys = t.nodes.map((n) => n.y);
    const ws = t.nodes.map((n) => n.x + measureNode(n, { post: true }).w), hs = t.nodes.map((n) => n.y + measureNode(n, { post: true }).h);
    return Math.min(ROOM.w / (Math.max(...ws) - Math.min(...xs)), ROOM.h / (Math.max(...hs) - Math.min(...ys)));
  };
  return scale(tries[1]) > scale(tries[0]) * 1.08 ? tries[1] : tries[0];
}

function placeOnGrid(v: DiagramView, cols: number): DiagramView {
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const centre = (n: DiagramNode) => ({ x: n.x + 100, y: n.y + 50 });
  const edges = v.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);

  const chain: string[] = [];
  for (const e of edges.filter((x) => x.step !== null).sort((p, q) => p.step! - q.step!)) for (const id of [e.from, e.to]) if (!chain.includes(id)) chain.push(id);
  const at = new Map<string, { r: number; c: number }>();
  const taken = new Set<string>();
  const K = (r: number, c: number) => `${r},${c}`;
  const place = (id: string, r: number, c: number) => { at.set(id, { r, c }); taken.add(K(r, c)); };
  chain.forEach((id, i) => { const r = Math.floor(i / cols); place(id, r, r % 2 ? cols - 1 - (i % cols) : i % cols); });
  const near = (id: string) => edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).filter((o) => at.has(o));
  let left = v.nodes.map((n) => n.id).filter((id) => !at.has(id));
  for (let guard = 0; left.length && guard < 200; guard++) {
    const id = left.find((x) => near(x).length) ?? left[0];
    const ns = near(id), me = centre(byId.get(id)!);
    const rows = [...at.values()].map((p) => p.r);
    const lo = Math.min(0, ...rows) - 1, hi = Math.max(0, ...rows) + 1;
    let best: { r: number; c: number; cost: number } | null = null;
    for (let r = lo; r <= hi; r++) for (let c = 0; c < cols; c++) {
      if (taken.has(K(r, c))) continue;
      let cost = 0;
      for (const o of ns) {
        const p = at.get(o)!, oc = centre(byId.get(o)!), dr = r - p.r, dc = c - p.c;
        cost += (Math.abs(dr) + Math.abs(dc)) * 10;
        if (dr && Math.sign(dr) !== Math.sign(me.y - oc.y)) cost += 6;
        if (dc && Math.sign(dc) !== Math.sign(me.x - oc.x)) cost += 3;
      }
      // A part that talks to nothing placed yet fills the grid in reading order, below the top row,
      // so a drawing of loose parts stays as wide as the grid instead of one column tall.
      if (!ns.length) cost = (r === lo && at.size ? 1000 : 0) + (r - lo) * 10 + c;
      if (!best || cost < best.cost) best = { r, c, cost };
    }
    place(id, best!.r, best!.c);
    left = left.filter((x) => x !== id);
  }

  const ed = edges.map((e) => [e.from, e.to, e.step !== null] as const);
  // The main path keeps its turn-back cells (ui contract, LinkedIn version); only the other parts move.
  const ids = [...at.keys()].filter((id) => !chain.includes(id));
  const cross = (a: { r: number; c: number }, b: { r: number; c: number }, c: { r: number; c: number }, d: { r: number; c: number }) => {
    const o = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.c - p.c) * (r.r - p.r) - (q.r - p.r) * (r.c - p.c));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  const score = () => {
    let cost = 0;
    const occ = new Map([...at].map(([id, p]) => [K(p.r, p.c), id]));
    const seg = ed.map(([a, b, main]) => {
      const p = at.get(a)!, q = at.get(b)!, dr = q.r - p.r, dc = q.c - p.c, n = Math.max(Math.abs(dr), Math.abs(dc));
      cost += (Math.abs(dr) + Math.abs(dc)) * (main ? 14 : 10) + (dr && dc ? 6 : 0);
      for (let i = 1; i < n; i++) { const o = occ.get(K(p.r + Math.round((dr * i) / n), p.c + Math.round((dc * i) / n))); if (o && o !== a && o !== b) cost += 150; }
      const ca = centre(byId.get(a)!), cb = centre(byId.get(b)!);
      if (dr && Math.abs(cb.y - ca.y) > 60 && Math.sign(dr) !== Math.sign(cb.y - ca.y)) cost += 12;
      if (main && (dr < 0 || (dr === 0 && dc < 0 && p.r % 2 === 0))) cost += 8;
      return [p, q, a, b] as const;
    });
    for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) {
      const [p, q, a, b] = seg[i], [r, t, c, d] = seg[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (cross(p, q, r, t)) cost += 30;
    }
    return cost;
  };
  const span = () => { const rs = [...at.values()].map((p) => p.r); return [Math.min(...rs) - 1, Math.max(...rs) + 1]; };
  for (let round = 0, better = true; better && round < 40; round++) {
    better = false;
    let base = score();
    for (const id of ids) {
      let from = { ...at.get(id)! };
      const [lo, hi] = span();
      for (let r = lo; r <= hi; r++) for (let c = 0; c < cols; c++) {
        if (r === from.r && c === from.c) continue;
        if (chain.some((x) => at.get(x)!.r === r && at.get(x)!.c === c)) continue;
        const other = ids.find((x) => x !== id && at.get(x)!.r === r && at.get(x)!.c === c);
        at.set(id, { r, c });
        if (other) at.set(other, { ...from });
        const sc = score();
        if (sc < base - 0.5) { base = sc; better = true; from = { r, c }; }
        else { at.set(id, { ...from }); if (other) at.set(other, { r, c }); }
      }
    }
  }

  const box = new Map(v.nodes.map((n) => [n.id, measureNode(n, { post: true })]));
  const usedRows = [...new Set([...at.values()].map((p) => p.r))].sort((a, b) => a - b);
  const rowH = usedRows.map((r) => Math.max(...v.nodes.filter((n) => at.get(n.id)!.r === r).map((n) => box.get(n.id)!.h)));
  const rowTop = rowH.map((_, i) => rowH.slice(0, i).reduce((s, h) => s + h + GAP_Y, 0));
  const rowOf = new Map(usedRows.map((r, i) => [r, i]));
  // Each column is as wide as its widest part (ui contract, LinkedIn version).
  const colW = Array.from({ length: cols }, (_, c) => {
    const ws = v.nodes.filter((n) => at.get(n.id)!.c === c).map((n) => box.get(n.id)!.w);
    return ws.length ? Math.max(...ws) + GAP_X : 0;
  });
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((s, w) => s + w, 0));
  const nodes = v.nodes.map((n) => {
    const p = at.get(n.id)!, b = box.get(n.id)!, ri = rowOf.get(p.r)!;
    return { ...n, x: Math.round(colX[p.c] + (colW[p.c] - b.w) / 2), y: Math.round(rowTop[ri] + (rowH[ri] - b.h) / 2) };
  });
  return { ...v, nodes };
}

/** Fold and place: the feed layout of any view, ids unchanged (tests, previews). */
export const arrangeForFeed = (v: DiagramView): DiagramView => layoutForFeed(foldForFeed(v));

/** Re-place a LinkedIn view the user or an engine has changed; forms and items stay. */
export const rearrangeForFeed = (v: DiagramView): DiagramView => layoutForFeed(foldForFeed(v, { keepForms: true }));

/**
 * Add the LinkedIn version of view `vid` to the document, or return the one it already has.
 * The post is found and named as an engine's is (diagram contract, Post-view identity): by
 * `postOf`, never by its id. Its components and connections get ids of their own: ids are
 * unique across the file.
 */
export function makeLinkedInView(doc: DiagramDocument, vid: string): { doc: DiagramDocument; view: string } {
  const asked = doc.views.find((v) => v.id === vid) ?? doc.views[0];
  const src = doc.views.find((v) => v.id === postSource(doc, asked.id)) ?? asked;
  const id = postViewId(doc, src.id);
  if (doc.views.some((v) => v.id === id)) return { doc, view: id };
  if (doc.views.length >= LIMITS.views) throw new Error(`A drawing holds at most ${LIMITS.views} views`);
  const used = allIds(doc);
  const fresh = (base: string) => {
    const root = slugify(base).slice(0, 56) || "part";
    let x = root;
    for (let i = 2; used.has(x); i++) x = `${root}-${i}`;
    used.add(x);
    return x;
  };
  const laid = arrangeForFeed(src);
  const ren = new Map(laid.nodes.map((n) => [n.id, fresh(`${n.id}-li`)]));
  const view: DiagramView = {
    id,
    title: (src.id === doc.views[0].id ? "LinkedIn" : `${src.title} · LinkedIn`).slice(0, LIMITS.viewTitle),
    caption: { ...src.caption },
    // The version is the post of its source (diagram contract, Post-view identity).
    postOf: src.postOf ?? src.id,
    nodes: laid.nodes.map((n) => ({ ...n, id: ren.get(n.id)! })),
    edges: laid.edges.map((e) => ({ ...e, id: fresh("li-e"), from: ren.get(e.from)!, to: ren.get(e.to)! })),
    texts: [],
  };
  return { doc: { ...doc, views: [...doc.views, view] }, view: id };
}

/**
 * The instruction the "Explain it" button sends: an engine rewrites the LinkedIn view so a
 * stranger understands the system from the image alone. The editor re-places the view afterwards.
 */
export function explainInstruction(viewId: string): string {
  return `Rewrite only the view "${viewId}". It is the LinkedIn version of this drawing: one image for people scrolling LinkedIn who have never seen this repository, so a stranger must understand from the image alone what the system does and how a request moves through it. In this view: caption.title names what the system is in at most 9 words; caption.lede is one plain sentence of at most 160 characters on what it does and for whom; keep at most 8 components, merging or leaving out the rest, none with a parent; choose up to 3 that explain the system best and make them form "panel" with at most 4 items of at most 24 characters each saying what they hold, make the other parts on the main path form "card" and the rest form "compact", with no items; each component's sub is at most 28 characters in plain words saying what it does, not a file name or a list of technologies; number the main path 1, 2, 3 … with at most 6 steps, and label each numbered connection with a short sentence of at most 40 characters saying what happens (for example "You ask your agent for a drawing"); give other connections a label only when the reader needs it. Read the code where you need to, so every sentence is true. Keep the ids of the components you keep. The rules about groups and held items do not apply to this view. Change no other view.`;
}

/**
 * The LinkedIn channel drawn without an engine (ui contract, The LinkedIn flow): the overview's first
 * view folded and placed for the feed, as the channel's one view. Each part keeps its overview part's
 * id and points to the same facts (a folded group to its own and its members'); connections show the
 * relations their overview connections showed. The facts and the other channels stay; the channel's
 * `outdated` is emptied.
 */
export function prepareLinkedIn(stored: Document3): ApplyResult {
  const src = joinChannel(stored, "overview").views[0];
  const laid = arrangeForFeed(src);
  const id = linkedInViewId(stored);
  const inside = (gid: string): string[] => src.nodes.filter((m) => m.parent === gid).flatMap((m) => [...(m.facts ?? []), ...inside(m.id)]);
  const used = new Set<string>(laid.nodes.map((n) => n.id));
  const view: DiagramView = {
    id, title: "LinkedIn", caption: { ...src.caption }, postOf: null,
    nodes: laid.nodes.map((n) => ({ ...n, facts: [...new Set([...(n.facts ?? []), ...(src.nodes.find((m) => m.id === n.id)?.form === "group" ? inside(n.id) : [])])] })),
    edges: laid.edges.map((e) => { const eid = freeIdAmong(used, "li-e"); used.add(eid); return { ...e, id: eid, relations: [...(e.relations ?? [])] }; }),
    texts: [],
  };
  const cleared: Document3 = { ...stored, channels: { ...stored.channels, linkedin: { ...stored.channels.linkedin, views: [] } } };
  const r = applyChannel(cleared, "linkedin", { views: [view] }, { keepFacts: true });
  return r.ok ? { ok: true, doc: clearOutdated(r.doc, "linkedin") } : r;
}
