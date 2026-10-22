import type { ComponentFact, Document3, Step } from "../../core/file3";
import type { DiagramView } from "../../core/model";

/**
 * The tour's panel (ui contract, Presenting and the tour, tour-part and tour-file; ADR 0012):
 * where in the code each lit part lives, from its facts. Pure: nothing here reads, opens or
 * checks a file.
 */

export interface TourFile {
  path: string;
  /** The path, then each cited range on it as `:<from>–<to>` (`:<from>` when from = to), joined by `, `. */
  text: string;
}

/** The step's parts in the order of the view's parts. */
export function tourParts(view: Pick<DiagramView, "nodes">, step: Pick<Step, "parts">): DiagramView["nodes"] {
  const lit = new Set(step.parts);
  return view.nodes.filter((n) => lit.has(n.id));
}

/**
 * A part's files: its facts in order, then its held facts in order; for each fact its `files`
 * first, then its evidence files not already listed. Each path once, with the ranges its evidence
 * cites on it, in that order (a range cited twice is written once).
 */
export function tourFiles(doc: Pick<Document3, "facts" | "channels">, partId: string): TourFile[] {
  const part = doc.channels.presentation.views[0]?.nodes.find((n) => n.id === partId);
  if (!part) return [];
  const byId = new Map(doc.facts.components.map((f) => [f.id, f]));
  const facts = [...part.facts, ...(part.held ?? [])].map((id) => byId.get(id)).filter((f): f is ComponentFact => !!f);
  const ranges = new Map<string, string[]>();
  const list = (path: string) => { if (path && !ranges.has(path)) ranges.set(path, []); };
  for (const f of facts) {
    for (const path of f.files) list(path);
    for (const e of f.evidence ?? []) list(e.file);
  }
  for (const f of facts) {
    for (const e of f.evidence ?? []) {
      if (!e.lines) continue;
      const [from, to] = e.lines;
      const r = from === to ? `:${from}` : `:${from}–${to}`;
      const on = ranges.get(e.file);
      if (on && !on.includes(r)) on.push(r);
    }
  }
  return [...ranges].map(([path, rs]) => ({ path, text: path + rs.join(", ") }));
}
