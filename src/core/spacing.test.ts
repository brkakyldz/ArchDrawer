import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BADGE, LABEL, bezierAt, groupHeaderWidth, groupNameBox, labelWidth, layoutRects, routeEdges, type EdgeRoute, type Rect } from "./geometry";
import { layoutView } from "./layout";
import type { DiagramFile, DiagramView } from "./model";
import { normalizeFile } from "./normalize";
import { edge, node } from "./testkit";

// The spacing and clearance rules of the drawing contract (Layout, Sizes), pinned at the layer that
// computes them. The held-out suite checks only the outcomes: no overlap, no line through a part,
// nothing cut, editor and export agree.

type View = Parameters<typeof layoutView>[0];
const rectsOf = (v: View, post = false) => {
  const laid = layoutView(v, { post });
  return { laid, rects: layoutRects(laid, { post }) };
};
const gapX = (a: Rect, b: Rect) => b.x - (a.x + a.w);
const gapY = (a: Rect, b: Rect) => b.y - (a.y + a.h);
const boxGap = (a: Rect, b: Rect) => Math.hypot(Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0), Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0));
const samples = (r: EdgeRoute, n = 200) => (r.segments ?? [r]).flatMap((c) => Array.from({ length: n + 1 }, (_, i) => bezierAt(c, i / n)));

describe("lane spacing", () => {
  it("keeps columns 24 px apart and rows 32 px apart (22 in the post style), above and below", () => {
    const v = { nodes: [node("s0", { lane: { spine: 0 } }), node("s1", { lane: { spine: 1 } }), node("s2", { lane: { spine: 2 } }),
      node("down", { lane: { anchor: "s1", side: "below" } }), node("up", { lane: { anchor: "s1", side: "above" } })], edges: [] };
    for (const [post, row] of [[false, 32], [true, 22]] as const) {
      const { rects } = rectsOf(v, post), r = (id: string) => rects.get(id)!;
      expect(gapX(r("s0"), r("s1")), `post ${post}`).toBeCloseTo(24, 6);
      expect(gapX(r("s1"), r("s2")), `post ${post}`).toBeCloseTo(24, 6);
      expect(gapY(r("s1"), r("down")), `post ${post}`).toBeCloseTo(row, 6);
      expect(gapY(r("up"), r("s1")), `post ${post}`).toBeCloseTo(row, 6);
    }
  });

  it("keeps 2(r + 3) + 28 px for a badge between numbered neighbours, and a drawn label's width + 16", () => {
    const pair = (extra: Parameters<typeof edge>[2]) => ({ nodes: [node("a", { lane: { spine: 0 } }), node("b", { lane: { spine: 1 } })], edges: [{ ...edge("a", "b", extra), id: "e" }] });
    for (const [post, r] of [[false, BADGE.r], [true, 11.5]] as const) {
      const { rects } = rectsOf(pair({ step: 1 }), post);
      expect(gapX(rects.get("a")!, rects.get("b")!), `badge, post ${post}`).toBeGreaterThanOrEqual(2 * (r + 3) + 28 - 1e-6);
    }
    const label = "A long label along the connection";
    const side = rectsOf(pair({ label })).rects;
    expect(gapX(side.get("a")!, side.get("b")!)).toBeGreaterThanOrEqual(labelWidth(label) + 16 - 1e-6);
    const stacked = rectsOf({ nodes: [node("a", { lane: { spine: 0 } }), node("b", { lane: { anchor: "a", side: "below" } })], edges: [{ ...edge("a", "b", { label }), id: "e" }] }).rects;
    expect(gapY(stacked.get("a")!, stacked.get("b")!)).toBeGreaterThanOrEqual(LABEL.h + 16 - 1e-6);
  });

  it("hidden labels reserve exactly the gap of empty ones", () => {
    const v = (label: string) => ({ nodes: [node("a", { lane: { spine: 0 } }), node("b", { lane: { spine: 1 } })], edges: [{ ...edge("a", "b", { label }), id: "e" }] });
    const hidden = layoutRects(layoutView(v("A long label along the connection"), { labels: false }));
    const empty = layoutRects(layoutView(v("")));
    expect(gapX(hidden.get("a")!, hidden.get("b")!)).toBeCloseTo(gapX(empty.get("a")!, empty.get("b")!), 6);
  });

  it("a group whose name is wider than its members is as wide as its header, and only the gap after it grows", () => {
    const label = "A zone whose name is much wider than its member";
    const v = { nodes: [node("zone", { form: "group", label, lane: { spine: 0 } }), node("m", { form: "compact", label: "M", parent: "zone", lane: { spine: 0 } }),
      node("b", { lane: { spine: 1 } }), node("c", { lane: { spine: 2 } })], edges: [] };
    const { laid, rects } = rectsOf(v), r = (id: string) => rects.get(id)!;
    expect(r("zone").w).toBeGreaterThanOrEqual(groupHeaderWidth(laid.nodes[0]));
    expect(r("zone").w).toBeGreaterThan(r("m").w + 36);
    expect(gapX(r("zone"), r("b"))).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(gapX(r("b"), r("c"))).toBeCloseTo(24, 6);
  });
});

