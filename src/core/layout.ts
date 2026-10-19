import { GROUP, groupHeaderWidth, LABEL, labelWidth, layoutRects, measureNode, overlaps, postOf, routeEdges, styleOf, type Rect } from "./geometry";
import type { DiagramEdge, DiagramNode, DiagramView, EdgeInput, Kind, Lane, NodeInput } from "./model";

/**
 * Grid layout. Components with a `place` hint go to that cell; the rest
 * follow the main path (connections with steps) along a row and sit beside what they connect to.
 * Inside a group the same rules apply, the main path wrapping over two or three columns. Cells
 * become pixels by the widest component per column and the tallest per row. Pure and synchronous.
 */

export const MARGIN = 40;
/** Room for an arc around a part: px added to each gap beside it per round, and the rounds. */
const ROOM = { step: 40, rounds: 3 } as const;
const GAP = { top: { x: 88, y: 84 }, inner: { x: 36, y: 32 } } as const;

interface Cell { r: number; c: number }
interface Lifted { a: string; b: string; step: number | null; label: string }

/** Kinds that read best below the main path (stores, monitoring, third parties) or above it (people, jobs, checks). */
const BELOW: ReadonlySet<Kind> = new Set(["data", "ops", "external"]);
const ABOVE: ReadonlySet<Kind> = new Set(["actor", "worker", "gate"]);

const key = (r: number, c: number) => `${r},${c}`;
const cellKey = (r: number, c: number) => (r + 4096) * 8192 + (c + 4096);
const orient = (p: Cell, q: Cell, s: Cell) => Math.sign((q.c - p.c) * (s.r - p.r) - (q.r - p.r) * (s.c - p.c));
/** Whether two straight lines between cells cross (touching does not count). */
const cellsCross = (a: Cell, b: Cell, c: Cell, d: Cell) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;

