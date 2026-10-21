/**
 * The simple versions of the README and presentation channels (ui contract, Simple versions): drawn
 * by code from the overview's first view, without an engine. Pure (invariant 4).
 */
import { applyChannel, clearOutdated, joinChannel, type ApplyResult } from "./channels";
import { freeIdAmong, validateDocument3, type Document3, type Step } from "./file3";
import { channelViewId } from "./intent";
import { layoutView } from "./layout";
import type { DiagramView } from "./model";

const TITLES = { readme: "README", presentation: "Presentation" } as const;

/**
 * The overview's first view as it is — the same parts (ids, facts, forms, held rows, limits, groups,
 * no own text) and connections — laid out again, with no texts. The presentation adds one step per
 * numbered connection, or one step of every top-level part when there is none. One undoable edit:
 * it replaces what the channel held and empties its `outdated`.
 */
export function prepareChannel(stored: Document3, channel: "readme" | "presentation"): ApplyResult {
  const src = joinChannel(stored, "overview").views[0];
  const used = new Set<string>(src.nodes.map((n) => n.id));
  const comps = new Map(stored.facts.components.map((c) => [c.id, c]));
  // No own text: a part showing one fact shows its name and sub-line. No inside view: `detail` is the overview's alone (rule 10).
  const fresh = src.nodes.map(({ x: _x, y: _y, ...n }) => {
    const fact = n.facts?.length === 1 ? comps.get(n.facts[0]) : undefined;
    return { ...n, ...(fact ? { label: fact.label, sub: fact.sub } : {}), detail: null, facts: [...(n.facts ?? [])] };
  });
  const laid = layoutView({ ...src, postOf: null, nodes: fresh }, { post: false });
  const edges = src.edges.map((e) => { const id = freeIdAmong(used, `${channel === "readme" ? "rd" : "pr"}-e`); used.add(id); return { ...e, id, relations: [...(e.relations ?? [])] }; });
  const view: DiagramView = { id: channelViewId(stored, channel), title: TITLES[channel], caption: { ...src.caption }, postOf: null, nodes: laid.nodes, edges, texts: [] };

  let steps: Step[] | undefined;
  if (channel === "presentation") {
    const label = (id: string) => src.nodes.find((n) => n.id === id)?.label ?? id;
    const numbered = src.edges.filter((e) => e.step !== null).sort((a, b) => a.step! - b.step!);
    steps = numbered.length
      ? numbered.map((e, i) => ({ id: `s${i + 1}`, parts: [...new Set([e.from, e.to])], text: (e.label || `${label(e.from)} → ${label(e.to)}`).slice(0, 120), note: "" }))
      : [{ id: "s1", parts: src.nodes.filter((n) => n.parent === null).map((n) => n.id), text: (src.caption.title || TITLES.presentation).slice(0, 120), note: "" }];
  }
  const cleared: Document3 = { ...stored, channels: { ...stored.channels, [channel]: { ...stored.channels[channel], views: [], ...(steps ? { steps: [] } : {}) } } };
  const r = applyChannel(cleared, channel, { views: [view], ...(steps ? { steps } : {}) }, { keepFacts: true });
  if (!r.ok) return r;
  // Never hand the editor a drawing the server would refuse to save.
  const checked = validateDocument3(clearOutdated(r.doc, channel));
  return checked.ok ? { ok: true, doc: checked.doc } : { ok: false, error: `The simple version could not be drawn: ${checked.error}` };
}
