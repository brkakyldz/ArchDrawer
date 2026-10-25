import { describe, expect, it } from "vitest";
import { fillDefaults3, validateDocument3, type Document3, type File3 } from "./file3";
import { mapAsOneView, panelOrder, splitMap, storyDraft } from "./map";
import { prepareChannel } from "./simple";
import { prepareLinkedIn } from "./export/feed";
import { isMapView, layoutReport } from "./report";
import { joinChannel } from "./channels";

// The map (diagram contract, The map; ADR 0015): the overview of a `system` choice split into the map and its detail views.

const part = (id: string, extra: object = {}) => ({ id, facts: [id], form: "card" as const, icon: null, parent: null, detail: null, place: null, ...extra });
const comp = (id: string, extra: object = {}) => ({ id, label: id.toUpperCase(), kind: "service" as const, sub: "", description: `${id}.`, files: [], items: [], ...extra });
const rel = (id: string, from: string, to: string, extra: object = {}) => ({ id, from, to, label: `${from} to ${to}`, style: "call" as const, both: false, ...extra });

/** A web front, a zone "Core" (api, worker with its retry), a holder `db` holding `cache`, and a log beside the api. */
function system(): Document3 {
  const f: File3 = {
    schema: "archdraw/diagram@3", title: "Shop",
    facts: {
      components: [comp("web"), comp("api"), comp("worker"), comp("retry", { within: "worker" }), comp("db"), comp("cache"), comp("log")],
      relations: [rel("r1", "web", "api"), rel("r2", "api", "worker", { style: "async" }), rel("r3", "worker", "db"), rel("r4", "api", "db"), rel("r5", "cache", "web"), rel("r6", "db", "web", { style: "dep" })],
    },
    channels: {
      overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Shop", lede: "What it does." }, nodes: [
        part("web", { lane: { spine: 0 } }),
        part("zone-core", { facts: [], form: "group", label: "Core" }),
        part("api", { parent: "zone-core", lane: { spine: 1 } }),
        part("worker", { parent: "zone-core", form: "panel", held: ["retry"], lane: { spine: 2 } }),
        part("db", { form: "group" }),
        part("cache", { parent: "db", lane: { spine: 3 } }),
        part("log", { lane: { anchor: "api", side: "below" } }),
      ], edges: [
        { id: "e1", from: "web", to: "api", relations: ["r1"], step: 1 },
        { id: "e2", from: "api", to: "worker", relations: ["r2"], step: 2 },
        { id: "e3", from: "worker", to: "db", relations: ["r3"], step: 3 },
        { id: "e4", from: "api", to: "db", relations: ["r4"], step: null },
        { id: "e5", from: "cache", to: "web", relations: ["r5"], step: null },
        { id: "e6", from: "db", to: "web", relations: ["r6"], step: null },
      ] }] },
    },
  } as unknown as File3;
  return fillDefaults3(f);
}

