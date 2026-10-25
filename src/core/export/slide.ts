import { measureText, type Rect } from "../geometry";
import { placedForSwitches } from "../layout";
import { isPostView, type DiagramDocument, type DiagramView, type Kind, type Theme } from "../model";
import { wrapText } from "../text";
import { FONT_MONO, FONT_SANS, PALETTES } from "../theme";
import {
  drawnSizes, FORMATS, keyBlock, readabilityOf, renderShare, shortenedIn, subLinesOf, WHOLE, withSubLines, type Block, type ShareImage, type ShareSwitches,
} from "./share";
import { baseline, drawView, esc } from "./svg";

/**
 * The slide image (docs/contracts/ui.md § The slide image, ADR 0012): the presentation view as the
 * slide format's share image, index 0 the opening slide and index i the i-th step with the rest
 * dimmed and the step's text in a band along the bottom. Pure: the presenter, the tour and both
 * slide downloads show this and nothing else.
 */

export interface SlideOptions extends ShareSwitches {
  theme: Theme;
  /** `show-sub`: absent or null follows the view's sub-line switch. */
  sub?: boolean | null;
  /** Base64 woff2 of Geist and Geist Mono, embedded as in the share image. */
  fonts?: { sans: string; mono: string } | null;
}

export type SlideDocument = Pick<DiagramDocument, "views" | "steps">;

/** The step text's sizes, tried in order: each on at most `lines` lines (the last on as many as it needs). */
export const SLIDE_TEXT = [{ size: 34, lines: 2 }, { size: 28, lines: 3 }, { size: 22, lines: WHOLE }] as const;
export const SLIDE_TEXT_WIDTH = 1640;
const LINE = 1.3; // the band's line height, in ems
const COUNT = 24; // the counter's mono size
const GAP = 28; // between the drawing and the band
const DIM = ' data-dim="true" opacity="0.25"';
const r1 = (v: number) => Math.round(v * 10) / 10;

/** How many slides a presentation has: the opening slide and one per step. */
export const slideCount = (doc: Pick<DiagramDocument, "steps">) => (doc.steps?.length ?? 0) + 1;

/** A step's text as the band sets it: the first size it fits at, whole, never shortened. */
export function bandText(text: string): { size: number; line: number; lines: string[] } {
  for (const s of SLIDE_TEXT) {
    const lines = wrapText(text, s.size, SLIDE_TEXT_WIDTH, 500, WHOLE);
    if (lines.length <= s.lines) return { size: s.size, line: s.size * LINE, lines };
  }
  throw new Error("unreachable: the last size takes any number of lines");
}

