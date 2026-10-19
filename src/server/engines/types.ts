import type { RunScope } from "../../core/repair";

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
   * prompt. The engine runs with exactly the same read-only flags either way.
   */
  task?: { kind: "post"; schema: object; prompt: string };
  /** A simplify run (api contract): the overview becomes a map, and its prompt says what may change. */
  simplify?: boolean;
}

export class EngineError extends Error {}

export interface Engine {
  id: string;
  label: string;
  detect(): Promise<EngineInfo>;
  /** Returns the engine's raw answer (validated and repaired by the caller). */
  run(req: EngineRunRequest): Promise<unknown>;
}