/** Grid cells of one container's members. Hints are kept; the rest are placed and improved. */
function assignCells(members: NodeInput[], lifted: Lifted[], top: boolean): Map<string, Cell> {
  const at = new Map<string, Cell>();
  const taken = new Set<string>();
  const put = (id: string, cell: Cell) => { at.set(id, cell); taken.add(key(cell.r, cell.c)); };
  for (const n of members) {
    if (!n.place) continue;
    let { row: r, col: c } = n.place;
    while (taken.has(key(r, c))) c++;
    put(n.id, { r, c });
  }
  const free = members.filter((n) => !at.has(n.id));
  if (!free.length) return at;
  const byId = new Map(members.map((n) => [n.id, n]));
  const freeIds = new Set(free.map((n) => n.id));

  // The main path, in step order.
  const chain: string[] = [];
  for (const e of [...lifted].filter((x) => x.step !== null).sort((p, q) => p.step! - q.step!)) {
    for (const id of [e.a, e.b]) if (!chain.includes(id)) chain.push(id);
  }
  const hinted = members.length - free.length;
  if (hinted === 0 && chain.length) {
    const cols = top ? Math.max(1, chain.length) : chain.length <= 4 ? 2 : 3;
    chain.forEach((id, i) => {
      const r = Math.floor(i / cols);
      const c = r % 2 ? cols - 1 - (i % cols) : i % cols;
      put(id, { r, c });
    });
  }
  const neighbours = (id: string) => lifted.flatMap((e) => (e.a === id ? [e.b] : e.b === id ? [e.a] : [])).filter((o) => at.has(o));
  const onChain = new Set(chain);
  const cols = () => { const cs = [...at.values()].map((p) => p.c); return cs.length ? [Math.min(...cs), Math.max(...cs)] : [0, 0]; };
  const rows = () => { const rs = [...at.values()].map((p) => p.r); return rs.length ? [Math.min(...rs), Math.max(...rs)] : [0, 0]; };
  const sidePenalty = (id: string, r: number) => {
    const k = byId.get(id)!.kind;
    if (!top) return 0;
    let p = 0;
    if (r === 0 && !onChain.has(id) && chain.length) p += 9;
    if (BELOW.has(k) && r < 0) p += 5;
    if (ABOVE.has(k) && r > 0) p += 5;
    return p;
  };

  let left = free.map((n) => n.id).filter((id) => !at.has(id));
  for (let guard = 0; left.length && guard < 500; guard++) {
    left.sort((p, q) => neighbours(q).length - neighbours(p).length || members.findIndex((m) => m.id === p) - members.findIndex((m) => m.id === q));
    const id = left[0];
    const ns = neighbours(id);
    const [r0, r1] = rows(), [c0, c1] = cols();
    let best: (Cell & { cost: number }) | null = null;
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      for (let c = c0 - 1; c <= c1 + 1; c++) {
        if (taken.has(key(r, c))) continue;
        let cost = sidePenalty(id, r);
        if (ns.length) for (const o of ns) { const p = at.get(o)!; cost += (Math.abs(r - p.r) + Math.abs(c - p.c)) * 10; }
        else cost += (Math.abs(r - (at.size ? r1 + 1 : 0))) * 10 + Math.abs(c - c0) * 2;
        if (!top && !ns.length) cost = (r - r0) * 10 + (c - c0);
        if (!best || cost < best.cost) best = { r, c, cost };
      }
    }
    put(id, best ?? { r: 0, c: 0 });
    left = left.filter((x) => x !== id);
  }

  // Improve by moves and swaps of the unhinted members: short lines, no line through a part,
  // few crossings, the main path read in order, kinds on their usual side.
  const ids = [...freeIds];
  // Who sits in each cell, kept in step with every move (numeric keys: this loop is the hot path).
  const occ = new Map<number, string>();
  for (const [id, p] of at) occ.set(cellKey(p.r, p.c), id);
  const L = lifted.length, ends0: Cell[] = new Array(L), ends1: Cell[] = new Array(L);
  const score = () => {
    let cost = 0;
    for (let k = 0; k < L; k++) {
      const e = lifted[k], p = at.get(e.a)!, q = at.get(e.b)!;
      ends0[k] = p; ends1[k] = q;
      const dr = q.r - p.r, dc = q.c - p.c, n = Math.max(Math.abs(dr), Math.abs(dc));
      cost += (Math.abs(dr) + Math.abs(dc)) * (e.step !== null ? 14 : 10) + (dr && dc ? 6 : 0);
      for (let i = 1; i < n; i++) {
        const o = occ.get(cellKey(p.r + Math.round((dr * i) / n), p.c + Math.round((dc * i) / n)));
        if (o !== undefined && o !== e.a && o !== e.b) cost += 150;
      }
      if (e.step !== null && top && (dr !== 0 || dc < 0)) cost += 8;
    }
    for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) {
      const s = lifted[i], t = lifted[j];
      if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
      if (cellsCross(ends0[i], ends1[i], ends0[j], ends1[j])) cost += 30;
    }
    for (const id of ids) cost += sidePenalty(id, at.get(id)!.r);
    return cost;
  };
  // A fixed budget of trial scores keeps a large view's layout to about a second; a small view
  // settles long before it (diagram contract, Layout). Counted, not timed, so a layout is reproducible.
  let budget = 40_000;
  for (let round = 0, better = true; better && round < 30 && budget > 0; round++) {
    better = false;
    let base = score();
    for (const id of ids) {
      if (budget <= 0) break;
      let from = { ...at.get(id)! };
      const [r0, r1] = rows(), [c0, c1] = cols();
      for (let r = r0 - 1; r <= r1 + 1; r++) for (let c = c0 - 1; c <= c1 + 1; c++) {
        if (r === from.r && c === from.c) continue;
        const other = occ.get(cellKey(r, c));
        if (other && !freeIds.has(other)) continue;
        // Move (or swap) and score; undo unless it is better.
        const there = cellKey(r, c), here = cellKey(from.r, from.c);
        at.set(id, { r, c }); occ.set(there, id);
        if (other) { at.set(other, { ...from }); occ.set(here, other); } else occ.delete(here);
        budget--;
        const sc = score();
        if (sc < base - 0.5) { base = sc; better = true; from = { r, c }; }
        else {
          at.set(id, { ...from }); occ.set(here, id);
          if (other) { at.set(other, { r, c }); occ.set(there, other); } else occ.delete(there);
        }
      }
    }
  }
  return at;
}

