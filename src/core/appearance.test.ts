import { describe, expect, it } from "vitest";
import { appearanceOnly } from "./appearance";
import type { DiagramDocument } from "./model";
import { validateFile } from "./model";
import { normalizeFile } from "./normalize";
import { edge, file, node } from "./testkit";

// The story route of a refine on the overview (api contract, Routing): how it looks changes, what it says does not.

const NOW = "2026-10-21T00:00:00.000Z";
function shop(): DiagramDocument {
  const f = file([node("web", { place: { row: 0, col: 0 } }), node("api", { kind: "api", place: { row: 0, col: 1 } })], [edge("web", "api", { label: "orders" })]);
  const v = validateFile(f);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return normalizeFile(v.file!, { id: "d_appear0001", now: NOW, source: null });
}

describe("a story on the overview changes appearance only", () => {
  it("keeps a move, a form, a step, the texts and the caption, and warns about nothing", () => {
    const base = shop();
    const answer = structuredClone(base);
    const [v] = answer.views;
    v.nodes[0].x += 400; v.nodes[1].form = "panel"; v.edges[0].step = 1;
    v.caption = { title: "Shop map", lede: "How an order flows." };
    v.texts = [{ id: "t1", text: "Note", x: 0, y: 0, size: 16 }];
    const { doc, warnings } = appearanceOnly(base, answer);
    expect(warnings).toEqual([]);
    expect(doc.views[0].nodes.map((n) => [n.id, n.x, n.form])).toEqual([["web", base.views[0].nodes[0].x + 400, "card"], ["api", base.views[0].nodes[1].x, "panel"]]);
    expect(doc.views[0].edges[0].step).toBe(1);
    expect(doc.views[0].caption.title).toBe("Shop map");
    expect(doc.views[0].texts).toHaveLength(1);
  });

  it("ignores every content change with one warning each: a new part, a removed one, a rename, a new and a changed connection", () => {
    const base = shop();
    const answer = structuredClone(base);
    const [v] = answer.views;
    v.nodes[1].label = "Checkout API"; v.nodes[1].items = ["Pay"]; v.nodes[1].x += 80;
    v.nodes.push({ ...structuredClone(v.nodes[0]), id: "cache", label: "Cache" });
    v.nodes = v.nodes.filter((n) => n.id !== "web");
    v.edges = [{ ...v.edges[0], from: "api", to: "cache", id: "e9" }];
    answer.title = `${base.title} 2`;
    const { doc, warnings } = appearanceOnly(base, answer);
    expect(warnings).toEqual([
      'Ignored the new component "Cache": redrawing from the facts changes no content',
      'Kept "Web", which the answer removed: redrawing from the facts changes no content',
      'Ignored the change to "Api": redrawing from the facts changes no content',
      "Kept the connection Web → Api, which the answer removed: redrawing from the facts changes no content",
      "Ignored the new connection Api → Cache: redrawing from the facts changes no content",
      `Kept the title "${base.title}": redrawing from the facts changes no content`,
    ]);
    // What it says is the base's; where the changed part is, is the answer's (a content change is ignored whole, its move kept).
    const api = doc.views[0].nodes.find((n) => n.id === "api")!;
    expect([api.label, api.items, api.x]).toEqual(["Api", [], base.views[0].nodes[1].x + 80]);
    expect(doc.views[0].nodes.map((n) => n.id)).toEqual(["web", "api"]);
    expect(doc.views[0].edges.map((e) => [e.from, e.to, e.label])).toEqual([["web", "api", "orders"]]);
    expect(doc.title).toBe(base.title);
    expect(doc.warnings.slice(-warnings.length)).toEqual(warnings);
  });
});
