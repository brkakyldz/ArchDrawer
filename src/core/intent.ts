import { applyChannel, clearOutdated, joinChannel } from "./channels";
import { CHANNELS, FACT3_LIMITS, freeIdAmong, validateDocument3, type ChannelId, type Document3, type Step } from "./file3";
import { layoutView } from "./layout";
import {
  allIds, ID_RE, KINDS, LIMITS, LINKEDIN_SUFFIX, validateDocument,
  type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramView, type EdgeStyle, type Kind, type NodeInput,
} from "./model";
import { STORY_LIMITS } from "./report";

/**
 * The story intent (diagram contract, Story answers): what the engine decides for a channel — the
 * story, zones, main path, side parts, parts inside others, chips, held mechanisms, limits and, for
 * the presentation, steps — without pixels. Code converts it into the channel's view and places it.
 */
export interface StoryPart {
  id: string; label: string; sub: string; kind: Kind; chips: string[];
  zone: string | null; spine: number | null; anchor: string | null; side: "above" | "below" | null; from: string[];
  /** The part it is drawn inside (which becomes a group), or null. */
  inside: string | null;
  /** Mechanism facts drawn as its rows, and limit facts. */
  held: string[]; limits: string[];
}
export interface StoryEdge { from: string; to: string; label: string; style: EdgeStyle; step: number | null }
export interface StoryStep { parts: string[]; text: string; note: string }
export interface StoryIntent { title: string; lede: string; zones: { id: string; label: string }[]; parts: StoryPart[]; edges: StoryEdge[]; steps: StoryStep[] }

/** The schema the engine answers in (diagram contract, verbatim). */
export const STORY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "lede", "zones", "parts", "edges", "steps"],
  properties: {
    title: { type: "string" },
    lede: { type: "string" },
    zones: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label"],
      properties: { id: { type: "string" }, label: { type: "string" } } } },
    parts: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "label", "sub", "kind", "chips", "zone", "inside", "spine", "anchor", "side", "facts", "held", "limits"],
      properties: {
        id: { type: "string" }, label: { type: "string" }, sub: { type: "string" },
        kind: { type: "string", enum: ["actor", "client", "api", "service", "worker", "llm", "external", "ops", "gate", "data"] },
        chips: { type: "array", items: { type: "string" } },
        zone: { anyOf: [{ type: "string" }, { type: "null" }] },
        inside: { anyOf: [{ type: "string" }, { type: "null" }] },
        spine: { anyOf: [{ type: "integer" }, { type: "null" }] },
        anchor: { anyOf: [{ type: "string" }, { type: "null" }] },
        side: { anyOf: [{ type: "string", enum: ["above", "below"] }, { type: "null" }] },
        facts: { type: "array", items: { type: "string" } },
        held: { type: "array", items: { type: "string" } },
        limits: { type: "array", items: { type: "string" } },
      } } },
    edges: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["from", "to", "label", "style", "step"],
      properties: {
        from: { type: "string" }, to: { type: "string" }, label: { type: "string" },
        style: { type: "string", enum: ["call", "async", "dep"] },
        step: { anyOf: [{ type: "integer" }, { type: "null" }] },
      } } },
    steps: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["parts", "text", "note"],
      properties: { parts: { type: "array", items: { type: "string" } }, text: { type: "string" }, note: { type: "string" } } } },
  },
} as const;

/** An answer that cannot become a post: the run fails before saving and the file is untouched. */
export class StoryError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const q = JSON.stringify;

