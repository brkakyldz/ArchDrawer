import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bezierAt, groupNameBox, layoutRects, routeEdges, routeSamples, type Rect } from "./geometry";
import { drawView, headerColour } from "./export/svg";
import { PALETTES } from "./theme";
import { fillDefaults, type DiagramView } from "./model";
import { edge, node } from "./testkit";
import { storyFixture } from "../../scripts/story-fixtures";

/**
 * Every connection is one cubic that leaves and enters along its sides' normals and is never bent
 * round anything: it passes behind what is in its way and reports the parts it passes behind — over
 * the story fixtures in both formats, this repository's drawing, the examples and fuzzed views.
 */
type Case = { name: string; view: DiagramView; post: boolean };
const cases: Case[] = [];
for (const name of ["reference", "claude", "codex", "shop"]) for (const portrait of [true, false]) {
  for (const view of storyFixture(name, portrait).views) cases.push({ name: `story ${name} ${portrait ? "feed" : "wide"}`, view, post: true });
}
for (const path of ["tests/fixtures/archdrawer.archdraw.json", "tests/fixtures/shop.archdraw.json"]) {
  for (const view of fillDefaults(JSON.parse(readFileSync(path, "utf8"))).views) cases.push({ name: `${path} ${view.id}`, view: view as DiagramView, post: !!view.postOf });
}
// Fuzzed: parts on distinct cells of a loose grid, two groups holding the parts in their own corner
// of it (groups never overlap in a drawing), random lines.
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let k = 0; k < 40; k++) {
  const cells = new Set<string>();
  const nodes = [node("g1", { form: "group", label: "Runtime" }), node("g2", { form: "group", label: "Stores and queues" })];
  for (let i = 0; i < 12; i++) {
    let c = "";
    do c = `${Math.floor(rnd() * 7)},${Math.floor(rnd() * 5)}`; while (cells.has(c));
    cells.add(c);
    const [col, row] = c.split(",").map(Number);
    nodes.push(node(`n${i}`, { x: col * 290, y: row * 230 + 60, parent: col <= 2 && row <= 1 ? "g1" : col >= 4 && row >= 3 ? "g2" : null }));
  }
  const edges: ReturnType<typeof edge>[] = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.floor(rnd() * 12), b = Math.floor(rnd() * 12);
    if (a !== b && !edges.some((e) => [e.from, e.to].sort().join() === [`n${a}`, `n${b}`].sort().join())) edges.push({ ...edge(`n${a}`, `n${b}`), id: `e${i}` });
  }
  const view = fillDefaults({ version: 2, title: "fuzz", views: [{ id: `f${k}`, title: "Fuzz", caption: { what: "", how: "", notice: "" }, nodes, edges }] } as never).views[0] as DiagramView;
  cases.push({ name: `fuzz ${k}`, view, post: k % 2 === 1 });
}

const inside = (p: { x: number; y: number }, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const NORMAL = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] } as const;

describe("connections are smooth curves", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, { view, post }) => {
    const rects = layoutRects(view, { post }), routes = routeEdges(view, rects, { post });
    if (view.edges.length) expect(routes.size).toBeGreaterThan(0);
    for (const e of view.edges) {
      const r = routes.get(e.id);
      // The raw example file has parts without a position until it is laid out.
      if (!r || !Number.isFinite(r.p0.x + r.p1.x)) continue;
      expect(r.d, e.id).toMatch(/^M-?[\d.]+,-?[\d.]+ C[^MLHVC]*$/);
      // Each handle lies along its side's outward normal.
      const h0 = { x: r.c1.x - r.p0.x, y: r.c1.y - r.p0.y }, h1 = { x: r.c2.x - r.p1.x, y: r.c2.y - r.p1.y };
      expect(Math.abs(h0.x * NORMAL[r.side0][1] - h0.y * NORMAL[r.side0][0]), `${e.id} start handle`).toBeLessThan(1e-6);
      expect(h0.x * NORMAL[r.side0][0] + h0.y * NORMAL[r.side0][1], `${e.id} start handle`).toBeGreaterThan(0);
      expect(Math.abs(h1.x * NORMAL[r.side1][1] - h1.y * NORMAL[r.side1][0]), `${e.id} end handle`).toBeLessThan(1e-6);
      expect(h1.x * NORMAL[r.side1][0] + h1.y * NORMAL[r.side1][1], `${e.id} end handle`).toBeGreaterThan(0);
      // It reports exactly the other parts it passes behind, as the layout report measures them.
      const pts = routeSamples(r);
      const under = view.nodes.filter((n) => n.form !== "group" && n.id !== e.from && n.id !== e.to && rects.has(n.id) && pts.some((p) => inside(p, rects.get(n.id)!))).map((n) => n.id);
      expect(r.blocked ?? [], e.id).toEqual(under);
    }
  });
});

