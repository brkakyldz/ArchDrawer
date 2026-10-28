import { describe, expect, it } from "vitest";
import { layoutRects, overlaps } from "../../core/geometry";
import { validateDocument, validateFile, type DiagramDocument } from "../../core/model";
import { normalizeFile } from "../../core/normalize";
import { node } from "../../core/testkit";
import {
  addNode, addText, connect, createInside, crumbsTo, deleteNodes, moveNodes, reverseEdge, setEdge, setNode, setText, settleNodes, viewOf,
} from "./ops";

const NOW = "2026-10-13T00:00:00.000Z";
function doc(): DiagramDocument {
  const file = validateFile({
    schema: "archdraw/diagram@2", title: "T",
    views: [{
      id: "overview", title: "Overview", caption: { title: "T", lede: "" },
      nodes: [
        node("web", { kind: "client", place: { row: 0, col: 0 } }),
        node("api", { kind: "api", place: { row: 0, col: 1 } }),
        node("rt", { form: "group", kind: "llm", place: { row: 1, col: 1 } }),
        node("llm", { form: "compact", kind: "llm", parent: "rt" }),
        node("tool", { form: "compact", kind: "llm", parent: "rt" }),
      ],
      edges: [{ from: "web", to: "api", label: "", style: "call", both: false, step: 1 }, { from: "llm", to: "tool", label: "", style: "call", both: false, step: null }],
      texts: [],
    }],
  }).file!;
  return normalizeFile(file, { id: "d_ops0000001", now: NOW, source: null });
}
const V = "overview";
const ok = (d: DiagramDocument) => { const r = validateDocument(d); if (!r.ok) throw new Error(r.error); return d; };
const n = (d: DiagramDocument, id: string) => viewOf(d, V).nodes.find((x) => x.id === id)!;

