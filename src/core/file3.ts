/**
 * The stored drawing file `archdraw/diagram@3` (docs/contracts/diagram.md, ADR 0006): a facts
 * list and four fixed channels whose parts point to facts, extended by ADR 0007 (evidence,
 * mechanisms, limits, one README and one presentation view, steps). Shape, validity rules, defaults.
 * Pure: no Node or DOM APIs (invariant 4).
 */
import {
  DOC_ID_RE, FORMS, ICONS, ID_RE, KINDS, LIMITS, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, STYLES, TEXT_SIZE, THEMES,
  isRepoRelative,
  type Caption, type DiagramSource, type DiagramStep, type DiagramText, type EdgeStyle, type EngineRef, type FileCheck, type Form,
  type IconName, type Kind, type Lane, type Place, type TextInput, type Theme,
} from "./model";

export const CHANNELS = ["overview", "linkedin", "readme", "presentation"] as const;
export type ChannelId = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<ChannelId, string> = { overview: "Overview", linkedin: "LinkedIn", readme: "README", presentation: "Presentation" };
/** Views a channel may hold (rule 5). */
export const CHANNEL_VIEWS: Record<ChannelId, { min: number; max: number }> = {
  overview: { min: 1, max: LIMITS.views }, linkedin: { min: 0, max: 1 }, readme: { min: 0, max: 1 }, presentation: { min: 0, max: 1 },
};
export const FACT_LIMITS = { components: 1800, relations: 3600, limits: 600 } as const;
/** Limit facts, evidence and presentation steps (contract, Limit fact, Evidence, Presentation steps). */
export const FACT3_LIMITS = { limitText: LIMITS.limitText, evidence: 8, steps: 20, stepText: 120, stepNote: 1000 } as const;
export const isChannel = (c: unknown): c is ChannelId => typeof c === "string" && (CHANNELS as readonly string[]).includes(c);

/** Where a fact comes from: a repository-relative file, and its lines when they matter. */
export interface Evidence { file: string; lines: [number, number] | null }
export interface ComponentFact {
  id: string; label: string; kind: Kind; sub: string; description: string; files: string[]; items: string[];
  /** A mechanism: the component fact that holds it (rule 20). */
  within?: string | null;
  evidence?: Evidence[];
}
export interface RelationFact { id: string; from: string; to: string; label: string; style: EdgeStyle; both: boolean; evidence?: Evidence[] }
/** A guarantee of the component fact `on`, in one line (a deadline, a turn limit). */
export interface LimitFact { id: string; on: string; text: string; evidence?: Evidence[] }
/** Every field ADR 0007 added is optional, so a file written before it stays as it is. */
export interface Facts { components: ComponentFact[]; relations: RelationFact[]; limits?: LimitFact[] }

/** A part's own texts: null (or absent) = taken from its single fact. */
export interface OwnTexts { label?: string | null; kind?: Kind | null; sub?: string | null; description?: string | null; items?: string[] | null }
export interface Part extends OwnTexts {
  id: string; facts: string[]; form: Form; icon: IconName | null; parent: string | null; detail: string | null;
  place: Place | null; lane?: Lane | null; x: number; y: number;
  /** Mechanisms within its facts, listed in its callout and never drawn (rule 22); absent = none. */
  held?: string[];
  /** Limit facts on its facts or held mechanisms, listed in its callout and never drawn; absent = none. */
  limits?: string[];
}
export interface Connection {
  id: string; from: string; to: string; relations: string[]; step: number | null;
  label?: string | null; style?: EdgeStyle | null; both?: boolean | null;
}
export interface View3 { id: string; title: string; caption: Caption; subLines?: boolean; nodes: Part[]; edges: Connection[]; texts: DiagramText[] }
/** A presentation step: the parts it highlights, its on-screen text and the speaker's note. */
export type Step = DiagramStep;
/** `steps` only on the presentation channel; absent = none. */
export interface Channel { views: View3[]; showSteps: boolean; outdated: string[]; steps?: Step[] }
export interface Request3 { id: string; text: string; channel: ChannelId; view: string; at: string }

export interface Document3 {
  schema: typeof SCHEMA_V3;
  id: string; title: string; theme: Theme; source: DiagramSource | null; engine: EngineRef | null;
  createdAt: string; updatedAt: string;
  facts: Facts;
  channels: Record<ChannelId, Channel>;
  requests: Request3[]; warnings: string[];
}

/** A file as a session writes it: positions, connection ids, defaults may be missing. */
export type PartInput = Omit<Part, "x" | "y"> & { x?: number; y?: number };
export type ConnectionInput = Omit<Connection, "id" | "relations"> & { id?: string; relations?: string[] };
export interface ViewInput3 { id: string; title: string; caption: Caption; subLines?: boolean; nodes: PartInput[]; edges: ConnectionInput[]; texts?: TextInput[] }
export interface ChannelInput { views?: ViewInput3[]; showSteps?: boolean; outdated?: string[]; steps?: Step[] }
export interface File3 {
  schema: typeof SCHEMA_V3; id?: string; title: string; theme?: Theme;
  source?: DiagramSource | null; engine?: EngineRef | null; createdAt?: string; updatedAt?: string;
  facts: { components: ComponentFact[]; relations?: RelationFact[]; limits?: LimitFact[] };
  channels: { overview: ChannelInput & { views: ViewInput3[] } } & Partial<Record<Exclude<ChannelId, "overview">, ChannelInput>>;
  requests?: Request3[]; warnings?: string[];
}

