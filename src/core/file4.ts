/**
 * The stored drawing file `archdraw/diagram@4` (docs/contracts/diagram.md, *Choice*; ADR 0015): the
 * document's own fields and a list of choices, each holding facts and four channels in exactly the
 * shape an `@3` file held them. Every rule inside a choice is the `@3` rule, checked by `validateFile3`
 * on that choice alone and reported under `choices[<i>].`; this file adds the rules between choices.
 * Pure: no Node or DOM APIs (invariant 4).
 */
import { ID_RE, LIMITS, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, type DiagramSource, type EngineRef, type FileCheck, type Theme } from "./model";
import {
  CHANNELS, fillDefaults3, isChannel, validateFile3,
  type Channel, type ChannelId, type ChannelInput, type Document3, type Facts, type File3, type Request3, type ViewInput3,
} from "./file3";
import { channelWarnings, markOutside, normalizeFile3 } from "./channels";

export const CHOICE_KINDS = ["system", "section", "flow", "custom"] as const;
export type ChoiceKind = (typeof CHOICE_KINDS)[number];
export const CHOICE_LIMITS = { choices: 12, title: 80, about: 300 } as const;
/** The one choice a converted `@3` file becomes (diagram contract, *Reading `archdraw/diagram@3`*). */
export const SYSTEM_CHOICE = { id: "system", title: "The whole system", kind: "system" as const };
const CHOICE_KEYS = ["id", "title", "kind", "about", "facts", "channels"];

export interface Choice4 { id: string; title: string; kind: ChoiceKind; about: string; facts: Facts; channels: Record<ChannelId, Channel> }
export interface Request4 extends Request3 { choice: string }
export interface Document4 {
  schema: typeof SCHEMA_V4;
  id: string; title: string; theme: Theme; source: DiagramSource | null; engine: EngineRef | null;
  createdAt: string; updatedAt: string;
  choices: Choice4[];
  requests: Request4[]; warnings: string[];
}

/** A file as a session writes it: positions, connection ids and defaults may be missing. */
export interface ChoiceInput4 { id: string; title: string; kind: ChoiceKind; about?: string; facts: File3["facts"]; channels: File3["channels"] }
export interface File4 {
  schema: typeof SCHEMA_V4; id?: string; title: string; theme?: Theme;
  source?: DiagramSource | null; engine?: EngineRef | null; createdAt?: string; updatedAt?: string;
  choices: ChoiceInput4[];
  requests?: Request4[]; warnings?: string[];
}
export interface ValidationReport4 { ok: boolean; errors: string[]; warnings: string[]; file: File4 | null }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const q = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v));
const DOC_KEYS = ["id", "title", "theme", "source", "engine", "createdAt", "updatedAt", "warnings"] as const;
/** The smallest valid `@3` body, so the document's own fields are checked by the `@3` rules alone. */
const EMPTY_BODY = { facts: { components: [] }, channels: { overview: { views: [{ id: "v", title: "v", caption: { title: "v", lede: "" }, nodes: [], edges: [] }] } } };
const inChoice = (line: string) => /^(facts|channels)\b/.test(line);

/**
 * Check an `@4` file against the drawing contract's validity rules. Lists every violation as
 * `<json path>: <message>`, a choice's own under `choices[<i>].`. Never repairs. An `@3`, `@2` or
 * `@1` file is not handled here (see `readAnyFile`).
 */
