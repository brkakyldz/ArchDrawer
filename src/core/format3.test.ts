import { describe, expect, it } from "vitest";
import { applyChannel, joinChannel, markOutdated, normalizeFile3 } from "./channels";
import { checkEvidence } from "./evidence";
import { drawView } from "./export/svg";
import { fillDefaults3, validateDocument3, validateFile3, type Document3, type File3 } from "./file3";
import { LIMIT_ROW, measureNode } from "./geometry";
import type { DiagramDocument } from "./model";
import { PALETTES } from "./theme";

// ADR 0007's additions to `archdraw/diagram@3` (diagram contract): evidence, mechanisms, limit facts,
// held and limit rows, one README and one presentation view, presentation steps.

const NOW = "2026-10-21T00:00:00.000Z";
const part = (id: string, extra: object = {}) => ({ id, facts: [id], form: "card" as const, icon: null, parent: null, detail: null, place: null, ...extra });

/** An agent holding its loop (two mechanisms) and a turn limit, drawn in four channels. */
function agentFile(change: (f: File3) => void = () => {}): File3 {
  const f: File3 = {
    schema: "archdraw/diagram@3", title: "Agent",
    facts: {
      components: [
        { id: "app", label: "App", kind: "service", sub: "", description: "Starts work.", files: ["src/app.ts"], items: [], evidence: [{ file: "src/app.ts", lines: null }] },
        { id: "agent", label: "Agent", kind: "llm", sub: "", description: "Runs the loop.", files: ["src/agent.ts"], items: [], evidence: [{ file: "src/agent.ts", lines: [1, 9] }] },
        { id: "propose", label: "Propose a tool", kind: "service", sub: "", description: "Picks a tool.", files: [], items: [], within: "agent" },
        { id: "check", label: "Check the call", kind: "gate", sub: "", description: "Checks it.", files: [], items: [], within: "agent" },
      ],
      relations: [{ id: "r1", from: "app", to: "agent", label: "asks", style: "call", both: false, evidence: [{ file: "src/app.ts", lines: [2, 2] }] }],
      limits: [{ id: "turns", on: "agent", text: "Stops after 12 turns", evidence: [{ file: "src/agent.ts", lines: [4, 4] }] }],
    },
    channels: {
      overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Agent", lede: "" }, nodes: [
        part("app", { place: { row: 0, col: 0 } }),
        part("agent", { form: "panel", held: ["propose", "check"], limits: ["turns"], place: { row: 0, col: 1 } }),
      ], edges: [{ id: "e1", from: "app", to: "agent", relations: ["r1"], step: 1 }] }] },
      readme: { views: [{ id: "readme", title: "README", caption: { title: "Agent", lede: "" }, nodes: [
        part("app"), part("agent", { form: "panel", held: ["propose"] }), part("check", { place: { row: 1, col: 1 } }),
      ], edges: [] }] },
      presentation: {
        views: [{ id: "presentation", title: "Presentation", caption: { title: "Agent", lede: "" }, nodes: [part("app"), part("agent")], edges: [] }],
        steps: [{ id: "s1", parts: ["app"], text: "It starts here", note: "" }, { id: "s2", parts: ["app", "agent"], text: "Then the agent", note: "Say why." }],
      },
    },
  };
  change(f);
  return f;
}
const doc = (change?: (f: File3) => void): Document3 => {
  const r = validateFile3(agentFile(change));
  expect(r.errors).toEqual([]);
  return normalizeFile3(r.file!, { id: "d_agent00001", now: NOW, source: null });
};
const errorsOf = (change: (f: File3) => void) => validateFile3(agentFile(change)).errors;
const ov = (f: File3) => f.channels.overview.views[0];
const nodeOf = (d: DiagramDocument, id: string) => d.views[0].nodes.find((n) => n.id === id)!;
function edit(d: Document3, channel: "overview" | "readme" | "presentation", change: (j: DiagramDocument) => void): Document3 {
  const j = joinChannel(d, channel);
  change(j);
  const r = applyChannel(d, channel, j);
  if (!r.ok) throw new Error(r.error);
  const v = validateDocument3(r.doc);
  expect(v.ok ? [] : v.errors).toEqual([]);
  return r.doc;
}

