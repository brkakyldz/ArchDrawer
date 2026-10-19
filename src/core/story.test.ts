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
    it(`${name}, ${format}: no crossing, nothing over a part or a group's name, nothing cut${format === "feed" ? ", readable in place" : ""}`, () => {
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
      for (const e of edges) for (const n of view.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        const r = rects.get(n.id)!;
        // A line may enter the group holding its end, never through the group's name.
        const box = n.form === "group" ? groupNameBox(n, r, true) : r;
        expect(poly.get(e.id)!.some((p) => inside(p, box)), `${e.id} over ${n.id}`).toBe(false);
      }
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

  it("comes in from a side when the name covers the part's whole top", () => {
    const { route, crosses } = entry("A zone with a rather long name for its one part");
    expect(["l", "r"]).toContain(route.side1);
    expect(crosses).toBe(false);
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

describe("a group's name is never crossed", () => {
  it("by a line into a first-row member from any source above, in either style", () => {
    let checked = 0;
    for (const post of [false, true]) for (const label of ["Zone", "Runtime", "Agent runtime with tools"]) for (let dx = -700; dx <= 900; dx += 80) for (const dy of [-260, -160]) for (const mx of [18, 260]) {
      const v = { nodes: [node("top", { x: dx, y: 200 + dy }), node("z", { form: "group", label, x: 0, y: 200 }), node("in", { parent: "z", x: mx, y: 246 }), node("in2", { parent: "z", x: mx === 18 ? 260 : 18, y: 246 })], edges: [{ ...edge("top", "in"), id: "e" }] } as Parameters<typeof routeEdges>[0];
      const rects = layoutRects(v, { post }), s = rects.get("top")!, z = rects.get("z")!;
      if (s.x < z.x + z.w + 24 && s.x + s.w > z.x - 24 && s.y + s.h > z.y - 24) continue;
      const route = routeEdges(v, rects, { post }).get("e")!, name = groupNameBox(v.nodes[1], z, post);
      checked++;
      expect(Array.from({ length: 513 }, (_, i) => bezierAt(route, i / 512)).some((p) => inside(p, name)), `${post} ${label} ${dx},${dy} ${mx}`).toBe(false);
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("an arc around a part weighs a crossing against its length", () => {
  it("clears the part by a smooth arc within the cap, crossing the row's line when going round it would cost more", () => {
    // a → b runs along the top row; c → d has to get past the part in between and the row's line.
    const v = { nodes: [node("a", { x: 0, y: 0 }), node("b", { x: 700, y: 0 }), node("x", { x: 350, y: 180 }), node("c", { x: 350, y: 420 }), node("d", { x: 350, y: -320 })],
      edges: [{ ...edge("a", "b"), id: "e1" }, { ...edge("c", "d"), id: "e2" }] } as Parameters<typeof routeEdges>[0];
    const rects = layoutRects(v), routes = routeEdges(v, rects);
    // Samples shifted off the middle, so a sample landing exactly on the other line cannot hide a crossing.
    const line = (id: string) => [bezierAt(routes.get(id)!, 0), ...Array.from({ length: 255 }, (_, i) => bezierAt(routes.get(id)!, (i + 1.31) / 256)), bezierAt(routes.get(id)!, 1)];
    const top = line("e1"), around = line("e2"), r = routes.get("e2")!;
    expect(r.d).toMatch(/^M[^LHV]*$/);
    expect(around.some((p) => inside(p, rects.get("x")!))).toBe(false);
    // Going round a or b to avoid the row's line is longer than one crossing's cost (0.25 of the
    // centre distance), so the arc crosses it once.
    expect(around.slice(1).some((p, s) => top.slice(1).some((q, t) => cross(around[s], p, top[t], q)))).toBe(true);
    const c = rects.get("c")!, d = rects.get("d")!, centres = Math.hypot(c.x - d.x, c.y - d.y);
    let length = 0;
    for (let i = 1; i < around.length; i++) length += Math.hypot(around[i].x - around[i - 1].x, around[i].y - around[i - 1].y);
    expect(length).toBeLessThanOrEqual(Math.max(1.8 * centres, centres + 120) + 1);
  });
});

describe("a post line clear of parts takes an arc when it costs less than crossing", () => {
  it("dips under the earlier line's end in a post, and a detail view keeps its curve", () => {
    // a → b runs down; c → d would cross it just above b, where dipping under b is cheaper than crossing.
    const v = { nodes: [node("a", { x: 0, y: 0 }), node("b", { x: 0, y: 300 }), node("c", { x: -350, y: 240 }), node("d", { x: 350, y: 240 })],
      edges: [{ ...edge("a", "b"), id: "e1" }, { ...edge("c", "d"), id: "e2" }] } as Parameters<typeof routeEdges>[0];
    const line = (r: ReturnType<typeof routeEdges>, id: string) => [bezierAt(r.get(id)!, 0), ...Array.from({ length: 255 }, (_, i) => bezierAt(r.get(id)!, (i + 1.31) / 256)), bezierAt(r.get(id)!, 1)];
    const crosses = (r: ReturnType<typeof routeEdges>) => { const top = line(r, "e1"), up = line(r, "e2"); return up.slice(1).some((p, s) => top.slice(1).some((q, t) => cross(up[s], p, top[t], q))); };
    const rects = layoutRects(v, { post: true }), post = routeEdges(v, rects, { post: true });
    expect(post.get("e2")!.d).toMatch(/^M[^LHV]*$/);
    expect(crosses(post)).toBe(false);
    expect(line(post, "e2").some((p) => ["a", "b"].some((id) => inside(p, rects.get(id)!)))).toBe(false);
    const detail = routeEdges(v, layoutRects(v));
    expect(crosses(detail)).toBe(true);
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

describe("an arc around a part straight between its ends goes right on a tie", () => {
  it("takes the right side when both sides cost the same, in an ordinary view", () => {
    const v = { nodes: [node("start", { x: 300, y: 0 }), node("other", { x: 300, y: 220 }), node("end", { x: 300, y: 440 })], edges: [{ ...edge("start", "end"), id: "e1" }] } as Parameters<typeof routeEdges>[0];
    const rects = layoutRects(v), r = routeEdges(v, rects).get("e1")!;
    const other = rects.get("other")!;
    expect(r.d).toMatch(/^M[^LHV]*$/);
    const xs = Array.from({ length: 201 }, (_, i) => bezierAt(r, i / 200).x);
    expect(xs.filter((x) => x > other.x + other.w).length).toBeGreaterThan(0);
    expect(xs.every((x) => x > other.x)).toBe(true);
  });
});

describe("a line into a first-row member under a long group name (H67)", () => {
  it("comes in by the side with room when a neighbour sits close on the other, never through the name", () => {
    let checked = 0;
    for (const gap of [24, 32, 40, 64]) for (const post of [false, true]) {
      const v = { nodes: [node("g", { form: "group", label: "W".repeat(48) }), node("left", { parent: "g", x: 330 - 196 - gap, y: 320 }), node("target", { parent: "g", x: 330, y: 320 }), node("source", { x: 330, y: 0 })],
        edges: [{ ...edge("source", "target"), id: "e1" }], postOf: post ? "x" : null } as Parameters<typeof routeEdges>[0];
      const rects = layoutRects(v, { post }), r = routeEdges(v, rects, { post }).get("e1")!;
      const name = groupNameBox(v.nodes[0], rects.get("g")!, post);
      for (let i = 0; i <= 2000; i++) { const p = bezierAt(r, i / 2000); checked++; expect(inside(p, name), `gap ${gap} post ${post}`).toBe(false); }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("keeps the side nearer the group's edge when parts touch both sides, never another side", () => {
    for (const post of [false, true]) {
      const v = { nodes: [node("g", { form: "group", label: "W".repeat(48) }), node("left", { parent: "g", x: 134, y: 320 }), node("target", { parent: "g", x: 330, y: 320 }),
        node("right", { parent: "g", x: 526, y: 320 }), node("source", { x: 330, y: 0 })],
        edges: [{ ...edge("source", "target"), id: "e1" }], postOf: post ? "x" : null } as Parameters<typeof routeEdges>[0];
      const rects = layoutRects(v, { post }), g = rects.get("g")!, t = rects.get("target")!;
      const nearer = t.x - g.x <= g.x + g.w - t.x - t.w ? "l" : "r";
      const r = routeEdges(v, rects, { post }).get("e1")!, name = groupNameBox(v.nodes[0], g, post);
      expect(r.side1, `post ${post}`).toBe(nearer);
      for (let i = 0; i <= 2000; i++) expect(inside(bezierAt(r, i / 2000), name), `post ${post} at ${i}`).toBe(false);
    }
  });
});

describe("the report's longest connection is the routed curve's length (H42)", () => {
  it("measures an arc along its curve, not a chord across it", () => {
    const v = { id: "overview", title: "t", caption: { title: "", lede: "" }, texts: [], postOf: null,
      nodes: [node("start", { x: 300, y: 0 }), node("other", { x: 300, y: 220 }), node("end", { x: 300, y: 440 })], edges: [{ ...edge("start", "end"), id: "e1" }] };
    const doc = { schema: "archdraw/diagram@2", id: "d_abc123", title: "t", theme: "light", warnings: [], source: null, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", views: [v] } as unknown as Parameters<typeof layoutReport>[0];
    const rects = layoutRects(v as Parameters<typeof layoutRects>[0]), r = routeEdges(v as Parameters<typeof routeEdges>[0], rects).get("e1")!;
    expect(Array.from({ length: 201 }, (_, i) => bezierAt(r, i / 200).x).some((x) => x > 300 + 196)).toBe(true);
    let len = 0, prev = bezierAt(r, 0);
    for (let i = 1; i <= 20000; i++) { const p = bezierAt(r, i / 20000); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
    const boxes = [...rects.values()], x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const diagonal = Math.hypot(Math.max(...boxes.map((b) => b.x + b.w)) - x0, Math.max(...boxes.map((b) => b.y + b.h)) - y0);
    const report = layoutReport(doc, "overview", { ...startSwitches("readme", false), format: "readme", theme: "light" });
    expect(report.longestConnection).toBeCloseTo(len / diagonal, 3);
  });
});

describe("a post line blocked only by parts keeps its own free side", () => {
  it("does not swap to a pair of like sides when no earlier line is crossed", () => {
    let checked = 0;
    for (const gap of [16, 24, 32]) for (const gap2 of [40, 64, 100]) {
      const v = { nodes: [node("g", { form: "group", label: "W".repeat(48) }), node("peer", { parent: "g", x: 330 - 176 - gap, y: 320 }), node("target", { parent: "g", x: 330, y: 320 }),
        node("peerRight", { parent: "g", x: 330 + 176 + gap2, y: 320 }), node("source", { x: 330, y: 0 })], edges: [{ ...edge("source", "target"), id: "e1" }], postOf: "x" } as Parameters<typeof routeEdges>[0];
      const r = routeEdges(v, layoutRects(v, { post: true }), { post: true }).get("e1")!;
      checked++;
      expect(["l", "r"], `gap ${gap}/${gap2}`).toContain(r.side1);
    }
    expect(checked).toBe(9);
  });
});
