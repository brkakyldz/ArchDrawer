import { describe, expect, it } from "vitest";
import { joinChannel, normalizeFile3 } from "./channels";
import { validateFile3, type Document3, type File3 } from "./file3";
import type { DiagramDocument, DiagramView } from "./model";
import { CoverageError, keepUnrelatedViews, missingFacts } from "./simplify";

// Simplify coverage (diagram contract, Simplify coverage): the rules a simplify run checks after
// repair and before the save. The journey through a run is held-out H105 and H115.

const NOW = "2026-10-22T00:00:00.000Z";
type Part = { id: string; facts: string[]; detail?: string | null };
type View = { id: string; parts: Part[] };

/**
 * A @3 document with components a, b, c and d, and the given overview views (the first is the
 * overview). A simplify answer is checked before it is validated, so `checked: false` builds one
 * that leaves a fact undrawn.
 */
function doc(views: View[], checked = true): Document3 {
  const f: File3 = {
    schema: "archdraw/diagram@3", title: "Shop",
    facts: {
      components: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase(), kind: "service", sub: "", description: `${id} works.`, files: [], items: [] })),
      relations: [],
    },
    channels: {
      overview: {
        views: views.map((v) => ({
          id: v.id, title: v.id, caption: { title: "Shop", lede: "" },
          nodes: v.parts.map((p, i) => ({
            id: p.id, facts: p.facts, form: "card", icon: null, parent: null, detail: p.detail ?? null, place: { row: 0, col: i },
            // A merged part has a label, kind and description of its own.
            ...(p.facts.length === 1 ? {} : { label: p.id, kind: "service", description: `${p.id} works.` }),
          })),
          edges: [],
        })),
      },
    },
  };
  const r = validateFile3(f);
  if (checked) expect(r.errors).toEqual([]);
  return normalizeFile3(checked ? r.file! : f, { id: "d_simplify001", now: NOW, source: null });
}

const ALL: View[] = [
  { id: "overview", parts: [{ id: "a", facts: ["a"] }, { id: "b", facts: ["b"], detail: "inside-b" }] },
  { id: "inside-b", parts: [{ id: "c", facts: ["c"] }] },
  { id: "spare", parts: [{ id: "d", facts: ["d"] }] },
];

describe("missingFacts (Simplify coverage)", () => {
  it("counts a merged part and a part moved into a reached detail view as shown", () => {
    const before = doc(ALL);
    const after = doc([
      { id: "overview", parts: [{ id: "ab", facts: ["a", "b"], detail: "more" }] },
      { id: "more", parts: [{ id: "c", facts: ["c"] }] },
      ALL[2],
    ]);
    expect(missingFacts(before, after)).toEqual([]);
  });

  it("counts a view nothing reaches as shown only while it is left exactly as it was", () => {
    const before = doc(ALL);
    expect(missingFacts(before, doc(ALL))).toEqual([]);
    const changed = doc([ALL[0], ALL[1], { id: "spare", parts: [{ id: "d2", facts: ["d"] }] }], false);
    expect(missingFacts(before, changed)).toEqual(["d"]);
  });

  it("names every fact no part shows, in file order, and a fact only an unreached view shows", () => {
    const before = doc(ALL);
    const after = doc([
      { id: "overview", parts: [{ id: "c", facts: ["c"] }] },
      { id: "orphan", parts: [{ id: "a", facts: ["a"] }] },
    ], false);
    expect(missingFacts(before, after)).toEqual(["a", "b", "d"]);
  });

  it("follows detail links through a cycle without looping", () => {
    const views: View[] = [
      { id: "overview", parts: [{ id: "a", facts: ["a"], detail: "loop" }] },
      { id: "loop", parts: [{ id: "b", facts: ["b", "c", "d"], detail: "overview" }] },
    ];
    expect(missingFacts(doc(ALL), doc(views))).toEqual([]);
  });
});

describe("CoverageError", () => {
  it("says how many components the drawing loses, which, and that nothing was changed", () => {
    expect(new CoverageError(["db"]).message).toBe("The simplified drawing loses 1 component: db. Nothing was changed.");
    expect(new CoverageError(["db", "queue"]).message).toBe("The simplified drawing loses 2 components: db, queue. Nothing was changed.");
  });
});

