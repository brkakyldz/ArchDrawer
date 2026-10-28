import type { ChannelId } from "../../core/file3";
import { SIMPLIFY_INSTRUCTION } from "../../core/simplify";

/** One fixed instruction a channel offers with one click (ui contract, Suggestions). */
export interface Suggestion {
  /** `ai-suggest-<id>`. */
  id: string;
  label: string;
  instruction: string;
  /** `Simpler` is the overview's simplify run; every other suggestion is a refine. */
  kind: "refine" | "simplify";
}

/** The suggestions of each channel, in order (ui contract, Suggestions). No model chooses them (ADR 0008). */
export const SUGGESTIONS: Record<ChannelId, Suggestion[]> = {
  overview: [
    { id: "simpler", label: "Simpler", instruction: SIMPLIFY_INSTRUCTION, kind: "simplify" },
    { id: "loop", label: "Show the loop", instruction: "Show the loop: draw the agent's loop and the checks around it as parts with numbered connections", kind: "refine" },
  ],
  linkedin: [{ id: "shorter", label: "Shorter for LinkedIn", instruction: "Make it shorter for LinkedIn: fewer parts and shorter names", kind: "refine" }],
  readme: [{ id: "fewer-details", label: "Fewer details", instruction: "Show fewer details: hold mechanisms only where the story is about them", kind: "refine" }],
};
