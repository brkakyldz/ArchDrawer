import { bezierAt, countCrossings, measureNode, postOf, routeSamples, type EdgeRoute, type Point, type Rect } from "./geometry";
import { isPostView, type DiagramDocument } from "./model";
import { renderShare, type ShareImage, type ShareOptions } from "./export/share";

/**
 * The layout report (api contract, Layout report): what the drawn image actually is, measured
 * from the shared geometry, never from DOM estimates. The share dialog, the AI panel and a run's
 * result all read this one function.
 */
export interface LayoutReport {
  view: string;
  format: ShareOptions["format"];
  crossings: number;
  edgesOverParts: { edge: string; node: string }[];
  cutText: { id: string; field: string; text: string }[];
  overLimitText: { id: string; field: string; text: string; limit: number }[];
  smallestText: { inPlace: number; opened: number; level: "good" | "ok" | "warn"; names: { inPlace: number; opened: number } };
  counts: { parts: number; zones: number; connections: number };
  targets: { parts: number | null; zones: { min: number; max: number } | null; connections: number | null };
  /** The channel the run measured (set by the run). */
  channel?: string;
  longestConnection: number;
}

/** Story targets of a post (diagram contract, Brief and targets). Text limits are characters; title and side labels count words. */
export const STORY_LIMITS = { label: 28, sub: 28, chip: 22, lede: 140, titleWords: 9, sideLabelWords: 2 } as const;
const POST_TARGETS = { parts: 12, zones: { min: 0, max: 4 }, connections: 14 };
const DETAIL_TARGETS = { parts: null, zones: null, connections: null };

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const length = (pts: Point[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const finite = (v: number) => (Number.isFinite(v) ? v : 0);

export function layoutReport(doc: Pick<DiagramDocument, "views">, viewId: string, o: ShareOptions): LayoutReport {
  return reportOf(renderShare(doc, viewId, o), doc, viewId, o);
}

/** The report of an image already rendered with these options (the share dialog has one). */
export function reportOf(img: ShareImage, doc: Pick<DiagramDocument, "views">, viewId: string, o: ShareOptions): LayoutReport {
  const { view, rects, routes } = img.drawn;
  const whole = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  const post = isPostView(whole);
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const edges = view.edges.filter((e) => routes.has(e.id));
  const lines = new Map(edges.map((e) => [e.id, routeSamples(routes.get(e.id)!)]));

  const crossings = countCrossings(edges, routes);

  // A group's boundary alone never counts; a route over one of its unrelated members does.
  const edgesOverParts: LayoutReport["edgesOverParts"] = [];
  for (const e of edges) for (const n of view.nodes) {
    if (n.form === "group" || n.id === e.from || n.id === e.to) continue;
    const r = rects.get(n.id);
    if (r && lines.get(e.id)!.some((p) => inside(p, r))) edgesOverParts.push({ edge: e.id, node: n.id });
  }

  const cutText: LayoutReport["cutText"] = [];
  const style = postOf(view), subLines = view.subLines !== false;
  for (const n of view.nodes) {
    if (n.form === "group") continue;
    const m = measureNode(n, { subLines, post: style });
    const last = m.lines[m.lines.length - 1] ?? "";
    if (last.endsWith("…") && !n.label.trimEnd().endsWith("…")) cutText.push({ id: n.id, field: "label", text: n.label });
    // A sub-line the image does not draw is not cut text (review R177-1).
    if (subLines && n.sub && m.sub !== n.sub) cutText.push({ id: n.id, field: "sub", text: n.sub });
  }
  if (o.labels) for (const e of edges) if (e.label && !routes.get(e.id)!.labelAt) cutText.push({ id: e.id, field: "label", text: e.label });

  // Story targets are editorial: a post's text over them is reported, never shortened.
  const overLimitText: LayoutReport["overLimitText"] = [];
  if (post) {
    const over = (id: string, field: string, text: string, limit: number, size = text.length) => { if (size > limit) overLimitText.push({ id, field, text, limit }); };
    if (o.title) over(whole.id, "title", whole.caption.title, STORY_LIMITS.titleWords, words(whole.caption.title));
    if (o.lede) over(whole.id, "lede", whole.caption.lede, STORY_LIMITS.lede);
    for (const n of view.nodes) {
      over(n.id, "label", n.label, STORY_LIMITS.label);
      if (n.form === "group") continue;
      over(n.id, "sub", n.sub, STORY_LIMITS.sub);

    }
    for (const e of edges) {
      if (!e.label) continue;
      // Spine connections carry no sentence: any label on one is over a limit of 0.
      if (e.step !== null) overLimitText.push({ id: e.id, field: "label", text: e.label, limit: 0 });
      else over(e.id, "label", e.label, STORY_LIMITS.sideLabelWords, words(e.label));
    }
  }

  const boxes = view.nodes.map((n) => rects.get(n.id)).filter((r): r is Rect => !!r);
  const x0 = Math.min(...boxes.map((r) => r.x)), y0 = Math.min(...boxes.map((r) => r.y));
  const diagonal = boxes.length ? Math.hypot(Math.max(...boxes.map((r) => r.x + r.w)) - x0, Math.max(...boxes.map((r) => r.y + r.h)) - y0) : 0;
  // The routed curve's length.
  const routeLength = (r: EdgeRoute) => length(Array.from({ length: 65 }, (_, i) => bezierAt(r, i / 64)));
  const longest = Math.max(0, ...edges.map((e) => routeLength(routes.get(e.id)!)));

  const r = img.readability;
  const empty = !view.nodes.length;
  return {
    view: whole.id, format: o.format,
    crossings, edgesOverParts, cutText, overLimitText,
    smallestText: empty
      ? { inPlace: 0, opened: 0, level: "warn", names: { inPlace: 0, opened: 0 } }
      : { inPlace: finite(r.inPlace), opened: finite(r.opened), level: r.level, names: { inPlace: finite(r.names.inPlace), opened: finite(r.names.opened) } },
    counts: {
      parts: view.nodes.filter((n) => n.form !== "group").length,
      zones: view.nodes.filter((n) => n.form === "group" && (!n.parent || !byId.has(n.parent))).length,
      connections: edges.length,
    },
    // Only LinkedIn has count targets (ADR 0007).
    targets: post ? POST_TARGETS : DETAIL_TARGETS,
    longestConnection: diagonal > 0 && edges.length ? finite(longest / diagonal) : 0,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const px = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} px`;

/** The report in one short line (ui contract, Layout report). */
export function reportLine(r: LayoutReport): string {
  const against = (t: number | { min: number; max: number } | null) =>
    t === null ? "" : typeof t === "number" ? ` / ${t}` : ` / ${t.min}–${t.max}`;
  return [
    plural(r.crossings, "crossing"),
    `${plural(r.edgesOverParts.length, "connection")} over parts`,
    r.cutText.length ? `${r.cutText.length} cut` : "nothing cut",
    `${px(r.smallestText.inPlace)} in place`,
    `${plural(r.counts.parts, "part")}${against(r.targets.parts)}`,
    `${plural(r.counts.zones, "zone")}${against(r.targets.zones)}`,
    `${plural(r.counts.connections, "connection")}${against(r.targets.connections)}`,
    `longest ${r.longestConnection.toFixed(2)}`,
  ].join(" · ");
}

/** Text and target warnings, each naming the part or field and a change that fits (ui contract layout-report-warning). */
export function reportWarnings(r: LayoutReport, nameOf: (id: string) => string = (id) => id): string[] {
  const out: string[] = [];
  const field = (f: string) => (f === "sub" ? "sub-line" : f === "items" ? "held item" : f);
  for (const t of r.overLimitText) {
    if (t.limit === 0) out.push(`${nameOf(t.id)}: a main-path connection carries “${t.text}”; its number already tells the path, so leave the label empty.`);
    // Only the title and side connection labels are counted in words (STORY_LIMITS).
    else if (t.field === "title" || (t.field === "label" && t.limit === STORY_LIMITS.sideLabelWords)) out.push(`${nameOf(t.id)}: the ${t.field} “${t.text}” is over ${t.limit} words; say it in fewer.`);
    else out.push(`${nameOf(t.id)}: the ${field(t.field)} “${t.text}” is over ${t.limit} characters; shorten it.`);
  }
  for (const t of r.cutText) out.push(`${nameOf(t.id)}: the ${field(t.field)} “${t.text}” is cut in this image; shorten it${t.field === "items" ? " or hide what each part holds" : ""}.`);
  const { counts: c, targets: g } = r;
  if (g.parts !== null && c.parts > g.parts) out.push(`${plural(c.parts, "part")} against ${g.parts}: merge parts or leave detail out.`);
  if (g.zones && c.zones < g.zones.min) out.push(`${plural(c.zones, "zone")} against ${g.zones.min}–${g.zones.max}: group the parts into zones.`);
  if (g.zones && c.zones > g.zones.max) out.push(`${plural(c.zones, "zone")} against ${g.zones.min}–${g.zones.max}: merge zones.`);
  if (g.connections !== null && c.connections > g.connections) out.push(`${plural(c.connections, "connection")} against ${g.connections}: leave minor connections out.`);
  return out;
}