/** Check an answer against the schema exactly: every property required, no others. */
export function parseIntent(raw: unknown): StoryIntent {
  const fail = (where: string, what: string): never => { throw new StoryError(`The engine's post is not a story intent: ${where} ${what}`); };
  const exact = (o: unknown, where: string, keys: readonly string[]) => {
    if (!isObj(o)) fail(where, "must be an object");
    const r = o as Record<string, unknown>;
    for (const k of keys) if (!(k in r)) fail(where, `is missing ${q(k)}`);
    for (const k of Object.keys(r)) if (!keys.includes(k)) fail(where, `has an unknown property ${q(k)}`);
    return r;
  };
  const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where, "must be a string"));
  const strOrNull = (v: unknown, where: string) => (v === null || typeof v === "string" ? v : fail(where, "must be a string or null"));
  const list = (v: unknown, where: string) => (Array.isArray(v) ? v : fail(where, "must be an array"));
  const intOrNull = (v: unknown, where: string) => (v === null || Number.isInteger(v) ? (v as number | null) : fail(where, "must be an integer or null"));
  const r = exact(raw, "the answer", STORY_SCHEMA.required);
  return {
    title: str(r.title, "title"),
    lede: str(r.lede, "lede"),
    zones: list(r.zones, "zones").map((z, i) => {
      const o = exact(z, `zones[${i}]`, STORY_SCHEMA.properties.zones.items.required);
      return { id: str(o.id, `zones[${i}].id`), label: str(o.label, `zones[${i}].label`) };
    }),
    parts: list(r.parts, "parts").map((p, i) => {
      const w = `parts[${i}]`, o = exact(p, w, STORY_SCHEMA.properties.parts.items.required);
      const kind = str(o.kind, `${w}.kind`);
      if (!(KINDS as readonly string[]).includes(kind)) fail(`${w}.kind`, `${q(kind)} is not a kind`);
      const side = strOrNull(o.side, `${w}.side`);
      if (side !== null && side !== "above" && side !== "below") fail(`${w}.side`, "must be above, below or null");
      return {
        id: str(o.id, `${w}.id`), label: str(o.label, `${w}.label`), sub: str(o.sub, `${w}.sub`), kind: kind as Kind,
        chips: list(o.chips, `${w}.chips`).map((c, j) => str(c, `${w}.chips[${j}]`)),
        zone: strOrNull(o.zone, `${w}.zone`), spine: intOrNull(o.spine, `${w}.spine`), anchor: strOrNull(o.anchor, `${w}.anchor`),
        side: side as StoryPart["side"],
        // The facts a part shows (diagram contract, Story answers).
        from: list(o.facts, `${w}.facts`).map((f, j) => str(f, `${w}.facts[${j}]`)),
        inside: strOrNull(o.inside, `${w}.inside`),
        held: list(o.held, `${w}.held`).map((f, j) => str(f, `${w}.held[${j}]`)),
        limits: list(o.limits, `${w}.limits`).map((f, j) => str(f, `${w}.limits[${j}]`)),
      };
    }),
    edges: list(r.edges, "edges").map((e, i) => {
      const w = `edges[${i}]`, o = exact(e, w, STORY_SCHEMA.properties.edges.items.required);
      const style = str(o.style, `${w}.style`);
      if (style !== "call" && style !== "async" && style !== "dep") fail(`${w}.style`, "must be call, async or dep");
      return { from: str(o.from, `${w}.from`), to: str(o.to, `${w}.to`), label: str(o.label, `${w}.label`), style: style as EdgeStyle, step: intOrNull(o.step, `${w}.step`) };
    }),
    steps: list(r.steps, "steps").map((s, i) => {
      const w = `steps[${i}]`, o = exact(s, w, STORY_SCHEMA.properties.steps.items.required);
      return { parts: list(o.parts, `${w}.parts`).map((p, j) => str(p, `${w}.parts[${j}]`)), text: str(o.text, `${w}.text`), note: str(o.note, `${w}.note`) };
    }),
  };
}

/** The source a post request means: a post resolves through its `postOf`; any other view is its own source. */
export const postSource = (doc: Pick<DiagramDocument, "views">, viewId: string): string =>
  doc.views.find((v) => v.id === viewId)?.postOf ?? viewId;

/** The id a source's post gets (diagram contract, Post-view identity): its existing post's, else a free bounded one. */
export function postViewId(doc: Pick<DiagramDocument, "views" | "requests">, source: string): string {
  const existing = doc.views.find((v) => v.postOf === source);
  if (existing) return existing.id;
  const taken = new Set([...doc.views.map((v) => v.id), ...allIds(doc)]);
  const first = `${source.slice(0, 64 - LINKEDIN_SUFFIX.length)}${LINKEDIN_SUFFIX}`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const tail = `-${n}${LINKEDIN_SUFFIX}`;
    const id = `${source.slice(0, 64 - tail.length)}${tail}`;
    if (!taken.has(id)) return id;
  }
}

