import {
  COMPACT, contentBox, edgesOverParts, GROUP, INSIDE, LABEL, labelWidth, layoutRects, measureNode, measureText, postOf, styleOf, textStyle,
  routeEdges, viewBounds, type EdgeRoute, type MeasureOptions, type Rect,
} from "../geometry";
import { CARD_SHAPE, COMPACT_SHAPE, OUTLINE, shapeGeometry, shapeOf, type PartShape } from "../shapes";
import { iconOf, KINDS, type DiagramEdge, type DiagramNode, type DiagramText, type DiagramView, type Kind } from "../model";
import { FONT_MONO, ICON_PATHS, mix, type Palette } from "../theme";
import { widthOf } from "../text";

/**
 * SVG markup of a view's drawing, shared by the editor canvas and every export
 * (invariant 5). Plain shapes and text: no foreignObject, no script.
 */

/**
 * Text as XML character data or an attribute value. Characters XML 1.0 forbids (C0 controls other
 * than tab, LF and CR; lone surrogates; U+FFFE and U+FFFF) are dropped, so every export parses.
 */
export const esc = (s: string) =>
  s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  // The AI agent's outline runs from its kind colour to the agent end colour; a cylinder's rims fade over the middle third.
  out.push(`<linearGradient id="${prefix}-agent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P.kinds.llm}"/><stop offset="1" stop-color="${P.agentEnd}"/></linearGradient>`);
  const rim = mix(P.kinds.data, P.line2, 0.55);
  out.push(`<linearGradient id="${prefix}-rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${rim}"/><stop offset="0.33" stop-color="${rim}" stop-opacity="0"/><stop offset="0.67" stop-color="${rim}" stop-opacity="0"/><stop offset="1" stop-color="${rim}"/></linearGradient>`);
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

export type { Shape } from "../shapes";
export { shapeOf } from "../shapes";

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

/** A connection's trace over a part it passes behind (diagram contract, Traces): its path, colour and dash. */
export interface Trace { edge: string; d: string; stroke: string; dash: string }
export interface NodeMarkupOptions extends MarkupOptions, MeasureOptions { prefix?: string; traces?: Trace[] }

/** A connection's stroke and dash as `edgeMarkup` draws it: its gradient while in kind colours, else the neutral colour. */
export const strokeOf = (e: DiagramEdge, tone: Tone, prefix: string, P: Palette) => (tone === "kind" ? `url(#${prefix}-g-${e.id})` : P.edge);
export const dashOf = (e: DiagramEdge) => (e.style === "async" ? ` stroke-dasharray="6 5"` : e.style === "dep" ? ` stroke-dasharray="2 5" stroke-linecap="round"` : "");

/**
 * The traces of every part (diagram contract, Traces): each connection the layout report lists over a part is drawn
 * again over it. `toneOf` gives each connection's tone (the editor's focus colours some).
 */
export function tracesOf(view: Pick<DiagramView, "nodes" | "edges">, rects: Map<string, Rect>, routes: Map<string, EdgeRoute>, P: Palette, prefix: string, tone: (e: DiagramEdge) => Tone = (e) => toneOf(e)): Map<string, Trace[]> {
  const out = new Map<string, Trace[]>();
  const byId = new Map(view.edges.map((e) => [e.id, e]));
  for (const { edge, node } of edgesOverParts(view, rects, routes)) {
    const e = byId.get(edge)!, r = routes.get(edge)!;
    const list = out.get(node) ?? [];
    list.push({ edge, d: r.d, stroke: strokeOf(e, tone(e), prefix, P), dash: dashOf(e) });
    out.set(node, list);
  }
  return out;
}

/** A part's traces, clipped to its box: thin, faint, no glow and no arrowhead. */
function traceMarkup(r: Rect, traces: Trace[] | undefined): string {
  if (!traces?.length) return "";
  // A viewport of the part's box in the drawing's own coordinates clips the whole path to it, and keeps the part's
  // box its own: a clip-path would leave the whole path in the part's bounding box (editor and export measure it).
  const box = `x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"`;
  return `<svg class="traces" ${box} viewBox="${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)}" overflow="hidden" pointer-events="none">` +
    traces.map((t) => `<path class="trace" data-edge-of="${esc(t.edge)}" d="${t.d}" fill="none" stroke="${t.stroke}" stroke-width="1" opacity="0.25"${t.dash}/>`).join("") + "</svg>";
}