export interface ValidationReport3 { ok: boolean; errors: string[]; warnings: string[]; file: File3 | null }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const q = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v));
const OWN_PART = ["label", "kind", "sub", "description", "items"] as const;
const OWN_EDGE = ["label", "style", "both"] as const;

/**
 * Check an `@3` file against the drawing contract's validity rules. Lists every violation as
 * `<json path>: <message>`. Never repairs. An `@2` or `@1` file is not handled here (see `readAnyFile`).
 */
export function validateFile3(raw: unknown, check: FileCheck = {}): ValidationReport3 {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  const missing: string[] = [];
  const absent = check.missingFiles === "warn" ? (path: string, msg: string) => { missing.push(`${path}: ${msg}`); } : err;
  if (!isObj(raw)) return { ok: false, errors: ["(root): must be a JSON object"], warnings: [], file: null };
  if (raw.schema === SCHEMA_V1) {
    return { ok: false, errors: ['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"'], warnings: [], file: null };
  }
  if (raw.schema !== SCHEMA_V3) err("schema", raw.schema === SCHEMA_V2 ? `is "${SCHEMA_V2}"; convert it first` : `must be "${SCHEMA_V3}"`);

  const str = (v: unknown, path: string, min: number, max: number) => {
    if (typeof v !== "string") return err(path, "must be a string");
    if (v.trim().length < min) return err(path, "must not be empty");
    if (v.length > max) err(path, `is ${v.length} characters; at most ${max}`);
  };
  const oneOf = (v: unknown, path: string, allowed: readonly string[], what: string) => {
    if (typeof v !== "string" || !allowed.includes(v)) err(path, `${q(v)} is not ${what}; use one of ${allowed.join(", ")}`);
  };
  const idOk = (v: unknown, path: string) => {
    if (typeof v !== "string" || !ID_RE.test(v)) { err(path, `${q(v)} is not a valid id (letters, digits, _ and -, 1–64 characters)`); return false; }
    return true;
  };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const items = (v: unknown, path: string) => {
    if (!Array.isArray(v)) return err(path, "must be an array of short strings ([] when none)");
    if (v.length > LIMITS.items) err(path, `has ${v.length} items; at most ${LIMITS.items}`);
    v.forEach((t, j) => str(t, `${path}[${j}]`, 1, LIMITS.item));
  };
  const own = (v: unknown, path: string, check: (v: unknown, path: string) => void) => { if (v !== undefined && v !== null) check(v, path); };
  // Rule 23: evidence entries, their paths as `files` are (rule 14).
  const evidence = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) return err(path, 'must be an array of {"file", "lines"} ([] when none)');
    if (v.length > FACT3_LIMITS.evidence) err(path, `has ${v.length} entries; at most ${FACT3_LIMITS.evidence}`);
    v.forEach((e, j) => {
      const p = `${path}[${j}]`;
      if (!isObj(e)) return err(p, 'must be {"file": path, "lines": [from, to] | null}');
      if (typeof e.file !== "string" || !isRepoRelative(e.file)) err(`${p}.file`, `${q(e.file)} must be a repository-relative path (no leading /, drive letter or ..)`);
      else if (check.fileExists && !check.fileExists(e.file.replace(/\\/g, "/"))) absent(`${p}.file`, `${q(e.file)} does not exist in the repository`);
      const l = e.lines;
      const ok = l === null || (Array.isArray(l) && l.length === 2 && l.every((x) => Number.isInteger(x)) && (l[0] as number) >= 1 && (l[0] as number) <= (l[1] as number));
      if (!ok) err(`${p}.lines`, "must be null or [from, to] with whole numbers 1 ≤ from ≤ to");
    });
  };

  if (raw.id !== undefined && (typeof raw.id !== "string" || !DOC_ID_RE.test(raw.id))) err("id", "must look like d_xxxxxx (lower-case letters and digits)");
  str(raw.title, "title", 1, LIMITS.title);
  if (raw.theme !== undefined) oneOf(raw.theme, "theme", THEMES, "a theme");
  if (raw.source !== undefined && raw.source !== null) {
    if (!isObj(raw.source) || raw.source.kind !== "local" || typeof raw.source.path !== "string" || !raw.source.path) err("source", 'must be null or {"kind": "local", "path": "<folder>"}');
  }
  if (raw.engine !== undefined && raw.engine !== null) {
    if (!isObj(raw.engine) || typeof raw.engine.id !== "string" || !(raw.engine.model === null || typeof raw.engine.model === "string")) err("engine", 'must be null or {"id": string, "model": string | null}');
  }
  for (const k of ["createdAt", "updatedAt"] as const) if (raw[k] !== undefined && typeof raw[k] !== "string") err(k, "must be an ISO date string");
  if (raw.warnings !== undefined && (!Array.isArray(raw.warnings) || raw.warnings.some((w) => typeof w !== "string"))) err("warnings", "must be an array of strings");

  // Facts (rules 2–4, 11, 14).
  const factIds = new Set<string>();
  const components = new Map<string, Record<string, unknown>>();
  const relations = new Map<string, Record<string, unknown>>();
  const facts = isObj(raw.facts) ? raw.facts : (err("facts", 'must be {"components": [...], "relations": [...]}'), {} as Record<string, unknown>);
  const comps = Array.isArray(facts.components) ? facts.components : (isObj(raw.facts) && err("facts.components", "must be an array of component facts"), []);
  if (comps.length > FACT_LIMITS.components) err("facts.components", `has ${comps.length} component facts; at most ${FACT_LIMITS.components}`);
  comps.forEach((c, i) => {
    const p = `facts.components[${i}]`;
    if (!isObj(c)) return err(p, "must be an object");
    if (idOk(c.id, `${p}.id`)) {
      if (factIds.has(c.id as string)) err(`${p}.id`, `${q(c.id)} is used twice; fact ids are unique among facts`);
      factIds.add(c.id as string);
      components.set(c.id as string, c);
    }
    str(c.label, `${p}.label`, 1, LIMITS.label);
    oneOf(c.kind, `${p}.kind`, KINDS, "a kind");
    str(c.sub, `${p}.sub`, 0, LIMITS.sub);
    str(c.description, `${p}.description`, 1, LIMITS.description);
    items(c.items, `${p}.items`);
    if (c.within !== undefined && c.within !== null && typeof c.within !== "string") err(`${p}.within`, "must be null or the id of a component fact");
    evidence(c.evidence, `${p}.evidence`);
    if (!Array.isArray(c.files)) err(`${p}.files`, "must be an array of repository-relative paths ([] when none)");
    else {
      if (c.files.length > LIMITS.files) err(`${p}.files`, `has ${c.files.length} paths; at most ${LIMITS.files}`);
      c.files.forEach((f, j) => {
        if (typeof f !== "string" || !isRepoRelative(f)) err(`${p}.files[${j}]`, `${q(f)} must be a repository-relative path (no leading /, drive letter or ..)`);
        else if (check.fileExists && !check.fileExists(f.replace(/\\/g, "/"))) absent(`${p}.files[${j}]`, `${q(f)} does not exist in the repository`);
      });
    }
  });
  const rels = facts.relations === undefined ? [] : Array.isArray(facts.relations) ? facts.relations : (err("facts.relations", "must be an array of relation facts"), []);
  if (rels.length > FACT_LIMITS.relations) err("facts.relations", `has ${rels.length} relation facts; at most ${FACT_LIMITS.relations}`);
  const relPairs = new Set<string>();
  rels.forEach((r, i) => {
    const p = `facts.relations[${i}]`;
    if (!isObj(r)) return err(p, "must be an object");
    if (idOk(r.id, `${p}.id`)) {
      if (factIds.has(r.id as string)) err(`${p}.id`, `${q(r.id)} is used twice; fact ids are unique among facts`);
      factIds.add(r.id as string);
      relations.set(r.id as string, r);
    }
    const fromOk = typeof r.from === "string" && components.has(r.from);
    const toOk = typeof r.to === "string" && components.has(r.to);
    if (!fromOk) err(`${p}.from`, `${q(r.from)} is not a component fact`);
    if (!toOk) err(`${p}.to`, `${q(r.to)} is not a component fact`);
    if (fromOk && toOk && r.from === r.to) err(p, "a component cannot relate to itself");
    str(r.label, `${p}.label`, 0, LIMITS.edgeLabel);
    oneOf(r.style, `${p}.style`, STYLES, "a style");
    if (typeof r.both !== "boolean") err(`${p}.both`, "must be true or false");
    evidence(r.evidence, `${p}.evidence`);
    if (fromOk && toOk) {
      const k = `${r.from}>${r.to}`, back = `${r.to}>${r.from}`;
      if (relPairs.has(k)) err(p, `a second relation ${r.from} → ${r.to}; fold it into one`);
      else if (relPairs.has(back)) err(p, `${r.from} → ${r.to} reverses an earlier relation; make that one two-way ("both": true) instead`);
      relPairs.add(k);
    }
  });

  // Rule 20: a mechanism names another component fact, which is no mechanism itself.
  comps.forEach((c, i) => {
    if (!isObj(c) || typeof c.within !== "string") return;
    const p = `facts.components[${i}].within`;
    const holder = components.get(c.within);
    if (c.within === c.id) err(p, "a component cannot be within itself");
    else if (!holder) err(p, `${q(c.within)} is not a component fact`);
    else if (typeof holder.within === "string") err(p, `${q(c.within)} is itself within ${q(holder.within)}; a mechanism is one level deep`);
  });

  // Limit facts (rules 2, 4, 21).
  const limitFacts = new Map<string, Record<string, unknown>>();
  const lims = facts.limits === undefined ? [] : Array.isArray(facts.limits) ? facts.limits : (err("facts.limits", "must be an array of limit facts"), []);
  if (lims.length > FACT_LIMITS.limits) err("facts.limits", `has ${lims.length} limit facts; at most ${FACT_LIMITS.limits}`);
  lims.forEach((l, i) => {
    const p = `facts.limits[${i}]`;
    if (!isObj(l)) return err(p, "must be an object");
    if (idOk(l.id, `${p}.id`)) {
      if (factIds.has(l.id as string)) err(`${p}.id`, `${q(l.id)} is used twice; fact ids are unique among facts`);
      factIds.add(l.id as string);
      limitFacts.set(l.id as string, l);
    }
    if (typeof l.on !== "string" || !components.has(l.on)) err(`${p}.on`, `${q(l.on)} is not a component fact`);
    str(l.text, `${p}.text`, 1, FACT3_LIMITS.limitText);
    evidence(l.evidence, `${p}.evidence`);
  });

  // Channels (rule 5).
  const channels = isObj(raw.channels) ? raw.channels : (err("channels", "must be an object with the overview channel"), {} as Record<string, unknown>);
  for (const k of Object.keys(channels)) if (!isChannel(k)) err(`channels.${k}`, `${q(k)} is not a channel; use one of ${CHANNELS.join(", ")}`);
  const viewIds = new Map<string, ChannelId>();
  const overviewViews = new Set<string>();
  for (const c of CHANNELS) {
    const ch = channels[c];
    if (!isObj(ch)) continue;
    for (const v of Array.isArray(ch.views) ? ch.views : []) if (isObj(v) && typeof v.id === "string" && !viewIds.has(v.id)) {
      viewIds.set(v.id, c);
      if (c === "overview") overviewViews.add(v.id);
    }
  }
  const shownInOverview = new Set<string>();
  const seenViews = new Set<string>();

  for (const c of CHANNELS) {
    const C = `channels.${c}`;
    const ch = channels[c];
    if (ch === undefined) { if (c === "overview" && isObj(raw.channels)) err(C, "is required"); continue; }
    if (!isObj(ch)) { err(C, "must be an object"); continue; }
    const props = c === "presentation" ? ["views", "showSteps", "outdated", "steps"] : ["views", "showSteps", "outdated"];
    for (const k of Object.keys(ch)) if (!props.includes(k)) err(`${C}.${k}`, `is not a property of this channel; use ${props.join(", ")}`);
    if (ch.showSteps !== undefined && typeof ch.showSteps !== "boolean") err(`${C}.showSteps`, "must be true or false");
    const views = ch.views === undefined ? (c === "overview" ? (err(`${C}.views`, "is required"), []) : []) : Array.isArray(ch.views) ? ch.views : (err(`${C}.views`, "must be an array"), []);
    const lim = CHANNEL_VIEWS[c];
    if (views.length < lim.min) err(`${C}.views`, `must hold at least ${lim.min} view`);
    if (views.length > lim.max) err(`${C}.views`, `has ${views.length} views; at most ${lim.max}`);
    if (ch.outdated !== undefined) {
      if (!Array.isArray(ch.outdated) || ch.outdated.some((id) => typeof id !== "string" || !ID_RE.test(id)) || new Set(ch.outdated).size !== ch.outdated.length) err(`${C}.outdated`, "must be distinct ids");
      else if (views.length === 0 && ch.outdated.length) err(`${C}.outdated`, "must be [] in a channel with no view");
    }
    const partIds = new Set<string>(), edgeIds = new Set<string>(), textIds = new Set<string>();
    const viewParts = new Map<string, Set<string>>();

    views.forEach((v, vi) => {
      const P = `${C}.views[${vi}]`;
      if (!isObj(v)) return err(P, "must be an object");
      if (idOk(v.id, `${P}.id`)) {
        if (seenViews.has(v.id as string)) err(`${P}.id`, `view id ${q(v.id)} is used twice; view ids are unique across the file`);
        seenViews.add(v.id as string);
      }
      str(v.title, `${P}.title`, 1, LIMITS.viewTitle);
      if (!isObj(v.caption)) err(`${P}.caption`, 'must be {"title": string, "lede": string}');
      else { str(v.caption.title, `${P}.caption.title`, 1, LIMITS.captionTitle); str(v.caption.lede, `${P}.caption.lede`, 0, LIMITS.lede); }
      if (v.subLines !== undefined && typeof v.subLines !== "boolean") err(`${P}.subLines`, "must be true or false when present");

      const nodes = Array.isArray(v.nodes) ? v.nodes : (err(`${P}.nodes`, "must be an array"), []);
      if (nodes.length > LIMITS.nodesPerView) err(`${P}.nodes`, `has ${nodes.length} parts; at most ${LIMITS.nodesPerView}`);
      const byId = new Map<string, Record<string, unknown>>();
      const shownHere = new Set<string>();
      nodes.forEach((n, i) => {
        const p = `${P}.nodes[${i}]`;
        if (!isObj(n)) return err(p, "must be an object");
        if (idOk(n.id, `${p}.id`)) {
          if (partIds.has(n.id as string)) err(`${p}.id`, `${q(n.id)} is used twice; part ids are unique within a channel`);
          partIds.add(n.id as string);
          byId.set(n.id as string, n);
        }
        // Rule 6: distinct component facts, each shown once per view.
        if (!Array.isArray(n.facts)) err(`${p}.facts`, "must be an array of component fact ids ([] for a part of this channel only)");
        else {
          if (new Set(n.facts).size !== n.facts.length) err(`${p}.facts`, "lists a fact twice");
          n.facts.forEach((f, j) => {
            if (typeof f !== "string" || !components.has(f)) return err(`${p}.facts[${j}]`, `${q(f)} is not a component fact`);
            if (shownHere.has(f)) err(`${p}.facts[${j}]`, `${q(f)} is already shown or held by another part of this view`);
            shownHere.add(f);
            if (c === "overview") shownInOverview.add(f);
          });
        }
        // Rule 22: held mechanisms within its facts, limits on its facts or held mechanisms.
        const own3 = new Set(Array.isArray(n.facts) ? (n.facts as string[]) : []);
        const held = n.held === undefined ? [] : Array.isArray(n.held) ? n.held : (err(`${p}.held`, "must be an array of mechanism fact ids"), []);
        if (new Set(held).size !== held.length) err(`${p}.held`, "lists a mechanism twice");
        held.forEach((h, j) => {
          const m = typeof h === "string" ? components.get(h) : undefined;
          if (!m) return err(`${p}.held[${j}]`, `${q(h)} is not a component fact`);
          if (typeof m.within !== "string" || !own3.has(m.within)) return err(`${p}.held[${j}]`, `${q(h)} is not a mechanism within a fact this part shows`);
          if (shownHere.has(h as string)) err(`${p}.held[${j}]`, `${q(h)} is already shown or held by another part of this view`);
          shownHere.add(h as string);
          if (c === "overview") shownInOverview.add(h as string);
        });
        const heldSet = new Set(held.filter((h): h is string => typeof h === "string"));
        const limits = n.limits === undefined ? [] : Array.isArray(n.limits) ? n.limits : (err(`${p}.limits`, "must be an array of limit fact ids"), []);
        if (new Set(limits).size !== limits.length) err(`${p}.limits`, "lists a limit twice");
        limits.forEach((l, j) => {
          const lim = typeof l === "string" ? limitFacts.get(l) : undefined;
          if (!lim) return err(`${p}.limits[${j}]`, `${q(l)} is not a limit fact`);
          if (!own3.has(lim.on as string) && !heldSet.has(lim.on as string)) err(`${p}.limits[${j}]`, `${q(l)} is not on a fact this part shows or holds`);
        });
        const single = Array.isArray(n.facts) && n.facts.length === 1;
        // Rule 7: no single fact → own label, kind and description.
        if (!single) for (const k of ["label", "kind", "description"] as const) {
          if (n[k] === undefined || n[k] === null) err(`${p}.${k}`, "is required on a part that shows no fact or several");
        }
        own(n.label, `${p}.label`, (x, path) => str(x, path, 1, LIMITS.label));
        own(n.kind, `${p}.kind`, (x, path) => oneOf(x, path, KINDS, "a kind"));
        own(n.sub, `${p}.sub`, (x, path) => str(x, path, 0, LIMITS.sub));
        own(n.description, `${p}.description`, (x, path) => str(x, path, 1, LIMITS.description));
        own(n.items, `${p}.items`, items);
        oneOf(n.form, `${p}.form`, FORMS, "a form");
        if (n.icon !== null) oneOf(n.icon, `${p}.icon`, ICONS, "an icon (use null for the kind's default)");
        // Rule 8: a panel shows at least one row (held, item or limit); other forms keep `items` null
        // and hold or show nothing. Rule 22: at most 12 rows.
        if (n.form === "panel") {
          const shown = Array.isArray(n.items) ? n.items : single && typeof n.facts !== "undefined" ? (components.get((n.facts as string[])[0])?.items as unknown[] | undefined) ?? [] : [];
          const rows = held.length + shown.length + limits.length;
          if (rows === 0) err(`${p}.items`, 'a panel shows what the part holds; give it items or use form "card"');
          else if (rows > LIMITS.items) err(p, `shows ${rows} rows (held, items and limits); at most ${LIMITS.items}`);
        } else if (FORMS.includes(n.form as Form)) {
          if (n.items !== undefined && n.items !== null) err(`${p}.items`, `only a panel shows items; set it to null or the form to "panel"`);
          if (held.length) err(`${p}.held`, `only a panel holds mechanisms; set it to [] or the form to "panel"`);
          if (limits.length) err(`${p}.limits`, `only a panel shows limits; set it to [] or the form to "panel"`);
        }
        if (!("parent" in n)) err(`${p}.parent`, "is required (null for top level)");
        if (!("detail" in n)) err(`${p}.detail`, "is required (null when the part has no inside view)");
        else if (n.detail !== null) {
          if (c !== "overview") err(`${p}.detail`, "must be null outside the overview channel");
          else if (typeof n.detail !== "string" || !overviewViews.has(n.detail)) err(`${p}.detail`, `${q(n.detail)} is not a view of the overview channel`);
          else if (n.detail === v.id) err(`${p}.detail`, "must name a view other than the one the part is in");
        }
        if (!("place" in n)) err(`${p}.place`, "is required (null when the layout should choose)");
        else if (n.place !== null) {
          const pl = n.place;
          const okInt = (x: unknown) => Number.isInteger(x) && Math.abs(x as number) <= LIMITS.place;
          if (!isObj(pl) || !okInt(pl.row) || !okInt(pl.col)) err(`${p}.place`, `must be null or {"row": integer, "col": integer} within ±${LIMITS.place}`);
        }
        if (n.lane !== undefined && n.lane !== null) {
          const l = n.lane;
          const spine = isObj(l) && Object.keys(l).length === 1 && Number.isInteger(l.spine) && (l.spine as number) >= 0;
          const side = isObj(l) && Object.keys(l).length === 2 && typeof l.anchor === "string" && (l.side === "above" || l.side === "below");
          if (!spine && !side) err(`${p}.lane`, 'must be null, {"spine": non-negative integer}, or {"anchor": id, "side": "above" | "below"}');
        }
        const hasX = n.x !== undefined, hasY = n.y !== undefined;
        if (hasX !== hasY) err(`${p}.${hasX ? "y" : "x"}`, "x and y are both present or both absent");
        else if (hasX && (!finite(n.x) || !finite(n.y))) err(`${p}.x`, "x and y must be finite numbers");
      });
      checkLanesAndParents(nodes, byId, P, err);

      const edges = Array.isArray(v.edges) ? v.edges : (err(`${P}.edges`, "must be an array"), []);
      const pairs = new Set<string>();
      const relShown = new Set<string>();
      edges.forEach((e, i) => {
        const p = `${P}.edges[${i}]`;
        if (!isObj(e)) return err(p, "must be an object");
        if (e.id !== undefined && idOk(e.id, `${p}.id`)) {
          if (edgeIds.has(e.id as string)) err(`${p}.id`, `${q(e.id)} is used twice; connection ids are unique within a channel`);
          edgeIds.add(e.id as string);
        }
        const a = typeof e.from === "string" ? byId.get(e.from) : undefined;
        const b = typeof e.to === "string" ? byId.get(e.to) : undefined;
        if (!a) err(`${p}.from`, `${q(e.from)} is not a part in this view`);
        if (!b) err(`${p}.to`, `${q(e.to)} is not a part in this view`);
        if (a && b && e.from === e.to) err(p, "a part cannot connect to itself");
        own(e.label, `${p}.label`, (x, path) => str(x, path, 0, LIMITS.edgeLabel));
        own(e.style, `${p}.style`, (x, path) => oneOf(x, path, STYLES, "a style"));
        own(e.both, `${p}.both`, (x, path) => { if (typeof x !== "boolean") err(path, "must be true, false or null"); });
        if (e.step !== null && !(Number.isInteger(e.step) && (e.step as number) > 0)) err(`${p}.step`, "must be null or a positive integer");
        if (a && b) {
          const k = `${e.from}>${e.to}`, back = `${e.to}>${e.from}`;
          if (pairs.has(k)) err(p, `a second connection ${e.from} → ${e.to}; fold it into one label`);
          else if (pairs.has(back)) err(p, `${e.from} → ${e.to} reverses an earlier connection; make that one two-way ("both": true) instead`);
          pairs.add(k);
        }
        const rs = e.relations === undefined ? [] : Array.isArray(e.relations) ? e.relations : (err(`${p}.relations`, "must be an array of relation fact ids"), []);
        if (new Set(rs).size !== rs.length) err(`${p}.relations`, "lists a relation twice");
        rs.forEach((r, j) => {
          const rel = typeof r === "string" ? relations.get(r) : undefined;
          if (!rel) return err(`${p}.relations[${j}]`, `${q(r)} is not a relation fact`);
          if (relShown.has(r as string)) err(`${p}.relations[${j}]`, `${q(r)} is already shown by another connection of this view`);
          relShown.add(r as string);
          if (!a || !b) return;
          const fa = new Set(Array.isArray(a.facts) ? (a.facts as string[]) : []), fb = new Set(Array.isArray(b.facts) ? (b.facts as string[]) : []);
          const forward = fa.has(rel.from as string) && fb.has(rel.to as string), backward = fb.has(rel.from as string) && fa.has(rel.to as string);
          if (!forward && !backward) err(`${p}.relations[${j}]`, `${q(r)} does not join a fact of ${q(e.from)} with a fact of ${q(e.to)}`);
          else if (rs.length === 1 && (e.both === undefined || e.both === null) && !forward && rel.both !== true) err(`${p}.relations[${j}]`, `${q(r)} runs the other way; swap "from" and "to"`);
        });
      });

      viewParts.set(v.id as string, new Set(byId.keys()));
      const texts = v.texts === undefined ? [] : Array.isArray(v.texts) ? v.texts : (err(`${P}.texts`, "must be an array"), []);
      texts.forEach((t, i) => {
        const p = `${P}.texts[${i}]`;
        if (!isObj(t)) return err(p, "must be an object");
        if (idOk(t.id, `${p}.id`)) {
          if (textIds.has(t.id as string)) err(`${p}.id`, `${q(t.id)} is used twice; text ids are unique within a channel`);
          textIds.add(t.id as string);
        }
        str(t.text, `${p}.text`, 1, LIMITS.text);
        if (!finite(t.x) || !finite(t.y)) err(`${p}.x`, "x and y must be finite numbers");
        if (t.size !== undefined && (!finite(t.size) || (t.size as number) < TEXT_SIZE.min || (t.size as number) > TEXT_SIZE.max)) err(`${p}.size`, `must be a number from ${TEXT_SIZE.min} to ${TEXT_SIZE.max}`);
      });
    });

    // Rule 24: the presentation's steps name parts of its view.
    if (c === "presentation" && ch.steps !== undefined) {
      const steps = Array.isArray(ch.steps) ? ch.steps : (err(`${C}.steps`, "must be an array of steps"), []);
      if (steps.length > FACT3_LIMITS.steps) err(`${C}.steps`, `has ${steps.length} steps; at most ${FACT3_LIMITS.steps}`);
      if (steps.length && views.length === 0) err(`${C}.steps`, "must be [] in a channel with no view");
      const parts = viewParts.values().next().value ?? new Set<string>();
      const stepIds = new Set<string>();
      steps.forEach((st, i) => {
        const p = `${C}.steps[${i}]`;
        if (!isObj(st)) return err(p, "must be an object");
        if (idOk(st.id, `${p}.id`)) {
          if (stepIds.has(st.id as string)) err(`${p}.id`, `${q(st.id)} is used twice; step ids are unique within a channel`);
          stepIds.add(st.id as string);
        }
        if (!Array.isArray(st.parts) || st.parts.length < 1 || st.parts.length > LIMITS.nodesPerView) err(`${p}.parts`, `must name 1–${LIMITS.nodesPerView} parts of the view`);
        else {
          if (new Set(st.parts).size !== st.parts.length) err(`${p}.parts`, "lists a part twice");
          st.parts.forEach((id, j) => { if (typeof id !== "string" || !parts.has(id)) err(`${p}.parts[${j}]`, `${q(id)} is not a part of the presentation view`); });
        }
        str(st.text, `${p}.text`, 1, FACT3_LIMITS.stepText);
        str(st.note, `${p}.note`, 0, FACT3_LIMITS.stepNote);
      });
    }
  }

  // Rule 16: the overview is the complete map.
  if (isObj(channels.overview)) components.forEach((_, id) => {
    if (!shownInOverview.has(id)) err(`facts.components[${comps.findIndex((c) => isObj(c) && c.id === id)}]`, `${q(id)} is shown or held by no part of the overview channel; draw it there or remove it`);
  });

  // Rule 18: requests.
  const requestIds = new Set<string>();
  if (raw.requests !== undefined) {
    if (!Array.isArray(raw.requests)) err("requests", "must be an array");
    else raw.requests.forEach((r, i) => {
      const p = `requests[${i}]`;
      if (!isObj(r)) return err(p, "must be an object");
      if (idOk(r.id, `${p}.id`)) {
        if (requestIds.has(r.id as string)) err(`${p}.id`, `${q(r.id)} is used twice`);
        requestIds.add(r.id as string);
      }
      str(r.text, `${p}.text`, 1, LIMITS.request);
      if (!isChannel(r.channel)) err(`${p}.channel`, `${q(r.channel)} is not a channel; use one of ${CHANNELS.join(", ")}`);
      else if (typeof r.view !== "string" || viewIds.get(r.view) !== r.channel) err(`${p}.view`, `view ${q(r.view)} is not in the ${r.channel} channel`);
      if (typeof r.at !== "string") err(`${p}.at`, "must be an ISO date string");
    });
  }

  if (errors.length) return { ok: false, errors, warnings: [], file: null };
  return { ok: true, errors: [], warnings: missing, file: raw as unknown as File3 };
}

