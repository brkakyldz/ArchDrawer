import { describe, expect, it } from "vitest";
import { validateFile, type DiagramDocument } from "./model";
import { normalizeFile } from "./normalize";
import { answerToDocument, documentToDraft } from "./repair";
import { edge, file, node } from "./testkit";

const doc = (f = file([node("a"), node("b")], [edge("a", "b")])): DiagramDocument =>
  normalizeFile(validateFile(f).file!, { id: "d_simp000001", now: "2026-10-14T00:00:00.000Z", source: { kind: "local", path: "C:/x" } });
const ctx = (b: DiagramDocument) => ({ base: b, now: "2026-10-14T01:00:00.000Z", engine: { id: "fixture", model: null } });

describe("lane and facts in an engine's answer (the stored from of the view shape)", () => {
  it("sends both in the draft and reads them back", () => {
    const b = doc(file([node("a", { lane: { spine: 0 } }), node("b", { lane: { anchor: "a", side: "below" }, from: ["a"] })], [edge("a", "b")]));
    const draft = documentToDraft(b) as { views: { nodes: { lane: unknown; facts: string[] }[] }[] };
    expect(draft.views[0].nodes.map((n) => [n.lane, n.facts])).toEqual([[{ spine: 0 }, []], [{ anchor: "a", side: "below" }, ["a"]]]);
    const out = answerToDocument(draft, ctx(b));
    expect(out.views[0].nodes.map((n) => [n.lane, n.from])).toEqual([[{ spine: 0 }, []], [{ anchor: "a", side: "below" }, ["a"]]]);
    expect(out.warnings).toEqual(b.warnings);
  });

  it("repairs a bad lane or an invented facts entry, one warning each, and carries provenance forward", () => {
    const b = doc(file([node("a"), node("b"), node("m", { from: ["old"] })], [edge("a", "b")]));
    const draft = documentToDraft(b) as { views: { nodes: Record<string, unknown>[] }[] };
    const [a, bb, m] = draft.views[0].nodes;
    a.lane = { spine: 0 };
    bb.lane = { spine: 0 }; // taken among its siblings
    m.lane = { anchor: "nowhere", side: "above" };
    draft.views[0].nodes.push({ ...structuredClone(m), id: "n", lane: { spine: -1 }, facts: ["m", "made-up"] });
    const out = answerToDocument(draft, ctx(b));
    const byId = new Map(out.views[0].nodes.map((n) => [n.id, n]));
    expect(byId.get("a")!.lane).toEqual({ spine: 0 });
    expect(byId.get("b")!.lane).toBeNull();
    expect(byId.get("m")!.lane).toBeNull();
    expect(byId.get("n")!.lane).toBeNull();
    expect(byId.get("m")!.from).toEqual(["old"]);
    expect(byId.get("n")!.from).toEqual(["m", "old"]);
    const added = out.warnings.slice(b.warnings.length);
    expect(added.filter((w) => /lane/.test(w))).toHaveLength(3);
    expect(added.filter((w) => /made-up/.test(w))).toHaveLength(1);
  });
});
