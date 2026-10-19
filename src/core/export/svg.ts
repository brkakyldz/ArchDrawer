import {
  COMPACT, GROUP, INSIDE, LABEL, labelWidth, layoutRects, measureNode, measureText, postOf, styleOf, textStyle,
  routeEdges, viewBounds, type EdgeRoute, type MeasureOptions, type Rect,
} from "../geometry";
import { iconOf, KINDS, type DiagramEdge, type DiagramNode, type DiagramText, type DiagramView, type Kind } from "../model";
import { FONT_MONO, ICON_PATHS, mix, type Palette } from "../theme";
import { widthOf } from "../text";

/**
 * SVG markup of a view's drawing, shared by the editor canvas and every export
 * (invariant 5). Plain shapes and text: no foreignObject, no script.
 */

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Baseline of one line of `size` px text centred in a line box of height `lineH` starting at `top`. */
export const baseline = (top: number, lineH: number, size: number) => top + (lineH - size) / 2 + size * 0.76;
const track = (size: number, em: number | undefined) => (em ? ` letter-spacing="${n(size * em)}"` : "");

export interface MarkupOptions {
  /** Add the data-testid attributes of docs/contracts/ui.md (the editor). */
  testIds?: boolean;
}
const tid = (o: MarkupOptions, id: string) => (o.testIds ? ` data-testid="${id}"` : "");

/** Filters, gradients and markers every drawing uses. `prefix` keeps ids unique when several SVGs share a page. */
export function sharedDefs(P: Palette, prefix = "ad"): string {
  const out: string[] = [];
  out.push(`<filter id="${prefix}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>`);
  out.push(`<filter id="${prefix}-gglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>`);
  out.push(`<filter id="${prefix}-amb" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>`);
  out.push(`<filter id="${prefix}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>`);
  for (const k of KINDS) {
    out.push(`<filter id="${prefix}-ig-${k}" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="${P.kinds[k]}" flood-opacity="0.65"/></filter>`);
    out.push(`<radialGradient id="${prefix}-tint-${k}" cx="0" cy="0" r="1" gradientTransform="translate(0.5 0) scale(1.2 0.7)"><stop offset="0" stop-color="${P.kinds[k]}" stop-opacity="${P.tint}"/><stop offset="0.7" stop-color="${P.kinds[k]}" stop-opacity="0"/></radialGradient>`);
  }
  out.push(`<filter id="${prefix}-badge" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="${P.accent}" flood-opacity="0.5"/></filter>`);
  return out.join("");
}

export function iconMarkup(name: string, x: number, y: number, size: number, color: string, stroke = 1.75, glow: string | null = null): string {
  const s = size / 24;
  const paths = ICON_PATHS[name as keyof typeof ICON_PATHS] ?? ICON_PATHS.box;
  const f = glow ? ` filter="url(#${glow})"` : "";
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})" fill="none" stroke="${color}" stroke-width="${n(stroke)}" stroke-linecap="round" stroke-linejoin="round"${f}>${paths}</g>`;
}

function roundedRectPath(r: Rect, rad: number): string {
  const { x, y, w, h } = r;
  return `M${n(x + rad)},${n(y)} H${n(x + w - rad)} A${rad},${rad} 0 0 1 ${n(x + w)},${n(y + rad)} V${n(y + h - rad)} A${rad},${rad} 0 0 1 ${n(x + w - rad)},${n(y + h)} H${n(x + rad)} A${rad},${rad} 0 0 1 ${n(x)},${n(y + h - rad)} V${n(y + rad)} A${rad},${rad} 0 0 1 ${n(x + rad)},${n(y)} Z`;
}

