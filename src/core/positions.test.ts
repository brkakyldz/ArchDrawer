import { describe, expect, it } from "vitest";
import { diffDocuments, summarize, touched } from "./diff";
import { layoutRects, overlaps } from "./geometry";
import { validateDocument, type DiagramDocument } from "./model";
import { normalizeFile } from "./normalize";
import { answerToDocument, documentToDraft, type RunScope } from "./repair";
import { file, node } from "./testkit";

// A view with a group and a second view, positions laid out once.
const base = (): DiagramDocument => {
  const f = file([
    node("web", { kind: "client", place: { row: 0, col: 0 } }),
    node("api", { kind: "api", place: { row: 0, col: 1 } }),
    node("runtime", { form: "group", place: { row: 0, col: 2 } }),
    node("think", { kind: "llm", form: "compact", parent: "runtime" }),
    node("act", { kind: "gate", form: "compact", parent: "runtime" }),
    node("db", { kind: "data", place: { row: 1, col: 1 } }),
  ], [
    { from: "web", to: "api", label: "order", style: "call", both: false, step: 1 },
    { from: "api", to: "think", label: "", style: "call", both: false, step: 2 },
    { from: "api", to: "db", label: "", style: "call", both: false, step: null },
  ]);
  f.views.push({ id: "inside", title: "Inside", caption: { title: "Inside", lede: "" }, nodes: [node("loop")], edges: [], texts: [] });
  return normalizeFile(f, { id: "d_pos0000001", now: "2026-10-13T00:00:00.000Z", source: { kind: "local", path: "C:/x" } });
};

type Draft = { views: { id: string; nodes: Record<string, any>[]; edges: Record<string, any>[]; relayout?: string[] }[] };
const draftOf = (b: DiagramDocument) => {
  const d = documentToDraft(b) as Draft;
  for (const v of d.views) { v.relayout = []; for (const n of v.nodes) { delete n.box; n.at = null; } }
  return d;
};
const repair = (b: DiagramDocument, d: Draft, scope?: RunScope, view = "overview") =>
  answerToDocument(d, { base: b, now: "2026-10-13T01:00:00.000Z", engine: { id: "fixture", model: null }, scope, view });
const pos = (doc: DiagramDocument, id: string, v = 0) => { const n = doc.views[v].nodes.find((x) => x.id === id)!; return { x: n.x, y: n.y }; };