describe("a connection in the way of a part", () => {
  it("passes behind it as the plain curve, and reports it", () => {
    const view = fillDefaults({ version: 2, title: "behind", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
      node("a", { x: 0, y: 0 }), node("b", { x: 300, y: 0 }), node("c", { x: 600, y: 0 }),
    ], edges: [{ ...edge("a", "c"), id: "ac" }] }] } as never).views[0] as DiagramView;
    const rects = layoutRects(view, {}), r = routeEdges(view, rects, {}).get("ac")!;
    expect(r.blocked).toEqual(["b"]);
    expect(r.side0).toBe("r");
    expect(r.side1).toBe("l");
    // A straight run: both handles on the line between the ends.
    expect(r.c1.y).toBe(r.p0.y);
    expect(r.c2.y).toBe(r.p1.y);
  });
});

describe("handles", () => {
  // At least 24 px, except across a short gap between sides that face each other: never longer than the gap (or 8 px).
  const shortest = (r: { p0: { x: number; y: number }; p1: { x: number; y: number }; side0: keyof typeof NORMAL; side1: keyof typeof NORMAL }) => {
    const n0 = NORMAL[r.side0], n1 = NORMAL[r.side1], gap = (r.p1.x - r.p0.x) * n0[0] + (r.p1.y - r.p0.y) * n0[1];
    return n0[0] === -n1[0] && n0[1] === -n1[1] && gap > 0 ? Math.min(24, Math.max(gap, 8)) : 24;
  };
  it.each(cases.map((c) => [c.name, c] as const))("every handle is at least 24 px, or the short gap: %s", (_name, { view, post }) => {
    const rects = layoutRects(view, { post }), routes = routeEdges(view, rects, { post });
    // Edges without an id (the raw example file) are given one when a file is read.
    for (const c of view.edges.filter((e) => e.id).map((e) => routes.get(e.id)!).filter(Boolean)) {
      expect(Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y), c.id).toBeGreaterThanOrEqual(shortest(c) - 1e-6);
      expect(Math.hypot(c.p1.x - c.c2.x, c.p1.y - c.c2.y), c.id).toBeGreaterThanOrEqual(shortest(c) - 1e-6);
    }
    // And as drawn: the path's numbers are rounded to 0.1 px.
    for (const e of view.edges.filter((x) => x.id)) {
      const r = routes.get(e.id);
      if (!r) continue;
      const n = r.d.match(/-?[\d.]+/g)!.map(Number), pts = Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[2 * i], y: n[2 * i + 1] }));
      for (let i = 0; i + 3 < pts.length; i += 3) {
        expect(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y), `${e.id} drawn`).toBeGreaterThanOrEqual(shortest(r) - 0.1);
        expect(Math.hypot(pts[i + 3].x - pts[i + 2].x, pts[i + 3].y - pts[i + 2].y), `${e.id} drawn`).toBeGreaterThanOrEqual(shortest(r) - 0.1);
      }
    }
  });
});

