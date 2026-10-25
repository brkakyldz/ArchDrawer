import { describe, expect, it } from "vitest";
import { edgesOverParts, layoutRects, routeEdges } from "../geometry";
import { fillDefaults, type DiagramView } from "../model";
import { edge, node } from "../testkit";
import { PALETTES } from "../theme";
import { drawView } from "./svg";

// LOOK-4 (diagram contract, Traces): a connection that passes behind a part it does not join is drawn again over that part.
const view = (): DiagramView => fillDefaults({ version: 2, title: "traces", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
  node("a", { x: 0, y: 0 }), node("mid", { x: 400, y: 0 }), node("b", { x: 800, y: 0 }), node("c", { x: 0, y: 400 }),
], edges: [{ ...edge("a", "b", { style: "async" }), id: "ab" }, { ...edge("a", "c"), id: "ac" }] }] } as never).views[0] as DiagramView;

const partOf = (body: string, id: string) => {
  const at = body.indexOf(`<g data-node-id="${id}"`);
  const next = body.indexOf("<g data-node-id=", at + 1);
  return body.slice(at, next < 0 ? undefined : next);
};

describe("traces of a line over the parts it passes behind (#171)", () => {
  it("a blocked connection has a trace inside the blocking part, after its outline and before its text; an unblocked one has none", () => {
    const v = view(), rects = layoutRects(v), routes = routeEdges(v, rects);
    expect(edgesOverParts(v, rects, routes)).toEqual([{ edge: "ab", node: "mid" }]);
    for (const theme of ["light", "dark"] as const) {
      const body = drawView(v, PALETTES[theme], { prefix: "ad" }).body;
      const mid = partOf(body, "mid");
      const trace = /<path class="trace" data-edge-of="ab" d="([^"]+)" fill="none" stroke="([^"]+)" stroke-width="1" opacity="0.25"([^>]*)\/>/.exec(mid)!;
      expect(trace, theme).toBeTruthy();
      expect(trace[1]).toBe(routes.get("ab")!.d);
      expect(trace[2]).toBe(PALETTES[theme].edge);
      expect(trace[3]).toContain('stroke-dasharray="6 5"');
      // Clipped to the part's box; over its outline, under its label.
      const r = rects.get("mid")!;
      expect(mid).toContain(`<clipPath id="ad-tc-mid"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/></clipPath>`);
      expect(mid.indexOf('class="body"')).toBeLessThan(mid.indexOf('class="trace"'));
      expect(mid.indexOf('class="trace"')).toBeLessThan(mid.indexOf("<text"));
      // No glow and no arrowhead on a trace; no other part has one.
      expect(trace[0]).not.toMatch(/marker|glow/);
      for (const id of ["a", "b", "c"]) expect(partOf(body, id)).not.toContain('class="trace"');
      expect(body.match(/class="trace"/g)!.length).toBe(1);
    }
  });

  it("a stepped connection's trace takes its kind colours", () => {
    const v = view();
    v.edges = v.edges.map((e) => (e.id === "ab" ? { ...e, step: 1 } : e));
    const mid = partOf(drawView(v, PALETTES.light, { prefix: "ad" }).body, "mid");
    expect(mid).toContain('data-edge-of="ab" d="');
    expect(mid).toMatch(/data-edge-of="ab"[^>]*stroke="url\(#ad-g-ab\)"/);
  });
});
