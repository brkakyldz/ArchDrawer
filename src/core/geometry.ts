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

/** The box a group's name is drawn in, at the left of its header: labels and badges keep off it. */
export const groupNameBox = (n: Pick<DiagramNode, "label" | "sub" | "detail">, r: Rect, post = false): Rect =>
  ({ x: r.x, y: r.y, w: Math.min(r.w, groupHeaderWidth(n, post) - GROUP.padHead), h: GROUP.head });

/**
 * Where a group's name text lies, 3 px round: connections pass behind it (they are not drawn there).
 * It runs 5 % past the name box, since a platform may paint the text a few percent wider than its
 * metrics (Linux paints Geist about 3 % wider), and stays within the group.
 */
export const groupNameText = (n: Pick<DiagramNode, "label" | "sub" | "detail">, r: Rect, post = false): Rect => {
  const b = groupNameBox(n, r, post), x = r.x + GROUP.padHead - 3;
  const w = Math.max(0, b.x + b.w - x);
  return { x, y: r.y + GROUP.head / 2 - 14, w: Math.min(Math.ceil(w * 1.05), r.x + r.w - x), h: 28 };
};

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
  /** Parts other than its ends the curve passes behind (connections are drawn under parts). */
  blocked?: string[];
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
export function bezierAt(r: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * r.p0.x + 3 * u * u * t * r.c1.x + 3 * u * t * t * r.c2.x + t * t * t * r.p1.x,
    y: u * u * u * r.p0.y + 3 * u * u * t * r.c1.y + 3 * u * t * t * r.c2.y + t * t * t * r.p1.y,
  };
}