describe("a connection never runs through its own parts", () => {
  const routeOf = (nodes: ReturnType<typeof node>[], from: string, to: string) => {
    const v = fillDefaults({ version: 2, title: "own", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes, edges: [{ ...edge(from, to), id: "e" }] }] } as never).views[0] as DiagramView;
    const rects = layoutRects(v);
    return { rects, r: routeEdges(v, rects).get("e")! };
  };
  const intoPart = (r: ReturnType<typeof routeOf>["r"], b: Rect) => routeSamples(r).some((p) => inside(p, { x: b.x + 0.5, y: b.y + 0.5, w: b.w - 1, h: b.h - 1 }));

  it("from a part to the group holding it: out of the side nearest the group's border, into that border", () => {
    const { rects, r } = routeOf([node("g", { form: "group", label: "Zone" }), node("a", { parent: "g", x: 18, y: 64 })], "a", "g");
    const a = rects.get("a")!, g = rects.get("g")!;
    expect([r.side0, r.side1]).toEqual(["b", "b"]);
    expect(r.p0.y).toBe(a.y + a.h);
    expect(r.p1.y).toBe(g.y + g.h);
    expect(intoPart(r, a)).toBe(false);
  });

  it("between two touching parts: a bend out of and into one side, never a curve of no length", () => {
    const { rects, r } = routeOf([node("b", { x: 400, y: 40 }), node("c", { x: 400, y: 148 })], "b", "c");
    const b = rects.get("b")!, c = rects.get("c")!;
    expect(b.y + b.h).toBe(c.y);
    expect([r.side0, r.side1]).toEqual(["r", "r"]);
    expect(Math.hypot(r.p1.x - r.p0.x, r.p1.y - r.p0.y)).toBeGreaterThan(50);
    expect(intoPart(r, b) || intoPart(r, c)).toBe(false);
  });
});

describe("a post's spine line hidden behind parts turns out on one side", () => {
  const view = (extra: ReturnType<typeof node>[], postOf: string | null) => fillDefaults({ version: 2, title: "spine", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, postOf, nodes: [
    node("a", { x: 0, y: 0 }), node("x", { x: 0, y: 200 }), node("b", { x: 0, y: 400 }), ...extra,
  ], edges: [{ ...edge("a", "b"), id: "ab" }] }] } as never).views[0] as DiagramView;
  const route = (v: DiagramView, post: boolean) => { const rects = layoutRects(v, { post }); return { rects, r: routeEdges(v, rects, { post }).get("ab")! }; };

  it("as one cubic out of and into the same side, right on a tie, clear of the part by 8 px", () => {
    const { rects, r } = route(view([], "p"), true), x = rects.get("x")!;
    expect([r.side0, r.side1]).toEqual(["r", "r"]);
    expect(r.d).toMatch(/^M-?[\d.]+,-?[\d.]+ C[^MLHVC]*$/);
    expect(r.blocked).toBeUndefined();
    const h = Math.hypot(r.c1.x - r.p0.x, r.c1.y - r.p0.y);
    expect(h).toBeGreaterThanOrEqual(24);
    expect(h).toBeLessThanOrEqual(160);
    const grown = { x: x.x - 8, y: x.y - 8, w: x.w + 16, h: x.h + 16 };
    expect(Array.from({ length: 129 }, (_, i) => bezierAt(r, i / 128)).some((p) => inside(p, grown))).toBe(false);
  });

  it("stays straight behind the part when no turn-out within 160 px clears its neighbours", () => {
    const { r } = route(view([node("left", { x: -200, y: 200 }), node("right", { x: 200, y: 200 })], "p"), true);
    expect([r.side0, r.side1]).toEqual(["b", "t"]);
    expect(r.blocked).toEqual(["x"]);
  });

  it("stays straight behind the part outside a post", () => {
    const { r } = route(view([], null), false);
    expect([r.side0, r.side1]).toEqual(["b", "t"]);
    expect(r.blocked).toEqual(["x"]);
  });
});

