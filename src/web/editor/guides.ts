/**
 * Guides and snapping while dragging (ui contract, Dragging: Guides and snapping; EDIT-5). Pure: given the dragged
 * components' box where the pointer puts it, the boxes of the other components and the zoom, where the box snaps to
 * and which marks show. Within 6 screen px it snaps to the nearest line of another box (left, centre, right; top,
 * middle, bottom), or so the gaps to its two neighbours in a row (a column) are equal — the nearer wins, a line on a
 * tie; in an axis with no snap the box's position snaps to the 8 px grid. Positions come out in whole pixels.
 */
import type { Rect } from "../../core/geometry";

export const SNAP_PX = 6;
export const GRID = 8;

/** A guide line: `x` a vertical line at `at`, `y` a horizontal one, drawn from `from` to `to` across the other axis. */
export interface Guide { axis: "x" | "y"; at: number; from: number; to: number }
/** One equal gap: `axis` `x` in a row, `y` in a column; from `start` to `start + size` along it, at `cross` across it. */
export interface Gap { axis: "x" | "y"; start: number; size: number; cross: number }
export interface Snap { dx: number; dy: number; guides: Guide[]; gaps: Gap[] }

type Axis = "x" | "y";
const lo = (r: Rect, a: Axis) => (a === "x" ? r.x : r.y);
const len = (r: Rect, a: Axis) => (a === "x" ? r.w : r.h);
const other = (a: Axis): Axis => (a === "x" ? "y" : "x");
/** A box's three lines in one axis, its centre first: when several pairs tie (boxes of one size), the centres show. */
const lines = (r: Rect, a: Axis) => [lo(r, a) + len(r, a) / 2, lo(r, a), lo(r, a) + len(r, a)];
/** Whether two boxes overlap across `a` (they lie in one row for `a` = x, one column for `a` = y). */
const across = (p: Rect, q: Rect, a: Axis) => { const b = other(a); return lo(p, b) < lo(q, b) + len(q, b) && lo(q, b) < lo(p, b) + len(p, b); };

/** The snap in one axis: the nearest line, or equal gaps, within `reach`; null for none. */
function snapAxis(box: Rect, others: Rect[], a: Axis, reach: number): { d: number; guide?: Rect; at?: number; gap?: [Rect, Rect] } | null {
  let best: { d: number; guide?: Rect; at?: number; gap?: [Rect, Rect] } | null = null;
  for (const o of others) for (const m of lines(box, a)) for (const t of lines(o, a)) {
    const d = t - m;
    if (Math.abs(d) <= reach + 1e-9 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, guide: o, at: t };
  }
  // Equal gaps: the nearest box on each side that lies in the same row (column).
  const row = others.filter((o) => across(o, box, a));
  const before = row.filter((o) => lo(o, a) + len(o, a) <= lo(box, a)).sort((p, q) => (lo(q, a) + len(q, a)) - (lo(p, a) + len(p, a)))[0];
  const after = row.filter((o) => lo(o, a) >= lo(box, a) + len(box, a)).sort((p, q) => lo(p, a) - lo(q, a))[0];
  if (before && after) {
    const g1 = lo(box, a) - (lo(before, a) + len(before, a)), g2 = lo(after, a) - (lo(box, a) + len(box, a));
    const d = (g2 - g1) / 2;
    // A line wins a tie (ui contract).
    if (Math.abs(g1 - g2) <= reach + 1e-9 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, gap: [before, after] };
  }
  return best;
}

/** Where the dragged components' box snaps (ui contract, Dragging): `box` where the pointer puts it, `zoom` the canvas's. */
export function snapDrag(box: Rect, others: Rect[], zoom: number, alt = false): Snap {
  const out: Snap = { dx: 0, dy: 0, guides: [], gaps: [] };
  // Alt: nothing snaps, no mark shows; positions stay whole pixels.
  if (alt) return { ...out, dx: Math.round(box.x) - box.x, dy: Math.round(box.y) - box.y };
  const reach = SNAP_PX / zoom;
  for (const a of ["x", "y"] as const) {
    const s = snapAxis(box, others, a, reach);
    // In an axis with no snap the position snaps to the grid; either way it ends on a whole pixel.
    const d = s ? Math.round(lo(box, a) + s.d) - lo(box, a) : Math.round(lo(box, a) / GRID) * GRID - lo(box, a);
    if (a === "x") out.dx = d; else out.dy = d;
    if (!s) continue;
    const moved: Rect = { ...box, x: box.x + (a === "x" ? d : 0), y: box.y + (a === "y" ? d : 0) };
    const b = other(a);
    if (s.guide) {
      // The line the two boxes now share, from the other box to the dragged one.
      out.guides.push({ axis: a, at: Math.round(s.at!), from: Math.min(lo(s.guide, b), lo(moved, b)), to: Math.max(lo(s.guide, b) + len(s.guide, b), lo(moved, b) + len(moved, b)) });
    } else if (s.gap) {
      const [p, q] = s.gap, cross = lo(moved, b) + len(moved, b) / 2;
      out.gaps.push({ axis: a, start: lo(p, a) + len(p, a), size: lo(moved, a) - (lo(p, a) + len(p, a)), cross });
      out.gaps.push({ axis: a, start: lo(moved, a) + len(moved, a), size: lo(q, a) - (lo(moved, a) + len(moved, a)), cross });
    }
  }
  return out;
}
