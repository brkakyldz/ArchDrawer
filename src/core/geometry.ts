import { isPostView, type DiagramEdge, type DiagramNode, type DiagramText, type DiagramView } from "./model";
import { fitLine, textWidth, wrapText, widthOf, type TextStyle } from "./text";

/**
 * One geometry for the editor and every export (invariant 5): every size here is a
 * function of content through the bundled Geist metrics (docs/contracts/diagram.md § Geometry).
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

type Texts = Record<"title" | "compactTitle" | "sub" | "subMono" | "item" | "edge" | "badge", TextStyle>;
export const T: Texts = {
  title: { size: 14.5, weight: 600, tracking: -0.012 },
  compactTitle: { size: 13.5, weight: 600, tracking: -0.012 },
  sub: { size: 12.5, weight: 400 },
  subMono: { size: 11.5, mono: true },
  item: { size: 12.5, weight: 400 },
  edge: { size: 12, weight: 500 },
  badge: { size: 11.5, weight: 600 },
};

export interface CardStyle { w: number; maxW: number; h: number; padX: number; icon: number; iconGap: number; line: number; subLine: number; maxLines: number }
export interface PanelStyle { padX: number; padTop: number; base: number; icon: number; gap: number; titleLine: number; subLine: number; listGap: number; itemH: number; itemGap: number; itemPad: number; minW: number; maxW: number }
export const CARD: CardStyle = { w: 196, maxW: 196, h: 108, padX: 12, icon: 26, iconGap: 8, line: 18, subLine: 18, maxLines: 3 };
export const COMPACT = { h: 46, padX: 12, icon: 18, gap: 10, minW: 140, maxW: 320, inside: 14 } as const;
export const PANEL: PanelStyle = { padX: 12, padTop: 11, base: 24, icon: 20, gap: 9, titleLine: 22, subLine: 17, listGap: 10, itemH: 26, itemGap: 4, itemPad: 9, minW: 184, maxW: 320 };
export const GROUP = { head: 46, padX: 18, padBottom: 18, padHead: 14, icon: 20, gap: 9, emptyW: 260, emptyH: 140 } as const;
/** A free text's style at any size (diagram contract, Text): one weight, line height 1.25 × size. */
export function textStyle(size: number): { size: number; weight: 500; tracking: number; line: number } {
  return { size, weight: 500, tracking: 0, line: Math.round(size * 1.25 * 100) / 100 };
}
export const LABEL = { h: 22, padX: 8 } as const;
export const BADGE = { r: 10.5 };

/** The sizes a view measures and draws with: the usual ones, or the dense post style. */
export interface Style { post: boolean; T: Texts; CARD: CardStyle; PANEL: PanelStyle; BADGE: { r: number } }
const BASE_STYLE: Style = { post: false, T, CARD, PANEL, BADGE };
/** Post views: no text under 12.5 px, tighter boxes and rows (diagram contract, Geometry, post style). */
const POST_STYLE: Style = {
  post: true,
  // Names one size step above the detail, as in a post read at a glance.
  T: {
    ...T, title: { size: 16.5, weight: 600, tracking: -0.012 }, compactTitle: { size: 15, weight: 600, tracking: -0.012 },
    subMono: { size: 12.5, mono: true }, edge: { size: 12.5, weight: 500 }, badge: { size: 12.5, weight: 600 },
  },
  // A post card widens up to 204 for a sub-line of the brief's 28 characters.
  CARD: { ...CARD, w: 176, maxW: 204, h: 84, line: 20 },
  PANEL: { ...PANEL, padTop: 8, base: 14, titleLine: 22, subLine: 16, listGap: 6, itemH: 19, itemGap: 1, itemPad: 6, minW: 150, maxW: 300 },
  BADGE: { r: 11.5 },
};
export const styleOf = (post: boolean | undefined): Style => (post ? POST_STYLE : BASE_STYLE);
/** Whether a view draws in the post style, unless the caller says. */
export const postOf = (view: { id?: string; postOf?: string | null }, o: { post?: boolean } = {}) => o.post ?? isPostView(view);
export const INSIDE = 14; // the "has a view inside" mark

export interface NodeBox {
  w: number; h: number;
  /** Label lines (a card wraps; other forms use one line). */
  lines: string[];
  sub: string;
  items: string[];
  /** How many of the last rows are limits (drawn muted after a timer icon). */
  limits?: number;
}

/** A limit row's timer icon and the gap after it (diagram contract, What a channel draws). */
export const LIMIT_ROW = { icon: 11, gap: 4 } as const;

