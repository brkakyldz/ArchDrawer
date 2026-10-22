import { describe, expect, it } from "vitest";
import { normalizeFile3 } from "./channels";
import { validateFile3, type Document3, type File3 } from "./file3";
import { missingFacts } from "./simplify";

const NOW = "2026-10-21T00:00:00.000Z";
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

describe("missingFacts (simplify coverage)", () => {
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
