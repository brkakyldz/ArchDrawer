/**
 * The story route of a refine on the overview (api contract, Routing): the answer may change how the
 * overview looks — where parts are, their form and icon, connection steps, texts, captions, view
 * titles — and nothing it says. Every content change in the answer is undone, with one warning each
 * (invariant 6). Pure (invariant 4).
 */
import type { DiagramDocument, DiagramEdge, DiagramNode, DiagramView } from "./model";

const WHY = "redrawing from the facts changes no content";
/** What a part says: everything but where it is and how it looks. */
const said = (n: DiagramNode) => JSON.stringify([n.label, n.kind, n.sub, n.items, n.description, n.files, n.parent, n.detail, n.from ?? n.facts ?? []]);
const saidEdge = (e: DiagramEdge) => JSON.stringify([e.label, e.style, e.both]);
const ends = (e: DiagramEdge) => `${e.from}>${e.to}`;

export function appearanceOnly(base: DiagramDocument, answer: DiagramDocument): { doc: DiagramDocument; warnings: string[] } {
  const warnings: string[] = [];
  const answered = new Map(answer.views.map((v) => [v.id, v]));
  for (const v of answer.views) if (!base.views.some((b) => b.id === v.id)) warnings.push(`Ignored the new view "${v.title || v.id}": ${WHY}`);
  const views: DiagramView[] = base.views.map((b) => {
    const a = answered.get(b.id);
    if (!a) { warnings.push(`Kept the view "${b.title || b.id}": ${WHY}`); return b; }
    const got = new Map(a.nodes.map((n) => [n.id, n]));
    for (const n of a.nodes) if (!b.nodes.some((o) => o.id === n.id)) warnings.push(`Ignored the new component "${n.label}": ${WHY}`);
    const nodes = b.nodes.map((o) => {
      const n = got.get(o.id);
      if (!n) { warnings.push(`Kept "${o.label}", which the answer removed: ${WHY}`); return o; }
      const at = { x: n.x, y: n.y, place: n.place, lane: n.lane ?? o.lane ?? null };
      // A content change is ignored whole: "hold X in Y" also makes Y a panel, which goes with it.
      if (said(o) !== said(n)) { warnings.push(`Ignored the change to "${o.label}": ${WHY}`); return { ...o, ...at }; }
      return { ...o, ...at, form: n.form, icon: n.icon };
    });
    const left = [...a.edges];
    const edges = b.edges.map((o) => {
      const i = left.findIndex((e) => ends(e) === ends(o));
      if (i < 0) { warnings.push(`Kept the connection ${label(b, o.from)} → ${label(b, o.to)}, which the answer removed: ${WHY}`); return o; }
      const [e] = left.splice(i, 1);
      if (saidEdge(o) !== saidEdge(e)) warnings.push(`Ignored the change to the connection ${label(b, o.from)} → ${label(b, o.to)}: ${WHY}`);
      return { ...o, step: e.step };
    });
    // Named as drawn: a part the answer renamed keeps its name.
    const named = (id: string) => (b.nodes.some((n) => n.id === id) ? label(b, id) : label(a, id));
    for (const e of left) warnings.push(`Ignored the new connection ${named(e.from)} → ${named(e.to)}: ${WHY}`);
    return { ...b, title: a.title, caption: { ...a.caption }, nodes, edges, texts: a.texts.map((t) => ({ ...t })) };
  });
  if (answer.title !== base.title) warnings.push(`Kept the title "${base.title}": ${WHY}`);
  const doc: DiagramDocument = { ...answer, title: base.title, views, warnings: [...answer.warnings, ...warnings] };
  return { doc, warnings };
}

const label = (v: DiagramView, id: string) => v.nodes.find((n) => n.id === id)?.label ?? id;