export interface MeasureOptions {
  /** false: panels drawn without their items (share toggle). Default true. */
  items?: boolean;
  /** The dense post style. Default: whether the view is a post view. */
  post?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ceil = (v: number) => Math.ceil(v);

/** Size and text of a card, compact or panel (a group's size comes from its children: `layoutRects`). */
export function measureNode(n: Pick<DiagramNode, "label" | "form" | "sub" | "items" | "detail" | "limitIds">, o: MeasureOptions = {}): NodeBox {
  const { T, CARD, PANEL } = styleOf(o.post);
  const inside = n.detail ? 8 + INSIDE : 0;
  if (n.form === "card") {
    const w = n.sub ? clamp(ceil(CARD.padX * 2 + widthOf(n.sub, T.sub) + 2), CARD.w, CARD.maxW) : CARD.w;
    const width = w - CARD.padX * 2;
    const lines = wrapText(n.label, T.title.size, width, 600, CARD.maxLines, T.title.tracking);
    return { w, h: CARD.h + CARD.line * (lines.length - 1), lines, sub: n.sub ? fitLine(n.sub, width, T.sub) : "", items: [] };
  }
  if (n.form === "compact") {
    const fixed = COMPACT.padX * 2 + COMPACT.icon + COMPACT.gap + inside;
    const titleW = widthOf(n.label, T.compactTitle);
    const subW = n.sub ? COMPACT.gap + widthOf(n.sub, T.subMono) : 0;
    const w = clamp(ceil(fixed + titleW + subW + 2), COMPACT.minW, COMPACT.maxW);
    const label = fitLine(n.label, w - fixed, T.compactTitle);
    const room = w - fixed - widthOf(label, T.compactTitle) - COMPACT.gap;
    const sub = n.sub && room > 24 ? fitLine(n.sub, room, T.subMono) : "";
    return { w, h: COMPACT.h, lines: [label], sub, items: [] };
  }
  if (n.form === "panel") {
    const items = o.items === false ? [] : n.items;
    // The last rows that are limits keep room for their timer icon.
    const lim = Math.min(n.limitIds?.length ?? 0, items.length);
    const mark = (i: number) => (i >= items.length - lim ? LIMIT_ROW.icon + LIMIT_ROW.gap : 0);
    const head = PANEL.padX * 2 + PANEL.icon + PANEL.gap + inside;
    const need = Math.max(
      head + widthOf(n.label, T.title),
      n.sub ? PANEL.padX * 2 + PANEL.icon + PANEL.gap + widthOf(n.sub, T.sub) : 0,
      ...items.map((t, i) => PANEL.padX * 2 + PANEL.itemPad * 2 + 2 + mark(i) + widthOf(t, T.item)),
    );
    const w = clamp(ceil(need + 2), PANEL.minW, PANEL.maxW);
    const k = items.length;
    const h = PANEL.base + PANEL.titleLine + (n.sub ? PANEL.subLine : 0) + (k ? PANEL.listGap + k * PANEL.itemH + (k - 1) * PANEL.itemGap : 0);
    return {
      w, h,
      lines: [fitLine(n.label, w - head, T.title)],
      sub: n.sub ? fitLine(n.sub, w - PANEL.padX * 2 - PANEL.icon - PANEL.gap, T.sub) : "",
      items: items.map((t, i) => fitLine(t, w - PANEL.padX * 2 - PANEL.itemPad * 2 - 2 - mark(i), T.item)),
      ...(lim ? { limits: lim } : {}),
    };
  }
  // group: the header only; layoutRects adds the children.
  const head = GROUP.padHead * 2 + GROUP.icon + GROUP.gap + widthOf(n.label, T.title) + (n.sub ? GROUP.gap + widthOf(n.sub, T.sub) : 0) + inside;
  return { w: Math.max(GROUP.emptyW, ceil(head + 2)), h: GROUP.emptyH, lines: [n.label], sub: n.sub, items: [] };
}

/** Header width a group needs for its own text. */
export function groupHeaderWidth(n: Pick<DiagramNode, "label" | "sub" | "detail">, post = false): number {
  const { T } = styleOf(post);
  return ceil(GROUP.padHead * 2 + GROUP.icon + GROUP.gap + widthOf(n.label, T.title) + (n.sub ? GROUP.gap + widthOf(n.sub, T.sub) : 0) + (n.detail ? 8 + INSIDE : 0) + 2);
}

/** The box a group's name is drawn in, at the left of its header: no connection crosses it. */
export const groupNameBox = (n: Pick<DiagramNode, "label" | "sub" | "detail">, r: Rect, post = false): Rect =>
  ({ x: r.x, y: r.y, w: Math.min(r.w, groupHeaderWidth(n, post) - GROUP.padHead), h: GROUP.head });

/**
 * Every component's box in a view: cards, compacts and panels from their content at their
 * position; groups from their children's boxes plus padding (bottom-up), or 260×140 when empty.
 */
export function layoutRects(view: Pick<DiagramView, "nodes"> & { id?: string; postOf?: string | null }, o: MeasureOptions = {}): Map<string, Rect> {
  o = { ...o, post: postOf(view, o) };
  const rects = new Map<string, Rect>();
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, DiagramNode[]>();
  for (const n of view.nodes) if (n.parent && byId.has(n.parent)) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n);
  const visiting = new Set<string>();
  const rectOf = (n: DiagramNode): Rect => {
    const hit = rects.get(n.id);
    if (hit) return hit;
    let r: Rect;
    if (n.form !== "group") {
      const b = measureNode(n, o);
      r = { x: n.x, y: n.y, w: b.w, h: b.h };
    } else {
      const children = visiting.has(n.id) ? [] : kids.get(n.id) ?? [];
      visiting.add(n.id);
      if (!children.length) r = { x: n.x, y: n.y, w: Math.max(GROUP.emptyW, groupHeaderWidth(n, o.post)), h: GROUP.emptyH };
      else {
        const cs = children.map(rectOf);
        const minX = Math.min(...cs.map((c) => c.x)), minY = Math.min(...cs.map((c) => c.y));
        const maxX = Math.max(...cs.map((c) => c.x + c.w)), maxY = Math.max(...cs.map((c) => c.y + c.h));
        const w = Math.max(maxX - minX + GROUP.padX * 2, groupHeaderWidth(n, o.post));
        r = { x: minX - GROUP.padX, y: minY - GROUP.head, w, h: maxY - minY + GROUP.head + GROUP.padBottom };
      }
      visiting.delete(n.id);
    }
    rects.set(n.id, r);
    return r;
  };
  for (const n of view.nodes) rectOf(n);
  return rects;
}

/** A text's box: one line per newline, no wrapping. */
export function measureText(t: Pick<DiagramText, "text" | "size">): { w: number; h: number; lines: string[] } {
  const st = textStyle(t.size);
  const lines = t.text.split(/\r?\n/);
  const w = Math.max(8, ...lines.map((l) => textWidth(l, st.size, st.weight, st.tracking)));
  return { w: Math.ceil(w), h: lines.length * st.line, lines };
}

export const labelWidth = (text: string, post = false) => ceil(textWidth(text, styleOf(post).T.edge.size, 500) + LABEL.padX * 2 + 2);

// ---------------------------------------------------------------- connections

export type Side = "t" | "r" | "b" | "l";
const NORMAL: Record<Side, [number, number]> = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export interface EdgeRoute {
  id: string;
  /** Start and end on the component borders. */
  p0: Point; p1: Point; c1: Point; c2: Point;
  side0: Side; side1: Side;
  d: string;
  /** Centre of the label chip, or null when no free spot exists (the label is left out). */
  labelAt: Point | null;
  badgeAt: Point;
  segments?: Pick<EdgeRoute, "p0" | "p1" | "c1" | "c2">[];
  /** When the curve had to go around and no arc fits: the parts the drawn curve goes through. */
  blocked?: string[];
  /** No arc fitted: the fallback curve is drawn, over parts or not. */
  noArc?: boolean;
}

/** The sides two boxes connect on: the facing pair across the larger gap. */
export function chooseSides(a: Rect, b: Rect): [Side, Side] {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const ca = centre(a), cb = centre(b);
  const horizontal = gapX >= gapY ? (gapX > 0 || Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) : false;
  if (horizontal) return cb.x >= ca.x ? ["r", "l"] : ["l", "r"];
  return cb.y >= ca.y ? ["b", "t"] : ["t", "b"];
}

type Curve = Pick<EdgeRoute, "p0" | "c1" | "c2" | "p1">;
export function bezierAt(r: Curve & { segments?: Curve[] }, t: number): Point {
  if (r.segments?.length) {
    const at = Math.min(r.segments.length - 1, Math.floor(t * r.segments.length));
    return bezierAt(r.segments[at], t * r.segments.length - at);
  }
  const u = 1 - t;
  return {
    x: u * u * u * r.p0.x + 3 * u * u * t * r.c1.x + 3 * u * t * t * r.c2.x + t * t * t * r.p1.x,
    y: u * u * u * r.p0.y + 3 * u * u * t * r.c1.y + 3 * u * t * t * r.c2.y + t * t * t * r.p1.y,
  };
}

/** The point a fraction `t` of the way along a route's drawn length (labels and badges sit by length). */
export function alongRoute(r: Curve & { segments?: Curve[] }): (t: number) => Point {
  const k = 64 * (r.segments?.length || 1);
  const pts: Point[] = [], acc: number[] = [0];
  for (let i = 0; i <= k; i++) pts.push(bezierAt(r, i / k));
  for (let i = 1; i <= k; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = acc[k];
  return (t: number) => {
    const want = clamp(t, 0, 1) * total;
    let i = 1;
    while (i < k && acc[i] < want) i++;
    const f = acc[i] > acc[i - 1] ? (want - acc[i - 1]) / (acc[i] - acc[i - 1]) : 0;
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
  };
}

/** Whether two segments meet; touching counts (a line sampled exactly on the other one still crosses it). */
const turn = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const crossesSegment = (a: Point, b: Point, c: Point, d: Point) => {
  const box = Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x) && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y);
  return box && turn(a, b, c) * turn(a, b, d) <= 0 && turn(c, d, a) * turn(c, d, b) <= 0;
};