describe("a group's name stands on a halo; nothing is cut out of a line (#176, diagram contract A group's name)", () => {
  const view = (groups: boolean) => fillDefaults({ version: 2, title: "names", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
    ...(groups ? [node("g1", { form: "group", label: "Runtime", sub: "the local server" }), node("g2", { form: "group", label: "" })] : []),
    node("a", { x: 0, y: 0, parent: groups ? "g1" : null }), node("b", { x: 0, y: 400, parent: groups ? "g2" : null }),
  ], edges: [{ ...edge("a", "b", { label: "calls" }), id: "ab" }] }] } as never).views[0] as DiagramView;

  it("draws each group as its frame under the connections and its head over them, under the parts, with no clip", () => {
    const body = drawView(view(true), PALETTES.light, { prefix: "ad" }).body;
    // No line is clipped (a frame's glow keeps its own mask, outside the frame).
    const edgeG = body.slice(body.indexOf('<g data-edge-id="ab"'), body.indexOf("<g data-group-head"));
    expect(edgeG).not.toMatch(/clip-path|<mask/);
    expect(body).not.toContain("-names");
    const at = (s: string) => body.indexOf(s);
    for (const g of ["g1", "g2"]) {
      expect(at(`<g data-node-id="${g}"`)).toBeLessThan(at('<g data-edge-id="ab"'));
      expect(at(`<g data-group-head="${g}">`)).toBeGreaterThan(at('<g data-edge-id="ab"'));
      expect(at(`<g data-group-head="${g}">`)).toBeLessThan(at('<g data-node-id="a"'));
    }
    // The frame holds no text; the head holds the name and the sub-line, each on a halo in the header's colour.
    const frame = body.slice(at('<g data-node-id="g1"'), body.indexOf("</g>", at('<g data-node-id="g1"')));
    expect(frame).not.toContain("<text");
    const head = body.slice(at('<g data-group-head="g1">'), at('<g data-group-head="g2">'));
    const halo = `stroke="${headerColour(PALETTES.light, "service")}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;
    expect(head.match(/<text[^>]*>/g)!.map((t) => t.includes(halo))).toEqual([true, true]);
    expect(head).toContain(">Runtime</text>");
    expect(head).toContain(">the local server</text>");
  });

  it("a first-row member narrower than its group's name, entered from above, gets its line all the way to its port", () => {
    const v = fillDefaults({ version: 2, title: "halo", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
      node("top", { x: 40, y: -300 }),
      node("zone", { form: "group", label: "A group name far wider than its member" }),
      node("m", { label: "API", form: "compact", parent: "zone", x: 0, y: 0 }),
    ], edges: [{ ...edge("top", "m"), id: "down" }] }] } as never).views[0] as DiagramView;
    const rects = layoutRects(v), r = routeEdges(v, rects).get("down")!, m = rects.get("m")!, zone = rects.get("zone")!;
    // The member is narrower than the name, so its port stays under the name …
    expect(m.w).toBeLessThan(groupNameBox(v.nodes.find((n) => n.id === "zone")!, zone).w);
    expect(r.side1).toBe("t");
    expect(r.p1.y).toBeCloseTo(m.y, 0);
    // … and the line is drawn whole across the header: one path, from the source to the port, nothing clipped.
    const body = drawView(v, PALETTES.light, { prefix: "ad" }).body;
    const line = body.slice(body.indexOf('<g data-edge-id="down"'), body.indexOf('<g data-group-head="zone">'));
    expect(line).toContain(`d="${r.d}"`);
    expect(line).not.toMatch(/clip-path|<mask/);
    expect(body.indexOf('<g data-group-head="zone">')).toBeGreaterThan(body.indexOf('<g data-edge-id="down"'));
  });

  it("draws no head without a group", () => {
    expect(drawView(view(false), PALETTES.light, { prefix: "ad" }).body).not.toContain("data-group-head");
  });
});
