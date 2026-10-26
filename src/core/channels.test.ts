import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyChannel, channelView, channelWarnings, joinChannel, markOutside, normalizeFile3, clearOutdated, OVERVIEW_FULL } from "./channels";
import { CONVERTED_V2, convertV2, readAnyFile } from "./convert";
import { makeLinkedInView } from "./testkit";
import { validateDocument3, validateFile3, type Document3, type File3 } from "./file3";
import { layoutRects, routeEdges } from "./geometry";
import { validateFile, type DiagramDocument, type DiagramFile, type DiagramView } from "./model";
import { normalizeFile } from "./normalize";
import { choiceAsFile3 } from "./file4";

const NOW = "2026-10-21T00:00:00.000Z";
const read = (p: string): DiagramFile => JSON.parse(readFileSync(p, "utf8"));
const FIXTURES = ["tests/fixtures/shop.archdraw.json", "tests/fixtures/archdrawer.archdraw.json", "tests/fixtures/hotel.archdraw.json"];

/** A normalised @2 document of a fixture, and the same file converted and normalised as @3. */
function both(f: DiagramFile): { d2: DiagramDocument; d3: Document3 } {
  const d2 = normalizeFile(validateFile(f).file!, { id: "d_roundtrip01", now: NOW, source: null });
  const r = readAnyFile(d2);
  expect(r.errors).toEqual([]);
  return { d2, d3: normalizeFile3(choiceAsFile3(r.file!), { id: "d_roundtrip01", now: NOW, source: null }) };
}

/** Every box and line of a view, as the editor and the export draw them. */
function drawn(v: DiagramView) {
  const rects = layoutRects(v);
  const routes = routeEdges(v, rects);
  return {
    rects: Object.fromEntries([...rects].map(([id, r]) => [id, [r.x, r.y, r.w, r.h]])),
    paths: Object.fromEntries([...routes].map(([id, r]) => [id, r.d])),
  };
}

/** A small @3 document: overview a → b → c, and a LinkedIn view showing a and b. */
function small(extra: (f: File3) => void = () => {}): Document3 {
  const f: File3 = {
    schema: "archdraw/diagram@3", title: "Small",
    facts: {
      components: [
        { id: "a", label: "Alpha", kind: "service", sub: "", description: "A does a.", files: ["src/a.ts"], items: ["One", "Two"] },
        { id: "b", label: "Beta", kind: "data", sub: "store", description: "B keeps b.", files: [], items: [] },
        { id: "c", label: "Gamma", kind: "worker", sub: "", description: "C runs c.", files: [], items: [] },
      ],
      relations: [
        { id: "r1", from: "a", to: "b", label: "writes", style: "call", both: false },
        { id: "r2", from: "b", to: "c", label: "", style: "async", both: false },
      ],
    },
    channels: {
      overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Small", lede: "" },
        nodes: [
          { id: "a", facts: ["a"], form: "panel", icon: null, parent: null, detail: null, place: { row: 0, col: 0 } },
          { id: "b", facts: ["b"], form: "card", icon: null, parent: null, detail: null, place: { row: 0, col: 1 } },
          { id: "c", facts: ["c"], form: "card", icon: null, parent: null, detail: null, place: { row: 0, col: 2 } },
        ],
        edges: [{ id: "e1", from: "a", to: "b", relations: ["r1"], step: 1 }, { id: "e2", from: "b", to: "c", relations: ["r2"], step: 2 }] }] },
      linkedin: { views: [{ id: "linkedin", title: "LinkedIn", caption: { title: "Small", lede: "" },
        nodes: [
          { id: "a", facts: ["a"], form: "card", icon: null, parent: null, detail: null, place: null, lane: { spine: 0 } },
          { id: "b", facts: ["b"], form: "card", icon: null, parent: null, detail: null, place: null, lane: { spine: 1 }, label: "B" },
        ],
        edges: [{ id: "li-e", from: "a", to: "b", relations: ["r1"], step: 1 }] }] },
    },
  };
  extra(f);
  const r = validateFile3(f);
  expect(r.errors).toEqual([]);
  return normalizeFile3(r.file!, { id: "d_small00001", now: NOW, source: null });
}

