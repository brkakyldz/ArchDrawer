import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutRects, overlaps } from "./geometry";
import { layoutView } from "./layout";
import { validateFile, type DiagramNode, type NodeInput } from "./model";
import { edge, node } from "./testkit";

const layout = (nodes: NodeInput[], edges: ReturnType<typeof edge>[]) => layoutView({ nodes, edges }).nodes;
const at = (nodes: DiagramNode[], id: string) => nodes.find((n) => n.id === id)!;
const centre = (nodes: DiagramNode[], id: string) => { const r = layoutRects({ nodes }).get(id)!; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

function noOverlaps(nodes: DiagramNode[], post = false) {
  const rects = layoutRects({ nodes }, { post });
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

describe("a zone's box holds only its members, whatever the input order (#136)", () => {
  const zoned = (outsideFirst: boolean, portrait: boolean) => {
    const outside = node("x", { lane: { anchor: "a", side: "above" } });
    const member = node("b", { parent: "z", lane: { anchor: "a", side: "above" } });
    const nodes = [node("z", { form: "group" }), node("a", { parent: "z", lane: { spine: 0 } }), ...(outsideFirst ? [outside, member] : [member, outside])];
    return layoutView({ nodes, edges: [] }, portrait ? { portrait, post: true } : {}).nodes;
  };
  for (const outsideFirst of [true, false]) for (const portrait of [false, true]) {
    it(`keeps an outside part out of the zone (${outsideFirst ? "outside part first" : "member first"}${portrait ? ", portrait post" : ""})`, () => {
      const nodes = zoned(outsideFirst, portrait);
      const r = layoutRects({ nodes }, { post: portrait });
      expect(overlaps(r.get("z")!, r.get("x")!)).toBe(false);
      noOverlaps(nodes, portrait);
    });
  }
  it("keeps outside parts out of two zones whose members anchor on the same side", () => {
    const nodes: NodeInput[] = [
      node("z1", { form: "group" }), node("a", { parent: "z1", lane: { spine: 0 } }),
      node("z2", { form: "group" }), node("c", { parent: "z2", lane: { spine: 1 } }),
      node("x", { lane: { anchor: "a", side: "above" } }), node("y", { lane: { anchor: "c", side: "above" } }),
      node("b", { parent: "z1", lane: { anchor: "a", side: "above" } }), node("d", { parent: "z2", lane: { anchor: "c", side: "above" } }),
    ];
    const r = layoutRects({ nodes: layoutView({ nodes, edges: [] }).nodes });
    for (const z of ["z1", "z2"]) for (const o of ["x", "y"]) expect(overlaps(r.get(z)!, r.get(o)!), `${z} covers ${o}`).toBe(false);
    expect(overlaps(r.get("z1")!, r.get("z2")!)).toBe(false);
  });
});

describe("a new member keeps its group's grown box clear (#137)", () => {
  it("does not grow a group over a placed part outside it", () => {
    const placed = layout([node("g", { form: "group" }), node("a", { parent: "g" }), node("k")], []);
    const kept = placed.map((n) => (n.id === "a" ? { ...n, x: 58, y: 86 } : n.id === "k" ? { ...n, x: 400, y: 86 } : n));
    const next = layout([...kept, node("b", { parent: "g" })], [edge("b", "a"), edge("b", "k")]);
    expect(at(next, "a")).toMatchObject({ x: 58, y: 86 });
    expect(at(next, "k")).toMatchObject({ x: 400, y: 86 });
    noOverlaps(next);
  });
  // Kept-position fuzz: views of 33–60 parts where each group has room to grow (before the fix,
  // these three put a group over 2, 4 and 2 outside parts or groups).
  for (const [groupCount, partCount, seed0] of [[4, 56, 3], [5, 55, 21], [3, 30, 5]]) {
    it(`keeps every group clear when new members join a laid-out view (seed ${seed0})`, () => {
      let seed = seed0;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const groups = Array.from({ length: groupCount }, (_, i) => node(`g${i}`, { form: "group" }));
      const parts = Array.from({ length: partCount }, (_, i) => node(`p${i}`, { parent: rnd() < 0.6 ? `g${Math.floor(rnd() * groupCount)}` : null }));
      const pick = () => parts[Math.floor(rnd() * parts.length)].id;
      const edges = Array.from({ length: partCount }, (_, i) => ({ ...edge(pick(), pick()), id: `e${i}` })).filter((e) => e.from !== e.to);
      const placed = layoutView({ nodes: [...groups, ...parts], edges }).nodes;
      const fresh = groups.map((g, i) => node(`new${i}`, { parent: g.id }));
      const more = fresh.flatMap((n, i) => [{ ...edge(n.id, pick()), id: `f${i}` }, { ...edge(n.id, pick()), id: `h${i}` }]);
      const next = layoutView({ nodes: [...placed, ...fresh], edges: [...edges, ...more] }).nodes;
      for (const n of placed) if (n.form !== "group") expect(at(next, n.id)).toMatchObject({ x: n.x, y: n.y });
      noOverlaps(next);
    }, 30_000);
  }
});