/** Ambient shadow and kind glow under a box (DESIGN.md, Elevation): depth by light, not by lift. */
function glowUnder(r: Rect, color: string, P: Palette, prefix: string, group = false): string {
  if (group) {
    // A CSS box-shadow is not painted under its box; the group's body is translucent, so clip it out.
    const i = 24, o = 80, id = `${prefix}-gc-${Math.round(r.x)}-${Math.round(r.y)}`;
    const outer = `M${n(r.x - o)},${n(r.y - o)} h${n(r.w + o * 2)} v${n(r.h + o * 2)} h${n(-(r.w + o * 2))} Z`;
    return `<clipPath id="${id}"><path clip-rule="evenodd" d="${outer} ${roundedRectPath(r, 18)}"/></clipPath>` +
      `<rect x="${n(r.x + i)}" y="${n(r.y + i + 16)}" width="${n(Math.max(0, r.w - i * 2))}" height="${n(Math.max(0, r.h - i * 2))}" rx="18" fill="${color}" opacity="${P.glow}" filter="url(#${prefix}-gglow)" clip-path="url(#${id})"/>`;
  }
  const i = 12;
  return (
    `<rect x="${n(r.x + 10)}" y="${n(r.y + 6 + 10)}" width="${n(Math.max(0, r.w - 20))}" height="${n(Math.max(0, r.h - 20))}" rx="12" fill="${P.shadow}" opacity="0.18" filter="url(#${prefix}-amb)"/>` +
    `<rect class="kglow" x="${n(r.x + i)}" y="${n(r.y + i + 10)}" width="${n(Math.max(0, r.w - i * 2))}" height="${n(Math.max(0, r.h - i * 2))}" rx="12" fill="${color}" opacity="${P.glow}" filter="url(#${prefix}-glow)"/>`
  );
}

export interface NodeMarkupOptions extends MarkupOptions, MeasureOptions { prefix?: string }

/**
 * One component's shapes and text inside its box `r` (from layoutRects). Groups draw only their
 * frame and header; their children are drawn as components of their own.
 */