/** Apply an edit to the joined channel and return the new document. */
function edit(doc: Document3, channel: "overview" | "linkedin", change: (d: DiagramDocument) => void): Document3 {
  const j = joinChannel(doc, channel);
  change(j);
  const r = applyChannel(doc, channel, j);
  if (!r.ok) throw new Error(r.error);
  const v = validateDocument3(r.doc);
  expect(v.ok ? [] : v.errors).toEqual([]);
  return r.doc;
}
const node = (d: DiagramDocument, id: string) => d.views.flatMap((v) => v.nodes).find((n) => n.id === id)!;
const fact = (d: Document3, id: string) => d.facts.components.find((c) => c.id === id);

describe("validateFile3", () => {
  it("accepts the small document and reports every broken rule with its path", () => {
    small();
    const bad = (change: (f: File3) => void) => {
      const f = structuredClone(small()) as unknown as File3;
      change(f);
      return validateFile3(f).errors;
    };
    expect(bad((f) => { f.facts.relations![0].id = "a"; })).toContain('facts.relations[0].id: "a" is used twice; fact ids are unique among facts');
    expect(bad((f) => { (f.channels as Record<string, unknown>).blog = { views: [] }; })).toContain('channels.blog: "blog" is not a channel; use one of overview, linkedin, readme, presentation');
    expect(bad((f) => { const v = structuredClone(f.channels.linkedin!.views![0]); f.channels.readme = { views: [v, { ...structuredClone(v), id: "readme-2" }] }; })[0]).toBe("channels.readme.views: has 2 views; at most 1");
    expect(bad((f) => { f.channels.linkedin!.views![0].nodes[1].facts = ["a"]; })).toContain('channels.linkedin.views[0].nodes[1].facts[0]: "a" is already shown or held by another part of this view');
    expect(bad((f) => { f.channels.linkedin!.views![0].nodes[1].facts = []; })).toEqual(expect.arrayContaining([
      "channels.linkedin.views[0].nodes[1].kind: is required on a part that shows no fact or several",
      "channels.linkedin.views[0].nodes[1].description: is required on a part that shows no fact or several",
    ]));
    expect(bad((f) => { f.channels.overview.views[0].nodes[1].form = "panel"; })).toContain('channels.overview.views[0].nodes[1].items: a panel shows what the part holds; give it items or use form "card"');
    expect(bad((f) => { f.channels.overview.views[0].nodes[1].items = ["x"]; })).toContain('channels.overview.views[0].nodes[1].items: only a panel shows items; set it to null or the form to "panel"');
    expect(bad((f) => { f.channels.linkedin!.views![0].nodes[0].detail = "overview"; })).toContain("channels.linkedin.views[0].nodes[0].detail: must be null outside the overview channel");
    expect(bad((f) => { f.channels.overview.views[0].edges[0].relations = ["r2"]; })).toContain('channels.overview.views[0].edges[0].relations[0]: "r2" does not join a fact of "a" with a fact of "b"');
    expect(bad((f) => { const e = f.channels.overview.views[0].edges[0]; [e.from, e.to] = [e.to, e.from]; })).toContain('channels.overview.views[0].edges[0].relations[0]: "r1" runs the other way; swap "from" and "to"');
    expect(bad((f) => { f.channels.overview.views[0].nodes.pop(); f.channels.overview.views[0].edges.pop(); })).toContain('facts.components[2]: "c" is shown or held by no part of the overview channel; draw it there or remove it');
    expect(bad((f) => { f.channels.linkedin!.outdated = ["a", "a"]; })).toContain("channels.linkedin.outdated: must be distinct ids");
    expect(bad((f) => { (f.channels.linkedin!.views![0] as { subLines?: unknown }).subLines = "no"; })).toContain("channels.linkedin.views[0].subLines: must be true or false when present");
    expect(bad((f) => { f.channels.linkedin!.views![0].subLines = false; })).toEqual([]);
    expect(bad((f) => { f.requests = [{ id: "q1", text: "x", channel: "linkedin", view: "overview", at: NOW }]; })).toContain('requests[0].view: view "overview" is not in the linkedin channel');
    expect(validateFile3({ schema: "archdraw/diagram@1" }).errors).toEqual(['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"']);
  });

  it("checks files against the repository: an error for validate, a warning when opening", () => {
    const f = small() as unknown as File3;
    expect(validateFile3(f, { fileExists: () => false }).errors).toEqual(['facts.components[0].files[0]: "src/a.ts" does not exist in the repository']);
    const r = validateFile3(f, { fileExists: () => false, missingFiles: "warn" });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['facts.components[0].files[0]: "src/a.ts" does not exist in the repository']);
  });
});