/** Lanes and parents need every part of the view known first (rules 9, 19). */
function checkLanesAndParents(nodes: unknown[], byId: Map<string, Record<string, unknown>>, P: string, err: (path: string, msg: string) => void) {
  const spineOrders = new Set<string>();
  nodes.forEach((n, i) => {
    if (!isObj(n) || !isObj(n.lane)) return;
    const p = `${P}.nodes[${i}].lane`;
    if (Number.isInteger(n.lane.spine)) {
      const key = `${n.parent ?? ""}:${n.lane.spine}`;
      if (spineOrders.has(key)) err(p, "spine order must be unique among siblings");
      spineOrders.add(key);
    } else if (typeof n.lane.anchor === "string") {
      const anchor = byId.get(n.lane.anchor);
      if (!anchor || !isObj(anchor.lane) || !Number.isInteger(anchor.lane.spine)) err(p, "anchor must name a spine part in this view");
      const seen = new Set<string>();
      for (let cur = anchor; cur && !seen.has(cur.id as string); cur = typeof cur.parent === "string" ? byId.get(cur.parent) : undefined) {
        if (cur.id === n.id) { err(p, "anchor cannot be itself or a descendant"); break; }
        seen.add(cur.id as string);
      }
    }
  });
  nodes.forEach((n, i) => {
    if (!isObj(n) || n.parent === null || n.parent === undefined) return;
    const p = `${P}.nodes[${i}].parent`;
    const par = typeof n.parent === "string" ? byId.get(n.parent) : undefined;
    if (!par) return err(p, `${q(n.parent)} is not a part in this view`);
    if (par.form !== "group") return err(p, `${q(n.parent)} is a ${String(par.form)}; only a group holds parts`);
    let depth = 1;
    const seen = new Set<string>([n.id as string]);
    for (let cur: Record<string, unknown> | undefined = par; cur; ) {
      if (seen.has(cur.id as string)) return err(p, "a part cannot be inside itself");
      seen.add(cur.id as string);
      const up: unknown = cur.parent;
      if (up === null || up === undefined) break;
      depth++;
      cur = typeof up === "string" ? byId.get(up) : undefined;
    }
    if (depth > LIMITS.depth) err(p, `nests ${depth} groups deep; at most ${LIMITS.depth}`);
  });
}

