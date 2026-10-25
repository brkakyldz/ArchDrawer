import { describe, expect, it } from "vitest";
import { bezierAt, facingSides, layoutRects, routeEdges, sideCost, type EdgeRoute, type Rect } from "./geometry";
import type { DiagramView } from "./model";

/**
 * LAYOUT-5 (#164): a side's cost counts the angle to the other end and the ends it already holds;
 * between sides that face each other across a short gap a handle is never longer than the gap.
 */
const part = (id: string, x: number, y: number) => ({
  id, label: id, kind: "service" as const, form: "card" as const, icon: null, sub: "", items: [], description: "", files: [],
  parent: null, detail: null, place: null, x, y,
});
const view = (nodes: ReturnType<typeof part>[], edges: [string, string, string][]): DiagramView => ({
  id: "v", title: "V", caption: { title: "V", lede: "" }, postOf: null, texts: [], nodes,
  edges: edges.map(([id, from, to]) => ({ id, from, to, label: "", style: "call" as const, both: false, step: null })),
} as unknown as DiagramView);
const route = (v: DiagramView) => { const rects = layoutRects(v); return { rects, routes: routeEdges(v, rects) }; };
const onBorder = (p: { x: number; y: number }, r: Rect) =>
  Math.min(Math.abs(p.x - r.x), Math.abs(p.x - r.x - r.w), Math.abs(p.y - r.y), Math.abs(p.y - r.y - r.h)) < 0.5;
const isStraight = (r: EdgeRoute) => [r.c1, r.c2, r.p1].every((q) => Math.abs((q.x - r.p0.x) * (r.p1.y - r.p0.y) - (q.y - r.p0.y) * (r.p1.x - r.p0.x)) < 1e-6);

describe("a side's cost", () => {
  it("is 1 − cos θ plus 0.25 for each end the side holds, over the sides that face the other part", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }, b = { x: 300, y: 300, w: 100, h: 100 };
    expect(facingSides(a, b)).toEqual(["r", "b"]);
    expect(sideCost(a, b, "r")).toBeCloseTo(1 - Math.SQRT1_2, 9);
    expect(sideCost(a, b, "r", 2)).toBeCloseTo(1 - Math.SQRT1_2 + 0.5, 9);
    expect(facingSides(a, { x: 300, y: 0, w: 100, h: 100 })).toEqual(["r"]);
  });
});

describe("sides count their load", () => {
  // Order API with POST /orders arriving on its left; Orders DB down and left of it, where the facing pair is the left side.
  const shop = (withPost: boolean) => view(
    [part("web", 200, 0), part("api", 600, 0), part("db", 200, 300)],
    [...(withPost ? [["post", "web", "api"] as [string, string, string]] : []), ["save", "api", "db"]],
  );

  it("the API→DB line leaves the API's free bottom when its left side holds the incoming line", () => {
    const { rects, routes } = route(shop(true)), save = routes.get("save")!;
    expect([routes.get("post")!.side1, save.side0, save.side1]).toEqual(["l", "b", "r"]);
    expect(onBorder(save.p0, rects.get("api")!) && save.p0.y === rects.get("api")!.y + rects.get("api")!.h).toBe(true);
  });

  it("without the incoming line it takes the facing pair, the left side", () => {
    expect(route(shop(false)).routes.get("save")!.side0).toBe("l");
  });

  it("a part whose facing side is busy and whose next side is free: the third line takes the free side", () => {
    const v = view([part("p", 0, 0), part("t1", 400, -60), part("t2", 400, 60), part("t4", 346, 200)],
      [["e1", "p", "t1"], ["e2", "p", "t2"], ["e4", "p", "t4"]]);
    const { routes } = route(v);
    expect(["e1", "e2", "e4"].map((id) => routes.get(id)!.side0)).toEqual(["r", "r", "b"]);
    expect(routes.get("e4")!.side1).toBe("l");
  });

  it("is stateless: the same view always gives the same sides and paths", () => {
    const v = shop(true);
    expect([...route(v).routes.values()].map((r) => r.d)).toEqual([...route(v).routes.values()].map((r) => r.d));
  });
});

describe("short gaps get short handles", () => {
  const pair = (dy: number, vertical = false) => {
    const v = view([part("a", 0, 0), vertical ? part("b", 0, 108 + 40) : part("b", 196 + 40, dy)], [["ab", "a", "b"]]);
    const { rects, routes } = route(v);
    return { r: routes.get("ab")!, a: rects.get("a")!, b: rects.get("b")! };
  };

  it("two parts 40 px apart give a curve that never leaves the gap between them", () => {
    for (const dy of [0, 10, 30]) {
      const { r } = pair(dy);
      expect(r.p1.x - r.p0.x).toBe(40);
      for (let i = 0; i <= 64; i++) {
        const p = bezierAt(r, i / 64);
        expect(p.x).toBeGreaterThanOrEqual(r.p0.x - 1e-6);
        expect(p.x).toBeLessThanOrEqual(r.p1.x + 1e-6);
      }
      expect(Math.abs(r.c1.x - r.p0.x)).toBeLessThanOrEqual(40);
      expect(Math.abs(r.p1.x - r.c2.x)).toBeLessThanOrEqual(40);
    }
  });

  it("ports in line give a straight path, side by side and one above the other", () => {
    expect(isStraight(pair(0).r)).toBe(true);
    expect(isStraight(pair(0, true).r)).toBe(true);
    expect(isStraight(pair(10).r)).toBe(false);
  });

  it("a gap under 8 px keeps 8 px handles; a long gap keeps the usual 0.42 × distance", () => {
    const close = route(view([part("a", 0, 0), part("b", 196 + 4, 0)], [["ab", "a", "b"]])).routes.get("ab")!;
    expect(close.c1.x - close.p0.x).toBe(8);
    const far = route(view([part("a", 0, 0), part("b", 196 + 300, 0)], [["ab", "a", "b"]])).routes.get("ab")!;
    expect(far.c1.x - far.p0.x).toBeCloseTo(300 * 0.42, 6);
  });

  it("the arrowhead still touches the part it points at", () => {
    for (const [dy, vertical] of [[0, false], [10, false], [0, true]] as const) {
      const { r, b } = pair(dy, vertical);
      expect(onBorder(r.p1, b)).toBe(true);
    }
  });
});