/**
 * A connection whose curve would enter a box goes around it by a smooth arc (diagram contract,
 * "Connections are smooth curves"): one cubic, or a chain of up to three through one or two bend
 * points beside the boxes in its way, joined in the same direction so no corner is drawn. A group's
 * name is never entered and parts are cleared; the cheapest arc wins, cost = length ÷ the distance
 * between the two parts' centres + 0.25 per earlier line crossed (fewer bend points, then shorter, then
 * further right on a tie), and no arc is longer than the larger of 1.8 × that distance and that distance + 120 px.
 * With `crossings` (a post), a clear curve that crosses earlier lines takes an arc that costs less,
 * and so does a loop out of and into one side when an arc is cheaper. Parts are kept 8 px clear; the
 * connection's own ends only must not be entered. `alts` are other free sides the arc may leave and
 * enter by. The search tries bend points beside the boxes in the way, then polishes the best arc with
 * each number of bend points. Returns the ids of the parts the drawn curve goes through when it had to
 * go around and no arc fits (the layout makes room there, else the line is reported), or null.
 */
type Ends = Pick<EdgeRoute, "p0" | "p1" | "side0" | "side1">;
/** `gate`: for the name of a group holding an end, the group's right edge — the header right of the name is a way in. */
/** `own`: one of the connection's two ends — the curve starts on its border, so only its inside counts. */
type Box = Rect & { padRight?: number; name?: boolean; id?: string; gate?: number; own?: boolean };
export const ARC = { pad: 8, cap: 1.8, plus: 120, crossing: 0.25 } as const;
/** The shortest handle (diagram contract: at least 24 px), with room for the path's rounding to 0.1 px. */
const MIN_HANDLE = 24.1;

/** Cubics from p0 to p1 through `vias`: handles along the end sides' normals and, at a via, along the
 * line from the point before it to the point after it, so the cubics meet without a corner. */
function chainThrough(e: Ends, vias: Point[], f = 0.42): Curve[] {
  const pts = [e.p0, ...vias, e.p1];
  const dir = (i: number): Point => {
    if (i === 0) return { x: NORMAL[e.side0][0], y: NORMAL[e.side0][1] };
    if (i === pts.length - 1) return { x: -NORMAL[e.side1][0], y: -NORMAL[e.side1][1] };
    const a = pts[i - 1], b = pts[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  };
  const out: Curve[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], h = clamp(Math.hypot(b.x - a.x, b.y - a.y) * f, MIN_HANDLE, 240), da = dir(i), db = dir(i + 1);
    out.push({ p0: a, c1: { x: a.x + da.x * h, y: a.y + da.y * h }, c2: { x: b.x - db.x * h, y: b.y - db.y * h }, p1: b });
  }
  return out;
}

/** Points along a chain, at most 12 px apart (by each cubic's control polygon), so no corner of a box slips between them. */
const sampleChain = (cs: Curve[], k = 40): Point[] => {
  const out: Point[] = [cs[0].p0];
  cs.forEach((c, j) => {
    const hull = Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y) + Math.hypot(c.c2.x - c.c1.x, c.c2.y - c.c1.y) + Math.hypot(c.p1.x - c.c2.x, c.p1.y - c.c2.y);
    const n = Math.max(k, Math.ceil(hull / 12));
    // Densely beside the two ends, where a curve that turns back would dip into its own part.
    if (j === 0) for (let i = 1; i < 12; i++) out.push(bezierAt(c, i / (12 * n)));
    for (let i = 1; i <= n; i++) {
      if (j === cs.length - 1 && i === n) for (let q = 11; q >= 1; q--) out.push(bezierAt(c, 1 - q / (12 * n)));
      out.push(bezierAt(c, i / n));
    }
  });
  return out;
};
/** Whether the segment a–b comes within `pad` of the box (Liang–Barsky against the box grown by `pad`). */
function segmentHitsBox(a: Point, b: Point, r: Rect, pad: number): boolean {
  const x0 = r.x - pad, x1 = r.x + r.w + pad, y0 = r.y - pad, y1 = r.y + r.h + pad, dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}
const polyLength = (pts: Point[]) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return s; };
const pathOf = (p0: Point, cs: Curve[]) => `M${r1(p0.x)},${r1(p0.y)} ` + cs.map((c) => `C${r1(c.c1.x)},${r1(c.c1.y)} ${r1(c.c2.x)},${r1(c.c2.y)} ${r1(c.p1.x)},${r1(c.p1.y)}`).join(" ");

