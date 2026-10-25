import { describe, expect, it } from "vitest";
import { layoutReport, reportLine, reportWarnings } from "./report";
import { DEFAULT_SHARE, type ShareOptions } from "./export/share";
import { fillDefaults, type DiagramDocument, type NodeInput } from "./model";
import { edge, file, node } from "./testkit";
import { storyFixture } from "../../scripts/story-fixtures";

const doc = (nodes: NodeInput[], edges: ReturnType<typeof edge>[] = [], viewId = "overview") => {
  const d = fillDefaults(file(nodes, edges.map((e, i) => ({ id: `e${i + 1}`, ...e })))) as unknown as DiagramDocument;
  d.views[0].id = viewId;
  return d;
};
const opts = (extra: Partial<ShareOptions> = {}): ShareOptions => ({ ...DEFAULT_SHARE, theme: "light", format: "readme", ...extra });

describe("layout report", () => {
  it("counts a crossing once per pair, and not for connections that share a part", () => {
    // a → b and c → d form an X; a → c shares a part with both.
    const d = doc([node("a", { x: 0, y: 0 }), node("b", { x: 600, y: 400 }), node("c", { x: 600, y: 0 }), node("d", { x: 0, y: 400 })],
      [edge("a", "b"), edge("c", "d"), edge("a", "c")]);
    const r = layoutReport(d, "overview", opts());
    expect(r.crossings).toBe(1);
    expect(r.counts).toEqual({ parts: 4, zones: 0, connections: 3 });
  });

  it("reports a connection over a part it cannot get around, but never its own ends or a group's boundary", () => {
    // The part holds b entirely inside it, so no side of b can be reached around it.
    const d = doc([node("a", { x: 0, y: 0 }), node("block", { form: "panel", items: ["a long held item that widens this panel", "two", "three", "four", "five"], x: -40, y: 370 }), node("b", { x: 0, y: 400 }),
      node("z", { form: "group", label: "Zone", x: -200, y: -100 }), node("in", { parent: "z", x: -180, y: -60 })],
    [edge("a", "b")]);
    const r = layoutReport(d, "overview", opts());
    expect(r.edgesOverParts).toEqual([{ edge: "e1", node: "block" }]);
  });

  it("lists text the drawing shortens with its field and full text, but not text a switch hides", () => {
    const long = "a description far too long for one line of a small card in any image";
    const d = doc([node("a", { sub: long, x: 0, y: 0 }), node("p", { form: "panel", items: ["one"], x: 400, y: 0 })]);
    expect(layoutReport(d, "overview", opts()).cutText).toEqual([{ id: "a", field: "sub", text: long }]);
    // With the sub-lines switched off nothing of them is drawn, so none is cut (review R177-1).
    const subs = doc([node("a", { sub: long, x: 0, y: 0 }), node("b", { sub: "short", x: 400, y: 0 })]);
    expect(layoutReport(subs, "overview", opts({ sub: false })).cutText).toEqual([]);
    const hidden = doc([node("p", { form: "panel", items: ["an item far too long to fit into the narrow panel it sits in"] })]);
    expect(layoutReport(hidden, "overview", opts()).cutText).toEqual([]);
  });

  it("reports a post's text over its story targets, a spine label against a limit of 0, and keeps the text whole", () => {
    const label = "A deliberately longer request name";
    const d = doc([node("a", { label, x: 0, y: 0 }), node("b", { x: 400, y: 0 }), node("c", { x: 800, y: 0 })],
      [edge("a", "b", { step: 1, label: "sends it" }), edge("b", "c", { label: "reads it every time" })], "overview-linkedin");
    const r = layoutReport(d, "overview-linkedin", opts({ format: "feed" }));
    expect(r.overLimitText).toEqual([
      { id: "a", field: "label", text: label, limit: 28 },
      { id: "e1", field: "label", text: "sends it", limit: 0 },
      { id: "e2", field: "label", text: "reads it every time", limit: 2 },
    ]);
    expect(r.targets).toEqual({ parts: 12, zones: { min: 0, max: 4 }, connections: 14 });
    expect(d.views[0].nodes[0].label).toBe(label);
    // A sub-line over its target is reported while sub-lines are drawn, and not once they are off (review 510f7bc-3).
    const sub = "a sub-line longer than its target of 28";
    const s = doc([node("a", { sub, x: 0, y: 0 }), node("b", { x: 400, y: 0 })], [], "overview-linkedin");
    expect(layoutReport(s, "overview-linkedin", opts({ format: "feed" })).overLimitText).toEqual([{ id: "a", field: "sub", text: sub, limit: 28 }]);
    expect(layoutReport(s, "overview-linkedin", opts({ format: "feed", sub: false })).overLimitText).toEqual([]);
  });

  it("measures the longest connection against the parts' diagonal, 0 without connections", () => {
    const d = doc([node("a", { x: 0, y: 0 }), node("b", { x: 600, y: 0 })], [edge("a", "b")]);
    const r = layoutReport(d, "overview", opts());
    expect(r.longestConnection).toBeGreaterThan(0.3);
    expect(r.longestConnection).toBeLessThan(1);
    expect(layoutReport(doc([node("a")]), "overview", opts()).longestConnection).toBe(0);
  });

  it("an empty image is warn with 0 px, never good", () => {
    const r = layoutReport(doc([]), "overview", opts());
    expect(r.smallestText).toEqual({ inPlace: 0, opened: 0, level: "warn", names: { inPlace: 0, opened: 0 } });
    expect(r.crossings).toBe(0);
  });

  it("agrees with the share image for the story fixtures, and is deterministic", () => {
    for (const name of ["reference", "claude", "codex", "shop"]) {
      const d = storyFixture(name, true), id = d.views[0].id;
      const o = opts({ format: "feed", lede: true, legend: false });
      const r = layoutReport(d, id, o);
      expect(r).toEqual(layoutReport(d, id, o));
      expect(r.crossings).toBe(0);
      expect(r.edgesOverParts).toEqual([]);
      expect(r.cutText).toEqual([]);
      expect(r.smallestText.level).toBe("good");
      expect(Object.values(r.counts).every(Number.isFinite)).toBe(true);
    }
  });

  it("says the report in one line and names each over-limit part with a change that fits", () => {
    const label = "A deliberately longer request name";
    const d = doc([node("a", { label, x: 0, y: 0 }), node("b", { x: 400, y: 0 }), node("c", { x: 800, y: 0 })],
      [edge("a", "b", { step: 1, label: "sends it" }), edge("b", "c", { label: "reads it every time" })], "overview-linkedin");
    const r = layoutReport(d, "overview-linkedin", opts({ format: "feed" }));
    expect(reportLine(r)).toMatch(/^0 crossings · 0 connections over parts · nothing cut · \d+\.\d px in place · 3 parts \/ 12 · 0 zones \/ 0–4 · 2 connections \/ 14 · longest \d\.\d\d$/);
    const w = reportWarnings(r, (id) => ({ a: "Intake", e1: "Intake → B", e2: "B → C" })[id] ?? id);
    expect(w).toEqual([
      `Intake: the label “${label}” is over 28 characters; shorten it.`,
      "Intake → B: a main-path connection carries “sends it”; its number already tells the path, so leave the label empty.",
      "B → C: the label “reads it every time” is over 2 words; say it in fewer.",
    ]);
  });
});