export function nodeMarkup(node: DiagramNode, r: Rect, P: Palette, o: NodeMarkupOptions = {}): string {
  const prefix = o.prefix ?? "ad";
  const { T, CARD, PANEL } = styleOf(o.post);
  const K = P.kinds[node.kind];
  const icon = iconOf(node);
  // The first rect is the component's box (ui contract: editor/export parity check).
  const out: string[] = [`<rect class="box" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="none" pointer-events="none"/>`];
  const box = measureNode(node, o);
  const inside = (x: number, y: number) => (node.detail ? `<g${tid(o, "node-inside")} class="inside">${iconMarkup("stack", x, y, INSIDE, P.soft, 1.75)}</g>` : "");
  const label = (text: string, x: number, y: number, anchor: "start" | "middle", size: number) =>
    `<text${tid(o, "node-label")} class="label" x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-size="${size}" font-weight="600"${track(size, -0.012)} fill="${P.ink}">${esc(text)}</text>`;

  if (node.form === "group") {
    out.push(glowUnder(r, K, P, prefix, true));
    out.push(`<rect class="body" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="18" fill="${P.surface}" fill-opacity="0.6" stroke="${mix(K, P.line2, 0.38)}" stroke-width="1"/>`);
    out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="18" fill="${K}" fill-opacity="0.05" pointer-events="none"/>`);
    const cy = r.y + GROUP.head / 2;
    out.push(iconMarkup(icon, r.x + GROUP.padHead, cy - GROUP.icon / 2, GROUP.icon, K, 1.75, `${prefix}-ig-${node.kind}`));
    const lx = r.x + GROUP.padHead + GROUP.icon + GROUP.gap;
    out.push(label(node.label, lx, baseline(cy - 11, 22, T.title.size), "start", T.title.size));
    if (node.sub) {
      const sx = lx + widthOf(node.label, T.title) + GROUP.gap;
      out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(sx)}" y="${n(baseline(cy - 9, 18, T.sub.size))}" font-size="${T.sub.size}" fill="${P.muted}">${esc(node.sub)}</text>`);
    }
    out.push(inside(r.x + r.w - GROUP.padHead - INSIDE, cy - INSIDE / 2));
    return out.join("");
  }

  out.push(glowUnder(r, K, P, prefix));
  out.push(`<rect class="body" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="12" fill="${P.surface}" stroke="${P.line2}" stroke-width="1"/>`);
  out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="12" fill="url(#${prefix}-tint-${node.kind})" pointer-events="none"/>`);
  const ig = `${prefix}-ig-${node.kind}`;

  if (node.form === "card") {
    const content = CARD.icon + CARD.iconGap + box.lines.length * CARD.line + (box.sub ? CARD.subLine : 0);
    let y = r.y + (r.h - content) / 2;
    out.push(iconMarkup(icon, r.x + r.w / 2 - CARD.icon / 2, y, CARD.icon, K, 1.6, ig));
    y += CARD.icon + CARD.iconGap;
    const cx = r.x + r.w / 2;
    const spans = box.lines.map((l, i) => `<tspan x="${n(cx)}" y="${n(baseline(y + i * CARD.line, CARD.line, T.title.size))}">${esc(l)}${i < box.lines.length - 1 ? " " : ""}</tspan>`).join("");
    out.push(`<text${tid(o, "node-label")} class="label" text-anchor="middle" font-size="${T.title.size}" font-weight="600"${track(T.title.size, -0.012)} fill="${P.ink}">${spans}</text>`);
    y += box.lines.length * CARD.line;
    if (box.sub) out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(cx)}" y="${n(baseline(y, CARD.subLine, T.sub.size))}" text-anchor="middle" font-size="${T.sub.size}" fill="${P.muted}">${esc(box.sub)}</text>`);
    out.push(inside(r.x + r.w - 8 - INSIDE, r.y + 8));
    return out.join("");
  }

  if (node.form === "compact") {
    const cy = r.y + r.h / 2;
    out.push(iconMarkup(icon, r.x + COMPACT.padX, cy - COMPACT.icon / 2, COMPACT.icon, K, 1.75, ig));
    const lx = r.x + COMPACT.padX + COMPACT.icon + COMPACT.gap;
    out.push(label(box.lines[0], lx, baseline(cy - 10, 20, T.compactTitle.size), "start", T.compactTitle.size));
    const insideW = node.detail ? 8 + INSIDE : 0;
    if (box.sub) out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(r.x + r.w - COMPACT.padX - insideW)}" y="${n(baseline(cy - 9, 18, T.subMono.size))}" text-anchor="end" font-family="${esc(FONT_MONO)}" font-size="${T.subMono.size}" fill="${P.soft}">${esc(box.sub)}</text>`);
    out.push(inside(r.x + r.w - COMPACT.padX - INSIDE, cy - INSIDE / 2));
    return out.join("");
  }

  // panel
  const top = r.y + PANEL.padTop + 1;
  out.push(iconMarkup(icon, r.x + PANEL.padX, top + 1, PANEL.icon, K, 1.75, ig));
  const lx = r.x + PANEL.padX + PANEL.icon + PANEL.gap;
  out.push(label(box.lines[0], lx, baseline(top, PANEL.titleLine, T.title.size), "start", T.title.size));
  let y = top + PANEL.titleLine;
  if (box.sub) {
    out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(lx)}" y="${n(baseline(y, PANEL.subLine, T.sub.size))}" font-size="${T.sub.size}" fill="${P.muted}">${esc(box.sub)}</text>`);
    y += PANEL.subLine;
  }
  if (box.items.length) {
    y += PANEL.listGap;
    const iw = r.w - PANEL.padX * 2;
    box.items.forEach((t, i) => {
      const iy = y + i * (PANEL.itemH + PANEL.itemGap);
      out.push(`<g${tid(o, "node-item")} class="item" data-index="${i}"><rect x="${n(r.x + PANEL.padX + 0.5)}" y="${n(iy + 0.5)}" width="${n(iw - 1)}" height="${PANEL.itemH - 1}" rx="7" fill="${P.surface2}" stroke="${P.line}" stroke-width="1"/>` +
        `<text x="${n(r.x + PANEL.padX + PANEL.itemPad + 1)}" y="${n(baseline(iy, PANEL.itemH, T.item.size))}" font-size="${T.item.size}" fill="${P.ink}">${esc(t)}</text></g>`);
    });
  }
  out.push(inside(r.x + r.w - 8 - INSIDE, r.y + 8));
  return out.join("");
}