/**
 * What an outline draws over its body in the kind colour (diagram contract, Shapes): the service's rule, the
 * avatar, the title bar, the port's dots, the agent's inner outline and spark, the pulse, the cylinder's lid,
 * deeper slab and rims. Every mark lies inside the part's box but the port's dots, centred on its points.
 */
function shapeMarks(shape: PartShape, compact: boolean, post: boolean, r: Rect, front: Rect, P: Palette, K: string, prefix: string, detail: boolean): string {
  const s = post ? 1 : 0, mark = mix(K, P.line2, 0.55), out: string[] = [];
  const pe = ` pointer-events="none"`;
  switch (shape) {
    case "card":
      out.push(compact
        ? `<rect class="shape-mark" x="${n(r.x + 1)}" y="${n(r.y + 10)}" width="3" height="${n(Math.max(0, r.h - 20))}" rx="1.5" fill="${K}"${pe}/>`
        : `<rect class="shape-mark" x="${n(r.x + 12)}" y="${n(r.y + 1)}" width="${n(Math.max(0, r.w - 24))}" height="3" rx="1.5" fill="${K}"${pe}/>`);
      break;
    case "person": {
      const a = compact ? r.h / 2 : OUTLINE.avatar[s] / 2, cx = compact ? r.x + a : r.x + r.w / 2, cy = r.y + a;
      out.push(`<circle class="shape-mark" cx="${n(cx)}" cy="${n(cy)}" r="${n(a - 0.5)}" fill="${P.surface}" stroke="${mark}" stroke-width="1"${pe}/>`);
      out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(a - 0.5)}" fill="url(#${prefix}-tint-actor)"${pe}/>`);
      break;
    }
    case "window": {
      const bar = compact ? OUTLINE.compactTitleBar : OUTLINE.titleBar[s], R = OUTLINE.rad;
      const cut = (h: number) => (h >= R ? 0 : R - Math.sqrt(R * R - (R - h) * (R - h)));
      const d = bar >= R
        ? `M${n(r.x)},${n(r.y + bar)} V${n(r.y + R)} A${R},${R} 0 0 1 ${n(r.x + R)},${n(r.y)} H${n(r.x + r.w - R)} A${R},${R} 0 0 1 ${n(r.x + r.w)},${n(r.y + R)} V${n(r.y + bar)} Z`
        : `M${n(r.x + cut(bar))},${n(r.y + bar)} A${R},${R} 0 0 1 ${n(r.x + R)},${n(r.y)} H${n(r.x + r.w - R)} A${R},${R} 0 0 1 ${n(r.x + r.w - cut(bar))},${n(r.y + bar)} Z`;
      out.push(`<path class="shape-mark" d="${d}" fill="${K}" fill-opacity="0.16"${pe}/>`);
      if (!compact) {
        for (let i = 0; i < 3; i++) out.push(`<circle cx="${n(r.x + OUTLINE.dotLeft + i * OUTLINE.dotGap)}" cy="${n(r.y + bar / 2)}" r="${OUTLINE.dotR}" fill="${K}" opacity="0.75"${pe}/>`);
        const cw = r.w * OUTLINE.capsuleW, ch = Math.min(OUTLINE.capsuleH, bar - 2);
        out.push(`<rect x="${n(r.x + (r.w - cw) / 2)}" y="${n(r.y + (bar - ch) / 2)}" width="${n(cw)}" height="${n(ch)}" rx="${n(ch / 2)}" fill="${P.surface}" opacity="0.85"${pe}/>`);
      }
      break;
    }
    case "port": {
      const dot = compact ? OUTLINE.compactPortDot : OUTLINE.portDot;
      // Each dot sits on its point, inside the box, so the part measures as its box.
      for (const x of [r.x + dot, r.x + r.w - dot]) out.push(`<circle class="shape-mark" cx="${n(x)}" cy="${n(r.y + r.h / 2)}" r="${dot}" fill="${K}"${pe}/>`);
      break;
    }
    case "agent": {
      const i = compact ? OUTLINE.compactAgentInset : OUTLINE.agentInset;
      out.push(`<path class="shape-mark" d="${roundedRectPath({ x: r.x + i, y: r.y + i, w: r.w - 2 * i, h: r.h - 2 * i }, Math.max(1, OUTLINE.rad - i))}" fill="none" stroke="${K}" stroke-width="1" opacity="0.35"${pe}/>`);
      const sz = compact ? OUTLINE.compactSpark : OUTLINE.spark, at = compact ? OUTLINE.compactSparkIn : OUTLINE.sparkIn;
      // With the open mark there, the spark moves left of it.
      const right = detail ? front.x + front.w - 8 - INSIDE - 6 : r.x + r.w - at;
      out.push(iconMarkup("spark", right - sz, compact ? r.y + at : r.y + at, sz, K, 1.6));
      break;
    }
    case "pulse": {
      const b = compact ? COMPACT_SHAPE.pulse.insets[2] : CARD_SHAPE.pulse[post ? "post" : "plain"][2];
      const yc = r.y + r.h - b, base = r.y + r.h - Math.max(3, b * 0.35), tip = yc + 2, sx = r.x + r.w * 0.6, half = compact ? 4 : 6;
      const x0 = r.x + OUTLINE.rad, x1 = r.x + r.w - OUTLINE.rad;
      const line = `M${n(x0)},${n(base)} H${n(sx - half)} L${n(sx)},${n(tip)} L${n(sx + half)},${n(base)} H${n(x1)}`;
      out.push(`<path d="${line} V${n(r.y + r.h - 1)} H${n(x0)} Z" fill="${K}" opacity="${P.tint}"${pe}/>`);
      out.push(`<path class="shape-mark" d="${line}" fill="none" stroke="${K}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"${pe}/>`);
      break;
    }
    case "store": {
      const ry = compact ? OUTLINE.compactLidRy : OUTLINE.lidRy[s], rx = r.w / 2, cx = r.x + rx, slabs = compact ? 2 : 3, sh = (r.h - 2 * ry) / slabs;
      const rim = (y: number, sweep: 0 | 1) => `A${n(rx)},${ry} 0 0 ${sweep} ${n(sweep ? r.x : r.x + r.w)},${n(y)}`;
      for (let i = 1; i < slabs; i += 2) {
        const y0 = r.y + ry + sh * i, y1 = y0 + sh;
        out.push(`<path d="M${n(r.x)},${n(y0)} A${n(rx)},${ry} 0 0 0 ${n(r.x + r.w)},${n(y0)} V${n(y1)} ${rim(y1, 1)} Z" fill="${K}" opacity="${P.tint}"${pe}/>`);
      }
      for (let i = 1; i < slabs; i++) {
        const y = r.y + ry + sh * i;
        out.push(`<path class="shape-mark" d="M${n(r.x)},${n(y)} A${n(rx)},${ry} 0 0 0 ${n(r.x + r.w)},${n(y)}" fill="none" stroke="url(#${prefix}-rim)" stroke-width="1"${pe}/>`);
      }
      out.push(`<ellipse class="shape-mark" cx="${n(cx)}" cy="${n(r.y + ry)}" rx="${n(rx - 0.5)}" ry="${n(ry - 0.5)}" fill="${K}" fill-opacity="${P.tint * 2}" stroke="${mark}" stroke-width="1"${pe}/>`);
      break;
    }
    default:
      break;
  }
  return out.join("");
}

