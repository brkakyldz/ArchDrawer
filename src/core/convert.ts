/**
 * Reading older drawing files as `archdraw/diagram@3` (docs/contracts/diagram.md, *Reading
 * `archdraw/diagram@2`*; ADR 0006). Pure (invariant 4). Every change of meaning adds one warning.
 */
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, validateFile, type DiagramFile, type EdgeInput, type FileCheck, type NodeInput, type ViewInput } from "./model";
import { migrateV1 } from "./migrate";
import {
  validateFile3,
  type ComponentFact, type ConnectionInput, type File3, type PartInput, type RelationFact, type Request3, type ViewInput3,
} from "./file3";

export const CONVERTED_V2 = "Converted from archdraw/diagram@2";
const EDGE_TEXT = ["label", "style", "both"] as const;

/** Convert a valid `@2` file (notes already read as texts) to an `@3` file. */
export function convertV2(file: DiagramFile): { file: File3; warnings: string[] } {
  const warnings: string[] = [CONVERTED_V2];
  const posts = file.views.filter((v) => v.postOf);
  const first = file.views.find((v) => !v.postOf);
  const post = posts.find((v) => v.postOf === first?.id) ?? posts[0] ?? null;
  for (const p of posts) if (p !== post) warnings.push(`The post "${p.id}" is now a view of the overview; the LinkedIn channel holds one drawing`);
  const overviewViews = file.views.filter((v) => v !== post);
  const overviewIds = new Set(overviewViews.map((v) => v.id));

  // A component whose `from` names other components of the overview is a merged part; every other one is a fact.
  const base = new Set(overviewViews.flatMap((v) => v.nodes.map((n) => n.id)));
  const mergedOf = (n: NodeInput) => (n.from ?? []).filter((id) => id !== n.id && base.has(id));
  const isMerged = (n: NodeInput) => mergedOf(n).length > 0;
  const factNodes = new Map<string, NodeInput>();
  for (const v of overviewViews) for (const n of v.nodes) if (!isMerged(n)) factNodes.set(n.id, n);
  const usedIds = new Set<string>(factNodes.keys());
  let droppedFrom = false;

  const components: ComponentFact[] = [...factNodes.values()].map((n) => ({
    id: n.id, label: n.label, kind: n.kind, sub: n.sub, description: n.description, files: [...n.files], items: [...n.items],
  }));
  const relations: RelationFact[] = [];
  const relationOf = new Map<string, string>(); // "a>b" → relation id
  const findRelation = (a: string, b: string) => relationOf.get(`${a}>${b}`) ?? relationOf.get(`${b}>${a}`) ?? null;
  const relById = new Map<string, RelationFact>();

  const shownOnce = (view: { id: string }, list: string[], seen: Set<string>, partId: string) => {
    const out: string[] = [];
    for (const f of list) {
      if (out.includes(f)) continue;
      if (seen.has(f)) { warnings.push(`View "${view.id}": "${partId}" no longer shows "${f}", which an earlier part shows`); continue; }
      out.push(f); seen.add(f);
    }
    return out;
  };

  const detailOf = (n: NodeInput, viewId: string) => {
    if (n.detail && !overviewIds.has(n.detail)) { warnings.push(`View "${viewId}": "${n.id}" no longer opens "${n.detail}", which is not a view of the overview`); return null; }
    return n.detail;
  };

  const convertOverview = (v: ViewInput): ViewInput3 => {
    const seen = new Set<string>();
    // Facts first, so a merged part never takes a fact its own original shows in this view.
    for (const n of v.nodes) if (!isMerged(n)) seen.add(n.id);
    const nodes = v.nodes.map((n): PartInput => {
      if ((n.from ?? []).some((id) => id !== n.id && !base.has(id))) droppedFrom = true;
      const common = { id: n.id, form: n.form, icon: n.icon, parent: n.parent, detail: detailOf(n, v.id), place: n.place, lane: n.lane ?? null, ...(n.x !== undefined ? { x: n.x, y: n.y } : {}) };
      if (!isMerged(n)) return { ...common, facts: [n.id] };
      const facts = shownOnce(v, mergedOf(n).filter((id) => factNodes.has(id)), seen, n.id);
      const theirs = new Set(facts.flatMap((f) => factNodes.get(f)!.files));
      if (n.files.some((f) => !theirs.has(f))) warnings.push(`View "${v.id}": "${n.id}" now takes its files from the parts it merges`);
      return { ...common, facts, label: n.label, kind: n.kind, sub: n.sub, description: n.description, ...(n.form === "panel" ? { items: [...n.items] } : {}) };
    });
    const edges = v.edges.map((e): ConnectionInput => {
      if (factNodes.has(e.from) && factNodes.has(e.to)) {
        const id = e.id && !usedIds.has(e.id) ? e.id : nextR(usedIds);
        usedIds.add(id);
        const rel: RelationFact = { id, from: e.from, to: e.to, label: e.label, style: e.style, both: e.both };
        relations.push(rel); relById.set(id, rel);
        relationOf.set(`${e.from}>${e.to}`, id);
        return { ...(e.id ? { id: e.id } : {}), from: e.from, to: e.to, relations: [id], step: e.step };
      }
      return { ...(e.id ? { id: e.id } : {}), from: e.from, to: e.to, relations: [], step: e.step, label: e.label, style: e.style, both: e.both };
    });
    return { id: v.id, title: v.title, caption: { ...v.caption }, nodes, edges, texts: (v.texts ?? []).map((t) => ({ ...t })) };
  };

  const overview = overviewViews.map(convertOverview);
  if (droppedFrom) warnings.push("Dropped the merge history of parts that name components no longer in the drawing");

  const factById = new Map(components.map((c) => [c.id, c]));
  const convertPost = (v: ViewInput): ViewInput3 => {
    const seen = new Set<string>();
    const nodes = v.nodes.map((n): PartInput => {
      const facts = shownOnce(v, (n.from ?? []).filter((id) => factById.has(id)), seen, n.id);
      const fact = facts.length === 1 ? factById.get(facts[0])! : null;
      if (n.detail) warnings.push(`View "${v.id}": "${n.id}" no longer opens "${n.detail}"; only the overview has detail views`);
      const p: PartInput = { id: n.id, facts, form: n.form, icon: n.icon, parent: n.parent, detail: null, place: n.place, lane: n.lane ?? null, ...(n.x !== undefined ? { x: n.x, y: n.y } : {}) };
      for (const f of ["label", "kind", "sub", "description"] as const) if (!fact || fact[f] !== n[f]) (p as unknown as Record<string, unknown>)[f] = n[f];
      if (n.form === "panel" && (!fact || fact.items.join("\n") !== n.items.join("\n"))) p.items = [...n.items];
      return p;
    });
    const parts = new Map(nodes.map((p) => [p.id, p]));
    const edges = v.edges.map((e: EdgeInput): ConnectionInput => {
      const a = parts.get(e.from), b = parts.get(e.to);
      const rel = a?.facts.length === 1 && b?.facts.length === 1 ? findRelation(a.facts[0], b.facts[0]) : null;
      const c: ConnectionInput = { ...(e.id ? { id: e.id } : {}), from: e.from, to: e.to, relations: rel ? [rel] : [], step: e.step };
      const r = rel ? relById.get(rel)! : null;
      if (r && a && r.from !== a.facts[0] && !r.both && !e.both) { c.from = e.to; c.to = e.from; }
      for (const f of EDGE_TEXT) if (!r || r[f] !== e[f]) (c as unknown as Record<string, unknown>)[f] = e[f];
      return c;
    });
    return { id: v.id, title: v.title, caption: { ...v.caption }, nodes, edges, texts: (v.texts ?? []).map((t) => ({ ...t })) };
  };

  const showSteps = file.showSteps ?? false;
  const requests: Request3[] = (file.requests ?? []).map((r) => ({ id: r.id, text: r.text, channel: post && r.view === post.id ? "linkedin" : "overview", view: r.view, at: r.at }));
  const out: File3 = {
    schema: SCHEMA_V3,
    ...(file.id !== undefined ? { id: file.id } : {}),
    title: file.title,
    ...(file.theme !== undefined ? { theme: file.theme } : {}),
    ...(file.source !== undefined ? { source: file.source } : {}),
    ...(file.engine !== undefined ? { engine: file.engine } : {}),
    ...(file.createdAt !== undefined ? { createdAt: file.createdAt } : {}),
    ...(file.updatedAt !== undefined ? { updatedAt: file.updatedAt } : {}),
    facts: { components, relations },
    channels: {
      overview: { views: overview, showSteps, outdated: [] },
      linkedin: { views: post ? [convertPost(post)] : [], showSteps: post ? showSteps : false, outdated: [] },
      readme: { views: [], showSteps: false, outdated: [] },
      presentation: { views: [], showSteps: false, outdated: [] },
    },
    requests,
    warnings: [...(file.warnings ?? []), ...warnings],
  };
  return { file: out, warnings };
}

