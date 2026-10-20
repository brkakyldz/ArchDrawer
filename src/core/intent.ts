import { applyChannel, clearOutdated, joinChannel } from "./channels";
import { CHANNELS, freeIdAmong, validateDocument3, type Document3 } from "./file3";
import { layoutView } from "./layout";
import {
  allIds, ID_RE, KINDS, LIMITS, LINKEDIN_SUFFIX, validateDocument,
  type DiagramDocument, type DiagramEdge, type DiagramView, type EdgeStyle, type Kind, type NodeInput,
} from "./model";
import { STORY_LIMITS } from "./report";

/**
 * The story intent (diagram contract, Story intent): what the engine decides for a post —
 * the story, zones, main path, side parts and chips — without pixels. Code converts it into a
 * post view and places it.
 */
export interface StoryPart {
  id: string; label: string; sub: string; kind: Kind; chips: string[];
  zone: string | null; spine: number | null; anchor: string | null; side: "above" | "below" | null; from: string[];
}
export interface StoryEdge { from: string; to: string; label: string; style: EdgeStyle; step: number | null }
export interface StoryIntent { title: string; lede: string; zones: { id: string; label: string }[]; parts: StoryPart[]; edges: StoryEdge[] }

/** The schema the engine answers in (diagram contract, verbatim). */
export const STORY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "lede", "zones", "parts", "edges"],
  properties: {
    title: { type: "string" },
    lede: { type: "string" },
    zones: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label"],
      properties: { id: { type: "string" }, label: { type: "string" } } } },
    parts: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "label", "sub", "kind", "chips", "zone", "spine", "anchor", "side", "facts"],
      properties: {
        id: { type: "string" }, label: { type: "string" }, sub: { type: "string" },
        kind: { type: "string", enum: ["actor", "client", "api", "service", "worker", "llm", "external", "ops", "gate", "data"] },
        chips: { type: "array", items: { type: "string" } },
        zone: { anyOf: [{ type: "string" }, { type: "null" }] },
        spine: { anyOf: [{ type: "integer" }, { type: "null" }] },
        anchor: { anyOf: [{ type: "string" }, { type: "null" }] },
        side: { anyOf: [{ type: "string", enum: ["above", "below"] }, { type: "null" }] },
        facts: { type: "array", items: { type: "string" } },
      } } },
    edges: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["from", "to", "label", "style", "step"],
      properties: {
        from: { type: "string" }, to: { type: "string" }, label: { type: "string" },
        style: { type: "string", enum: ["call", "async", "dep"] },
        step: { anyOf: [{ type: "integer" }, { type: "null" }] },
      } } },
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
        // The facts a part shows (diagram contract, Post answers).
        from: list(o.facts, `${w}.facts`).map((f, j) => str(f, `${w}.facts[${j}]`)),
      };
    }),
    edges: list(r.edges, "edges").map((e, i) => {
      const w = `edges[${i}]`, o = exact(e, w, STORY_SCHEMA.properties.edges.items.required);
      const style = str(o.style, `${w}.style`);
      if (style !== "call" && style !== "async" && style !== "dep") fail(`${w}.style`, "must be call, async or dep");
      return { from: str(o.from, `${w}.from`), to: str(o.to, `${w}.to`), label: str(o.label, `${w}.label`), style: style as EdgeStyle, step: intOrNull(o.step, `${w}.step`) };
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

/**
 * Turn an intent into the source's post: the only changed view (created, or replaced keeping its
 * id). Impossible relations fail; every repair adds exactly one warning; text is never shortened.
 */
export function intentToDocument(doc: DiagramDocument, source: string, intent: StoryIntent, o: { portrait: boolean; ids?: { view: string; taken?: Iterable<string> } }): { doc: DiagramDocument; view: string; warnings: string[] } {
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
  const spineOrders = new Set<number>();
  for (const p of intent.parts) {
    if (p.zone !== null && !zoneIds.has(p.zone)) fail(`part ${q(p.id)} is in zone ${q(p.zone)}, which does not exist`);
    if (p.spine !== null) {
      if (p.spine < 0 || spineOrders.has(p.spine)) fail(`part ${q(p.id)} has spine ${p.spine}, which is negative or taken`);
      if (p.anchor !== null || p.side !== null) fail(`spine part ${q(p.id)} also names an anchor or side`);
      spineOrders.add(p.spine);
    } else {
      const a = p.anchor === null ? undefined : byPart.get(p.anchor);
      if (!a || a.spine === null) fail(`side part ${q(p.id)} needs a spine part as its anchor`);
      if (p.side === null) fail(`side part ${q(p.id)} needs a side, above or below`);
    }
  }
  const spine = intent.parts.filter((p) => p.spine !== null).sort((a, b) => a.spine! - b.spine!);
  for (const z of intent.zones) {
    const members = intent.parts.filter((p) => p.zone === z.id);
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
  // Hard limits fail the run: code never shortens the engine's text.
  const hard = (text: string, limit: number, what: string) => { if (text.length > limit) fail(`${what} is ${text.length} characters, over the file's ${limit}; ask for a shorter post`); };
  hard(intent.title, LIMITS.captionTitle, "the title");
  hard(intent.lede, LIMITS.lede, "the description");
  for (const z of intent.zones) hard(z.label, LIMITS.label, `zone ${q(z.id)}'s label`);
  for (const p of intent.parts) {
    hard(p.label, LIMITS.label, `part ${q(p.id)}'s label`);
    hard(p.sub, LIMITS.sub, `part ${q(p.id)}'s sub-line`);
    if (p.chips.length > LIMITS.items) fail(`part ${q(p.id)} has ${p.chips.length} chips, over the file's ${LIMITS.items}`);
    p.chips.forEach((c) => hard(c, LIMITS.item, `a chip of ${q(p.id)}`));
  }
  for (const e of intent.edges) hard(e.label, LIMITS.edgeLabel, `the label of ${e.from} → ${e.to}`);
  if (!intent.title.trim()) fail("the post has no title");

  // Editorial targets: kept whole, one warning each (the layout report lists them too).
  const target = (text: string, size: number, limit: number, what: string, unit = "characters") => {
    if (size > limit) warnings.push(`${what} "${text}" is over the post's ${limit} ${unit}; it is kept as written`);
  };
  target(intent.title, intent.title.trim().split(/\s+/).length, STORY_LIMITS.titleWords, "The title", "words");
  target(intent.lede, intent.lede.length, STORY_LIMITS.lede, "The description");
  for (const p of intent.parts) {
    target(p.label, p.label.length, STORY_LIMITS.label, `The label of "${p.id}"`);
    target(p.sub, p.sub.length, STORY_LIMITS.sub, `The sub-line of "${p.id}"`);
    for (const c of p.chips) target(c, c.length, STORY_LIMITS.chip, `A chip of "${p.id}"`);
  }

  // Ids: unique across the file, the post being replaced aside; references remapped together. The
  // intent's ids only tie the intent together, so a taken one gets a suffix without a warning.
  // With `ids` (the LinkedIn channel) the view's id is given and ids need only be unique in it.
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

  // Parts take what they represent from the source components they name: by the facts they show
  // when the source names them (a channel view), else by their ids.
  const sourceNodes = new Map(doc.views.flatMap((v) => v.nodes).flatMap((n) => (n.facts?.length ? n.facts : [n.id]).map((f) => [f, n] as const)));
  const nodes: NodeInput[] = intent.zones.map((z) => ({
    id: zoneOf.get(z.id)!, label: z.label, kind: "service", form: "group", icon: null, sub: "", items: [],
    description: o.ids ? "A group of components." : z.label, files: [], parent: null, detail: null, place: null, lane: null, from: [],
  }));
  for (const p of intent.parts) {
    const from = [...new Set(p.from.filter((f) => sourceNodes.has(f)))];
    for (const f of p.from) if (!sourceNodes.has(f)) warnings.push(`Dropped "${f}" from what "${p.id}" represents: no such component`);
    const represented = from.map((f) => sourceNodes.get(f)!);
    const files = [...new Set(represented.flatMap((n) => n.files))];
    if (files.length > LIMITS.files) { warnings.push(`Kept the first ${LIMITS.files} of the ${files.length} files "${p.id}" represents`); files.length = LIMITS.files; }
    // A stored description, a sub-line and a label are all within the description's limit.
    nodes.push({
      id: partOf.get(p.id)!, label: p.label, sub: p.sub, kind: p.kind, form: p.chips.length ? "panel" : "card", icon: null,
      items: [...p.chips], description: represented[0]?.description || p.sub || p.label, files,
      parent: p.zone === null ? null : zoneOf.get(p.zone)!, detail: null, place: null,
      lane: p.spine !== null ? { spine: p.spine } : { anchor: partOf.get(p.anchor!)!, side: p.side! }, from,
    });
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
  for (const e of edges) {
    if (e.step !== null && e.label) warnings.push(`The main-path connection ${e.id} has the label "${e.label}"; it is kept, but the number already tells the path`);
    else if (e.step === null && e.label.trim().split(/\s+/).length > STORY_LIMITS.sideLabelWords) warnings.push(`The label "${e.label}" of ${e.id} is over the post's ${STORY_LIMITS.sideLabelWords} words; it is kept as written`);
  }

  const title = (src.id === doc.views[0].id ? "LinkedIn" : `${src.title} · LinkedIn`).slice(0, LIMITS.viewTitle);
  const laid = layoutView({ id, title, caption: { title: intent.title, lede: intent.lede }, postOf: source, nodes, edges, texts: [] }, { portrait: o.portrait, labels: true, post: true });
  const view: DiagramView = { ...laid, postOf: source, texts: [] };
  const exists = doc.views.some((v) => v.id === id);
  const next: DiagramDocument = {
    ...doc,
    views: exists ? doc.views.map((v) => (v.id === id ? view : v)) : [...doc.views, view],
    warnings: [...doc.warnings, ...warnings],
  };
  // A channel's view is checked once it is part of the file (`intentToChannel`).
  if (o.ids) return { doc: next, view: id, warnings };
  const checked = validateDocument(next);
  if (!checked.ok) throw new StoryError(`The engine's post could not become a valid drawing: ${checked.error}`);
  return { doc: checked.doc, view: id, warnings };
}


/**
 * A post answer as the LinkedIn channel's one view (diagram contract, Post answers): designed from
 * the overview's first view, its parts pointing to the facts the intent names, replacing what the
 * channel held. The facts and every other channel stay; the channel's `outdated` is emptied.
 */
export function intentToChannel(stored: Document3, intent: StoryIntent, o: { portrait: boolean }): { doc: Document3; view: string; warnings: string[] } {
  const overview = joinChannel(stored, "overview");
  const src = overview.views[0];
  const view = linkedInViewId(stored);
  const r = intentToDocument({ ...overview, warnings: [] }, src.id, intent, { portrait: o.portrait, ids: { view } });
  const post = r.doc.views.find((v) => v.id === r.view)!;
  const cleared: Document3 = { ...stored, channels: { ...stored.channels, linkedin: { ...stored.channels.linkedin, views: [] } } };
  const split = applyChannel(cleared, "linkedin", {
    views: [{ ...post, postOf: null, nodes: post.nodes.map((n) => ({ ...n, facts: [...(n.from ?? [])] })) }],
    warnings: [...stored.warnings, ...r.warnings],
  }, { keepFacts: true });
  if (!split.ok) throw new StoryError(split.error);
  const doc = clearOutdated(split.doc, "linkedin");
  const checked = validateDocument3(doc);
  if (!checked.ok) throw new StoryError(`The engine's post could not become a valid drawing: ${checked.error}`);
  return { doc: checked.doc, view, warnings: doc.warnings.slice(stored.warnings.length) };
}

/** The LinkedIn view's id (diagram contract, Post answers): kept, else `linkedin`, or `linkedin-2` … when another view has it. */
export function linkedInViewId(stored: Document3): string {
  const others = new Set(CHANNELS.filter((c) => c !== "linkedin").flatMap((c) => stored.channels[c].views.map((v) => v.id)));
  return stored.channels.linkedin.views[0]?.id ?? freeIdAmong(others, "linkedin");
}
