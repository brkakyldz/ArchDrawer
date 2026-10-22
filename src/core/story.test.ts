import { describe, expect, it } from "vitest";
import { bezierAt, groupNameBox, layoutRects, measureNode, routeEdges, type Point, type Rect } from "./geometry";
import { DEFAULT_SHARE, renderShare, startSwitches } from "./export/share";
import { layoutReport } from "./report";
import { validateDocument, type DiagramView } from "./model";
import { layoutView } from "./layout";
import { node, edge } from "./testkit";
import { storyFixture } from "../../scripts/story-fixtures";

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const cross = (a: Point, b: Point, c: Point, d: Point) => {
  const turn = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
};

describe("story fixtures in both post formats", () => {
  for (const name of ["reference", "claude", "codex", "shop"]) for (const format of ["feed", "linkedin"] as const) {
    it(`${name}, ${format}: no crossing, no line behind a part, every label placed, nothing cut${format === "feed" ? ", readable in place" : ""}`, () => {
      const doc = storyFixture(name, format === "feed"), view = doc.views[0];
      expect(validateDocument(doc).ok).toBe(true);
      const rects = layoutRects(view), routes = routeEdges(view, rects);
      const edges = view.edges.filter((e) => routes.has(e.id));
      expect(edges.length).toBeGreaterThan(1);
      const poly = new Map(edges.map((e) => [e.id, Array.from({ length: 129 }, (_, i) => bezierAt(routes.get(e.id)!, i / 128))]));
      for (let i = 0; i < edges.length; i++) for (const b of edges.slice(i + 1)) {
        const a = edges[i];
        if ([a.from, a.to].some((id) => id === b.from || id === b.to)) continue;
        const pa = poly.get(a.id)!, pb = poly.get(b.id)!;
        expect(pa.slice(1).some((p, s) => pb.slice(1).some((q, t) => cross(pa[s], p, pb[t], q))), `${a.id} × ${b.id}`).toBe(false);
      }
      // Every line shows: none is hidden behind a part (a spine line turns out on a side instead).
      expect(edges.filter((e) => routes.get(e.id)!.blocked).map((e) => e.id)).toEqual([]);
      expect(edges.filter((e) => e.label && !routes.get(e.id)!.labelAt)).toEqual([]);
      const img = renderShare(doc, view.id, { ...DEFAULT_SHARE, format, theme: "light", lede: true, legend: false });
      expect(img.shortened).toEqual([]);
      if (format === "feed") {
        expect(img.readability.level).toBe("good");
        expect(img.readability.names.inPlace).toBeGreaterThanOrEqual(9);
        expect(img.readability.inPlace).toBeGreaterThanOrEqual(6.5);
      }
    });
  }
});

describe("connections and a group's name", () => {
  // A part in its group's first row, with a connection coming down from a part above it.
  const zone = (label: string) => ({
    nodes: [node("top", { x: 0, y: 0 }), node("z", { form: "group", label, x: 0, y: 200 }), node("in", { parent: "z", x: 18, y: 246 })],
    edges: [{ ...edge("top", "in"), id: "e" }],
  }) as Parameters<typeof routeEdges>[0];
  const entry = (label: string) => {
    const v = zone(label), rects = layoutRects(v, { post: true }), route = routeEdges(v, rects, { post: true }).get("e")!;
    const name = groupNameBox(v.nodes[1], rects.get("z")!, true);
    return { route, name, crosses: Array.from({ length: 129 }, (_, i) => bezierAt(route, i / 128)).some((p) => inside(p, name)) };
  };

  it("comes in from above right of a short name", () => {
    const { route, name, crosses } = entry("Zone");
    expect(route.side1).toBe("t");
    expect(route.p1.x).toBeGreaterThan(name.x + name.w);
    expect(crosses).toBe(false);
  });

  it("comes in from above when the name covers the part's whole top, passing behind the name", () => {
    const { route, crosses } = entry("A zone with a rather long name for its one part");
    expect(route.side1).toBe("t");
    expect(crosses).toBe(true);
  });
});

