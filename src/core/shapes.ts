import type { Kind } from "./model";

/**
 * An outline per kind (diagram contract, Geometry, Shapes and Content box; ADR 0014). Pure: the
 * editor, every export and the routing (an end moves in to meet the outline) read these numbers.
 */

export type PartShape = "card" | "person" | "window" | "port" | "stack" | "agent" | "external" | "pulse" | "check" | "store";
export type Shape = PartShape | "group";
export const PART_SHAPES: readonly PartShape[] = ["person", "window", "port", "card", "stack", "agent", "external", "pulse", "check", "store"];
export const SHAPE_OF_KIND: Record<Kind, PartShape> = {
  actor: "person", client: "window", api: "port", service: "card", worker: "stack", llm: "agent", external: "external", ops: "pulse", gate: "check", data: "store",
};
/** The kind alone gives the outline; a panel takes its kind's as a card does; a group is `group`. */
export function shapeOf(n: { kind: Kind; form: string }): Shape {
  return n.form === "group" ? "group" : SHAPE_OF_KIND[n.kind] ?? "card";
}

/** Insets: top, right, bottom, left. */
export type Insets = readonly [number, number, number, number];
export const CARD_SHAPE: Record<PartShape, { plain: Insets; post: Insets; extra: readonly [number, number] }> = {
  card: { plain: [19, 12, 19, 12], post: [6, 12, 6, 12], extra: [0, 0] },
  person: { plain: [48, 12, 24, 12], post: [42, 12, 6, 12], extra: [0, 0] },
  window: { plain: [19, 12, 19, 12], post: [14, 12, 6, 12], extra: [0, 0] },
  port: { plain: [19, 26, 19, 26], post: [6, 24, 6, 24], extra: [28, 24] },
  stack: { plain: [27, 20, 19, 12], post: [14, 20, 6, 12], extra: [8, 8] },
  agent: { plain: [19, 12, 19, 12], post: [6, 12, 6, 12], extra: [0, 0] },
  external: { plain: [29, 12, 19, 12], post: [14, 12, 6, 12], extra: [0, 0] },
  pulse: { plain: [19, 12, 19, 12], post: [6, 12, 16, 12], extra: [0, 0] },
  check: { plain: [19, 12, 37, 12], post: [6, 12, 20, 12], extra: [0, 0] },
  store: { plain: [27, 15, 27, 15], post: [12, 15, 12, 15], extra: [0, 0] },
};
export const COMPACT_SHAPE: Record<PartShape, { h: number; insets: Insets; extra: number }> = {
  card: { h: 46, insets: [0, 12, 0, 12], extra: 0 },
  person: { h: 46, insets: [0, 12, 0, 54], extra: 0 },
  window: { h: 46, insets: [6, 12, 0, 12], extra: 0 },
  port: { h: 46, insets: [0, 22, 0, 22], extra: 20 },
  stack: { h: 52, insets: [6, 18, 0, 12], extra: 6 },
  agent: { h: 46, insets: [0, 12, 0, 12], extra: 0 },
  external: { h: 52, insets: [6, 12, 0, 12], extra: 0 },
  pulse: { h: 46, insets: [0, 12, 8, 12], extra: 0 },
  check: { h: 54, insets: [0, 12, 8, 12], extra: 0 },
  store: { h: 54, insets: [8, 12, 4, 12], extra: 0 },
};

/** The measures the outlines are drawn with (diagram contract, Shapes; post style in the second value). */
export const OUTLINE = {
  rad: 12,
  avatar: [40, 36] as const, avatarIcon: [22, 20] as const, compactAvatarIcon: 18,
  titleBar: [14, 10] as const, compactTitleBar: 6, dotR: 2, dotGap: 6, dotLeft: 10, capsuleH: 6, capsuleW: 0.4,
  portDepth: [14, 12] as const, compactPortDepth: 10, portDot: 3, compactPortDot: 2.5,
  stack: { card: [8, 4] as const, compact: [6, 3] as const },
  agentInset: 4, compactAgentInset: 3, spark: 10, sparkIn: 8, compactSpark: 8, compactSparkIn: 4,
  cloud: [10, 8] as const, compactCloud: 6,
  shieldSide: [18, 14] as const, compactShieldSide: 8,
  lidRy: [8, 6] as const, compactLidRy: 4, notch: 3,
};