describe("joinChannel", () => {
  it("draws a part's own text where it has one and the fact's otherwise; files are the facts' union", () => {
    const doc = small();
    const li = joinChannel(doc, "linkedin");
    expect(node(li, "a")).toMatchObject({ label: "Alpha", kind: "service", items: [], files: ["src/a.ts"], facts: ["a"] });
    expect(node(li, "b")).toMatchObject({ label: "B", sub: "store" });
    expect(li.views[0].postOf).toBe("overview");
    expect(li.views[0].edges[0]).toMatchObject({ label: "writes", style: "call", both: false, relations: ["r1"] });
    expect(node(joinChannel(doc, "overview"), "a").items).toEqual(["One", "Two"]);
    expect(channelView(doc, "readme")).toBeNull();
  });
});

describe("convertV2", () => {
  it.each(FIXTURES)("%s: every component becomes a fact, and the drawing keeps every box and line", (path) => {
    const { d2, d3 } = both(read(path));
    expect(d3.facts.components.map((c) => c.id).sort()).toEqual(d2.views.flatMap((v) => v.nodes.map((n) => n.id)).sort());
    expect(d3.warnings).toContain(CONVERTED_V2);
    const j = joinChannel(d3, "overview");
    expect(j.views.map((v) => v.id)).toEqual(d2.views.map((v) => v.id));
    j.views.forEach((v, i) => expect(drawn(v)).toEqual(drawn(d2.views[i])));
    expect(validateDocument3(d3).ok).toBe(true);
  });

  it("moves a post into the LinkedIn channel, its parts pointing to the facts their from names", () => {
    const { d2: base } = both(read("tests/fixtures/archdrawer.archdraw.json"));
    const { doc: withPost, view } = makeLinkedInView(base, base.views[0].id);
    const post = withPost.views.find((v) => v.id === view)!;
    // As an engine post does: each part names the component it stands for.
    for (const n of post.nodes) n.from = [n.id.replace(/-li$/, "")];
    expect(post.nodes.length).toBeGreaterThan(3);
    const r = readAnyFile(withPost);
    expect(r.errors).toEqual([]);
    const d3 = normalizeFile3(choiceAsFile3(r.file!), { id: "d_post000001", now: NOW, source: null });
    expect(d3.channels.linkedin.views.map((v) => v.id)).toEqual([view]);
    expect(d3.channels.overview.views.map((v) => v.id)).not.toContain(view);
    const li = d3.channels.linkedin.views[0];
    for (const p of li.nodes) {
      const src = post.nodes.find((n) => n.id === p.id)!;
      expect(p.facts).toEqual((src.from ?? []).filter((id, i, all) => all.indexOf(id) === i && d3.facts.components.some((c) => c.id === id)));
    }
    expect(li.nodes.every((p) => p.facts.length === 1)).toBe(true);
    expect(li.edges.filter((e) => e.relations.length === 1).length).toBeGreaterThan(0);
    // What the post drew is drawn the same.
    expect(drawn(joinChannel(d3, "linkedin").views[0])).toEqual(drawn(post));
    // A request on the post moves with it.
    const withRequest = { ...withPost, requests: [{ id: "q1", text: "Shorter", view, at: NOW }] };
    expect(readAnyFile(withRequest).file!.requests).toEqual([{ id: "q1", text: "Shorter", channel: "linkedin", view, at: NOW, choice: "system" }]);
  });

  it("turns a merged component into a part that points to the facts it merges, and keeps a second post as an overview view", () => {
    const f: DiagramFile = read("tests/fixtures/shop.archdraw.json");
    const v0 = f.views[0];
    v0.nodes.push({ ...v0.nodes[0], id: "merged", label: "Merged", from: [v0.nodes[0].id, v0.nodes[1].id, "gone"], place: { row: 3, col: 0 } } as never);
    const inside = { id: "inside", title: "Inside", caption: { title: "Inside", lede: "" }, nodes: [], edges: [], texts: [] };
    f.views.push(inside as never);
    f.views.push({ ...structuredClone(v0), id: "p1", postOf: "overview", nodes: [{ ...v0.nodes[0], id: "x-li", from: [v0.nodes[0].id] }], edges: [] } as never);
    f.views.push({ ...structuredClone(v0), id: "p2", postOf: "inside", nodes: [{ ...v0.nodes[1], id: "y-li", from: [v0.nodes[1].id] }], edges: [] } as never);
    const r = readAnyFile(f);
    expect(r.errors).toEqual([]);
    const { file, warnings } = convertV2(validateFile(f).file!);
    const merged = file.channels.overview.views[0].nodes.find((n) => n.id === "merged")!;
    expect(merged).toMatchObject({ label: "Merged" });
    // Both originals are shown in this view already, so the merged part keeps neither.
    expect(merged.facts).toEqual([]);
    expect(file.facts.components.map((c) => c.id)).not.toContain("merged");
    expect(file.channels.linkedin!.views!.map((v) => v.id)).toEqual(["p1"]);
    expect(file.channels.overview.views.map((v) => v.id)).toContain("p2");
    expect(warnings).toEqual(expect.arrayContaining([
      'The post "p2" is now a view of the overview; the LinkedIn channel holds one drawing',
      "Dropped the merge history of parts that name components no longer in the drawing",
    ]));
  });

  it("refuses an invalid @2 file with its @2 paths", () => {
    const f = read("tests/fixtures/shop.archdraw.json");
    f.views[0].nodes[0].kind = "database" as never;
    expect(readAnyFile(f).errors[0]).toMatch(/^views\[0\]\.nodes\[0\]\.kind: "database" is not a kind/);
  });
});

