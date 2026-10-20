import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDocument, validateFile, type DiagramDocument } from "./model";
import { normalizeFile } from "./normalize";
import { answerToDocument, documentToDraft, DRAFT_JSON_SCHEMA, EmptyDiagramError } from "./repair";

const base = (): DiagramDocument => {
  const f = JSON.parse(readFileSync("tests/fixtures/shop.archdraw.json", "utf8"));
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
      'Component "cache": no description, set to "No description yet."',
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

  it("warns once for every change to what the engine said: ids, empty text, items, place, step, a new group's at", () => {
    const b = base();
    const draft = documentToDraft(b) as { title: string; views: { title: string; caption: { title: string }; nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] };
    draft.title = "";
    const v = draft.views[0];
    v.title = " ";
    v.caption.title = "";
    const part = (extra: Record<string, unknown>) => ({ label: "Part", kind: "service", form: "card", icon: null, sub: "", items: [], description: "A part.", files: [], parent: null, detail: null, place: null, ...extra });
    v.nodes.push(part({ id: "zone", form: "group", at: { x: 0, y: 0 } }));
    v.nodes.push(part({ id: "My Service", label: "", description: "", parent: "zone", place: { row: 25, col: 1 } }));
    v.nodes.push(part({ id: "", form: "panel", items: ["First", "", ...Array.from({ length: 12 }, (_, i) => `Item ${i}`)], place: { row: 1.5, col: 0 } }));
    v.edges.push({ from: "api", to: "My Service", label: "", style: "call", both: false, step: 0 });
    const doc = answerToDocument(draft, ctx(b));
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.warnings).toEqual([
      'Renamed the component id "My Service" to "My-Service": ids use letters, digits, - and _',
      'Component "My-Service": place row 25, col 1 is beyond ±20, moved to row 20, col 1',
      'Component "My-Service": no label, labelled with its id',
      'Component "My-Service": no description, set to "No description yet."',
      'Gave the component without an id the id "component-6"',
      'Component "component-6": dropped 1 empty items',
      'Kept the first 12 items of "component-6"',
      'Component "component-6": its place is not a whole row and column, dropped',
      'Ignored the position of the new group "zone": a group takes its place from what it holds',
      'Connection api → My-Service: step 0 is not a positive whole number, dropped',
      'View "overview": no title, set to "Overview"',
      'View "overview": no caption title, set to "How an order flows through Sample Shop"',
      'The drawing has no title, kept "Sample Shop"',
    ]);
    const nodes = doc.views[0].nodes;
    expect(nodes.find((n) => n.id === "My-Service")).toMatchObject({ label: "My-Service", place: { row: 20, col: 1 }, parent: "zone" });
    expect(nodes.find((n) => n.id === "component-6")).toMatchObject({ items: ["First", ...Array.from({ length: 11 }, (_, i) => `Item ${i}`)], place: null });
    expect(doc.title).toBe("Sample Shop");
  });

  it("stays silent on pure normalisation: whitespace, \\ to /, ./, a repeated path, an empty icon", () => {
    const b = base();
    const draft = documentToDraft(b) as { views: { nodes: Record<string, unknown>[] }[] };
    const web = draft.views[0].nodes.find((n) => n.id === "web")!;
    Object.assign(web, { id: " web ", label: "  Web\n app ", icon: "", files: ["src\\web.ts", "./src/web.ts", " src/web.ts "] });
    const doc = answerToDocument(draft, ctx(b));
    expect(doc.warnings).toEqual([]);
    expect(doc.views[0].nodes.find((n) => n.id === "web")).toMatchObject({ label: "Web app", icon: null, files: ["src/web.ts"] });
  });

  it("renames view ids with one warning each and ignores a second copy of a view outside the scope", () => {
    const b = base();
    const draft = documentToDraft(b) as { views: Record<string, unknown>[] };
    const view = (id: string, part: string) => ({ id, title: "More", caption: { title: "More", lede: "" }, edges: [], nodes: [{ id: part, label: "Part", kind: "service", form: "card", icon: null, sub: "", items: [], description: "A part.", files: [], parent: null, detail: null, place: null }] });
    draft.views.push(view("Inside it", "a"), view("", "b"), view("overview", "c"));
    expect(answerToDocument(draft, ctx(b)).warnings).toEqual([
      'Renamed the view id "Inside it" to "Inside-it": ids use letters, digits, - and _',
      'Gave the view without an id the id "view-3"',
      'Renamed the duplicate view id "overview" to "overview-2"',
    ]);
    const twice = documentToDraft(b) as { views: Record<string, unknown>[] };
    twice.views.push(structuredClone(twice.views[0]));
    expect(answerToDocument(twice, { ...ctx(b), scope: { kind: "view" }, view: "overview" }).warnings).toEqual(['Ignored a second view "overview"']);
  });

  it("over the component limit, cuts new components and never one it reported kept", () => {
    const b = base();
    const draft = documentToDraft(b) as { views: { nodes: Record<string, unknown>[]; edges: unknown[] }[] };
    const v = draft.views[0];
    const web = v.nodes.find((n) => n.id === "web")!;
    v.nodes = [web, ...Array.from({ length: 60 }, (_, i) => ({ ...web, id: `n${i + 1}`, label: `Part ${i + 1}`, place: null }))];
    v.edges = [];
    const doc = answerToDocument(draft, { ...ctx(b), scope: { kind: "parts", ids: ["web"] }, view: "overview" });
    expect(validateDocument(doc).ok).toBe(true);
    const ids = doc.views[0].nodes.map((n) => n.id);
    expect(ids).toHaveLength(60);
    expect(ids).toEqual(expect.arrayContaining(["api", "db"]));
    expect(ids).not.toEqual(expect.arrayContaining(["n58"]));
    expect(doc.warnings).toEqual([
      'Kept "Order API": it is outside the selected parts',
      'Kept "Orders DB": it is outside the selected parts',
      'Dropped 3 components of view "overview" over the limit of 60: "n58", "n59", "n60"',
      'Kept the connection api → db as it was: it is outside the selected parts',
    ]);
  });

  it("keeps titles and the caption outside the selected parts, with a warning when the engine changed them", () => {
    const b = base();
    const draft = documentToDraft(b) as { title: string; views: { caption: { lede: string } }[] };
    const parts = { ...ctx(b), scope: { kind: "parts" as const, ids: ["web"] }, view: "overview" };
    expect(answerToDocument(structuredClone(draft), parts).warnings).toEqual([]);
    draft.title = "Another shop";
    draft.views[0].caption.lede = "A new lede.";
    const doc = answerToDocument(draft, parts);
    expect(doc.warnings).toEqual([
      'Kept the title and caption of view "overview" as they were: outside the selected parts',
      'Kept the drawing\'s title "Sample Shop": outside the selected parts',
    ]);
    expect([doc.title, doc.views[0].caption]).toEqual([b.title, b.views[0].caption]);
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
