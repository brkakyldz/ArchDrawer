import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutRects, overlaps } from "./geometry";
import { layoutView } from "./layout";
import { validateFile, type DiagramNode, type NodeInput } from "./model";
import { edge, node } from "./testkit";

const layout = (nodes: NodeInput[], edges: ReturnType<typeof edge>[]) => layoutView({ nodes, edges }).nodes;
const at = (nodes: DiagramNode[], id: string) => nodes.find((n) => n.id === id)!;
const centre = (nodes: DiagramNode[], id: string) => { const r = layoutRects({ nodes }).get(id)!; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

function noOverlaps(nodes: DiagramNode[]) {
  const rects = layoutRects({ nodes });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anc = (id: string) => { const s = new Set<string>(); for (let p = byId.get(id)!.parent; p; p = byId.get(p)!.parent) s.add(p); return s; };
  for (const a of nodes) for (const b of nodes) {
    if (a.id >= b.id || anc(a.id).has(b.id) || anc(b.id).has(a.id)) continue;
    expect(overlaps(rects.get(a.id)!, rects.get(b.id)!), `${a.id} overlaps ${b.id}`).toBe(false);
  }
}

describe("grid layout", () => {
  it("puts hinted components in their cells: columns left to right, rows top to bottom", () => {
    const nodes = layout([
      node("a", { place: { row: 0, col: 0 } }), node("b", { place: { row: 0, col: 1 } }),
      node("up", { place: { row: -1, col: 1 } }), node("down", { place: { row: 1, col: 0 } }),
    ], []);
    expect(centre(nodes, "a").x).toBeLessThan(centre(nodes, "b").x);
    expect(centre(nodes, "up").y).toBeLessThan(centre(nodes, "b").y);
    expect(centre(nodes, "down").y).toBeGreaterThan(centre(nodes, "a").y);
    expect(Math.abs(centre(nodes, "up").x - centre(nodes, "b").x)).toBeLessThan(1);
    noOverlaps(nodes);
  });

  it("without hints, lays the main path along one row and side parts above or below it", () => {
    const nodes = layout([
      node("user", { kind: "actor" }), node("web", { kind: "client" }), node("api", { kind: "api" }), node("svc"),
      node("db", { kind: "data" }), node("logs", { kind: "ops" }),
    ], [
      edge("user", "web", { step: 1 }), edge("web", "api", { step: 2 }), edge("api", "svc", { step: 3 }),
      edge("svc", "db"), edge("api", "logs", { style: "dep" }),
    ]);
    const ys = ["user", "web", "api", "svc"].map((id) => centre(nodes, id).y);
    expect(new Set(ys.map(Math.round)).size).toBe(1);
    const xs = ["user", "web", "api", "svc"].map((id) => centre(nodes, id).x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    expect(centre(nodes, "db").y).toBeGreaterThan(ys[0]);
    expect(centre(nodes, "logs").y).not.toBe(ys[0]);
    noOverlaps(nodes);
  });

  it("wraps a loop inside a group into a square", () => {
    const nodes = layout([
      node("runtime", { form: "group", kind: "llm" }),
      ...["llm", "propose", "exec", "result"].map((id) => node(id, { form: "compact", kind: "llm", parent: "runtime" })),
    ], [edge("llm", "propose", { step: 1 }), edge("propose", "exec", { step: 2 }), edge("exec", "result", { step: 3 }), edge("result", "llm", { step: 4 })]);
    const xs = new Set(["llm", "propose", "exec", "result"].map((id) => Math.round(centre(nodes, id).x)));
    const ys = new Set(["llm", "propose", "exec", "result"].map((id) => Math.round(centre(nodes, id).y)));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    const g = layoutRects({ nodes }).get("runtime")!;
    for (const id of ["llm", "propose", "exec", "result"]) {
      const r = layoutRects({ nodes }).get(id)!;
      expect(r.x >= g.x && r.y >= g.y + 46 && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h).toBe(true);
    }
    expect(at(nodes, "runtime").x).toBe(g.x);
  });

  it("lays out a real session-written drawing without overlaps", () => {
    const f = validateFile(JSON.parse(readFileSync("tests/fixtures/hotel.archdraw.json", "utf8"))).file!;
    noOverlaps(layoutView(f.views[0]).nodes);
  });
});

describe("kept positions", () => {
  it("keeps components that have a position and places new ones beside them without overlap", () => {
    const first = layout([node("a", { place: { row: 0, col: 0 } }), node("b", { place: { row: 0, col: 1 } }), node("c", { place: { row: 1, col: 1 } })], [edge("a", "b")]);
    const moved = first.map((n) => (n.id === "b" ? { ...n, x: n.x + 37, y: n.y - 13 } : n));
    const next = layout([...moved, node("d", { place: { row: 0, col: 2 } }), node("e")], [edge("a", "b"), edge("b", "d"), edge("d", "e")]);
    for (const n of moved) expect(at(next, n.id)).toMatchObject({ x: n.x, y: n.y });
    noOverlaps(next);
  });

  it("is deterministic", () => {
    const input = [node("a"), node("b"), node("c", { kind: "data" })];
    const edges = [edge("a", "b", { step: 1 }), edge("b", "c")];
    expect(layout(input, edges)).toEqual(layout(input, edges));
  });
});

describe("a large view lays out in bounded time (registering one once hung the server)", () => {
  it("places 40 parts without lanes and 60 connections well inside 15 s", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const nodes = Array.from({ length: 40 }, (_, i) => node(`n${i}`));
    const edges: ReturnType<typeof edge>[] = [];
    for (let i = 0; i < 60; i++) {
      const a = Math.floor(rnd() * 40), b = Math.floor(rnd() * 40);
      if (a !== b && !edges.some((e) => (e.from === `n${a}` && e.to === `n${b}`) || (e.from === `n${b}` && e.to === `n${a}`))) edges.push({ ...edge(`n${a}`, `n${b}`), id: `e${i}` });
    }
    const t0 = Date.now();
    const v = layoutView({ nodes, edges });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(new Set(v.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(40);
  }, 30_000);
});
