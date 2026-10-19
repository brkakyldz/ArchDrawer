import type { DiagramFile, NodeInput } from "./model";

/** Builders for core tests (not used by the product). */

export function node(id: string, extra: Partial<NodeInput> = {}): NodeInput {
  return {
    id, label: id[0].toUpperCase() + id.slice(1), kind: "service", form: "card", icon: null, sub: "", items: [],
    description: `What ${id} does.`, files: [], parent: null, detail: null, place: null, ...extra,
  };
}

export function file(nodes: NodeInput[], edges: DiagramFile["views"][number]["edges"] = [], extra: Partial<DiagramFile> = {}): DiagramFile {
  return {
    schema: "archdraw/diagram@2",
    title: "Test system",
    views: [{ id: "overview", title: "Overview", caption: { title: "Test system", lede: "" }, nodes, edges, texts: [] }],
    ...extra,
  };
}

export const edge = (from: string, to: string, extra: Partial<{ label: string; style: "call" | "async" | "dep"; both: boolean; step: number | null; id: string }> = {}) =>
  ({ from, to, label: "", style: "call" as const, both: false, step: null, ...extra });