describe("an export lays out an untouched lane view for its switches", () => {
  it("drops label gaps with the labels, keeps a view moved by hand, and changes nothing stored", () => {
    const nodes = [node("a", { lane: { spine: 0 } }), node("b", { lane: { spine: 1 } }), node("c", { lane: { spine: 2 } }), node("s", { lane: { anchor: "b", side: "below" } })];
    const edges = [{ ...edge("a", "b", { label: "a fairly long label" }), id: "e1" }, { ...edge("b", "c", { label: "another long label" }), id: "e2" }, { ...edge("b", "s"), id: "e3" }];
    const base = { id: "overview", title: "O", caption: { title: "", lede: "" }, postOf: null, nodes, edges, texts: [] };
    const laid = layoutView(base) as unknown as DiagramView;
    const plain = layoutView({ ...base, edges: edges.map((e) => ({ ...e, label: "" })) }) as unknown as DiagramView;
    const at = (v: DiagramView) => v.nodes.map((n) => [n.x, n.y]);
    expect(at(plain)).not.toEqual(at(laid));
    const opts = { ...DEFAULT_SHARE, format: "readme" as const, theme: "light" as const };
    const doc = { views: [laid] }, stored = JSON.stringify(doc);
    expect(at(renderShare(doc, "overview", { ...opts, labels: false }).drawn.view)).toEqual(at(plain));
    expect(at(renderShare(doc, "overview", { ...opts, labels: true }).drawn.view)).toEqual(at(laid));
    expect(JSON.stringify(doc)).toBe(stored);
    const moved = { ...laid, nodes: laid.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 40 } : n)) };
    expect(at(renderShare({ views: [moved] }, "overview", { ...opts, labels: false }).drawn.view)).toEqual(at(moved));
  });
});

describe("a post card is as wide as its sub-line needs", () => {
  it("shows a 28-character sub-line whole, from 176 up to 204 wide; a detail card stays 196", () => {
    const card = { label: "Plugin install", form: "card" as const, sub: "adds the skill to your agent", items: [], detail: null };
    const post = measureNode(card, { post: true });
    expect(post.sub).toBe(card.sub);
    expect(post.w).toBeGreaterThan(176);
    expect(post.w).toBeLessThanOrEqual(204);
    expect(measureNode({ ...card, sub: "reads code" }, { post: true }).w).toBe(176);
    expect(measureNode(card).w).toBe(196);
  });
});

describe("the report's longest connection is the routed curve's length (H42)", () => {
  it("measures the curve, not a chord across it", () => {
    const v = { id: "overview", title: "t", caption: { title: "", lede: "" }, texts: [], postOf: null,
      nodes: [node("start", { x: 300, y: 0 }), node("other", { x: 300, y: 220 }), node("end", { x: 300, y: 440 })], edges: [{ ...edge("start", "end"), id: "e1" }] };
    const doc = { schema: "archdraw/diagram@2", id: "d_abc123", title: "t", theme: "light", warnings: [], source: null, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", views: [v] } as unknown as Parameters<typeof layoutReport>[0];
    const rects = layoutRects(v as Parameters<typeof layoutRects>[0]), r = routeEdges(v as Parameters<typeof routeEdges>[0], rects).get("e1")!;
    let len = 0, prev = bezierAt(r, 0);
    for (let i = 1; i <= 20000; i++) { const p = bezierAt(r, i / 20000); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
    const boxes = [...rects.values()], x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const diagonal = Math.hypot(Math.max(...boxes.map((b) => b.x + b.w)) - x0, Math.max(...boxes.map((b) => b.y + b.h)) - y0);
    const report = layoutReport(doc, "overview", { ...startSwitches("readme", false), format: "readme", theme: "light" });
    expect(report.longestConnection).toBeCloseTo(len / diagonal, 3);
  });
});
