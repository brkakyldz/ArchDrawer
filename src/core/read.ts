/**
 * The deep read of a `draw` run (diagram contract, Read answers): the facts an engine read from the
 * repository, repaired with one warning per change. The evidence check (`./evidence`) runs after.
 * Pure (invariant 4).
 */
import type { ComponentFact, Evidence, LimitFact, RelationFact } from "./file3";
import { FACT3_LIMITS } from "./file3";
import { ID_RE, KINDS, LIMITS, STYLES, type EdgeStyle, type Kind } from "./model";
import type { EvidenceFacts } from "./evidence";

const evidenceSchema = {
  type: "array",
  items: {
    type: "object", additionalProperties: false, required: ["file", "lines"],
    properties: { file: { type: "string" }, lines: { anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }] } },
  },
} as const;

/** The read's answer, in the strict schema dialect: every property required, none other. */
export const READ_SCHEMA = {
  type: "object", additionalProperties: false, required: ["components", "relations", "limits"],
  properties: {
    components: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "label", "kind", "sub", "description", "within", "evidence"],
      properties: {
        id: { type: "string" }, label: { type: "string" }, kind: { type: "string", enum: [...KINDS] }, sub: { type: "string" },
        description: { type: "string" }, within: { anyOf: [{ type: "string" }, { type: "null" }] }, evidence: evidenceSchema,
      } } },
    relations: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["from", "to", "label", "style", "both", "evidence"],
      properties: {
        from: { type: "string" }, to: { type: "string" }, label: { type: "string" }, style: { type: "string", enum: [...STYLES] },
        both: { type: "boolean" }, evidence: evidenceSchema,
      } } },
    limits: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "on", "text", "evidence"],
      properties: { id: { type: "string" }, on: { type: "string" }, text: { type: "string" }, evidence: evidenceSchema } } },
  },
} as const;

/** The read limits: more is cut, the last first (diagram contract, Read answers). */
export const READ_LIMITS = { components: 120, limits: 60 } as const;

/** An answer that is not a facts answer at all: the run fails and nothing is written. */
export class ReadAnswerError extends Error {}

