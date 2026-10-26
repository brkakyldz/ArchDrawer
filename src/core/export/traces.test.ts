import { describe, expect, it } from "vitest";
import { bezierAt, curveInside, curvePieces, edgesOverParts, layoutRects, routeEdges } from "../geometry";
import { fillDefaults, type DiagramView } from "../model";
import { edge, node } from "../testkit";
import { PALETTES } from "../theme";
import { drawView, nodeMarkup } from "./svg";

// LOOK-4 (diagram contract, Traces): a connection that passes behind a part it does not join is drawn again over that part.
const view = (): DiagramView => fillDefaults({ version: 2, title: "traces", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
  node("a", { x: 0, y: 0 }), node("mid", { x: 400, y: 0 }), node("b", { x: 800, y: 0 }), node("c", { x: 0, y: 400 }),
], edges: [{ ...edge("a", "b", { style: "async" }), id: "ab" }, { ...edge("a", "c"), id: "ac" }] }] } as never).views[0] as DiagramView;

const partOf = (body: string, id: string) => {
  const at = body.indexOf(`<g data-node-id="${id}"`);
  const next = body.indexOf("<g data-node-id=", at + 1);
  return body.slice(at, next < 0 ? undefined : next);
};

describe("traces of a line over the parts it passes behind (#171)", () => {
  it("a blocked connection has a trace inside the blocking part, after its outline and before its text; an unblocked one has none", () => {
    const v = view(), rects = layoutRects(v), routes = routeEdges(v, rects);
    expect(edgesOverParts(v, rects, routes)).toEqual([{ edge: "ab", node: "mid" }]);
    for (const theme of ["light", "dark"] as const) {
      const body = drawView(v, PALETTES[theme], { prefix: "ad" }).body;
      const mid = partOf(body, "mid");
      const trace = /<path class="trace" data-edge-of="ab" d="([^"]+)" fill="none" stroke="([^"]+)" stroke-width="1" stroke-linejoin="round" opacity="0.25"([^>]*)\/>/.exec(mid)!;
      expect(trace, theme).toBeTruthy();
      expect(trace[1]).toBe(routes.get("ab")!.d);
      expect(trace[2]).toBe(PALETTES[theme].edge);
      expect(trace[3]).toContain('stroke-dasharray="6 5"');
      // Clipped to the part's box (a viewport of the box in the drawing's coordinates); over its outline, under its label.
      const r = rects.get("mid")!;
      expect(mid).toContain(`<svg class="traces" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" overflow="hidden" pointer-events="none">`);
      expect(mid.indexOf('class="body"')).toBeLessThan(mid.indexOf('class="trace"'));
      expect(mid.indexOf('class="trace"')).toBeLessThan(mid.indexOf("<text"));
      // No glow and no arrowhead on a trace; no other part has one.
      expect(trace[0]).not.toMatch(/marker|glow/);
      for (const id of ["a", "b", "c"]) expect(partOf(body, id)).not.toContain('class="trace"');
      expect(body.match(/class="trace"/g)!.length).toBe(1);
    }
  });

  it("a stepped connection's trace takes its kind colours", () => {
    const v = view();
    v.edges = v.edges.map((e) => (e.id === "ab" ? { ...e, step: 1 } : e));
    const mid = partOf(drawView(v, PALETTES.light, { prefix: "ad" }).body, "mid");
    expect(mid).toContain('data-edge-of="ab" d="');
    expect(mid).toMatch(/data-edge-of="ab"[^>]*stroke="url\(#ad-g-ab\)"/);
  });
});

describe("the pieces of a line inside a part (the editor's traces)", () => {
  it("is the same curve cut at the part's edges: every point of it inside the box, both ends on its edges", () => {
    const v = view(), rects = layoutRects(v), routes = routeEdges(v, rects);
    const r = rects.get("mid")!, route = routes.get("ab")!;
    const d = curveInside(route, r);
    const pieces = d.split("M").filter(Boolean);
    expect(pieces).toHaveLength(1);
    const [p0, c1, c2, p1] = pieces[0].replace("C", "").trim().split(/\s+/).map((xy) => { const [x, y] = xy.split(",").map(Number); return { x, y }; });
    for (let i = 0; i <= 20; i++) {
      const p = bezierAt({ p0, c1, c2, p1 }, i / 20);
      expect(p.x).toBeGreaterThanOrEqual(r.x - 0.05); expect(p.x).toBeLessThanOrEqual(r.x + r.w + 0.05);
      expect(p.y).toBeGreaterThanOrEqual(r.y - 0.05); expect(p.y).toBeLessThanOrEqual(r.y + r.h + 0.05);
      // On the original curve: the nearest of its samples is within a hundredth of a pixel or so.
      const near = Math.min(...Array.from({ length: 2001 }, (_, k) => { const q = bezierAt(route, k / 2000); return Math.hypot(q.x - p.x, q.y - p.y); }));
      expect(near).toBeLessThan(0.5);
    }
    const onEdge = (q: { x: number; y: number }) => Math.min(Math.abs(q.x - r.x), Math.abs(q.x - r.x - r.w), Math.abs(q.y - r.y), Math.abs(q.y - r.y - r.h));
    expect(onEdge(p0)).toBeLessThan(0.05); expect(onEdge(p1)).toBeLessThan(0.05);
    // A box the line misses has no piece.
    expect(curveInside(route, { x: r.x, y: r.y + 1000, w: r.w, h: r.h })).toBe("");
  });
});

describe("a trace's dashes fall where its line's do (review ab05869-1, -2)", () => {
  const c = { p0: { x: 0, y: 0 }, c1: { x: 100, y: 0 }, c2: { x: 200, y: 0 }, p1: { x: 300, y: 0 } };
  it("the offset is the length of the line before the piece; a line starting inside has none", () => {
    const cut = curvePieces(c, { x: 120, y: -10, w: 60, h: 20 });
    expect(cut.offset).toBeCloseTo(120, 1);
    expect(cut.d.startsWith("M120,0 C")).toBe(true);
    expect(curvePieces(c, { x: -10, y: -10, w: 60, h: 20 }).offset).toBe(0);
  });
  it("a line that enters a box twice gives two pieces", () => {
    const arch = { p0: { x: 0, y: 50 }, c1: { x: 100, y: -60 }, c2: { x: 200, y: -60 }, p1: { x: 300, y: 50 } };
    const cut = curveInside(arch, { x: -10, y: 20, w: 320, h: 40 });
    expect(cut.split("M").filter(Boolean)).toHaveLength(2);
  });
  it("an editor trace carries the offset only when its line is dashed", () => {
    const v = view(), rects = layoutRects(v), routes = routeEdges(v, rects);
    const mid = rects.get("mid")!;
    const cut = curvePieces(routes.get("ab")!, mid);
    const at = v.nodes.find((x) => x.id === "mid")!;
    const dashed = nodeMarkup(at, mid, PALETTES.light, { traces: [{ edge: "ab", d: cut.d, offset: cut.offset, stroke: "#000", dash: ' stroke-dasharray="6 5"' }] });
    expect(cut.offset).toBeGreaterThan(0);
    expect(dashed).toContain(`stroke-dashoffset="${cut.offset}"`);
    const solid = nodeMarkup(at, mid, PALETTES.light, { traces: [{ edge: "ab", d: cut.d, offset: cut.offset, stroke: "#000", dash: "" }] });
    expect(solid).not.toContain("stroke-dashoffset");
  });
});
