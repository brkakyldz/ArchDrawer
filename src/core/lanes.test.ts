import { describe, expect, it } from "vitest";
import { layoutRects, overlaps, routeEdges, labelWidth, LABEL, BADGE } from "./geometry";
import { layoutView } from "./layout";
import { fillDefaults, validateFile } from "./model";
import { file, node, edge } from "./testkit";
import { storyFixture } from "../../scripts/story-fixtures";
import { normalizeFile } from "./normalize";
import { answerToDocument, documentToDraft } from "./repair";
import { drawView } from "./export/svg";
import { PALETTES } from "./theme";

describe("relational lanes", () => {
  it("defaults old files and rejects malformed, duplicate and self-anchored lanes", () => {
    const f = file([node("a"), node("b")]);
    expect(fillDefaults(f).views[0].nodes.map((n) => [n.lane, n.from])).toEqual([[null, []], [null, []]]);
    f.views[0].nodes[0].lane = { spine: 0 };
    f.views[0].nodes[1].lane = { spine: 0 };
    expect(validateFile(f).errors.join(" ")).toMatch(/unique among siblings/);
    f.views[0].nodes[1].lane = { anchor: "b", side: "below" };
    expect(validateFile(f).errors.join(" ")).toMatch(/anchor/);
    f.views[0].nodes[1].lane = { spine: -1 };
    expect(validateFile(f).ok).toBe(false);
  });
  it("spreads satellites in neighbouring columns, with lane before place", () => {
    const nodes = [0, 1, 2].map((i) => node(`s${i}`, { lane: { spine: i } }));
    nodes.push(...[0, 1, 2].map((i) => node(`p${i}`, { lane: { anchor: "s1", side: "below" }, place: { row: -5, col: -5 } })));
    const v = layoutView({ nodes, edges: [] });
    const spine = v.nodes.slice(0, 3), sides = v.nodes.slice(3);
    expect(spine.map((n) => n.x)).toEqual([...spine.map((n) => n.x)].sort((a, b) => a - b));
    expect(new Set(sides.map((n) => n.y)).size).toBe(1);
    expect(new Set(sides.map((n) => n.x)).size).toBe(3);
    expect(sides.every((n) => n.y > spine[1].y)).toBe(true);
    expect(Math.min(...sides.map((n) => n.x))).toBeGreaterThanOrEqual(spine[0].x);
  });
  it("wraps portrait spine units, honours zone interiors, and preserves stored positions", () => {
    const doc = storyFixture("reference", true, false), v = doc.views[0];
    const n = (id: string) => v.nodes.find((n) => n.id === id)!;
    expect(n("browser").x).toBeLessThan(n("scope").x);
    expect(n("loop").y).toBeGreaterThan(n("scope").y);
    expect(n("loop").x).toBeGreaterThan(n("domain").x);
    expect(n("limits").y).toBeGreaterThan(n("loop").y);
    expect(n("notify").y).toBeLessThan(n("loop").y);
    const rects = layoutRects(v);
    for (const a of v.nodes) for (const b of v.nodes) if (a.id < b.id && a.parent !== b.id && b.parent !== a.id) expect(overlaps(rects.get(a.id)!, rects.get(b.id)!), `${a.id}/${b.id}`).toBe(false);
    expect(layoutView(v, { portrait: false }).nodes).toEqual(v.nodes);
  });
  it("reserves no gap for hidden labels", () => {
    const v = { nodes: [node("a"), node("b")], edges: [edge("a", "b", { label: "A long label along the connection", step: 1 })] };
    expect(layoutView(v, { labels: false }).nodes[1].x).toBeLessThan(layoutView(v).nodes[1].x);
  });
  it("keeps a group's explicit outer lane instead of its child's inner order", () => {
    const v = layoutView({ nodes: [node("a", { lane: { spine: 1 } }), node("zone", { form: "group", lane: { spine: 2 } }), node("child", { parent: "zone", lane: { spine: 0 } })], edges: [] });
    expect(v.nodes.find((n) => n.id === "a")!.x).toBeLessThan(v.nodes.find((n) => n.id === "zone")!.x);
  });
  it("puts a zone with its own side lane beside the zone it names, not on the main path", () => {
    const zone = (id: string, lane: { spine: number } | { anchor: string; side: "above" | "below" }, members: string[]) => [node(id, { form: "group", lane }), ...members.map((m, i) => node(m, { parent: id, lane: { spine: i } }))];
    const nodes = [...zone("left", { spine: 0 }, ["l1", "l2"]), ...zone("server", { spine: 1 }, ["s1", "s2"]), ...zone("engines", { anchor: "server", side: "above" }, ["e1"]), ...zone("disk", { anchor: "server", side: "below" }, ["d1", "d2"])];
    const v = layoutView({ nodes, edges: [] });
    const rects = layoutRects(v), r = (id: string) => rects.get(id)!;
    expect(r("engines").y + r("engines").h).toBeLessThanOrEqual(r("server").y);
    expect(r("disk").y).toBeGreaterThanOrEqual(r("server").y + r("server").h);
    expect(r("left").y).toBeLessThan(r("server").y + r("server").h);
    expect(r("server").y).toBeLessThan(r("left").y + r("left").h);
    const zones = ["left", "server", "engines", "disk"];
    for (const [i, a] of zones.entries()) for (const b of zones.slice(i + 1)) expect(overlaps(r(a), r(b)), `${a} and ${b}`).toBe(false);
  });
  it("lays out and draws a line to a zone itself (a live run once crashed on one)", () => {
    const nodes = [node("a", { lane: { spine: 0 } }), node("z", { form: "group", lane: { spine: 1 } }), node("m1", { parent: "z", lane: { spine: 0 } }), node("m2", { parent: "z", lane: { spine: 1 } }), node("p")];
    const edges = [{ ...edge("a", "z", { step: 1 }), id: "e1" }, { ...edge("p", "z"), id: "e2" }];
    for (const post of [false, true]) {
      const v = layoutView({ nodes, edges }, { post });
      const rects = layoutRects(v, { post });
      expect(routeEdges(v, rects, { post }).size).toBe(2);
      expect(rects.get("a")!.x).toBeLessThan(rects.get("z")!.x);
    }
  });
  it("reserves lane cells before ordinary place hints, independent of input order", () => {
    const v = layoutView({ nodes: [node("plain", { place: { row: 0, col: 0 } }), node("second", { lane: { spine: 1 } }), node("first", { lane: { spine: 0 } })], edges: [] });
    expect(v.nodes.find((n) => n.id === "first")!.x).toBeLessThan(v.nodes.find((n) => n.id === "second")!.x);
    const rects = layoutRects(v);
    expect(overlaps(rects.get("first")!, rects.get("plain")!)).toBe(false);
  });
  it("fits the full badge even when a short connection sends it outside the node bounds", () => {
    const v = { id: "short", title: "Short", caption: { title: "Short", lede: "" }, postOf: null, nodes: [node("a", { x: 0, y: 0 }), node("b", { x: 201, y: 0 })], edges: [{ ...edge("a", "b", { step: 1 }), id: "e" }], texts: [] } as Parameters<typeof drawView>[0];
    const on = drawView(v, PALETTES.light, { steps: true });
    const off = drawView(v, PALETTES.light, { steps: false });
    const at = on.routes.get("e")!.badgeAt, r = BADGE.r + 3;
    expect(on.bounds.y).toBeLessThanOrEqual(at.y - r);
    expect(on.bounds.y + on.bounds.h).toBeGreaterThanOrEqual(at.y + r);
    expect(on.bounds.h).toBeGreaterThan(off.bounds.h);
  });
  it("preserves existing lanes and provenance through an ordinary refine", () => {
    const base = normalizeFile(file([node("a", { lane: { spine: 0 }, from: ["original"] }), node("b", { lane: { anchor: "a", side: "below" } })]), { id: "d_lanes00", now: "2026-10-14T00:00:00Z" });
    const result = answerToDocument(documentToDraft(base), { base, now: base.updatedAt, engine: null });
    expect(result.views[0].nodes.map((n) => [n.lane, n.from])).toEqual(base.views[0].nodes.map((n) => [n.lane, n.from]));
    expect(result.warnings).toEqual([]);
  });
  it("keeps every badge clear of every label", () => {
    const v = storyFixture("reference", true).views[0];
    const routes = routeEdges(v, layoutRects(v));
    for (const route of routes.values()) for (const e of v.edges) {
      const label = routes.get(e.id)?.labelAt;
      if (!label) continue;
      const labelBox = { x: label.x - labelWidth(e.label) / 2, y: label.y - LABEL.h / 2, w: labelWidth(e.label), h: LABEL.h };
      const badge = { x: route.badgeAt.x - BADGE.r, y: route.badgeAt.y - BADGE.r, w: 2 * BADGE.r, h: 2 * BADGE.r };
      expect(overlaps(labelBox, badge)).toBe(false);
    }
  });
  it("passes behind an unrelated part between two endpoints, and reports it", () => {
    const v = { nodes: [node("a", { x: 0, y: 0 }), node("block", { x: 0, y: 150 }), node("b", { x: 0, y: 300 })], edges: [{ ...edge("a", "b"), id: "e" }] } as Parameters<typeof routeEdges>[0];
    const rects = layoutRects(v), route = routeEdges(v, rects).get("e")!;
    // One straight cubic down, behind the part.
    expect(route.d).toMatch(/^M[^LHV]* C[^C]*$/);
    expect([route.side0, route.side1]).toEqual(["b", "t"]);
    expect(route.c1.x).toBe(route.p0.x);
    expect(route.blocked).toEqual(["block"]);
  });
});

