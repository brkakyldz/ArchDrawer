/**
 * Product-level acceptance: the contract's minimal file and the hotel drawing (written
 * by a real session) are validated, normalised, laid out and rendered in every share format and
 * theme into test-results/smoke-core/, then the image rules of docs/contracts/ui.md and
 * docs/spec.md are checked on the output files.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layoutRects, overlaps } from "../src/core/geometry";
import { validateDocument, validateFile } from "../src/core/model";
import { normalizeFile } from "../src/core/normalize";
import { renderMermaid } from "../src/core/export/mermaid";
import { DEFAULT_SHARE, FORMAT_IDS, FORMATS, renderShare } from "../src/core/export/share";

const out = join(process.cwd(), "test-results", "smoke-core");
mkdirSync(out, { recursive: true });
const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };

const inputs = [
  { name: "shop", path: "tests/fixtures/shop.archdraw.json" },
  { name: "hotel", path: "tests/fixtures/hotel.archdraw.json" },
];

for (const input of inputs) {
  const raw = JSON.parse(readFileSync(input.path, "utf8"));
  const v = validateFile(raw);
  check(v.ok, `${input.name}: file validates (${v.errors.length} errors, ${v.warnings.length} warnings)`);
  if (!v.ok) { for (const e of v.errors) console.log(`     ${e}`); continue; }
  const doc = normalizeFile(v.file!, { id: "d_smoke00001", now: new Date().toISOString(), source: null });
  check(validateDocument(doc).ok, `${input.name}: normalised document validates`);
  writeFileSync(join(out, `${input.name}.archdraw.json`), JSON.stringify(doc, null, 2));

  for (const view of doc.views) {
    const rects = layoutRects(view);
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    const related = (a: string, b: string) => {
      for (let p = byId.get(a)!.parent; p; p = byId.get(p)?.parent ?? null) if (p === b) return true;
      for (let p = byId.get(b)!.parent; p; p = byId.get(p)?.parent ?? null) if (p === a) return true;
      return false;
    };
    const clash = view.nodes.flatMap((a) => view.nodes.filter((b) => a.id < b.id && !related(a.id, b.id) && overlaps(rects.get(a.id)!, rects.get(b.id)!)).map((b) => `${a.id}/${b.id}`));
    check(clash.length === 0, `${input.name}/${view.id}: no overlapping components${clash.length ? ` (${clash.join(", ")})` : ""}`);

    const mmd = renderMermaid(view);
    writeFileSync(join(out, `${input.name}-${view.id}.mmd`), mmd);
    check(mmd.startsWith("flowchart LR\n") && view.nodes.every((n) => mmd.includes(`${n.id}[`) || mmd.includes(`subgraph ${n.id}[`)), `${input.name}/${view.id}: mermaid names every component`);

    for (const format of FORMAT_IDS) for (const theme of ["light", "dark"] as const) {
      const img = renderShare(doc, view.id, { ...DEFAULT_SHARE, format, theme });
      const file = `${input.name}-${view.id}-${format}-${theme}.svg`;
      writeFileSync(join(out, file), img.svg);
      const f = FORMATS[format];
      const svg = img.svg;
      const tag = `${file}:`;
      check(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}" height="${f.h}"`), `${tag} root svg at ${f.w}×${f.h}`);
      check(svg.includes(`data-theme="${theme}"`) && svg.includes(`data-format="${format}"`), `${tag} theme and format marked`);
      check(!/foreignObject|<script|<image/.test(svg), `${tag} no foreignObject, script or raster`);
      check(!/archdraw/i.test(svg.replace(/data-[a-z-]+="[^"]*"/g, "")), `${tag} no product mark`);
      const parts = format === "feed" ? view.nodes.filter((n) => !n.parent) : view.nodes;
      check(parts.every((n) => svg.includes(`data-node-id="${n.id}"`)), `${tag} every ${format === "feed" ? "top-level part" : "component"} drawn`);
      check(!view.caption.title || svg.includes('data-caption="title"'), `${tag} figure caption title`);
      check(svg.includes("data-key="), `${tag} colour key`);
      check(["good", "ok", "warn"].includes(img.readability.level) && img.readability.text.length > 0, `${tag} readability ${img.readability.level}: ${img.readability.text}`);
    }
  }
}

console.log(failures.length ? `\nSMOKE-CORE FAILED (${failures.length})` : `\nSMOKE-CORE OK → ${out}`);
if (failures.length) process.exitCode = 1;
await import("./smoke-story");
