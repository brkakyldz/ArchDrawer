import { describe, expect, it } from "vitest";
import { countCrossings, drawnLine, layoutRects, routeEdges, routeSamples, trunksOf } from "./geometry";
import { fillDefaults, type DiagramView } from "./model";
import { edge, node } from "./testkit";
import { PALETTES } from "./theme";
import { drawView } from "./export/svg";

// LAYOUT-5 (diagram contract, Trunks): connections arriving on one side of one part, of one style and from one direction,
// share a trunk: one straight stretch with one arrowhead, the members' own curves ending at its split point.
const view = (sources: { id: string; x: number; y: number; style?: "call" | "async" | "dep" }[]): DiagramView => fillDefaults({
  version: 2, title: "trunks", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" },
    nodes: [node("hub", { x: 400, y: 400 }), ...sources.map((s) => node(s.id, { x: s.x, y: s.y }))],
    edges: sources.map((s) => ({ ...edge(s.id, "hub", { style: s.style ?? "dep" }), id: `${s.id}-hub` })) }],
} as never).views[0] as DiagramView;

/** Whether two members' own curves cross anywhere but where they meet at the split point. */
function crossEachOther(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }, s: { x: number; y: number }) => {
    const d = (u: typeof p, v: typeof p, w: typeof p) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
    return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0;
  };
  for (let i = 1; i < a.length - 2; i++) for (let j = 1; j < b.length - 2; j++) if (cross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}

describe("shared trunks (#174)", () => {
  it("three lines into one side from one direction share one trunk with one arrowhead, and do not cross each other", () => {
    const v = view([{ id: "a", x: 320, y: 0 }, { id: "b", x: 400, y: 0 }, { id: "c", x: 480, y: 0 }]);
    const rects = layoutRects(v), routes = routeEdges(v, rects);
    const trunks = trunksOf(routes);
    expect(trunks).toHaveLength(1);
    const t = trunks[0];
    expect([t.key, t.edges]).toEqual(["hub:t", ["a-hub", "b-hub", "c-hub"]]);
    const hub = rects.get("hub")!;
    // The port on the hub's top, the split 32 px above it along the side's normal.
    expect(t.port.y).toBe(hub.y);
    expect(t.split).toEqual({ x: t.port.x, y: t.port.y - 32 });
    for (const id of t.edges) { expect(routes.get(id)!.p1).toEqual(t.split); expect(routes.get(id)!.trunk).toBe(t); }
    // The members' own curves meet only at the split point.
    const own = t.edges.map((id) => routeSamples(routes.get(id)!));
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) expect(crossEachOther(own[i], own[j]), `${t.edges[i]} × ${t.edges[j]}`).toBe(false);
    // The drawn line runs on through the trunk to the port.
    expect(drawnLine(routes.get("a-hub")!).at(-1)).toEqual(t.port);
    // The image: one trunk group after the connections, with the one arrowhead; the members draw none at their end.
    const body = drawView(v, PALETTES.light, { prefix: "ad" }).body;
    expect(body.match(/<g data-trunk=/g)).toHaveLength(1);
    expect(body).toContain('<g data-trunk="hub:t" data-edges="a-hub b-hub c-hub" data-tone="neutral">');
    expect(body.indexOf("<g data-trunk=")).toBeGreaterThan(body.lastIndexOf("<g data-edge-id="));
    const trunk = /<g data-trunk="hub:t"[^>]*>([\s\S]*?)<\/g>/.exec(body)![1];
    expect(trunk).toContain(`d="${t.d}"`);
    expect(trunk).toMatch(/marker-end="url\(#[^"]+\)"/);
    expect(trunk).toContain('stroke-dasharray="2 5"');
    for (const id of t.edges) {
      const g = new RegExp(`<g data-edge-id="${id}"[\\s\\S]*?<path class="line"[^>]*>`).exec(body)![0];
      expect(g, id).not.toContain("marker-end");
    }
  });

  it("lines from opposite directions, or of different styles, take no trunk", () => {
    const opposite = view([{ id: "a", x: -200, y: 0 }, { id: "c", x: 1000, y: 0 }]);
    expect(trunksOf(routeEdges(opposite, layoutRects(opposite)))).toEqual([]);
    const styles = view([{ id: "a", x: 300, y: 0, style: "call" }, { id: "b", x: 400, y: 0, style: "async" }]);
    expect(trunksOf(routeEdges(styles, layoutRects(styles)))).toEqual([]);
  });

  it("the split point comes in to a third of the shortest distance from the port to a member's start", () => {
    const close = view([{ id: "a", x: 370, y: 220 }, { id: "b", x: 430, y: 220 }]);
    const rects = layoutRects(close), routes = routeEdges(close, rects);
    const [t] = trunksOf(routes);
    expect(t).toBeDefined();
    const near = Math.min(...t.edges.map((id) => { const p = routes.get(id)!.p0; return Math.hypot(p.x - t.port.x, p.y - t.port.y); }));
    expect(Math.abs(t.port.y - t.split.y)).toBeCloseTo(Math.min(32, near / 3), 0);
  });

  it("the layout report measures the drawn lines: a line crossing a trunk counts", () => {
    const v = view([{ id: "a", x: 320, y: 0 }, { id: "b", x: 480, y: 0 }]);
    v.nodes.push(node("l", { x: 100, y: 330 }) as never, node("r", { x: 700, y: 330 }) as never);
    v.edges.push({ ...edge("l", "r"), id: "l-r" } as never);
    const rects = layoutRects(v), routes = routeEdges(v, rects);
    expect(trunksOf(routes)).toHaveLength(1);
    // The straight line from l to r passes under the members' own curves and across the trunk: once with each member.
    expect(countCrossings(v.edges, routes)).toBe(2);
  });
});
