import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { joinChannel, normalizeFile3 } from "./channels";
import { readAnyFile } from "./convert";
import { prepareLinkedIn } from "./export/feed";
import { validateDocument3, validateFile3, type Document3, type File3 } from "./file3";
import { intentToChannel, type StoryIntent, type StoryPart } from "./intent";

const NOW = "2026-10-21T00:00:00.000Z";
const load = (p: string): Document3 => normalizeFile3(readAnyFile(JSON.parse(readFileSync(p, "utf8"))).file!, { id: "d_linkedin01", now: NOW, source: null });
const prepared = (d: Document3) => { const r = prepareLinkedIn(d); if (!r.ok) throw new Error(r.error); return r.doc; };

describe("the simple LinkedIn version (prepareLinkedIn)", () => {
  it("draws the channel from the overview's first view: same ids and facts, no own text, connections showing the relations", () => {
    const d = load("tests/fixtures/shop.archdraw.json");
    const out = prepared(d);
    expect(validateDocument3(out).ok).toBe(true);
    const [v] = out.channels.linkedin.views;
    expect(out.channels.linkedin.views).toHaveLength(1);
    expect(v).toMatchObject({ id: "linkedin", title: "LinkedIn", caption: d.channels.overview.views[0].caption, texts: [] });
    expect(v.nodes.map((p) => [p.id, p.facts])).toEqual(d.channels.overview.views[0].nodes.map((p) => [p.id, p.facts]));
    for (const p of v.nodes) expect([p.label, p.kind, p.sub, p.description, p.items], p.id).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(v.edges.map((c) => [c.id, c.relations, c.step])).toEqual([["li-e", ["r1"], 1], ["li-e-2", ["r2"], 2]]);
    // The facts and the other channels stay; the channel's own marks go.
    expect(out.facts).toEqual(d.facts);
    expect(out.channels.overview).toEqual(d.channels.overview);
    expect(out.channels.linkedin.outdated).toEqual([]);
  });

  it("replaces what the channel held, keeping its view's id", () => {
    const d = prepared(load("tests/fixtures/shop.archdraw.json"));
    const renamed: Document3 = { ...d, channels: { ...d.channels, linkedin: { ...d.channels.linkedin, views: [{ ...d.channels.linkedin.views[0], id: "post", nodes: [] , edges: [] }], outdated: ["web"] } } };
    const again = prepared(renamed);
    expect(again.channels.linkedin.views.map((v) => v.id)).toEqual(["post"]);
    expect(again.channels.linkedin.views[0].nodes.map((p) => p.id)).toEqual(d.channels.linkedin.views[0].nodes.map((p) => p.id));
    expect(again.channels.linkedin.outdated).toEqual([]);
  });

  it("points a folded group at its own facts and its members'", () => {
    for (const f of ["tests/fixtures/hotel.archdraw.json", "tests/fixtures/archdrawer.archdraw.json"]) {
      const d = load(f);
      const src = joinChannel(d, "overview").views[0];
      const out = prepared(d);
      expect(validateDocument3(out).ok, f).toBe(true);
      const inside = (gid: string): string[] => src.nodes.filter((m) => m.parent === gid).flatMap((m) => [...(m.facts ?? []), ...inside(m.id)]);
      for (const p of out.channels.linkedin.views[0].nodes) {
        const was = src.nodes.find((m) => m.id === p.id)!;
        expect(p.facts, `${f} ${p.id}`).toEqual([...new Set([...(was.facts ?? []), ...(was.form === "group" ? inside(was.id) : [])])]);
      }
      // A part showing several facts or none says what it is itself.
      for (const p of out.channels.linkedin.views[0].nodes.filter((x) => x.facts.length !== 1)) expect(p.label, `${f} ${p.id}`).toBeTruthy();
    }
  });

  it("drops the lane of a side part anchored inside a folded group, and never returns an invalid drawing", () => {
    const comp = (id: string) => ({ id, label: id.toUpperCase(), kind: "service" as const, sub: "", description: `${id} works.`, files: [], items: [] });
    const part = (id: string, extra: object) => ({ id, facts: [id], form: "card" as const, icon: null, parent: null, detail: null, place: null, ...extra });
    const f: File3 = {
      schema: "archdraw/diagram@3", title: "Lanes",
      facts: { components: ["a", "g", "b", "c"].map(comp), relations: [{ id: "r1", from: "a", to: "b", label: "", style: "call", both: false }] },
      channels: { overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Lanes", lede: "" },
        nodes: [part("a", { lane: { spine: 0 } }), part("g", { form: "group" }), part("b", { parent: "g", lane: { spine: 1 } }), part("c", { lane: { anchor: "b", side: "below" } })],
        edges: [{ id: "e1", from: "a", to: "b", relations: ["r1"], step: 1 }] }] } },
    };
    const r = validateFile3(f);
    expect(r.errors).toEqual([]);
    const out = prepared(normalizeFile3(r.file!, { id: "d_lanes00001", now: NOW, source: null }));
    const v = out.channels.linkedin.views[0];
    expect(v.nodes.map((p) => p.id)).toEqual(["a", "g", "c"]);
    expect(v.nodes.find((p) => p.id === "c")!.lane).toBeNull();
    expect(validateDocument3(out).ok).toBe(true);
  });
});