describe("connection ends and arcs", () => {
  it("starts and ends every connection on its parts' borders, on the sides it names", () => {
    const v = { nodes: [node("hub", { x: 0, y: 200 }), node("a", { x: 400, y: 0 }), node("b", { x: 400, y: 400 }), node("up", { x: 0, y: -300 }), node("left", { x: -500, y: 200 })],
      edges: ["a", "b", "up", "left"].map((to) => ({ ...edge("hub", to), id: to })) } as Parameters<typeof routeEdges>[0];
    const rects = layoutRects(v), routes = routeEdges(v, rects);
    const onSide = (p: { x: number; y: number }, r: Rect, side: string) => {
      const along = side === "l" || side === "r" ? p.y >= r.y - 1e-6 && p.y <= r.y + r.h + 1e-6 : p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6;
      const edgeAt = { l: [p.x, r.x], r: [p.x, r.x + r.w], t: [p.y, r.y], b: [p.y, r.y + r.h] }[side as "l"]!;
      return along && Math.abs(edgeAt[0] - edgeAt[1]) <= 0.05;
    };
    for (const e of v.edges) {
      const route = routes.get(e.id!)!;
      expect(onSide(route.p0, rects.get(e.from)!, route.side0), `${e.id} start`).toBe(true);
      expect(onSide(route.p1, rects.get(e.to)!, route.side1), `${e.id} end`).toBe(true);
    }
  });

  it("an arc around a part between the ends stays at least 8 px clear of it", () => {
    for (const block of [{ x: 0, y: 150 }, { x: 20, y: 150 }, { x: -20, y: 150 }]) {
      const v = { nodes: [node("a", { x: 0, y: 0 }), node("block", block), node("b", { x: 0, y: 300 })], edges: [{ ...edge("a", "b"), id: "e" }] } as Parameters<typeof routeEdges>[0];
      const rects = layoutRects(v), route = routeEdges(v, rects).get("e")!, r = rects.get("block")!;
      expect(route.blocked).toBeUndefined();
      const nearest = Math.min(...samples(route, 400).map((p) => boxGap({ x: p.x, y: p.y, w: 0, h: 0 }, r)));
      expect(nearest, `block at ${block.x}`).toBeGreaterThanOrEqual(8 - 0.05);
    }
  });

  it("comes into a first-row member from above at least 10 px right of the group's name", () => {
    const v = { nodes: [node("top", { x: 0, y: 0 }), node("z", { form: "group", label: "Zone", x: 0, y: 200 }), node("in", { parent: "z", x: 18, y: 246 })],
      edges: [{ ...edge("top", "in"), id: "e" }] } as Parameters<typeof routeEdges>[0];
    for (const post of [false, true]) {
      const rects = layoutRects(v, { post }), route = routeEdges(v, rects, { post }).get("e")!;
      const name = groupNameBox(v.nodes[1], rects.get("z")!, post);
      expect(route.side1, `post ${post}`).toBe("t");
      expect(route.p1.x - (name.x + name.w), `post ${post}`).toBeGreaterThanOrEqual(10 - 1e-6);
    }
  });
});

describe("labels and badges keep clear", () => {
  const drawings = ["tests/fixtures/shop.archdraw.json", "tests/fixtures/archdrawer.archdraw.json", "tests/fixtures/hotel.archdraw.json"];
  const views = drawings.flatMap((path) => {
    const doc = normalizeFile(JSON.parse(readFileSync(path, "utf8")) as DiagramFile, { id: "d_spacing", now: "2026-10-20T00:00:00Z" });
    return doc.views.map((v) => [`${path} ${v.id}`, v] as const);
  });

  it.each(views)("%s: a label 4 px from parts, group names and earlier labels; a badge its radius + 3 px from labels", (_name, view: DiagramView) => {
    const rects = layoutRects(view), routes = routeEdges(view, rects);
    const parts = view.nodes.filter((n) => n.form !== "group" && rects.has(n.id)).map((n) => rects.get(n.id)!);
    const names = view.nodes.filter((n) => n.form === "group" && rects.has(n.id)).map((n) => groupNameBox(n, rects.get(n.id)!));
    const labels: Rect[] = [];
    for (const e of view.edges) {
      const at = routes.get(e.id)?.labelAt;
      if (!at || !e.label) continue;
      const w = labelWidth(e.label), box = { x: at.x - w / 2, y: at.y - LABEL.h / 2, w, h: LABEL.h };
      for (const other of [...parts, ...names, ...labels]) expect(boxGap(box, other), `label of ${e.id}`).toBeGreaterThanOrEqual(4 - 0.05);
      const near = Math.min(...samples(routes.get(e.id)!).map((p) => boxGap({ x: p.x, y: p.y, w: 0, h: 0 }, box)));
      expect(near, `label of ${e.id} near its curve`).toBeLessThanOrEqual(10 + 0.05);
      labels.push(box);
    }
    for (const e of view.edges) {
      const route = routes.get(e.id);
      if (!route || e.step === null) continue;
      const centre = { ...route.badgeAt, w: 0, h: 0 };
      for (const label of labels) expect(boxGap(centre, label), `badge of ${e.id}`).toBeGreaterThanOrEqual(BADGE.r + 3 - 0.05);
    }
  });
});