export function validateFile4(raw: unknown, check: FileCheck = {}): ValidationReport4 {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  if (!isObj(raw)) return { ok: false, errors: ["(root): must be a JSON object"], warnings: [], file: null };
  if (raw.schema === SCHEMA_V1) return { ok: false, errors: ['schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"'], warnings: [], file: null };
  if (raw.schema !== SCHEMA_V4) err("schema", raw.schema === SCHEMA_V3 || raw.schema === SCHEMA_V2 ? `is "${raw.schema}"; convert it first` : `must be "${SCHEMA_V4}"`);

  // The document's own fields, by the @3 rules.
  const own: Record<string, unknown> = { schema: SCHEMA_V3, ...EMPTY_BODY };
  for (const k of DOC_KEYS) if (raw[k] !== undefined) own[k] = raw[k];
  errors.push(...validateFile3(own).errors.filter((e) => !inChoice(e) && !e.startsWith("schema")));

  // Rule 25: the choices; rules inside a choice are its @3 rules.
  const choices = Array.isArray(raw.choices) ? raw.choices : (err("choices", `must be an array of 1–${CHOICE_LIMITS.choices} choices`), []);
  if (Array.isArray(raw.choices) && choices.length < 1) err("choices", "must hold at least one choice");
  if (choices.length > CHOICE_LIMITS.choices) err("choices", `has ${choices.length} choices; at most ${CHOICE_LIMITS.choices}`);
  const choiceIds = new Set<string>();
  /** Every choice's channel of each view id, for rule 2 across the file and for requests (rule 18). */
  const viewsOf = new Map<string, Map<string, ChannelId>>();
  const viewOwner = new Map<string, string>();
  let system: number | null = null;
  choices.forEach((c, i) => {
    const P = `choices[${i}]`;
    if (!isObj(c)) return err(P, "must be an object");
    for (const k of Object.keys(c)) if (!CHOICE_KEYS.includes(k)) err(`${P}.${k}`, `is not a field of a choice; a choice holds ${CHOICE_KEYS.join(", ")}`);
    if (typeof c.id !== "string" || !ID_RE.test(c.id)) err(`${P}.id`, `${q(c.id)} is not a valid id (letters, digits, _ and -, 1–64 characters)`);
    else if (choiceIds.has(c.id)) err(`${P}.id`, `${q(c.id)} is used twice; choice ids are unique`);
    else choiceIds.add(c.id);
    if (typeof c.title !== "string") err(`${P}.title`, "must be a string");
    else if (!c.title.trim()) err(`${P}.title`, "must not be empty");
    else if (c.title.length > CHOICE_LIMITS.title) err(`${P}.title`, `is ${c.title.length} characters; at most ${CHOICE_LIMITS.title}`);
    if (typeof c.kind !== "string" || !(CHOICE_KINDS as readonly string[]).includes(c.kind)) err(`${P}.kind`, `${q(c.kind)} is not a kind of choice; use one of ${CHOICE_KINDS.join(", ")}`);
    else if (c.kind === "system") {
      if (system !== null) err(`${P}.kind`, `choices[${system}] is already the system choice; a file holds at most one`);
      else system = i;
    }
    if (c.about !== undefined) {
      if (typeof c.about !== "string") err(`${P}.about`, "must be a string");
      else if (c.about.length > CHOICE_LIMITS.about) err(`${P}.about`, `is ${c.about.length} characters; at most ${CHOICE_LIMITS.about}`);
    }
    const r = validateFile3({ schema: SCHEMA_V3, title: "choice", facts: c.facts, channels: c.channels }, check);
    errors.push(...r.errors.filter(inChoice).map((e) => `${P}.${e}`));
    warnings.push(...r.warnings.map((w) => `${P}.${w}`));
    // Rule 2: view ids are unique across the file.
    const mine = new Map<string, ChannelId>();
    if (isObj(c.channels)) for (const ch of CHANNELS) {
      const views = isObj(c.channels[ch]) ? (c.channels[ch] as ChannelInput).views : undefined;
      if (!Array.isArray(views)) continue;
      views.forEach((v: ViewInput3, k) => {
        if (!isObj(v) || typeof v.id !== "string") return;
        const owner = viewOwner.get(v.id);
        if (owner !== undefined && owner !== String(i)) err(`${P}.channels.${ch}.views[${k}].id`, `${q(v.id)} is a view of choices[${owner}]; view ids are unique across the file`);
        else viewOwner.set(v.id, String(i));
        mine.set(v.id, ch);
      });
    }
    if (typeof c.id === "string") viewsOf.set(c.id, mine);
  });

  // Rule 18: a request names an existing choice, one of its channels and one of that channel's views.
  if (raw.requests !== undefined) {
    if (!Array.isArray(raw.requests)) err("requests", "must be an array");
    else {
      const ids = new Set<string>();
      raw.requests.forEach((r, i) => {
        const p = `requests[${i}]`;
        if (!isObj(r)) return err(p, "must be an object");
        if (typeof r.id !== "string" || !ID_RE.test(r.id)) err(`${p}.id`, `${q(r.id)} is not a valid id (letters, digits, _ and -, 1–64 characters)`);
        else if (ids.has(r.id)) err(`${p}.id`, `${q(r.id)} is used twice`);
        else ids.add(r.id);
        if (typeof r.text !== "string" || !r.text.trim()) err(`${p}.text`, "must not be empty");
        else if (r.text.length > LIMITS.request) err(`${p}.text`, `is ${r.text.length} characters; at most ${LIMITS.request}`);
        const views = typeof r.choice === "string" ? viewsOf.get(r.choice) : undefined;
        if (!views) err(`${p}.choice`, `${q(r.choice)} is not a choice of this file`);
        else if (!isChannel(r.channel)) err(`${p}.channel`, `${q(r.channel)} is not a channel; use one of ${CHANNELS.join(", ")}`);
        else if (typeof r.view !== "string" || views.get(r.view) !== r.channel) err(`${p}.view`, `view ${q(r.view)} is not in the ${r.channel} channel of the choice ${q(r.choice)}`);
        if (typeof r.at !== "string") err(`${p}.at`, "must be an ISO date string");
      });
    }
  }

  if (errors.length) return { ok: false, errors, warnings: [], file: null };
  return { ok: true, errors: [], warnings, file: raw as unknown as File4 };
}

