import type { DiagramDocument, DiagramView } from "./model";
import type { Document3 } from "./file3";

/** The instruction a simplify run always carries (api contract Run kinds; ui contract, Suggestions: `Simpler`). */
export const SIMPLIFY_INSTRUCTION = "Simplify the overview: keep every component in a detail view or a merged part";

/** The overview and every view reached from it by `detail`, recursively (diagram contract, Simplification coverage). */
export function reachableViews(doc: Pick<DiagramDocument, "views">): Set<string> {
  const byId = new Map(doc.views.map((v) => [v.id, v]));
  const out = new Set<string>();
  const walk = (v: DiagramView | undefined) => {
    if (!v || out.has(v.id)) return;
    out.add(v.id);
    for (const n of v.nodes) if (n.detail) walk(byId.get(n.detail));
  };
  walk(doc.views[0]);
  return out;
}

/**
 * What a simplification may change: the overview and the detail it reaches. Every other view of the
 * input comes back exactly as it was, and a new view nothing links to is left out — one warning each.
 */
export function keepUnrelatedViews(before: DiagramDocument, after: DiagramDocument): { doc: DiagramDocument; warnings: string[] } {
  const reach = reachableViews(after);
  const warnings: string[] = [];
  const views: DiagramView[] = [];
  for (const v of after.views) {
    const was = before.views.find((b) => b.id === v.id);
    if (reach.has(v.id)) { views.push(v); continue; }
    if (!was) { warnings.push(`Left out the new view "${v.id}": no component of the overview links to it`); continue; }
    if (JSON.stringify(was) !== JSON.stringify(v)) warnings.push(`Kept the view "${v.id}" as it was: the simplification changes only the overview and its detail`);
    views.push(structuredClone(was));
  }
  for (const b of before.views) {
    if (views.some((v) => v.id === b.id) || reach.has(b.id)) continue;
    warnings.push(`Kept the view "${b.id}": the engine left it out`);
    views.push(structuredClone(b));
  }
  const order = (id: string) => { const i = before.views.findIndex((b) => b.id === id); return i < 0 ? 1e9 : i; };
  views.sort((a, b) => order(a.id) - order(b.id));
  return { doc: { ...after, views, warnings: [...after.warnings, ...warnings] }, warnings };
}

/**
 * The ids of the input's components (and of their provenance) that the result neither keeps,
 * in the overview or a view reached from it or a view it keeps, nor names in a surviving `from`.
 */
export function missingComponents(before: Pick<DiagramDocument, "views">, after: Pick<DiagramDocument, "views">): string[] {
  const originals: string[] = [];
  const add = (id: string) => { if (!originals.includes(id)) originals.push(id); };
  for (const v of before.views) for (const n of v.nodes) { add(n.id); for (const f of n.from ?? []) add(f); }
  const reach = reachableViews(after);
  const present = new Set<string>();
  for (const v of after.views) {
    const kept = before.views.find((b) => b.id === v.id);
    if (!reach.has(v.id) && !(kept && JSON.stringify(kept) === JSON.stringify(v))) continue;
    for (const n of v.nodes) { present.add(n.id); for (const f of n.from ?? []) present.add(f); }
  }
  return originals.filter((id) => !present.has(id));
}

export class CoverageError extends Error {
  constructor(readonly missing: string[]) {
    super(`The simplified drawing loses ${missing.length} component${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Nothing was changed.`);
  }
}

/**
 * Simplify coverage on facts (diagram contract, Simplify coverage): the component facts no part
 * shows or holds any more in the overview, in a view reached from it through `detail`, or in a
 * view left exactly as it was. In file order.
 */
export function missingFacts(before: Document3, after: Document3): string[] {
  const views = after.channels.overview.views;
  const reach = new Set<string>();
  const walk = (id: string) => {
    if (reach.has(id)) return;
    reach.add(id);
    for (const p of views.find((v) => v.id === id)?.nodes ?? []) if (p.detail) walk(p.detail);
  };
  if (views[0]) walk(views[0].id);
  const shown = new Set<string>();
  for (const v of views) {
    const kept = before.channels.overview.views.find((b) => b.id === v.id);
    if (!reach.has(v.id) && !(kept && JSON.stringify(kept) === JSON.stringify(v))) continue;
    for (const p of v.nodes) for (const f of [...p.facts, ...(p.held ?? [])]) shown.add(f);
  }
  return before.facts.components.map((c) => c.id).filter((id) => !shown.has(id));
}

