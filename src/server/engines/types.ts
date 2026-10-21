import type { RunScope } from "../../core/repair";
import type { DiagramView } from "../../core/model";

export interface EngineModel { id: string; label: string }

export interface EngineInfo {
  id: string;
  label: string;
  available: boolean;
  version: string | null;
  detail: string;
  /** True only for the fixture: never chosen in place of a real engine. */
  test: boolean;
  /** The models the engine offers, best first; may be empty (api contract, GET /api/engines). */
  models: EngineModel[];
}

export interface EngineRunRequest {
  /** Repository root; the engine's working directory. */
  cwd: string;
  /** Folder name, for prompts. */
  folderName: string;
  instruction: string;
  /** The view the user was looking at when they typed the instruction. */
  view: string;
  model: string | null;
  /** What the run may change, told to the engine; the repair enforces it. */
  scope: RunScope;
  /** Labels of the components a `parts` scope names, for the prompt. */
  parts: string[];
  /** The current document's draft projection (core/repair documentToDraft). */
  base: unknown;
  signal: AbortSignal;
  timeoutMs: number;
  progress: (message: string) => void;
  /**
   * Another kind of answer than a refine draft (a post's story intent): its schema and its whole
   * prompt. The engine runs with the same read-only flags, or with no tools at all where it can when
   * `tools` is `"none"` (a story from the facts alone; api contract, Engines).
   */
  task?: {
    kind: "post" | "story" | "scan" | "read" | "route"; schema: object; prompt: string; tools?: "read" | "none";
    /** What the fixture builds its answer from (the listing, a story's channel, a draw's title); real engines ignore it. */
    data?: { listing?: string[]; entries?: string[]; channel?: string; overview?: DiagramView; title?: string; draw?: "read" | "overview" | "channel" };
  };
  /** A simplify run (api contract): the overview becomes a map, and its prompt says what may change. */
  simplify?: boolean;
  /**
   * The story route of a refine on the overview (api contract, Routing): the prompt asks for appearance
   * only, and the engine runs with no tools where it can.
   */
  appearance?: boolean;
}

export class EngineError extends Error {}

export interface Engine {
  id: string;
  label: string;
  detect(): Promise<EngineInfo>;
  /** Returns the engine's raw answer (validated and repaired by the caller). */
  run(req: EngineRunRequest): Promise<unknown>;
}
