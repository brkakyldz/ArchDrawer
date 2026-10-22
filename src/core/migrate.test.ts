import { describe, expect, it } from "vitest";
import { readAnyFile } from "./convert";
import { migrateV1 } from "./migrate";
import { validateDocument } from "./model";

const v1 = {
  schema: "archdraw/diagram@1", id: "d_v1abcdef", title: "Shop", subtitle: "How an order flows", theme: "dark", showSteps: true,
  direction: "LR", source: null, engine: null, instruction: "", createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
  nodes: [
    { id: "web", label: "Web app", kind: "ui", tech: "React", description: "Pages", group: null, files: ["web/index.html"], x: 40, y: 40 },
    { id: "api", label: "API", kind: "service", tech: "Node", description: "", group: "backend", files: [], x: 300, y: 40 },
    { id: "db", label: "DB", kind: "data", tech: "", description: "Rows", group: null, files: [], x: 600, y: 40 },
  ],
  groups: [{ id: "backend", label: "Backend", parent: null, x: 276, y: 0, w: 260, h: 160 }],
  edges: [
    { id: "e1", from: "web", to: "api", label: "POST", style: "call", step: 1 },
    { id: "e2", from: "api", to: "web", label: "201", style: "result", step: null },
    { id: "e3", from: "api", to: "db", label: "", style: "result", step: null },
    { id: "e4", from: "api", to: "db", label: "events", style: "async", step: null },
  ],
  notes: [{ id: "n1", text: "Hello", x: 40, y: 300 }],
  warnings: [],
};

describe("v1 → v2 migration", () => {
  it("keeps content and positions and reports every change", () => {
    const { doc, warnings } = migrateV1(v1, "2026-10-13T00:00:00.000Z");
    expect(validateDocument(doc).ok).toBe(true);
    const v = doc.views[0];
    expect(v.caption).toEqual({ title: "Shop", lede: "How an order flows" });
    expect(v.nodes.find((n) => n.id === "web")).toMatchObject({ kind: "client", sub: "React", form: "card", x: 40, y: 40, files: ["web/index.html"] });
    expect(v.nodes.find((n) => n.id === "backend")).toMatchObject({ form: "group", icon: "layers", kind: "service" });
    expect(v.nodes.find((n) => n.id === "api")).toMatchObject({ parent: "backend", description: "No description yet." });
    expect(v.edges.find((e) => e.id === "e1")).toMatchObject({ both: true, step: 1, style: "call" });
    expect(v.edges.map((e) => e.id).sort()).toEqual(["e1", "e4"]);
    expect(v.texts[0]).toEqual({ id: "n1", text: "Hello", x: 40, y: 300, size: 16 });
    expect(warnings).toEqual([
      'Zone "backend" became a group component',
      'Component "web": kind ui became client',
      'Component "api" had no description',
      'Connection "e2" (a result) merged into "e1" as two-way',
      'Connection "e3" (a result) dropped: a second connection api → db',
    ]);
    expect(doc.warnings).toEqual(warnings);
    expect(doc.theme).toBe("dark");
  });

  it("a v1 file without group fields migrates to a valid drawing", () => {
    const bare = { ...v1, nodes: [{ id: "web", label: "Web app", kind: "ui", tech: "React", description: "Pages", files: [], x: 80, y: 96 }], groups: [], edges: [], notes: [] };
    const { doc } = migrateV1(bare, "2026-10-13T00:00:00.000Z");
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.views[0].nodes[0].parent).toBeNull();
  });
});

describe("v1 → v2 migration shortens text with one warning each (#124)", () => {
  it("warns for a long title, group label, tech, subtitle and note", () => {
    const long = (n: number) => "x".repeat(n);
    const raw = {
      ...v1, title: long(200), subtitle: long(1000),
      groups: [{ ...v1.groups[0], label: long(200) }],
      nodes: v1.nodes.map((n) => (n.id === "web" ? { ...n, tech: long(200) } : n)),
      notes: [{ id: "n1", text: long(2000), x: 40, y: 300 }],
    };
    const { doc, warnings } = migrateV1(raw, "2026-10-13T00:00:00.000Z");
    expect(validateDocument(doc).ok).toBe(true);
    const shortened = warnings.filter((w) => /shortened/i.test(w));
    expect(shortened).toHaveLength(5);
    expect(migrateV1(v1, "2026-10-13T00:00:00.000Z").warnings.filter((w) => /shortened/i.test(w))).toEqual([]);
  });
});

describe("v1 → v3", () => {
  it("converts through @2 when v1 is allowed, and refuses it otherwise", () => {
    expect(readAnyFile(v1).errors).toEqual(['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"']);
    const r = readAnyFile(v1, {}, { allowV1: true, now: "2026-10-21T00:00:00.000Z" });
    expect(r.errors).toEqual([]);
    expect(r.from).toBe("@1");
    expect(r.file!.facts.components.map((c) => c.id).sort()).toEqual(["api", "backend", "db", "web"]);
    expect(r.file!.channels.overview.views[0].nodes.find((n) => n.id === "api")!.parent).toBe("backend");
    expect(r.warnings).toContain("Converted from archdraw/diagram@2");
  });
});
