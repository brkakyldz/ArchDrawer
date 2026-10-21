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

  it("lets a part into a group the view has and out again, but adds no group", () => {
    const v0 = validateFile(file([node("zone", { form: "group", place: { row: 0, col: 0 } }), node("web", { place: { row: 0, col: 1 } }), node("api", { kind: "api", parent: "zone", place: { row: 0, col: 0 } })]));
    if (!v0.ok) throw new Error(v0.errors.join("; "));
    const base = normalizeFile(v0.file!, { id: "d_appear0002", now: NOW, source: null });
    const answer = structuredClone(base);
    const [v] = answer.views;
    v.nodes.find((n) => n.id === "web")!.parent = "zone";
    v.nodes.find((n) => n.id === "api")!.parent = null;
    const { doc, warnings } = appearanceOnly(base, answer);
    expect(warnings).toEqual([]);
    expect(doc.views[0].nodes.map((n) => [n.id, n.parent])).toEqual([["zone", null], ["web", "zone"], ["api", null]]);
    const grouped = structuredClone(base);
    grouped.views[0].nodes.push({ ...structuredClone(grouped.views[0].nodes[0]), id: "backend", label: "Backend" });
    grouped.views[0].nodes.find((n) => n.id === "web")!.parent = "backend";
    const r = appearanceOnly(base, grouped);
    expect(r.warnings).toEqual(['Ignored the new component "Backend": redrawing from the facts changes no content']);
    expect(r.doc.views[0].nodes.find((n) => n.id === "web")!.parent).toBeNull();
  });

  it("a one-way connection turned round is one change, warned once; a two-way one turned round is no change", () => {
    const base = shop();
    const turned = structuredClone(base);
    const e = turned.views[0].edges[0];
    [e.from, e.to] = [e.to, e.from];
    const one = appearanceOnly(base, turned);
    expect(one.warnings).toEqual(["Ignored the change to the connection Web → Api: redrawing from the facts changes no content"]);
    expect(one.doc.views[0].edges.map((x) => [x.from, x.to])).toEqual([["web", "api"]]);
    const both = structuredClone(base);
    both.views[0].edges[0].both = true;
    const turnedBoth = structuredClone(both);
    const t = turnedBoth.views[0].edges[0];
    [t.from, t.to] = [t.to, t.from];
    expect(appearanceOnly(both, turnedBoth).warnings).toEqual([]);
  });

  it("keeps the base's grouping, with one warning, when kept and accepted groupings would nest wrongly", () => {
    const v0 = validateFile(file([node("a", { form: "group", place: { row: 0, col: 0 } }), node("b", { form: "group", parent: "a", place: { row: 0, col: 0 } }), node("z", { form: "group", place: { row: 0, col: 1 } }), node("api", { kind: "api", parent: "z", place: { row: 0, col: 0 } })]));
    if (!v0.ok) throw new Error(v0.errors.join("; "));
    const base = normalizeFile(v0.file!, { id: "d_appear0003", now: NOW, source: null });
    const kept = `Kept how the parts of "${base.views[0].title}" are grouped: redrawing from the facts changes no content`;
    const newGroup = (d: DiagramDocument, id: string) => d.views[0].nodes.push({ ...structuredClone(d.views[0].nodes.find((n) => n.id === "z")!), id, label: id.toUpperCase(), parent: null });
    const at = (d: DiagramDocument, id: string) => d.views[0].nodes.find((n) => n.id === id)!;
    // A loop: b goes into a new group (ignored, so it stays in a) while a goes into b.
    const loop = structuredClone(base);
    newGroup(loop, "c"); at(loop, "b").parent = "c"; at(loop, "a").parent = "b";
    const r1 = appearanceOnly(base, loop);
    expect(r1.warnings).toEqual(['Ignored the new component "C": redrawing from the facts changes no content', kept]);
    expect(r1.doc.views[0].nodes.map((n) => [n.id, n.parent, n.form])).toEqual([["a", null, "group"], ["b", "a", "group"], ["z", null, "group"], ["api", "z", "card"]]);
    // A part left in a group the answer made a card.
    const card = structuredClone(base);
    newGroup(card, "y"); at(card, "z").form = "card"; at(card, "api").parent = "y";
    const r2 = appearanceOnly(base, card);
    expect(r2.warnings).toEqual(['Ignored the new component "Y": redrawing from the facts changes no content', kept]);
    expect([at(r2.doc, "z").form, at(r2.doc, "api").parent]).toEqual(["group", "z"]);
  });
});
