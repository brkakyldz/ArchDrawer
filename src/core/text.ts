import { GEIST_400, GEIST_500, GEIST_600, METRIC_CHARS, MONO_ADVANCE } from "./metrics.generated";

const index = new Map<string, number>();
for (let i = 0; i < METRIC_CHARS.length; i++) index.set(METRIC_CHARS[i], i);

export type FontWeight = 400 | 500 | 600;
const TABLE: Record<FontWeight, readonly number[]> = { 400: GEIST_400, 500: GEIST_500, 600: GEIST_600 };

/** Advance width in em of one character of Geist; unknown glyphs count as wide. */
function advance(ch: string, weight: FontWeight): number {
  const i = index.get(ch);
  if (i === undefined) return ch.codePointAt(0)! > 0x2e80 ? 1.0 : 0.62;
  return TABLE[weight][i];
}

/**
 * Rendered width in px of `text` in Geist at `size` px with `tracking` em of letter spacing.
 * Includes a 2% safety margin. Holds only where text is drawn with geometricPrecision, which
 * keeps Chromium on Linux from rounding each advance to a whole pixel (diagram contract, Geometry).
 */
export function textWidth(text: string, size: number, weight: FontWeight = 400, tracking = 0): number {
  let em = 0;
  let n = 0;
  for (const ch of text) { em += advance(ch, weight); n++; }
  return (em + tracking * n) * size * 1.02;
}

/** Rendered width in px of `text` in Geist Mono at `size` px. */
export function monoWidth(text: string, size: number): number {
  return [...text].length * MONO_ADVANCE * size;
}

export interface TextStyle { size: number; weight?: FontWeight; tracking?: number; mono?: boolean }
export const widthOf = (text: string, s: TextStyle) => (s.mono ? monoWidth(text, s.size) : textWidth(text, s.size, s.weight ?? 400, s.tracking ?? 0));

/**
 * Greedy word wrap into lines no wider than `maxWidth`. A single word longer than the
 * line is broken by characters. At most `maxLines` lines; the last one gets an ellipsis
 * when text remains.
 */
export function wrapText(text: string, size: number, maxWidth: number, weight: FontWeight = 400, maxLines = 6, tracking = 0): string[] {
  const w = (s: string) => textWidth(s, size, weight, tracking);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const push = (l: string) => { if (l) lines.push(l); };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (w(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    push(line);
    line = "";
    if (w(word) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (w(chunk + ch) > maxWidth && chunk) {
        push(chunk);
        chunk = "";
      }
      chunk += ch;
    }
    line = chunk;
  }
  push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && w(last + "…") > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    return kept;
  }
  return lines;
}

/** Truncate to one line that fits `maxWidth`, with an ellipsis when cut. */
export function fitLine(text: string, maxWidth: number, s: TextStyle): string {
  if (widthOf(text, s) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && widthOf(t + "…", s) > maxWidth) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}