const emptyChannel = (): Channel => ({ views: [], showSteps: false, outdated: [] });

/**
 * Defaults for every optional field except positions and connection ids (normalisation). Own
 * texts that are null are left out. Returns a new object; positions stay as they are.
 */
export function fillDefaults3(file: File3, ctx: { id?: string; now?: string; source?: DiagramSource | null } = {}): Document3 {
  const now = ctx.now ?? new Date(0).toISOString();
  const copy = structuredClone(file);
  const channel = (c: ChannelId): Channel => {
    const ch = (copy.channels as Partial<Record<ChannelId, ChannelInput>>)[c];
    if (!ch) return emptyChannel();
    return {
      views: (ch.views ?? []).map((v) => ({
        ...v,
        nodes: v.nodes.map((n) => dropNullOwn({ ...n, lane: n.lane ?? null }, OWN_PART)) as Part[],
        edges: v.edges.map((e) => dropNullOwn({ ...e, relations: e.relations ?? [] }, OWN_EDGE)) as Connection[],
        texts: (v.texts ?? []).map((t) => ({ ...t, size: t.size ?? TEXT_SIZE.default })),
      })),
      showSteps: ch.showSteps ?? false,
      outdated: ch.outdated ?? [],
      ...(c === "presentation" && ch.steps !== undefined ? { steps: ch.steps } : {}),
    };
  };
  return {
    schema: SCHEMA_V3,
    id: copy.id ?? ctx.id ?? "d_unsaved",
    title: copy.title,
    theme: copy.theme ?? "light",
    source: ctx.source !== undefined ? ctx.source : copy.source ?? null,
    engine: copy.engine ?? null,
    createdAt: copy.createdAt ?? now,
    updatedAt: copy.updatedAt ?? now,
    facts: { components: copy.facts.components, relations: copy.facts.relations ?? [], ...(copy.facts.limits !== undefined ? { limits: copy.facts.limits } : {}) },
    channels: { overview: channel("overview"), linkedin: channel("linkedin"), readme: channel("readme"), presentation: channel("presentation") },
    requests: copy.requests ?? [],
    warnings: copy.warnings ?? [],
  };
}

