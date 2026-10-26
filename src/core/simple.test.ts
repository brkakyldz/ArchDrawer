import { describe, expect, it } from "vitest";
import { normalizeFile3 } from "./channels";
import { readAnyFile } from "./convert";
import { validateDocument3, type Document3 } from "./file3";
import { prepareChannel } from "./simple";
import { node } from "./testkit";
import { choiceAsFile3 } from "./file4";

// The simple README and presentation (ui contract, Simple versions): the overview's first view as it is.

const NOW = "2026-10-21T00:00:00.000Z";
function stored(steps = true): Document3 {
  const r = readAnyFile({
    schema: "archdraw/diagram@2", title: "Shop",
    views: [{ id: "overview", title: "Overview", caption: { title: "Shop", lede: "Orders." },
      nodes: [node("web", { kind: "client", place: { row: 0, col: 0 } }), node("api", { kind: "api", form: "panel", items: ["Check"], place: { row: 0, col: 1 } }), node("db", { kind: "data", place: { row: 0, col: 2 } })],
      edges: [{ from: "web", to: "api", label: "", style: "call", both: false, step: steps ? 1 : null }, { from: "api", to: "db", label: "saves", style: "call", both: false, step: steps ? 2 : null }], texts: [] }],
  });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return normalizeFile3(choiceAsFile3(r.file!), { id: "d_simple0001", now: NOW, source: null });
}

describe("the simple README and presentation", () => {
  it("draws the README as the overview's first view: the same parts and connections, no own text, no texts, nothing marked", () => {
    const d = stored();
    const r = prepareChannel(d, "readme");
    if (!r.ok) throw new Error(r.error);
    expect(validateDocument3(r.doc).ok).toBe(true);
    const [v] = r.doc.channels.readme.views;
    const o = d.channels.overview.views[0];
    expect(v).toMatchObject({ id: "readme", title: "README", caption: o.caption, texts: [] });
    expect(v.nodes.map((p) => [p.id, p.facts, p.form, p.parent, p.label ?? null, p.items ?? null])).toEqual(o.nodes.map((p) => [p.id, p.facts, p.form, p.parent, null, null]));
    expect(v.edges.map((e) => [e.from, e.to, e.relations, e.step])).toEqual(o.edges.map((e) => [e.from, e.to, e.relations, e.step]));
    expect([r.doc.facts, r.doc.channels.overview]).toEqual([d.facts, d.channels.overview]);
    expect(r.doc.channels.readme.outdated).toEqual([]);
  });

  it("drops an inside view's link and an overview part's own text: the README and presentation show the facts' names", () => {
    const r0 = readAnyFile({
      schema: "archdraw/diagram@2", title: "Shop",
      views: [
        { id: "overview", title: "Overview", caption: { title: "Shop", lede: "" }, nodes: [node("api", { kind: "api", detail: "inside", place: { row: 0, col: 0 } }), node("db", { kind: "data", place: { row: 0, col: 1 } })], edges: [], texts: [] },
        { id: "inside", title: "Inside", caption: { title: "Inside", lede: "" }, nodes: [node("check", { place: { row: 0, col: 0 } })], edges: [], texts: [] },
      ],
    });
    if (!r0.ok) throw new Error(r0.errors.join("; "));
    const d = normalizeFile3(choiceAsFile3(r0.file!), { id: "d_simple0002", now: NOW, source: null });
    const db = d.channels.overview.views[0].nodes.find((p) => p.id === "db")!;
    db.label = "DB (short)";
    for (const channel of ["readme", "presentation"] as const) {
      const r = prepareChannel(d, channel);
      if (!r.ok) throw new Error(r.error);
      const [v] = r.doc.channels[channel].views;
      expect(v.nodes.map((p) => [p.id, p.detail, p.label ?? null])).toEqual([["api", null, null], ["db", null, null]]);
    }
  });

  it("gives the presentation one step per numbered connection, else one step of every top-level part", () => {
    const r = prepareChannel(stored(), "presentation");
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.channels.presentation.steps).toEqual([
      { id: "s1", parts: ["web", "api"], text: "Web → Api", note: "" },
      { id: "s2", parts: ["api", "db"], text: "saves", note: "" },
    ]);
    const none = prepareChannel(stored(false), "presentation");
    if (!none.ok) throw new Error(none.error);
    expect(none.doc.channels.presentation.steps).toEqual([{ id: "s1", parts: ["web", "api", "db"], text: "Shop", note: "" }]);
  });
});