function nextR(used: Set<string>): string {
  for (let k = 1; ; k++) if (!used.has(`r${k}`)) return `r${k}`;
}

export interface ReadReport { ok: boolean; errors: string[]; warnings: string[]; file: File3 | null; from: "@3" | "@2" | "@1" | null }

/**
 * Read any drawing file as `@3`: an `@3` file is validated; an `@2` file is validated as `@2`,
 * converted, and the result validated; an `@1` file only when `allowV1` (import, `migrate`).
 * The returned warnings are the file's own plus the conversion's.
 */
export function readAnyFile(raw: unknown, check: FileCheck = {}, o: { allowV1?: boolean; now?: string } = {}): ReadReport {
  const schema = raw && typeof raw === "object" ? (raw as { schema?: unknown }).schema : undefined;
  if (schema === SCHEMA_V1 && o.allowV1) {
    const { doc } = migrateV1(raw, o.now ?? new Date().toISOString());
    const r = readAnyFile(doc, check, o);
    return { ...r, from: "@1" };
  }
  if (schema === SCHEMA_V2) {
    const r2 = validateFile(raw, check);
    if (!r2.ok || !r2.file) return { ok: false, errors: r2.errors, warnings: [], file: null, from: "@2" };
    const { file, warnings } = convertV2(r2.file);
    const r3 = validateFile3(file, check);
    if (!r3.ok) return { ok: false, errors: r3.errors, warnings: [], file: null, from: "@2" };
    // The @2 depth warnings are checked again on the @3 channels; notes and missing files keep theirs.
    const own = r2.warnings.filter((w) => !/^views\[/.test(w));
    return { ok: true, errors: [], warnings: [...own, ...r3.warnings, ...warnings], file, from: "@2" };
  }
  const r = validateFile3(raw, check);
  return { ...r, from: r.ok ? "@3" : schema === SCHEMA_V3 ? "@3" : null };
}
