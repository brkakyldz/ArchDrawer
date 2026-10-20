import { readFileSync } from "node:fs";
import { layoutView } from "../src/core/layout";
import { assignEdgeIds, fillDefaults, type DiagramDocument, type DiagramEdge, type Kind, type NodeInput } from "../src/core/model";

/** Story inputs, converted only for offline geometry checks (not the product converter). */
interface Intent {
  title: string; lede: string; zones: { id: string; label: string }[];
  parts: { id: string; label: string; sub: string; kind: Kind; chips: string[]; zone: string | null; spine: number | null; anchor: string | null; side: "above" | "below" | null; from: string[] }[];
  edges: { from: string; to: string; label: string; style: DiagramEdge["style"]; step: number | null }[];
}

export function storyFixture(name: string, portrait: boolean, labels = true): DiagramDocument {
  if (name === "shop") {
    const file = JSON.parse(readFileSync("tests/fixtures/shop.archdraw.json", "utf8"));
    const doc = fillDefaults(file);
    assignEdgeIds(doc);
    const view = doc.views[0];
    const spine = [...new Set([...view.edges].filter((e) => e.step !== null).sort((a, b) => a.step! - b.step!).flatMap((e) => [e.from, e.to]))];
    view.nodes = view.nodes.map((n) => ({ ...n, x: undefined, y: undefined, lane: spine.includes(n.id) ? { spine: spine.indexOf(n.id) } : n.lane }));
    return { ...doc, views: [layoutView(view, { portrait, labels })] } as DiagramDocument;
  }
  const intent: Intent = JSON.parse(readFileSync(`tests/fixtures/story/${name}.json`, "utf8"));
  const base = (id: string, label: string): NodeInput => ({ id, label, sub: "", kind: "service", form: "card", icon: null, items: [], description: label, files: [], parent: null, detail: null, place: null, lane: null, from: [] });
  const nodes: NodeInput[] = intent.zones.map((z) => ({ ...base(`zone-${z.id}`, z.label), form: "group" }));
  for (const p of intent.parts) nodes.push({ ...base(p.id, p.label), sub: p.sub, kind: p.kind, form: p.chips.length ? "panel" : "card", items: p.chips, parent: p.zone ? `zone-${p.zone}` : null, lane: p.spine !== null ? { spine: p.spine } : { anchor: p.anchor!, side: p.side! }, from: p.from });
  const edges: DiagramEdge[] = [];
  for (const e of intent.edges) {
    const reverse = edges.find((x) => x.from === e.to && x.to === e.from);
    if (reverse) { reverse.both = true; reverse.label ||= e.label; continue; }
    edges.push({ ...e, id: `edge-${edges.length + 1}`, both: false });
  }
  const view = layoutView({ id: "fixture-linkedin", title: "Post", caption: { title: intent.title, lede: intent.lede }, postOf: null, nodes, edges, texts: [] }, { portrait, labels });
  return { ...fillDefaults({ schema: "archdraw/diagram@2", title: intent.title, views: [view] }), views: [view] } as DiagramDocument;
}
