/**
 * The overview and the LinkedIn post as one view list: the shape the editor and the run pipeline
 * read until each channel has its own tab (#29, #30). Pure (invariant 4).
 */
import { applyChannel, joinChannel, joinView, type ApplyOptions, type ApplyResult } from "./channels";
import type { Document3 } from "./file3";
import type { DiagramDocument, DiagramView } from "./model";

/**
 * The overview channel's views, then the LinkedIn view with a `postOf` naming the overview's
 * first view; each LinkedIn part carries its facts as `from` too, as a post's parts did.
 */
export function joinDrawing(doc: Document3): DiagramDocument {
  const d = joinChannel(doc, "overview");
  const post = doc.channels.linkedin.views[0];
  if (post) {
    const v = joinView(doc, "linkedin", post);
    d.views.push({ ...v, nodes: v.nodes.map((n) => ({ ...n, from: [...(n.facts ?? [])] })) });
  }
  return d;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Split a new state of `joinDrawing`'s view list back. Views with a `postOf` are the LinkedIn
 * channel (a new post wins over the old one); the others are the overview. Only a channel whose
 * views changed is applied, so the post never writes back the text the overview just changed. A
 * post part without `facts` takes them from its `from`.
 */
export function applyDrawing(doc: Document3, next: DiagramDocument, o: ApplyOptions = {}): ApplyResult {
  const before = joinDrawing(doc);
  const oldPost = before.views.find((v) => v.postOf) ?? null;
  const posts = next.views.filter((v) => v.postOf);
  const post = posts.find((v) => v.id !== oldPost?.id) ?? posts[0] ?? null;
  const overview = next.views.filter((v) => !v.postOf);
  const fields = (d: DiagramDocument) => ({ title: d.title, theme: d.theme, requests: d.requests, warnings: d.warnings, engine: d.engine, showSteps: d.showSteps });

  let cur = doc;
  if (!same(overview, before.views.filter((v) => !v.postOf)) || !same(fields(next), fields(before))) {
    const r = applyChannel(cur, "overview", { views: overview, ...fields(next) }, o);
    if (!r.ok) return r;
    cur = r.doc;
  }
  // The steps switch belongs to the overview here (the current channel), never to the post as well.
  if (!same(post, oldPost)) {
    const known = new Set(cur.facts.components.map((c) => c.id));
    const views: DiagramView[] = post ? [{
      ...post, postOf: null,
      // A part the editor added names no fact: it is new content and adds one (diagram contract, Edits).
      nodes: post.nodes.map((n) => ({ ...n, facts: n.facts ?? (n.from?.length ? n.from.filter((f) => known.has(f)) : undefined) })),
    }] : [];
    const r = applyChannel(cur, "linkedin", { views, ...(post ? {} : { showSteps: false }) }, o);
    if (!r.ok) return r;
    cur = r.doc;
  }
  return { ok: true, doc: cur };
}
