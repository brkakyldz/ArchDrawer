import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hiddenEdges, hubsOf, LABEL, labelWidth, layoutRects, routeEdges, usedByBoxes, viewBounds } from "./geometry";
import { drawView } from "./export/svg";
import { startSwitches } from "./export/share";
import { fillDefaults, validateFile, type DiagramView } from "./model";
import { normalizeFile } from "./normalize";
import { layoutReport } from "./report";
import { edge, node } from "./testkit";
import { PALETTES } from "./theme";

// LOOK-4 (diagram contract, Parts many parts use): a part four or more parts use hides their lines and wears `used by <n>`.
const viewOf = (users: number, extra: ReturnType<typeof edge>[] = [], step: number | null = null, more: ReturnType<typeof node>[] = []) => fillDefaults({ version: 2, title: "hub", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
  node("db", { x: 400, y: 500, kind: "data" }), ...more,
  ...Array.from({ length: users }, (_, i) => node(`u${i}`, { x: i * 260, y: 0 })),
], edges: [
  ...Array.from({ length: users }, (_, i) => ({ ...edge(`u${i}`, "db", { label: i === 0 ? "reads rows" : "", step: i === 0 ? step : null }), id: `e${i}` })),
  ...extra,
] }] } as never).views[0] as DiagramView;

const fixture = (name: string) => {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "tests", "fixtures", `${name}.archdraw.json`), "utf8"));
  return normalizeFile(validateFile(raw).file!, { id: `d_${name}`, now: "2026-10-25T00:00:00.000Z", source: null });
};

describe("parts many parts use (#186)", () => {
  it("four users: the part wears `used by 4`, their lines are hidden and no export draws them", () => {
    const v = viewOf(4), rects = layoutRects(v), routes = routeEdges(v, rects);
    expect(hubsOf(v)).toEqual(new Map([["db", 4]]));
    expect([...hiddenEdges(v)].sort()).toEqual(["e0", "e1", "e2", "e3"]);
    for (const id of ["e0", "e1", "e2", "e3"]) expect(routes.get(id)!.hidden, id).toBe(true);
    const body = drawView(v, PALETTES.light).body;
    expect(body).not.toContain("data-edge-id");
    expect(body).not.toContain("data-edge-label");
    // The mark is inside the hub's group, after its text.
    const g = body.slice(body.indexOf('<g data-node-id="db"'), body.indexOf('<g data-node-id="u0"') > body.indexOf('<g data-node-id="db"') ? body.indexOf('<g data-node-id="u0"') : undefined);
    expect(g).toMatch(/<g data-used-by="4"><rect [^>]*fill="#f1f3f6" stroke="#e2e5ea"[^>]*\/><text [^>]*font-size="11" font-weight="500" fill="#555c69">used by 4<\/text><\/g>/);
    expect(g.indexOf("data-used-by")).toBeGreaterThan(g.lastIndexOf('class="label"'));
    expect(body.match(/data-used-by=/g)).toHaveLength(1);
  });

  it("the mark is 18 px tall, 7 px of padding each side, centred on the box's bottom edge, and in the drawing's bounds", () => {
    const v = viewOf(4), rects = layoutRects(v), r = rects.get("db")!, m = usedByBoxes(v, rects).get("db")!;
    expect(m.h).toBe(18);
    expect(m.x + m.w / 2).toBeCloseTo(r.x + r.w / 2, 6);
    expect(m.y + m.h / 2).toBe(r.y + r.h);
    const b = viewBounds(v, rects, routeEdges(v, rects));
    expect(b.y + b.h).toBeGreaterThanOrEqual(m.y + m.h);
  });

  it("three users stay as they were: every line drawn, no mark", () => {
    const v = viewOf(3), rects = layoutRects(v), routes = routeEdges(v, rects);
    expect(hubsOf(v).size).toBe(0);
    expect([...routes.values()].some((r) => r.hidden)).toBe(false);
    expect(routes).toEqual(routeEdges(v, rects, { hubs: false }));
    const body = drawView(v, PALETTES.light).body;
    expect(body.match(/<g data-edge-id=/g)).toHaveLength(3);
    expect(body).not.toContain("data-used-by");
  });

  it("a line with a step is never hidden, and its user still counts", () => {
    const v = viewOf(4, [], 1), routes = routeEdges(v, layoutRects(v));
    expect(routes.get("e0")!.hidden).toBeFalsy();
    expect(["e1", "e2", "e3"].every((id) => routes.get(id)!.hidden)).toBe(true);
    const body = drawView(v, PALETTES.light).body;
    expect(body).toContain('data-edge-id="e0"');
    expect(body).toContain('data-used-by="4"');
  });

  it("a two-way connection makes a user; a connection out of the hub does not", () => {
    const x = [node("x", { x: 900, y: 500 })];
    const both = viewOf(3, [{ ...edge("db", "x", { both: true }), id: "bx" }], null, x);
    expect(hubsOf(both).get("db")).toBe(4);
    expect(hiddenEdges(both).has("bx")).toBe(true);
    const out = viewOf(3, [{ ...edge("db", "x"), id: "dx" }], null, x);
    expect(hubsOf(out).size).toBe(0);
  });

  it("the view is routed as if the hidden lines were not there, so showing one moves nothing", () => {
    const v = viewOf(4, [{ ...edge("u0", "u1", { label: "asks" }), id: "a" }, { ...edge("u2", "u3"), id: "b" }]), rects = layoutRects(v);
    const routes = routeEdges(v, rects);
    const without = routeEdges({ ...v, edges: v.edges.filter((e) => !hiddenEdges(v).has(e.id)) }, rects, { hubs: false, avoid: [...usedByBoxes(v, rects).values()] });
    for (const id of ["a", "b"]) expect(routes.get(id), id).toEqual(without.get(id));
    // A hidden line keeps a label spot of its own, clear of the drawn labels and of the mark by 4 px.
    const at = routes.get("e0")!.labelAt!, half = labelWidth("reads rows", false) / 2, hh = LABEL.h / 2;
    expect(at).not.toBeNull();
    const m = usedByBoxes(v, rects).get("db")!;
    const clear = at.x + half + 4 <= m.x || at.x - half - 4 >= m.x + m.w || at.y + hh + 4 <= m.y || at.y - hh - 4 >= m.y + m.h;
    expect(clear).toBe(true);
  });

  it("the layout report counts only drawn lines", () => {
    const v = viewOf(4, [{ ...edge("u0", "u1"), id: "a" }]);
    const doc = { views: [v] };
    const r = layoutReport(doc as never, "v", { ...startSwitches("readme", false), format: "readme", theme: "light" });
    expect(r.counts.connections).toBe(1);
  });

  // The layout report's crossings at bcdbf51, before hubs: 8 and 26 (the run's evidence, 186-before.txt).
  it("crossings on this repository's and the hotel overview do not go up (8 → 4, 26 → 3)", () => {
    for (const [name, before, after] of [["archdrawer", 8, 4], ["hotel", 26, 3]] as const) {
      const doc = fixture(name), v = doc.views[0];
      const r = layoutReport(doc, v.id, { ...startSwitches("readme", false), format: "readme", theme: "light" });
      expect(r.crossings, name).toBe(after);
      expect(r.crossings).toBeLessThanOrEqual(before);
    }
  });
});