describe("splitting the whole system's overview into the map (#183)", () => {
  it("makes each top-level group holding parts a map part with its inside in a detail view, and lifts the connections", () => {
    const before = system();
    const doc = splitMap(before, ["db-inside"]);
    const [map, core, db, ...more] = doc.channels.overview.views;
    expect([map.id, core.id, db.id, more.length]).toEqual(["overview", "zone-core-inside", "db-inside-2", 0]);
    expect([map.title, map.caption]).toEqual(["Overview", { title: "Shop", lede: "What it does." }]);
    // A zone's part keeps no fact and becomes a card; a holder keeps its facts; the plain parts stay, a lost anchor's lane goes.
    const at = (id: string) => map.nodes.find((n) => n.id === id)!;
    expect(map.nodes.map((n) => n.id)).toEqual(["web", "zone-core", "db", "log"]);
    expect(at("zone-core")).toMatchObject({ facts: [], form: "card", label: "Core", kind: "service", description: "A group of components.", parent: null, detail: "zone-core-inside", lane: { spine: 1 } });
    expect(at("db")).toMatchObject({ facts: ["db"], form: "card", parent: null, detail: "db-inside-2", lane: { spine: 3 } });
    expect(at("db").label).toBeUndefined();
    expect(at("web").lane).toEqual({ spine: 0 });
    expect(at("log").lane).toBeNull();
    // Detail views: the group's label as title, its parts at top level with their lanes.
    expect(core).toMatchObject({ title: "Core", caption: { title: "Core", lede: "" }, texts: [] });
    expect(core.nodes.map((n) => [n.id, n.parent, n.lane])).toEqual([["api", null, { spine: 1 }], ["worker", null, { spine: 2 }]]);
    expect(core.nodes[1]).toMatchObject({ form: "panel", held: ["retry"] });
    expect(db.nodes.map((n) => [n.id, n.parent])).toEqual([["cache", null]]);
    // A connection inside one view stays there, its step numbered again.
    expect(core.edges.map((e) => [e.id, e.step])).toEqual([["e2", 1]]);
    // Lifted: one onto a pair keeps its label and step; several have no label, their shared style, the lowest step;
    // only relations joining a fact of each end stay (the zone shows none), and a map connection on the pair joins them.
    expect(map.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, relations: e.relations, step: e.step, label: e.label, style: e.style }))).toEqual([
      { id: "web-zone-core", from: "web", to: "zone-core", relations: [], step: 1, label: "web to api", style: "call" },
      { id: "zone-core-db", from: "zone-core", to: "db", relations: [], step: 2, label: "", style: "call" },
      { id: "db-web", from: "db", to: "web", relations: ["r6"], step: null, label: "", style: "call" },
    ]);
    // Every view is laid out, and the whole passes validation: the map and its detail views show or hold every fact.
    for (const v of doc.channels.overview.views) expect(v.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), v.id).toBe(true);
    const valid = validateDocument3(doc);
    expect(valid.ok, valid.ok ? "" : valid.error).toBe(true);
    // The split adds no warning, and the drawing it came from is untouched.
    expect(doc.warnings).toEqual(before.warnings);
    expect(before.channels.overview.views).toHaveLength(1);
  });

  it("two-way when lifted connections run both ways; a connection whose ends lift to one map part is left out", () => {
    const d = system();
    const v = d.channels.overview.views[0];
    v.edges = [{ id: "a", from: "web", to: "api", relations: ["r1"], step: null }, { id: "b", from: "worker", to: "web", relations: [], step: null, label: "tells", style: "async" }, { id: "c", from: "api", to: "cache", relations: [], step: null, label: "x" }];
    v.edges.push({ id: "d", from: "worker", to: "api", relations: [], step: null, label: "inside" });
    const map = splitMap(d).channels.overview.views[0];
    const both = map.edges.find((e) => e.id === "web-zone-core")!;
    expect([both.both, both.label, both.style]).toEqual([true, "", "call"]);
    expect(map.edges.map((e) => e.id)).toEqual(["web-zone-core", "zone-core-db"]);
  });

  it("a component in neither the map nor a detail view fails the completeness check as before", () => {
    const doc = splitMap(system());
    doc.channels.overview.views[2].nodes = [];
    const valid = validateDocument3(doc);
    expect(valid.ok).toBe(false);
    expect(valid.ok ? "" : valid.error).toContain('"cache" is shown or held by no part of the overview channel');
  });

  it("an overview with no group holding parts is left as it is", () => {
    const d = system();
    d.channels.overview.views[0].nodes = d.channels.overview.views[0].nodes.map((n) => ({ ...n, parent: null, form: n.form === "group" ? "card" as const : n.form }));
    expect(splitMap(d)).toBe(d);
  });

  it("groups past the 29th stay groups on the map, with one warning", () => {
    const d = system();
    const v = d.channels.overview.views[0];
    v.nodes = [];
    for (let i = 0; i < 31; i++) v.nodes.push(part(`g${i}`, { facts: [], form: "group", label: `G${i}`, x: 0, y: 0 }) as never, part(`p${i}`, { facts: [], parent: `g${i}`, x: 0, y: 0 }) as never);
    v.edges = [];
    const doc = splitMap(d);
    expect(doc.channels.overview.views).toHaveLength(30);
    expect(doc.warnings.slice(d.warnings.length)).toEqual(["Kept 2 groups on the map: an overview holds at most 30 views"]);
    const map = doc.channels.overview.views[0];
    expect(map.nodes.filter((n) => n.form === "group").map((n) => n.id)).toEqual(["g29", "g30"]);
    expect(map.nodes.find((n) => n.id === "p30")?.parent).toBe("g30");
  });

  it("the map and its detail views are told as one view: every part but those with an inside", () => {
    const one = mapAsOneView(joinChannel(splitMap(system()), "overview").views);
    expect(one.id).toBe("overview");
    expect(one.nodes.map((n) => n.id).sort()).toEqual(["api", "cache", "log", "web", "worker"]);
    expect(one.edges.map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("what a system choice's channels are told from (ui contract, Simple versions)", () => {
  const sys = () => ({ ...splitMap(system()), ids: { prefix: null, taken: [], system: true } });
  it("lists the views in panel order: links depth first in the order of the linking parts, then the views no link reaches", () => {
    const v = (id: string, ...links: string[]) => ({ id, nodes: links.map((l) => ({ detail: l })) });
    expect(panelOrder([v("m", "b", "a"), v("a", "a2"), v("b"), v("stray"), v("a2")]).map((x) => x.id)).toEqual(["m", "b", "a", "a2", "stray"]);
  });
  it("the simple README, presentation and LinkedIn post of the system choice draw the map's and detail views' parts, skipping those with an inside", () => {
    const want = ["api", "cache", "log", "web", "worker"];
    for (const [name, r] of [["readme", prepareChannel(sys(), "readme")], ["presentation", prepareChannel(sys(), "presentation")], ["linkedin", prepareLinkedIn(sys())]] as const) {
      expect(r.ok, name).toBe(true);
      const ch = r.ok ? r.doc.channels[name as "readme"].views[0] : null;
      expect(ch!.nodes.map((n) => n.id).sort(), name).toEqual(want);
    }
    // Another choice is told from its first view alone.
    const other = prepareChannel({ ...sys(), ids: { prefix: null, taken: [], system: false } }, "readme");
    expect(other.ok && other.doc.channels.readme.views[0].nodes.map((n) => n.id).sort()).toEqual(["db", "log", "web", "zone-core"]);
  });
  it("a story's draft is the map and its detail views as one view under the map's id", () => {
    const d = storyDraft(sys());
    expect(d.views.map((v) => v.id)).toEqual(["overview"]);
    expect(d.views[0].nodes.map((n) => n.id).sort()).toEqual(["api", "cache", "log", "web", "worker"]);
    expect(storyDraft({ ...sys(), ids: undefined }).views.map((v) => v.id)).toEqual(["overview", "zone-core-inside", "db-inside"]);
  });
});

describe("the map's layout report target (api contract, Layout report)", () => {
  it("is nine parts on the first overview view of the system choice, and nothing elsewhere", () => {
    const doc = { ...splitMap(system()), ids: { prefix: null, taken: [], system: true } };
    expect(isMapView(doc, "overview")).toBe(true);
    expect(isMapView(doc, "zone-core-inside")).toBe(false);
    expect(isMapView({ ...doc, ids: { prefix: null, taken: [] } as { system?: boolean } }, "overview")).toBe(false);
    const joined = joinChannel(doc, "overview");
    const o = { format: "readme" as const, theme: "light" as const, title: true, lede: true, labels: true, legend: false, steps: false, subLines: true };
    expect(layoutReport(joined, "overview", o as never, { map: true }).targets).toEqual({ parts: 9, zones: null, connections: null });
    expect(layoutReport(joined, "zone-core-inside", o as never).targets).toEqual({ parts: null, zones: null, connections: null });
  });
});