/** What a channel's conversion needs to draw rows: the mechanisms and limits of the facts. */
export interface StoryRows { mechanisms: Map<string, { label: string; within: string | null }>; limits: Map<string, { text: string; on: string }> }
export interface StoryOptions {
  portrait: boolean;
  /** With `ids` (a channel) the view's id is given and ids need only be unique in it. */
  ids?: { view: string; taken?: Iterable<string> };
  /** The channel drawn; default LinkedIn (a post). */
  channel?: ChannelId;
  rows?: StoryRows;
}
const VIEW_TITLES: Record<ChannelId, string> = { overview: "Overview", linkedin: "LinkedIn", readme: "README", presentation: "Presentation" };

/**
 * Turn an intent into a channel's view (or, without `ids`, the source's post): the only changed
 * view, created or replaced keeping its id. Impossible relations fail; every repair adds exactly
 * one warning; text is never shortened.
 */
export function intentToDocument(doc: DiagramDocument, source: string, intent: StoryIntent, o: StoryOptions): { doc: DiagramDocument; view: string; warnings: string[]; steps: Step[] } {
  const channel = o.channel ?? "linkedin";
  const post = channel === "linkedin";
  const src = doc.views.find((v) => v.id === source);
  if (!src) throw new StoryError(`There is no view "${source}" to design a post for`);
  if (src.postOf) throw new StoryError(`"${source}" is a post; design from its source "${src.postOf}"`);
  if (!intent.parts.length) throw new StoryError("The engine's post has no parts");
  const warnings: string[] = [];
  const fail = (what: string): never => { throw new StoryError(`The engine's post cannot be drawn: ${what}`); };

  // Relations (diagram contract, Relations and conversion): code does not guess a story.
  const zoneIds = new Set<string>(), partIds = new Set<string>();
  for (const z of intent.zones) { if (zoneIds.has(z.id)) fail(`zone ${q(z.id)} is listed twice`); zoneIds.add(z.id); }
  for (const p of intent.parts) { if (partIds.has(p.id)) fail(`part ${q(p.id)} is listed twice`); partIds.add(p.id); }
  const byPart = new Map(intent.parts.map((p) => [p.id, p]));
  // Holders: a part inside another is drawn in it; the chain never loops and nests at most three groups.
  const holderOf = (p: StoryPart) => (p.inside === null ? undefined : byPart.get(p.inside));
  const topOf = (p: StoryPart) => { let cur = p; for (let h = holderOf(cur); h; h = holderOf(cur)) cur = h; return cur; };
  for (const p of intent.parts) {
    if (p.inside === null) continue;
    if (!byPart.has(p.inside)) fail(`part ${q(p.id)} is inside ${q(p.inside)}, which is not a part`);
    const seen = new Set([p.id]);
    let depth = 0;
    for (let h = holderOf(p); h; h = holderOf(h)) {
      if (seen.has(h.id)) fail(`part ${q(p.id)} is inside itself`);
      seen.add(h.id);
      depth++;
    }
    const groups = depth + (topOf(p).zone !== null ? 1 : 0);
    if (groups > LIMITS.depth) fail(`part ${q(p.id)} nests ${groups} groups deep; at most ${LIMITS.depth}`);
    if (p.zone !== null && p.zone !== topOf(p).zone) fail(`part ${q(p.id)} is inside ${q(p.inside)} but names another zone`);
  }
  const level = (p: StoryPart) => p.inside ?? "";
  const spineOrders = new Set<string>();
  for (const p of intent.parts) {
    if (p.zone !== null && !zoneIds.has(p.zone)) fail(`part ${q(p.id)} is in zone ${q(p.zone)}, which does not exist`);
    if (p.spine !== null) {
      const key = `${level(p)}:${p.spine}`;
      if (p.spine < 0 || spineOrders.has(key)) fail(`part ${q(p.id)} has spine ${p.spine}, which is negative or taken`);
      if (p.anchor !== null || p.side !== null) fail(`spine part ${q(p.id)} also names an anchor or side`);
      spineOrders.add(key);
    } else {
      const a = p.anchor === null ? undefined : byPart.get(p.anchor);
      if (!a || a.spine === null || level(a) !== level(p)) fail(`side part ${q(p.id)} needs a spine part of its own level as its anchor`);
      if (p.side === null) fail(`side part ${q(p.id)} needs a side, above or below`);
    }
  }
  const top = intent.parts.filter((p) => p.inside === null);
  const spine = top.filter((p) => p.spine !== null).sort((a, b) => a.spine! - b.spine!);
  for (const z of intent.zones) {
    const members = top.filter((p) => p.zone === z.id);
    const onSpine = members.filter((p) => p.spine !== null).map((p) => spine.indexOf(p));
    const sides = members.filter((p) => p.spine === null);
    if (onSpine.length) {
      onSpine.sort((a, b) => a - b);
      if (onSpine.some((x, i) => i > 0 && x !== onSpine[i - 1] + 1)) fail(`zone ${q(z.id)} holds spine parts that are not consecutive`);
      if (sides.some((p) => byPart.get(p.anchor!)!.zone !== z.id)) fail(`zone ${q(z.id)} holds a side part whose anchor is outside it`);
    } else if (new Set(sides.map((p) => p.anchor)).size > 1) fail(`zone ${q(z.id)} holds side parts of different anchors`);
  }
  for (const e of intent.edges) {
    if (!partIds.has(e.from) || !partIds.has(e.to)) fail(`a connection ${e.from} → ${e.to} names something that is not a part`);
    if (e.from === e.to) fail(`a connection from ${q(e.from)} to itself`);
  }
  const holders = new Set(intent.parts.filter((p) => p.inside !== null).map((p) => p.inside!));
  // Hard limits fail the run: code never shortens the engine's text.
  const hard = (text: string, limit: number, what: string) => { if (text.length > limit) fail(`${what} is ${text.length} characters, over the file's ${limit}; ask for a shorter post`); };
  hard(intent.title, LIMITS.captionTitle, "the title");
  hard(intent.lede, LIMITS.lede, "the description");
  for (const z of intent.zones) hard(z.label, LIMITS.label, `zone ${q(z.id)}'s label`);
  for (const p of intent.parts) {
    hard(p.label, LIMITS.label, `part ${q(p.id)}'s label`);
    hard(p.sub, LIMITS.sub, `part ${q(p.id)}'s sub-line`);
    if (!holders.has(p.id) && p.chips.length > LIMITS.items) fail(`part ${q(p.id)} has ${p.chips.length} chips, over the file's ${LIMITS.items}`);
    p.chips.forEach((c) => hard(c, LIMITS.item, `a chip of ${q(p.id)}`));
  }
  for (const e of intent.edges) hard(e.label, LIMITS.edgeLabel, `the label of ${e.from} → ${e.to}`);
  // Steps outside the presentation are ignored (below), so only the presentation's are held to its limits.
  if (channel === "presentation") {
    if (intent.steps.length > FACT3_LIMITS.steps) fail(`the story has ${intent.steps.length} steps, over the file's ${FACT3_LIMITS.steps}`);
    intent.steps.forEach((s, i) => {
      if (!s.text.trim()) fail(`step ${i + 1} has no text`);
      hard(s.text, FACT3_LIMITS.stepText, `the text of step ${i + 1}`);
      hard(s.note, FACT3_LIMITS.stepNote, `the note of step ${i + 1}`);
    });
  }
  if (!intent.title.trim()) fail("the post has no title");

  // Editorial targets of a post: kept whole, one warning each (the layout report lists them too).
  if (post) {
    const target = (text: string, size: number, limit: number, what: string, unit = "characters") => {
      if (size > limit) warnings.push(`${what} "${text}" is over the post's ${limit} ${unit}; it is kept as written`);
    };
    target(intent.title, intent.title.trim().split(/\s+/).length, STORY_LIMITS.titleWords, "The title", "words");
    target(intent.lede, intent.lede.length, STORY_LIMITS.lede, "The description");
    for (const p of intent.parts) {
      target(p.label, p.label.length, STORY_LIMITS.label, `The label of "${p.id}"`);
      target(p.sub, p.sub.length, STORY_LIMITS.sub, `The sub-line of "${p.id}"`);
      if (!holders.has(p.id)) for (const c of p.chips) target(c, c.length, STORY_LIMITS.chip, `A chip of "${p.id}"`);
    }
  }

  // Ids: unique across the file, the post being replaced aside; references remapped together. The
  // intent's ids only tie the intent together, so a taken one gets a suffix without a warning.
  // With `ids` (a channel) the view's id is given and ids need only be unique in it.
  const id = o.ids?.view ?? postViewId(doc, source);
  const others = { ...doc, views: doc.views.filter((v) => v.id !== id) };
  const used = new Set(o.ids ? [...(o.ids.taken ?? []), id] : [...allIds(others), ...others.views.map((v) => v.id), id]);
  const fresh = (want: string) => {
    let base = ID_RE.test(want) ? want : want.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "part";
    if (base !== want) warnings.push(`Renamed the post's id "${want}" to "${base}": ids use letters, digits, - and _`);
    let out = base;
    for (let n = 2; used.has(out); n++) out = `${base.slice(0, 64 - `-${n}`.length)}-${n}`;
    used.add(out);
    return out;
  };
  const zoneOf = new Map(intent.zones.map((z) => [z.id, fresh(`zone-${z.id}`)]));
  const partOf = new Map(intent.parts.map((p) => [p.id, fresh(p.id)]));

  // Parts take what they represent from the source components they name: in a channel (`ids`) by the
  // facts they show, so a part of no fact is no component; else by their facts or their ids.
  const named = (n: DiagramNode) => (o.ids ? n.facts ?? [] : n.facts?.length ? n.facts : [n.id]);
  const sourceNodes = new Map(doc.views.flatMap((v) => v.nodes).flatMap((n) => named(n).map((f) => [f, n] as const)));
  const nodes: NodeInput[] = intent.zones.map((z) => ({
    id: zoneOf.get(z.id)!, label: z.label, kind: "service", form: "group", icon: null, sub: "", items: [],
    description: o.ids ? "A group of components." : z.label, files: [], parent: null, detail: null, place: null, lane: null, from: [],
  }));
  // In a channel a fact is shown or held by one part (rule 6): a later part naming it again drops it.
  const claimed = new Set<string>();
  for (const p of intent.parts) {
    let from = [...new Set(p.from.filter((f) => sourceNodes.has(f)))];
    for (const f of p.from) if (!sourceNodes.has(f)) warnings.push(`Dropped "${f}" from what "${p.id}" represents: no such component`);
    if (o.ids) {
      for (const f of from) if (claimed.has(f)) warnings.push(`View "${id}": "${partOf.get(p.id)}" no longer shows "${f}", which an earlier part shows`);
      from = from.filter((f) => !claimed.has(f));
      from.forEach((f) => claimed.add(f));
    }
    const represented = from.map((f) => sourceNodes.get(f)!);
    const files = [...new Set(represented.flatMap((n) => n.files))];
    if (files.length > LIMITS.files) { warnings.push(`Kept the first ${LIMITS.files} of the ${files.length} files "${p.id}" represents`); files.length = LIMITS.files; }
    // Rows: held mechanisms within the part's facts, its chips, limits on its facts or held mechanisms.
    let held: string[] = [], limits: string[] = [];
    if (post || holders.has(p.id)) {
      if (p.held.length) warnings.push(post ? `The LinkedIn post holds no mechanisms; dropped those of "${p.id}"` : `"${p.id}" holds parts, so it draws no mechanism rows`);
      if (p.limits.length) warnings.push(post ? `The LinkedIn post shows no limits; dropped those of "${p.id}"` : `"${p.id}" holds parts, so it draws no limit rows`);
    } else {
      for (const m of [...new Set(p.held)]) {
        const w = o.rows?.mechanisms.get(m)?.within;
        if (!w || !from.includes(w)) warnings.push(`Dropped "${m}" from what "${p.id}" holds: no mechanism within its facts`);
        else if (claimed.has(m)) warnings.push(`View "${id}": "${partOf.get(p.id)}" no longer holds "${m}", which an earlier part shows or holds`);
        else { held.push(m); claimed.add(m); }
      }
      for (const l of [...new Set(p.limits)]) {
        const on = o.rows?.limits.get(l)?.on;
        if (on && (from.includes(on) || held.includes(on))) limits.push(l); else warnings.push(`Dropped "${l}" from the limits of "${p.id}": not on what it shows`);
      }
    }
    if (holders.has(p.id) && p.chips.length) warnings.push(`"${p.id}" holds parts, so it draws no chips`);
    let chips = holders.has(p.id) ? [] : [...p.chips];
    if (held.length + chips.length + limits.length > LIMITS.items) {
      warnings.push(`Kept the first ${LIMITS.items} rows of "${p.id}"`);
      held = held.slice(0, LIMITS.items);
      chips = chips.slice(0, LIMITS.items - held.length);
      limits = limits.slice(0, LIMITS.items - held.length - chips.length);
    }
    const rows = [...held.map((m) => o.rows!.mechanisms.get(m)!.label), ...chips, ...limits.map((l) => o.rows!.limits.get(l)!.text)];
    // A stored description, a sub-line and a label are all within the description's limit.
    nodes.push({
      id: partOf.get(p.id)!, label: p.label, sub: p.sub, kind: p.kind, form: holders.has(p.id) ? "group" : rows.length ? "panel" : "card", icon: null,
      items: rows, description: represented[0]?.description || p.sub || p.label, files,
      parent: p.inside !== null ? partOf.get(p.inside)! : p.zone === null ? null : zoneOf.get(p.zone)!, detail: null, place: null,
      lane: p.spine !== null ? { spine: p.spine } : { anchor: partOf.get(p.anchor!)!, side: p.side! }, from,
      ...(held.length ? { heldIds: held } : {}), ...(limits.length ? { limitIds: limits } : {}),
    } as NodeInput);
  }

  // Connections: reverse pairs become one two-way edge, duplicates go, steps run 1, 2, 3 …
  const edges: DiagramEdge[] = [];
  for (const e of intent.edges) {
    const a = partOf.get(e.from)!, b = partOf.get(e.to)!;
    if (edges.some((x) => x.from === a && x.to === b)) { warnings.push(`Dropped a repeated connection ${e.from} → ${e.to}`); continue; }
    const back = edges.find((x) => x.from === b && x.to === a);
    if (back) {
      back.both = true;
      back.label ||= e.label;
      if (back.step === null && e.step !== null) back.step = e.step;
      warnings.push(`Joined ${e.to} → ${e.from} and ${e.from} → ${e.to} into one two-way connection`);
      continue;
    }
    edges.push({ id: fresh(`${e.from}-${e.to}`), from: a, to: b, label: e.label, style: e.style, both: false, step: e.step });
  }
  edges.filter((e) => e.step !== null).sort((x, y) => x.step! - y.step!).forEach((e, i) => {
    if (e.step !== i + 1) { warnings.push(`Renumbered the step of ${e.id} from ${e.step} to ${i + 1}`); e.step = i + 1; }
  });
  if (post) for (const e of edges) {
    if (e.step !== null && e.label) warnings.push(`The main-path connection ${e.id} has the label "${e.label}"; it is kept, but the number already tells the path`);
    else if (e.step === null && e.label.trim().split(/\s+/).length > STORY_LIMITS.sideLabelWords) warnings.push(`The label "${e.label}" of ${e.id} is over the post's ${STORY_LIMITS.sideLabelWords} words; it is kept as written`);
  }

  // Steps: only the presentation has them; a step keeps the parts that exist.
  const steps: Step[] = [];
  if (channel !== "presentation") {
    if (intent.steps.length) warnings.push("Ignored the steps: only a presentation has steps");
  } else intent.steps.forEach((s, i) => {
    const parts: string[] = [];
    for (const p of s.parts) {
      const mapped = partOf.get(p);
      if (!mapped) warnings.push(`Step ${i + 1}: dropped "${p}", which is no part`);
      else if (!parts.includes(mapped)) parts.push(mapped);
    }
    if (!parts.length) { warnings.push(`Step ${i + 1} names no part and was dropped`); return; }
    steps.push({ id: `s${steps.length + 1}`, parts, text: s.text, note: s.note });
  });

  const title = (o.ids ? VIEW_TITLES[channel] : src.id === doc.views[0].id ? "LinkedIn" : `${src.title} · LinkedIn`).slice(0, LIMITS.viewTitle);
  const laid = layoutView({ id, title, caption: { title: intent.title, lede: intent.lede }, postOf: post ? source : null, nodes, edges, texts: [] }, { portrait: o.portrait, labels: true, post });
  const view: DiagramView = { ...laid, postOf: post ? source : null, texts: [] };
  const exists = doc.views.some((v) => v.id === id);
  const next: DiagramDocument = {
    ...doc,
    views: exists ? doc.views.map((v) => (v.id === id ? view : v)) : [...doc.views, view],
    warnings: [...doc.warnings, ...warnings],
  };
  // A channel's view is checked once it is part of the file (`intentToChannel`).
  if (o.ids) return { doc: next, view: id, warnings, steps };
  const checked = validateDocument(next);
  if (!checked.ok) throw new StoryError(`The engine's post could not become a valid drawing: ${checked.error}`);
  return { doc: checked.doc, view: id, warnings, steps };
}