/** The colour of a group's header as painted, made solid: the kind at 5 % over the surface at 60 % over the canvas (diagram contract, A group's name). */
export const headerColour = (P: Palette, kind: Kind): string => mix(P.kinds[kind], mix(P.surface, P.canvas, 0.6), 0.05);

/**
 * A group's head (diagram contract, A group's name): its icon, name, sub-line and open mark, drawn over the
 * connections and under the parts. The name and the sub-line stand on a halo in the header's colour, so a
 * line crossing the header is hidden only under the letters and 2 px round them; nothing is cut out of it.
 */
export function groupHeadMarkup(node: DiagramNode, r: Rect, P: Palette, o: NodeMarkupOptions = {}): string {
  const prefix = o.prefix ?? "ad";
  const { T } = styleOf(o.post);
  const K = P.kinds[node.kind];
  const halo = ` stroke="${headerColour(P, node.kind)}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;
  const out: string[] = [];
  const cy = r.y + GROUP.head / 2;
  out.push(iconMarkup(iconOf(node), r.x + GROUP.padHead, cy - GROUP.icon / 2, GROUP.icon, K, 1.75, `${prefix}-ig-${node.kind}`));
  const lx = r.x + GROUP.padHead + GROUP.icon + GROUP.gap;
  out.push(`<text${tid(o, "node-label")} class="label" x="${n(lx)}" y="${n(baseline(cy - 11, 22, T.title.size))}" text-anchor="start" font-size="${T.title.size}" font-weight="600"${track(T.title.size, -0.012)} fill="${P.ink}"${halo}>${esc(node.label)}</text>`);
  if (node.sub && o.subLines !== false) {
    const sx = lx + widthOf(node.label, T.title) + GROUP.gap;
    out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(sx)}" y="${n(baseline(cy - 9, 18, T.sub.size))}" font-size="${T.sub.size}" fill="${P.muted}"${halo}>${esc(node.sub)}</text>`);
  }
  if (node.detail) out.push(`<g${tid(o, "node-inside")} class="inside">${iconMarkup("stack", r.x + r.w - GROUP.padHead - INSIDE, cy - INSIDE / 2, INSIDE, P.soft, 1.75)}</g>`);
  return out.join("");
}

