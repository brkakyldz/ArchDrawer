import type { Rect } from "../../core/geometry";

/** Screen = world × k + (x, y). */
export interface Viewport { x: number; y: number; k: number }

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
/** Fit margins (DESIGN.md Layout): the ask box never covers the drawing. */
export const FIT = { top: 34, side: 56, bottom: 96, maxK: 1.15 };

export const clampZoom = (k: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
/** The zoom as the toolbar shows it, in whole percent. */
export const zoomPercent = (k: number) => Math.round(k * 100);
/** Semantic zoom (ui contract): the level follows the zoom shown, so "75%" is always `full`. */
export const detailAt = (k: number) => { const p = zoomPercent(k); return p >= 75 ? "full" : p >= 50 ? "outline" : "overview"; };

export function fitView(b: Rect, w: number, h: number): Viewport {
  const aw = Math.max(40, w - FIT.side * 2), ah = Math.max(40, h - FIT.top - FIT.bottom);
  const k = clampZoom(Math.min(FIT.maxK, aw / Math.max(1, b.w), ah / Math.max(1, b.h)));
  return { k, x: FIT.side + (aw - b.w * k) / 2 - b.x * k, y: FIT.top + (ah - b.h * k) / 2 - b.y * k };
}

/** Zoom by `factor` keeping the screen point `at` still. */
export function zoomAt(v: Viewport, factor: number, at: { x: number; y: number }): Viewport {
  const k = clampZoom(v.k * factor);
  const f = k / v.k;
  return { k, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f };
}

/**
 * The viewport that shows the world rect `r` on a stage of `w` × `h`: unchanged (the same object)
 * when `r` is already wholly on the stage and clear of `cover` (a panel over the stage, in stage
 * pixels), otherwise moved at the same zoom so that `r` is centred in the stage less `inset`,
 * below `cover`.
 */
export function reveal(v: Viewport, r: Rect, w: number, h: number, inset: { top: number; side: number; bottom: number }, cover?: Rect): Viewport {
  const s = rectToScreen(v, r);
  const under = !!cover && s.x < cover.x + cover.w && s.x + s.w > cover.x && s.y < cover.y + cover.h && s.y + s.h > cover.y;
  if (!under && s.x >= 0 && s.x + s.w <= w && s.y >= 0 && s.y + s.h <= h) return v;
  const left = inset.side, right = w - inset.side, bottom = h - inset.bottom;
  const top = Math.max(inset.top, cover ? cover.y + cover.h + 16 : 0);
  return { k: v.k, x: (left + right) / 2 - (r.x + r.w / 2) * v.k, y: (top + Math.max(top, bottom)) / 2 - (r.y + r.h / 2) * v.k };
}

export const toWorld =(v: Viewport, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });
export const toScreen = (v: Viewport, p: { x: number; y: number }) => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });
export const rectToScreen = (v: Viewport, r: Rect): Rect => ({ x: r.x * v.k + v.x, y: r.y * v.k + v.y, w: r.w * v.k, h: r.h * v.k });

export type Side = "r" | "l" | "d" | "u";

/**
 * Where a screen-size callout goes beside its component (DESIGN.md, The Screen-Size Callout
 * Rule): right, then left, below, above — never over the component, other avoided boxes or off
 * the stage when a side fits. Returns the callout's top-left and the side it is on.
 */
export function placeCallout(box: Rect, size: { w: number; h: number }, stage: { w: number; h: number }, avoid: Rect[] = []): { x: number; y: number; side: Side; pointer: number } {
  const gap = 14, pad = 10;
  const clampY = (y: number) => Math.max(pad, Math.min(stage.h - size.h - pad, y));
  const clampX = (x: number) => Math.max(pad, Math.min(stage.w - size.w - pad, x));
  const cands: { x: number; y: number; side: Side }[] = [
    { x: box.x + box.w + gap, y: clampY(box.y - 6), side: "r" },
    { x: box.x - gap - size.w, y: clampY(box.y - 6), side: "l" },
    { x: clampX(box.x + box.w / 2 - 40), y: box.y + box.h + gap, side: "d" },
    { x: clampX(box.x + box.w / 2 - 40), y: box.y - gap - size.h, side: "u" },
  ];
  const hit = (c: { x: number; y: number }, r: Rect) => c.x < r.x + r.w && c.x + size.w > r.x && c.y < r.y + r.h && c.y + size.h > r.y;
  const onStage = (c: { x: number; y: number }) => c.x >= pad && c.y >= pad && c.x + size.w <= stage.w - pad && c.y + size.h <= stage.h - pad;
  const score = (c: { x: number; y: number }) => (hit(c, box) ? 1000 : 0) + (onStage(c) ? 0 : 100) + avoid.filter((r) => hit(c, r)).length * 10;
  let best = cands[0];
  for (const c of cands) if (score(c) < score(best)) best = c;
  const pointer = best.side === "r" || best.side === "l"
    ? Math.max(14, Math.min(size.h - 24, box.y + Math.min(box.h / 2, 30) - best.y - 5))
    : Math.max(14, Math.min(size.w - 24, box.x + box.w / 2 - best.x - 5));
  return { ...best, pointer };
}