interface Placed { x: number; y: number; w: number; h: number }
export interface LayoutOptions {
  portrait?: boolean; labels?: boolean;
  /** The dense post style. Default: whether the view is a post view. */
  post?: boolean;
}

/** Cell bounds of a zone's members (a zone spans the cells of its members). */
interface Span { r0: number; r1: number; c0: number; c1: number }
const grow = (s: Span | undefined, r: number, c: number): Span =>
  s ? { r0: Math.min(s.r0, r), r1: Math.max(s.r1, r), c0: Math.min(s.c0, c), c1: Math.max(s.c1, c) } : { r0: r, r1: r, c0: c, c1: c };
const inSpan = (s: Span, r: number, c: number) => r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1;
const meets = (a: Span, b: Span) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

function laneHints(members: NodeInput[], lanes: Map<string, Lane>, portrait: boolean, zoneOf: Map<string, string> = new Map()): NodeInput[] {
  const spine = members.filter((n) => lanes.get(n.id) && "spine" in lanes.get(n.id)!).sort((a, b) => (lanes.get(a.id) as { spine: number }).spine - (lanes.get(b.id) as { spine: number }).spine);
  if (!spine.length) return members;
  const cells = new Map<string, Cell>();
  const used = new Map<string, string>();
  const spans = new Map<string, Span>();
  const put = (id: string, r: number, c: number) => {
    cells.set(id, { r, c }); used.set(key(r, c), id);
    const z = zoneOf.get(id);
    if (z) spans.set(z, grow(spans.get(z), r, c));
  };
  // A cell is free for `id` when no other zone's box covers it and, for a zone member, its zone's
  // grown box covers no outside part and meets no other zone (diagram contract, Layout).
  const fits = (id: string, r: number, c: number) => {
    if (used.has(key(r, c))) return false;
    const z = zoneOf.get(id);
    for (const [other, s] of spans) if (other !== z && inSpan(s, r, c)) return false;
    if (!z) return true;
    const s = grow(spans.get(z), r, c);
    for (const [k, owner] of used) {
      const [ur, uc] = k.split(",").map(Number);
      if (inSpan(s, ur, uc) && zoneOf.get(owner) !== z) return false;
    }
    return [...spans].every(([other, t]) => other === z || !meets(s, t));
  };
  // Portrait: the second band runs right to left from under the last column, so the spine turns
  // down one column; its connection goes around whatever sits between.
  const turn = Math.max(2, spine.length - 4); // the column under which the second band starts
  spine.forEach((n, i) => put(n.id, portrait && i >= 3 ? 3 : 0, portrait && i >= 3 ? turn - (i - 3) : i));
  const columns = Math.max(3, portrait ? 3 : spine.length);
  for (const n of members) {
    const lane = lanes.get(n.id);
    if (!lane || !("anchor" in lane)) continue;
    const anchor = cells.get(lane.anchor);
    if (!anchor) continue;
    const dir = lane.side === "above" ? -1 : 1;
    const cols = Array.from({ length: columns }, (_, c) => c).sort((a, b) => Math.abs(a - anchor.c) - Math.abs(b - anchor.c) || a - b);
    let r = anchor.r + dir;
    for (let guard = 0; guard < 64 && !cols.some((c) => fits(n.id, r, c)); guard++) r += dir;
    put(n.id, r, cols.find((c) => fits(n.id, r, c)) ?? cols.find((c) => !used.has(key(r, c)))!);
  }
  return [...members].sort((a, b) => Number(cells.has(b.id)) - Number(cells.has(a.id))).map((n) => { const cell = cells.get(n.id); return cell ? { ...n, place: { row: cell.r, col: cell.c } } : n; });
}

/** Extra room beside a part, between its column and its neighbours' (x) or its row and theirs (y). */
type Room = Map<string, { x: number; y: number }>;

/**
 * Lay out every component of a view from scratch (positions relative to the canvas origin).
 * Returns top-left positions; group positions are their computed boxes. `memo` keeps each
 * container's cells between calls that differ only in `room`, which never moves a part to another cell.
 */