const part = (id: string, extra: Partial<StoryPart>): StoryPart =>
  ({ id, label: id, sub: "", kind: "service", chips: [], zone: null, spine: null, anchor: null, side: null, from: [], ...extra });

describe("a post answer as the LinkedIn channel (intentToChannel)", () => {
  const intent: StoryIntent = {
    title: "How an order flows", lede: "",
    zones: [{ id: "back", label: "Back end" }],
    parts: [
      part("web", { label: "Shop", spine: 0, from: ["web"] }),
      part("api", { label: "Order API", spine: 1, zone: "back", from: ["api", "ghost"] }),
      part("db", { label: "Orders", spine: 2, zone: "back", from: ["web"] }),
      part("mail", { label: "Mail", kind: "worker", anchor: "api", side: "below", zone: "back" }),
    ],
    edges: [
      { from: "web", to: "api", label: "", style: "call", step: 1 },
      { from: "api", to: "db", label: "", style: "call", step: 2 },
      { from: "api", to: "mail", label: "sends", style: "async", step: null },
    ],
  };

  it("writes the post into the channel: ids unique in it, facts checked, relations found, nothing else changed", () => {
    const d = load("tests/fixtures/shop.archdraw.json");
    const r = intentToChannel(d, intent, { portrait: true });
    expect(r.view).toBe("linkedin");
    expect(validateDocument3(r.doc).ok).toBe(true);
    const [v] = r.doc.channels.linkedin.views;
    expect(v).toMatchObject({ id: "linkedin", title: "LinkedIn", caption: { title: "How an order flows", lede: "" }, texts: [] });
    // The overview's ids are no obstacle: ids are unique within the channel.
    expect(v.nodes.map((p) => p.id)).toEqual(["zone-back", "web", "api", "db", "mail"]);
    const byId = new Map(v.nodes.map((p) => [p.id, p]));
    expect(byId.get("web")).toMatchObject({ facts: ["web"], label: "Shop" });
    expect(byId.get("api")!.facts).toEqual(["api"]);
    expect(byId.get("api")!.label).toBeUndefined(); // the fact's own label
    expect(byId.get("db")!.facts).toEqual([]); // an earlier part already shows "web"
    expect(byId.get("db")).toMatchObject({ label: "Orders", kind: "service" });
    expect(byId.get("zone-back")).toMatchObject({ facts: [], form: "group", label: "Back end", description: "A group of components." });
    expect(v.edges.map((c) => [c.id, c.relations])).toEqual([["web-api", ["r1"]], ["api-db", []], ["api-mail", []]]);
    expect(r.warnings).toEqual([
      'Dropped "ghost" from what "api" represents: no such component',
      'View "linkedin": "db" no longer shows "web", which an earlier part shows',
    ]);
    expect(r.doc.warnings).toEqual([...d.warnings, ...r.warnings]);
    expect(r.doc.facts).toEqual(d.facts);
    expect(r.doc.channels.overview).toEqual(d.channels.overview);
    expect(r.doc.channels.linkedin.outdated).toEqual([]);
  });

  it("warns when a part names an overview part that shows no fact", () => {
    const d = load("tests/fixtures/shop.archdraw.json");
    const ov = d.channels.overview.views[0];
    const hub = { id: "hub", facts: [], label: "Hub", kind: "service" as const, description: "A frame.", form: "card" as const, icon: null, parent: null, detail: null, place: null, x: 1200, y: 0 };
    const withHub: Document3 = { ...d, channels: { ...d.channels, overview: { ...d.channels.overview, views: [{ ...ov, nodes: [...ov.nodes, hub] }] } } };
    const r = intentToChannel(withHub, { ...intent, parts: [...intent.parts, part("hubpart", { label: "Hub", spine: 3, from: ["hub"] })] }, { portrait: true });
    expect(r.warnings).toContain('Dropped "hub" from what "hubpart" represents: no such component');
    expect(r.doc.channels.linkedin.views[0].nodes.find((p) => p.id === "hubpart")!.facts).toEqual([]);
  });

  it("keeps the channel's view id when it already has a view", () => {
    const d = prepared(load("tests/fixtures/shop.archdraw.json"));
    const moved: Document3 = { ...d, channels: { ...d.channels, linkedin: { ...d.channels.linkedin, views: [{ ...d.channels.linkedin.views[0], id: "post" }] } } };
    expect(intentToChannel(moved, intent, { portrait: false }).view).toBe("post");
  });
});
