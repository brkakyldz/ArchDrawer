import { describe, expect, it } from "vitest";
import { applyChannel, joinChannel, normalizeFile3 } from "../../core/channels";
import { readAnyFile } from "../../core/convert";
import { validateDocument3, type ChannelId, type Document3 } from "../../core/file3";
import { type DiagramDocument } from "../../core/model";
import { node } from "../../core/testkit";
import { addNode, createInside, deleteNodes, reservedIds, setNode } from "./ops";
import { choiceAsFile3 } from "../../core/file4";

// Editor operations routed through the facts/channel split, as the editor applies them (FILE-3).

const NOW = "2026-10-21T00:00:00.000Z";

/** Overview: web → api (a card whose fact holds two items), a group rt; a LinkedIn post of web and api. */
function stored(): Document3 {
  const v2 = {
    schema: "archdraw/diagram@2", title: "T",
    views: [
      { id: "overview", title: "Overview", caption: { title: "T", lede: "" },
        nodes: [node("web", { kind: "client", place: { row: 0, col: 0 } }), node("api", { kind: "api", form: "panel", items: ["Check", "Store"], place: { row: 0, col: 1 } }), node("rt", { form: "group", place: { row: 1, col: 1 } })],
        edges: [{ from: "web", to: "api", label: "", style: "call", both: false, step: 1 }], texts: [] },
      { id: "post", title: "LinkedIn", caption: { title: "T", lede: "" }, postOf: "overview",
        nodes: [node("web-li", { kind: "client", label: "Web", from: ["web"], place: null }), node("api-li", { kind: "api", label: "Api", description: "What api does.", from: ["api"], place: null })],
        edges: [], texts: [] },
    ],
  };
  const r = readAnyFile(v2);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return normalizeFile3(choiceAsFile3(r.file!), { id: "d_split00001", now: NOW, source: null });
}

/** Apply one editor operation on the channel whose view it changes, and split it back, as the editor does on that tab. */
function edit(d: Document3, op: (j: DiagramDocument) => DiagramDocument): Document3 {
  const channels: ChannelId[] = ["overview", "linkedin"];
  const c = channels.find((ch) => { const j = joinChannel(d, ch); return JSON.stringify(op(structuredClone(j))) !== JSON.stringify(j); });
  if (!c) throw new Error("The operation changed no channel");
  const r = applyChannel(d, c, op(joinChannel(d, c)));
  if (!r.ok) throw new Error(r.error);
  const v = validateDocument3(r.doc);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return r.doc;
}
const fact = (d: Document3, id: string) => d.facts.components.find((c) => c.id === id)!;
const part = (d: Document3, id: string) => [...d.channels.overview.views, ...d.channels.linkedin.views].flatMap((v) => v.nodes).find((n) => n.id === id)!;

