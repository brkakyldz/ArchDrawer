import { isPostView, type DiagramEdge, type DiagramNode, type DiagramText, type DiagramView, type Kind } from "./model";
import { fitLine, textWidth, wrapText, widthOf, type TextStyle } from "./text";
import { CARD_SHAPE, COMPACT_SHAPE, outlineDepth, shapeGeometry, shapeOf, type PartShape, type Pt } from "./shapes";

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
  /** Always empty: no part draws a row (ADR 0014); the rows are listed in the part's callout. */
  items: string[];
}

export interface MeasureOptions {
  /** The view's sub-line switch (diagram contract, View, Sub-lines). Default true. */
  subLines?: boolean;
  /** The dense post style. Default: whether the view is a post view. */
  post?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ceil = (v: number) => Math.ceil(v);

/** A part's content box: its box less its shape's insets (diagram contract, Content box). */
export function contentBox(n: Pick<DiagramNode, "form"> & { kind?: Kind }, r: Rect, post = false): Rect {
  const shape = shapeOf({ kind: n.kind ?? "service", form: n.form });
  if (shape === "group") return r;
  const [t, rt, b, l] = n.form === "compact" ? COMPACT_SHAPE[shape].insets : CARD_SHAPE[shape][post ? "post" : "plain"];
  return { x: r.x + l, y: r.y + t, w: r.w - l - rt, h: r.h - t - b };
}

/**
 * Size and text of a card, compact or panel (a group's size comes from its children: `layoutRects`).
 * The shape of its kind gives the insets round its content box and any extra width (Content box); a
 * panel measures and draws as a card of its kind, its rows never drawn.
 */
export function measureNode(n: Pick<DiagramNode, "label" | "form" | "sub" | "detail"> & { kind?: Kind }, o: MeasureOptions = {}): NodeBox {
  const { T, CARD } = styleOf(o.post);
  const inside = n.detail ? 8 + INSIDE : 0;
  const subOn = o.subLines !== false;
  const shape = shapeOf({ kind: n.kind ?? "service", form: n.form });
  if (shape !== "group" && n.form !== "compact") {
    const S = CARD_SHAPE[shape], [t, r, b, l] = o.post ? S.post : S.plain;
    // The plain card's width (196; a post card widens up to 204 for its sub-line, inside its shape's insets) plus the shape's extra width.
    const extra = S.extra[o.post ? 1 : 0];
    const base = subOn && n.sub ? clamp(ceil(l + r - extra + widthOf(n.sub, T.sub) + 2), CARD.w, CARD.maxW) : CARD.w;
    const w = base + extra, width = w - l - r;
    const lines = wrapText(n.label, T.title.size, width, 600, CARD.maxLines, T.title.tracking);
    const h = t + (shape === "person" ? 0 : CARD.icon + CARD.iconGap) + CARD.line * lines.length + (subOn ? CARD.subLine : 0) + b;
    return { w, h, lines, sub: subOn && n.sub ? fitLine(n.sub, width, T.sub) : "", items: [] };
  }
  if (shape !== "group") {
    const S = COMPACT_SHAPE[shape], [, r, , l] = S.insets;
    const icon = shape === "person" ? 0 : COMPACT.icon + COMPACT.gap;
    const fixed = l + r + icon + inside;
    const titleW = widthOf(n.label, T.compactTitle);
    const subW = subOn && n.sub ? COMPACT.gap + widthOf(n.sub, T.subMono) : 0;
    const w = clamp(ceil(fixed + titleW + subW + 2), COMPACT.minW, COMPACT.maxW) + S.extra;
    const label = fitLine(n.label, w - fixed, T.compactTitle);
    const room = w - fixed - widthOf(label, T.compactTitle) - COMPACT.gap;
    const sub = subOn && n.sub && room > 24 ? fitLine(n.sub, room, T.subMono) : "";
    return { w, h: S.h, lines: [label], sub, items: [] };
  }
  // group: the header only; layoutRects adds the children.
  const sub = subOn ? n.sub : "";
  const head = GROUP.padHead * 2 + GROUP.icon + GROUP.gap + widthOf(n.label, T.title) + (sub ? GROUP.gap + widthOf(sub, T.sub) : 0) + inside;
  return { w: Math.max(GROUP.emptyW, ceil(head + 2)), h: GROUP.emptyH, lines: [n.label], sub, items: [] };
}

/** Header width a group needs for its own text. */
export function groupHeaderWidth(n: Pick<DiagramNode, "label" | "sub" | "detail">, post = false, subLines = true): number {
  const { T } = styleOf(post);
  const sub = subLines ? n.sub : "";
  return ceil(GROUP.padHead * 2 + GROUP.icon + GROUP.gap + widthOf(n.label, T.title) + (sub ? GROUP.gap + widthOf(sub, T.sub) : 0) + (n.detail ? 8 + INSIDE : 0) + 2);
}

/** The box a group's name is drawn in, at the left of its header: labels and badges keep off it. */
export const groupNameBox = (n: Pick<DiagramNode, "label" | "sub" | "detail">, r: Rect, post = false): Rect =>
  ({ x: r.x, y: r.y, w: Math.min(r.w, groupHeaderWidth(n, post) - GROUP.padHead), h: GROUP.head });

/**
 * Every component's box in a view: cards, compacts and panels from their content at their
 * position; groups from their children's boxes plus padding (bottom-up), or 260×140 when empty.
 */
export function layoutRects(view: Pick<DiagramView, "nodes"> & { id?: string; postOf?: string | null; subLines?: boolean }, o: MeasureOptions = {}): Map<string, Rect> {
  o = { ...o, post: postOf(view, o), subLines: o.subLines ?? view.subLines !== false };
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
      if (!children.length) r = { x: n.x, y: n.y, w: Math.max(GROUP.emptyW, groupHeaderWidth(n, o.post, o.subLines)), h: GROUP.emptyH };
      else {
        const cs = children.map(rectOf);
        const minX = Math.min(...cs.map((c) => c.x)), minY = Math.min(...cs.map((c) => c.y));
        const maxX = Math.max(...cs.map((c) => c.x + c.w)), maxY = Math.max(...cs.map((c) => c.y + c.h));
        const w = Math.max(maxX - minX + GROUP.padX * 2, groupHeaderWidth(n, o.post, o.subLines));
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
  /** The trunk it shares (diagram contract, Trunks): its own curve then ends at the trunk's split point. */
  trunk?: Trunk;
}

/** A trunk (diagram contract, Trunks): one straight stretch from the split point to the port, drawn once for its members. */
export interface Trunk {
  /** `<part id>:<side>`. */
  key: string; part: string; side: Side;
  /** Its members' ids in view order. */
  edges: string[];
  split: Point; port: Point; d: string;
}

/** The trunks of a view's routes, each once, in the order of their first member. */
export function trunksOf(routes: Map<string, EdgeRoute>): Trunk[] {
  const out: Trunk[] = [];
  for (const r of routes.values()) if (r.trunk && !out.includes(r.trunk)) out.push(r.trunk);
  return out;
}

/** The line a connection draws: its own curve, then its trunk's stretch (the layout report measures this). */
export function drawnLine(r: EdgeRoute): Point[] {
  const own = routeSamples(r);
  if (!r.trunk) return own;
  const { split, port } = r.trunk;
  return [...own, ...Array.from({ length: 8 }, (_, i) => ({ x: split.x + (port.x - split.x) * (i + 1) / 8, y: split.y + (port.y - split.y) * (i + 1) / 8 }))];
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
 * The parts each drawn connection passes behind (layout report `edgesOverParts`; diagram contract, Traces): a part
 * that is not a group and not one of its ends, holding a point of its curve. Groups' boundaries never count.
 */
export function edgesOverParts(view: Pick<DiagramView, "nodes" | "edges">, rects: Map<string, Rect>, routes: Map<string, EdgeRoute>): { edge: string; node: string }[] {
  const out: { edge: string; node: string }[] = [];
  const within = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  for (const e of view.edges) {
    const route = routes.get(e.id);
    if (!route) continue;
    const pts = drawnLine(route);
    for (const n of view.nodes) {
      if (n.form === "group" || n.id === e.from || n.id === e.to) continue;
      const r = rects.get(n.id);
      if (r && pts.some((p) => within(p, r))) out.push({ edge: e.id, node: n.id });
    }
  }
  return out;
}

/** The part of a cubic curve between `a` and `b` (0 ≤ a < b ≤ 1), as a cubic of its own (de Casteljau). */
function subCurve(c: Curve, a: number, b: number): Curve {
  const lerp = (p: Point, q: Point, t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const split = (k: Curve, t: number): [Curve, Curve] => {
    const ab = lerp(k.p0, k.c1, t), bc = lerp(k.c1, k.c2, t), cd = lerp(k.c2, k.p1, t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), mid = lerp(abc, bcd, t);
    return [{ p0: k.p0, c1: ab, c2: abc, p1: mid }, { p0: mid, c1: bcd, c2: cd, p1: k.p1 }];
  };
  const left = split(c, b)[0];
  return b > 0 && a > 0 ? split(left, a / b)[1] : left;
}

/**
 * The pieces of a curve inside a box, as path data: the same curve, cut where it crosses the box's edges. The
 * editor draws a part's traces with it, so the part's element measures as the part (a clipped whole path would not).
 */
export function curveInside(c: Curve, r: Rect, steps = 96): string {
  return curvePieces(c, r, steps).d;
}

/**
 * `curveInside` with the length of the curve before its first piece: as a dash offset, the piece's dashes fall where
 * the whole line's do (a path's dashes start again at each piece, so only the first is matched; a line rarely
 * enters a box twice).
 */
export function curvePieces(c: Curve, r: Rect, steps = 96): { d: string; offset: number } {
  const inside = (t: number) => { const p = bezierAt(c, t); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; };
  // Where the inside changes between two samples, the edge is found by halving the step.
  const edge = (lo: number, hi: number, inAtLo: boolean) => {
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inside(mid) === inAtLo) lo = mid; else hi = mid; }
    return inAtLo ? lo : hi;
  };
  const spans: [number, number][] = [];
  let start = inside(0) ? 0 : -1;
  for (let i = 1; i <= steps; i++) {
    const t0 = (i - 1) / steps, t1 = i / steps, now = inside(t1);
    if (start < 0 && now) start = edge(t0, t1, false);
    else if (start >= 0 && !now) { spans.push([start, edge(t0, t1, true)]); start = -1; }
  }
  if (start >= 0) spans.push([start, 1]);
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const kept = spans.filter(([a, b]) => b > a);
  const d = kept.map(([a, b]) => {
    const k = subCurve(c, a, b);
    return `M${f(k.p0.x)},${f(k.p0.y)} C${f(k.c1.x)},${f(k.c1.y)} ${f(k.c2.x)},${f(k.c2.y)} ${f(k.p1.x)},${f(k.p1.y)}`;
  }).join(" ");
  // The length up to the first piece, measured along the curve in small steps.
  const upTo = kept[0]?.[0] ?? 0;
  let offset = 0, last = bezierAt(c, 0);
  const n = Math.max(1, Math.ceil(upTo * 512));
  for (let i = 1; i <= n; i++) { const p = bezierAt(c, (upTo * i) / n); offset += Math.hypot(p.x - last.x, p.y - last.y); last = p; }
  return { d, offset: Math.round(offset * 100) / 100 };
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
export function nearestFree(mid: Point, curve: Point[], hw: number, hh: number, obstacles: Rect[], pad: number, reach = Infinity, prefer?: (p: Point) => boolean): Point | null {
  const near = (p: Point) => reach === Infinity || curve.some((c) => Math.hypot(Math.max(0, Math.abs(c.x - p.x) - hw), Math.max(0, Math.abs(c.y - p.y) - hh)) <= reach);
  const fits = (p: Point) => near(p) && obstacles.every((r) => p.x + hw + pad <= r.x || p.x - hw - pad >= r.x + r.w || p.y + hh + pad <= r.y || p.y - hh - pad >= r.y + r.h);
  let best: Point | null = null, bestD = Infinity;
  // With `prefer`, the nearest free spot it accepts wins over a nearer one it does not (a label off other lines).
  let liked: Point | null = null, likedD = Infinity;
  const consider = (p: Point) => {
    const q = { x: Math.round(p.x), y: Math.round(p.y) }, d = Math.hypot(q.x - mid.x, q.y - mid.y);
    if (prefer && d < likedD - 1e-9 && fits(q) && prefer(q)) { liked = q; likedD = d; }
    if (d < bestD - 1e-9 && fits(q)) { best = q; bestD = d; }
  };
  consider(mid);
  for (const p of curve) consider(p);
  if (prefer) {
    // Spots beside the curve, as far as the reach lets a box go, so a label can step off a crossing line.
    for (const p of curve) for (const [dx, dy] of [[0, hh + 2], [0, -hh - 2], [0, hh + 8], [0, -hh - 8], [hw + 2, 0], [-hw - 2, 0], [hw + 8, 0], [-hw - 8, 0]]) consider({ x: p.x + dx, y: p.y + dy });
  }
  // Edges near the middle first; all of them only when nothing near is free.
  for (const radius of [480, Infinity]) {
    const near = obstacles.filter((r) => Math.max(r.x - mid.x, mid.x - r.x - r.w, r.y - mid.y, mid.y - r.y - r.h) <= radius);
    const xs = [mid.x, ...near.flatMap((r) => [Math.floor(r.x - pad - hw), Math.ceil(r.x + r.w + pad + hw)])];
    const ys = [mid.y, ...near.flatMap((r) => [Math.floor(r.y - pad - hh), Math.ceil(r.y + r.h + pad + hh)])];
    for (const x of xs) for (const y of ys) if (Math.hypot(x - mid.x, y - mid.y) < (prefer ? likedD : bestD)) consider({ x, y });
    if (prefer ? liked : best) break;
  }
  return liked ?? best;
}

/** Whether a polyline touches a box: a point inside it or a segment crossing one of its edges. */
export function polylineMeetsRect(pts: Point[], r: Rect): boolean {
  const inside = (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (pts.some(inside)) return true;
  const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  for (let i = 1; i < pts.length; i++) for (let k = 0; k < 4; k++) if (segmentsCross(pts[i - 1], pts[i], corners[k], corners[(k + 1) % 4])) return true;
  return false;
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
 * A handle's length: 0.42 × the distance between the ends, 24–160 px, and between sides that face
 * each other across a gap never longer than that gap or 8 px (diagram contract, Short gaps).
 */
function handle(p0: Point, p1: Point, s: [Side, Side]): number {
  const c = clamp(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.42, MIN_HANDLE, 160);
  const gap = (p1.x - p0.x) * NORMAL[s[0]][0] + (p1.y - p0.y) * NORMAL[s[0]][1];
  return opposite(s) && gap > 0 ? Math.min(c, Math.max(gap, 8)) : c;
}

/** The middle of a side of a box. */
const sideMid = (r: Rect, s: Side): Point => ({ x: r.x + r.w * (s === "l" ? 0 : s === "r" ? 1 : 0.5), y: r.y + r.h * (s === "t" ? 0 : s === "b" ? 1 : 0.5) });
/** The plain cubic between the middles of two sides, with the usual handles. */
function plainCurve(a: Rect, b: Rect, s: [Side, Side]): Curve {
  const p0 = sideMid(a, s[0]), p1 = sideMid(b, s[1]), c = handle(p0, p1, s);
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
  return sidesOf(a, b).s;
}

/** `sidesFor`, and whether the sides are the facing pair, free to move to a cheaper facing side. */
function sidesOf(a: Rect, b: Rect): { s: [Side, Side]; free: boolean } {
  if (holds(a, b) || holds(b, a)) {
    const [inner, outer] = holds(b, a) ? [a, b] : [b, a];
    const gaps: [Side, number][] = [["b", outer.y + outer.h - inner.y - inner.h], ["r", outer.x + outer.w - inner.x - inner.w], ["t", inner.y - outer.y], ["l", inner.x - outer.x]];
    const s = gaps.reduce((p, q) => (q[1] < p[1] ? q : p))[0];
    return { s: [s, s], free: false };
  }
  const facing = chooseSides(a, b);
  if (!intoOwn(plainCurve(a, b, facing), a, b)) return { s: facing, free: true };
  let best: { s: [Side, Side]; length: number } | null = null;
  for (const x of ["r", "l", "b", "t"] as const) {
    const c = plainCurve(a, b, [x, x]);
    if (intoOwn(c, a, b)) continue;
    const pts = routeSamples(c);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (!best || length < best.length - 1e-9) best = { s: [x, x], length };
  }
  return { s: best?.s ?? facing, free: false };
}

/** The extra cost of a side for each end of another connection it holds (diagram contract, Sides). */
export const SIDE_LOAD = 0.25;
const SIDES: Side[] = ["r", "b", "l", "t"];

/** The sides of `a` whose outward normal points towards the centre of `b` (a positive dot product). */
export function facingSides(a: Rect, b: Rect): Side[] {
  const ca = centre(a), cb = centre(b), v = { x: cb.x - ca.x, y: cb.y - ca.y };
  return SIDES.filter((s) => NORMAL[s][0] * v.x + NORMAL[s][1] * v.y > 1e-9);
}

/** A side's cost towards `b`: `1 − cos θ` of its normal against the centres' vector, plus `SIDE_LOAD` per end it holds. */
export function sideCost(a: Rect, b: Rect, s: Side, load = 0): number {
  const ca = centre(a), cb = centre(b), v = { x: cb.x - ca.x, y: cb.y - ca.y }, len = Math.hypot(v.x, v.y);
  const cos = len ? (NORMAL[s][0] * v.x + NORMAL[s][1] * v.y) / len : 0;
  return 1 - cos + SIDE_LOAD * load;
}

/** A connection whose sides are the facing pair, free to move each end to a cheaper facing side. */
interface FreeSides { id: string; from: string; to: string; s: [Side, Side] }

/**
 * Each end of each free connection takes its part's cheapest facing side, in view order, counting the
 * ends the other connections hold at that moment; one pass; a tie (within 0.001) keeps the facing
 * pair's side (diagram contract, Sides). Stateless: one view, one answer. `load` holds every end's
 * side (`<part id>:<side>` → count) and is kept up to date.
 */
function cheapestSides(list: FreeSides[], rects: Map<string, Rect>, load: Map<string, number>): void {
  const count = (k: string) => load.get(k) ?? 0;
  for (const c of list) {
    for (const end of [0, 1] as const) {
      const me = end === 0 ? c.from : c.to, other = end === 0 ? c.to : c.from;
      const a = rects.get(me)!, b = rects.get(other)!, cur = c.s[end];
      let best = cur, bestCost = sideCost(a, b, cur, count(`${me}:${cur}`) - 1);
      for (const s of facingSides(a, b)) {
        if (s === cur) continue;
        // A side whose curve would go inside one of the connection's own parts is no option.
        const pair: [Side, Side] = end === 0 ? [s, c.s[1]] : [c.s[0], s];
        const [from, to] = [rects.get(c.from)!, rects.get(c.to)!];
        if (intoOwn(plainCurve(from, to, pair), from, to)) continue;
        const cost = sideCost(a, b, s, count(`${me}:${s}`));
        if (cost < bestCost - 0.001) { best = s; bestCost = cost; }
      }
      if (best === cur) continue;
      load.set(`${me}:${cur}`, count(`${me}:${cur}`) - 1);
      load.set(`${me}:${best}`, count(`${me}:${best}`) + 1);
      c.s[end] = best;
    }
  }
}

/** Two sides that face each other: a right and a left, or a bottom and a top. */
const opposite = (s: [Side, Side]) => NORMAL[s[0]][0] === -NORMAL[s[1]][0] && NORMAL[s[0]][1] === -NORMAL[s[1]][1];

/**
 * Curves for every connection whose ends are drawn. Connections on one side of a component are
 * spread up to 16 px apart, ordered by where the other end is, so lines never stack.
 */
export function routeEdges(view: Pick<DiagramView, "nodes" | "edges"> & { id?: string; postOf?: string | null }, rects: Map<string, Rect>, o: RouteOptions = {}): Map<string, EdgeRoute> {
  const S = styleOf(postOf(view, o));
  type End = { e: DiagramEdge; end: 0 | 1; id: string; side: Side; other: Point };
  const ends: End[] = [];
  const sides = new Map<string, [Side, Side]>();
  // Every connection first takes its facing pair; then each free one moves an end to a cheaper facing side.
  const load = new Map<string, number>(), free: FreeSides[] = [];
  for (const e of view.edges) {
    const a = rects.get(e.from), b = rects.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    const { s, free: movable } = sidesOf(a, b);
    sides.set(e.id, s);
    for (const k of [`${e.from}:${s[0]}`, `${e.to}:${s[1]}`]) load.set(k, (load.get(k) ?? 0) + 1);
    if (movable) free.push({ id: e.id, from: e.from, to: e.to, s });
  }
  cheapestSides(free, rects, load);
  for (const e of view.edges) {
    const s = sides.get(e.id);
    if (s) ends.push({ e, end: 0, id: e.from, side: s[0], other: centre(rects.get(e.to)!) }, { e, end: 1, id: e.to, side: s[1], other: centre(rects.get(e.from)!) });
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
    c ??= handle(p0, p1, s);
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
  // Each part's outline (diagram contract, Shapes): ends attach to it, not to the box.
  const outlines = new Map<string, { shape: PartShape; loops: Pt[][] }>();
  for (const n of view.nodes) {
    const r = rects.get(n.id), shape = shapeOf(n);
    if (r && shape !== "group") outlines.set(n.id, { shape, loops: shapeGeometry(shape, n.form === "compact", S.post, r).loops });
  }
  const groups = new Map<string, End[]>();
  for (const p of ends) { const k = `${p.id}:${p.side}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  // Trunks (diagram contract, Trunks): `to` ends on one side of one part, of one style, coming from one direction —
  // a run of angles at most 30° apart, taken greedily from the smallest — are one end of the side.
  const order = new Map(view.edges.map((e, i) => [e.id, i]));
  const trunkEnds = new Map<End, End[]>();
  for (const [k, list] of groups) {
    const r = rects.get(list[0].id)!, side = list[0].side, mid = sideMid(r, side), [nx, ny] = NORMAL[side];
    const angle = (p: End) => { const vx = p.other.x - mid.x, vy = p.other.y - mid.y; return Math.atan2(nx * vy - ny * vx, nx * vx + ny * vy); };
    const byStyle = new Map<string, End[]>();
    for (const p of list) if (p.end === 1) (byStyle.get(p.e.style) ?? byStyle.set(p.e.style, []).get(p.e.style)!).push(p);
    for (const same of byStyle.values()) {
      const sorted = same.map((p) => ({ p, a: angle(p) })).sort((x, y) => x.a - y.a || x.p.e.id.localeCompare(y.p.e.id));
      for (let i = 0; i < sorted.length;) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1].a - sorted[i].a <= Math.PI / 6 + 1e-9) j++;
        if (j > i) {
          const members = sorted.slice(i, j + 1).map((x) => x.p).sort((x, y) => order.get(x.e.id)! - order.get(y.e.id)!);
          // One end of its side, ordered among the others by the mean position of its members' other ends.
          const rep: End = { ...members[0], other: { x: members.reduce((s, m) => s + m.other.x, 0) / members.length, y: members.reduce((s, m) => s + m.other.y, 0) / members.length } };
          trunkEnds.set(rep, members);
          groups.set(k, [...groups.get(k)!.filter((p) => !members.includes(p)), rep]);
        }
        i = j + 1;
      }
    }
  }
  const pts = new Map<string, Point>();
  for (const list of groups.values()) {
    const vert = list[0].side === "l" || list[0].side === "r";
    list.sort((p, q) => (vert ? p.other.y - q.other.y : p.other.x - q.other.x) || p.e.id.localeCompare(q.e.id) || p.end - q.end);
    const r = rects.get(list[0].id)!;
    const span = (vert ? r.h : r.w) * 0.6;
    // On the left and right sides of an API's port every end attaches at the point: those ends are not spread.
    const atPoint = vert && outlines.get(list[0].id)?.shape === "port";
    let step = list.length > 1 && !atPoint ? Math.min(16, span / (list.length - 1)) : 0;
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
      const at = { x: Math.round(P[p.side].x), y: Math.round(P[p.side].y) };
      // Where the outline lies inside the box, the end moves straight in along its side's normal to meet it.
      const ol = outlines.get(p.id), depth = ol && !atPoint ? outlineDepth(ol.loops, r, p.side, at) : 0;
      const point = depth > 0.05 ? { x: r1(at.x - NORMAL[p.side][0] * depth), y: r1(at.y - NORMAL[p.side][1] * depth) } : at;
      for (const m of trunkEnds.get(p) ?? [p]) pts.set(`${m.e.id}:${m.end}`, point);
    });
  }
  // Each trunk's split point: 32 px (post 24) out from the port along the side's normal, or a third of the shortest
  // distance from the port to a member's start when that is less. The trunk is one straight cubic from there in.
  const trunkOf = new Map<string, Trunk>();
  for (const members of trunkEnds.values()) {
    const port = pts.get(`${members[0].e.id}:1`)!, side = members[0].side, [nx, ny] = NORMAL[side];
    const near = Math.min(...members.map((m) => { const a = pts.get(`${m.e.id}:0`)!; return Math.hypot(a.x - port.x, a.y - port.y); }));
    const out = Math.min(S.post ? 24 : 32, near / 3);
    const split = { x: r1(port.x + nx * out), y: r1(port.y + ny * out) };
    const third = (t: number) => `${r1(split.x + (port.x - split.x) * t)},${r1(split.y + (port.y - split.y) * t)}`;
    const trunk: Trunk = {
      key: `${members[0].id}:${side}`, part: members[0].id, side, edges: members.map((m) => m.e.id), split, port,
      d: `M${r1(split.x)},${r1(split.y)} C${third(1 / 3)} ${third(2 / 3)} ${r1(port.x)},${r1(port.y)}`,
    };
    for (const m of members) trunkOf.set(m.e.id, trunk);
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
    const trunk = trunkOf.get(e.id);
    // A member of a trunk runs from its start to the split point, its handle there along the side's normal.
    const a = pts.get(`${e.id}:0`), b = trunk ? trunk.split : pts.get(`${e.id}:1`);
    if (!s || !a || !b) continue;
    const n0 = NORMAL[s[0]], n1 = NORMAL[s[1]];
    const c = bulge.get(e.id) ?? handle(a, b, s);
    // Both ends sit on the borders: the arrowhead's tip touches the part it points at.
    const p1 = { ...b }, p0 = { ...a };
    const c1 = { x: a.x + n0[0] * c, y: a.y + n0[1] * c };
    const c2 = { x: p1.x + n1[0] * c, y: p1.y + n1[1] * c };
    const route: EdgeRoute = {
      id: e.id, p0, p1, c1, c2, side0: s[0], side1: s[1],
      d: `M${r1(p0.x)},${r1(p0.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(p1.x)},${r1(p1.y)}`,
      labelAt: null, badgeAt: { x: 0, y: 0 }, ...(trunk ? { trunk } : {}),
    };
    const under = behind(route, parts.filter((r) => r.id !== e.from && r.id !== e.to));
    if (under.length) route.blocked = under;
    routes.set(e.id, route);
  }
  // Labels once every route is known (diagram contract, Labels): the free spot nearest the middle of the curve,
  // 4 px clear of parts, names, texts and other labels, its box within 10 px of its curve; among those, the nearest
  // whose box, grown by 2 px, touches no other drawn connection's line or trunk, when there is one; with none free,
  // it is left out.
  const drawn = new Map([...routes].map(([id, r]) => [id, drawnLine(r)]));
  for (const e of view.edges) {
    const route = routes.get(e.id);
    if (!route || !e.label || o.labels === false) continue;
    const along = alongRoute(route);
    const half = labelWidth(e.label, S.post) / 2, hh = LABEL.h / 2, curve = Array.from({ length: 129 }, (_, i) => along(i / 128));
    const others = [...drawn].filter(([id]) => id !== e.id).map(([, pts]) => pts);
    const clearOfLines = (p: Point) => { const box = { x: p.x - half - 2, y: p.y - hh - 2, w: half * 2 + 4, h: hh * 2 + 4 }; return !others.some((pts) => polylineMeetsRect(pts, box)); };
    route.labelAt = nearestFree(along(0.5), curve, half, hh, [...blocked, ...taken], 4, 10, clearOfLines);
    // Its drawn box: later labels keep their 4 px from it, badges only stay off it.
    if (route.labelAt) taken.push({ x: route.labelAt.x - half, y: route.labelAt.y - hh, w: half * 2, h: LABEL.h });
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

/** Proper crossing of two segments: touching, sharing an end or running along each other is not one. */
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) => {
  const turn = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
};

/**
 * Pairs of drawn connections without a shared end whose curves cross, measured on the same samples
 * the layout report reads (api contract, Layout report): the report and the layout count alike.
 */
export function countCrossings(edges: readonly Pick<DiagramEdge, "id" | "from" | "to">[], routes: Map<string, EdgeRoute>): number {
  const drawn = edges.filter((e) => routes.has(e.id));
  const lines = new Map(drawn.map((e) => [e.id, drawnLine(routes.get(e.id)!)]));
  let crossings = 0;
  for (let i = 0; i < drawn.length; i++) for (const b of drawn.slice(i + 1)) {
    const a = drawn[i];
    if ([a.from, a.to].some((id) => id === b.from || id === b.to)) continue;
    const pa = lines.get(a.id)!, pb = lines.get(b.id)!;
    if (pa.slice(1).some((p, s) => pb.slice(1).some((q, t) => segmentsCross(pa[s], p, pb[t], q)))) crossings++;
  }
  return crossings;
}

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