describe("applyChannel", () => {
  it("the sub-line switch: joined as false only, set by the editor, kept when an answer leaves it out, cleared by true (review R177-4)", () => {
    expect(joinChannel(small(), "linkedin").views[0].subLines).toBeUndefined();
    const off = edit(small(), "linkedin", (d) => { d.views[0].subLines = false; });
    expect(off.channels.linkedin.views[0].subLines).toBe(false);
    expect(joinChannel(off, "linkedin").views[0].subLines).toBe(false);
    expect(off.channels.overview.views[0].subLines).toBeUndefined();
    // An engine's answer has no switch: the view keeps its own.
    expect(edit(off, "linkedin", (d) => { delete d.views[0].subLines; }).channels.linkedin.views[0].subLines).toBe(false);
    expect(edit(off, "linkedin", (d) => { d.views[0].subLines = true; }).channels.linkedin.views[0].subLines).toBeUndefined();
  });

  it("a rename in the overview edits the fact: every channel shows it and nobody is marked", () => {
    const doc = edit(small(), "overview", (d) => { node(d, "a").label = "Alpha 2"; });
    expect(fact(doc, "a")!.label).toBe("Alpha 2");
    expect(node(joinChannel(doc, "linkedin"), "a").label).toBe("Alpha 2");
    expect(doc.channels.linkedin.outdated).toEqual([]);
  });

  it("a rename of a part whose LinkedIn version keeps its own name marks LinkedIn", () => {
    const doc = edit(small(), "overview", (d) => { node(d, "b").label = "Beta 2"; });
    expect(node(joinChannel(doc, "linkedin"), "b").label).toBe("B");
    expect(doc.channels.linkedin.outdated).toEqual(["b"]);
    expect(clearOutdated(doc, "linkedin").channels.linkedin.outdated).toEqual([]);
  });

  it("outside the overview a rename becomes the part's own name, and a description edits the fact", () => {
    const doc = edit(small(), "linkedin", (d) => { node(d, "a").label = "A"; node(d, "a").description = "A does more."; });
    expect(doc.channels.linkedin.views[0].nodes[0].label).toBe("A");
    expect(fact(doc, "a")).toMatchObject({ label: "Alpha", description: "A does more." });
    expect(doc.channels.overview.outdated).toEqual([]);
    expect(doc.channels.linkedin.outdated).toEqual([]);
    // Renaming it back to the fact's name clears its own name.
    expect(edit(doc, "linkedin", (d) => { node(d, "a").label = "Alpha"; }).channels.linkedin.views[0].nodes[0].label).toBeUndefined();
  });

  it("moving, form and items shown change only the channel", () => {
    const doc = edit(small(), "linkedin", (d) => { node(d, "a").x += 80; node(d, "a").form = "panel"; node(d, "a").items = ["One"]; });
    const a = doc.channels.linkedin.views[0].nodes[0];
    expect(a).toMatchObject({ form: "panel", items: ["One"] });
    expect(fact(doc, "a")!.items).toEqual(["One", "Two"]);
    expect(doc.channels.overview.views[0].nodes[0].x).toBe(small().channels.overview.views[0].nodes[0].x);
    // Showing all the fact's items needs no own list.
    const all = edit(small(), "linkedin", (d) => { node(d, "a").form = "panel"; node(d, "a").items = ["One", "Two"]; });
    expect(all.channels.linkedin.views[0].nodes[0].items).toBeUndefined();
  });

  it("items edited on a panel edit the fact; a fact left without items turns other panels into cards", () => {
    const withPanel = edit(small(), "linkedin", (d) => { node(d, "a").form = "panel"; node(d, "a").items = ["One", "Two"]; });
    const doc = edit(withPanel, "overview", (d) => { node(d, "a").items = ["One", "Two", "Three"]; });
    expect(fact(doc, "a")!.items).toEqual(["One", "Two", "Three"]);
    expect(node(joinChannel(doc, "linkedin"), "a").items).toEqual(["One", "Two", "Three"]);
    const hidden = edit(withPanel, "overview", (d) => { node(d, "a").form = "card"; });
    expect(fact(hidden, "a")!.items).toEqual(["One", "Two"]); // leaving panel removes nothing from the fact
    // Removing the last item empties the fact; every panel that showed it becomes a card.
    const one = edit(withPanel, "overview", (d) => { node(d, "a").items = ["One"]; });
    const none = edit(one, "overview", (d) => { node(d, "a").form = "card"; node(d, "a").items = []; });
    expect(fact(none, "a")!.items).toEqual([]);
    expect(none.channels.linkedin.views[0].nodes[0].form).toBe("card");
    // A card shows nothing it holds, but the editor knows it.
    expect(node(joinChannel(hidden, "overview"), "a")).toMatchObject({ items: [], held: ["One", "Two"] });
  });

  it("files belong to the facts", () => {
    const doc = edit(small(), "linkedin", (d) => { node(d, "a").files = ["src/b.ts"]; });
    expect(fact(doc, "a")!.files).toEqual(["src/b.ts"]);
  });

  it("adding a part adds a fact; outside the overview it also gets a part in the overview's first view", () => {
    const doc = edit(small(), "linkedin", (d) => {
      d.views[0].nodes.push({ ...node(d, "a"), id: "new-component", label: "New component", facts: undefined, x: 900, y: 0, lane: null });
    });
    expect(fact(doc, "new-component")).toMatchObject({ label: "New component" });
    const added = doc.channels.overview.views[0].nodes.find((n) => n.facts[0] === "new-component")!;
    expect(added).toMatchObject({ id: "new-component", form: "card" });
    expect(doc.channels.overview.outdated).toEqual(["new-component"]);
    expect(doc.channels.linkedin.outdated).toEqual([]);
  });

  it("a new part with facts: [] belongs to its channel only and adds no fact", () => {
    const doc = edit(small(), "linkedin", (d) => {
      d.views[0].nodes.push({ ...node(d, "a"), id: "zone", label: "Zone", kind: "service", description: "A frame.", facts: [], form: "group", x: 900, y: 0, lane: null });
    });
    expect(doc.facts.components).toHaveLength(3);
    expect(doc.channels.linkedin.views[0].nodes.find((n) => n.id === "zone")).toMatchObject({ facts: [], label: "Zone", kind: "service", description: "A frame." });
    expect(doc.channels.overview.outdated).toEqual([]);
  });

  it("refuses an addition outside the overview when the overview's first view is full", () => {
    const full = small((f) => {
      for (let i = 0; i < 57; i++) {
        f.facts.components.push({ id: `f${i}`, label: `F${i}`, kind: "service", sub: "", description: "x", files: [], items: [] });
        f.channels.overview.views[0].nodes.push({ id: `f${i}`, facts: [`f${i}`], form: "card", icon: null, parent: null, detail: null, place: null });
      }
    });
    const j = joinChannel(full, "linkedin");
    j.views[0].nodes.push({ ...node(j, "a"), id: "extra", facts: undefined });
    expect(applyChannel(full, "linkedin", j)).toEqual({ ok: false, error: OVERVIEW_FULL });
  });

  it("deleting a part in the overview deletes its fact and relations; the LinkedIn part goes too and LinkedIn is marked", () => {
    const doc = edit(small(), "overview", (d) => {
      d.views[0].nodes = d.views[0].nodes.filter((n) => n.id !== "a");
      d.views[0].edges = d.views[0].edges.filter((e) => e.from !== "a");
    });
    expect(fact(doc, "a")).toBeUndefined();
    expect(doc.facts.relations.map((r) => r.id)).toEqual(["r2"]);
    expect(doc.channels.linkedin.views[0].nodes.map((n) => n.id)).toEqual(["b"]);
    expect(doc.channels.linkedin.views[0].edges).toEqual([]);
    expect(doc.channels.linkedin.outdated).toEqual(["a", "r1"]);
  });

  it("deleting a fact in the overview drops the lane of a LinkedIn part anchored to the part that goes", () => {
    const doc = edit(small((f) => {
      f.facts.components.push({ id: "d", label: "Delta", kind: "data", sub: "", description: "D stores d.", files: [], items: [] });
      f.channels.overview.views[0].nodes.push({ id: "d", facts: ["d"], form: "card", icon: null, parent: null, detail: null, place: { row: 1, col: 0 } });
      f.channels.linkedin!.views![0].nodes.push({ id: "d", facts: ["d"], form: "card", icon: null, parent: null, detail: null, place: null, lane: { anchor: "b", side: "below" } });
    }), "overview", (d) => { d.views[0].nodes = d.views[0].nodes.filter((n) => n.id !== "b"); d.views[0].edges = d.views[0].edges.filter((e) => e.from !== "b" && e.to !== "b"); });
    expect(doc.channels.linkedin.views[0].nodes.map((p) => [p.id, p.lane])).toEqual([["a", { spine: 0 }], ["d", null]]);
  });

  it("deleting a part elsewhere only leaves it out of that channel", () => {
    const doc = edit(small(), "linkedin", (d) => { d.views[0].nodes = d.views[0].nodes.filter((n) => n.id !== "b"); d.views[0].edges = []; });
    expect(fact(doc, "b")).toBeDefined();
    expect(doc.facts.relations).toHaveLength(2);
    expect(doc.channels.overview.outdated).toEqual([]);
  });

  it("connecting two parts adds a relation, or shows the one that joins them; the other channel is marked for a new one", () => {
    const doc = edit(small(), "overview", (d) => { d.views[0].edges.push({ id: "e3", from: "a", to: "c", label: "", style: "call", both: false, step: null }); });
    expect(doc.facts.relations.find((r) => r.from === "a" && r.to === "c")).toMatchObject({ id: "r3" });
    // LinkedIn does not show c, so a relation to c is nothing it needs.
    expect(doc.channels.linkedin.outdated).toEqual([]);
    const back = edit(small(), "linkedin", (d) => { d.views[0].edges = []; });
    const again = edit(back, "linkedin", (d) => { d.views[0].edges.push({ id: "li-e", from: "b", to: "a", label: "", style: "call", both: false, step: null }); });
    const c = again.channels.linkedin.views[0].edges[0];
    expect(c).toMatchObject({ from: "a", to: "b", relations: ["r1"] });
  });

  it("making a connection two-way: in the overview the relation, elsewhere the connection's own flag", () => {
    const o = edit(small(), "overview", (d) => { d.views[0].edges[0].both = true; });
    expect(o.facts.relations[0].both).toBe(true);
    const l = edit(small(), "linkedin", (d) => { d.views[0].edges[0].both = true; });
    expect(l.facts.relations[0].both).toBe(false);
    expect(l.channels.linkedin.views[0].edges[0].both).toBe(true);
  });

  it("a merged part (several facts) changes only the channel; simplify-like merges keep every fact", () => {
    const doc = edit(small(), "overview", (d) => {
      const v = d.views[0];
      v.nodes = [{ ...v.nodes[0], id: "ab", label: "A and B", facts: ["a", "b"] }, v.nodes[2]];
      v.edges = [{ id: "e9", from: "ab", to: "c", label: "", style: "async", both: false, step: null, relations: ["r2"] }];
    });
    expect(doc.facts.components.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(doc.channels.overview.views[0].nodes[0]).toMatchObject({ id: "ab", facts: ["a", "b"], label: "A and B" });
  });

  it("a kept part that comes to show several facts keeps what it drew as its own text, with or without keepFacts", () => {
    for (const keepFacts of [false, true]) {
      const j = joinChannel(small(), "overview");
      const v = j.views[0];
      // As an engine merges: `a` stays, now standing for `b` too, its text untouched.
      v.nodes = [{ ...v.nodes[0], facts: ["a", "b"] }, v.nodes[2]];
      v.edges = [{ id: "e9", from: "a", to: "c", label: "", style: "async", both: false, step: null, relations: ["r2"] }];
      const r = applyChannel(small(), "overview", j, { keepFacts });
      if (!r.ok) throw new Error(r.error);
      const checked = validateDocument3(r.doc);
      expect(checked.ok ? [] : checked.errors, `keepFacts ${keepFacts}`).toEqual([]);
      expect(r.doc.channels.overview.views[0].nodes[0]).toMatchObject({ id: "a", facts: ["a", "b"], label: "Alpha", kind: "service", description: "A does a.", items: ["One", "Two"] });
    }
  });

  it("a part the editor adds on the LinkedIn channel adds a fact and an overview part", () => {
    const d = joinChannel(small(), "linkedin");
    const post = d.views[0];
    post.nodes.push({ ...post.nodes[0], id: "queue", label: "Queue", facts: undefined, from: undefined, lane: null, x: 900, y: 0 });
    const r = applyChannel(small(), "linkedin", d);
    if (!r.ok) throw new Error(r.error);
    expect(fact(r.doc, "queue")).toMatchObject({ label: "Queue" });
    expect(r.doc.channels.overview.views[0].nodes.some((n) => n.facts[0] === "queue")).toBe(true);
    expect(r.doc.channels.linkedin.views[0].nodes.find((n) => n.id === "queue")!.facts).toEqual(["queue"]);
  });
});

describe("markOutside and warnings", () => {
  it("an outside write marks the channels whose views it did not change", () => {
    const before = small();
    const after = structuredClone(before);
    after.facts.components.find((c) => c.id === "b")!.label = "Beta 3";
    expect(markOutside(before, after).channels.linkedin.outdated).toEqual(["b"]);
    after.channels.linkedin.views[0].nodes[1].label = "B3";
    expect(markOutside(before, after).channels.linkedin.outdated).toEqual([]);
  });

  it("gives the overview no count target and skips the depth checks on LinkedIn", () => {
    const w = channelWarnings(small());
    expect(w.some((x) => x.includes("the overview has"))).toBe(false);
    expect(w.some((x) => x.startsWith("channels.linkedin"))).toBe(false);
  });
});

describe("edits that once left an invalid file (bug sweep)", () => {
  const card = (id: string, extra: object = {}) => ({ id, facts: [id], form: "card" as const, icon: null, parent: null, detail: null, place: null, ...extra });
  type Parts = File3["channels"]["overview"]["views"][number]["nodes"];
  /** An agent with a held mechanism `loop` and its own items, drawn in the overview and the README. */
  function agentDoc(readme: Parts): Document3 {
    const f: File3 = {
      schema: "archdraw/diagram@3", title: "Agent",
      facts: {
        components: [
          { id: "api", label: "API", kind: "service", sub: "", description: "Takes calls.", files: [], items: [] },
          { id: "agent", label: "Agent", kind: "llm", sub: "", description: "Runs the loop.", files: [], items: ["Plan", "Act"] },
          { id: "loop", label: "The loop", kind: "service", sub: "", description: "Turns.", files: [], items: [], within: "agent" },
          { id: "db", label: "DB", kind: "data", sub: "", description: "Keeps rows.", files: [], items: [] },
          { id: "tools", label: "Tools", kind: "service", sub: "", description: "Calls tools.", files: [], items: [] },
          { id: "memory", label: "Memory", kind: "data", sub: "", description: "Remembers.", files: [], items: [] },
        ],
        relations: [{ id: "r1", from: "api", to: "agent", label: "asks", style: "call", both: false }],
      },
      channels: {
        overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Agent", lede: "" }, nodes: [
          card("api"), card("agent", { form: "panel", held: ["loop"] }), card("db"), card("tools"), card("memory"),
        ], edges: [{ id: "e1", from: "api", to: "agent", relations: ["r1"], step: 1 }] }] },
        readme: { views: [{ id: "readme", title: "README", caption: { title: "Agent", lede: "" }, nodes: readme, edges: [] }] },
      },
    };
    const r = validateFile3(f);
    expect(r.errors).toEqual([]);
    return normalizeFile3(r.file!, { id: "d_agentsweep", now: NOW, source: null });
  }
  const removeHeldRow = (d: DiagramDocument) => {
    const a = node(d, "agent");
    a.items = a.items.slice(1);
    a.heldIds = [];
  };

  it("#118 removing a held row in the overview turns a README panel with nothing else to show into a card", () => {
    const doc = agentDoc([card("agent", { form: "panel", held: ["loop"], items: [], lane: { spine: 0 } })]);
    expect(joinChannel(doc, "readme").views[0].nodes[0].items).toEqual(["The loop"]);
    const next = edit(doc, "overview", removeHeldRow);
    expect(fact(next, "loop")).toBeUndefined();
    const p = next.channels.readme.views[0].nodes[0];
    expect(p.form).toBe("card");
    expect(p.items).toBeUndefined();
  });

  it("#118 removing a held row in the overview turns a merged README panel with nothing else to show into a card", () => {
    const doc = agentDoc([card("m", { facts: ["agent", "db"], form: "panel", held: ["loop"], lane: { spine: 0 }, label: "Agent and DB", kind: "service", description: "Runs and keeps." })]);
    const next = edit(doc, "overview", removeHeldRow);
    expect(next.channels.readme.views[0].nodes[0]).toMatchObject({ id: "m", form: "card", facts: ["agent", "db"] });
  });

  it("#119 deleting a holder in the overview gives its README members free spine orders among their new siblings", () => {
    const doc = agentDoc([
      card("api", { lane: { spine: 0 } }),
      card("agent", { form: "group", lane: { spine: 1 } }),
      card("db", { lane: { spine: 2 } }),
      card("tools", { parent: "agent", lane: { spine: 0 } }),
      card("memory", { parent: "agent", lane: { spine: 1 } }),
    ]);
    const next = edit(doc, "overview", (d) => { d.views[0].nodes = d.views[0].nodes.filter((n) => n.id !== "agent"); d.views[0].edges = []; });
    const parts = new Map(next.channels.readme.views[0].nodes.map((p) => [p.id, p]));
    expect([...parts.keys()]).toEqual(["api", "db", "tools", "memory"]);
    expect(parts.get("tools")!.parent).toBeNull();
    const orders = [...parts.values()].map((p) => (p.lane && "spine" in p.lane ? p.lane.spine : null)).filter((s) => s !== null);
    expect(new Set(orders).size).toBe(orders.length);
    // The members follow their new siblings, in the order they had.
    expect(["api", "db", "tools", "memory"].map((id) => parts.get(id)!.lane)).toEqual([{ spine: 0 }, { spine: 2 }, { spine: 3 }, { spine: 4 }]);
  });

  it("#120 turning two-way off in the overview reorients a reversed LinkedIn connection that comes to follow the relation", () => {
    let doc = small((f) => {
      f.facts.relations![0].both = true;
      f.channels.linkedin!.views![0].edges = [{ id: "li-e", from: "b", to: "a", relations: ["r1"], step: 1 }];
    });
    doc = edit(doc, "linkedin", (d) => { d.views[0].edges[0].both = false; });
    expect(doc.channels.linkedin.views[0].edges[0]).toMatchObject({ from: "b", to: "a", both: false });
    doc = edit(doc, "overview", (d) => { d.views[0].edges.find((e) => e.id === "e1")!.both = false; });
    const c = doc.channels.linkedin.views[0].edges[0];
    expect(c).toMatchObject({ from: "a", to: "b", relations: ["r1"] });
    expect(c.both).toBeUndefined();
  });

  it("#121 a new relation or part takes an id no limit fact has", () => {
    const withLimit = (id: string) => (f: File3) => { f.facts.limits = [{ id, on: "a", text: "At most 3" }]; };
    let doc = small(withLimit("r3"));
    doc = edit(doc, "overview", (d) => { d.views[0].edges.push({ id: "new-e", from: "a", to: "c", label: "", style: "call", both: false, step: null }); });
    expect(doc.facts.relations.find((r) => r.from === "a" && r.to === "c")!.id).not.toBe("r3");
    doc = small(withLimit("turn-limit"));
    doc = edit(doc, "overview", (d) => { d.views[0].nodes.push({ ...node(d, "c"), id: "turn-limit", label: "Turn limit", facts: undefined, x: 900, y: 40 }); });
    expect(doc.facts.components.map((c) => c.id)).not.toContain("turn-limit");
  });

  it("#123 an answer that gives one fact to two parts drops the relation a connection no longer joins, with one warning", () => {
    const doc = small();
    const j = joinChannel(doc, "overview");
    const a = node(j, "a");
    a.facts = undefined;
    a.from = ["a", "b"];
    const r = applyChannel(doc, "overview", { views: j.views, warnings: j.warnings }, { answer: true });
    if (!r.ok) throw new Error(r.error);
    const v = validateDocument3(r.doc);
    expect(v.ok ? [] : v.errors).toEqual([]);
    expect(r.doc.warnings).toContain('View "overview": "b" no longer shows "b", which an earlier part shows');
    // "b" now shows no fact: each connection at it stops showing its relation, one warning each.
    expect(["r1", "r2"].map((id) => r.doc.warnings.filter((x) => x.includes(`"${id}"`)).length)).toEqual([1, 1]);
  });
});
