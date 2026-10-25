import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countCrossings, layoutRects, routeEdges } from "./geometry";
import { fewerCrossings, layoutView } from "./layout";
import { fillDefaults, type DiagramView } from "./model";
import { edge, node } from "./testkit";

/** LAYOUT-6 (#175): barycentre sweeps reorder movable parts within rows and columns to cut crossings. */
const cell = (r: number, c: number) => ({ r, c });
const link = (a: string, b: string, step: number | null = null) => ({ a, b, step, label: "" });

describe("barycentre sweeps", () => {
  // a b on the top row, c d below; a–d and b–c cross until c and d trade places.
  const cells = () => new Map([["a", cell(0, 0)], ["b", cell(0, 1)], ["c", cell(1, 0)], ["d", cell(1, 1)]]);

  it("a row sorted by the mean column of its neighbours uncrosses two lines", () => {
    const out = fewerCrossings(cells(), [link("a", "d"), link("b", "c")], new Map([["c", ""], ["d", ""]]));
    expect(out.get("d")).toEqual(cell(1, 0));
    expect(out.get("c")).toEqual(cell(1, 1));
    expect(out.get("a")).toEqual(cell(0, 0));
  });

  it("a part that may not move keeps its cell, and so does every part when only one may move", () => {
    const out = fewerCrossings(cells(), [link("a", "d"), link("b", "c")], new Map([["d", ""]]));
    expect([...out]).toEqual([...cells()]);
  });

  it("parts of different classes (side parts of other anchors) never trade cells", () => {
    const out = fewerCrossings(cells(), [link("a", "d"), link("b", "c")], new Map([["c", "a:below"], ["d", "b:below"]]));
    expect([...out]).toEqual([...cells()]);
  });

  it("with no crossing nothing moves, though the neighbours' order would move parts", () => {
    // e is nearest a by its neighbour but sits right of d: no crossing, so no sweep runs.
    const start = new Map([["a", cell(0, 0)], ["b", cell(0, 1)], ["c", cell(1, 1)], ["d", cell(1, 2)], ["e", cell(1, 3)]]);
    const out = fewerCrossings(start, [link("b", "c"), link("b", "d"), link("a", "e")].slice(0, 2), new Map([["c", ""], ["d", ""], ["e", ""]]));
    expect([...out]).toEqual([...start]);
  });

  it("a round that does not lower the crossings is undone", () => {
    // a–d and b–c cross, and so do a–d and b–e; whatever order c, d, e take in row 1, a part of row 0 stays fixed and
    // the sweep keeps only rounds that lower the count, never one that raises it.
    const start = new Map([["a", cell(0, 0)], ["b", cell(0, 1)], ["c", cell(1, 0)], ["d", cell(1, 1)], ["e", cell(1, 2)]]);
    const lifted = [link("a", "d"), link("b", "c"), link("a", "e"), link("b", "d")];
    const out = fewerCrossings(start, lifted, new Map([["c", ""], ["d", ""], ["e", ""]]));
    const count = (m: Map<string, { r: number; c: number }>) => lifted.filter((s, i) => lifted.slice(i + 1).some((t) => {
      if ([s.a, s.b].some((x) => x === t.a || x === t.b)) return false;
      const o = (p: { r: number; c: number }, q: { r: number; c: number }, z: { r: number; c: number }) => Math.sign((q.c - p.c) * (z.r - p.r) - (q.r - p.r) * (z.c - p.c));
      const [p1, p2, q1, q2] = [m.get(s.a)!, m.get(s.b)!, m.get(t.a)!, m.get(t.b)!];
      return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
    })).length;
    expect(count(out)).toBeLessThanOrEqual(count(start));
  });

  it("undoes a round that moves parts but does not lower the crossings", () => {
    // Row 1 would sort d, e, f into its movable cells, which crosses as much as before: the round is undone.
    const start = new Map([["a", cell(1, 2)], ["b", cell(0, 0)], ["c", cell(0, 3)], ["d", cell(1, 3)], ["e", cell(1, 0)], ["f", cell(1, 1)]]);
    const out = fewerCrossings(start, [link("e", "a"), link("d", "f"), link("b", "a"), link("c", "e")], new Map(["c", "d", "e", "f"].map((id) => [id, ""])));
    expect([...out]).toEqual([...start]);
  });

  it("is pure and deterministic", () => {
    const lifted = [link("a", "d"), link("b", "c")], movable = new Map([["c", ""], ["d", ""]]);
    const input = cells();
    const one = fewerCrossings(input, lifted, movable), two = fewerCrossings(cells(), lifted, movable);
    expect([...one]).toEqual([...two]);
    expect([...input]).toEqual([...cells()]);
  });
});

