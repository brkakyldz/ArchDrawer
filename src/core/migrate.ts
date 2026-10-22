import {
  LIMITS, SCHEMA_ID, SCHEMA_V1, TEXT_SIZE, type DiagramDocument, type DiagramEdge, type DiagramNode, type Kind,
} from "./model";

/** The parts of an `archdraw/diagram@1` document the migration reads (docs/contracts/diagram.md). */
interface V1Doc {
  schema: string; id?: string; title?: string; subtitle?: string; theme?: string; showSteps?: boolean;
  source?: unknown; engine?: unknown; instruction?: string; createdAt?: string; updatedAt?: string;
  nodes?: { id: string; label: string; kind: string; tech?: string; description?: string; group?: string | null; files?: string[]; x: number; y: number }[];
  groups?: { id: string; label: string; parent?: string | null; x: number; y: number; w: number; h: number }[];
  edges?: { id: string; from: string; to: string; label?: string; style: string; step: number | null }[];
  notes?: { id: string; text: string; x: number; y: number }[];
  warnings?: string[];
}

export const isV1 = (raw: unknown): boolean => !!raw && typeof raw === "object" && (raw as { schema?: unknown }).schema === SCHEMA_V1;

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…");

/**
 * archdraw/diagram@1 → @2 (diagram contract § Migration). Every change that is not a
 * plain rename adds one warning. The result may still need validation (e.g. files).
 */
export function migrateV1(raw: unknown, now: string): { doc: DiagramDocument; warnings: string[] } {
  const d = raw as V1Doc;
  const warnings: string[] = [];
  /** Over-long text is shortened, one warning each (diagram contract, Reading `archdraw/diagram@1`). */
  const fit = (s: string, max: number, what: string) => {
    if (s.length > max) warnings.push(`${what} shortened to ${max} characters`);
    return clip(s, max);
  };
  const title = fit((d.title ?? "").trim() || "Architecture", LIMITS.title, "The title");
  const nodes: DiagramNode[] = [];

  for (const g of d.groups ?? []) {
    nodes.push({
      id: g.id, label: fit(g.label, LIMITS.label, `Zone "${g.id}": label`), kind: "service", form: "group", icon: "layers", sub: "", items: [],
      description: "A group of components.", files: [], parent: g.parent ?? null, detail: null, place: null, x: g.x, y: g.y,
    });
    warnings.push(`Zone "${g.id}" became a group component`);
  }
  for (const n of d.nodes ?? []) {
    let kind = n.kind as Kind;
    if (n.kind === "ui") { kind = "client"; warnings.push(`Component "${n.id}": kind ui became client`); }
    const label = fit(n.label, LIMITS.label, `Component "${n.id}": label`);
    let description = (n.description ?? "").trim();
    if (!description) { description = "No description yet."; warnings.push(`Component "${n.id}" had no description`); }
    nodes.push({
      id: n.id, label, kind, form: "card", icon: null, sub: fit(n.tech ?? "", LIMITS.sub, `Component "${n.id}": tech`), items: [], description,
      files: [...(n.files ?? [])], parent: n.group ?? null, detail: null, place: null, x: n.x, y: n.y,
    });
  }

  const edges: DiagramEdge[] = [];
  const byPair = new Map<string, DiagramEdge>();
  const v1Edges = [...(d.edges ?? [])].sort((a, b) => (a.style === "result" ? 1 : 0) - (b.style === "result" ? 1 : 0));
  for (const e of v1Edges) {
    const back = byPair.get(`${e.to}>${e.from}`);
    const same = byPair.get(`${e.from}>${e.to}`);
    const what = e.style === "result" ? `Connection "${e.id}" (a result)` : `Connection "${e.id}"`;
    if (same) { warnings.push(`${what} dropped: a second connection ${e.from} → ${e.to}`); continue; }
    if (back) { back.both = true; warnings.push(`${what} merged into "${back.id}" as two-way`); continue; }
    if (e.style === "result") warnings.push(`${what} became a call`);
    const style = e.style === "async" ? "async" : "call";
    let label = e.label ?? "";
    if (label.length > LIMITS.edgeLabel) { label = clip(label, LIMITS.edgeLabel); warnings.push(`Connection "${e.id}": label shortened`); }
    const edge: DiagramEdge = { id: e.id, from: e.from, to: e.to, label, style, both: false, step: e.step ?? null };
    edges.push(edge);
    byPair.set(`${e.from}>${e.to}`, edge);
  }

  const doc: DiagramDocument = {
    schema: SCHEMA_ID,
    id: typeof d.id === "string" ? d.id : "d_unsaved",
    title,
    theme: d.theme === "dark" ? "dark" : "light",
    showSteps: d.showSteps ?? false,
    source: null,
    engine: null,
    createdAt: d.createdAt ?? now,
    updatedAt: now,
    views: [{
      id: "overview",
      title: "Overview",
      postOf: null,
      caption: { title, lede: fit((d.subtitle ?? "").trim(), LIMITS.lede, "The subtitle") },
      nodes,
      edges,
      texts: (d.notes ?? []).filter((t) => t.text.trim()).map((t) => ({ id: t.id, text: fit(t.text, LIMITS.text, `Note "${t.id}"`), x: t.x, y: t.y, size: TEXT_SIZE.note })),
    }],
    requests: [],
    warnings: [...(d.warnings ?? []), ...warnings],
  };
  return { doc, warnings };
}