/** One choice as an `@3` file of its own, the document's fields around it (validation, defaults, normalisation). */
const asFile3 = (file: Omit<File4, "choices">, c: ChoiceInput4): File3 => ({
  schema: SCHEMA_V3, title: file.title, facts: c.facts, channels: c.channels,
  ...(file.id !== undefined ? { id: file.id } : {}),
});

/** Defaults for every optional field except positions and connection ids (normalisation). Returns a new object. */
export function fillDefaults4(file: File4, ctx: { id?: string; now?: string; source?: DiagramSource | null } = {}): Document4 {
  const now = ctx.now ?? new Date(0).toISOString();
  const copy = structuredClone(file);
  return {
    schema: SCHEMA_V4,
    id: copy.id ?? ctx.id ?? "d_unsaved",
    title: copy.title,
    theme: copy.theme ?? "light",
    source: ctx.source !== undefined ? ctx.source : copy.source ?? null,
    engine: copy.engine ?? null,
    createdAt: copy.createdAt ?? now,
    updatedAt: copy.updatedAt ?? now,
    choices: copy.choices.map((c) => {
      const d = fillDefaults3(asFile3(copy, c));
      return { id: c.id, title: c.title, kind: c.kind, about: c.about ?? "", facts: d.facts, channels: d.channels };
    }),
    requests: copy.requests ?? [],
    warnings: copy.warnings ?? [],
  };
}

/** Validate a stored `@4` document (PUT, the store): the file rules, plus the fields normalisation guarantees. */
export function validateDocument4(raw: unknown, check: FileCheck = {}): { ok: true; doc: Document4 } | { ok: false; error: string; errors: string[] } {
  const r = validateFile4(raw, check);
  const errors = [...r.errors];
  if (r.ok) {
    if (typeof (raw as Record<string, unknown>).id !== "string") errors.push("id: is required in a stored document");
    r.file!.choices.forEach((c, i) => {
      for (const ch of CHANNELS) {
        const views = (c.channels as Partial<Record<ChannelId, ChannelInput>>)[ch]?.views ?? [];
        views.forEach((v, vi) => {
          const P = `choices[${i}].channels.${ch}.views[${vi}]`;
          v.nodes.forEach((n, k) => { if (n.x === undefined) errors.push(`${P}.nodes[${k}].x: a stored part needs a position`); });
          v.edges.forEach((e, k) => { if (e.id === undefined) errors.push(`${P}.edges[${k}].id: a stored connection needs an id`); });
        });
      }
    });
  }
  if (errors.length) return { ok: false, error: `Invalid diagram — ${errors[0]}`, errors };
  return { ok: true, doc: fillDefaults4(r.file!) };
}

