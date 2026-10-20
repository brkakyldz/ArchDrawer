import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARC, bezierAt, GROUP, groupNameBox, layoutRects, routeEdges, type Rect } from "./geometry";
import { fillDefaults, type DiagramView } from "./model";
import { edge, node } from "./testkit";
import { storyFixture } from "../../scripts/story-fixtures";

/**
 * Every connection is one cubic or a chain of at most three meeting without a
 * corner, no arc is longer than the cap, and no connection runs through a group's name — over the
 * story fixtures in both formats, this repository's drawing, the examples and fuzzed views.
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
const angle = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

describe("connections are smooth curves", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, { view, post }) => {
    const rects = layoutRects(view, { post }), routes = routeEdges(view, rects, { post });
    if (view.edges.length) expect(routes.size).toBeGreaterThan(0);
    for (const e of view.edges) {
      const r = routes.get(e.id);
      if (!r) continue;
      expect(r.d, e.id).toMatch(/^M[^LHV]*$/);
      const segs = r.segments ?? [r];
      expect(segs.length, e.id).toBeLessThanOrEqual(3);
      for (let i = 1; i < segs.length; i++) {
        let diff = Math.abs(angle(segs[i - 1].c2, segs[i - 1].p1) - angle(segs[i].p0, segs[i].c1)) * 180 / Math.PI;
        if (diff > 180) diff = 360 - diff;
        expect(diff, `${e.id} joint ${i}`).toBeLessThanOrEqual(1);
      }
      const pts = segs.flatMap((s) => Array.from({ length: 81 }, (_, i) => bezierAt(s, i / 80)));
      if (r.segments && !r.blocked) {
        const a = rects.get(e.from)!, b = rects.get(e.to)!;
        const d = Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
        let length = 0;
        for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        expect(length, `${e.id} length`).toBeLessThanOrEqual(Math.max(ARC.cap * d, d + ARC.plus) + 1);
      }
      // Clear of parts: never inside its own ends (it starts on their border) and, unless reported
      // blocked, never inside any other part.
      for (const n of view.nodes) {
        if (n.form === "group" || !rects.has(n.id) || (r.blocked && n.id !== e.from && n.id !== e.to)) continue;
        const b = rects.get(n.id)!, inner = { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 };
        expect(pts.some((p) => inside(p, inner)), `${e.id} (${e.from}->${e.to}${r.blocked ? " blocked" : ""}, ${(r.segments ?? [r]).length} cubics) inside ${n.id}`).toBe(false);
      }
      for (const g of view.nodes) {
        if (g.form !== "group" || g.id === e.from || g.id === e.to || !rects.has(g.id)) continue;
        const name = groupNameBox(g, rects.get(g.id)!, post);
        expect(pts.some((p) => inside(p, { ...name, h: Math.min(name.h, GROUP.head) })), `${e.id} through ${g.id}'s name`).toBe(false);
      }
    }
  });
});

describe("the fallback over parts", () => {
  it("is the shortest curve clear of a group's name, within 0.5 %, and only the name is kept off", () => {
    // A stored panel under both ends: no arc fits. A group's name sits across the straight line,
    // the rest of its header does not count. The shortest curve over the name with every handle
    // at least 24 px is 348.0 long (found by a free optimiser).
    const view = fillDefaults({ version: 2, title: "fallback", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
      node("wall", { form: "panel", x: 40, y: 0, items: ["W".repeat(44), ...Array.from({ length: 11 }, (_, i) => `Stored operation ${i + 1}`)] }),
      node("start", { x: 60, y: 150 }), node("end", { x: 600, y: 150 }),
      node("zone", { form: "group", label: "Barrier", x: 382, y: 182 }), node("member", { form: "compact", label: "Member", x: 400, y: 228.44741382697174, parent: "zone" }),
    ], edges: [{ ...edge("start", "end"), id: "blocked" }] }] } as never).views[0] as DiagramView;
    const rects = layoutRects(view, {}), r = routeEdges(view, rects, {}).get("blocked")!;
    expect(r.blocked).toContain("wall");
    const name = groupNameBox(view.nodes.find((n) => n.id === "zone")!, rects.get("zone")!);
    expect(name.w).toBeLessThan(rects.get("zone")!.w);
    const pts = (r.segments ?? [r]).flatMap((c) => Array.from({ length: 4001 }, (_, i) => bezierAt(c, i / 4000)));
    expect(pts.some((p) => inside(p, name))).toBe(false);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    expect(length).toBeLessThanOrEqual(348.0 * 1.005);
  });
});

describe("handles", () => {
  it.each(cases.map((c) => [c.name, c] as const))("every handle is at least 24 px: %s", (_name, { view, post }) => {
    const rects = layoutRects(view, { post }), routes = routeEdges(view, rects, { post });
    // Edges without an id (the raw example file) are given one when a file is read.
    for (const r of view.edges.filter((e) => e.id).map((e) => routes.get(e.id)!).filter(Boolean)) for (const c of r.segments ?? [r]) {
      expect(Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y), r.id).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(Math.hypot(c.p1.x - c.c2.x, c.p1.y - c.c2.y), r.id).toBeGreaterThanOrEqual(24 - 1e-6);
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
