/**
 * The simple version of the README channel (ui contract, Simple versions): drawn by code from the
 * overview's first view, without an engine. Pure (invariant 4).
 */
import { applyChannel, clearOutdated, joinChannel, type ApplyResult } from "./channels";
import { freeIdAmong, validateDocument3, type Document3 } from "./file3";
import { channelViewId } from "./intent";
import { layoutView } from "./layout";
import { toldFrom } from "./map";
import type { DiagramView } from "./model";

/**
 * The overview's first view as it is — the same parts (ids, facts, forms, held rows, limits, groups,
 * no own text) and connections — laid out again, with no texts. One undoable edit: it replaces what
 * the channel held and empties its `outdated`.
 */
export function prepareChannel(stored: Document3, channel: "readme"): ApplyResult {
  // For the `system` choice, the map and its detail views in panel order, skipping parts with an inside (ui contract).
  const src = toldFrom(stored, joinChannel(stored, "overview").views);
  const used = new Set<string>(src.nodes.map((n) => n.id));
  const comps = new Map(stored.facts.components.map((c) => [c.id, c]));
  // No own text: a part showing one fact shows its name and sub-line. No inside view: `detail` is the overview's alone (rule 10).
  const fresh = src.nodes.map(({ x: _x, y: _y, ...n }) => {
    const fact = n.facts?.length === 1 ? comps.get(n.facts[0]) : undefined;
    return { ...n, ...(fact ? { label: fact.label, sub: fact.sub } : {}), detail: null, facts: [...(n.facts ?? [])] };
  });
  const laid = layoutView({ ...src, postOf: null, nodes: fresh }, { post: false });
  const edges = src.edges.map((e) => { const id = freeIdAmong(used, "rd-e"); used.add(id); return { ...e, id, relations: [...(e.relations ?? [])] }; });
  const view: DiagramView = { id: channelViewId(stored, channel), title: "README", caption: { ...src.caption }, postOf: null, nodes: laid.nodes, edges, texts: [] };

  const cleared: Document3 = { ...stored, channels: { ...stored.channels, [channel]: { ...stored.channels[channel], views: [] } } };
  const r = applyChannel(cleared, channel, { views: [view] }, { keepFacts: true });
  if (!r.ok) return r;
  // Never hand the editor a drawing the server would refuse to save.
  const checked = validateDocument3(clearOutdated(r.doc, channel));
  return checked.ok ? { ok: true, doc: checked.doc } : { ok: false, error: `The simple version could not be drawn: ${checked.error}` };
}
