import { layoutRects, measureNode, measureText, postOf, type EdgeRoute, type Rect } from "../geometry";
import { isPostView, KIND_INFO, type DiagramDocument, type DiagramNode, type DiagramView, type Kind, type Theme } from "../model";
import { textWidth, wrapText } from "../text";
import { FONT_SANS, PALETTES, type Palette } from "../theme";
import { baseline, drawView, esc } from "./svg";
import { placedForSwitches } from "../layout";

/**
 * The share image (docs/contracts/ui.md § Share): the view's drawing fitted into a
 * format's frame, with a caption that belongs to it like a figure's, and no product mark. Pure:
 * the editor's preview, its downloads, `archdrawer svg` and `export.svg` all call this.
 */

export const FORMAT_IDS = ["linkedin", "readme", "slide", "square", "feed"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];
export interface Format {
  id: FormatId; name: string; w: number; h: number;
  /** How wide the image is shown where it lands, in CSS px, and where that is, as a sentence says it. */
  seen: number; where: string;
  /** Margin, and caption title / lede / key sizes, in image px. */
  m: number; t: number; l: number; kz: number;
}
export const FORMATS: Record<FormatId, Format> = {
  linkedin: { id: "linkedin", name: "Wide LinkedIn post", w: 1620, h: 1080, seen: 552, where: "in the LinkedIn feed", m: 24, t: 36, l: 28, kz: 27 },
  readme: { id: "readme", name: "README", w: 1600, h: 900, seen: 880, where: "in a GitHub README", m: 32, t: 32, l: 20, kz: 18 },
  slide: { id: "slide", name: "Slide", w: 1920, h: 1080, seen: 1280, where: "on a projected slide", m: 40, t: 38, l: 24, kz: 21 },
  square: { id: "square", name: "Square post", w: 1080, h: 1080, seen: 552, where: "in a feed", m: 24, t: 30, l: 19, kz: 18 },
  feed: { id: "feed", name: "LinkedIn feed", w: 1080, h: 1350, seen: 552, where: "in the LinkedIn feed", m: 32, t: 36, l: 22, kz: 21 },
};

export interface ShareOptions {
  format: FormatId;
  theme: Theme;
  title: boolean; lede: boolean; items: boolean; steps: boolean; labels: boolean; legend: boolean; texts: boolean;
  /** Base64 woff2 of Geist and Geist Mono, embedded so a downloaded file renders the same anywhere. */
  fonts?: { sans: string; mono: string } | null;
  /** Share only these components (a group with all it holds) and the connections between them. */
  parts?: string[] | null;
}

/** Text the image draws shorter than it is, with `…` (ui contract, share-clipped). */
export interface Shortened { id: string; label: string; text: string }

/** Every component text a view's forms shorten: labels, sub-lines and held items (when shown). */
export function shortenedIn(view: Pick<DiagramView, "nodes"> & { id?: string; postOf?: string | null }, o: { items: boolean }): Shortened[] {
  const out: Shortened[] = [];
  const post = postOf(view);
  for (const n of view.nodes) {
    if (n.form === "group") continue;
    const b = measureNode(n, { items: o.items, post });
    const last = b.lines[b.lines.length - 1] ?? "";
    if (last.endsWith("…") && !n.label.trimEnd().endsWith("…")) out.push({ id: n.id, label: n.label, text: n.label });
    if (n.sub && b.sub !== n.sub) out.push({ id: n.id, label: n.label, text: n.sub });
    b.items.forEach((t, i) => { if (t !== n.items[i]) out.push({ id: n.id, label: n.label, text: n.items[i] }); });
  }
  return out;
}

