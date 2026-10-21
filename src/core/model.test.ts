import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { depthWarnings, validateDocument, validateFile } from "./model";
import { normalizeFile } from "./normalize";
import { edge, file, node } from "./testkit";

const shop = () => JSON.parse(readFileSync("tests/fixtures/shop.archdraw.json", "utf8"));

describe("validateFile", () => {
  it("reads texts, and turns a v2.0 file's notes into 16 px texts with one warning per view", () => {
    const f = shop();
    f.views[0].texts = [{ id: "t1", text: "Checkout", x: 0, y: -60, size: 40 }];
    expect(validateFile(f).ok).toBe(true);
    for (const bad of ["huge", 7, 201]) {
      f.views[0].texts[0].size = bad;
      expect(validateFile(f).errors).toEqual(["views[0].texts[0].size: must be a number from 8 to 200"]);
    }
    const old = shop();
    delete old.views[0].texts;
    old.views[0].notes = [{ id: "n1", text: "Retries are safe", x: 40, y: 600, w: 184, attach: "api" }, { id: "n2", text: "", x: 0, y: 0, w: 184, attach: null }];
    const r = validateFile(old);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/^View "overview": 2 notes became texts/);
    expect(r.file!.views[0]).not.toHaveProperty("notes");
    expect(r.file!.views[0].texts).toEqual([{ id: "n1", text: "Retries are safe", x: 40, y: 600, size: 16 }]);
    const doc = normalizeFile(r.file!, { id: "d_notes00001", now: "2026-10-13T00:00:00.000Z", source: null });
    expect(doc.warnings).toEqual(['View "overview": 2 notes became texts']);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("accepts the minimal example file", () => {
    const r = validateFile(shop());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("lists every violation with its JSON path, not only the first", () => {
    const f = shop();
    f.views[0].nodes[0].kind = "database";
    f.views[0].nodes[1].items = [];
    f.views[0].edges.push({ from: "api", to: "ghost", label: "", style: "call", both: false, step: null });
    f.views[0].nodes[2].icon = "rocket";
    const r = validateFile(f);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/^views\[0\]\.nodes\[0\]\.kind: "database" is not a kind; use one of actor, client/),
      expect.stringMatching(/^views\[0\]\.nodes\[1\]\.items: a panel lists what the component holds/),
      expect.stringMatching(/^views\[0\]\.edges\[2\]\.to: "ghost" is not a component in this view/),
      expect.stringMatching(/^views\[0\]\.nodes\[2\]\.icon: "rocket" is not an icon/),
    ]));
    expect(r.errors.length).toBe(4);
  });

  it("refuses a v1 document with the migrate hint", () => {
    const r = validateFile({ schema: "archdraw/diagram@1", nodes: [] });
    expect(r.errors).toEqual(['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"']);
  });

  it("checks parents: a group in the same view, no cycles, at most three deep", () => {
    const deep = file([
      node("g1", { form: "group" }), node("g2", { form: "group", parent: "g1" }), node("g3", { form: "group", parent: "g2" }),
      node("g4", { form: "group", parent: "g3" }), node("leaf", { parent: "g4" }), node("card"), node("bad", { parent: "card" }),
    ]);
    const r = validateFile(deep);
    expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/nodes\[4\]\.parent: nests 4 groups deep; at most 3/),
      expect.stringMatching(/nodes\[6\]\.parent: "card" is a card; only a group holds components/),
    ]));
    const loop = file([node("a", { form: "group", parent: "b" }), node("b", { form: "group", parent: "a" })]);
    expect(validateFile(loop).errors.join("\n")).toMatch(/cannot be inside itself/);
  });

  it("refuses a reverse pair and a second connection on one pair", () => {
    const r = validateFile(file([node("a"), node("b")], [edge("a", "b"), edge("b", "a"), edge("a", "b")]));
    expect(r.errors).toEqual([
      expect.stringMatching(/edges\[1\]: b → a reverses an earlier connection; make that one two-way/),
      expect.stringMatching(/edges\[2\]: a second connection a → b/),
    ]);
  });

  it("checks file paths: relative form always, existence when asked", () => {
    const f = file([node("a", { files: ["src/a.ts", "../escape.ts", "C:/abs.ts", "missing.ts"] })]);
    expect(validateFile(f).errors).toHaveLength(2);
    const r = validateFile(f, { fileExists: (p) => p === "src/a.ts" });
    expect(r.errors).toEqual([
      expect.stringMatching(/files\[1\]: "\.\.\/escape\.ts" must be a repository-relative path/),
      expect.stringMatching(/files\[2\]: "C:\/abs\.ts" must be a repository-relative path/),
      expect.stringMatching(/files\[3\]: "missing\.ts" does not exist in the repository/),
    ]);
    // Opening or saving a drawing: a missing path is a warning and the file stays valid.
    const warned = validateFile(file([node("a", { files: ["src/a.ts", "missing.ts"] })]), { fileExists: (p) => p === "src/a.ts", missingFiles: "warn" });
    expect(warned).toMatchObject({ ok: true, errors: [] });
    expect(warned.warnings).toContainEqual(expect.stringMatching(/files\[1\]: "missing\.ts" does not exist in the repository/));
  });

  it("requires x and y together, ids unique across the file, detail naming another view", () => {
    const f = file([node("a", { x: 10 } as never), node("b", { detail: "overview" })], [edge("a", "b", { id: "a" })]);
    const r = validateFile(f);
    expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/nodes\[0\]\.y: x and y are both present or both absent/),
      expect.stringMatching(/nodes\[1\]\.detail: must name a view other than/),
      expect.stringMatching(/edges\[0\]\.id: "a" is used twice/),
    ]));
  });
});