function dropNullOwn<T extends Record<string, unknown>>(o: T, keys: readonly string[]): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) if (out[k] === null || out[k] === undefined) delete out[k];
  return out as T;
}

/** Validate a stored `@3` document (PUT, the store): the file rules, plus the fields normalisation guarantees. */
export function validateDocument3(raw: unknown, check: FileCheck = {}): { ok: true; doc: Document3 } | { ok: false; error: string; errors: string[] } {
  const r = validateFile3(raw, check);
  const errors = [...r.errors];
  if (r.ok) {
    const d = raw as Record<string, unknown>;
    if (typeof d.id !== "string") errors.push("id: is required in a stored document");
    for (const c of CHANNELS) {
      const ch = (r.file!.channels as Partial<Record<ChannelId, ChannelInput>>)[c];
      (ch?.views ?? []).forEach((v, vi) => {
        v.nodes.forEach((n, i) => { if (n.x === undefined) errors.push(`channels.${c}.views[${vi}].nodes[${i}].x: a stored part needs a position`); });
        v.edges.forEach((e, i) => { if (e.id === undefined) errors.push(`channels.${c}.views[${vi}].edges[${i}].id: a stored connection needs an id`); });
      });
    }
  }
  if (errors.length) return { ok: false, error: `Invalid diagram — ${errors[0]}`, errors };
  return { ok: true, doc: fillDefaults3(r.file!) };
}