/**
 * One component's shapes and text inside its box `r` (from layoutRects). Groups draw only their
 * frame here (their head is `groupHeadMarkup`); their children are drawn as components of their own. Every other part draws
 * the outline of its kind and its icon, label and sub-line inside its shape's content box; no part
 * draws a row (ADR 0014).
 */
export function nodeMarkup(node: DiagramNode, r: Rect, P: Palette, o: NodeMarkupOptions = {}): string {
  const prefix = o.prefix ?? "ad";
  const post = !!o.post;
  const { T, CARD } = styleOf(o.post);
  const K = P.kinds[node.kind];
  const icon = iconOf(node);
  // The first rect is the component's box (ui contract: editor/export parity check).
  const out: string[] = [`<rect class="box" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="none" pointer-events="none"/>`];
  const box = measureNode(node, o);
  const inside = (x: number, y: number) => (node.detail ? `<g${tid(o, "node-inside")} class="inside">${iconMarkup("stack", x, y, INSIDE, P.soft, 1.75)}</g>` : "");
  const label = (text: string, x: number, y: number, anchor: "start" | "middle", size: number) =>
    `<text${tid(o, "node-label")} class="label" x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-size="${size}" font-weight="600"${track(size, -0.012)} fill="${P.ink}">${esc(text)}</text>`;

  if (node.form === "group") {
    // A group's frame, drawn under the connections; its head is `groupHeadMarkup`, drawn over them (ADR 0013).
    out.push(glowUnder(r, K, P, prefix, true));
    out.push(`<rect class="body" data-shape="group" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="18" fill="${P.surface}" fill-opacity="0.6" stroke="${mix(K, P.line2, 0.38)}" stroke-width="1"/>`);
    out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="18" fill="${K}" fill-opacity="0.05" pointer-events="none"/>`);
    return out.join("");
  }

  out.push(glowUnder(r, K, P, prefix));
  const shape = shapeOf(node) as PartShape, compact = node.form === "compact";
  const g = shapeGeometry(shape, compact, post, r);
  // The stack's cards behind, then the body: its stroke round-joined, so the stroke's box stays inside the part's.
  for (const d of g.back) out.push(`<path class="shape-back" d="${d}" fill="${P.surface}" stroke="${P.line2}" stroke-width="1" stroke-linejoin="round" pointer-events="none"/>`);
  const stroke = shape === "agent" ? `url(#${prefix}-agent)` : P.line2, width = shape === "agent" ? 1.5 : 1;
  // The agent's wider stroke is drawn a quarter pixel in, so it reaches no further past the box than every other 1 px outline (review R177-3).
  const d = shape === "agent" ? shapeGeometry(shape, compact, post, { x: r.x + 0.25, y: r.y + 0.25, w: r.w - 0.5, h: r.h - 0.5 }).d : g.d;
  out.push(`<path class="body" data-shape="${shape}" d="${d}" fill="${P.surface}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${shape === "external" ? ' stroke-dasharray="6 4"' : ""}/>`);
  out.push(`<path d="${d}" fill="url(#${prefix}-tint-${node.kind})" pointer-events="none"/>`);
  out.push(shapeMarks(shape, compact, post, r, g.front, P, K, prefix, !!node.detail));
  // Connections passing behind the part show as a trace over its outline, under its icon and text.
  out.push(traceMarkup(r, o.traces));
  const ig = `${prefix}-ig-${node.kind}`;
  const cb = contentBox(node, r, post);

  if (!compact) {
    // Card (and panel): icon, label lines and the sub-line row, top to bottom from the content box's top, centred across it.
    const cx = cb.x + cb.w / 2;
    let y = cb.y;
    if (shape === "person") {
      const a = OUTLINE.avatar[post ? 1 : 0] / 2, size = OUTLINE.avatarIcon[post ? 1 : 0];
      out.push(iconMarkup(icon, r.x + r.w / 2 - size / 2, r.y + a - size / 2, size, K, 1.6, ig));
    } else {
      out.push(iconMarkup(icon, cx - CARD.icon / 2, y, CARD.icon, K, 1.6, ig));
      y += CARD.icon + CARD.iconGap;
    }
    const spans = box.lines.map((l, i) => `<tspan x="${n(cx)}" y="${n(baseline(y + i * CARD.line, CARD.line, T.title.size))}">${esc(l)}${i < box.lines.length - 1 ? " " : ""}</tspan>`).join("");
    out.push(`<text${tid(o, "node-label")} class="label" text-anchor="middle" font-size="${T.title.size}" font-weight="600"${track(T.title.size, -0.012)} fill="${P.ink}">${spans}</text>`);
    y += box.lines.length * CARD.line;
    if (box.sub) out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(cx)}" y="${n(baseline(y, CARD.subLine, T.sub.size))}" text-anchor="middle" font-size="${T.sub.size}" fill="${P.muted}">${esc(box.sub)}</text>`);
    out.push(inside(g.front.x + g.front.w - 8 - INSIDE, g.front.y + 8));
    return out.join("");
  }

  // Compact: one row centred in the content box: icon (in the avatar for a person), label, then the sub-line at its right end.
  const cy = cb.y + cb.h / 2;
  let lx = cb.x;
  if (shape === "person") {
    const size = OUTLINE.compactAvatarIcon;
    out.push(iconMarkup(icon, r.x + r.h / 2 - size / 2, r.y + r.h / 2 - size / 2, size, K, 1.75, ig));
  } else {
    out.push(iconMarkup(icon, cb.x, cy - COMPACT.icon / 2, COMPACT.icon, K, 1.75, ig));
    lx += COMPACT.icon + COMPACT.gap;
  }
  out.push(label(box.lines[0], lx, baseline(cy - 10, 20, T.compactTitle.size), "start", T.compactTitle.size));
  const insideW = node.detail ? 8 + INSIDE : 0;
  if (box.sub) out.push(`<text${tid(o, "node-sub")} class="sub" x="${n(cb.x + cb.w - insideW)}" y="${n(baseline(cy - 9, 18, T.subMono.size))}" text-anchor="end" font-family="${esc(FONT_MONO)}" font-size="${T.subMono.size}" fill="${P.soft}">${esc(box.sub)}</text>`);
  out.push(inside(cb.x + cb.w - INSIDE, cy - INSIDE / 2));
  return out.join("");
}

/** `kind`: drawn in its kind colours; `neutral`: in the theme's one connection colour (diagram contract, Colour). */
export type Tone = "kind" | "neutral";
/** Exports colour only numbered connections; the editor also colours those in focus (ui contract). */
export const toneOf = (e: Pick<DiagramEdge, "step">, focus = false): Tone => (e.step !== null || focus ? "kind" : "neutral");

export interface EdgeMarkupOptions extends MarkupOptions {
  prefix?: string;
  /** Source and target kinds give the gradient and the arrowheads their colours when the tone is `kind`. */
  fromKind: Kind; toKind: Kind;
  /** Default: `kind` for a numbered connection, else `neutral`. */
  tone?: Tone;
}

/**
 * One connection (diagram contract, Colour): in the neutral colour with no glow, or in its kind colours — a
 * gradient from the source's hue to the target's, each arrowhead in the colour of the part it points at, a low
 * glow except on `dep`. One arrowhead at the target, one at each end of a two-way connection; nothing at a start.
 */
export function edgeMarkup(e: DiagramEdge, r: EdgeRoute, P: Palette, o: EdgeMarkupOptions): string {
  const prefix = o.prefix ?? "ad";
  const kind = (o.tone ?? toneOf(e)) === "kind";
  const a = kind ? P.kinds[o.fromKind] : P.edge, b = kind ? P.kinds[o.toKind] : P.edge;
  const gid = `${prefix}-g-${e.id}`, mid = `${prefix}-m-${e.id}`, sid = `${prefix}-s-${e.id}`;
  const x2 = r.p1.x === r.p0.x ? r.p1.x + 0.01 : r.p1.x;
  const stroke = kind ? `url(#${gid})` : P.edge;
  const defs =
    `<defs>${kind ? `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(r.p0.x)}" y1="${n(r.p0.y)}" x2="${n(x2)}" y2="${n(r.p1.y)}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` : ""}` +
    `<marker id="${mid}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="8.5" markerHeight="8.5" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1.4 8.8 5 1 8.6z" fill="${b}"/></marker>` +
    (e.both ? `<marker id="${sid}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="8.5" markerHeight="8.5" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1.4 8.8 5 1 8.6z" fill="${a}"/></marker>` : "") +
    `</defs>`;
  const dash = dashOf(e);
  const width = e.style === "dep" ? 1.9 : 1.75;
  const glow = !kind || e.style === "dep" ? "" : `<path class="glow" d="${r.d}" fill="none" stroke="${stroke}" stroke-width="7" opacity="${P.edgeGlow}"/>`;
  const start = e.both ? ` marker-start="url(#${sid})"` : "";
  return `${defs}${glow}<path class="line" d="${r.d}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash} marker-end="url(#${mid})"${start}/>`;
}