function gridPositions(view: { nodes: NodeInput[]; edges: EdgeInput[] }, o: LayoutOptions, room: Room = new Map(), memo = new Map<string | null, Map<string, Cell>>()): Map<string, Placed> {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const S = styleOf(o.post);
  // In a lane layout a zone's members take cells of the outer grid themselves: a
  // top-level group whose members are all leaves with a lane. Its box comes from them.
  const laneMode = view.nodes.some((n) => n.lane && "spine" in n.lane);
  const zoneOf = new Map<string, string>();
  if (laneMode) {
    for (const z of view.nodes) {
      // A zone beside another unit (its own anchor lane) stays one box, placed by that lane.
      if (z.form !== "group" || (z.parent && byId.has(z.parent)) || (z.lane && "anchor" in z.lane)) continue;
      const inside = view.nodes.filter((n) => n.parent === z.id);
      if (inside.length && inside.every((n) => n.form !== "group" && n.lane)) for (const n of inside) zoneOf.set(n.id, z.id);
    }
  }
  const zones = new Set(zoneOf.values());
  const parentOf = (n: NodeInput) => (zoneOf.has(n.id) ? null : n.parent && byId.has(n.parent) ? n.parent : null);
  const childrenOf = new Map<string | null, NodeInput[]>();
  for (const n of view.nodes) {
    if (zones.has(n.id)) continue;
    const p = parentOf(n);
    (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(n);
  }
  /** The member of `container` that holds `id` (itself, or its ancestor directly inside the container). */
  const memberOf = (id: string, container: string | null): string | null => {
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const p = parentOf(cur);
      if (p === container) return cur.id;
      cur = p ? byId.get(p) : undefined;
    }
    return null;
  };
  // The outer spine order: a zone takes the place its own lane or its earliest spine member gives
  // it, and its spine members fill consecutive places from there in their own order.
  const spineOrder = new Map<string, number>();
  if (zones.size) {
    const spineOf = (n: NodeInput) => (n.lane && "spine" in n.lane ? n.lane.spine : null);
    const entries: { at: number; index: number; ids: string[] }[] = [];
    view.nodes.forEach((n, index) => {
      if (zones.has(n.id)) {
        const own = view.nodes.filter((m) => zoneOf.get(m.id) === n.id && spineOf(m) !== null).sort((a, b) => spineOf(a)! - spineOf(b)!);
        if (own.length) entries.push({ at: spineOf(n) ?? spineOf(own[0])!, index, ids: own.map((m) => m.id) });
      } else if (!parentOf(n) && !zoneOf.has(n.id) && spineOf(n) !== null) entries.push({ at: spineOf(n)!, index, ids: [n.id] });
    });
    entries.sort((a, b) => a.at - b.at || a.index - b.index).flatMap((e) => e.ids).forEach((id, i) => spineOrder.set(id, i));
  }
  // A zone whose members are lifted is no unit of its own: a line to it or an anchor on it means
  // its first spine member (else its first member).
  const standIn = (id: string): string => {
    if (!zones.has(id)) return id;
    const inside = view.nodes.filter((m) => zoneOf.get(m.id) === id);
    return [...inside].filter((m) => spineOrder.has(m.id)).sort((a, b) => spineOrder.get(a.id)! - spineOrder.get(b.id)!)[0]?.id ?? inside[0]?.id ?? id;
  };
  const rel = new Map<string, Placed>(); // relative to the container's content origin
  const visiting = new Set<string>();

  const layoutContainer = (container: string | null): { w: number; h: number } => {
    const members = childrenOf.get(container) ?? [];
    const top = container === null;
    const sizes = new Map<string, { w: number; h: number }>();
    for (const m of members) {
      if (m.form === "group" && !visiting.has(m.id)) {
        visiting.add(m.id);
        const inner = (childrenOf.get(m.id) ?? []).length ? layoutContainer(m.id) : null;
        visiting.delete(m.id);
        sizes.set(m.id, inner
          ? { w: Math.max(inner.w + GROUP.padX * 2, groupHeaderWidth(m, o.post)), h: inner.h + GROUP.head + GROUP.padBottom }
          : { w: Math.max(GROUP.emptyW, groupHeaderWidth(m, o.post)), h: GROUP.emptyH });
      } else {
        const b = measureNode(m, { post: o.post });
        sizes.set(m.id, { w: b.w, h: b.h });
      }
    }
    if (!members.length) return { w: 0, h: 0 };
    const lifted: Lifted[] = [];
    const pair = new Set<string>();
    const isMember = new Set(members.map((m) => m.id));
    for (const e of view.edges) {
      const a = memberOf(standIn(e.from), container), b = memberOf(standIn(e.to), container);
      if (!a || !b || a === b || !isMember.has(a) || !isMember.has(b)) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (pair.has(k) && e.step === null) continue;
      pair.add(k);
      lifted.push({ a, b, step: e.step, label: e.label });
    }
    const lanes = new Map<string, Lane>();
    const explicit = new Set(members.filter((n) => n.lane).map((n) => n.id));
    for (const n of view.nodes) {
      const unit = memberOf(n.id, container);
      if (!unit || !n.lane || (unit !== n.id && explicit.has(unit))) continue;
      if ("spine" in n.lane) {
        const lane = top && spineOrder.has(n.id) ? { spine: spineOrder.get(n.id)! } : n.lane;
        const previous = lanes.get(unit);
        if (!previous || !("spine" in previous) || lane.spine < previous.spine) lanes.set(unit, lane);
      }
    }
    for (const n of view.nodes) {
      const unit = memberOf(n.id, container);
      if (!unit || lanes.has(unit) || !n.lane || !("anchor" in n.lane)) continue;
      const anchor = memberOf(standIn(n.lane.anchor), container);
      if (anchor && anchor !== unit) lanes.set(unit, { anchor, side: n.lane.side });
    }
    const cells = memo.get(container) ?? memo.set(container, assignCells(laneHints(members, lanes, top && !!o.portrait, top ? zoneOf : undefined), lifted, top)).get(container)!;
    const rowsUsed = [...new Set([...cells.values()].map((p) => p.r))].sort((a, b) => a - b);
    const colsUsed = [...new Set([...cells.values()].map((p) => p.c))].sort((a, b) => a - b);
    const ri = new Map(rowsUsed.map((r, i) => [r, i])), ci = new Map(colsUsed.map((c, i) => [c, i]));
    const colW = colsUsed.map(() => 0), rowH = rowsUsed.map(() => 0);
    for (const m of members) {
      const p = cells.get(m.id)!, s = sizes.get(m.id)!;
      colW[ci.get(p.c)!] = Math.max(colW[ci.get(p.c)!], s.w);
      rowH[ri.get(p.r)!] = Math.max(rowH[ri.get(p.r)!], s.h);
    }
    const gap = lanes.size ? { x: 24, y: S.post ? 22 : 32 } : top ? GAP.top : GAP.inner;
    // A step badge sits on its connection between two parts, so a numbered connection between
    // neighbours keeps room for it; a drawn label needs its own measured width.
    const badge = 2 * (S.BADGE.r + 3) + 28;
    const colGap = colsUsed.slice(1).map((_, i) => {
      let need: number = gap.x;
      for (const e of lifted) {
        const p = cells.get(e.a)!, q = cells.get(e.b)!;
        if (p.r !== q.r) continue;
        const [lo, hi] = [ci.get(p.c)!, ci.get(q.c)!].sort((a, b) => a - b);
        if (lo !== i || hi !== i + 1) continue;
        if (lanes.size && e.step !== null) need = Math.max(need, badge);
        // In a lane layout the label only needs clearance from both parts; the badge sits beside it.
        if (e.label && o.labels !== false) need = Math.max(need, labelWidth(e.label, S.post) + (lanes.size ? 16 : 28) + (!lanes.size && e.step !== null ? 2 * S.BADGE.r + 36 : 0));
      }
      return need;
    });
    const rowGap = rowsUsed.slice(1).map((_, i) => {
      let need: number = gap.y;
      for (const e of lifted) {
        const p = cells.get(e.a)!, q = cells.get(e.b)!;
        const [lo, hi] = [ri.get(p.r)!, ri.get(q.r)!].sort((a, b) => a - b);
        if (p.c !== q.c || lo !== i || hi !== i + 1) continue;
        if (lanes.size && e.step !== null) need = Math.max(need, badge);
        // A drawn label on a connection between parts one above the other needs its own height.
        if (lanes.size && e.label && o.labels !== false) need = Math.max(need, LABEL.h + 16);
      }
      return need;
    });
    // Room for an arc around a part a connection could not get past.
    for (const m of members) {
      const extra = room.get(m.id);
      if (!extra) continue;
      const c = ci.get(cells.get(m.id)!.c)!, r = ri.get(cells.get(m.id)!.r)!;
      if (c > 0) colGap[c - 1] += extra.x;
      if (c < colGap.length) colGap[c] += extra.x;
      if (r > 0) rowGap[r - 1] += extra.y;
      if (r < rowGap.length) rowGap[r] += extra.y;
    }
    // A zone's frame needs its padding and header between its members and their outside neighbours.
    let leadX = 0, leadY = 0;
    if (top) {
      const spans = new Map<string, Span>();
      for (const [id, p] of cells) { const z = zoneOf.get(id); if (z) spans.set(z, grow(spans.get(z), ri.get(p.r)!, ci.get(p.c)!)); }
      for (const s of spans.values()) {
        if (s.c0 === 0) leadX = Math.max(leadX, GROUP.padX); else colGap[s.c0 - 1] += GROUP.padX;
        if (s.c1 < colGap.length) colGap[s.c1] += GROUP.padX;
        if (s.r0 === 0) leadY = Math.max(leadY, GROUP.head); else rowGap[s.r0 - 1] += GROUP.head;
        if (s.r1 < rowGap.length) rowGap[s.r1] += GROUP.padBottom;
      }
      // A zone's name may be wider than its members: the gap after it takes the rest.
      for (const [z, s] of spans) {
        const zone = view.nodes.find((n) => n.id === z);
        if (!zone || s.c1 >= colGap.length) continue;
        const inner = colW.slice(s.c0, s.c1 + 1).reduce((a, b) => a + b, 0) + colGap.slice(s.c0, s.c1).reduce((a, b) => a + b, 0);
        const over = groupHeaderWidth(zone, o.post) - (inner + 2 * GROUP.padX);
        if (over > 0) colGap[s.c1] += over;
      }
    }
    const colX: number[] = [], rowY: number[] = [];
    colW.forEach((_w, i) => colX.push(i === 0 ? leadX : colX[i - 1] + colW[i - 1] + colGap[i - 1]));
    rowH.forEach((_h, i) => rowY.push(i === 0 ? leadY : rowY[i - 1] + rowH[i - 1] + rowGap[i - 1]));
    for (const m of members) {
      const p = cells.get(m.id)!, s = sizes.get(m.id)!;
      const c = ci.get(p.c)!, r = ri.get(p.r)!;
      rel.set(m.id, { x: Math.round(colX[c] + (colW[c] - s.w) / 2), y: Math.round(rowY[r] + (rowH[r] - s.h) / 2), w: s.w, h: s.h });
    }
    return { w: colX[colX.length - 1] + colW[colW.length - 1], h: rowY[rowY.length - 1] + rowH[rowH.length - 1] };
  };
  layoutContainer(null);

  const abs = new Map<string, Placed>();
  const place = (container: string | null, ox: number, oy: number) => {
    for (const m of childrenOf.get(container) ?? []) {
      const r = rel.get(m.id);
      if (!r) continue;
      const a = { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h };
      abs.set(m.id, a);
      if (m.form === "group") {
        // Children are centred under the header when the header is wider than they are.
        const inner = (childrenOf.get(m.id) ?? []).map((k) => rel.get(k.id)!).filter(Boolean);
        const span = inner.length ? Math.max(...inner.map((k) => k.x + k.w)) : 0;
        const extra = Math.max(0, (a.w - GROUP.padX * 2 - span) / 2);
        place(m.id, a.x + GROUP.padX + extra, a.y + GROUP.head);
      }
    }
  };
  place(null, MARGIN, MARGIN);
  return abs;
}