describe("the format's ADR 0007 fields", () => {
  it("accepts mechanisms, limits, evidence, held and limit rows, a README view and a presentation view with steps", () => {
    const d = doc();
    expect(validateDocument3(d).ok).toBe(true);
    expect(d.channels.presentation.steps).toHaveLength(2);
    expect(d.channels.readme.views).toHaveLength(1);
  });

  it("draws a panel's rows held first, then items, then limits, and names their facts", () => {
    const agent = nodeOf(joinChannel(doc(), "overview"), "agent");
    expect(agent.items).toEqual(["Propose a tool", "Check the call", "Stops after 12 turns"]);
    expect(agent).toMatchObject({ heldIds: ["propose", "check"], limitIds: ["turns"] });
    // A held mechanism is drawn as a row of its holder, so the README can draw the other as a part.
    expect(nodeOf(joinChannel(doc(), "readme"), "agent").items).toEqual(["Propose a tool"]);
  });

  it("leaves a file without any of the new fields as it was", () => {
    const old = agentFile((f) => {
      delete f.facts.limits;
      for (const c of f.facts.components) { delete c.evidence; delete c.within; }
      f.facts.components = f.facts.components.filter((c) => c.id === "app" || c.id === "agent");
      delete f.facts.relations![0].evidence;
      ov(f).nodes[1] = part("agent", { place: { row: 0, col: 1 } });
      delete f.channels.readme; delete f.channels.presentation;
    });
    const d = fillDefaults3(old);
    expect("limits" in d.facts).toBe(false);
    expect("steps" in d.channels.presentation).toBe(false);
    expect(validateFile3(old).ok).toBe(true);
  });

  it("reports each broken rule of 20–24 with its path", () => {
    expect(errorsOf((f) => { f.facts.components[2].within = "propose"; })).toContain('facts.components[2].within: a component cannot be within itself');
    expect(errorsOf((f) => { f.facts.components[2].within = "ghost"; })).toContain('facts.components[2].within: "ghost" is not a component fact');
    expect(errorsOf((f) => { f.facts.components[3].within = "propose"; })).toContain('facts.components[3].within: "propose" is itself within "agent"; a mechanism is one level deep');
    expect(errorsOf((f) => { f.facts.limits![0].on = "ghost"; })).toContain('facts.limits[0].on: "ghost" is not a component fact');
    expect(errorsOf((f) => { f.facts.limits![0].text = "x".repeat(61); })).toContain("facts.limits[0].text: is 61 characters; at most 60");
    expect(errorsOf((f) => { f.facts.limits![0].id = "app"; })).toContain('facts.limits[0].id: "app" is used twice; fact ids are unique among facts');
    expect(errorsOf((f) => { ov(f).nodes[0] = part("app", { form: "panel", held: ["propose"] }); })).toContain('channels.overview.views[0].nodes[0].held[0]: "propose" is not a mechanism within a fact this part shows');
    expect(errorsOf((f) => { ov(f).nodes[0] = part("app", { form: "panel", limits: ["turns"], items: ["x"] }); })).toContain('channels.overview.views[0].nodes[0].limits[0]: "turns" is not on a fact this part shows or holds');
    expect(errorsOf((f) => { ov(f).nodes[1] = part("agent", { held: ["propose"] }); })).toContain('channels.overview.views[0].nodes[1].held: only a panel holds mechanisms; set it to [] or the form to "panel"');
    expect(errorsOf((f) => { ov(f).nodes[1] = part("agent", { form: "panel", held: ["propose", "check"], items: Array(11).fill("x") }); })).toContain("channels.overview.views[0].nodes[1]: shows 13 rows (held, items and limits); at most 12");
    expect(errorsOf((f) => { ov(f).nodes.push(part("propose")); })).toContain('channels.overview.views[0].nodes[2].facts[0]: "propose" is already shown or held by another part of this view');
    expect(errorsOf((f) => { f.facts.components[0].evidence = [{ file: "../x.ts", lines: null }]; })).toContain('facts.components[0].evidence[0].file: "../x.ts" must be a repository-relative path (no leading /, drive letter or ..)');
    expect(errorsOf((f) => { f.facts.components[0].evidence = [{ file: "src/app.ts", lines: [3, 2] }]; })).toContain("facts.components[0].evidence[0].lines: must be null or [from, to] with whole numbers 1 ≤ from ≤ to");
    expect(errorsOf((f) => { f.facts.components[0].evidence = Array(9).fill({ file: "a", lines: null }); })).toContain("facts.components[0].evidence: has 9 entries; at most 8");
    expect(errorsOf((f) => { f.channels.presentation!.steps![0].parts = ["ghost"]; })).toContain('channels.presentation.steps[0].parts[0]: "ghost" is not a part of the presentation view');
    expect(errorsOf((f) => { f.channels.presentation!.steps![1].id = "s1"; })).toContain('channels.presentation.steps[1].id: "s1" is used twice; step ids are unique within a channel');
    expect(errorsOf((f) => { f.channels.presentation!.steps![0].text = ""; })).toContain("channels.presentation.steps[0].text: must not be empty");
    expect(errorsOf((f) => { f.channels.presentation!.views = []; })).toContain("channels.presentation.steps: must be [] in a channel with no view");
    expect(errorsOf((f) => { (f.channels.readme as Record<string, unknown>).steps = []; })).toContain("channels.readme.steps: is not a property of this channel; use views, showSteps, outdated");
    // Rule 16: a mechanism neither shown nor held in the overview.
    expect(errorsOf((f) => { ov(f).nodes[1] = part("agent", { form: "panel", held: ["propose"], limits: ["turns"] }); })).toContain('facts.components[3]: "check" is shown or held by no part of the overview channel; draw it there or remove it');
  });

  it("checks evidence paths as it checks files: an error for validate, a warning when opening", () => {
    const f = agentFile();
    const missing = (p: string) => p !== "src/agent.ts";
    expect(validateFile3(f, { fileExists: (p) => !missing(p) }).errors).toContain('facts.components[0].evidence[0].file: "src/app.ts" does not exist in the repository');
    const r = validateFile3(f, { fileExists: (p) => !missing(p), missingFiles: "warn" });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('facts.relations[0].evidence[0].file: "src/app.ts" does not exist in the repository');
  });
});

