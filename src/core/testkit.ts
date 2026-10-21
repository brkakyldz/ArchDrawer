import { arrangeForFeed } from "./export/feed";
import { postSource, postViewId } from "./intent";
import { allIds, LIMITS, slugify, type DiagramDocument, type DiagramFile, type DiagramView, type NodeInput } from "./model";

/** Builders for core tests (not used by the product). */

export function node(id: string, extra: Partial<NodeInput> = {}): NodeInput {
  return {
    id, label: id[0].toUpperCase() + id.slice(1), kind: "service", form: "card", icon: null, sub: "", items: [],
    description: `What ${id} does.`, files: [], parent: null, detail: null, place: null, ...extra,
  };
}

export function file(nodes: NodeInput[], edges: DiagramFile["views"][number]["edges"] = [], extra: Partial<DiagramFile> = {}): DiagramFile {
  return {
    schema: "archdraw/diagram@2",
    title: "Test system",
    views: [{ id: "overview", title: "Overview", caption: { title: "Test system", lede: "" }, nodes, edges, texts: [] }],
    ...extra,
  };
}

export const edge = (from: string, to: string, extra: Partial<{ label: string; style: "call" | "async" | "dep"; both: boolean; step: number | null; id: string }> = {}) =>
  ({ from, to, label: "", style: "call" as const, both: false, step: null, ...extra });

/**
 * An `@2` post view, as 0.1 added one (tests build `@2` files with a post from it): the LinkedIn
 * version of view `vid` added to the document, or the one it already has.
 * The post is found and named as an engine's is (diagram contract, Post-view identity): by
 * `postOf`, never by its id. Its components and connections get ids of their own: ids are
 * unique across the file.
 */
export function makeLinkedInView(doc: DiagramDocument, vid: string): { doc: DiagramDocument; view: string } {
  const asked = doc.views.find((v) => v.id === vid) ?? doc.views[0];
  const src = doc.views.find((v) => v.id === postSource(doc, asked.id)) ?? asked;
  const id = postViewId(doc, src.id);
  if (doc.views.some((v) => v.id === id)) return { doc, view: id };
  if (doc.views.length >= LIMITS.views) throw new Error(`A drawing holds at most ${LIMITS.views} views`);
  const used = allIds(doc);
  const fresh = (base: string) => {
    const root = slugify(base).slice(0, 56) || "part";
    let x = root;
    for (let i = 2; used.has(x); i++) x = `${root}-${i}`;
    used.add(x);
    return x;
  };
  const laid = arrangeForFeed(src);
  const ren = new Map(laid.nodes.map((n) => [n.id, fresh(`${n.id}-li`)]));
  const view: DiagramView = {
    id,
    title: (src.id === doc.views[0].id ? "LinkedIn" : `${src.title} · LinkedIn`).slice(0, LIMITS.viewTitle),
    caption: { ...src.caption },
    // The version is the post of its source (diagram contract, Post-view identity).
    postOf: src.postOf ?? src.id,
    nodes: laid.nodes.map((n) => ({ ...n, id: ren.get(n.id)! })),
    edges: laid.edges.map((e) => ({ ...e, id: fresh("li-e"), from: ren.get(e.from)!, to: ren.get(e.to)! })),
    texts: [],
  };
  return { doc: { ...doc, views: [...doc.views, view] }, view: id };
}