/** A label's box is edged in the `line` colour, or in its target part's kind colour while its line is coloured. */
export function labelMarkup(text: string, at: { x: number; y: number }, P: Palette, post = false, border = P.line): string {
  const { T } = styleOf(post);
  const w = labelWidth(text, post);
  return `<rect x="${n(at.x - w / 2)}" y="${n(at.y - LABEL.h / 2)}" width="${w}" height="${LABEL.h}" rx="6" fill="${P.surface}" stroke="${border}" stroke-width="1"/>` +
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
  o = { ...o, post: postOf(view, o), subLines: o.subLines ?? view.subLines !== false };
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
    const tone = toneOf(e), to = kind.get(e.to)!;
    const label = r.labelAt && e.label && o.labels !== false ? `<g data-edge-label="${id}" data-testid="edge-label-${id}">${labelMarkup(e.label, r.labelAt, P, o.post, tone === "kind" ? P.kinds[to] : P.line)}</g>` : "";
    const badge = o.steps && e.step !== null ? `<g data-step-badge="${id}" data-testid="step-badge-${id}">${badgeMarkup(e.step, r.badgeAt, P, prefix, o.post)}</g>` : "";
    const line = edgeMarkup(e, r, P, { prefix, fromKind: kind.get(e.from)!, toKind: to, tone });
    out.push(`<g data-edge-id="${id}" data-style="${e.style}" data-both="${e.both}" data-tone="${tone}">${line}${label}${badge}</g>`);
  }
  // Each group's head goes over the connections and under the parts (diagram contract, A group's name).
  for (const node of order.filter((x) => x.form === "group")) out.push(`<g data-group-head="${esc(node.id)}">${groupHeadMarkup(node, rects.get(node.id)!, P, { ...o, prefix })}</g>`);
  const traces = tracesOf(view, rects, routes, P, prefix);
  for (const node of order.filter((x) => x.form !== "group")) out.push(`<g data-node-id="${esc(node.id)}" data-kind="${node.kind}" data-form="${node.form}">${nodeMarkup(node, rects.get(node.id)!, P, { ...o, prefix, traces: traces.get(node.id) })}</g>`);
  for (const t of texts) out.push(`<g data-text-id="${esc(t.id)}" data-size="${t.size}">${textMarkup(t, P)}</g>`);
  return { body: out.join(""), defs: sharedDefs(P, prefix), bounds: viewBounds({ ...view, texts }, rects, routes, true, o.steps), rects, routes };
}