describe("edits of rows, mechanisms, limits and steps", () => {
  it("renaming a held row renames the mechanism in every channel; editing a limit row edits the limit", () => {
    const d = edit(doc(), "readme", (j) => { nodeOf(j, "agent").items = ["Propose an action"]; });
    expect(d.facts.components.find((c) => c.id === "propose")!.label).toBe("Propose an action");
    expect(nodeOf(joinChannel(d, "overview"), "agent").items[0]).toBe("Propose an action");
    const l = edit(doc(), "overview", (j) => { nodeOf(j, "agent").items[2] = "Stops after 20 turns"; });
    expect(l.facts.limits![0].text).toBe("Stops after 20 turns");
  });

  it("removing a held row only stops the part holding it; the fact stays", () => {
    // The row is replaced by an item, which (outside the overview too) edits the fact's items.
    const d = edit(doc(), "readme", (j) => { const a = nodeOf(j, "agent"); a.items = ["Kept item"]; a.heldIds = []; });
    expect(d.facts.components.map((c) => c.id)).toContain("propose");
    expect(d.facts.components.find((c) => c.id === "agent")!.items).toEqual(["Kept item"]);
    expect(d.channels.readme.views[0].nodes.find((p) => p.id === "agent")!.held).toBeUndefined();
    expect(nodeOf(joinChannel(d, "overview"), "agent").heldIds).toEqual(["propose", "check"]);
  });

  it("in the overview, a mechanism no part holds any more is deleted with its limits", () => {
    const d = edit(doc(), "overview", (j) => { const a = nodeOf(j, "agent"); a.items = ["Propose a tool", "Stops after 12 turns"]; a.heldIds = ["propose"]; });
    expect(d.facts.components.map((c) => c.id)).toEqual(["app", "agent", "propose"]);
    expect(d.channels.readme.views[0].nodes.map((p) => p.id)).toEqual(["app", "agent"]);
    // Turning the panel into a card stops holding both: both go, the limit on the agent stays.
    const card = edit(doc(), "overview", (j) => { const a = nodeOf(j, "agent"); a.form = "card"; a.items = []; delete a.heldIds; delete a.limitIds; });
    expect(card.facts.components.map((c) => c.id)).toEqual(["app", "agent"]);
    expect(card.facts.limits!.map((l) => l.id)).toEqual(["turns"]);
  });

  it("an engine's answer never deletes a mechanism silently: a reworded row is a rename, a dropped one is warned", () => {
    const answer = (change: (j: DiagramDocument) => void) => {
      const j = joinChannel(doc(), "overview");
      change(j);
      const r = applyChannel(doc(), "overview", j, { answer: true });
      if (!r.ok) throw new Error(r.error);
      expect(validateDocument3(r.doc).ok).toBe(true);
      return r.doc;
    };
    // No row ids, as many rows as drawn: the reworded mechanism and limit are edits of those facts.
    const reworded = answer((j) => { const a = nodeOf(j, "agent"); delete a.heldIds; delete a.limitIds; a.items = ["Proposes a tool", "Check the call", "Stops after 20 turns"]; });
    expect(reworded.facts.components.map((c) => [c.id, c.label])).toEqual([["app", "App"], ["agent", "Agent"], ["propose", "Proposes a tool"], ["check", "Check the call"]]);
    expect([reworded.facts.limits![0].text, reworded.facts.components.find((c) => c.id === "agent")!.items, reworded.warnings]).toEqual(["Stops after 20 turns", [], []]);
    // The answer holds one mechanism less: it is deleted, with one warning.
    const dropped = answer((j) => { const a = nodeOf(j, "agent"); a.heldIds = ["propose"]; a.items = ["Propose a tool", "Stops after 12 turns"]; });
    expect(dropped.facts.components.map((c) => c.id)).toEqual(["app", "agent", "propose"]);
    expect(dropped.warnings).toEqual(['View "overview": "agent" no longer holds "check"; the mechanism and its limits were deleted']);
  });

  it("a node that names no row ids keeps the held and limit rows it still draws", () => {
    // An engine's answer may echo the rows as items: they stay mechanisms and limits, not items.
    const d = edit(doc(), "overview", (j) => { const a = nodeOf(j, "agent"); delete a.heldIds; delete a.limitIds; a.sub = "Runs"; });
    const agent = d.channels.overview.views[0].nodes.find((p) => p.id === "agent")!;
    expect([agent.held, agent.limits, agent.items]).toEqual([["propose", "check"], ["turns"], undefined]);
    expect(d.facts.components.find((c) => c.id === "agent")!.items).toEqual([]);
  });

  it("a kept panel whose facts change keeps its own items, not its held rows", () => {
    const d = edit(doc(), "readme", (j) => {
      j.views[0].nodes = j.views[0].nodes.filter((n) => n.id !== "check");
      nodeOf(j, "agent").facts = ["agent", "check"];
    });
    const agent = d.channels.readme.views[0].nodes.find((p) => p.id === "agent")!;
    expect([agent.held, agent.items]).toEqual([["propose"], []]);
    expect(nodeOf(joinChannel(d, "readme"), "agent").items).toEqual(["Propose a tool"]);
  });

  it("a part that loses a fact an earlier part shows stops holding what is within it, one warning each", () => {
    const d = edit(doc(), "readme", (j) => { nodeOf(j, "app").facts = ["app", "agent"]; });
    const agent = d.channels.readme.views[0].nodes.find((p) => p.id === "agent")!;
    expect([agent.facts, agent.held]).toEqual([[], undefined]);
    expect(d.warnings).toEqual([
      'View "readme": "agent" no longer shows "agent", which an earlier part shows',
      'View "readme": "agent" no longer holds "propose", which is within a fact it no longer shows',
      'View "readme": "agent" has no rows left and is drawn as a card',
    ]);
  });

  it("a panel left with no rows by holding what an earlier part shows is drawn as a card", () => {
    const d = edit(doc(), "readme", (j) => {
      const [app, agent, check] = j.views[0].nodes;
      j.views[0].nodes = [app, check, agent];
      Object.assign(agent, { items: ["Check the call"], heldIds: ["check"] });
    });
    expect(d.channels.readme.views[0].nodes.find((p) => p.id === "agent")!.form).toBe("card");
    expect(d.warnings).toEqual([
      'View "readme": "agent" no longer holds "check", which an earlier part shows or holds',
      'View "readme": "agent" has no rows left and is drawn as a card',
    ]);
  });

  it("deleting a component in the overview takes its mechanisms and limits, and every part stops drawing them", () => {
    const d = edit(doc(), "overview", (j) => { j.views[0].nodes = j.views[0].nodes.filter((n) => n.id !== "agent"); j.views[0].edges = []; });
    expect(d.facts.components.map((c) => c.id)).toEqual(["app"]);
    expect(d.facts.limits).toEqual([]);
    expect(d.channels.readme.views[0].nodes.map((p) => p.id)).toEqual(["app"]);
  });

  it("a part that leaves the presentation leaves its steps; a step left with no part goes, with a warning", () => {
    const d = edit(doc(), "presentation", (j) => { j.views[0].nodes = j.views[0].nodes.filter((n) => n.id !== "app"); });
    expect(d.channels.presentation.steps).toEqual([{ id: "s2", parts: ["agent"], text: "Then the agent", note: "Say why." }]);
    expect(d.warnings).toEqual(['Step "s1" had no part left and was removed']);
  });

  it("steps are appearance: editing them changes only the presentation channel", () => {
    const before = doc();
    const d = edit(before, "presentation", (j) => { j.steps = [...j.steps!].reverse().map((s, i) => (i === 0 ? { ...s, text: "First the agent" } : s)); });
    expect(d.channels.presentation.steps!.map((s) => [s.id, s.text])).toEqual([["s2", "First the agent"], ["s1", "It starts here"]]);
    expect(d.facts).toEqual(before.facts);
    for (const c of ["overview", "readme"] as const) expect(d.channels[c].outdated).toEqual([]);
  });

  it("marks a new limit where its fact is drawn, and a changed limit where it is not shown", () => {
    const before = doc();
    const added = structuredClone(before);
    added.facts.limits!.push({ id: "budget", on: "agent", text: "Spends at most 1 MB", evidence: [] });
    const m = markOutdated(before, added, ["overview"]);
    expect(m.channels.readme.outdated).toEqual(["budget"]);
    expect(m.channels.presentation.outdated).toEqual(["budget"]);
    const changed = structuredClone(before);
    changed.facts.limits![0].text = "Stops after 20 turns";
    const c = markOutdated(before, changed, ["presentation"]);
    expect(c.channels.overview.outdated).toEqual([]); // it shows the limit's row
    expect(c.channels.readme.outdated).toEqual(["turns"]); // it draws the agent, not the limit
  });
});