/**
 * An `@3` file as `@4` (diagram contract, *Reading `archdraw/diagram@3`*): its facts and channels become
 * its one choice, the whole system, unchanged; the document's fields stay; every request names it. No warning.
 */
export function convertV3(file: File3): File4 {
  const { schema: _schema, facts, channels, requests, ...rest } = file;
  return {
    schema: SCHEMA_V4, ...rest,
    choices: [{ ...SYSTEM_CHOICE, about: "", facts, channels }],
    ...(requests !== undefined ? { requests: requests.map((r) => ({ ...r, choice: SYSTEM_CHOICE.id })) } : {}),
  };
}

/** The choice that holds a view, or null. View ids are unique across the file. */
export function choiceOfView(doc: Pick<Document4, "choices">, viewId: string): Choice4 | null {
  return doc.choices.find((c) => CHANNELS.some((ch) => c.channels[ch].views.some((v) => v.id === viewId))) ?? null;
}

/**
 * The choice a request, an export or a run acts on (api contract): `choice` when given, else the
 * choice holding `view` when given, else the first. A string is the refusal.
 */
export function resolveChoice(doc: Pick<Document4, "choices">, choice: string | null | undefined, view: string | null | undefined): Choice4 | string {
  if (choice) return doc.choices.find((c) => c.id === choice) ?? `Unknown choice "${choice}"`;
  if (view) return choiceOfView(doc, view) ?? doc.choices[0];
  return doc.choices[0];
}

/**
 * One choice as an `@3` document: the shape every per-choice operation (joining a channel, an edit's
 * split, a run, an export) works on. Its requests are the choice's own.
 */
export function choiceDoc(doc: Document4, choiceId?: string | null): Document3 {
  const c = doc.choices.find((x) => x.id === choiceId) ?? doc.choices[0];
  const taken = doc.choices.filter((x) => x !== c).flatMap((x) => CHANNELS.flatMap((ch) => x.channels[ch].views.map((v) => v.id)));
  return {
    schema: SCHEMA_V3, ids: { prefix: c === doc.choices[0] ? null : c.id, taken, system: c.kind === "system" },
    id: doc.id, title: doc.title, theme: doc.theme, source: doc.source, engine: doc.engine,
    createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    facts: c.facts, channels: c.channels,
    requests: doc.requests.filter((r) => r.choice === c.id).map(({ choice: _c, ...r }) => r),
    warnings: doc.warnings,
  };
}

/**
 * Write a changed choice back (an edit is made in one choice and changes only it): the choice's facts,
 * channels and requests from `d`, the document's own fields too; every other choice stays as it was.
 */
export function withChoice(doc: Document4, choiceId: string, d: Document3): Document4 {
  const id = doc.choices.some((c) => c.id === choiceId) ? choiceId : doc.choices[0].id;
  let at = 0;
  const requests: Request4[] = [];
  // The choice's requests keep their place among the others'.
  for (const r of doc.requests) {
    if (r.choice !== id) requests.push(r);
    else if (at < d.requests.length) requests.push({ ...d.requests[at++], choice: id });
  }
  for (; at < d.requests.length; at++) requests.push({ ...d.requests[at], choice: id });
  return {
    ...doc,
    title: d.title, theme: d.theme, source: d.source, engine: d.engine, createdAt: d.createdAt, updatedAt: d.updatedAt, warnings: d.warnings,
    choices: doc.choices.map((c) => (c.id === id ? { ...c, facts: d.facts, channels: d.channels } : c)),
    requests,
  };
}