/**
 * Positions for a view: components that have a position keep it; components
 * without one are laid out on the grid and moved by the kept ones' average offset, then to the
 * nearest spot where they overlap nothing. Groups get their computed box.
 */
/**
 * A lane view as an export with these switches draws it: when its parts still sit exactly
 * where the lane layout put them — for either orientation of a post, with labels drawn or hidden —
 * they are placed again for the wanted orientation and switches. A view moved by hand stays as it is.
 * The stored file never changes.
 */
export function placedForSwitches<V extends DiagramView>(view: V, o: { portrait: boolean; labels: boolean; post: boolean }): V {
  if (!view.nodes.some((n) => n.lane)) return view;
  const auto = (portrait: boolean | undefined, labels: boolean) =>
    layoutView({ ...view, nodes: view.nodes.map((n) => ({ ...n, x: undefined, y: undefined })) }, { portrait, labels, post: o.post }) as unknown as V;
  const same = (b: V) => view.nodes.every((n, i) => n.x === b.nodes[i]?.x && n.y === b.nodes[i]?.y);
  const want = auto(o.post ? o.portrait : undefined, o.labels);
  if (same(want)) return view;
  for (const portrait of o.post ? [true, false] : [undefined]) for (const labels of [true, false]) if (same(auto(portrait, labels))) return want;
  return view;
}