describe("editor edits split into facts and channels", () => {
  it("a panel in the post shows what its fact holds; hiding items keeps them in the fact", () => {
    const d = edit(stored(), (j) => setNode(j, "post", "api-li", { form: "panel" }));
    expect(part(d, "api-li")).toMatchObject({ form: "panel" });
    expect(part(d, "api-li").items).toBeUndefined();
    expect(joinChannel(d, "linkedin").views[0].nodes.find((n) => n.id === "api-li")!.items).toEqual(["Check", "Store"]);
    const card = edit(d, (j) => setNode(j, "overview", "api", { form: "card" }));
    expect(fact(card, "api").items).toEqual(["Check", "Store"]);
    // A part whose fact holds nothing gets `New item` in the fact.
    const web = edit(stored(), (j) => setNode(j, "overview", "web", { form: "panel" }));
    expect(fact(web, "web").items).toEqual(["New item"]);
  });

  it("removing the last item empties the fact and turns the post's panel into a card", () => {
    let d = edit(stored(), (j) => setNode(j, "post", "api-li", { form: "panel" }));
    d = edit(d, (j) => setNode(j, "overview", "api", { items: ["Check"] }));
    expect(fact(d, "api").items).toEqual(["Check"]);
    d = edit(d, (j) => setNode(j, "overview", "api", { items: [] }));
    expect(fact(d, "api").items).toEqual([]);
    expect(part(d, "api").form).toBe("card");
    expect(part(d, "api-li").form).toBe("card");
  });

  it("a rename in the overview edits the fact; in the post it is the post's own name", () => {
    const o = edit(stored(), (j) => setNode(j, "overview", "api", { label: "Order API" }));
    expect(fact(o, "api").label).toBe("Order API");
    expect(joinChannel(o, "linkedin").views[0].nodes.find((n) => n.id === "api-li")!.label).toBe("Order API");
    const p = edit(stored(), (j) => setNode(j, "post", "api-li", { label: "API", description: "Takes the orders." }));
    expect(fact(p, "api")).toMatchObject({ label: "Api", description: "Takes the orders." });
    expect(part(p, "api-li").label).toBe("API");
  });

  it("files belong to the facts", () => {
    const d = edit(stored(), (j) => setNode(j, "post", "web-li", { files: ["web/index.html"] }));
    expect(fact(d, "web").files).toEqual(["web/index.html"]);
    expect(joinChannel(d, "overview").views[0].nodes.find((n) => n.id === "web")!.files).toEqual(["web/index.html"]);
  });

  it("deleting in the post leaves the fact; deleting in the overview deletes it and the post's part", () => {
    const p = edit(stored(), (j) => deleteNodes(j, "post", ["web-li"]));
    expect(fact(p, "web")).toBeDefined();
    const o = edit(stored(), (j) => deleteNodes(j, "overview", ["web"]));
    expect(o.facts.components.map((c) => c.id)).toEqual(["api", "rt"]);
    expect(o.channels.linkedin.views[0].nodes.map((n) => n.id)).toEqual(["api-li"]);
    expect(o.channels.linkedin.outdated).toEqual(["web", "r1"]);
  });

  it("a part added in the overview is a new fact; its inside view's copy points to the same fact", () => {
    let id = "";
    const added = edit(stored(), (j) => { const r = addNode(j, "overview", "service", "card", { x: 900, y: 40 }); id = r.id; return r.doc; });
    expect(fact(added, id)).toMatchObject({ label: "New component", kind: "service" });
    let view = "";
    const inside = edit(added, (j) => { const r = createInside(j, "overview", "api"); view = r.view; return r.doc; });
    const copy = inside.channels.overview.views.find((v) => v.id === view)!.nodes[0];
    expect(copy.facts).toEqual(["api"]);
    expect(inside.facts.components).toHaveLength(added.facts.components.length);
    // A group copied as a card keeps pointing to the group's fact.
    const g = edit(stored(), (j) => createInside(j, "overview", "rt").doc);
    expect(g.channels.overview.views[1].nodes[0]).toMatchObject({ form: "card", facts: ["rt"] });
  });

  it("a new part never takes the id of a limit fact, or of a fact the channel does not draw", () => {
    const base = stored();
    base.facts.limits = [{ id: "new-component", on: "api", text: "At most 3 turns" }];
    base.facts.components.push({ ...structuredClone(fact(base, "web")), id: "new-component-2", label: "Undrawn" });
    // The overview draws every component; the undrawn one is drawn there too, so give it a part.
    base.channels.overview.views[0].nodes.push({ ...structuredClone(part(base, "web")), id: "new-component-2", facts: ["new-component-2"], x: 900, y: 400 });
    expect(validateDocument3(base).ok).toBe(true);
    for (const vid of ["overview", "post"]) {
      let id = "";
      const d = edit(base, (j) => { const r = addNode(j, vid, "service", "card", { x: 900, y: 40 }, reservedIds(base)); id = r.id; return r.doc; });
      expect(id).not.toBe("new-component");
      expect(id).not.toBe("new-component-2");
      // The id the editor picked is the part's id in the file (the editor selects it and edits its label).
      expect([...d.channels.overview.views, ...d.channels.linkedin.views].some((v) => v.nodes.some((n) => n.id === id))).toBe(true);
    }
  });
});
