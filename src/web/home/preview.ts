import { joinView } from "../../core/channels";
import { drawView, esc } from "../../core/export/svg";
import { choiceDoc, type Document4 } from "../../core/file4";
import { KIND_INFO, type Kind } from "../../core/model";
import { FONT_SANS, PALETTES } from "../../core/theme";

/**
 * A drawing card's preview (ui contract, `library-item-preview`): each view of the first choice's overview
 * channel, drawn by src/core as the editor and the exports draw it, in the drawing's own theme. A view of more
 * than 8 components fills the frame (cut at its edges, centred); one of 8 or fewer is drawn whole.
 */
export interface PreviewView { id: string; svg: string; kinds: Kind[] }
export interface Preview { theme: "light" | "dark"; canvas: string; dot: string; views: PreviewView[] }

export const FILL_ABOVE = 8;
const MARGIN = 24;

export function previewOf(doc: Document4, prefix: string): Preview {
  const d3 = choiceDoc(doc);
  const theme = doc.theme === "dark" ? "dark" : "light";
  const P = PALETTES[theme];
  const views = d3.channels.overview.views.map((v, i) => {
    const view = joinView(d3, "overview", v);
    const drawing = drawView(view, P, { prefix: `${prefix}v${i}` });
    const b = drawing.bounds.w > 0 && drawing.bounds.h > 0 ? drawing.bounds : { x: 0, y: 0, w: 1, h: 1 };
    const fill = view.nodes.filter((n) => n.form !== "group").length > FILL_ABOVE;
    const box = `${b.x - MARGIN} ${b.y - MARGIN} ${b.w + MARGIN * 2} ${b.h + MARGIN * 2}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid ${fill ? "slice" : "meet"}" font-family="${esc(FONT_SANS)}" text-rendering="geometricPrecision" aria-hidden="true">` +
      `<defs>${drawing.defs}</defs>${drawing.body}</svg>`;
    return { id: v.id, svg, kinds: kindsOf(view.nodes.map((n) => n.kind)) };
  });
  return { theme, canvas: P.canvas, dot: P.dot, views };
}

/** The kinds of a view's components, in the order they first appear, at most 5 (ui contract, `library-item-kinds`). */
export function kindsOf(kinds: Kind[]): Kind[] {
  const out: Kind[] = [];
  for (const k of kinds) if (!out.includes(k)) out.push(k);
  return out.slice(0, 5);
}

export const kindName = (k: Kind) => KIND_INFO[k].label;