/** The error of a read that left no component fact (diagram contract, The evidence check). */
export const NO_FACT = "The read found no fact the code supports. Nothing was written.";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const toId = (raw: string) => raw.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/** The answer repaired into facts (relations `r1`, `r2`, … in answer order), one warning per change. */
export function repairRead(raw: unknown): { facts: EvidenceFacts; warnings: string[] } {
  if (!isObj(raw) || !Array.isArray(raw.components)) throw new ReadAnswerError("The engine's read is not a facts answer: it has no components list");
  const warnings: string[] = [];
  const clip = (text: string, max: number, what: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    warnings.push(`Shortened ${what} to ${max} characters`);
    return t.slice(0, max - 1).trimEnd() + "…";
  };
  const used = new Set<string>();
  const claim = (wanted: string, fallback: string, what: string): string => {
    const clean = toId(wanted);
    const id = clean && ID_RE.test(clean) ? clean : fallback;
    let c = id;
    for (let i = 2; used.has(c); i++) c = `${id.slice(0, 64 - String(i).length - 1)}-${i}`;
    used.add(c);
    if (!wanted.trim()) warnings.push(`Gave the ${what} without an id the id "${c}"`);
    else if (id !== clean) warnings.push(`Replaced the invalid ${what} id "${wanted}" with "${c}"`);
    else if (clean !== wanted.trim()) warnings.push(`Renamed the ${what} id "${wanted}" to "${c}": ids use letters, digits, - and _`);
    else if (c !== id) warnings.push(`Renamed the duplicate id "${id}" to "${c}"`);
    return c;
  };
  const evidence = (v: unknown, owner: string): Evidence[] => {
    const out: Evidence[] = arr(v).filter(isObj).map((e) => {
      const l = e.lines;
      const lines = Array.isArray(l) && l.length === 2 && l.every((x) => Number.isInteger(x)) ? [l[0] as number, l[1] as number] as [number, number] : null;
      return { file: str(e.file), lines };
    });
    if (out.length > FACT3_LIMITS.evidence) { warnings.push(`Kept the first ${FACT3_LIMITS.evidence} evidence entries of "${owner}"`); out.length = FACT3_LIMITS.evidence; }
    return out;
  };

  // Components: cut to the limit first (the last first), then ids, kinds and texts.
  let rawComps = raw.components.filter(isObj);
  if (rawComps.length > READ_LIMITS.components) {
    warnings.push(`Kept the first ${READ_LIMITS.components} of the ${rawComps.length} components the read found`);
    rawComps = rawComps.slice(0, READ_LIMITS.components);
  }
  // A said id maps to the first component that claimed it, so relations and `within` follow renames.
  const idOf = new Map<string, string>();
  const comps: (ComponentFact & { within: string | null })[] = rawComps.map((c, i) => {
    const said = str(c.id);
    const id = claim(said, `component-${i + 1}`, "component");
    if (said.trim() && !idOf.has(said.trim())) idOf.set(said.trim(), id);
    let kind = str(c.kind) as Kind;
    if (!KINDS.includes(kind)) { warnings.push(`Component "${id}": unknown kind "${str(c.kind)}", drawn as service`); kind = "service"; }
    let label = clip(str(c.label), LIMITS.label, `the label of "${id}"`);
    if (!label) { warnings.push(`Component "${id}": an empty label, named "${id}"`); label = id.slice(0, LIMITS.label); }
    let description = clip(str(c.description), LIMITS.description, `the description of "${id}"`);
    if (!description) { warnings.push(`Component "${id}": an empty description`); description = "No description yet."; }
    const w = c.within === null || c.within === undefined ? null : str(c.within).trim() || null;
    return { id, label, kind, sub: clip(str(c.sub), LIMITS.sub, `the sub-line of "${id}"`), description, files: [], items: [], within: w, evidence: evidence(c.evidence, id) };
  });
  const known = new Set(comps.map((c) => c.id));
  const resolveId = (said: string) => idOf.get(said.trim()) ?? (known.has(said.trim()) ? said.trim() : null);
  // `within`: a component that is not itself a mechanism.
  const saidWithin = new Map(comps.map((c) => [c.id, c.within]));
  for (const c of comps) {
    if (c.within === null) continue;
    const w = resolveId(c.within);
    const outer = w === null ? undefined : saidWithin.get(w);
    if (w === null || w === c.id || (outer !== null && outer !== undefined)) {
      warnings.push(`Component "${c.id}": cleared its within "${c.within}": ${w === null ? "no such component" : w === c.id ? "itself" : "a mechanism itself"}`);
      c.within = null;
    } else c.within = w;
  }

  // Relations: real ends, one per pair, a reverse pair joined into one two-way relation.
  const relations: RelationFact[] = [];
  arr(raw.relations).filter(isObj).forEach((r) => {
    const from = resolveId(str(r.from)), to = resolveId(str(r.to));
    const what = `the relation ${str(r.from)} → ${str(r.to)}`;
    if (from === null || to === null) { warnings.push(`Dropped ${what}: it names no component`); return; }
    if (from === to) { warnings.push(`Dropped ${what}: it joins a component to itself`); return; }
    if (relations.some((x) => x.from === from && x.to === to)) { warnings.push(`Dropped ${what}: a second relation on the pair`); return; }
    const back = relations.find((x) => x.from === to && x.to === from);
    if (back) { back.both = true; warnings.push(`Joined ${str(r.to)} → ${str(r.from)} and ${what.slice("the relation ".length)} into one two-way relation`); return; }
    let style = str(r.style) as EdgeStyle;
    if (!STYLES.includes(style)) { warnings.push(`Relation ${from} → ${to}: unknown style "${str(r.style)}", drawn as call`); style = "call"; }
    relations.push({ id: "", from, to, label: clip(str(r.label), LIMITS.edgeLabel, `the label of ${from} → ${to}`), style, both: r.both === true, evidence: evidence(r.evidence, `${from} → ${to}`) });
  });
  relations.forEach((r, i) => (r.id = `r${i + 1}`));
  for (const r of relations) used.add(r.id);

  // Limits: cut to the limit, then ids and texts; one on no component goes.
  let rawLims = arr(raw.limits).filter(isObj);
  if (rawLims.length > READ_LIMITS.limits) {
    warnings.push(`Kept the first ${READ_LIMITS.limits} of the ${rawLims.length} limits the read found`);
    rawLims = rawLims.slice(0, READ_LIMITS.limits);
  }
  const limits: LimitFact[] = [];
  rawLims.forEach((l, i) => {
    const on = resolveId(str(l.on));
    const id = claim(str(l.id), `limit-${i + 1}`, "limit");
    if (on === null) { warnings.push(`Dropped the limit "${id}": "${str(l.on)}" is no component`); return; }
    const text = clip(str(l.text), FACT3_LIMITS.limitText, `the text of the limit "${id}"`);
    if (!text) { warnings.push(`Dropped the limit "${id}": it says nothing`); return; }
    limits.push({ id, on, text, evidence: evidence(l.evidence, id) });
  });

  // Only a mechanism carries `within` (the file's field is optional).
  const components: ComponentFact[] = comps.map(({ within, ...c }) => (within ? { ...c, within } : c));
  return { facts: { components, relations, limits }, warnings };
}