/** The part of a view `ids` names: those components, everything inside the groups among them, and the connections between them. */
export function partOf(view: DiagramView, ids: readonly string[]): DiagramView {
  const keep = new Set<string>(ids.filter((id) => view.nodes.some((n) => n.id === id)));
  for (let grew = true; grew;) {
    grew = false;
    for (const n of view.nodes) if (n.parent && keep.has(n.parent) && !keep.has(n.id)) { keep.add(n.id); grew = true; }
  }
  return {
    ...view,
    nodes: view.nodes.filter((n) => keep.has(n.id)).map((n) => (n.parent && !keep.has(n.parent) ? { ...n, parent: null } : n)),
    edges: view.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    texts: [],
  };
}
/** The switches the share dialog offers. */
export type ShareSwitches = Pick<ShareOptions, "title" | "lede" | "items" | "steps" | "labels" | "legend" | "texts">;
export const SWITCH_PRESETS: Record<"simple" | "detailed" | "version", ShareSwitches> = {
  simple: { title: true, lede: true, items: false, steps: true, labels: false, legend: false, texts: true },
  detailed: { title: true, lede: false, items: true, steps: true, labels: true, legend: true, texts: true },
  version: { title: true, lede: true, items: true, steps: true, labels: true, legend: false, texts: true },
};
/** The switches a format starts with: the post's for a post view or the feed, Simple for Square, else Detailed. */
export const startSwitches = (format: FormatId, post: boolean): ShareSwitches =>
  ({ ...(post || format === "feed" ? SWITCH_PRESETS.version : format === "square" ? SWITCH_PRESETS.simple : SWITCH_PRESETS.detailed) });
export const DEFAULT_SHARE: Omit<ShareOptions, "theme"> = { format: "linkedin", title: true, lede: false, items: true, steps: true, labels: true, legend: true, texts: true };

/**
 * The readability meter (ui contract): the smallest component or zone name and the smallest
 * text of any kind actually drawn, in image px (`opened`) and as seen where it lands (`inPlace`).
 */
export interface Readability {
  level: "good" | "ok" | "warn"; inPlace: number; opened: number; names: { inPlace: number; opened: number };
  /** One plain sentence for the destination (SHARE-3); `detail` holds the numbers behind it. */
  text: string; detail: string;
}
export interface ShareImage {
  svg: string; width: number; height: number; scale: number; readability: Readability; kinds: Kind[]; shortened: Shortened[];
  /** Things the image left out that the options asked for (a key with no free corner). */
  notes: string[];
  /** What the drawing actually is: the view as drawn, its boxes and its routes (the layout report reads these). */
  drawn: { view: DiagramView; rects: Map<string, Rect>; routes: Map<string, EdgeRoute> };
}

const EM = 14; // the caption's base em (spacing), as in the demo
/** Caption and steps wrap onto as many lines as they need: nothing in them is cut short. */
const WHOLE = 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

interface Block { w: number; h: number; draw: (x: number, y: number) => string }

function textBlock(view: DiagramView, f: Format, o: ShareOptions, P: Palette, width: number): Block | null {
  const parts: { lines: string[]; size: number; line: number; weight: 400 | 600; color: string; gap: number; tracking: number }[] = [];
  if (o.title && view.caption.title) parts.push({ lines: wrapText(view.caption.title, f.t, width, 600, WHOLE, -0.02), size: f.t, line: f.t * 1.2, weight: 600, color: P.ink, gap: 0, tracking: -0.02 });
  if (o.lede && view.caption.lede) parts.push({ lines: wrapText(view.caption.lede, f.l, width, 400, WHOLE), size: f.l, line: f.l * 1.4, weight: 400, color: P.muted, gap: parts.length ? f.l * 0.3 : 0, tracking: 0 });
  if (!parts.length) return null;
  const h = parts.reduce((s, p) => s + p.gap + p.lines.length * p.line, 0);
  const w = Math.max(...parts.flatMap((p) => p.lines.map((l) => textWidth(l, p.size, p.weight, p.tracking))));
  return {
    w: Math.min(width, Math.ceil(w)), h,
    draw: (x, y) => {
      const out: string[] = [];
      let cy = y;
      for (const p of parts) {
        cy += p.gap;
        const spans = p.lines.map((l, i) => `<tspan x="${r1(x)}" y="${r1(baseline(cy + i * p.line, p.line, p.size))}">${esc(l)}</tspan>`).join("");
        out.push(`<text data-caption="${p.weight === 600 ? "title" : "lede"}" font-size="${p.size}" font-weight="${p.weight}"${p.tracking ? ` letter-spacing="${r1(p.size * p.tracking)}"` : ""} fill="${p.color}">${spans}</text>`);
        cy += p.lines.length * p.line;
      }
      return out.join("");
    },
  };
}