/** One slide, exactly 1920 × 1080. Throws a RangeError for an index outside 0 … steps. */
export function renderSlide(doc: SlideDocument, index: number, o: SlideOptions): ShareImage {
  const steps = doc.steps ?? [];
  if (!Number.isInteger(index) || index < 0 || index > steps.length) {
    throw new RangeError(`There is no slide ${index}: the presentation has slides 0 to ${steps.length}`);
  }
  const found = doc.views[0];
  if (!found) throw new RangeError("The presentation has no view to show");
  if (index === 0) {
    const img = renderShare({ views: [found] }, found.id, { ...o, format: "slide", parts: null });
    return { ...img, svg: img.svg.replace(' data-format="slide"', ' data-format="slide" data-slide="0"') };
  }

  const f = FORMATS.slide;
  const P = PALETTES[o.theme];
  const step = steps[index - 1];
  // Laid out as the opening slide is, so a part sits where it sat there.
  const whole = placedForSwitches(found, { portrait: true, labels: o.labels, post: isPostView(found) });
  const sub = subLinesOf(whole, o.sub);
  const view: DiagramView = withSubLines(whole, sub);
  const drawing = drawView(view, P, { subLines: sub, labels: o.labels, steps: o.steps, texts: o.texts, prefix: "sh" });
  const b = drawing.bounds.w > 0 ? drawing.bounds : { x: 0, y: 0, w: 1, h: 1 };
  const kinds: Kind[] = [];
  for (const n of view.nodes) if (!kinds.includes(n.kind)) kinds.push(n.kind);
  const notes: string[] = [];

  // Lit: the step's parts, and a connection whose two ends are among them. A group lights only itself.
  const lit = new Set(step.parts.map(esc));
  const ends = new Map(view.edges.map((e) => [esc(e.id), lit.has(esc(e.from)) && lit.has(esc(e.to))]));
  const body = drawing.body
    .replace(/<g data-node-id="([^"]*)"/g, (m, id: string) => (lit.has(id) ? m : m + DIM))
    // A group's head (its icon and name) dims with its frame (review 222ed43-1).
    .replace(/<g data-group-head="([^"]*)"/g, (m, id: string) => (lit.has(id) ? m : m + DIM))
    .replace(/<g data-edge-id="([^"]*)"/g, (m, id: string) => (ends.get(id) ? m : m + DIM))
    .replace(/<g data-text-id="([^"]*)"/g, (m) => m + DIM);

  // The band sits on the bottom margin. The drawing is fitted above the tallest band of any step,
  // so it stays put from step to step.
  const band = bandText(step.text);
  const tallest = Math.max(...steps.map((s) => bandText(s.text)).map((t) => t.lines.length * t.line));
  const bandTop = f.h - f.m - band.lines.length * band.line;
  const top = Math.round(f.m * 0.8);
  const fit = (bottom: number) => {
    const aw = f.w - f.m * 2, ah = f.h - top - bottom;
    const k = Math.max(0.05, Math.min(aw / b.w, ah / b.h, 1.6));
    return { k, tx: f.m + (aw - b.w * k) / 2 - b.x * k, ty: top + (ah - b.h * k) / 2 - b.y * k };
  };
  let bottom = Math.ceil(f.m + tallest + GAP);
  let place = fit(bottom);

  // The key, when asked for: a free corner of the drawing's room, else a row right-aligned above the band.
  const extra: string[] = [];
  if (o.legend && kinds.length) {
    const solid = () => {
      const rs: Rect[] = [...drawing.rects.values()];
      if (o.texts) for (const t of view.texts) rs.push({ x: t.x, y: t.y, ...measureText(t) });
      return rs.map((r) => ({ x: r.x * place.k + place.tx - 16, y: r.y * place.k + place.ty - 16, w: r.w * place.k + 32, h: r.h * place.k + 32 }));
    };
    const hits = (c: Rect) => solid().some((r) => c.x < r.x + r.w && c.x + c.w > r.x && c.y < r.y + r.h && c.y + c.h > r.y);
    const corner = [0.36, 0.31, 0.26].map((q) => keyBlock(kinds, f, P, Math.round(f.w * q), "start"))
      .flatMap((blk: Block) => [[f.m, top], [f.w - f.m - blk.w, top], [f.m, f.h - bottom - blk.h], [f.w - f.m - blk.w, f.h - bottom - blk.h]]
        .map(([x, y]) => ({ blk, c: { x, y, w: blk.w, h: blk.h } })))
      .find(({ c }) => !hits(c));
    if (corner) extra.push(corner.blk.draw(corner.c.x, corner.c.y));
    else {
      const k = keyBlock(kinds, f, P, f.w - f.m * 2, "end");
      extra.push(k.draw(f.w - f.m - k.w, f.h - bottom - k.h));
      bottom += Math.ceil(k.h + GAP);
      place = fit(bottom);
    }
  }

  const lastBase = baseline(bandTop + (band.lines.length - 1) * band.line, band.line, band.size);
  const spans = band.lines.map((l, i) => `<tspan x="${f.m}" y="${r1(baseline(bandTop + i * band.line, band.line, band.size))}">${esc(l)}</tspan>`).join("");
  const bandMarkup =
    `<g data-slide-band="">` +
    `<text data-slide-text="" font-size="${band.size}" font-weight="500" fill="${P.ink}">${spans}</text>` +
    `<text data-slide-count="" x="${f.w - f.m}" y="${r1(lastBase)}" text-anchor="end" font-family="${esc(FONT_MONO)}" font-size="${COUNT}" fill="${P.muted}">${index} / ${steps.length}</text>` +
    `</g>`;

  // As the share image embeds them.
  const fonts = o.fonts
    ? `<style>@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${o.fonts.sans}) format("woff2")}` +
      `@font-face{font-family:"Geist Mono";font-weight:100 900;src:url(data:font/woff2;base64,${o.fonts.mono}) format("woff2")}</style>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" data-theme="${o.theme}" data-format="slide" data-slide="${index}" font-family="${esc(FONT_SANS)}" text-rendering="geometricPrecision">` +
    `<defs>${fonts}${drawing.defs}</defs>` +
    `<rect width="${f.w}" height="${f.h}" fill="${P.canvas}"/>` +
    `<g transform="translate(${r1(place.tx)} ${r1(place.ty)}) scale(${Math.round(place.k * 10000) / 10000})">${body}</g>` +
    extra.join("") + bandMarkup +
    `</svg>`;
  const sizes = drawnSizes(drawing.body, place.k);
  for (const m of (extra.join("") + bandMarkup).matchAll(/<text\b[^>]*font-size="([\d.]+)"/g)) sizes.all.push(Number(m[1]));
  return {
    svg, width: f.w, height: f.h, scale: place.k, kinds, notes,
    readability: readabilityOf(sizes, f, { sub, whole }),
    shortened: shortenedIn(view, { sub }),
    drawn: { view, rects: drawing.rects, routes: drawing.routes },
  };
}

