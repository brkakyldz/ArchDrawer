import { mkdirSync, writeFileSync } from "node:fs";
import { bezierAt, layoutRects, routeEdges, type Point } from "../src/core/geometry";
import { DEFAULT_SHARE, renderShare } from "../src/core/export/share";
import { validateDocument } from "../src/core/model";
import { storyFixture } from "./story-fixtures";

const out = "test-results/smoke-core";
mkdirSync(out, { recursive: true });
const cross = (a: Point, b: Point, c: Point, d: Point) => {
  const turn = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
};
let failures = 0;
for (const name of ["reference", "claude", "codex", "shop"]) for (const format of ["feed", "linkedin"] as const) {
  const doc = storyFixture(name, format === "feed"), view = doc.views[0];
  const validation = validateDocument(doc);
  if (!validation.ok) { console.error(validation); failures++; continue; }
  const rects = layoutRects(view), routes = routeEdges(view, rects);
  const edges = view.edges.filter((e) => routes.has(e.id));
  const poly = new Map(edges.map((e) => [e.id, Array.from({ length: 65 }, (_, i) => bezierAt(routes.get(e.id)!, i / 64))]));
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) for (const b of edges.slice(i + 1)) {
    const a = edges[i];
    if ([a.from, a.to].some((id) => id === b.from || id === b.to)) continue;
    const pa = poly.get(a.id)!, pb = poly.get(b.id)!;
    if (pa.slice(1).some((p, s) => pb.slice(1).some((q, t) => cross(pa[s], p, pb[t], q)))) crossings++;
  }
  const over: string[] = [];
  for (const e of edges) for (const n of view.nodes) {
    if (n.form === "group" || n.id === e.from || n.id === e.to) continue;
    const r = rects.get(n.id)!;
    if (poly.get(e.id)!.some((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h)) over.push(`${e.id}/${n.id}`);
  }
  const img = renderShare(doc, view.id, { ...DEFAULT_SHARE, format, theme: "light", lede: true, legend: false });
  // The meter reads what the image draws: names and every text, in place and opened.
  const r = img.readability, round = (v: number) => Math.round(v * 100) / 100;
  const smallestText = { inPlace: round(r.inPlace), opened: round(r.opened), names: { inPlace: round(r.names.inPlace), opened: round(r.names.opened) }, level: r.level };
  const missingLabels = edges.filter((e) => e.label && !routes.get(e.id)!.labelAt).map((e) => e.id);
  const report = { name, format, crossings, edgesOverParts: over, cutText: img.shortened, missingLabels, smallestText, scale: round(img.scale) };
  console.log(JSON.stringify(report));
  writeFileSync(`${out}/story-${name}-${format}.svg`, img.svg);
  writeFileSync(`${out}/story-${name}-${format}.json`, JSON.stringify(report, null, 2));
  if (crossings || over.length || img.shortened.length || missingLabels.length || (format === "feed" && smallestText.level !== "good")) failures++;
}
console.log(`STORY-SMOKE ${failures ? "FAIL" : "OK"}: ${8 - failures} passed / ${failures} failed / 0 skipped`);
if (failures) process.exitCode = 1;