describe("the evidence check (Read answers)", () => {
  const repo = { exists: (p: string) => ["src/a.ts", "src/b.ts"].includes(p), lineCount: (p: string) => (p === "src/a.ts" ? 10 : 3) };
  const c = (id: string, evidence: { file: string; lines: [number, number] | null }[], within: string | null = null) =>
    ({ id, label: id, kind: "service" as const, sub: "", description: "x", files: [], items: [], within, evidence });

  it("drops unsupported evidence, then facts left with none, then what depended on them, one warning each", () => {
    const r = checkEvidence({
      components: [c("app", [{ file: "src/a.ts", lines: null }, { file: "./src/a.ts", lines: null }]), c("agent", [{ file: "src/b.ts", lines: [1, 1] }]), c("loop", [{ file: "src/b.ts", lines: [2, 3] }], "agent"), c("ghost", [{ file: "fixture/ghost.ts", lines: null }])],
      relations: [{ id: "r1", from: "app", to: "agent", label: "", style: "call", both: false, evidence: [{ file: "src/a.ts", lines: [4, 12] }, { file: "src/a.ts", lines: [4, 5] }] }, { id: "r2", from: "app", to: "ghost", label: "", style: "call", both: false, evidence: [{ file: "src/a.ts", lines: null }] }],
      limits: [{ id: "lim", on: "ghost", text: "x", evidence: [{ file: "src/b.ts", lines: null }] }],
    }, repo);
    expect(r.warnings).toEqual([
      "ghost: dropped the evidence fixture/ghost.ts: not found",
      "r1: dropped the evidence src/a.ts:4-12: the file has 10 lines",
      'Dropped "ghost": no evidence left',
      'Dropped "r2": its component "ghost" was dropped',
      'Dropped "lim": its component "ghost" was dropped',
    ]);
    expect(r.facts.components.map((x) => [x.id, x.files])).toEqual([["app", ["src/a.ts"]], ["agent", ["src/b.ts"]], ["loop", ["src/b.ts"]]]);
    expect(r.facts.relations.map((x) => x.id)).toEqual(["r1"]);
    // A path listed twice is kept once, silently: its first supported entry.
    expect(r.facts.components[0].evidence).toEqual([{ file: "src/a.ts", lines: null }]);
    expect(r.facts.relations[0].evidence).toEqual([{ file: "src/a.ts", lines: [4, 5] }]);
  });

  it("warns once for a missing path listed twice, and keeps one entry of a path listed with other lines", () => {
    const r = checkEvidence({ components: [c("app", [{ file: "src/gone.ts", lines: [1, 2] }, { file: "src/gone.ts", lines: null }, { file: "src/a.ts", lines: [1, 2] }, { file: "src/a.ts", lines: [3, 4] }])], relations: [], limits: [] }, repo);
    expect(r.warnings).toEqual(["app: dropped the evidence src/gone.ts:1-2: not found"]);
    expect(r.facts.components[0].evidence).toEqual([{ file: "src/a.ts", lines: [1, 2] }]);
  });

  it("drops a mechanism within a dropped component, and a path outside the repository", () => {
    const r = checkEvidence({ components: [c("agent", [{ file: "../x.ts", lines: null }]), c("loop", [{ file: "src/b.ts", lines: null }], "agent")], relations: [], limits: [] }, repo);
    expect(r.warnings).toEqual(["agent: dropped the evidence ../x.ts: outside the repository", 'Dropped "agent": no evidence left', 'Dropped "loop": its component "agent" was dropped']);
    expect(r.facts.components).toEqual([]);
  });
});

describe("limit rows in geometry and the image", () => {
  it("a limit row keeps room for its timer icon, and the image draws it as a limit", () => {
    const base = { label: "Agent", form: "panel" as const, sub: "", detail: null };
    const text = "Stops after twelve turns, always";
    const plain = measureNode({ ...base, items: [text] }), limited = measureNode({ ...base, items: [text], limitIds: ["turns"] });
    expect(limited.w).toBeGreaterThanOrEqual(Math.min(plain.w + LIMIT_ROW.icon + LIMIT_ROW.gap, 320));
    expect(limited.h).toBe(plain.h);
    expect(limited.limits).toBe(1);
    const svg = drawView(joinChannel(doc(), "overview").views[0], PALETTES.light).body;
    expect(svg).toContain('class="limit"');
    expect(svg.match(/class="item"/g)).toHaveLength(2);
  });
});