export function layoutView<V extends { nodes: NodeInput[]; edges: EdgeInput[]; id?: string; postOf?: string | null }>(view: V, o: LayoutOptions = {}): Omit<V, "nodes"> & { nodes: DiagramNode[] } {
  o = { ...o, post: postOf(view, o) };
  const memo = new Map<string | null, Map<string, Cell>>();
  const kept = view.nodes.filter((n) => n.x !== undefined && n.y !== undefined && n.form !== "group");
  const fresh = new Set(view.nodes.filter((n) => n.x === undefined || n.y === undefined).map((n) => n.id));
  /** Kept components stay; fresh ones take their grid cell moved by the kept ones' average offset, then a free spot. */
  const place = (grid: Map<string, Placed>): DiagramNode[] => {
    let dx = 0, dy = 0;
    if (kept.length) {
      for (const n of kept) { const g = grid.get(n.id)!; dx += n.x! - g.x; dy += n.y! - g.y; }
      dx /= kept.length; dy /= kept.length;
    }
    const nodes: DiagramNode[] = view.nodes.map((n) => {
      const g = grid.get(n.id) ?? { x: MARGIN, y: MARGIN };
      const keep = !fresh.has(n.id);
      return { ...n, x: keep ? n.x! : Math.round(g.x + dx), y: keep ? n.y! : Math.round(g.y + dy) } as DiagramNode;
    });
    if (kept.length && fresh.size) {
      // New leaves move to a free spot; their groups grow around them.
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const ancestors = (id: string) => { const s = new Set<string>(); for (let p = byId.get(id)?.parent; p && !s.has(p); p = byId.get(p)?.parent) s.add(p); return s; };
      for (const n of nodes) {
        if (!fresh.has(n.id) || n.form === "group") continue;
        const up = ancestors(n.id);
        const rects = layoutRects({ nodes }, { post: o.post });
        const others = [...rects].filter(([id]) => id !== n.id && !up.has(id) && !(byId.get(id)?.form === "group" && descends(byId, id, n.id))).map(([, r]) => r);
        const me = rects.get(n.id)!;
        const p = freeSpot(others, { x: me.x + me.w / 2, y: me.y + me.h / 2 }, me.w, me.h);
        n.x = p.x; n.y = p.y;
      }
    }
    // A group's stored position is its computed box.
    const rects = layoutRects({ nodes }, { post: o.post });
    for (const n of nodes) if (n.form === "group") { const r = rects.get(n.id)!; n.x = Math.round(r.x); n.y = Math.round(r.y); }
    return nodes;
  };
  let grid = gridPositions(view, o, new Map(), memo);
  let nodes = place(grid);
  // A connection that has to go around a part placed automatically and finds no arc gets room
  // there: the gaps beside the part widen across the connection, at most three rounds.
  // With nothing but a group's name in its way, its own ends get the room (moving them along the
  // name can bring its end within reach). Room that did not clear its connection is taken back,
  // so a drawing never grows for nothing. A part with a stored position never moves, and is never
  // given room.
  const leaves = new Set([...fresh].filter((id) => view.nodes.find((n) => n.id === id)?.form !== "group"));
  if (leaves.size && view.edges.length) {
    const edges = view.edges.map((e, i) => ({ ...e, id: e.id ?? ` ${i}` }) as DiagramEdge);
    /** Room given per connection: part → px across (y) or beside (x). */
    const given = new Map<string, Room>();
    const total = (skip: Set<string>): Room => {
      const room: Room = new Map();
      for (const [id, parts] of given) if (!skip.has(id)) for (const [part, r] of parts) {
        const now = room.get(part) ?? { x: 0, y: 0 };
        room.set(part, { x: now.x + r.x, y: now.y + r.y });
      }
      return room;
    };
    let blocked = new Set<string>();
    for (let round = 0; round <= ROOM.rounds; round++) {
      const placed = { ...view, nodes, edges };
      const rects = layoutRects(placed, { post: o.post });
      blocked = new Set();
      for (const [id, r] of routeEdges(placed, rects, { post: o.post, labels: o.labels })) {
        if (!r.noArc) continue;
        const e = edges.find((x) => x.id === id), a = e && rects.get(e.from), b = e && rects.get(e.to);
        if (!e || !a || !b) continue;
        const over = r.blocked?.filter((part) => leaves.has(part)) ?? [];
        const parts = over.length || r.blocked?.length ? over : [e.from, e.to].filter((part) => leaves.has(part));
        if (!parts.length) continue;
        blocked.add(id);
        if (round === ROOM.rounds) continue;
        // A connection more up-and-down than across goes round beside the part: wider columns.
        const across = Math.abs(a.x + a.w / 2 - b.x - b.w / 2) >= Math.abs(a.y + a.h / 2 - b.y - b.h / 2);
        const mine = given.get(id) ?? given.set(id, new Map()).get(id)!;
        for (const part of parts) {
          const now = mine.get(part) ?? { x: 0, y: 0 };
          mine.set(part, across ? { ...now, y: now.y + ROOM.step } : { ...now, x: now.x + ROOM.step });
        }
      }
      if (!blocked.size || round === ROOM.rounds) break;
      grid = gridPositions(view, o, total(new Set()), memo);
      nodes = place(grid);
    }
    if ([...blocked].some((id) => given.has(id))) nodes = place(gridPositions(view, o, total(blocked), memo));
  }
  return { ...view, nodes };
}