function keyBlock(kinds: Kind[], f: Format, P: Palette, width: number, align: "start" | "end"): Block {
  const kz = f.kz, dot = 0.55 * kz, gap = 0.5 * kz, hgap = 1.1 * kz, vgap = 0.4 * kz, line = kz * 1.45;
  const items = kinds.map((k) => ({ k, w: dot + gap + textWidth(KIND_INFO[k].label, kz) }));
  const rows: { k: Kind; w: number }[][] = [[]];
  let used = 0;
  for (const it of items) {
    const need = (rows[rows.length - 1].length ? hgap : 0) + it.w;
    if (rows[rows.length - 1].length && used + need > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1].length ? hgap : 0) + it.w;
    rows[rows.length - 1].push(it);
  }
  const rowW = rows.map((r) => r.reduce((s, it, i) => s + it.w + (i ? hgap : 0), 0));
  const w = Math.ceil(Math.max(...rowW));
  const h = rows.length * line + (rows.length - 1) * vgap;
  return {
    w, h,
    draw: (x, y) => {
      const out: string[] = [];
      rows.forEach((row, ri) => {
        let cx = align === "end" ? x + w - rowW[ri] : x;
        const cy = y + ri * (line + vgap);
        for (const it of row) {
          const c = P.kinds[it.k];
          out.push(`<g data-key="${it.k}"><circle cx="${r1(cx + dot / 2)}" cy="${r1(cy + line / 2)}" r="${r1(dot / 2)}" fill="${c}" filter="url(#sh-ig-${it.k})"/>` +
            `<text x="${r1(cx + dot + gap)}" y="${r1(baseline(cy, line, kz))}" font-size="${kz}" fill="${P.muted}">${esc(KIND_INFO[it.k].label)}</text></g>`);
          cx += it.w + hgap;
        }
      });
      return out.join("");
    },
  };
}

/** Panels without their items shrink around their own centre (ui contract, Share). */
function shrinkPanels(view: DiagramView): DiagramView {
  const full = layoutRects(view, { items: true });
  const bare = layoutRects(view, { items: false });
  return {
    ...view,
    nodes: view.nodes.map((n): DiagramNode => (n.form === "panel" ? { ...n, y: Math.round(n.y + (full.get(n.id)!.h - bare.get(n.id)!.h) / 2) } : n)),
  };
}

/**
 * The one change the readability sentence suggests (ui contract, readability): never one already
 * made. `null` when the image reads in place.
 */
export function suggestionFor(level: Readability["level"], s: { items: boolean; format: FormatId; linkedInVersion: boolean }): string | null {
  if (level === "good") return null;
  if (s.items) return "hiding what each part holds would help";
  if ((s.format === "feed" || s.format === "linkedin" || s.format === "square") && !s.linkedInVersion) return "the LinkedIn version would help";
  return "a larger format would help";
}

/** Font sizes of the texts in drawing markup, scaled by `k`: component and zone names, and every text. */
export function drawnSizes(body: string, k: number): { names: number[]; all: number[] } {
  const names: number[] = [], all: number[] = [];
  for (const m of body.matchAll(/<text\b([^>]*)>/g)) {
    const size = /font-size="([\d.]+)"/.exec(m[1]);
    if (!size) continue;
    const px = Number(size[1]) * k;
    all.push(px);
    if (/class="label"/.test(m[1])) names.push(px);
  }
  return { names, all };
}

export function readabilityOf(sizes: { names: number[]; all: number[] }, f: Format, s: { items: boolean; whole: DiagramView }): Readability {
  const least = (xs: number[]) => (xs.length ? Math.min(...xs) : 0);
  const opened = least(sizes.all), named = least(sizes.names);
  const seen = (px: number) => px * (f.seen / f.w);
  const inPlace = seen(opened), names = { inPlace: seen(named), opened: named };
  const level = sizes.all.length && names.inPlace >= 9 && inPlace >= 6.5 ? "good" : opened >= 8 ? "ok" : "warn";
  const hint = suggestionFor(level, {
    items: s.items, format: f.id, linkedInVersion: !!s.whole.postOf,
  });
  const said = {
    good: `The text is readable ${f.where} as it is`,
    ok: `The text is too small to read ${f.where} until the image is opened`,
    warn: `The text will be too small to read ${f.where}, even when the image is opened`,
  }[level];
  const text = sizes.all.length ? `${said}${hint ? `; ${hint}` : ""}.` : "The image has no text to read.";
  const detail = `Names ${names.inPlace.toFixed(1)} px and text ${inPlace.toFixed(1)} px ${f.where}, ${opened.toFixed(1)} px opened.`;
  return { level, inPlace, opened, names, text, detail };
}