/**
 * A story answer as a channel's one view (diagram contract, Story answers): its parts point to the
 * facts the intent names, replacing what the channel held (and, for the presentation, its steps).
 * The facts and every other channel stay; the channel's `outdated` is emptied.
 */
export function intentToChannel(stored: Document3, intent: StoryIntent, o: { portrait: boolean; channel?: Exclude<ChannelId, "overview"> }): { doc: Document3; view: string; warnings: string[] } {
  const channel = o.channel ?? "linkedin";
  // The source: one node per component fact, so a part takes its files and description from the facts.
  const comps = stored.facts.components;
  const source: DiagramView = {
    id: "facts", title: "Facts", caption: { title: stored.title, lede: "" }, postOf: null, texts: [], edges: [],
    nodes: comps.map((c) => ({ id: c.id, label: c.label, kind: c.kind, form: "card", icon: null, sub: c.sub, items: [], description: c.description, files: [...c.files], parent: null, detail: null, place: null, x: 0, y: 0, facts: [c.id] })),
  };
  const base = { ...joinChannel(stored, "overview"), views: [source], warnings: [] };
  const rows = storyRows(stored);
  const view = channelViewId(stored, channel);
  const r = intentToDocument(base, source.id, intent, { portrait: o.portrait, ids: { view }, channel, rows });
  const drawn = r.doc.views.find((v) => v.id === r.view)!;
  const cleared: Document3 = { ...stored, channels: { ...stored.channels, [channel]: { ...stored.channels[channel], views: [], ...(channel === "presentation" ? { steps: [] } : {}) } } };
  const split = applyChannel(cleared, channel, {
    views: [{ ...drawn, postOf: null, nodes: drawn.nodes.map((n) => ({ ...n, facts: [...(n.from ?? [])] })) }],
    warnings: [...stored.warnings, ...r.warnings],
    ...(channel === "presentation" ? { steps: r.steps } : {}),
  }, { keepFacts: true });
  if (!split.ok) throw new StoryError(split.error);
  const doc = clearOutdated(split.doc, channel);
  const checked = validateDocument3(doc);
  if (!checked.ok) throw new StoryError(`The engine's story could not become a valid drawing: ${checked.error}`);
  return { doc: checked.doc, view, warnings: doc.warnings.slice(stored.warnings.length) };
}

/** The mechanisms and limits of a drawing's facts, as a story or a refine draws them as rows. */
export function storyRows(stored: Pick<Document3, "facts">): StoryRows {
  return {
    mechanisms: new Map(stored.facts.components.filter((c) => c.within).map((c) => [c.id, { label: c.label, within: c.within ?? null }])),
    limits: new Map((stored.facts.limits ?? []).map((l) => [l.id, { text: l.text, on: l.on }])),
  };
}

/** A channel's view id (diagram contract, Story answers): kept, else the channel's name, or `<name>-2` … when another view has it. */
export function channelViewId(stored: Document3, channel: Exclude<ChannelId, "overview">): string {
  const others = new Set(CHANNELS.filter((c) => c !== channel).flatMap((c) => stored.channels[c].views.map((v) => v.id)));
  return stored.channels[channel].views[0]?.id ?? freeIdAmong(others, channel);
}

/** The LinkedIn view's id: kept, else `linkedin`, or `linkedin-2` … when another view has it. */
export const linkedInViewId = (stored: Document3): string => channelViewId(stored, "linkedin");