function arc(route: EdgeRoute, boxes: Box[], lines: Point[][], crossings: boolean, alts: Ends[], centres: number): string[] | null {
  // Plain loops, no closures in the hot path: routing runs under tsx on the server.
  const boundsOf = (pts: Point[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    return { x0, y0, x1, y1 };
  };
  const lineBounds = lines.map(boundsOf);
  const enters = (pts: Point[], pad: number, namesOnly: boolean): Box | null => {
    const first = pts[0], last = pts[pts.length - 1], b = boundsOf(pts);
    // Only boxes the curve's bounds reach can be entered.
    const reach = boxes.filter((r) => r.x - pad <= b.x1 && r.x + r.w + pad >= b.x0 && r.y - pad <= b.y1 && r.y + r.h + pad >= b.y0);
    for (const p of pts) for (const r of reach) {
      if (namesOnly && !r.name && !r.own) continue;
      if (r.own) {
        // The curve never goes inside its own end (beside its port, by half a pixel of rounding).
        const o = Math.hypot(p.x - first.x, p.y - first.y) < 16 || Math.hypot(p.x - last.x, p.y - last.y) < 16 ? -0.5 : 0;
        if (p.x > r.x - o && p.x < r.x + r.w + o && p.y > r.y - o && p.y < r.y + r.h + o) return r;
        continue;
      }
      const right = r.padRight === undefined ? pad : Math.min(pad, r.padRight);
      if (p.x > r.x - pad && p.x < r.x + r.w + right && p.y > r.y - pad && p.y < r.y + r.h + pad) return r;
    }
    return null;
  };
  /** Earlier lines the polyline crosses, counting no further than `limit`. */
  const crossed = (pts: Point[], limit = Infinity) => {
    let count = 0;
    const b = boundsOf(pts);
    for (let k = 0; k < lines.length && count < limit; k++) {
      const l = lines[k], lb = lineBounds[k];
      if (lb.x0 > b.x1 || lb.x1 < b.x0 || lb.y0 > b.y1 || lb.y1 < b.y0) continue;
      let hit = false;
      for (let i = 1; i < pts.length && !hit; i++) {
        const a = pts[i - 1], c = pts[i];
        // A piece of the curve away from the line's bounds cannot cross it.
        if (Math.max(a.x, c.x) < lb.x0 || Math.min(a.x, c.x) > lb.x1 || Math.max(a.y, c.y) < lb.y0 || Math.min(a.y, c.y) > lb.y1) continue;
        for (let j = 1; j < l.length && !hit; j++) hit = crossesSegment(a, c, l[j - 1], l[j]);
      }
      if (hit) count++;
    }
    return count;
  };
  // A curve skimming one of its own two parts can dip in between two samples: each piece between
  // samples is tested, half a pixel inside their border (where it starts and ends).
  const own = boxes.filter((r) => r.own);
  const intoOwn = (pts: Point[]) => {
    for (let i = 1; i < pts.length; i++) for (const r of own) if (segmentHitsBox(pts[i - 1], pts[i], r, -0.5)) return true;
    return false;
  };
  const d = Math.max(1, centres), cap = Math.max(ARC.cap * d, d + ARC.plus);
  const plain = sampleChain([route], 160);
  const hit = enters(plain, 1, false) !== null;
  const plainCrossed = !hit && crossings ? crossed(plain) : 0;
  // A loop out of and into the same side (the parts' facing sides were in the way) is a way round
  // too: an arc replaces it when cheaper.
  const loop = route.side0 === route.side1;
  if (!hit && !plainCrossed && !loop) return null;
  const plainCost = hit ? Infinity : polyLength(plain) / d + ARC.crossing * plainCrossed;
  const options: Ends[] = [route, ...alts];

  type Found = { ends: Ends; cs: Curve[]; cost: number; length: number; vias: number; meanX: number; at: Point[]; f: number };
  /** The last search's best with 0, 1 and 2 bend points (the fallback shortens each). */
  let kinds: (Found | null)[] = [];
  /** The cheapest curve clear of every box (or, with `namesOnly`, of group names alone). */
  const search = (namesOnly: boolean, capped: boolean): Found | null => {
    let best: Found | null = null;
    // The best with 0, 1 and 2 bend points: a slightly longer arc may become the cheapest once polished.
    const byVias: (Found | null)[] = [null, null, null];
    const SLACK = 1.12;
    const better = (c: Found, b: Found | null) => {
      const tie = (x: number, y: number) => Math.abs(x - y) <= 1e-6;
      // Fewer bend points, then shorter, then further right (as the portrait turn: right on a tie).
      return !b || c.cost < b.cost - 1e-9 || (tie(c.cost, b.cost) && (c.vias < b.vias || (c.vias === b.vias && (c.length < b.length - 1e-6 || (tie(c.length, b.length) && c.meanX > b.meanX + 1e-6)))));
    };
    const consider = (ends: Ends, at: Point[], f = 0.42) => {
      // A curve through points is no shorter than the straight lines through them: skip it unsampled.
      const known0 = best as Found | null;
      let chord = 0, q = ends.p0;
      for (const v of at) { chord += Math.hypot(v.x - q.x, v.y - q.y); q = v; }
      chord += Math.hypot(ends.p1.x - q.x, ends.p1.y - q.y);
      if ((capped && chord > cap) || (known0 && chord / d > known0.cost * SLACK + 1e-9)) return;
      const cs = chainThrough(ends, at, f), vias = at.length;
      // A coarse pass first: a point of the curve inside a box rules it out without the fine sampling.
      const coarse: Point[] = [cs[0].p0];
      for (const c of cs) for (let i = 1; i <= 12; i++) coarse.push(bezierAt(c, i / 12));
      if (enters(coarse, namesOnly ? 4 : ARC.pad, namesOnly)) return;
      const pts = sampleChain(cs);
      const length = polyLength(pts);
      // The cost is at least length ÷ distance: a candidate longer than the best's cost cannot win.
      const known = best as Found | null;
      if ((capped && length > cap) || (known && length / d > known.cost * SLACK + 1e-9) || enters(pts, namesOnly ? 4 : ARC.pad, namesOnly) || intoOwn(pts)) return;
      // Crossings beyond what could still come near the best do not need counting.
      const room = known ? Math.floor((known.cost * SLACK - length / d) / ARC.crossing + 1e-9) + 1 : Infinity;
      const cost = length / d + ARC.crossing * crossed(pts, room);
      let meanX = 0;
      for (const p of pts) meanX += p.x / pts.length;
      const c: Found = { ends, cs, cost, length, vias, meanX, at, f };
      if (better(c, byVias[vias])) byVias[vias] = c;
      if (better(c, best)) best = c;
    };
    for (const ends of options) for (const f of [0.12, 0.25, 0.42, 0.7, 1]) consider(ends, [], f);
    // A single curve that crosses nothing and is about as short as a straight line between its ends
    // cannot be beaten; otherwise bend points beside the boxes in the way may give a cheaper arc.
    const first = best as Found | null, chord = Math.min(...options.map((o) => Math.hypot(o.p1.x - o.p0.x, o.p1.y - o.p0.y)));
    if (first && first.cost <= first.length / d + 1e-9 && first.length <= chord * 1.02) return first;
    const blockers: Box[] = [];
    for (const ends of options) for (const f of [0.42, 1]) for (const p of sampleChain(chainThrough(ends, [], f))) for (const r of boxes) {
      if (namesOnly && !r.name && !r.own) continue;
      const right = r.padRight === undefined ? ARC.pad : Math.min(ARC.pad, r.padRight);
      // An own end is in the way only when the curve goes inside it; bend points then go round it.
      if (r.own) { if (!blockers.includes(r) && p.x > r.x + 0.5 && p.x < r.x + r.w - 0.5 && p.y > r.y + 0.5 && p.y < r.y + r.h - 0.5) blockers.push(r); continue; }
      if (!blockers.includes(r) && p.x > r.x - ARC.pad && p.x < r.x + r.w + right && p.y > r.y - ARC.pad && p.y < r.y + r.h + ARC.pad) blockers.push(r);
    }
    // Avoiding a crossing, the bend goes round an end of the line crossed: beside the part it ends on.
    if (!hit) for (const l of lines) {
      let across = false;
      for (let i = 1; i < plain.length && !across; i++) for (let j = 1; j < l.length && !across; j++) across = crossesSegment(plain[i - 1], plain[i], l[j - 1], l[j]);
      if (across) for (const end of [l[0], l[l.length - 1]]) for (const r of boxes) {
        if (!r.name && !r.own && !blockers.includes(r) && end.x >= r.x - 2 && end.x <= r.x + r.w + 2 && end.y >= r.y - 2 && end.y <= r.y + r.h + 2) blockers.push(r);
      }
    }
    const mx = (route.p0.x + route.p1.x) / 2, my = (route.p0.y + route.p1.y) / 2;
    blockers.sort((a, b) => Math.hypot(a.x + a.w / 2 - mx, a.y + a.h / 2 - my) - Math.hypot(b.x + b.w / 2 - mx, b.y + b.h / 2 - my));
    // The four nearest the middle, and an own end the curve goes inside, wherever it is.
    const near = blockers.slice(0, 4).concat(blockers.slice(4).filter((r) => r.own));
    const around = (r: Rect, m: number): Point[][] => [
      [{ x: r.x + r.w / 2, y: r.y - m }, { x: r.x - m, y: r.y - m }, { x: r.x + r.w + m, y: r.y - m }],
      [{ x: r.x + r.w / 2, y: r.y + r.h + m }, { x: r.x - m, y: r.y + r.h + m }, { x: r.x + r.w + m, y: r.y + r.h + m }],
      [{ x: r.x - m, y: r.y + r.h / 2 }], [{ x: r.x + r.w + m, y: r.y + r.h / 2 }],
    ];
    // One bend point just beside a box in the way; further out, or with longer handles, only when
    // none fits there (the polish below moves a bend point outward as needed).
    for (const [m, f] of [[ARC.pad + 14, 0.42], [ARC.pad + 34, 0.42], [ARC.pad + 14, 0.6], [ARC.pad + 34, 0.6]] as const) {
      if (m !== ARC.pad + 14 || f !== 0.42) { if (best) break; }
      for (const ends of options) for (const r of near) for (const family of around(r, m)) for (const v of family) consider(ends, [v], f);
    }
    // Into the group holding an end through its header right of the name: down (or up) the gap.
    for (const ends of options) for (const r of near) {
      if (r.gate === undefined) continue;
      const left = r.x + r.w + (r.padRight ?? ARC.pad);
      if (r.gate - left < 16) continue;
      const gx = (left + r.gate) / 2, top = { x: gx, y: r.y - ARC.pad - 14 }, bottom = { x: gx, y: r.y + r.h + ARC.pad + 14 };
      const down = (ends.p1.y - ends.p0.y) >= 0;
      consider(ends, down ? [top, bottom] : [bottom, top]);
      consider(ends, [{ x: gx, y: r.y + r.h / 2 }]);
    }
    // Two bend points down one side of a box in the way (its two corners on that side).
    for (const ends of options) for (const r of near) {
      const m = ARC.pad + 14, l = r.x - m, rt = r.x + r.w + m, t = r.y - m, b = r.y + r.h + m;
      const along = (p: Point) => (p.x - ends.p0.x) * (ends.p1.x - ends.p0.x) + (p.y - ends.p0.y) * (ends.p1.y - ends.p0.y);
      for (const [v, w] of [[{ x: rt, y: t }, { x: rt, y: b }], [{ x: l, y: t }, { x: l, y: b }], [{ x: l, y: t }, { x: rt, y: t }], [{ x: l, y: b }, { x: rt, y: b }]]) {
        // Short handles too: a long first handle can sag into what the bend points go round.
        for (const f of [0.42, 0.15]) consider(ends, along(v) <= along(w) ? [v, w] : [w, v], f);
      }
    }
    // Two bend points on the same side of the boxes in the way (over two parts, under a zone's corner),
    // while the best so far still crosses a line or nothing fits yet.
    const sofar = best as Found | null;
    if (!sofar || sofar.cost > sofar.length / d + 1e-9) for (const ends of options) for (let side = 0; side < 4; side++) {
      const vias = near.flatMap((r) => around(r, ARC.pad + 14)[side]);
      const along = (p: Point) => (p.x - ends.p0.x) * (ends.p1.x - ends.p0.x) + (p.y - ends.p0.y) * (ends.p1.y - ends.p0.y);
      for (const v of vias) for (const w of vias) if (along(v) < along(w)) for (const f of [0.42, 0.15]) consider(ends, [v, w], f);
    }
    // Polish the best of each kind near the cheapest: move its bend points and its handle length
    // while that lowers its cost.
    for (let v = 0; v < 3; v++) {
      const top = best as Found | null;
      if (!byVias[v] || !top || byVias[v]!.cost > top.cost * SLACK) continue;
      // The fallback (names only) is drawn as the shortest, so it is polished finer.
      for (const step of namesOnly ? [12, 4, 1.5, 0.5] : [12, 4]) for (let round = 0; round < (namesOnly ? 12 : 6); round++) {
        const cur = byVias[v]!;
        for (const df of [-step / 80, step / 80]) consider(cur.ends, cur.at, clamp(cur.f + df, 0.08, 1.2));
        cur.at.forEach((_, i) => {
          for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) consider(cur.ends, cur.at.map((p, k) => (k === i ? { x: p.x + dx, y: p.y + dy } : p)), cur.f);
        });
        if (byVias[v] === cur) break;
      }
    }
    kinds = byVias;
    return best;
  };
  const apply = (f: Found) => {
    const { ends, cs } = f;
    route.p0 = ends.p0; route.p1 = ends.p1; route.side0 = ends.side0; route.side1 = ends.side1;
    route.c1 = cs[0].c1; route.c2 = cs[cs.length - 1].c2;
    if (cs.length > 1) route.segments = cs; else delete route.segments;
    route.d = pathOf(route.p0, cs);
  };
  /**
   * Shorten the fallback freely: each bend point's place and direction and each handle's length
   * (never under 24 px, so no corner shows) move while the curve gets shorter and stays out of names.
   */
  const tune = (f: Found): Found => {
    const n = f.at.length, cs0 = f.cs;
    // p = per bend point [x, y, angle], then per cubic [first handle, second handle].
    const p: number[] = [];
    for (let i = 0; i < n; i++) { const c = cs0[i + 1]; p.push(c.p0.x, c.p0.y, Math.atan2(c.c1.y - c.p0.y, c.c1.x - c.p0.x)); }
    for (const c of cs0) p.push(Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y), Math.hypot(c.p1.x - c.c2.x, c.p1.y - c.c2.y));
    const build = (q: number[]): Curve[] => {
      const pts = [f.ends.p0], dirs: Point[] = [{ x: NORMAL[f.ends.side0][0], y: NORMAL[f.ends.side0][1] }];
      for (let i = 0; i < n; i++) { pts.push({ x: q[3 * i], y: q[3 * i + 1] }); dirs.push({ x: Math.cos(q[3 * i + 2]), y: Math.sin(q[3 * i + 2]) }); }
      pts.push(f.ends.p1); dirs.push({ x: -NORMAL[f.ends.side1][0], y: -NORMAL[f.ends.side1][1] });
      return pts.slice(1).map((b, i) => {
        const a = pts[i], ha = Math.max(MIN_HANDLE, q[3 * n + 2 * i]), hb = Math.max(MIN_HANDLE, q[3 * n + 2 * i + 1]);
        return { p0: a, c1: { x: a.x + dirs[i].x * ha, y: a.y + dirs[i].y * ha }, c2: { x: b.x - dirs[i + 1].x * hb, y: b.y - dirs[i + 1].y * hb }, p1: b };
      });
    };
    // The curve is pushed against the names, so each piece between two samples is tested, not only
    // the samples: a box's corner could slip between two points outside it.
    const names = boxes.filter((r) => r.name);
    const cuts = (pts: Point[]) => {
      for (let i = 1; i < pts.length; i++) for (const r of names) if (segmentHitsBox(pts[i - 1], pts[i], r, 0.1)) return true;
      return intoOwn(pts);
    };
    const lengthOf = (q: number[]) => { const pts = sampleChain(build(q)); return enters(pts, 0.1, true) || cuts(pts) ? Infinity : polyLength(pts); };
    const descend = (q: number[]) => {
      let cur = lengthOf(q);
      if (!Number.isFinite(cur)) return cur;
      for (const step of [8, 4, 2, 1, 0.5, 0.25]) for (let round = 0; round < 40; round++) {
        let moved = false;
        for (let k = 0; k < q.length; k++) for (const s of [step, -step]) {
          const dk = k < 3 * n && k % 3 === 2 ? s / 120 : s;
          q[k] += dk;
          const l = lengthOf(q);
          if (l < cur - 1e-6) { cur = l; moved = true; } else q[k] -= dk;
        }
        if (!moved) break;
      }
      // Then moves of every number at once (a fixed sequence, so a drawing always routes the same):
      // a bend point sliding while a handle grows is shorter where no single move is.
      let seed = 1;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
      for (const step of [4, 2, 1, 0.5, 0.25]) for (let tries = 0, fails = 0; tries < 300 && fails < 60; tries++) {
        const dq = q.map((_, k) => (k < 3 * n && k % 3 === 2 ? rnd() * step / 60 : rnd() * step * 2));
        const r = q.map((x, k) => x + dq[k]), l = lengthOf(r);
        if (l < cur - 1e-6) { cur = l; q.splice(0, q.length, ...r); fails = 0; } else fails++;
      }
      return cur;
    };
    // From its own handles and from longer ones: a descent stops where no single move shortens it.
    let best = p, bestLength = descend(best);
    for (const h of [40, 64]) {
      const q = p.map((x, k) => (k >= 3 * n ? h : x));
      const l = descend(q);
      if (l < bestLength) { best = q; bestLength = l; }
    }
    if (!Number.isFinite(bestLength)) return f;
    const cs = build(best), pts = sampleChain(cs);
    if (enters(pts, 0.1, true) || cuts(pts)) return f;
    let meanX = 0;
    for (const q of pts) meanX += q.x / pts.length;
    return { ...f, cs, length: polyLength(pts), meanX };
  };
  const found = search(false, true);
  if (found && found.cost < plainCost) { apply(found); return null; }
  if (!hit) return null;
  // No arc: the shortest curve that stays out of group names (a plain one when the plain one does)
  // is drawn over the parts, and the layout report lists it. The parts are those the drawn curve enters.
  if (enters(plain, 1, true)) {
    const names = search(true, false);
    if (names) {
      // Each kind near the shortest is shortened; the shortest of them is drawn.
      let shortest = tune(names);
      for (const k of kinds) if (k && k !== names && k.length <= names.length * 1.12) { const t = tune(k); if (t.length < shortest.length) shortest = t; }
      apply(shortest);
    }
  }
  const drawn = sampleChain(route.segments ?? [route]);
  const blockers: string[] = [];
  for (const p of drawn) for (const r of boxes) if (!r.name && r.id && !blockers.includes(r.id) && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) blockers.push(r.id);
  return blockers;
}