/** The share image of one view, exactly the format's size. */
export function renderShare(doc: Pick<DiagramDocument, "views">, viewId: string, o: ShareOptions): ShareImage {
  const found = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  // An untouched lane view is laid out for this image's switches, a post for its orientation.
  const whole = placedForSwitches(found, { portrait: o.format !== "linkedin", labels: o.labels, post: isPostView(found) });
  const source = o.parts?.length ? partOf(whole, o.parts) : whole;
  const f = FORMATS[o.format];
  // Both post formats put title and description across the top and nothing under the drawing:
  // no steps list, takeaway or key strip (ui contract, The share image).
  const post = o.format === "feed" || o.format === "linkedin";
  const P = PALETTES[o.theme];
  let view: DiagramView = source;
  const notes: string[] = [];
  const items = o.items;
  if (!items) view = shrinkPanels(view);
  const drawing = drawView(view, P, { items, labels: o.labels, steps: o.steps, texts: o.texts, prefix: "sh" });
  const b = drawing.bounds.w > 0 ? drawing.bounds : { x: 0, y: 0, w: 1, h: 1 };
  const kinds: Kind[] = [];
  for (const n of view.nodes) if (!kinds.includes(n.kind)) kinds.push(n.kind);

  const fit = (bottom: number, top = Math.round(f.m * 0.8)) => {
    const aw = f.w - f.m * 2, ah = f.h - top - bottom;
    const k = Math.max(0.05, Math.min(aw / b.w, ah / b.h, 1.6));
    return { k, tx: f.m + (aw - b.w * k) / 2 - b.x * k, ty: top + (ah - b.h * k) / 2 - b.y * k };
  };
  let place = fit(Math.round(f.m * 0.8));
  const solid = () => {
    const rs: Rect[] = [...drawing.rects.values()];
    if (o.texts) for (const t of view.texts) rs.push({ x: t.x, y: t.y, ...measureText(t) });
    return rs.map((r) => ({ x: r.x * place.k + place.tx - 16, y: r.y * place.k + place.ty - 16, w: r.w * place.k + 32, h: r.h * place.k + 32 }));
  };
  const hits = (c: Rect) => solid().some((r) => c.x < r.x + r.w && c.x + c.w > r.x && c.y < r.y + r.h && c.y + c.h > r.y);

  const caption: string[] = [];
  const wantText = (o.title && !!source.caption.title) || (o.lede && !!source.caption.lede);
  const wantKey = o.legend && kinds.length > 0;
  if (post) {
    const sw = f.w - f.m * 2;
    const t = wantText ? textBlock(source, f, o, P, sw) : null;
    if (t) caption.push(t.draw(f.m, f.m));
    const top = t ? Math.ceil(f.m + t.h + 1.6 * EM) : f.m;
    place = fit(f.m, top);
    if (wantKey) {
      // A requested key takes a free corner inside the drawing's room, or is left out.
      const k = [0.36, 0.31, 0.26].map((q) => keyBlock(kinds, f, P, Math.round(f.w * q), "start"))
        .flatMap((blk) => [[f.m, top], [f.w - f.m - blk.w, top], [f.m, f.h - f.m - blk.h], [f.w - f.m - blk.w, f.h - f.m - blk.h]].map(([x, y]) => ({ blk, c: { x, y, w: blk.w, h: blk.h } })))
        .find(({ c }) => !hits(c));
      if (k) caption.push(k.blk.draw(k.c.x, k.c.y));
      else notes.push("The colour key was left out: no corner of the drawing is free.");
    }
  } else if (wantText || wantKey) {
    const corners = (w: number, h: number): Rect[] => [[f.m, f.m], [f.m, f.h - f.m - h], [f.w - f.m - w, f.m], [f.w - f.m - w, f.h - f.m - h]].map(([x, y]) => ({ x, y, w, h }));
    const free = (make: (width: number) => Block | null) => [0.36, 0.31, 0.26].flatMap((q) => {
      const cw = Math.round(f.w * q);
      const blk = make(cw);
      return blk ? corners(cw, blk.h).filter((c) => !hits(c)).map((c) => ({ c, blk })) : [];
    });
    let placed = false;
    if (wantText && wantKey) {
      const both = (cw: number): Block | null => {
        const t = textBlock(source, f, o, P, cw), k = keyBlock(kinds, f, P, cw, "start");
        if (!t) return k;
        const gap = 0.9 * EM;
        return { w: cw, h: t.h + gap + k.h, draw: (x, y) => t.draw(x, y) + k.draw(x, y + t.h + gap) };
      };
      const c = free(both)[0];
      if (c) { caption.push(c.blk.draw(c.c.x, c.c.y)); placed = true; }
    }
    if (!placed) {
      const s0 = wantText ? free((cw) => textBlock(source, f, o, P, cw)) : [null];
      const s1 = wantKey ? free((cw) => keyBlock(kinds, f, P, cw, "start")) : [null];
      const apart = (a: Rect, c: Rect) => a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h + 12 <= c.y || c.y + c.h + 12 <= a.y;
      outer: for (const a of s0) for (const c of s1) {
        if (a && c && !apart(a.c, c.c)) continue;
        if (a) caption.push(a.blk.draw(a.c.x, a.c.y));
        if (c) caption.push(c.blk.draw(c.c.x, c.c.y));
        placed = true;
        break outer;
      }
    }
    if (!placed) {
      // A strip under the drawing, title left and key right, above a firm hairline.
      const sw = f.w - f.m * 2;
      const t = wantText ? textBlock(source, f, o, P, Math.round(sw * 0.64)) : null;
      const k = wantKey ? keyBlock(kinds, f, P, Math.round(sw * (t ? 0.48 : 1)), "end") : null;
      const inner = Math.max(t?.h ?? 0, k?.h ?? 0);
      const pad = 0.9 * EM;
      const stripH = 1 + pad + inner;
      const sy = f.h - Math.round(f.m * 0.7) - stripH;
      caption.push(`<rect data-caption="strip" x="${f.m}" y="${r1(sy)}" width="${sw}" height="1" fill="${P.line2}"/>`);
      if (t) caption.push(t.draw(f.m, sy + 1 + pad + inner - t.h));
      if (k) caption.push(k.draw(f.m + sw - k.w, sy + 1 + pad + inner - k.h));
      place = fit(Math.ceil(stripH + Math.round(f.m * 0.7) + 22));
    }
  }

  const fonts = o.fonts
    ? `<style>@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${o.fonts.sans}) format("woff2")}` +
      `@font-face{font-family:"Geist Mono";font-weight:100 900;src:url(data:font/woff2;base64,${o.fonts.mono}) format("woff2")}</style>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" data-theme="${o.theme}" data-format="${f.id}" font-family="${esc(FONT_SANS)}">` +
    `<defs>${fonts}${drawing.defs}</defs>` +
    `<rect width="${f.w}" height="${f.h}" fill="${P.canvas}"/>` +
    `<g transform="translate(${r1(place.tx)} ${r1(place.ty)}) scale(${Math.round(place.k * 10000) / 10000})">${drawing.body}</g>` +
    caption.join("") +
    `</svg>`;
  const sizes = drawnSizes(drawing.body, place.k);
  for (const m of caption.join("").matchAll(/<text\b[^>]*font-size="([\d.]+)"/g)) sizes.all.push(Number(m[1]));
  return {
    svg, width: f.w, height: f.h, scale: place.k, kinds, notes,
    readability: readabilityOf(sizes, f, { items, whole }),
    shortened: shortenedIn(view, { items }),
    drawn: { view, rects: drawing.rects, routes: drawing.routes },
  };
}