export interface Box { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

const n = (v: number) => String(Math.round(v * 100) / 100);

/** An SVG path and the polylines it traces (closed loops), so routing and drawing share one outline. */
class Path {
  d: string[] = [];
  loops: Pt[][] = [];
  private cur: Pt = { x: 0, y: 0 };
  private loop: Pt[] = [];
  move(x: number, y: number) { if (this.loop.length) this.loops.push(this.loop); this.loop = [{ x, y }]; this.cur = { x, y }; this.d.push(`M${n(x)},${n(y)}`); return this; }
  line(x: number, y: number) { this.loop.push({ x, y }); this.cur = { x, y }; this.d.push(`L${n(x)},${n(y)}`); return this; }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const p0 = this.cur;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      this.loop.push({ x: u * u * u * p0.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, y: u * u * u * p0.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y });
    }
    this.cur = { x, y }; this.d.push(`C${n(x1)},${n(y1)} ${n(x2)},${n(y2)} ${n(x)},${n(y)}`); return this;
  }
  /** An elliptical arc round (cx, cy) from angle a0 to a1 (radians, y down; positive turns clockwise on screen). */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
    const steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 24)));
    for (let i = 1; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; this.loop.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }); }
    const x = cx + rx * Math.cos(a1), y = cy + ry * Math.sin(a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
    this.cur = { x, y }; this.d.push(`A${n(rx)},${n(ry)} 0 ${large} ${sweep} ${n(x)},${n(y)}`); return this;
  }
  close() { this.d.push("Z"); if (this.loop.length) { this.loop.push(this.loop[0]); this.loops.push(this.loop); } this.loop = []; return this; }
  get path() { return this.d.join(" "); }
}

const Q = Math.PI / 2;
/** A rounded rectangle, clockwise from the top-left corner's end. */
function rounded(p: Path, r: Box, rad: number): Path {
  const { x, y, w, h } = r, k = Math.max(0, Math.min(rad, w / 2, h / 2));
  return p.move(x + k, y).line(x + w - k, y).arc(x + w - k, y + k, k, k, -Q, 0).line(x + w, y + h - k).arc(x + w - k, y + h - k, k, k, 0, Q)
    .line(x + k, y + h).arc(x + k, y + h - k, k, k, Q, 2 * Q).line(x, y + k).arc(x + k, y + k, k, k, 2 * Q, 3 * Q).close();
}

export interface ShapeGeometry {
  /** The outline (class `body`): every point lies inside the part's box. */
  d: string;
  /** Outlines drawn behind the body (the stack's two cards). */
  back: string[];
  /** Every outline as closed polylines: an end moves in along its side's normal until it meets one. */
  loops: Pt[][];
  /** The front body, where the open mark and the agent's spark sit. */
  front: Box;
}