/**
 * The free spot nearest `mid` for a box of half-size `hw` × `hh` kept `pad` clear of every obstacle
 * (diagram contract: a label or badge takes the free spot nearest the middle of its curve). The nearest
 * point outside a union of boxes is the middle itself, a point on the curve, or where the edges of
 * the boxes, pushed out by the half-size and the pad, meet — so those are the candidates. A spot
 * further than `reach` from every point of the curve does not count.
 */
export function nearestFree(mid: Point, curve: Point[], hw: number, hh: number, obstacles: Rect[], pad: number, reach = Infinity): Point | null {
  const near = (p: Point) => reach === Infinity || curve.some((c) => Math.hypot(c.x - p.x, c.y - p.y) <= reach);
  const fits = (p: Point) => near(p) && obstacles.every((r) => p.x + hw + pad <= r.x || p.x - hw - pad >= r.x + r.w || p.y + hh + pad <= r.y || p.y - hh - pad >= r.y + r.h);
  let best: Point | null = null, bestD = Infinity;
  const consider = (p: Point) => {
    const q = { x: Math.round(p.x), y: Math.round(p.y) }, d = Math.hypot(q.x - mid.x, q.y - mid.y);
    if (d < bestD - 1e-9 && fits(q)) { best = q; bestD = d; }
  };
  consider(mid);
  for (const p of curve) consider(p);
  // Edges near the middle first; all of them only when nothing near is free.
  for (const radius of [480, Infinity]) {
    const near = obstacles.filter((r) => Math.max(r.x - mid.x, mid.x - r.x - r.w, r.y - mid.y, mid.y - r.y - r.h) <= radius);
    const xs = [mid.x, ...near.flatMap((r) => [Math.floor(r.x - pad - hw), Math.ceil(r.x + r.w + pad + hw)])];
    const ys = [mid.y, ...near.flatMap((r) => [Math.floor(r.y - pad - hh), Math.ceil(r.y + r.h + pad + hh)])];
    for (const x of xs) for (const y of ys) if (Math.hypot(x - mid.x, y - mid.y) < bestD) consider({ x, y });
    if (best) break;
  }
  return best;
}