describe("editor edits", () => {
  it("moving a group moves what it holds; settling keeps where it was released, in whole pixels", () => {
    const d0 = doc();
    const d1 = moveNodes(d0, V, ["rt"], 13.4, 21);
    expect(n(d1, "llm").x - n(d0, "llm").x).toBeCloseTo(13.4, 5);
    const d2 = ok(settleNodes(d1, V, ["rt"]));
    expect(n(d2, "llm").x).toBe(Math.round(n(d0, "llm").x + 13.4));
    expect(n(d2, "llm").parent).toBe("rt");
  });

  it("dropping a component with its centre in a group makes it a member; out of every group makes it top level", () => {
    const d0 = doc();
    const g = layoutRects(viewOf(d0, V)).get("rt")!;
    const w = layoutRects(viewOf(d0, V)).get("web")!;
    const into = ok(settleNodes(moveNodes(d0, V, ["web"], g.x + g.w / 2 - (w.x + w.w / 2), g.y + g.h / 2 - (w.y + w.h / 2)), V, ["web"]));
    expect(n(into, "web").parent).toBe("rt");
    const out = ok(settleNodes(moveNodes(d0, V, ["llm"], 0, -2000), V, ["llm"]));
    expect(n(out, "llm").parent).toBeNull();
    // A group's only member dragged out, in many small steps, leaves it: the group does not follow.
    const one = ok(deleteNodes(d0, V, ["tool"]));
    let step = one;
    for (let i = 0; i < 20; i++) step = moveNodes(step, V, ["llm"], -40, -40);
    expect(n(ok(settleNodes(step, V, ["llm"])), "llm").parent).toBeNull();
  });

  it("a drop onto a part ends at the nearest free spot on the 8 px grid, 24 px clear (ui contract, A drop never covers)", () => {
    const d0 = doc();
    const r0 = layoutRects(viewOf(d0, V));
    const web = r0.get("web")!, api = r0.get("api")!;
    // web dropped right on top of api.
    const dropped = ok(settleNodes(moveNodes(d0, V, ["web"], api.x - web.x, api.y - web.y), V, ["web"]));
    const r = layoutRects(viewOf(dropped, V)), w = r.get("web")!;
    expect(n(dropped, "web").parent).toBeNull();
    expect([Math.abs(n(dropped, "web").x % 8), Math.abs(n(dropped, "web").y % 8)]).toEqual([0, 0]);
    for (const id of ["api", "rt", "llm", "tool"]) expect(overlaps(w, r.get(id)!, 24 - 0.01), id).toBe(false);
    // The nearest such spot, searched ring by ring on the grid from where it was dropped: no free spot lies on a nearer ring.
    const at = { x: api.x + api.w / 2, y: api.y + api.h / 2 };
    const others = ["api", "rt", "llm", "tool"].map((id) => r.get(id)!);
    const x0 = Math.round((at.x - w.w / 2) / 8) * 8, y0 = Math.round((at.y - w.h / 2) / 8) * 8;
    const ring = (x: number, y: number) => Math.max(Math.abs(x - x0), Math.abs(y - y0)) / 8;
    for (let dx = -40; dx <= 40; dx++) for (let dy = -40; dy <= 40; dy++) {
      const x = x0 + dx * 8, y = y0 + dy * 8;
      if (others.every((o) => !overlaps({ x, y, w: w.w, h: w.h }, o, 24 - 0.01))) expect(ring(x, y)).toBeGreaterThanOrEqual(ring(w.x, w.y));
    }
  });

  it("a drop that overlaps nothing stays exactly where it was released, inside a group's empty area too; a member dropped on a sibling stays in its group", () => {
    const d0 = doc();
    const r0 = layoutRects(viewOf(d0, V));
    // Far right of everything: stays exactly there (on the grid it was snapped to).
    const far = ok(settleNodes(moveNodes(d0, V, ["web"], 1600, 0), V, ["web"]));
    expect([n(far, "web").x, n(far, "web").y]).toEqual([n(d0, "web").x + 1600, n(d0, "web").y]);
    // Into the group's empty area: with its members 600 px apart, a part dropped between them joins it and stays put.
    const rt = r0.get("rt")!, llm = r0.get("llm")!, tool = r0.get("tool")!;
    const wide = ok(moveNodes(d0, V, ["tool"], llm.x + 600 - tool.x, llm.y - tool.y));
    const w = layoutRects(viewOf(wide, V)).get("web")!, l = layoutRects(viewOf(wide, V)).get("llm")!;
    const dx = l.x + 300 - w.x, dy = l.y - w.y;
    const inside = ok(settleNodes(moveNodes(wide, V, ["web"], dx, dy), V, ["web"]));
    expect(n(inside, "web").parent).toBe("rt");
    expect([n(inside, "web").x, n(inside, "web").y]).toEqual([Math.round(n(wide, "web").x + dx), Math.round(n(wide, "web").y + dy)]);
    // A member dropped on its sibling moves clear of it and keeps its group.
    const onSibling = ok(settleNodes(moveNodes(d0, V, ["llm"], tool.x - llm.x, tool.y - llm.y), V, ["llm"]));
    const r = layoutRects(viewOf(onSibling, V));
    expect(n(onSibling, "llm").parent).toBe("rt");
    expect(overlaps(r.get("llm")!, r.get("tool")!)).toBe(false);
    expect(rt.w).toBeGreaterThan(0);
  });

  it("a dropped group that covers a part moves with everything it holds", () => {
    const d0 = doc();
    const r0 = layoutRects(viewOf(d0, V));
    const rt = r0.get("rt")!, api = r0.get("api")!;
    const dropped = ok(settleNodes(moveNodes(d0, V, ["rt"], api.x - rt.x, api.y - rt.y), V, ["rt"]));
    const r = layoutRects(viewOf(dropped, V));
    expect(overlaps(r.get("rt")!, r.get("api")!)).toBe(false);
    expect(overlaps(r.get("rt")!, r.get("web")!)).toBe(false);
    // Its members kept their places inside it.
    expect(n(dropped, "tool").x - n(dropped, "llm").x).toBe(n(d0, "tool").x - n(d0, "llm").x);
    expect([n(dropped, "llm").parent, n(dropped, "tool").parent]).toEqual(["rt", "rt"]);
  });

  it("adds a component at a free spot, inside the group under the click", () => {
    const d0 = doc();
    const web = layoutRects(viewOf(d0, V)).get("web")!;
    const { doc: d1, id } = addNode(d0, V, "data", "panel", { x: web.x + 20, y: web.y + 20 });
    ok(d1);
    expect(n(d1, id)).toMatchObject({ label: "New component", kind: "data", form: "panel", items: ["New item"], parent: null });
    const r = layoutRects(viewOf(d1, V));
    expect(overlaps(r.get(id)!, r.get("web")!)).toBe(false);
    const g = r.get("rt")!;
    const inside = addNode(d1, V, "service", "compact", { x: g.x + g.w / 2, y: g.y + g.h - 10 });
    expect(n(inside.doc, inside.id).parent).toBe("rt");
  });

  it("deleting a group moves its members up and drops their connections; texts stay", () => {
    const d = addText(doc(), V, { x: 0, y: 0 }, "Note").doc;
    const d1 = ok(deleteNodes(d, V, ["rt", "web"]));
    expect(n(d1, "llm").parent).toBeNull();
    expect(viewOf(d1, V).edges.map((e) => e.from)).toEqual(["llm"]);
    expect(viewOf(ok(deleteNodes(d1, V, ["llm"])), V).texts).toHaveLength(1);
  });

  it("form rules: panel shows what it holds or gets an item, an emptied panel is a card, leaving group frees the members", () => {
    const d0 = doc();
    expect(n(setNode(d0, V, "api", { form: "panel" }), "api").items).toEqual(["New item"]);
    const holding = { ...d0, views: d0.views.map((v) => ({ ...v, nodes: v.nodes.map((m) => (m.id === "api" ? { ...m, held: ["Check"] } : m)) })) };
    expect(n(setNode(holding, V, "api", { form: "panel" }), "api").items).toEqual(["Check"]);
    const p = setNode(d0, V, "api", { form: "panel" });
    expect(n(setNode(p, V, "api", { items: [] }), "api").form).toBe("card");
    const d1 = ok(setNode(d0, V, "rt", { form: "card" }));
    expect(n(d1, "llm").parent).toBeNull();
    expect(n(setNode(d0, V, "api", { label: "   " }), "api").label).toBe(n(d0, "api").label);
  });

  it("moving into a group by the parent field places it inside; a loop is refused", () => {
    const d0 = doc();
    const d1 = ok(setNode(d0, V, "web", { parent: "rt" }));
    const r = layoutRects(viewOf(d1, V));
    const g = r.get("rt")!, w = r.get("web")!;
    expect(w.x >= g.x && w.y >= g.y && w.x + w.w <= g.x + g.w && w.y + w.h <= g.y + g.h).toBe(true);
    expect(setNode(d0, V, "rt", { parent: "llm" })).toEqual(d0);
  });

  it("connect: new call, reverse becomes two-way, duplicate and self do nothing", () => {
    const d0 = doc();
    const a = connect(d0, V, "api", "tool");
    expect(viewOf(a.doc, V).edges.find((e) => e.id === a.id)).toMatchObject({ from: "api", to: "tool", style: "call", both: false, step: null, label: "" });
    const b = connect(d0, V, "api", "web");
    expect(b.message).toBe("Made the connection two-way");
    expect(viewOf(b.doc, V).edges.find((e) => e.from === "web")!.both).toBe(true);
    expect(connect(d0, V, "web", "api").doc).toBe(d0);
    expect(connect(d0, V, "web", "web").doc).toBe(d0);
  });

  it("edge fields, reverse", () => {
    const d0 = doc();
    const id = viewOf(d0, V).edges[0].id;
    const d1 = setEdge(d0, V, id, { label: "  POST /x  ", style: "async", step: 0 });
    expect(viewOf(d1, V).edges[0]).toMatchObject({ label: "POST /x", style: "async", step: null });
    expect(viewOf(reverseEdge(d0, V, id), V).edges[0]).toMatchObject({ from: "api", to: "web" });
  });

  it("creates a view inside a component and finds the way back", () => {
    const d0 = doc();
    viewOf(d0, V).nodes.find((x) => x.id === "api")!.label = "Order API";
    const { doc: d1, view } = createInside(d0, V, "api");
    ok(d1);
    // Named after the part's id, not its label (ui contract, callout-create-inside).
    expect(view).toBe("api-inside");
    expect(n(d1, "api").detail).toBe(view);
    expect(viewOf(d1, view).nodes).toHaveLength(1);
    expect(crumbsTo(d1, view)).toEqual([V, view]);
    expect(crumbsTo(d1, V)).toEqual([V]);
  });

  it("a text keeps where it was typed and its size; its size and words change", () => {
    const { doc: d, id } = addText(doc(), V, { x: 3, y: 5 }, "Order flow");
    expect(viewOf(d, V).texts[0]).toEqual({ id, text: "Order flow", x: 3, y: 5, size: 20 });
    const d2 = ok(setText(d, V, id, { size: 37.5, text: "Checkout" }));
    expect(viewOf(d2, V).texts[0]).toMatchObject({ size: 37.5, text: "Checkout" });
  });
});

