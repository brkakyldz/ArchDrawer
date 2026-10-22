import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bezierAt, layoutRects, routeEdges, type Rect } from "./geometry";
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
      // It reports exactly the other parts it passes behind.
      const pts = Array.from({ length: 49 }, (_, i) => bezierAt(r, i / 48));
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
  it.each(cases.map((c) => [c.name, c] as const))("every handle is at least 24 px: %s", (_name, { view, post }) => {
    const rects = layoutRects(view, { post }), routes = routeEdges(view, rects, { post });
    // Edges without an id (the raw example file) are given one when a file is read.
    for (const c of view.edges.filter((e) => e.id).map((e) => routes.get(e.id)!).filter(Boolean)) {
      expect(Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y), c.id).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(Math.hypot(c.p1.x - c.c2.x, c.p1.y - c.c2.y), c.id).toBeGreaterThanOrEqual(24 - 1e-6);
    }
    // And as drawn: the path's numbers are rounded to 0.1 px.
    for (const e of view.edges.filter((x) => x.id)) {
      const r = routes.get(e.id);
      if (!r) continue;
      const n = r.d.match(/-?[\d.]+/g)!.map(Number), pts = Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[2 * i], y: n[2 * i + 1] }));
      for (let i = 0; i + 3 < pts.length; i += 3) {
        expect(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y), `${e.id} drawn`).toBeGreaterThanOrEqual(24);
        expect(Math.hypot(pts[i + 3].x - pts[i + 2].x, pts[i + 3].y - pts[i + 2].y), `${e.id} drawn`).toBeGreaterThanOrEqual(24);
      }
    }
  });
});