export interface RouteOptions {
  /** Draw labels (share toggle). Default true. */
  labels?: boolean;
  /** The dense post style. Default: whether the view is a post view. */
  post?: boolean;
  /** Extra boxes labels must not cover (texts). */
  avoid?: Rect[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Curves for every connection whose ends are drawn. Connections on one side of a component are
 * spread up to 16 px apart, ordered by where the other end is, so lines never stack.
 */
export function routeEdges(view: Pick<DiagramView, "nodes" | "edges"> & { id?: string; postOf?: string | null }, rects: Map<string, Rect>, o: RouteOptions = {}): Map<string, EdgeRoute> {
  const S = styleOf(postOf(view, o));
  type End = { e: DiagramEdge; end: 0 | 1; id: string; side: Side; other: Point };
  const ends: End[] = [];
  const sides = new Map<string, [Side, Side]>();
  for (const e of view.edges) {
    const a = rects.get(e.from), b = rects.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    const s = chooseSides(a, b);
    sides.set(e.id, s);
    ends.push({ e, end: 0, id: e.from, side: s[0], other: centre(b) }, { e, end: 1, id: e.to, side: s[1], other: centre(a) });
  }
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  // The x a top port must keep right of: a group's name sits just above its first row.
  const clearOfName = (id: string): number => {
    const r = rects.get(id)!;
    let x = -Infinity;
    for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) {
      const g = rects.get(p), n = byId.get(p);
      if (g && n && r.y - (g.y + GROUP.head) < 40) { const b = groupNameBox(n, g, S.post); x = Math.max(x, b.x + b.w + 4); }
    }
    return x;
  };
  // Whether a part sits right beside `id` on side `s`, too close for a line to come in there.
  const beside = (id: string, s: Side) => {
    const r = rects.get(id);
    if (!r) return false;
    return view.nodes.some((m) => {
      const q = m.id !== id && m.form !== "group" ? rects.get(m.id) : undefined;
      if (!q) return false;
      if (s === "l" || s === "r") {
        if (!(q.y < r.y + r.h && r.y < q.y + q.h)) return false;
        return s === "l" ? q.x + q.w <= r.x && r.x - (q.x + q.w) < 40 : q.x >= r.x + r.w && q.x - (r.x + r.w) < 40;
      }
      if (!(q.x < r.x + r.w && r.x < q.x + q.w)) return false;
      return s === "t" ? q.y + q.h <= r.y && r.y - (q.y + q.h) < 40 : q.y >= r.y + r.h && q.y - (r.y + r.h) < 40;
    });
  };
  // A part whose top lies all under its group's name takes those connections on a side instead.
  const fromAbove = new Map<string, number>();
  // The side this rule gave an end: a path around parts may not move that end elsewhere.
  const pinned = new Map<string, Side>();
  for (const p of ends) if (p.side === "t") fromAbove.set(p.id, (fromAbove.get(p.id) ?? 0) + 1);
  for (const [id, k] of fromAbove) {
    const r = rects.get(id)!;
    if (clearOfName(id) - r.x <= r.w - 8 - (k - 1) * 10) continue;
    // A free side — no other connection uses it and no part sits right beside it (a line needs room
    // to come in) — else the one nearer the group's edge.
    const used = (s: Side) => ends.some((p) => p.id === id && p.side === s);
    const free = (s: Side) => !used(s) && !beside(id, s);
    const g = rects.get(byId.get(id)?.parent ?? "");
    const side: Side = free("l") !== free("r") ? (free("l") ? "l" : "r")
      : g ? (r.x - g.x <= g.x + g.w - r.x - r.w ? "l" : "r") : "l";
    for (const p of ends) {
      if (p.id !== id || p.side !== "t") continue;
      p.side = side;
      sides.get(p.e.id)![p.end] = side;
      pinned.set(`${p.e.id}:${p.end}`, side);
    }
  }
  // A line straight down (or up) through parts that lie between its ends goes around them on a side,
  // when that side's curve is clear (a portrait post's turn under its side parts). It bulges no further
  // than it needs to, and takes the side that stays inside the parts' extent with its badge, right on a tie.
  const parts = view.nodes.filter((n) => n.form !== "group");
  const bulge = new Map<string, number>();
  const mid = (r: Rect, s: Side): Point => ({ x: r.x + r.w * (s === "l" ? 0 : s === "r" ? 1 : 0.5), y: r.y + r.h * (s === "t" ? 0 : s === "b" ? 1 : 0.5) });
  let left = Infinity, right = -Infinity;
  for (const r of rects.values()) { left = Math.min(left, r.x); right = Math.max(right, r.x + r.w); }
  const curveOf = (e: DiagramEdge, s: [Side, Side], c?: number): Point[] => {
    const a = rects.get(e.from)!, b = rects.get(e.to)!, p0 = mid(a, s[0]), p1 = mid(b, s[1]);
    c ??= clamp(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.42, MIN_HANDLE, 160);
    const curve = { p0, p1, c1: { x: p0.x + NORMAL[s[0]][0] * c, y: p0.y + NORMAL[s[0]][1] * c }, c2: { x: p1.x + NORMAL[s[1]][0] * c, y: p1.y + NORMAL[s[1]][1] * c } } as EdgeRoute;
    return Array.from({ length: 65 }, (_, i) => bezierAt(curve, i / 64));
  };
  const clearCurve = (e: DiagramEdge, s: [Side, Side], c?: number) => {
    const pts = curveOf(e, s, c);
    return !parts.some((n) => n.id !== e.from && n.id !== e.to && rects.has(n.id) && pts.some((p) => {
      const r = rects.get(n.id)!;
      return p.x > r.x - 8 && p.x < r.x + r.w + 8 && p.y > r.y - 8 && p.y < r.y + r.h + 8;
    }));
  };
  for (const e of view.edges) {
    const s = sides.get(e.id);
    if (!S.post || !s || !((s[0] === "b" && s[1] === "t") || (s[0] === "t" && s[1] === "b")) || clearCurve(e, s)) continue;
    const options = (["r", "l"] as const).flatMap((x) => {
      for (let c = MIN_HANDLE; c <= 160; c += 8) if (clearCurve(e, [x, x], c)) {
        const xs = curveOf(e, [x, x], c).map((p) => p.x), out = S.BADGE.r + 3;
        return [{ side: x, c, over: Math.max(0, Math.max(...xs) + out - right) + Math.max(0, left - (Math.min(...xs) - out)) }];
      }
      return [];
    });
    if (!options.length) continue;
    const best = options.reduce((p, q) => (q.over < p.over ? q : p));
    s[0] = s[1] = best.side;
    bulge.set(e.id, best.c);
    for (const p of ends) if (p.e === e) p.side = best.side;
  }
  const groups = new Map<string, End[]>();
  for (const p of ends) { const k = `${p.id}:${p.side}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  const pts = new Map<string, Point>();
  for (const list of groups.values()) {
    const vert = list[0].side === "l" || list[0].side === "r";
    list.sort((p, q) => (vert ? p.other.y - q.other.y : p.other.x - q.other.x) || p.e.id.localeCompare(q.e.id) || p.end - q.end);
    const r = rects.get(list[0].id)!;
    const span = (vert ? r.h : r.w) * 0.6;
    let step = list.length > 1 ? Math.min(16, span / (list.length - 1)) : 0;
    let first = (vert ? r.h : r.w) / 2 - (list.length - 1) / 2 * step;
    // Ends entering from above come in right of the group's name, closer together if the part leaves room.
    const clear = list[0].side === "t" ? clearOfName(list[0].id) - r.x : -Infinity;
    if (clear > first) {
      const room = r.w - 8 - clear, need = list.length > 1 ? room / (list.length - 1) : Infinity;
      if (room >= 0 && need >= 10) { step = Math.min(step, need); first = clear; }
    }
    list.forEach((p, i) => {
      const off = Math.round(first + i * step - (vert ? r.h : r.w) / 2);
      const P: Record<Side, Point> = {
        r: { x: r.x + r.w, y: r.y + r.h / 2 + off }, l: { x: r.x, y: r.y + r.h / 2 + off },
        b: { x: r.x + r.w / 2 + off, y: r.y + r.h }, t: { x: r.x + r.w / 2 + off, y: r.y },
      };
      pts.set(`${p.e.id}:${p.end}`, { x: Math.round(P[p.side].x), y: Math.round(P[p.side].y) });
    });
  }

  const boxes: Rect[] = [];
  for (const n of view.nodes) {
    const r = rects.get(n.id);
    if (!r) continue;
    // Of a group, labels and badges keep off its name; the rest of its header band is free.
    boxes.push(n.form === "group" ? groupNameBox(n, r, S.post) : r);
  }
  const blocked = [...boxes, ...(o.avoid ?? [])];
  const taken: Rect[] = [];
  const routes = new Map<string, EdgeRoute>();
  for (const e of view.edges) {
    const s = sides.get(e.id);
    const a = pts.get(`${e.id}:0`), b = pts.get(`${e.id}:1`);
    if (!s || !a || !b) continue;
    const n0 = NORMAL[s[0]], n1 = NORMAL[s[1]];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const c = bulge.get(e.id) ?? (s[0] === s[1] ? 56 : clamp(dist * 0.42, MIN_HANDLE, 160));
    // Both ends sit on the borders: the arrowhead's tip touches the part it points at.
    const p1 = { ...b }, p0 = { ...a };
    const c1 = { x: a.x + n0[0] * c, y: a.y + n0[1] * c };
    const c2 = { x: p1.x + n1[0] * c, y: p1.y + n1[1] * c };
    const route: EdgeRoute = {
      id: e.id, p0, p1, c1, c2, side0: s[0], side1: s[1],
      d: `M${r1(p0.x)},${r1(p0.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(p1.x)},${r1(p1.y)}`,
      labelAt: null, badgeAt: { x: 0, y: 0 },
    };
    const containers = new Set<string>();
    for (const id of [e.from, e.to]) for (let p = byId.get(id)?.parent; p && !containers.has(p); p = byId.get(p)?.parent) containers.add(p);
    // A connection may cross into the group holding its end, but not through that group's name.
    // Its right edge keeps 4 px, not the arc's 8, so a port right of the name stays reachable.
    const ra = rects.get(e.from)!, rb = rects.get(e.to)!;
    const centres = Math.hypot(ra.x + ra.w / 2 - rb.x - rb.w / 2, ra.y + ra.h / 2 - rb.y - rb.h / 2);
    const blockedBy = arc(route, view.nodes.filter((n) => n.id !== e.from && n.id !== e.to).map((n): Box => {
      const r = rects.get(n.id)!;
      if (containers.has(n.id)) return { ...groupNameBox(n, r, S.post), padRight: 4, name: true, gate: r.x + r.w };
      return n.form === "group" ? { ...groupNameBox(n, r, S.post), name: true } : { ...r, id: n.id };
    }).concat([e.from, e.to].filter((id) => byId.get(id)?.form !== "group").map((id) => ({ ...rects.get(id)!, own: true }))), view.edges.filter((x) => routes.has(x.id) && ![x.from, x.to].some((id) => id === e.from || id === e.to))
      .map((x) => { const r = routes.get(x.id)!, k = Math.max(16, (r.segments?.length ?? 1) * 8); return Array.from({ length: k + 1 }, (_, i) => bezierAt(r, i / k)); }), S.post,
      // An arc may also leave and enter by a pair of like sides no other connection uses (see arc).
      (["r", "l", "t", "b"] as const).filter((x) => x !== s[0] || x !== s[1]).filter((x) => [e.from, e.to].every((id, k) => (pinned.get(`${e.id}:${k}`) ?? x) === x && !ends.some((p) => p.id === id && p.e !== e && p.side === x) && !beside(id, x)))
        .map((x) => { const m0 = mid(rects.get(e.from)!, x), m1 = mid(rects.get(e.to)!, x); return { p0: { x: Math.round(m0.x), y: Math.round(m0.y) }, p1: { x: Math.round(m1.x), y: Math.round(m1.y) }, side0: x, side1: x }; })
        // A loop may also go back to the facing sides, by an arc round what made it loop.
        .concat(s[0] === s[1] ? [chooseSides(ra, rb)].filter(([f0, f1]) => f0 !== f1 && [[e.from, f0], [e.to, f1]].every(([id, x], k) => (pinned.get(`${e.id}:${k}`) ?? x) === x && !ends.some((p) => p.id === id && p.e !== e && p.side === x)))
          .map(([f0, f1]) => { const m0 = mid(ra, f0), m1 = mid(rb, f1); return { p0: { x: Math.round(m0.x), y: Math.round(m0.y) }, p1: { x: Math.round(m1.x), y: Math.round(m1.y) }, side0: f0, side1: f1 }; }) : []), centres);
    if (blockedBy) { route.noArc = true; if (blockedBy.length) route.blocked = blockedBy; }
    const along = alongRoute(route);
    if (e.label && o.labels !== false) {
      // The label takes the free spot nearest the middle of the curve, 4 px clear of parts, names,
      // texts and other labels, and beside its curve; with none, it is left out.
      const half = labelWidth(e.label, S.post) / 2, curve = Array.from({ length: 65 }, (_, i) => along(i / 64));
      route.labelAt = nearestFree(along(0.5), curve, half, LABEL.h / 2, [...blocked, ...taken], 4, half + 10);
      // Its drawn box: later labels keep their 4 px from it, badges only stay off it.
      if (route.labelAt) taken.push({ x: route.labelAt.x - half, y: route.labelAt.y - LABEL.h / 2, w: half * 2, h: LABEL.h });
    }
    routes.set(e.id, route);
  }
  // Place badges after all labels, including labels of later connections: nearest the curve's middle.
  for (const route of routes.values()) {
    const br = S.BADGE.r + 3, along = alongRoute(route);
    // The badge takes the free spot nearest the middle of its curve, clear of parts, names, texts and labels.
    const centre = along(0.5), m = nearestFree(centre, Array.from({ length: 65 }, (_, i) => along(i / 64)), br, br, [...taken, ...blocked], 0) ?? centre;
    route.badgeAt = { x: Math.round(m.x), y: Math.round(m.y) };
  }
  return routes;
}

/** Bounding box of a curve (its control polygon is a safe hull; we sample for a tight one). */
/** The exact box of a connection's curve: each cubic's ends and the extremes where its slope is 0. */
function curveBounds(r: EdgeRoute): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const s of r.segments?.length ? r.segments : [r]) {
    add(s.p0.x, s.p0.y); add(s.p1.x, s.p1.y);
    for (const axis of ["x", "y"] as const) {
      // B'(t)/3 = a t² + b t + c for this axis.
      const p0 = s.p0[axis], p1 = s.c1[axis], p2 = s.c2[axis], p3 = s.p1[axis];
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
      const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b])
        : (() => { const d = b * b - 4 * a * c; return d < 0 ? [] : [(-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a)]; })();
      for (const t of roots) if (t > 0 && t < 1) { const p = bezierAt(s, t); add(p.x, p.y); }
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Everything drawn in a view: components, texts, curves and labels. */
export function viewBounds(view: Pick<DiagramView, "nodes" | "edges" | "texts"> & { id?: string; postOf?: string | null }, rects: Map<string, Rect>, routes: Map<string, EdgeRoute>, texts = true, steps = false): Rect {
  const S = styleOf(postOf(view));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (r: Rect) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); };
  for (const r of rects.values()) add(r);
  if (texts) for (const t of view.texts) add({ x: t.x, y: t.y, ...measureText(t) });
  for (const e of view.edges) {
    const r = routes.get(e.id);
    if (!r) continue;
    add(curveBounds(r));
    if (r.labelAt && e.label) { const w = labelWidth(e.label, S.post); add({ x: r.labelAt.x - w / 2, y: r.labelAt.y - LABEL.h / 2, w, h: LABEL.h }); }
    if (steps && e.step !== null) { const radius = S.BADGE.r + 3; add({ x: r.badgeAt.x - radius, y: r.badgeAt.y - radius, w: 2 * radius, h: 2 * radius }); }
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