function descends(byId: Map<string, DiagramNode>, ancestor: string, id: string): boolean {
  const seen = new Set<string>();
  for (let p = byId.get(id)?.parent; p && !seen.has(p); p = byId.get(p)?.parent) { if (p === ancestor) return true; seen.add(p); }
  return false;
}

/**
 * Top-left for a w×h box nearest to the wished centre `at` where it overlaps none of `taken`
 * (with a 24 px gap), searched ring by ring on an 8 px grid.
 */
export function freeSpot(taken: Rect[], at: { x: number; y: number }, w: number, h: number, gap = 24): { x: number; y: number } {
  const x0 = Math.round((at.x - w / 2) / 8) * 8, y0 = Math.round((at.y - h / 2) / 8) * 8;
  const fits = (x: number, y: number) => taken.every((r) => !overlaps({ x, y, w, h }, r, gap - 0.01));
  const step = 8;
  for (let ring = 0; ring <= 200; ring++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const x = x0 + dx * step, y = y0 + dy * step, d = dx * dx + dy * dy;
        if ((!best || d < best.d) && fits(x, y)) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: x0, y: Math.max(0, ...taken.map((r) => r.y + r.h)) + gap };
}

/** Lay out every view of a document. */
export function layoutDocument<D extends { views: { nodes: NodeInput[]; edges: EdgeInput[] }[] }>(doc: D): D {
  return { ...doc, views: doc.views.map((v) => layoutView(v)) };
}

