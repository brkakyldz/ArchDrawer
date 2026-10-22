import { startSwitches, type ShareSwitches } from "../../core/export/share";
import type { DiagramDocument } from "../../core/model";
import type { Step } from "../../core/file3";

/**
 * What the presenter and the tour show (ui contract, Presenting and the tour; ADR 0012). Pure: no
 * DOM, so it is tested without a browser. The slide image itself is core's `renderSlide`.
 */

/** The slide format's starting toggles; the opening slide always shows the caption's title and, when not empty, its lede. */
export const SLIDE_SWITCHES: ShareSwitches = { ...startSwitches("slide", false), title: true, lede: true };

/** The slide shown, followed by its step's id: null is the opening slide. */
export type At = string | null;

/**
 * The index of the slide `at` names: 0 for the opening slide, i for the i-th step. A step that is
 * gone shows the last step (ui contract: "when it was removed the last step is shown").
 */
export function indexOf(steps: readonly Step[], at: At): number {
  if (at === null) return 0;
  const i = steps.findIndex((s) => s.id === at);
  return i >= 0 ? i + 1 : steps.length;
}

/** The slide at `index` as an `At`: null for the opening slide (and for an index that names no step). */
export function atOf(steps: readonly Step[], index: number): At {
  return index >= 1 && index <= steps.length ? steps[index - 1].id : null;
}

/** The lowest index a mode shows: the opening slide when presenting, the first step in a tour. */
export const firstIndex = (mode: "present" | "tour") => (mode === "tour" ? 1 : 0);

/** `present-status`: `Step <i> of <n>: <text>` on a step, the presentation view's caption title on the opening slide. */
export function statusOf(doc: Pick<DiagramDocument, "views" | "steps" | "title">, index: number): string {
  const steps = doc.steps ?? [];
  if (index >= 1 && index <= steps.length) return `Step ${index} of ${steps.length}: ${steps[index - 1].text}`;
  return doc.views[0]?.caption.title || doc.title;
}

/** A note as the lines it shows, or the contract's sentence for an empty one. */
export function noteLines(note: string | undefined): string[] | null {
  const text = (note ?? "").replace(/\s+$/, "");
  return text.trim() ? text.split(/\r?\n/) : null;
}
export const NO_NOTE = "No note for this step";
export const NO_STEPS = "The presentation has no steps any more";