describe("depth warnings", () => {
  it("warns on a flat row, no held items, tuning numbers, no main path and a repeated label", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id, i) => node(id, { place: { row: 0, col: i }, sub: i === 0 ? "up to 6 turns" : "" }));
    const edges = [edge("a", "b", { label: "run" }), edge("b", "c", { label: "run" }), edge("c", "d", { label: "run" })];
    expect(depthWarnings(file(nodes, edges))).toEqual([
      expect.stringMatching(/all 6 top-level components share row 0 — a flat pipeline/),
      expect.stringMatching(/no component lists what it holds/),
      expect.stringMatching(/no main path/),
      expect.stringMatching(/the label "run" repeats on 3 connections/),
    ]);
    // A tuning number is a warning on LinkedIn only (STORY-5); the flat and held-item checks skip LinkedIn.
    expect(depthWarnings(file(nodes, edges), { share: true })).toEqual([
      expect.stringMatching(/nodes\[0\]\.sub: "up to 6 turns" looks like a tuning number/),
      expect.stringMatching(/no main path/),
      expect.stringMatching(/the label "run" repeats on 3 connections/),
    ]);
  });

  it("is quiet on a two-dimensional drawing with held items: the overview has no count target", () => {
    const nodes = [
      node("web", { place: { row: 0, col: 0 } }), node("api", { place: { row: 0, col: 1 }, form: "panel", items: ["Validate", "Route"] }),
      node("svc", { place: { row: 0, col: 2 } }), node("db", { kind: "data", place: { row: 1, col: 2 } }),
      node("ops", { kind: "ops", place: { row: 1, col: 1 } }), node("ok", { kind: "actor", place: { row: -1, col: 2 } }),
    ];
    expect(depthWarnings(file(nodes, [edge("web", "api", { step: 1 }), edge("api", "svc", { step: 2 }), edge("svc", "db")]))).toEqual([]);
  });
});

describe("normalisation and stored documents", () => {
  it("fills defaults, edge ids and positions; a stored document validates", () => {
    const doc = normalizeFile(shop(), { id: "d_abcdef12", now: "2026-10-13T00:00:00.000Z", source: { kind: "local", path: "C:/repo" } });
    expect(doc.id).toBe("d_abcdef12");
    expect(doc.theme).toBe("light");
    expect(doc.views[0].edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    for (const n of doc.views[0].nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("refuses a stored document without positions", () => {
    const r = validateDocument({ ...shop(), id: "d_abcdef12" });
    expect(r.ok).toBe(false);
  });
});