/** The point a fraction `t` of the way along a route's drawn length (labels and badges sit by length). */
export function alongRoute(r: Curve): (t: number) => Point {
  const k = 64;
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

/**
 * Points along a curve that measure what it passes over: both ends, and inner samples shifted off
 * the middle so two mirrored lines never cross exactly on a sample point. The routing's
 * `blocked` and the layout report's `edgesOverParts` both read these, so they always agree.
 */
export const routeSamples = (r: Curve, steps = 64): Point[] =>
  [bezierAt(r, 0), ...Array.from({ length: steps - 1 }, (_, i) => bezierAt(r, (i + 1.31) / steps)), bezierAt(r, 1)];

/** The shortest handle (diagram contract: at least 24 px), with room for the path's rounding to 0.1 px. */
const MIN_HANDLE = 24.1;

/**
 * The parts other than its ends a connection's curve passes behind (diagram contract, "Connections
 * are smooth curves"): a curve is never bent around anything, so this only reports.
 */
function behind(route: Curve, parts: (Rect & { id: string })[]): string[] {
  const pts = routeSamples(route);
  return parts.filter((r) => pts.some((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h)).map((r) => r.id);
}

/**
 * The free spot nearest `mid` for a box of half-size `hw` × `hh` kept `pad` clear of every obstacle
 * (diagram contract: a label or badge takes the free spot nearest the middle of its curve). The nearest
 * point outside a union of boxes is the middle itself, a point on the curve, or where the edges of
 * the boxes, pushed out by the half-size and the pad, meet — so those are the candidates. A spot whose
 * box is further than `reach` from every point of the curve does not count.
 */
export function nearestFree(mid: Point, curve: Point[], hw: number, hh: number, obstacles: Rect[], pad: number, reach = Infinity): Point | null {
  const near = (p: Point) => reach === Infinity || curve.some((c) => Math.hypot(Math.max(0, Math.abs(c.x - p.x) - hw), Math.max(0, Math.abs(c.y - p.y) - hh)) <= reach);
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

/** The middle of a side of a box. */
const sideMid = (r: Rect, s: Side): Point => ({ x: r.x + r.w * (s === "l" ? 0 : s === "r" ? 1 : 0.5), y: r.y + r.h * (s === "t" ? 0 : s === "b" ? 1 : 0.5) });
/** The plain cubic between the middles of two sides, with the usual handles. */
function plainCurve(a: Rect, b: Rect, s: [Side, Side]): Curve {
  const p0 = sideMid(a, s[0]), p1 = sideMid(b, s[1]), c = clamp(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.42, MIN_HANDLE, 160);
  return { p0, p1, c1: { x: p0.x + NORMAL[s[0]][0] * c, y: p0.y + NORMAL[s[0]][1] * c }, c2: { x: p1.x + NORMAL[s[1]][0] * c, y: p1.y + NORMAL[s[1]][1] * c } };
}
/** A curve with no length, or one that goes inside either of its own two parts (it may start on their borders). */
function intoOwn(c: Curve, a: Rect, b: Rect): boolean {
  if (Math.hypot(c.p1.x - c.p0.x, c.p1.y - c.p0.y) < 1) return true;
  const within = (p: Point, r: Rect) => p.x > r.x + 0.5 && p.x < r.x + r.w - 0.5 && p.y > r.y + 0.5 && p.y < r.y + r.h - 0.5;
  return routeSamples(c).some((p) => within(p, a) || within(p, b));
}
const holds = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * The sides a connection uses (diagram contract, Connections): the facing pair (`chooseSides`). A part
 * and a group holding it use the side where the part lies nearest the group's border, at both ends.
 * When the facing pair's curve has no length or goes inside one of its own parts (parts that touch or
 * overlap), the shortest pair of like sides whose curve stays out of both, right first on a tie.
 */
export function sidesFor(a: Rect, b: Rect): [Side, Side] {
  if (holds(a, b) || holds(b, a)) {
    const [inner, outer] = holds(b, a) ? [a, b] : [b, a];
    const gaps: [Side, number][] = [["b", outer.y + outer.h - inner.y - inner.h], ["r", outer.x + outer.w - inner.x - inner.w], ["t", inner.y - outer.y], ["l", inner.x - outer.x]];
    const s = gaps.reduce((p, q) => (q[1] < p[1] ? q : p))[0];
    return [s, s];
  }
  const facing = chooseSides(a, b);
  if (!intoOwn(plainCurve(a, b, facing), a, b)) return facing;
  let best: { s: [Side, Side]; length: number } | null = null;
  for (const x of ["r", "l", "b", "t"] as const) {
    const c = plainCurve(a, b, [x, x]);
    if (intoOwn(c, a, b)) continue;
    const pts = routeSamples(c);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (!best || length < best.length - 1e-9) best = { s: [x, x], length };
  }
  return best?.s ?? facing;
}

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
    const s = sidesFor(a, b);
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
  // In a post, a line straight down (or up) through parts that lie between its ends — hidden behind
  // them — turns out on a side as one cubic, when that side's curve is clear (a portrait post's turn
  // under its side parts). It bulges no further than it needs to, and takes the side that stays inside
  // the parts' extent with its badge, right on a tie.
  const leaves = view.nodes.filter((n) => n.form !== "group");
  const bulge = new Map<string, number>();
  let left = Infinity, right = -Infinity;
  for (const r of rects.values()) { left = Math.min(left, r.x); right = Math.max(right, r.x + r.w); }
  const curveOf = (e: DiagramEdge, s: [Side, Side], c?: number): Point[] => {
    const a = rects.get(e.from)!, b = rects.get(e.to)!, p0 = sideMid(a, s[0]), p1 = sideMid(b, s[1]);
    c ??= clamp(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.42, MIN_HANDLE, 160);
    const curve = { p0, p1, c1: { x: p0.x + NORMAL[s[0]][0] * c, y: p0.y + NORMAL[s[0]][1] * c }, c2: { x: p1.x + NORMAL[s[1]][0] * c, y: p1.y + NORMAL[s[1]][1] * c } } as EdgeRoute;
    return Array.from({ length: 65 }, (_, i) => bezierAt(curve, i / 64));
  };
  const clearCurve = (e: DiagramEdge, s: [Side, Side], c?: number) => {
    const pts = curveOf(e, s, c);
    return !leaves.some((n) => n.id !== e.from && n.id !== e.to && rects.has(n.id) && pts.some((p) => {
      const r = rects.get(n.id)!;
      return p.x > r.x - 8 && p.x < r.x + r.w + 8 && p.y > r.y - 8 && p.y < r.y + r.h + 8;
    }));
  };
  for (const e of view.edges) {
    const s = sides.get(e.id);
    if (!S.post || !s || !((s[0] === "b" && s[1] === "t") || (s[0] === "t" && s[1] === "b")) || clearCurve(e, s)) continue;
    const options = (["r", "l"] as const).flatMap((x) => {
      for (let c = MIN_HANDLE; c <= 160; c = c < 160 && c + 8 > 160 ? 160 : c + 8) if (clearCurve(e, [x, x], c)) {
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
  // What a curve may pass behind: every part (reported, never avoided).
  const parts: (Rect & { id: string })[] = [];
  for (const n of view.nodes) { const r = rects.get(n.id); if (r && n.form !== "group") parts.push({ ...r, id: n.id }); }
  const taken: Rect[] = [];
  const routes = new Map<string, EdgeRoute>();
  for (const e of view.edges) {
    const s = sides.get(e.id);
    const a = pts.get(`${e.id}:0`), b = pts.get(`${e.id}:1`);
    if (!s || !a || !b) continue;
    const n0 = NORMAL[s[0]], n1 = NORMAL[s[1]];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const c = bulge.get(e.id) ?? clamp(dist * 0.42, MIN_HANDLE, 160);
    // Both ends sit on the borders: the arrowhead's tip touches the part it points at.
    const p1 = { ...b }, p0 = { ...a };
    const c1 = { x: a.x + n0[0] * c, y: a.y + n0[1] * c };
    const c2 = { x: p1.x + n1[0] * c, y: p1.y + n1[1] * c };
    const route: EdgeRoute = {
      id: e.id, p0, p1, c1, c2, side0: s[0], side1: s[1],
      d: `M${r1(p0.x)},${r1(p0.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(p1.x)},${r1(p1.y)}`,
      labelAt: null, badgeAt: { x: 0, y: 0 },
    };
    const under = behind(route, parts.filter((r) => r.id !== e.from && r.id !== e.to));
    if (under.length) route.blocked = under;
    const along = alongRoute(route);
    if (e.label && o.labels !== false) {
      // The label takes the free spot nearest the middle of the curve, 4 px clear of parts, names,
      // texts and other labels, its box within 10 px of its curve; with none, it is left out.
      const half = labelWidth(e.label, S.post) / 2, curve = Array.from({ length: 129 }, (_, i) => along(i / 128));
      route.labelAt = nearestFree(along(0.5), curve, half, LABEL.h / 2, [...blocked, ...taken], 4, 10);
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

/** The exact box of a connection's curve: the cubic's ends and the extremes where its slope is 0. */
function curveBounds(r: EdgeRoute): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  add(r.p0.x, r.p0.y); add(r.p1.x, r.p1.y);
  for (const axis of ["x", "y"] as const) {
    // B'(t)/3 = a t² + b t + c for this axis.
    const p0 = r.p0[axis], p1 = r.c1[axis], p2 = r.c2[axis], p3 = r.p1[axis];
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b])
      : (() => { const d = b * b - 4 * a * c; return d < 0 ? [] : [(-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a)]; })();
    for (const t of roots) if (t > 0 && t < 1) { const p = bezierAt(r, t); add(p.x, p.y); }
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