/** The outline of a part of `shape` in its box `r` (card or compact, plain or post style). */
export function shapeGeometry(shape: PartShape, compact: boolean, post: boolean, r: Box): ShapeGeometry {
  const { x, y, w, h } = r, R = OUTLINE.rad, s = post ? 1 : 0;
  const p = new Path();
  switch (shape) {
    case "person": {
      if (compact) {
        // The left end is a circle as tall as the part; the body runs right from its centre.
        const c = h / 2, k = Math.min(R, h / 2);
        p.move(x + c, y).line(x + w - k, y).arc(x + w - k, y + k, k, k, -Q, 0).line(x + w, y + h - k).arc(x + w - k, y + h - k, k, k, 0, Q)
          .line(x + c, y + h).arc(x + c, y + c, c, c, Q, 3 * Q).close();
        return { d: p.path, back: [], loops: p.loops, front: { x: x + c, y, w: w - c, h } };
      }
      // A round avatar on the top edge; the body's top edge passes through its centre.
      const a = OUTLINE.avatar[s] / 2, cx = x + w / 2, top = y + a, k = Math.min(R, (h - a) / 2);
      p.move(x + k, top).line(cx - a, top).arc(cx, top, a, a, Math.PI, 2 * Math.PI).line(x + w - k, top).arc(x + w - k, top + k, k, k, -Q, 0)
        .line(x + w, y + h - k).arc(x + w - k, y + h - k, k, k, 0, Q).line(x + k, y + h).arc(x + k, y + h - k, k, k, Q, 2 * Q).line(x, top + k).arc(x + k, top + k, k, k, 2 * Q, 3 * Q).close();
      return { d: p.path, back: [], loops: p.loops, front: { x, y: top, w, h: h - a } };
    }
    case "port": {
      const dep = compact ? OUTLINE.compactPortDepth : OUTLINE.portDepth[s];
      p.move(x + dep, y).line(x + w - dep, y).line(x + w, y + h / 2).line(x + w - dep, y + h).line(x + dep, y + h).line(x, y + h / 2).close();
      return { d: p.path, back: [], loops: p.loops, front: { x: x + dep, y, w: w - 2 * dep, h } };
    }
    case "stack": {
      // The front card is the box less the offset at the top and right; two outlines behind, each a step right and up.
      const [off, step] = compact ? OUTLINE.stack.compact : OUTLINE.stack.card;
      const front = { x, y: y + off, w: w - off, h: h - off };
      const backs = [2, 1].map((i) => rounded(new Path(), { x: x + step * i, y: y + off - step * i, w: w - off, h: h - off }, R));
      rounded(p, front, R);
      return { d: p.path, back: backs.map((b) => b.path), loops: [...p.loops, ...backs.flatMap((b) => b.loops)], front };
    }
    case "external": {
      // Three cloud bumps make the top edge; the rest is the rounded rectangle.
      const bh = compact ? OUTLINE.compactCloud : OUTLINE.cloud[s], k = Math.min(R, (h - bh) / 2), third = w / 3;
      p.move(x, y + bh);
      for (let i = 0; i < 3; i++) p.arc(x + third * (i + 0.5), y + bh, third / 2, bh, Math.PI, 2 * Math.PI);
      p.line(x + w, y + h - k).arc(x + w - k, y + h - k, k, k, 0, Q).line(x + k, y + h).arc(x + k, y + h - k, k, k, Q, 2 * Q).close();
      return { d: p.path, back: [], loops: p.loops, front: { x, y: y + bh, w, h: h - bh } };
    }
    case "check": {
      // A shield: a flat top with rounded corners, straight sides, a bottom curving from both sides to a point.
      const side = compact ? OUTLINE.compactShieldSide : OUTLINE.shieldSide[s], k = Math.min(R, (h - side) / 2), mx = x + w / 2, yb = y + h;
      p.move(x + k, y).line(x + w - k, y).arc(x + w - k, y + k, k, k, -Q, 0).line(x + w, yb - side)
        .cubic(x + w, yb - side * 0.45, mx + w * 0.22, yb - side * 0.12, mx, yb)
        .cubic(mx - w * 0.22, yb - side * 0.12, x, yb - side * 0.45, x, yb - side)
        .line(x, y + k).arc(x + k, y + k, k, k, 2 * Q, 3 * Q).close();
      return { d: p.path, back: [], loops: p.loops, front: { x, y, w, h: h - side } };
    }
    case "store": {
      // A cylinder: the lid's upper half, sides notched at every slab boundary, the bottom a lower half ellipse.
      const ry = compact ? OUTLINE.compactLidRy : OUTLINE.lidRy[s], rx = w / 2, cx = x + rx, nt = OUTLINE.notch;
      const slabs = compact ? 2 : 3, sh = (h - 2 * ry) / slabs;
      const bounds = Array.from({ length: slabs - 1 }, (_, i) => y + ry + sh * (i + 1));
      p.move(x, y + ry).arc(cx, y + ry, rx, ry, Math.PI, 2 * Math.PI);
      for (const b of bounds) p.line(x + w, b - nt).line(x + w - nt, b).line(x + w, b + nt);
      p.line(x + w, y + h - ry).arc(cx, y + h - ry, rx, ry, 0, Math.PI);
      for (const b of [...bounds].reverse()) p.line(x, b + nt).line(x + nt, b).line(x, b - nt);
      p.close();
      return { d: p.path, back: [], loops: p.loops, front: { x, y: y + 2 * ry, w, h: h - 2 * ry } };
    }
    default:
      // card, window, agent, pulse: the rounded rectangle.
      rounded(p, r, R);
      return { d: p.path, back: [], loops: p.loops, front: r };
  }
}

/**
 * How far in from the box an end at `at` on side `side` meets the outline: the end moves straight in
 * along its side's normal by this much, so the arrowhead touches the part (diagram contract, Shapes).
 */
export function outlineDepth(loops: Pt[][], r: Box, side: "t" | "r" | "b" | "l", at: Pt): number {
  const dir = side === "t" ? { x: 0, y: 1 } : side === "b" ? { x: 0, y: -1 } : side === "l" ? { x: 1, y: 0 } : { x: -1, y: 0 };
  const limit = side === "t" || side === "b" ? r.h / 2 : r.w / 2;
  let best = Infinity;
  for (const loop of loops) for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1], b = loop[i];
    // Solve at + t·dir = a + u·(b − a), 0 ≤ u ≤ 1, t ≥ 0.
    const ex = b.x - a.x, ey = b.y - a.y, den = dir.x * -ey + dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const qx = a.x - at.x, qy = a.y - at.y;
    const t = (qx * -ey + qy * ex) / den, u = (dir.x * qy - dir.y * qx) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9 && t >= -1e-6 && t < best) best = t;
  }
  return best === Infinity ? 0 : Math.max(0, Math.min(limit, best));
}
