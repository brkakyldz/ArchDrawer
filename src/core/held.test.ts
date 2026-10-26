import { describe, expect, it } from "vitest";
import { layoutRects, routeEdges, type Side } from "./geometry";
import { fillDefaults, type DiagramView } from "./model";
import { edge, node } from "./testkit";

// EDIT-5 (diagram contract, While dragging): a dragged part's connection keeps its sides until the cheapest pair costs
// less than 0.8 × the kept pair's, or a kept side no longer faces; without held sides the choice is the stateless one.
// Two cards of one size: B's offset from A is the vector between their centres.
const pair = (bx: number, by: number) => fillDefaults({ version: 2, title: "held", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" },
  nodes: [node("a", { x: 0, y: 0 }), node("b", { x: bx, y: by })], edges: [{ ...edge("a", "b"), id: "ab" }] }] } as never).views[0] as DiagramView;
const sides = (v: DiagramView, held?: [Side, Side]) => {
  const r = routeEdges(v, layoutRects(v), held ? { held: new Map([["ab", held]]) } : {}).get("ab")!;
  return [r.side0, r.side1];
};

describe("sides held while dragging (#165)", () => {
  it("just past 45 degrees the stateless pair turns, the held one stays", () => {
    const v = pair(300, 320); // 46.8 degrees: right/left costs 0.631, bottom/top 0.542, not under 0.8 × 0.631
    expect(sides(v)).toEqual(["b", "t"]);
    expect(sides(v, ["r", "l"])).toEqual(["r", "l"]);
  });

  it("the held pair gives way once the cheapest costs less than 0.8 × it", () => {
    const v = pair(300, 350); // 49.4 degrees: 0.481 < 0.8 × 0.699
    expect(sides(v, ["r", "l"])).toEqual(["b", "t"]);
    // Going back: bottom/top is kept at 43.8 degrees and given up at 38.
    expect(sides(pair(300, 288), ["b", "t"])).toEqual(["b", "t"]);
    expect(sides(pair(300, 288))).toEqual(["r", "l"]);
    expect(sides(pair(300, 234), ["b", "t"])).toEqual(["r", "l"]);
  });

  it("a held side that no longer faces the other end is dropped", () => {
    const v = pair(-300, 20);
    expect(sides(v, ["r", "l"])).toEqual(sides(v));
    expect(sides(v)).toEqual(["l", "r"]);
  });

  it("the same view without held sides gives the same routes every time", () => {
    const v = pair(300, 320), rects = layoutRects(v);
    expect(routeEdges(v, rects)).toEqual(routeEdges(v, rects, { held: new Map() }));
  });
});