describe("a laid-out view never draws more crossings with the sweeps than without", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 12; k++) {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`n${i}`, { place: null }));
    const edges: ReturnType<typeof edge>[] = [];
    for (let i = 0; i < 12; i++) {
      const a = Math.floor(rnd() * 9), b = Math.floor(rnd() * 9);
      if (a !== b && !edges.some((e) => [e.from, e.to].sort().join() === [`n${a}`, `n${b}`].sort().join())) edges.push({ ...edge(`n${a}`, `n${b}`), id: `e${i}` });
    }
    const view = fillDefaults({ version: 2, title: "fuzz", views: [{ id: `f${k}`, title: "F", caption: { what: "", how: "", notice: "" }, nodes, edges }] } as never).views[0] as DiagramView;
    const bare = { ...view, nodes: view.nodes.map(({ x: _x, y: _y, ...n }) => n) };
    it(`fuzz ${k}`, () => {
      const drawn = (v: { nodes: DiagramView["nodes"]; edges: DiagramView["edges"] }) => countCrossings(v.edges, routeEdges(v, layoutRects(v)));
      const sorted = layoutView(bare), plain = layoutView(bare, { reorder: false });
      expect(drawn({ ...sorted, edges: view.edges })).toBeLessThanOrEqual(drawn({ ...plain, edges: view.edges }));
      expect(layoutView(bare).nodes).toEqual(sorted.nodes);
    });
  }

  it("a stored position, a place hint and a numbered connection's ends keep their cells", () => {
    const nodes = [node("a", { place: { row: 0, col: 0 } }), node("b", { place: null }), node("c", { place: null }), node("d", { place: null }), node("kept", { place: null, x: 900, y: 600 })];
    const v = fillDefaults({ version: 2, title: "kept", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes,
      edges: [{ ...edge("a", "b", { step: 1 }), id: "s1" }, { ...edge("a", "d"), id: "x" }, { ...edge("b", "c"), id: "y" }, { ...edge("kept", "c"), id: "z" }] }] } as never).views[0] as DiagramView;
    const bare = { ...v, nodes: v.nodes.map((n) => (n.id === "kept" ? n : (({ x: _x, y: _y, ...rest }) => rest)(n))) };
    const out = layoutView(bare), plain = layoutView(bare, { reorder: false }), kept = out.nodes.find((n) => n.id === "kept")!;
    expect([kept.x, kept.y]).toEqual([900, 600]);
    for (const id of ["a", "b"]) {
      const p = out.nodes.find((n) => n.id === id)!, q = plain.nodes.find((n) => n.id === id)!;
      expect([p.x, p.y], id).toEqual([q.x, q.y]);
    }
  });
});

describe("the reordered layout is kept only when it draws no more crossings (step 5)", () => {
  it("the hotel without its place hints: the sweep lowers the cells' crossings but would draw more, so the plain layout stays", () => {
    const raw = JSON.parse(readFileSync("tests/fixtures/hotel.archdraw.json", "utf8"));
    const v = fillDefaults(raw).views[0] as DiagramView;
    const bare = { ...v, nodes: v.nodes.map(({ x: _x, y: _y, ...n }) => ({ ...n, place: null })) };
    const plain = layoutView(bare, { reorder: false }), kept = layoutView(bare);
    expect(kept.nodes.map((n) => [n.id, n.x, n.y])).toEqual(plain.nodes.map((n) => [n.id, n.x, n.y]));
  });
});

describe("the main path beside hinted parts", () => {
  it("reads in step order along one row, under the hinted block", () => {
    const hint = (row: number, col: number) => ({ place: { row, col } });
    const nodes = [node("p00", hint(0, 0)), node("p01", hint(0, 1)), node("p10", hint(1, 0)), node("p11", hint(1, 1)),
      node("q1", { place: null }), node("q2", { place: null }), node("q3", { place: null }), node("q4", { place: null }), node("r2", { place: null }), node("r1", { place: null })];
    const edges = [["q1", "q2", 1], ["q2", "q3", 2], ["q3", "q4", 3], ["r2", "q4", null], ["r2", "q2", null], ["r1", "q3", null], ["r1", "q1", null]] as const;
    const v = fillDefaults({ version: 2, title: "block", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes,
      edges: edges.map(([a, b, step], i) => ({ ...edge(a, b, { step }), id: `k${i}` })) }] } as never).views[0] as DiagramView;
    const out = layoutView({ ...v, nodes: v.nodes.map(({ x: _x, y: _y, ...n }) => n) });
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;
    for (const i of [1, 2, 3]) expect(at(`q${i}`).x).toBeLessThan(at(`q${i + 1}`).x);
    expect(new Set([1, 2, 3, 4].map((i) => at(`q${i}`).y)).size).toBe(1);
    expect(at("q1").y).toBeGreaterThan(at("p10").y);
  });
});
