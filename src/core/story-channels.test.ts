import { describe, expect, it } from "vitest";
import { applyChannel, joinChannel, normalizeFile3 } from "./channels";
import { validateDocument3, validateFile3, type Document3, type File3 } from "./file3";
import { intentToChannel, StoryError, storyRows, type StoryIntent, type StoryPart } from "./intent";
import { answerToDocument, documentToDraft } from "./repair";

// One story shape for every channel (diagram contract, Story answers; ADR 0007).

const NOW = "2026-10-21T00:00:00.000Z";
const part = (id: string, extra: object = {}) => ({ id, facts: [id], form: "card" as const, icon: null, parent: null, detail: null, place: null, ...extra });
function agent(): Document3 {
  const f: File3 = {
    schema: "archdraw/diagram@3", title: "Agent",
    facts: {
      components: [
        { id: "app", label: "App", kind: "service", sub: "", description: "Starts work.", files: ["src/app.ts"], items: [] },
        { id: "agent", label: "Agent", kind: "llm", sub: "", description: "Runs the loop.", files: ["src/agent.ts"], items: [] },
        { id: "propose", label: "Propose a tool", kind: "service", sub: "", description: "Picks a tool.", files: [], items: [], within: "agent" },
        { id: "check", label: "Check the call", kind: "gate", sub: "", description: "Checks it.", files: [], items: [], within: "agent" },
        { id: "store", label: "Store", kind: "data", sub: "", description: "Keeps state.", files: [], items: [] },
      ],
      relations: [{ id: "r1", from: "app", to: "agent", label: "asks", style: "call", both: false }],
      limits: [{ id: "turns", on: "agent", text: "Stops after 12 turns" }],
    },
    channels: { overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Agent", lede: "" }, nodes: [
      part("app"), part("agent", { form: "panel", held: ["propose", "check"], limits: ["turns"] }), part("store"),
    ], edges: [{ id: "e1", from: "app", to: "agent", relations: ["r1"], step: 1 }] }] } },
  };
  const r = validateFile3(f);
  expect(r.errors).toEqual([]);
  return normalizeFile3(r.file!, { id: "d_agentstory", now: NOW, source: null });
}
const sp = (id: string, extra: Partial<StoryPart> = {}): StoryPart =>
  ({ id, label: id, sub: "", kind: "service", chips: [], zone: null, inside: null, spine: null, anchor: null, side: null, from: [], held: [], limits: [], ...extra });
const intent = (extra: Partial<StoryIntent> = {}): StoryIntent => ({
  title: "How the agent works", lede: "", zones: [{ id: "run", label: "Runtime" }], steps: [],
  parts: [
    sp("app", { spine: 0, from: ["app"] }),
    sp("agent", { spine: 1, zone: "run", from: ["agent"] }),
    sp("loop", { spine: 0, inside: "agent", from: ["propose"] }),
    sp("gate", { spine: 1, inside: "agent", from: ["check"] }),
    sp("store", { anchor: "agent", side: "below", zone: "run", from: ["store"], held: ["propose"], limits: ["turns"] }),
  ],
  edges: [{ from: "app", to: "agent", label: "", style: "call", step: 1 }, { from: "loop", to: "gate", label: "", style: "call", step: null }],
  ...extra,
});

