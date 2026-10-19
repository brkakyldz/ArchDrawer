import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDocument, validateFile, type DiagramDocument } from "./model";
import { normalizeFile } from "./normalize";
import { answerToDocument, documentToDraft, DRAFT_JSON_SCHEMA, EmptyDiagramError } from "./repair";

const base = (): DiagramDocument => {
  const f = JSON.parse(readFileSync("examples/shop.archdraw.json", "utf8"));
  const doc = normalizeFile(validateFile(f).file!, { id: "d_shop000001", now: "2026-10-13T00:00:00.000Z", source: { kind: "local", path: "C:/shop" } });
  doc.views[0].texts.push({ id: "t1", text: "The order path", x: 900, y: 40, size: 28 });
  return doc;
};
const ctx = (b = base()) => ({ base: b, now: "2026-10-13T01:00:00.000Z", engine: { id: "fixture", model: null } });

describe("engine answer repair", () => {
  it("round-trips the draft projection unchanged, keeping positions and texts", () => {
    const b = base();
    const doc = answerToDocument(documentToDraft(b), ctx(b));
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.warnings).toEqual([]);
    expect(doc.views[0].nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.views[0].nodes.map((n) => [n.id, n.x, n.y]));
    expect(doc.views[0].texts).toEqual(b.views[0].texts);
    expect(doc.engine).toEqual({ id: "fixture", model: null });
  });

  it("adds exactly one warning per repair", () => {
    const b = base();
    const draft = documentToDraft(b) as { views: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] };
    const v = draft.views[0];
    v.nodes.push({ ...v.nodes[0], id: "web", label: "Duplicate" });
    v.nodes.push({ id: "cache", label: "Cache", kind: "redis", form: "panel", icon: "rocket", sub: "", items: [], description: "", files: ["../x", "nope.ts"], parent: "db", detail: "nowhere", place: null });
    v.edges.push({ from: "api", to: "ghost", label: "", style: "call", both: false, step: null });
    v.edges.push({ from: "db", to: "api", label: "", style: "wave", both: false, step: null });
    const doc = answerToDocument(draft, { ...ctx(b), fileExists: () => false });
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.warnings).toEqual([
      'Renamed the duplicate id "web" to "web-2"',
      'Component "cache": unknown kind "redis", drawn as service',
      'Component "cache": a panel without items, drawn as a card',
      'Component "cache": unknown icon "rocket", using the kind\'s',
      'Removed the file "../x" from "cache": outside the repository',
      'Removed the file "nope.ts" from "cache": not found in the repository',
      'Component "cache": parent "db" is not a group here, moved to top level',
      'Component "cache": inside view "nowhere" does not exist, link removed',
      "Dropped the connection api → ghost: \"ghost\" does not exist",
      "Merged the connection db → api into api → db as two-way",
    ]);
    const api = doc.views[0].edges.find((e) => e.from === "api" && e.to === "db")!;
    expect(api.both).toBe(true);
    // New components are placed without overlapping kept ones.
    const kept = b.views[0].nodes.find((n) => n.id === "web")!;
    expect(doc.views[0].nodes.find((n) => n.id === "web")).toMatchObject({ x: kept.x, y: kept.y });
  });

  it("keeps the user's texts when a component goes, and fails on an empty view", () => {
    const b = base();
    const draft = documentToDraft(b) as { views: { nodes: { id: string }[]; edges: { from: string; to: string }[] }[] };
    draft.views[0].nodes = draft.views[0].nodes.filter((n) => n.id !== "api");
    draft.views[0].edges = draft.views[0].edges.filter((e) => e.from !== "api" && e.to !== "api");
    const doc = answerToDocument(draft, ctx(b));
    expect(doc.views[0].texts).toEqual(b.views[0].texts);
    draft.views[0].nodes = [];
    expect(() => answerToDocument(draft, ctx(b))).toThrow(EmptyDiagramError);
    expect(() => answerToDocument({ views: [] }, ctx(b))).toThrow(EmptyDiagramError);
  });

  it("uses the strict schema dialect: every property required, no extra properties", () => {
    const walk = (s: Record<string, unknown>) => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect(Object.keys(s.properties as object).sort()).toEqual([...(s.required as string[])].sort());
        for (const p of Object.values(s.properties as object)) walk(p as Record<string, unknown>);
      }
      if (s.type === "array") walk(s.items as Record<string, unknown>);
      if (s.anyOf) for (const a of s.anyOf as Record<string, unknown>[]) walk(a);
    };
    walk(DRAFT_JSON_SCHEMA as unknown as Record<string, unknown>);
  });
});
