import type { ChannelId } from "../../core/file3";
import type { DiagramDocument, DiagramView } from "../../core/model";
import type { Palette } from "../../core/theme";
import type { Found } from "./Find";
import type { Viewport } from "./viewport";

export type Tool = "select" | "pan" | "component" | "connect" | "text";

export interface Selection { nodes: string[]; edges: string[]; texts: string[] }
export const NOTHING: Selection = { nodes: [], edges: [], texts: [] };
export const isEmpty = (s: Selection) => !s.nodes.length && !s.edges.length && !s.texts.length;

/** An inline input open over the drawing; `at` is its screen box inside the stage. */
export type Editing =
  | { kind: "label" | "sub"; id: string; at: Box; select?: boolean }
  | { kind: "item"; id: string; index: number; at: Box }
  /** A text typed in place at its drawing position; `id: null` is a new one, added on commit. */
  | { kind: "text"; id: string | null; at: { x: number; y: number }; size: number }
  | null;
export interface Box { x: number; y: number; w: number; h: number }

export interface ApplyOptions { record?: boolean; coalesce?: string }

/** What the canvas and the overlays need from the editor. */
export interface Ctl {
  doc: DiagramDocument;
  vid: string;
  view: DiagramView;
  P: Palette;
  vp: Viewport;
  setVp: (v: Viewport) => void;
  stage: { w: number; h: number };
  apply: (fn: (d: DiagramDocument) => DiagramDocument, opts?: ApplyOptions) => void;
  checkpoint: () => void;
  sel: Selection;
  setSel: (s: Selection) => void;
  callout: string | null;
  setCallout: (id: string | null) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  editing: Editing;
  /** The size the next new text starts at: the last one written or chosen. */
  textSize: { current: number };
  setEditing: (e: Editing) => void;
  picker: { screen: { x: number; y: number }; world: { x: number; y: number } } | null;
  setPicker: (p: Ctl["picker"]) => void;
  toast: (msg: string) => void;
  goView: (vid: string, next?: DiagramDocument, focus?: string) => void;
  /** The channel the canvas draws; only the overview holds more than one view (rule 5). */
  channel: ChannelId;
  /** "Change this part": open the AI panel with this component selected as the scope. */
  changePart: (id: string) => void;
  /** Components a run just added, changed or moved (marked for about 3 s). */
  changed: Set<string>;
  /** The callout is a side panel (ui contract, callout-pin). */
  pinned: boolean;
  setPinned: (on: boolean) => void;
  /** While searching with text: the matches on this view, lit, and the one stepped to. */
  found: Found | null;
}
