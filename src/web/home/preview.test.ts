import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAnyFile } from "../../core/convert";
import { normalizeFile4, type Document4 } from "../../core/file4";
import { kindsOf, previewOf } from "./preview";

const example = (): Document4 => {
  const r = readAnyFile(JSON.parse(readFileSync(new URL("../../../examples/shop.archdraw.json", import.meta.url), "utf8")));
  if (!r.ok || !r.file) throw new Error(r.errors.join("\n"));
  return normalizeFile4(r.file, { id: "d_preview", now: "2026-10-27T10:00:00.000Z" });
};

describe("previewOf", () => {
  it("draws each overview view with its own id prefix, in the drawing's theme", () => {
    const doc = example();
    const p = previewOf(doc, "pv7");
    expect(p.theme).toBe(doc.theme === "dark" ? "dark" : "light");
    expect(p.views.length).toBe(doc.choices[0].channels.overview.views.length);
    const first = p.views[0];
    expect(first.svg).toMatch(/^<svg [^>]*viewBox="[-\d. ]+"/);
    expect(first.svg).toContain('data-node-id="web"');
    // Gradient ids carry the card's prefix, so two previews on one page never share a definition.
    expect(first.svg).not.toMatch(/id="ad-/);
    expect(first.svg).toMatch(/id="pv7v0-/);
    expect(first.kinds[0]).toBe("client");
  });

  it("fills the frame above 8 components and shows a smaller drawing whole", () => {
    const doc = example();
    const few = previewOf(doc, "a").views[0];
    expect(few.svg).toContain('preserveAspectRatio="xMidYMid meet"');
    const view = doc.choices[0].channels.overview.views[0];
    const comps = doc.choices[0].facts.components;
    const base = view.nodes[0];
    const many: Document4 = structuredClone(doc);
    const c0 = comps.find((c) => c.id === base.id)!;
    for (let i = 0; i < 9; i++) {
      many.choices[0].facts.components.push({ ...c0, id: `extra${i}`, label: `Extra ${i}` });
      many.choices[0].channels.overview.views[0].nodes.push({ ...base, id: `extra${i}`, x: 400 * i, y: 900 });
    }
    expect(previewOf(many, "b").views[0].svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });
});

describe("kindsOf", () => {
  it("keeps the first five kinds in the order they first appear", () => {
    expect(kindsOf(["api", "client", "api", "data", "llm", "worker", "ops", "gate"])).toEqual(["api", "client", "data", "llm", "worker"]);
  });
});