describe("the layout makes room for a line behind a part", () => {
  // x sits on the row between a and b, with two parts stacked above it and two below: no room
  // beside x takes it off the row.
  const v = {
    id: "v", postOf: "p", edges: [{ ...edge("a", "b"), id: "e" }, { ...edge("x", "up"), id: "f" }],
    nodes: [
      node("a", { lane: { spine: 0 } }), node("x", { lane: { spine: 1 } }), node("b", { lane: { spine: 2 } }),
      node("up", { lane: { anchor: "x", side: "above" } }), node("up2", { lane: { anchor: "up", side: "above" } }),
      node("down", { lane: { anchor: "x", side: "below" } }), node("down2", { lane: { anchor: "down", side: "below" } }),
    ],
  } as Parameters<typeof layoutView>[0];
  // The same parts where the layout puts them when nothing needs room.
  const stored = { ...v, nodes: layoutView({ ...v, edges: v.edges.filter((e) => e.id !== "e") }, { post: true }).nodes };
  const route = (w: typeof stored) => routeEdges(w as Parameters<typeof routeEdges>[0], layoutRects(w, { post: true }), { post: true }).get("e")!;

  it("takes back room that does not clear the line, which then passes behind the part", () => {
    expect(route(stored).blocked).toEqual(["x"]);
    const laid = layoutView(v, { post: true });
    expect(laid.nodes.map((n) => [n.id, n.x, n.y])).toEqual(stored.nodes.map((n) => [n.id, n.x, n.y]));
    expect(route(laid).blocked).toEqual(["x"]);
  });

  it("with only the blocker placed automatically, keeps every stored position and clears the line", () => {
    const mixed = { ...stored, nodes: stored.nodes.map((n) => (n.id === "x" ? { ...n, x: undefined, y: undefined } : n)) };
    const laid = layoutView(mixed, { post: true });
    for (const n of stored.nodes) if (n.id !== "x") expect([n.id, laid.nodes.find((m) => m.id === n.id)!.x, laid.nodes.find((m) => m.id === n.id)!.y]).toEqual([n.id, n.x, n.y]);
    expect(route(laid).blocked ?? []).not.toContain("x");
  });

  it("never moves a part with a stored position: the line is reported blocked instead", () => {
    const again = layoutView(stored, { post: true });
    expect(again.nodes.map((n) => [n.id, n.x, n.y])).toEqual(stored.nodes.map((n) => [n.id, n.x, n.y]));
    expect(route(again).blocked).toEqual(["x"]);
  });
});