describe("keepUnrelatedViews (Simplify coverage)", () => {
  const base = (): DiagramDocument => joinChannel(doc(ALL), "overview");
  const view = (d: DiagramDocument, id: string): DiagramView => d.views.find((v) => v.id === id)!;
  /** The engine's answer: the base with `change` applied to a copy of its views. */
  const answer = (change: (views: DiagramView[]) => DiagramView[]): DiagramDocument => {
    const b = base();
    return { ...b, views: change(structuredClone(b.views)), warnings: [] };
  };

  it("keeps the overview and what it reaches as answered, and a view it did not touch without a warning", () => {
    const after = answer((vs) => { vs[0].title = "Simpler"; vs[1].title = "Inside"; return vs; });
    const r = keepUnrelatedViews(base(), after);
    expect(r.warnings).toEqual([]);
    expect(r.doc.views.map((v) => v.title)).toEqual(["Simpler", "Inside", "spare"]);
  });

  it("restores a view nothing reaches that the answer changed, with one warning", () => {
    const after = answer((vs) => { vs[2].title = "Changed"; return vs; });
    const r = keepUnrelatedViews(base(), after);
    expect(r.warnings).toEqual(['Kept the view "spare" as it was: the simplification changes only the overview and its detail']);
    expect(view(r.doc, "spare")).toEqual(view(base(), "spare"));
  });

  it("restores a view the answer left out, in its old place, with one warning", () => {
    const r = keepUnrelatedViews(base(), answer((vs) => vs.filter((v) => v.id !== "spare")));
    expect(r.warnings).toEqual(['Kept the view "spare": the engine left it out']);
    expect(r.doc.views.map((v) => v.id)).toEqual(["overview", "inside-b", "spare"]);
  });

  it("leaves out a new view nothing links to, and keeps a new one the overview links to, after the old views", () => {
    const after = answer((vs) => {
      const extra = (id: string): DiagramView => ({ ...structuredClone(vs[2]), id, title: id, nodes: [] });
      vs[0].nodes[0].detail = "linked";
      return [vs[0], extra("stray"), vs[1], vs[2], extra("linked")];
    });
    const r = keepUnrelatedViews(base(), after);
    expect(r.warnings).toEqual(['Left out the new view "stray": no component of the overview links to it']);
    expect(r.doc.views.map((v) => v.id)).toEqual(["overview", "inside-b", "spare", "linked"]);
  });

  it("adds its warnings after the answer's own", () => {
    const after = { ...answer((vs) => { vs[2].title = "Changed"; return vs; }), warnings: ["From the repair"] };
    expect(keepUnrelatedViews(base(), after).doc.warnings).toEqual([
      "From the repair",
      'Kept the view "spare" as it was: the simplification changes only the overview and its detail',
    ]);
  });
});

const part = (id: string, extra: object = {}) => ({ id, facts: [id], form: "card" as const, icon: null, parent: null, detail: null, place: null, ...extra });

/** An overview whose agent holds the mechanism `loop` as a row, as every draw run writes it. */
function agent(): Document3 {
  const f: File3 = {
    schema: "archdraw/diagram@3", title: "Agent",
    facts: {
      components: [
        { id: "app", label: "App", kind: "service", sub: "", description: "Starts work.", files: [], items: [] },
        { id: "agent", label: "Agent", kind: "llm", sub: "", description: "Runs the loop.", files: [], items: [] },
        { id: "loop", label: "The loop", kind: "service", sub: "", description: "Turns.", files: [], items: [], within: "agent" },
      ],
      relations: [],
    },
    channels: { overview: { views: [{ id: "overview", title: "Overview", caption: { title: "Agent", lede: "" }, nodes: [
      part("app"), part("agent", { form: "panel", held: ["loop"] }),
    ], edges: [] }] } },
  };
  const r = validateFile3(f);
  expect(r.errors).toEqual([]);
  return normalizeFile3(r.file!, { id: "d_simplify01", now: NOW, source: null });
}

describe("missingFacts: a mechanism a part holds (Simplify coverage)", () => {
  it("counts a mechanism a part holds as covered", () => {
    const d = agent();
    expect(missingFacts(d, structuredClone(d))).toEqual([]);
  });

  it("names a mechanism no part shows or holds any more", () => {
    const d = agent();
    const after = structuredClone(d);
    delete after.channels.overview.views[0].nodes[1].held;
    expect(missingFacts(d, after)).toEqual(["loop"]);
  });
});