describe("the engine sees boxes and moves components", () => {
  it("gives every component its box in the draft", () => {
    const b = base();
    const d = documentToDraft(b) as Draft;
    const rects = layoutRects(b.views[0]);
    for (const n of d.views[0].nodes) {
      const r = rects.get(n.id)!;
      expect(n.box).toEqual({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      expect(n).not.toHaveProperty("x");
    }
  });

  it("moves only a component with an `at`, snapped to the grid; an `at` where it already is moves nothing", () => {
    const b = base();
    const d = draftOf(b);
    const v = d.views[0];
    v.nodes.find((n) => n.id === "db")!.at = { x: 1003, y: 701 };
    v.nodes.find((n) => n.id === "web")!.at = pos(b, "web");
    const doc = repair(b, d);
    expect(validateDocument(doc).ok).toBe(true);
    expect(pos(doc, "db")).toEqual({ x: 1000, y: 704 });
    for (const id of ["web", "api", "think", "act"]) expect(pos(doc, id)).toEqual(pos(b, id));
    expect(doc.warnings).toEqual([]);
    const c = diffDocuments(b, doc);
    expect(c.moved).toEqual(["db"]);
    expect(summarize(c)).toBe("1 part moved");
  });

  it("moves a group with what it holds", () => {
    const b = base();
    const d = draftOf(b);
    const g = layoutRects(b.views[0]).get("runtime")!;
    d.views[0].nodes.find((n) => n.id === "runtime")!.at = { x: g.x + 200, y: g.y + 400 };
    const doc = repair(b, d);
    for (const id of ["think", "act"]) expect(pos(doc, id)).toEqual({ x: pos(b, id).x + 200, y: pos(b, id).y + 400 });
    const r = layoutRects(doc.views[0]).get("runtime")!;
    expect([r.x, r.y]).toEqual([g.x + 200, g.y + 400]);
    expect(diffDocuments(b, doc).moved.sort()).toEqual(["act", "think"]);
  });

  it("moves a component off one it would cover, with one warning", () => {
    const b = base();
    const d = draftOf(b);
    d.views[0].nodes.find((n) => n.id === "db")!.at = pos(b, "web");
    const doc = repair(b, d);
    const rects = layoutRects(doc.views[0]);
    expect(overlaps(rects.get("db")!, rects.get("web")!)).toBe(false);
    expect(pos(doc, "web")).toEqual(pos(b, "web"));
    expect(doc.warnings).toEqual(['Moved "Db" to the nearest free spot: where the engine put it, it covered "Web"']);
  });

  it("places a new component at its `at`, and lays out one listed in relayout", () => {
    const b = base();
    const d = draftOf(b);
    d.views[0].nodes.push({ ...d.views[0].nodes[0], id: "cache", label: "Cache", place: null, at: { x: 2400, y: 40 } });
    d.views[0].relayout = ["db", "ghost"];
    const doc = repair(b, d);
    expect(pos(doc, "cache")).toEqual({ x: 2400, y: 40 });
    expect(doc.warnings).toEqual(['Ignored "ghost" in relayout: no such component']);
    const c = diffDocuments(b, doc);
    expect(c.added).toEqual(["cache"]);
    const rects = layoutRects(doc.views[0]);
    for (const [id, r] of rects) if (id !== "db" && doc.views[0].nodes.find((n) => n.id === id)!.form !== "group" && id !== "think" && id !== "act") expect(overlaps(rects.get("db")!, r)).toBe(id === "db");
  });
});

describe("the run's scope is enforced by the repair", () => {
  it("view: changes to other views are ignored with one warning each", () => {
    const b = base();
    const d = draftOf(b);
    d.views[1].nodes[0].label = "Renamed loop";
    d.views[0].nodes.find((n) => n.id === "db")!.label = "Order store";
    const doc = repair(b, d, { kind: "view" });
    expect(doc.views[1]).toEqual(b.views[1]);
    expect(doc.views[0].nodes.find((n) => n.id === "db")!.label).toBe("Order store");
    expect(doc.warnings).toEqual(['Ignored the changes to the view "inside": outside the view the change was asked for']);
  });

  it("view: a view the engine left out or added stays as it was", () => {
    const b = base();
    const d = draftOf(b);
    d.views = [d.views[0], { ...d.views[1], id: "extra" }];
    const doc = repair(b, d, { kind: "view" });
    expect(doc.views.map((v) => v.id)).toEqual(["overview", "inside"]);
    expect(doc.warnings).toEqual([
      'Ignored the new view "extra": outside the view the change was asked for',
      'Kept the view "inside": outside the view the change was asked for',
    ]);
  });

  it("parts: components outside the selection keep content, position and connections", () => {
    const b = base();
    const d = draftOf(b);
    const v = d.views[0];
    v.nodes.find((n) => n.id === "api")!.label = "Order router";
    v.nodes.find((n) => n.id === "web")!.label = "Shop";
    v.nodes.find((n) => n.id === "db")!.at = { x: 3000, y: 3000 };
    v.nodes = v.nodes.filter((n) => n.id !== "act");
    v.edges = v.edges.filter((e) => !(e.from === "api" && e.to === "db"));
    v.edges.push({ from: "web", to: "db", label: "", style: "call", both: false, step: null });
    const doc = repair(b, d, { kind: "parts", ids: ["api"] });
    expect(validateDocument(doc).ok).toBe(true);
    const n = (id: string) => doc.views[0].nodes.find((x) => x.id === id)!;
    expect(n("api").label).toBe("Order router");
    expect(n("web").label).toBe("Web");
    expect(pos(doc, "db")).toEqual(pos(b, "db"));
    expect(n("act")).toMatchObject({ label: "Act", parent: "runtime", ...pos(b, "act") });
    expect(doc.views[0].edges.some((e) => e.from === "web" && e.to === "db")).toBe(false);
    // api → db touches the selection: dropping it is allowed.
    expect(doc.views[0].edges.some((e) => e.from === "api" && e.to === "db")).toBe(false);
    expect(doc.warnings).toEqual([
      'Kept "Web" as it was: it is outside the selected parts',
      'Kept "Act": it is outside the selected parts',
      'Kept "Db" as it was: it is outside the selected parts',
      "Ignored the new connection web → db: it is outside the selected parts",
    ]);
    const c = diffDocuments(b, doc, ["overview"]);
    expect(c).toMatchObject({ changed: ["api"], removed: [], moved: [], edgesRemoved: [expect.any(String)] });
  });

  it("parts: a selected group opens what it holds", () => {
    const b = base();
    const d = draftOf(b);
    d.views[0].nodes.find((n) => n.id === "think")!.label = "Plan";
    const doc = repair(b, d, { kind: "parts", ids: ["runtime"] });
    expect(doc.views[0].nodes.find((x) => x.id === "think")!.label).toBe("Plan");
    expect(doc.warnings).toEqual([]);
  });
});

describe("the change summary", () => {
  it("matches connections by their ends, whatever their ids", () => {
    const b = base();
    const d = draftOf(b);
    d.views[0].edges[0].label = "places an order";
    d.views[0].edges.reverse();
    const doc = repair(b, d);
    const c = diffDocuments(b, doc, ["overview"]);
    expect(c.edgesAdded).toEqual([]);
    expect(c.edgesRemoved).toEqual([]);
    expect(c.edgesChanged).toHaveLength(1);
    expect(summarize(c)).toBe("1 connection changed");
    expect(touched(c)).toEqual([]);
  });

  it("keeps the ids and order of connections that were already there", () => {
    const b = base();
    const d = draftOf(b);
    d.views[0].edges.reverse();
    d.views[0].edges.push({ from: "web", to: "db", label: "", style: "call", both: false, step: null });
    const doc = repair(b, d, { kind: "view" });
    const was = b.views[0].edges.map((e) => e.id);
    expect(doc.views[0].edges.slice(0, 3)).toEqual(b.views[0].edges);
    expect(doc.views[0].edges[3].id).not.toBe("");
    expect(was).not.toContain(doc.views[0].edges[3].id);
    const ignored = repair(b, draftOf(b), { kind: "parts", ids: ["web"] });
    expect(ignored.views[0].edges).toEqual(b.views[0].edges);
  });

  it("says Nothing changed for an unchanged answer", () => {
    const b = base();
    expect(summarize(diffDocuments(b, repair(b, draftOf(b))))).toBe("Nothing changed");
  });
});
