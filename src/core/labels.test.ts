import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawnLine, LABEL, labelWidth, layoutRects, polylineMeetsRect, routeEdges, type EdgeRoute } from "./geometry";
import { fillDefaults, validateFile, type DiagramView } from "./model";
import { normalizeFile } from "./normalize";
import { edge, node } from "./testkit";

// LOOK-4 (diagram contract, Labels): a label prefers a free spot whose box, grown by 2 px, touches no other drawn line.
const touching = (v: DiagramView, routes: Map<string, EdgeRoute>) => v.edges.flatMap((e) => {
  const r = routes.get(e.id);
  if (!r?.labelAt || !e.label) return [];
  const half = labelWidth(e.label, false) / 2, hh = LABEL.h / 2;
  const box = { x: r.labelAt.x - half - 2, y: r.labelAt.y - hh - 2, w: half * 2 + 4, h: hh * 2 + 4 };
  return [...routes].filter(([id, o]) => id !== e.id && polylineMeetsRect(drawnLine(o), box)).map(([id]) => `${e.id}~${id}`);
});

describe("a label belongs to its line (#172)", () => {
  it("two crossing lines: each label is off the other line", () => {
    // a → b runs across, c → d runs down through the middle of it: both labels' middles fall on the crossing.
    const v = fillDefaults({ version: 2, title: "cross", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
      node("a", { x: 0, y: 300 }), node("b", { x: 800, y: 300 }), node("c", { x: 400, y: 0 }), node("d", { x: 400, y: 600 }),
    ], edges: [{ ...edge("a", "b", { label: "across the page" }), id: "ab" }, { ...edge("c", "d", { label: "down the page" }), id: "cd" }] }] } as never).views[0] as DiagramView;
    const rects = layoutRects(v), routes = routeEdges(v, rects);
    expect(routes.get("ab")!.labelAt).not.toBeNull(); expect(routes.get("cd")!.labelAt).not.toBeNull();
    expect(touching(v, routes)).toEqual([]);
    // Each stays within 10 px of its own curve.
    for (const id of ["ab", "cd"]) {
      const r = routes.get(id)!, e = v.edges.find((x) => x.id === id)!, half = labelWidth(e.label, false) / 2, hh = LABEL.h / 2;
      const gap = Math.min(...drawnLine(r).map((p) => Math.hypot(Math.max(0, Math.abs(p.x - r.labelAt!.x) - half), Math.max(0, Math.abs(p.y - r.labelAt!.y) - hh))));
      expect(gap, id).toBeLessThanOrEqual(10);
    }
  });

  it("on this repository's overview no label box touches a line other than its own", () => {
    const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "tests", "fixtures", "archdrawer.archdraw.json"), "utf8"));
    const doc = normalizeFile(validateFile(raw).file!, { id: "d_labels", now: "2026-10-25T00:00:00.000Z", source: null });
    for (const v of doc.views) {
      const rects = layoutRects(v), routes = routeEdges(v, rects);
      expect(touching(v, routes), v.id).toEqual([]);
    }
  });
});
