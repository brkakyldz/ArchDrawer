import { jpegPagesToPdf, type JpegPage } from "../../core/export/pdf";
import { renderShare, startSwitches, type FormatId } from "../../core/export/share";
import { renderSlide, slideCount, type SlideDocument, type SlideOptions } from "../../core/export/slide";
import { storedZip, type ZipEntry } from "../../core/export/zip";
import type { DiagramDocument, DiagramView } from "../../core/model";
import { hasLanes, placePost } from "../editor/LinkedIn";
import sansUrl from "../fonts/Geist-Variable.woff2?url";
import monoUrl from "../fonts/GeistMono-Variable.woff2?url";

/**
 * The share image as the browser makes it, for the share dialog's downloads and for the second look
 * (ui contract, ai-look-again): the same SVG, the same fonts, drawn into a PNG.
 */

let fontCache: Promise<{ sans: string; mono: string }> | null = null;
const b64 = (buf: Uint8Array) => {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};
const fetched = async (url: string) => b64(new Uint8Array(await (await fetch(url)).arrayBuffer()));
/** Geist and Geist Mono as base64, embedded in the image so it renders the same anywhere. */
export const fonts = () => (fontCache ??= Promise.all([fetched(sansUrl), fetched(monoUrl)]).then(([sans, mono]) => ({ sans, mono })));

/** An SVG of `w` × `h` drawn into a canvas at `scale` times its size and encoded as `type`. */
async function raster(svg: string, w: number, h: number, scale: number, type: "image/png" | "image/jpeg", quality?: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("The image could not be drawn")); img.src = url; });
    const c = document.createElement("canvas");
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext("2d");
    if (!g) throw new Error("The image could not be drawn");
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, w, h);
    const name = type === "image/png" ? "PNG" : "JPEG";
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(`${name} encoding failed`))), type, quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An SVG of `w` × `h` drawn into a PNG at `scale` times its size (the downloads at 2, the second look at 1). */
export const toPng = (svg: string, w: number, h: number, scale = 2): Promise<Blob> => raster(svg, w, h, scale, "image/png");

/** The JPEG quality of a PDF slide page (ADR 0012). */
export const JPEG_QUALITY = 0.92;

/** An SVG of `w` × `h` drawn into a JPEG at `scale` times its size, for the PDF's pages (ADR 0012: twice, quality 0.92). */
export const toJpeg = (svg: string, w: number, h: number, scale = 2, quality = JPEG_QUALITY): Promise<Blob> =>
  raster(svg, w, h, scale, "image/jpeg", quality);

const samePlaces = (a: DiagramView, b: DiagramView) => a.nodes.every((n, i) => n.x === b.nodes[i]?.x && n.y === b.nodes[i]?.y);
/** The post as the chosen orientation shows it: re-placed only when it sits as the other one does (edits by hand stay). */
export function orient(v: DiagramView, portrait: boolean): DiagramView {
  if (!hasLanes(v)) return v;
  const want = placePost(v, portrait);
  return !samePlaces(v, want) && samePlaces(v, placePost(v, !portrait)) ? want : v;
}

/** The format the share dialog opens with on a channel (ui contract, Share): the feed on LinkedIn, the slide on the presentation, else README. */
export const defaultFormat = (channel: string | undefined, post: boolean): FormatId => (post || channel === "linkedin" ? "feed" : channel === "presentation" ? "slide" : "readme");

/**
 * The current view as the share image in its channel's default format, with that format's starting
 * switches and the drawing's theme, at 1×, as a PNG in base64 with no `data:` prefix (ui contract, ai-look-again).
 */
export async function viewImage(doc: DiagramDocument, viewId: string, channel: string): Promise<string> {
  const stored = doc.views.find((v) => v.id === viewId)!;
  const post = !!stored.postOf || channel === "linkedin";
  const format = defaultFormat(channel, post);
  const pv = post ? orient(stored, format === "feed") : stored;
  const shown = pv === stored ? doc : { ...doc, views: doc.views.map((v) => (v.id === pv.id ? pv : v)) };
  const img = renderShare(shown, pv.id, { format, theme: doc.theme, ...startSwitches(format, post), fonts: await fonts() });
  const png = await toPng(img.svg, img.width, img.height, 1);
  return b64(new Uint8Array(await png.arrayBuffer()));
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/**
 * Every slide of the presentation (`renderSlide`, ADR 0012) with the given theme and toggles, the
 * opening slide first, rasterised one at a time at twice its size: as one PDF of JPEG pages, or as one
 * stored zip of `<slug>-slide-<nn>.png`. Throws when the presentation has no step.
 */
export async function slides(doc: SlideDocument, o: Omit<SlideOptions, "fonts">, as: "pdf" | "png", slug: string): Promise<Uint8Array> {
  const count = slideCount(doc);
  if (count < 2) throw new RangeError("The presentation has no step");
  const withFonts: SlideOptions = { ...o, fonts: await fonts() };
  const pages: JpegPage[] = [], entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const img = renderSlide(doc, i, withFonts);
    if (as === "pdf") {
      pages.push({ jpeg: await bytesOf(await toJpeg(img.svg, img.width, img.height)), width: img.width * 2, height: img.height * 2 });
    } else {
      entries.push({ name: `${slug}-slide-${String(i).padStart(2, "0")}.png`, data: await bytesOf(await toPng(img.svg, img.width, img.height)) });
    }
  }
  return as === "pdf" ? jpegPagesToPdf(pages) : storedZip(entries);
}