describe("editor edits keep lanes valid", () => {
  // web, api and the group rt are the main path; db hangs below api; inside rt, llm leads and tool sits above it.
  function laned(): DiagramDocument {
    const file = validateFile({
      schema: "archdraw/diagram@2", title: "T",
      views: [{
        id: "overview", title: "Overview", caption: { title: "T", lede: "" },
        nodes: [
          node("web", { lane: { spine: 0 } }),
          node("api", { lane: { spine: 1 } }),
          node("db", { kind: "data", lane: { anchor: "api", side: "below" } }),
          node("rt", { form: "group", lane: { spine: 2 } }),
          node("llm", { form: "compact", parent: "rt", lane: { spine: 0 } }),
          node("tool", { form: "compact", parent: "rt", lane: { anchor: "llm", side: "above" } }),
        ],
        edges: [], texts: [],
      }],
    });
    if (!file.ok) throw new Error(file.errors.join("\n"));
    return normalizeFile(file.file!, { id: "d_ops0000002", now: NOW, source: null });
  }

  it("deleting a lane's anchor drops the lanes anchored on it", () => {
    const d = ok(deleteNodes(laned(), V, ["api"]));
    expect(n(d, "db").lane).toBeNull();
    expect(n(d, "web").lane).toEqual({ spine: 0 });
  });

  it("deleting a group or leaving group form: a member whose spine order is taken at the top loses its lane", () => {
    for (const d of [deleteNodes(laned(), V, ["rt"]), setNode(laned(), V, "rt", { form: "card" })]) {
      ok(d);
      expect(n(d, "web").lane).toEqual({ spine: 0 });
      expect(n(d, "llm").parent).toBeNull();
      expect(n(d, "llm").lane).toBeNull();
      expect(n(d, "tool").lane).toBeNull();
    }
  });

  it("dragging a member out of its group, or moving a part into a group by the parent field, keeps the lanes valid", () => {
    const out = ok(settleNodes(moveNodes(laned(), V, ["llm"], 3000, 3000), V, ["llm"]));
    expect(n(out, "llm").parent).toBeNull();
    expect(n(out, "llm").lane).toBeNull();
    expect(n(out, "web").lane).toEqual({ spine: 0 });
    // web joins rt, where spine 0 belongs to llm.
    const into = ok(setNode(laned(), V, "web", { parent: "rt" }));
    expect(n(into, "web").parent).toBe("rt");
    expect(n(into, "web").lane).toBeNull();
    expect(n(into, "llm").lane).toEqual({ spine: 0 });
  });

  it("a component's copy inside its new view drops an anchor that is not there", () => {
    const { doc: d, view } = createInside(laned(), V, "db");
    ok(d);
    expect(viewOf(d, view).nodes[0].lane).toBeNull();
  });
});