/** Give every connection without an id the next free `e<n>` of its channel (normalisation). */
export function assignConnectionIds(doc: { channels: Record<ChannelId, { views: { edges: { id?: string }[]; nodes: { id: string }[]; texts?: { id: string }[] }[] }> }): void {
  for (const c of CHANNELS) {
    const ch = doc.channels[c];
    const used = new Set<string>();
    for (const v of ch.views) { for (const n of v.nodes) used.add(n.id); for (const e of v.edges) if (e.id) used.add(e.id); for (const t of v.texts ?? []) used.add(t.id); }
    let n = 1;
    for (const v of ch.views) for (const e of v.edges) {
      if (e.id) continue;
      while (used.has(`e${n}`)) n++;
      e.id = `e${n}`;
      used.add(e.id);
    }
  }
}

/** The channel holding a view, or null. View ids are unique across the file. */
export function channelOfView(doc: Pick<Document3, "channels">, viewId: string): ChannelId | null {
  for (const c of CHANNELS) if (doc.channels[c].views.some((v) => v.id === viewId)) return c;
  return null;
}

/** The first free id among `used`, trying `base`, then `base-2`, `base-3`, … (cut to 64 chars). */
export function freeIdAmong(used: Set<string>, base: string): string {
  const clean = base.slice(0, 64);
  if (!used.has(clean)) return clean;
  for (let k = 2; ; k++) {
    const suffix = `-${k}`;
    const id = `${clean.slice(0, 64 - suffix.length)}${suffix}`;
    if (!used.has(id)) return id;
  }
}