describe("a story as a channel's view (intentToChannel)", () => {
  it("draws the README: a holder becomes a group with its parts inside, rows only where the facts allow, one warning each", () => {
    const d = agent();
    const i = intent();
    i.parts[0] = sp("app", { spine: 0, from: ["app"] });
    i.parts.push(sp("brain", { anchor: "app", side: "above", from: [] , label: "Brain", held: [] }));
    const r = intentToChannel(d, i, { portrait: false, channel: "readme" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    const [v] = r.doc.channels.readme.views;
    expect(v).toMatchObject({ id: "readme", title: "README", caption: { title: "How the agent works" } });
    const byId = new Map(v.nodes.map((p) => [p.id, p]));
    expect(byId.get("agent")).toMatchObject({ form: "group", facts: ["agent"], parent: "zone-run" });
    expect(byId.get("loop")).toMatchObject({ parent: "agent", facts: ["propose"] });
    // The store shows "store": a mechanism of the agent and the agent's limit are not its to draw.
    expect(byId.get("store")!.held).toBeUndefined();
    expect(r.warnings).toEqual([
      'Dropped "propose" from what "store" holds: no mechanism within its facts',
      'Dropped "turns" from the limits of "store": not on what it shows',
    ]);
    expect(r.doc.facts).toEqual(d.facts);
    expect(r.doc.channels.overview).toEqual(d.channels.overview);
  });

  it("a redraw that echoes the view's group ids keeps them; a new zone id gets zone- once", () => {
    const zoned = (zone: string) => intent({ zones: [{ id: zone, label: "Runtime" }], parts: intent().parts.map((p) => (p.zone ? { ...p, zone } : p)) });
    const groupIds = (doc: Document3) => doc.channels.readme.views[0].nodes.filter((n) => n.form === "group" && !n.facts.length).map((n) => n.id);
    const first = intentToChannel(agent(), zoned("run"), { portrait: false, channel: "readme" });
    expect(groupIds(first.doc)).toEqual(["zone-run"]);
    const again = intentToChannel(first.doc, zoned("zone-run"), { portrait: false, channel: "readme" });
    expect(groupIds(again.doc)).toEqual(["zone-run"]);
    expect(again.warnings).toEqual(first.warnings);
    // A group the user named without the prefix keeps its id when the story names it.
    const renamed = structuredClone(first.doc);
    for (const n of renamed.channels.readme.views[0].nodes) {
      if (n.id === "zone-run") n.id = "runtime";
      if (n.parent === "zone-run") n.parent = "runtime";
    }
    expect(groupIds(intentToChannel(renamed, zoned("runtime"), { portrait: false, channel: "readme" }).doc)).toEqual(["runtime"]);
    expect(groupIds(intentToChannel(renamed, zoned("core"), { portrait: false, channel: "readme" }).doc)).toEqual(["zone-core"]);
  });

  it("drops a fact an earlier part shows before checking what a part holds: one warning each, never a failed run", () => {
    // `second` names the agent again: it no longer shows it, so it holds nothing within it and its limit goes.
    const i = intent({ zones: [], edges: [], parts: [
      sp("first", { spine: 0, from: ["agent"] }),
      sp("second", { spine: 1, from: ["agent", "store"], held: ["propose"], limits: ["turns"] }),
      sp("again", { spine: 2, from: ["app"], held: [] }),
    ] });
    const r = intentToChannel(agent(), i, { portrait: false, channel: "readme" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    const second = r.doc.channels.readme.views[0].nodes.find((p) => p.id === "second")!;
    expect([second.facts, second.form, second.held, second.limits]).toEqual([["store"], "card", undefined, undefined]);
    expect(r.warnings).toEqual([
      'View "readme": "second" no longer shows "agent", which an earlier part shows',
      'Dropped "propose" from what "second" holds: no mechanism within its facts',
      'Dropped "turns" from the limits of "second": not on what it shows',
    ]);
  });

  it("a part holding a mechanism an earlier part holds draws no row for it", () => {
    const i = intent({ zones: [], edges: [], parts: [
      sp("first", { spine: 0, from: ["agent"], held: ["propose"] }),
      sp("second", { spine: 1, from: ["app", "propose"] }),
    ] });
    const r = intentToChannel(agent(), i, { portrait: false, channel: "readme" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    expect(r.doc.channels.readme.views[0].nodes.find((p) => p.id === "second")!.facts).toEqual(["app"]);
    expect(r.warnings).toEqual(['View "readme": "second" no longer shows "propose", which an earlier part shows']);
  });

  it("a holder's chips are dropped with one warning, and its chip count does not fail the run", () => {
    const i = intent();
    i.parts[1] = sp("agent", { spine: 1, zone: "run", from: ["agent"], chips: Array.from({ length: 14 }, (_, k) => `Chip ${k}`) });
    i.parts[4] = sp("store", { anchor: "agent", side: "below", zone: "run", from: ["store"] });
    const r = intentToChannel(agent(), i, { portrait: false, channel: "readme" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    expect(r.doc.channels.readme.views[0].nodes.find((p) => p.id === "agent")!.form).toBe("group");
    expect(r.warnings).toEqual(['"agent" holds parts, so it draws no chips']);
  });

  it("draws held mechanisms and limits as rows where the part shows their component", () => {
    const i = intent({ zones: [], parts: [sp("app", { spine: 0, from: ["app"] }), sp("agent", { spine: 1, from: ["agent"], held: ["propose", "check"], limits: ["turns"], chips: ["Retries"] }), sp("store", { spine: 2, from: ["store"] })], edges: [] });
    const r = intentToChannel(agent(), i, { portrait: false, channel: "readme" });
    expect(r.warnings).toEqual([]);
    const a = joinChannel(r.doc, "readme").views[0].nodes.find((n) => n.id === "agent")!;
    expect(a).toMatchObject({ form: "panel", items: ["Propose a tool", "Check the call", "Retries", "Stops after 12 turns"], heldIds: ["propose", "check"], limitIds: ["turns"] });
  });

  it("drops LinkedIn's held rows, limits and steps, one warning each list", () => {
    const i = intent({ zones: [], parts: [sp("app", { spine: 0, from: ["app"] }), sp("agent", { spine: 1, from: ["agent"], held: ["propose"], limits: ["turns"] })], edges: [], steps: [{ parts: ["app"], text: "x", note: "" }] });
    const r = intentToChannel(agent(), i, { portrait: true, channel: "linkedin" });
    expect(r.warnings).toEqual([
      'The LinkedIn post holds no mechanisms; dropped those of "agent"',
      'The LinkedIn post shows no limits; dropped those of "agent"',
      "Ignored the steps: only a presentation has steps",
    ]);
    expect(r.doc.channels.linkedin.views[0].nodes.every((p) => !p.held && !p.limits)).toBe(true);
  });

  it("gives the presentation its steps: a wrong part is dropped with one warning; a step with no real part is dropped with one", () => {
    const i = intent({ zones: [], parts: [sp("app", { spine: 0, from: ["app"] }), sp("agent", { spine: 1, from: ["agent"] })], edges: [], steps: [
      { parts: ["app"], text: "It starts", note: "Say why." }, { parts: ["agent", "ghost-part"], text: "Then the agent", note: "" }, { parts: ["ghost-part"], text: "Nothing", note: "" },
    ] });
    const r = intentToChannel(agent(), i, { portrait: false, channel: "presentation" });
    expect(r.doc.channels.presentation.steps).toEqual([{ id: "s1", parts: ["app"], text: "It starts", note: "Say why." }, { id: "s2", parts: ["agent"], text: "Then the agent", note: "" }]);
    expect(r.warnings).toEqual(['Step 2: dropped "ghost-part", which is no part', "Step 3 names no part and was dropped"]);
    expect(r.doc.channels.presentation.views[0].title).toBe("Presentation");
  });

  it("drops a presentation step with no text, with one warning and none for its parts; elsewhere steps are only ignored", () => {
    const i = intent({ zones: [], parts: [sp("app", { spine: 0, from: ["app"] })], edges: [], steps: [{ parts: ["app", "ghost"], text: "  ", note: "" }, { parts: ["app"], text: "Two", note: "" }] });
    const r = intentToChannel(agent(), i, { portrait: false, channel: "presentation" });
    expect(r.warnings).toEqual(["Step 1 has no text and was dropped"]);
    expect(r.doc.channels.presentation.steps!.map((s) => s.text)).toEqual(["Two"]);
    expect(intentToChannel(agent(), i, { portrait: false, channel: "readme" }).warnings).toEqual(["Ignored the steps: only a presentation has steps"]);
  });

  it("fails a story whose parts loop inside each other, nest too deep or leave their holder's zone", () => {
    const bad = (parts: StoryPart[]) => () => intentToChannel(agent(), intent({ zones: [{ id: "run", label: "Runtime" }], parts, edges: [] }), { portrait: false, channel: "readme" });
    expect(bad([sp("a", { spine: 0, inside: "b" }), sp("b", { spine: 0, inside: "a" })])).toThrow(/inside itself/);
    expect(bad([sp("a", { spine: 0, zone: "run" }), sp("b", { spine: 0, inside: "a" }), sp("c", { spine: 0, inside: "b" }), sp("d", { spine: 0, inside: "c" })])).toThrow(/nests 4 groups deep/);
    expect(bad([sp("a", { spine: 0 }), sp("b", { spine: 0, inside: "a" }), sp("c", { spine: 0, inside: "b" }), sp("d", { spine: 0, inside: "c" }), sp("e", { spine: 0, inside: "d" })])).toThrow(/"e" nests 4 groups deep/);
    expect(bad([sp("a", { spine: 0 }), sp("b", { spine: 0, inside: "a", zone: "run" })])).toThrow(/names another zone/);
    expect(bad([sp("a", { spine: 0 }), sp("b", { spine: 0, inside: "a" }), sp("c", { anchor: "a", side: "below", inside: "a" })])).toThrow(/spine part of its own level/);
    expect(bad([sp("a", { spine: 0 }), sp("b", { spine: 0, inside: "ghost" })])).toThrow(StoryError);
  });
});

describe("a first overview drawn from a story (Every fact drawn)", () => {
  it("adds each fact the story left out beside the part it relates to most, and the relations between one-fact parts", () => {
    const d = agent();
    const first: Document3 = { ...d, channels: { ...d.channels, overview: { ...d.channels.overview, views: [] } } };
    // The story draws the app and the agent holding its loop, in a zone; it leaves out the store, and connects nothing.
    d.facts.relations.push({ id: "r2", from: "agent", to: "store", label: "keeps", style: "call", both: false });
    const i = intent({ edges: [], parts: [
      sp("app", { spine: 0, from: ["app"] }),
      sp("agent", { spine: 1, zone: "run", from: ["agent"], held: ["propose", "check"], limits: ["turns"] }),
    ] });
    const r = intentToChannel({ ...first, facts: d.facts }, i, { portrait: false, channel: "overview" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    const v = r.doc.channels.overview.views[0];
    expect(v.id).toBe("overview");
    expect(v.nodes.find((p) => p.id === "store")).toMatchObject({ facts: ["store"], form: "card", parent: "zone-run", lane: { anchor: "agent", side: "below" } });
    expect(v.edges.map((e) => e.relations)).toEqual([["r1"], ["r2"]]);
    expect(r.warnings).toEqual([
      'Added "store", which the overview left out',
      "Added the connection app → agent, which the overview left out",
      "Added the connection agent → store, which the overview left out",
    ]);
  });
});

describe("an overview over the part limit", () => {
  it("draws the facts it left out beyond 60 parts in one part, with one warning, and stays valid", () => {
    const d = agent();
    const extra = Array.from({ length: 70 }, (_, k) => ({ id: `svc-${k}`, label: `Service ${k}`, kind: "service" as const, sub: "", description: "A service.", files: [], items: [] }));
    const facts = { ...d.facts, components: [...d.facts.components, ...extra] };
    const first: Document3 = { ...d, facts, channels: { ...d.channels, overview: { ...d.channels.overview, views: [] } } };
    const r = intentToChannel(first, intent({ zones: [], edges: [], parts: [sp("app", { spine: 0, from: ["app"] }), sp("agent", { spine: 1, from: ["agent"], held: ["propose", "check"] }), sp("store", { spine: 2, from: ["store"] })] }), { portrait: false, channel: "overview" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    const v = r.doc.channels.overview.views[0];
    expect(v.nodes).toHaveLength(60);
    const more = v.nodes.find((p) => p.id === "more-components")!;
    expect(more.facts).toHaveLength(70 - 56);
    expect(r.warnings.filter((w) => w.startsWith("Drew the"))).toEqual(['Drew the 14 facts the overview left out beyond its 60 parts in one part "more-components"']);
  });

  it("puts what is left out into the last part when the story already drew 60 parts", () => {
    const d = agent();
    const extra = Array.from({ length: 58 }, (_, k) => ({ id: `svc-${k}`, label: `Service ${k}`, kind: "service" as const, sub: "", description: "A service.", files: [], items: [] }));
    const facts = { ...d.facts, components: [...d.facts.components, ...extra] };
    const first: Document3 = { ...d, facts, channels: { ...d.channels, overview: { ...d.channels.overview, views: [] } } };
    // 60 parts: app, agent, and 58 services; the store is left out.
    const parts = [sp("app", { spine: 0, from: ["app"] }), sp("agent", { spine: 1, from: ["agent"], held: ["propose", "check"] }), ...extra.map((c, k) => sp(c.id, { spine: k + 2, from: [c.id] }))];
    const r = intentToChannel(first, intent({ zones: [], edges: [], parts }), { portrait: false, channel: "overview" });
    expect(validateDocument3(r.doc).ok).toBe(true);
    const v = r.doc.channels.overview.views[0];
    expect(v.nodes).toHaveLength(60);
    expect(v.nodes.find((p) => p.id === "svc-57")!.facts).toEqual(["svc-57", "store"]);
    expect(r.warnings.filter((w) => w.startsWith("Drew the"))).toEqual(['Drew the 1 facts the overview left out beyond its 60 parts in one part "svc-57"']);
  });
});

describe("a refine keeps the rows a part may draw", () => {
  it("sends held and limit rows as ids and writes them back; one it may not draw is dropped with a warning", () => {
    const d = agent();
    const base = joinChannel(d, "overview");
    for (const n of base.views[0].nodes) n.from = [...(n.facts ?? [])];
    const draft = documentToDraft(base) as { views: { nodes: Record<string, unknown>[] }[] };
    const a = draft.views[0].nodes.find((n) => n.id === "agent")!;
    expect(a).toMatchObject({ items: [], held: ["propose", "check"], limits: ["turns"] });
    const kept = answerToDocument(draft, { base, now: NOW, engine: null, rows: storyRows(d) });
    expect(kept.warnings).toEqual([]);
    expect(kept.views[0].nodes.find((n) => n.id === "agent")).toMatchObject({ items: ["Propose a tool", "Check the call", "Stops after 12 turns"], heldIds: ["propose", "check"], limitIds: ["turns"] });
    draft.views[0].nodes.find((n) => n.id === "store")!.held = ["check"];
    expect(answerToDocument(draft, { base, now: NOW, engine: null, rows: storyRows(d) }).warnings).toEqual(['Component "store": dropped "check" from what it holds: no mechanism within its facts']);
  });

  it("an answer that echoes the agent untouched keeps every mechanism; one that stops holding one deletes it with a warning", () => {
    const d = agent();
    const base = joinChannel(d, "overview");
    for (const n of base.views[0].nodes) n.from = [...(n.facts ?? [])];
    const run = (change: (a: Record<string, unknown>) => void) => {
      const draft = documentToDraft(base) as { views: { nodes: Record<string, unknown>[] }[] };
      change(draft.views[0].nodes.find((n) => n.id === "agent")!);
      const answered = answerToDocument(draft, { base, now: NOW, engine: null, rows: storyRows(d), facts: d.facts.components.map((c) => c.id) });
      const r = applyChannel(d, "overview", { views: answered.views, warnings: answered.warnings }, { answer: true });
      if (!r.ok) throw new Error(r.error);
      expect(validateDocument3(r.doc).ok).toBe(true);
      return r.doc;
    };
    const same = run(() => {});
    expect([same.facts.components.map((c) => c.id), same.warnings]).toEqual([["app", "agent", "propose", "check", "store"], []]);
    const fewer = run((a) => { a.held = ["propose"]; });
    expect(fewer.facts.components.map((c) => c.id)).toEqual(["app", "agent", "propose", "store"]);
    expect(fewer.warnings).toEqual(['View "overview": "agent" no longer holds "check"; the mechanism and its limits were deleted']);
  });
});