export interface EdgeMarkupOptions extends MarkupOptions {
  prefix?: string;
  /** Source and target kinds give the gradient and the arrowheads their colours. */
  fromKind: Kind; toKind: Kind;
}

/** One connection: gradient stroke from the source's hue to the target's, a low glow, start ring or two arrowheads. */
export function edgeMarkup(e: DiagramEdge, r: EdgeRoute, P: Palette, o: EdgeMarkupOptions): string {
  const prefix = o.prefix ?? "ad";
  const a = P.kinds[o.fromKind], b = P.kinds[o.toKind];
  const gid = `${prefix}-g-${e.id}`, mid = `${prefix}-m-${e.id}`, sid = `${prefix}-s-${e.id}`;
  const x2 = r.p1.x === r.p0.x ? r.p1.x + 0.01 : r.p1.x;
  const defs =
    `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(r.p0.x)}" y1="${n(r.p0.y)}" x2="${n(x2)}" y2="${n(r.p1.y)}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    `<marker id="${mid}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="8.5" markerHeight="8.5" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1.4 8.8 5 1 8.6z" fill="${b}"/></marker>` +
    (e.both ? `<marker id="${sid}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="8.5" markerHeight="8.5" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1.4 8.8 5 1 8.6z" fill="${a}"/></marker>` : "") +
    `</defs>`;
  const dash = e.style === "async" ? ` stroke-dasharray="6 5"` : e.style === "dep" ? ` stroke-dasharray="1.5 4.5" stroke-linecap="round"` : "";
  const width = e.style === "dep" ? 1.6 : 1.75;
  const glow = e.style === "dep" ? "" : `<path class="glow" d="${r.d}" fill="none" stroke="url(#${gid})" stroke-width="7" opacity="${P.edgeGlow}"/>`;
  const start = e.both ? ` marker-start="url(#${sid})"` : "";
  const ring = e.both ? "" : `<circle cx="${n(r.p0.x + NORMAL4[r.side0][0] * 4)}" cy="${n(r.p0.y + NORMAL4[r.side0][1] * 4)}" r="3.6" fill="${P.surface}" stroke="${a}" stroke-width="1.6"/>`;
  return `${defs}${glow}<path class="line" d="${r.d}" fill="none" stroke="url(#${gid})" stroke-width="${width}"${dash} marker-end="url(#${mid})"${start}/>${ring}`;
}
const NORMAL4 = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] } as const;

export function labelMarkup(text: string, at: { x: number; y: number }, P: Palette, post = false): string {
  const { T } = styleOf(post);
  const w = labelWidth(text, post);
  return `<rect x="${n(at.x - w / 2)}" y="${n(at.y - LABEL.h / 2)}" width="${w}" height="${LABEL.h}" rx="6" fill="${P.surface}" stroke="${P.line}" stroke-width="1"/>` +
    `<text x="${n(at.x)}" y="${n(baseline(at.y - LABEL.h / 2, LABEL.h, T.edge.size))}" text-anchor="middle" font-size="${T.edge.size}" font-weight="500" fill="${P.muted}">${esc(text)}</text>`;
}

export function badgeMarkup(step: number, at: { x: number; y: number }, P: Palette, prefix = "ad", post = false): string {
  const { BADGE, T } = styleOf(post);
  // The 3 px canvas ring that parts the badge from its line is the circle's own stroke, painted under
  // the fill: the badge's box stays its radius (diagram contract, Post style), the look is unchanged.
  return `<circle cx="${n(at.x)}" cy="${n(at.y)}" r="${BADGE.r}" fill="${P.accent}" stroke="${P.canvas}" stroke-width="6" paint-order="stroke" filter="url(#${prefix}-badge)"/>` +
    `<text x="${n(at.x)}" y="${n(baseline(at.y - BADGE.r, BADGE.r * 2, T.badge.size))}" text-anchor="middle" font-size="${T.badge.size}" font-weight="600" fill="${P.accentInk}">${step}</text>`;
}

/** Free text: plain text in the ink colour, top-left at (x, y), one line per newline (diagram contract, Text). */
export function textMarkup(t: DiagramText, P: Palette): string {
  const st = textStyle(t.size);
  const m = measureText(t);
  const spans = m.lines.map((l, i) => `<tspan x="${n(t.x)}" y="${n(baseline(t.y + i * st.line, st.line, st.size))}">${esc(l)}</tspan>`).join("");
  return `<text font-size="${st.size}" font-weight="${st.weight}"${st.tracking ? ` letter-spacing="${n(st.size * st.tracking)}"` : ""} fill="${P.ink}" xml:space="preserve">${spans}</text>`;
}

export interface DrawOptions extends MeasureOptions {
  labels?: boolean;
  steps?: boolean;
  texts?: boolean;
  prefix?: string;
}

export interface Drawing {
  /** Markup of the drawing in canvas coordinates (no <svg> root, no background). */
  body: string;
  defs: string;
  bounds: Rect;
  rects: Map<string, Rect>;
  routes: Map<string, EdgeRoute>;
}

/** Groups outermost first, so children draw on top of their frames. */
export function drawOrder(view: Pick<DiagramView, "nodes">): DiagramNode[] {
  const byId = new Map(view.nodes.map((x) => [x.id, x]));
  const depth = (x: DiagramNode) => { let d = 0; const seen = new Set<string>(); for (let p = x.parent; p && byId.has(p) && !seen.has(p); p = byId.get(p)!.parent) { seen.add(p); d++; } return d; };
  return [...view.nodes].sort((a, b) => (a.form === "group" ? 0 : 1) - (b.form === "group" ? 0 : 1) || depth(a) - depth(b));
}

/** The whole drawing of a view: frames, connections, components, labels, badges, texts. */
export function drawView(view: DiagramView, P: Palette, o: DrawOptions = {}): Drawing {
  const prefix = o.prefix ?? "ad";
  o = { ...o, post: postOf(view, o) };
  const rects = layoutRects(view, o);
  const texts = o.texts === false ? [] : view.texts;
  const avoid = texts.map((t) => ({ x: t.x, y: t.y, ...measureText(t) }));
  const routes = routeEdges(view, rects, { labels: o.labels, avoid, post: o.post });
  const kind = new Map(view.nodes.map((x) => [x.id, x.kind]));
  const out: string[] = [];
  const order = drawOrder(view);
  for (const node of order.filter((x) => x.form === "group")) out.push(`<g data-node-id="${esc(node.id)}" data-kind="${node.kind}" data-form="group">${nodeMarkup(node, rects.get(node.id)!, P, { ...o, prefix })}</g>`);
  // One group per drawn connection holds its line, its label and its badge (ui contract, The share image);
  // labels and badges sit in free spots, so drawing them before the parts covers nothing.
  for (const e of view.edges) {
    const r = routes.get(e.id);
    if (!r) continue;
    const id = esc(e.id);
    const label = r.labelAt && e.label && o.labels !== false ? `<g data-edge-label="${id}" data-testid="edge-label-${id}">${labelMarkup(e.label, r.labelAt, P, o.post)}</g>` : "";
    const badge = o.steps && e.step !== null ? `<g data-step-badge="${id}" data-testid="step-badge-${id}">${badgeMarkup(e.step, r.badgeAt, P, prefix, o.post)}</g>` : "";
    out.push(`<g data-edge-id="${id}" data-style="${e.style}" data-both="${e.both}">${edgeMarkup(e, r, P, { prefix, fromKind: kind.get(e.from)!, toKind: kind.get(e.to)! })}${label}${badge}</g>`);
  }
  for (const node of order.filter((x) => x.form !== "group")) out.push(`<g data-node-id="${esc(node.id)}" data-kind="${node.kind}" data-form="${node.form}">${nodeMarkup(node, rects.get(node.id)!, P, { ...o, prefix })}</g>`);
  for (const t of texts) out.push(`<g data-text-id="${esc(t.id)}" data-size="${t.size}">${textMarkup(t, P)}</g>`);
  return { body: out.join(""), defs: sharedDefs(P, prefix), bounds: viewBounds({ ...view, texts }, rects, routes, true, o.steps), rects, routes };
}