/** A new `@4` document of one choice made from an `@3` document (a draw's result, a test). */
export function documentOf(d: Document3, choice: Pick<Choice4, "id" | "title" | "kind" | "about"> = { ...SYSTEM_CHOICE, about: "" }): Document4 {
  const { schema: _s, facts, channels, requests, ...rest } = d;
  return { schema: SCHEMA_V4, ...rest, choices: [{ ...choice, facts, channels }], requests: requests.map((r) => ({ ...r, choice: choice.id })) };
}

/**
 * Normalisation of a valid `@4` file (contract, Normalisation): defaults, and in every choice its
 * connection ids, a position for every part that has none and group positions. Returns a new document.
 */
export function normalizeFile4(file: File4, ctx: { id: string; now: string; source?: DiagramSource | null }): Document4 {
  const doc = fillDefaults4(file, { id: file.id ?? ctx.id, now: ctx.now, source: ctx.source });
  doc.choices = doc.choices.map((c, i) => {
    const d = normalizeFile3(asFile3(file, file.choices[i]), { id: doc.id, now: ctx.now, source: doc.source });
    return { ...c, facts: d.facts, channels: d.channels };
  });
  return doc;
}

/** An outside write (contract, Edits): in each choice it changed, the channels whose views it did not change get marks. */
export function markOutside4(before: Document4, after: Document4): Document4 {
  let out = after;
  for (const c of after.choices) {
    if (!before.choices.some((b) => b.id === c.id)) continue;
    out = withChoice(out, c.id, markOutside(choiceDoc(before, c.id), choiceDoc(out, c.id)));
  }
  return out;
}

/** The depth checks on every channel view of every choice (contract, Warnings), under `choices[<i>].`. */
export function channelWarnings4(doc: Document4): string[] {
  return doc.choices.flatMap((c, i) => channelWarnings(choiceDoc(doc, c.id)).map((w) => `choices[${i}].${w}`));
}

/**
 * A slug (api contract, The choices): lower-cased, accents removed, every run of other characters
 * than a–z and 0–9 one `-`, cut to 40, `-` trimmed from both ends; empty is `choice`.
 */
export function slugOf(text: string): string {
  const s = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");
  return s || "choice";
}

/** What a draw's requested focus becomes as a choice (api contract, The choices); `used` holds the earlier choices' ids. */
export function choiceOfFocus(
  f: { kind: "whole" } | { kind: "option"; option: { title: string; sentence: string; kind?: string } } | { kind: "typed"; text: string },
  used: ReadonlySet<string> = new Set(),
): Pick<Choice4, "id" | "title" | "kind" | "about"> {
  if (f.kind === "whole") return { ...SYSTEM_CHOICE, about: "" };
  const free = (base: string) => {
    if (base !== SYSTEM_CHOICE.id && !used.has(base)) return base;
    for (let k = 2; ; k++) if (!used.has(`${base}-${k}`)) return `${base}-${k}`;
  };
  if (f.kind === "option") {
    const kind: ChoiceKind = f.option.kind === "section" ? "section" : "flow";
    return { id: free(slugOf(f.option.title)), title: f.option.title.slice(0, CHOICE_LIMITS.title), kind, about: f.option.sentence.slice(0, CHOICE_LIMITS.about) };
  }
  const text = f.text.trim();
  return { id: free(slugOf(text)), title: text.length > CHOICE_LIMITS.title ? `${text.slice(0, CHOICE_LIMITS.title - 1)}…` : text, kind: "custom", about: text.slice(0, CHOICE_LIMITS.about) };
}

/** One choice of an `@4` file as an `@3` file, the document's own fields and that choice's requests around it (the reverse of `convertV3`). */
export function choiceAsFile3(file: File4, index = 0): File3 {
  const { schema: _s, choices, requests, ...rest } = file;
  const c = choices[index];
  return {
    schema: SCHEMA_V3, ...rest, facts: c.facts, channels: c.channels,
    ...(requests !== undefined ? { requests: requests.filter((r) => r.choice === c.id).map(({ choice: _c, ...r }) => r) } : {}),
  };
}
