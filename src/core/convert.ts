/**
 * Reading older drawing files (docs/contracts/diagram.md, *Reading `archdraw/diagram@3`* and *Reading
 * `archdraw/diagram@2`*; ADR 0006, ADR 0015): `@2` becomes `@3`, and `@3` becomes `@4`. Pure (invariant 4).
 * Every change of meaning adds one warning; `@3` to `@4` changes none. A removed presentation channel is
 * dropped before any rule is checked (*Reading a `presentation` channel*; ADR 0019).
 */
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, validateFile, type DiagramFile, type EdgeInput, type FileCheck, type NodeInput, type ViewInput } from "./model";
import { migrateV1 } from "./migrate";
import {
  validateFile3,
  type ComponentFact, type ConnectionInput, type File3, type PartInput, type RelationFact, type Request3, type ViewInput3,
} from "./file3";
import { convertV3, validateFile4, type File4 } from "./file4";

export const CONVERTED_V2 = "Converted from archdraw/diagram@2";
/** The one warning of a file whose dropped presentation channel held a view (diagram contract, *Reading a `presentation` channel*). */
export const PRESENTATION_REMOVED = "The presentation channel was removed";
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
    },
    requests,
    warnings: [...(file.warnings ?? []), ...warnings],
  };
  return { file: out, warnings };
}

function nextR(used: Set<string>): string {
  for (let k = 1; ; k++) if (!used.has(`r${k}`)) return `r${k}`;
}

export interface ReadReport { ok: boolean; errors: string[]; warnings: string[]; file: File4 | null; from: "@4" | "@3" | "@2" | "@1" | null }

/**
 * An `@3` report carried on as `@4`: a valid file converted, its warnings under its one choice. An invalid
 * one is not converted, but its violations are named as in the file it would become (diagram contract, rule 1).
 */
function asV4(r: { ok: boolean; errors: string[]; warnings: string[]; file: File3 | null }): Omit<ReadReport, "from"> {
  const inChoice = (line: string) => (/^(facts|channels)\b/.test(line) ? `choices[0].${line}` : line);
  if (!r.ok || !r.file) return { ok: false, errors: r.errors.map(inChoice), warnings: [], file: null };
  const file = convertV3(r.file);
  const r4 = validateFile4(file);
  if (!r4.ok) return { ok: false, errors: r4.errors, warnings: [], file: null };
  return { ok: true, errors: [], warnings: r.warnings.map(inChoice), file };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * An `@4` or `@3` file without the removed presentation channel (diagram contract, *Reading a `presentation`
 * channel*; ADR 0019): the `presentation` key dropped from every choice's `channels` (an `@3` file's own), with
 * every request on that channel. `held` when any dropped channel held a view. The value given is not changed.
 */
export function dropPresentation(raw: unknown): { raw: unknown; held: boolean } {
  if (!isObj(raw) || (raw.schema !== SCHEMA_V4 && raw.schema !== SCHEMA_V3)) return { raw, held: false };
  let held = false;
  const strip = (channels: unknown): unknown => {
    if (!isObj(channels) || !("presentation" in channels)) return channels;
    const { presentation, ...rest } = channels;
    if (isObj(presentation) && Array.isArray(presentation.views) && presentation.views.length > 0) held = true;
    return rest;
  };
  const out: Record<string, unknown> = { ...raw };
  if (raw.schema === SCHEMA_V3) out.channels = strip(raw.channels);
  else if (Array.isArray(raw.choices)) out.choices = raw.choices.map((c) => (isObj(c) && isObj(c.channels) && "presentation" in c.channels ? { ...c, channels: strip(c.channels) } : c));
  if (Array.isArray(raw.requests)) out.requests = raw.requests.filter((r) => !(isObj(r) && r.channel === "presentation"));
  return { raw: out, held };
}

/**
 * Read any drawing file as `@4`: an `@4` file is validated; an `@3` file is validated as `@3` and
 * converted; an `@2` file is validated as `@2`, converted to `@3`, the result validated and converted
 * again; an `@1` file only when `allowV1` (import, `migrate`). A presentation channel is dropped first
 * (`dropPresentation`); when one held a view the file gets one warning. The returned warnings are the
 * file's own plus the conversion's.
 */
export function readAnyFile(given: unknown, check: FileCheck = {}, o: { allowV1?: boolean; now?: string } = {}): ReadReport {
  const { raw, held } = dropPresentation(given);
  const r = readKnown(raw, check, o);
  if (!held || !r.ok || !r.file) return r;
  return { ...r, warnings: [...r.warnings, PRESENTATION_REMOVED], file: { ...r.file, warnings: [...(r.file.warnings ?? []), PRESENTATION_REMOVED] } };
}

function readKnown(raw: unknown, check: FileCheck, o: { allowV1?: boolean; now?: string }): ReadReport {
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
    if (!r3.ok) return { ...asV4(r3), from: "@2" };
    // The @2 depth warnings are checked again on the @3 channels; notes and missing files keep theirs.
    const own = r2.warnings.filter((w) => !/^views\[/.test(w));
    const r4 = asV4({ ...r3, warnings: [...own, ...r3.warnings, ...warnings] });
    return { ...r4, from: "@2" };
  }
  if (schema === SCHEMA_V3) return { ...asV4(validateFile3(raw, check)), from: "@3" };
  const r = validateFile4(raw, check);
  return { ...r, from: schema === SCHEMA_V4 ? "@4" : null };
}
