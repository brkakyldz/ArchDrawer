/**
 * Channels of an `@3` document (docs/contracts/diagram.md, *What a channel draws* and *Edits:
 * facts or channel*; ADR 0006). Pure (invariant 4):
 *
 * - `joinChannel` turns a channel into the view-shaped document that layout, geometry, the
 *   exports and the editor draw — each part joined with its facts.
 * - `applyChannel` takes a new state of that view-shaped document and splits it back: content
 *   to the facts, appearance to the channel, `outdated` marks on the other channels.
 * - `markOutdated` sets the marks for any change between two documents (an outside write).
 */
import { layoutRects } from "./geometry";
import { freeSpot, layoutView } from "./layout";
import {
  LIMITS, SCHEMA_ID, TEXT_SIZE, depthWarnings,
  type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramRequest, type DiagramSource, type DiagramView,
} from "./model";
import {
  CHANNELS, assignConnectionIds, fillDefaults3, freeIdAmong, isChannel,
  type Channel, type ChannelId, type ComponentFact, type Connection, type Document3, type File3, type Part, type RelationFact, type View3,
} from "./file3";

const TEXT_FIELDS = ["label", "kind", "sub", "description"] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const EDGE_FIELDS = ["label", "style", "both"] as const;
type EdgeField = (typeof EDGE_FIELDS)[number];

const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === (b ?? [])[i]);
const isSet = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** A part joined with its facts: the drawn content (contract, *What a channel draws*). */
export function joinPart(p: Part, comps: Map<string, ComponentFact>): DiagramNode {
  const single = p.facts.length === 1 ? comps.get(p.facts[0]) ?? null : null;
  const files: string[] = [];
  for (const f of p.facts) for (const path of comps.get(f)?.files ?? []) if (!files.includes(path) && files.length < LIMITS.files) files.push(path);
  const n: DiagramNode = {
    id: p.id,
    label: p.label ?? single?.label ?? p.id,
    kind: p.kind ?? single?.kind ?? "service",
    form: p.form, icon: p.icon,
    sub: p.sub ?? single?.sub ?? "",
    items: p.form === "panel" ? [...(p.items ?? single?.items ?? [])] : [],
    description: p.description ?? single?.description ?? "No description yet.",
    files, parent: p.parent, detail: p.detail, place: p.place,
    x: p.x, y: p.y, lane: p.lane ?? null, from: [], facts: [...p.facts],
    held: [...(p.items ?? single?.items ?? [])],
  };
  return n;
}

/** A connection joined with its relations. */
export function joinConnection(c: Connection, rels: Map<string, RelationFact>): DiagramEdge {
  const single = c.relations.length === 1 ? rels.get(c.relations[0]) ?? null : null;
  return {
    id: c.id, from: c.from, to: c.to,
    label: c.label ?? single?.label ?? "",
    style: c.style ?? single?.style ?? "call",
    both: c.both ?? single?.both ?? false,
    step: c.step, relations: [...c.relations],
  };
}

const factMaps = (doc: Pick<Document3, "facts">) => ({
  comps: new Map(doc.facts.components.map((c) => [c.id, c])),
  rels: new Map(doc.facts.relations.map((r) => [r.id, r])),
});

/**
 * A view of a channel as drawn. A LinkedIn view keeps a `postOf` (the overview's first view) so
 * that it measures and draws in the post style (contract, Geometry).
 */
export function joinView(doc: Document3, channel: ChannelId, view: View3): DiagramView {
  const { comps, rels } = factMaps(doc);
  return {
    id: view.id, title: view.title, caption: { ...view.caption },
    postOf: channel === "linkedin" ? doc.channels.overview.views[0]?.id ?? null : null,
    nodes: view.nodes.map((p) => joinPart(p, comps)),
    edges: view.edges.map((c) => joinConnection(c, rels)),
    texts: view.texts.map((t) => ({ ...t, size: t.size ?? TEXT_SIZE.default })),
  };
}

/** The channel as a view-shaped document: what layout, the exports and the editor work on. */
export function joinChannel(doc: Document3, channel: ChannelId): DiagramDocument {
  const ch = doc.channels[channel];
  return {
    schema: SCHEMA_ID, id: doc.id, title: doc.title, theme: doc.theme, showSteps: ch.showSteps,
    source: doc.source, engine: doc.engine, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    views: ch.views.map((v) => joinView(doc, channel, v)),
    requests: doc.requests.map((r) => ({ ...r })),
    warnings: [...doc.warnings],
  };
}

/** One view of a channel as drawn, or null. */
export function channelView(doc: Document3, channel: ChannelId, viewId?: string): DiagramView | null {
  const ch = doc.channels[channel];
  const v = viewId === undefined ? ch.views[0] : ch.views.find((x) => x.id === viewId);
  return v ? joinView(doc, channel, v) : null;
}

/** The new state of a channel, in the view-shaped form `joinChannel` returns. */
export type ChannelState = Pick<DiagramDocument, "views"> & Partial<Pick<DiagramDocument, "title" | "theme" | "showSteps" | "requests" | "warnings" | "engine">>;

export type ApplyResult = { ok: true; doc: Document3 } | { ok: false; error: string };

export const OVERVIEW_FULL = "The overview is full: make room there first";

/**
 * Split a new state of `channel` into the facts and the channel (contract, *Edits: facts or
 * channel*), then mark `outdated` on every other channel. Parts and connections are matched by
 * id; a part's fields are compared with what it drew before.
 */
export interface ApplyOptions {
  /**
   * The change may not touch the facts (a post or a simplify run): every text it changes becomes
   * the part's or connection's own, a new part or connection belongs to the channel only, and a
   * deletion deletes no fact.
   */
  keepFacts?: boolean;
}

export function applyChannel(doc: Document3, channel: ChannelId, next: ChannelState, o: ApplyOptions = {}): ApplyResult {
  const before = joinChannel(doc, channel);
  const comps = new Map(doc.facts.components.map((c) => [c.id, structuredClone(c)]));
  const rels = new Map(doc.facts.relations.map((r) => [r.id, structuredClone(r)]));
  const order = { comps: doc.facts.components.map((c) => c.id), rels: doc.facts.relations.map((r) => r.id) };
  const factIds = new Set<string>([...comps.keys(), ...rels.keys()]);
  const overview = channel === "overview";
  const keep = o.keepFacts === true;

  const oldParts = new Map<string, Part>(), oldConns = new Map<string, Connection>();
  for (const v of doc.channels[channel].views) {
    for (const p of v.nodes) oldParts.set(p.id, p);
    for (const c of v.edges) oldConns.set(c.id, c);
  }
  const drawnNodes = new Map<string, DiagramNode>(), drawnEdges = new Map<string, DiagramEdge>();
  for (const v of before.views) {
    for (const n of v.nodes) drawnNodes.set(n.id, n);
    for (const e of v.edges) drawnEdges.set(e.id, e);
  }

  const single = (p: Part) => (p.facts.length === 1 ? comps.get(p.facts[0]) ?? null : null);
  const writeText = (p: Part, f: TextField, value: string) => {
    const fact = single(p);
    if (keep || isSet(p[f]) || !fact) (p as unknown as Record<string, unknown>)[f] = value;
    else if (!overview && (f === "label" || f === "sub")) p[f] = value;
    else (fact as unknown as Record<string, unknown>)[f] = value;
  };
  const newFacts: string[] = [];
  const addFact = (n: DiagramNode): string => {
    const id = freeIdAmong(factIds, n.id);
    factIds.add(id);
    comps.set(id, { id, label: n.label, kind: n.kind, sub: n.sub, description: n.description, files: [...n.files], items: [...n.items] });
    order.comps.push(id);
    newFacts.push(id);
    return id;
  };

  // Parts.
  const views: View3[] = next.views.map((v) => ({
    id: v.id, title: v.title, caption: { ...v.caption },
    nodes: v.nodes.map((n): Part => {
      const old = oldParts.get(n.id);
      const drawn = drawnNodes.get(n.id);
      if (!old || !drawn) return newPart(n);
      const p: Part = structuredClone(old);
      Object.assign(p, appearance(n));
      if (n.facts && !same(n.facts, p.facts)) p.facts = [...new Set(n.facts.filter((f) => comps.has(f)))];
      for (const f of TEXT_FIELDS) if (n[f] !== drawn[f]) writeText(p, f, n[f]);
      items(p, drawn, n);
      files(p, drawn, n);
      return p;
    }),
    edges: [] as Connection[],
    texts: (v.texts ?? []).map((t) => ({ ...t })),
  }));

  function appearance(n: DiagramNode): Partial<Part> {
    return { form: n.form, icon: n.icon, parent: n.parent, detail: n.detail, place: n.place, lane: n.lane ?? null, x: n.x, y: n.y };
  }

  // A new part names the facts it shows in `facts` (or, from the run pipeline, `from`); one that
  // names none is new content and adds a fact, unless `facts: []` says it belongs to this channel
  // only, or the change may not touch the facts.
  function newPart(n: DiagramNode): Part {
    const named = n.facts ?? (n.from?.length ? n.from : undefined);
    const shown = [...new Set((named ?? []).filter((f) => comps.has(f)))];
    const p: Part = { id: n.id, facts: shown, form: n.form, icon: n.icon, parent: n.parent, detail: n.detail, place: n.place, lane: n.lane ?? null, x: n.x, y: n.y };
    if (named === undefined && !keep) {
      p.facts = [addFact(n)];
      return p;
    }
    const fact = shown.length === 1 ? comps.get(shown[0])! : null;
    for (const f of TEXT_FIELDS) if (!fact || fact[f] !== n[f]) (p as unknown as Record<string, unknown>)[f] = n[f];
    if (n.form === "panel" && (!fact || !same(fact.items, n.items))) p.items = [...n.items];
    return p;
  }

  function items(p: Part, drawn: DiagramNode, n: DiagramNode) {
    if (n.form !== "panel") {
      // A panel whose last item was removed turns into a card: the item goes from the fact too. Leaving
      // the panel form otherwise only hides the items (contract, Items).
      const fact = keep ? null : single(p);
      if (drawn.form === "panel" && drawn.items.length > 0 && n.items.length === 0 && fact && !isSet(p.items)) fact.items = [];
      delete p.items;
      return;
    }
    const fact = keep ? null : single(p);
    const X = [...n.items];
    if (drawn.form === "panel") {
      if (same(X, drawn.items)) return;
      if (isSet(p.items) || !fact) p.items = X;
      else fact.items = X;
      return;
    }
    if (isSet(p.items) || !fact) p.items = X;
    else if (same(X, fact.items)) delete p.items;
    else if (fact.items.length === 0) fact.items = X;
    else p.items = X;
  }

  function files(p: Part, drawn: DiagramNode, n: DiagramNode) {
    if (keep || same(drawn.files, n.files) || p.facts.length === 0) return;
    const added = n.files.filter((f) => !drawn.files.includes(f));
    const removed = new Set(drawn.files.filter((f) => !n.files.includes(f)));
    for (const id of p.facts) {
      const c = comps.get(id);
      if (c) c.files = c.files.filter((f) => !removed.has(f));
    }
    const first = comps.get(p.facts[0]);
    if (first) for (const f of added) if (!first.files.includes(f) && first.files.length < LIMITS.files) first.files.push(f);
  }

  // Connections.
  const partsById = new Map<string, Part>();
  for (const v of views) for (const p of v.nodes) partsById.set(p.id, p);
  const singleRel = (c: Connection) => (c.relations.length === 1 ? rels.get(c.relations[0]) ?? null : null);
  const writeEdge = (c: Connection, f: EdgeField, value: string | boolean) => {
    const rel = singleRel(c);
    if (keep || isSet(c[f]) || !rel) (c as unknown as Record<string, unknown>)[f] = value;
    else if (!overview && (f === "label" || f === "both")) (c as unknown as Record<string, unknown>)[f] = value;
    else (rel as unknown as Record<string, unknown>)[f] = value;
  };
  const relationBetween = (a: string, b: string) => [...rels.values()].find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a)) ?? null;
  const newRelations: string[] = [];

  next.views.forEach((v, vi) => {
    views[vi].edges = v.edges.map((e): Connection => {
      const old = oldConns.get(e.id);
      const drawn = drawnEdges.get(e.id);
      const kept = old && drawn && ((old.from === e.from && old.to === e.to) || (old.from === e.to && old.to === e.from));
      if (!kept) return newConnection(e);
      const c: Connection = structuredClone(old);
      if (e.relations && !same(e.relations, c.relations)) c.relations = [...new Set(e.relations.filter((r) => rels.has(r)))];
      c.step = e.step;
      if (old.from !== e.from) {
        // Reversed: in the overview the relation turns with it; elsewhere the connection keeps its drawn
        // text as its own and stops showing a relation it would contradict.
        const rel = singleRel(c);
        if (rel && !rel.both && !isSet(c.both)) {
          if (overview && !keep) [rel.from, rel.to] = [rel.to, rel.from];
          else { c.label = drawn.label; c.style = drawn.style; c.both = drawn.both; c.relations = []; }
        }
        c.from = e.from; c.to = e.to;
      }
      for (const f of EDGE_FIELDS) if (e[f] !== drawn[f]) writeEdge(c, f, e[f]);
      return c;
    });
  });

  function newConnection(e: DiagramEdge): Connection {
    const c: Connection = { id: e.id, from: e.from, to: e.to, relations: [], step: e.step };
    const given = [...new Set((e.relations ?? []).filter((r) => rels.has(r)))];
    const a = partsById.get(e.from), b = partsById.get(e.to);
    if (given.length) c.relations = given;
    else if (a?.facts.length === 1 && b?.facts.length === 1) {
      const [fa, fb] = [a.facts[0], b.facts[0]];
      const found = relationBetween(fa, fb);
      if (found) {
        c.relations = [found.id];
        if (found.from === fb && !found.both && !e.both) { c.from = e.to; c.to = e.from; }
      } else if (!keep) {
        const id = nextRelationId(factIds);
        factIds.add(id);
        rels.set(id, { id, from: fa, to: fb, label: e.label, style: e.style, both: e.both });
        order.rels.push(id);
        newRelations.push(id);
        c.relations = [id];
        return c;
      }
    }
    const rel = singleRel(c);
    for (const f of EDGE_FIELDS) if (!rel || rel[f] !== e[f]) (c as unknown as Record<string, unknown>)[f] = e[f];
    return c;
  }

  // Deletions: in the overview a deleted part takes the facts no other overview part shows, and a
  // deleted connection the relations no other overview connection shows.
  const deletedFacts = new Set<string>(), deletedRels = new Set<string>();
  if (overview && !keep) {
    const shown = new Set<string>(), shownRels = new Set<string>();
    for (const v of views) { for (const p of v.nodes) p.facts.forEach((f) => shown.add(f)); for (const c of v.edges) c.relations.forEach((r) => shownRels.add(r)); }
    const keptParts = new Set(views.flatMap((v) => v.nodes.map((p) => p.id)));
    const keptConns = new Set(views.flatMap((v) => v.edges.map((c) => c.id)));
    for (const [id, p] of oldParts) if (!keptParts.has(id)) for (const f of p.facts) if (!shown.has(f)) deletedFacts.add(f);
    for (const [id, c] of oldConns) if (!keptConns.has(id)) for (const r of c.relations) if (!shownRels.has(r)) deletedRels.add(r);
  }
  for (const r of rels.values()) if (deletedFacts.has(r.from) || deletedFacts.has(r.to)) deletedRels.add(r.id);

  const facts = {
    components: order.comps.filter((id) => comps.has(id) && !deletedFacts.has(id)).map((id) => comps.get(id)!),
    relations: order.rels.filter((id) => rels.has(id) && !deletedRels.has(id)).map((id) => rels.get(id)!),
  };

  const channels = {} as Record<ChannelId, Channel>;
  for (const c of CHANNELS) {
    const ch = doc.channels[c];
    channels[c] = c === channel
      ? { views, showSteps: next.showSteps ?? ch.showSteps, outdated: [...ch.outdated] }
      : structuredClone(ch);
  }

  const result: Document3 = {
    ...doc,
    title: next.title ?? doc.title,
    theme: next.theme ?? doc.theme,
    engine: next.engine !== undefined ? next.engine : doc.engine,
    facts, channels,
    requests: next.requests ? next.requests.map((r) => toRequest3(r, channel)) : doc.requests.map((r) => ({ ...r })),
    warnings: next.warnings ? [...next.warnings] : [...doc.warnings],
  };
  cascade(result, deletedFacts, deletedRels);
  orient(result);

  // A fact added outside the overview gets a part in the overview's first view (rule 16).
  if (!overview) {
    const added = newFacts.filter((f) => result.facts.components.some((c) => c.id === f));
    if (added.length) {
      const first = result.channels.overview.views[0];
      if (first.nodes.length + added.length > LIMITS.nodesPerView) return { ok: false, error: OVERVIEW_FULL };
      for (const f of added) placeInOverview(result, f);
    }
  }
  clearEqualOwnTexts(result);
  return { ok: true, doc: markOutdated(doc, result, [channel]) };
}

function nextRelationId(used: Set<string>): string {
  for (let k = 1; ; k++) if (!used.has(`r${k}`)) return `r${k}`;
}

function toRequest3(r: DiagramRequest, channel: ChannelId) {
  return { id: r.id, text: r.text, channel: isChannel(r.channel) ? r.channel : channel, view: r.view, at: r.at };
}

/** Drop references to deleted facts everywhere; remove what is left showing nothing it showed. */
function cascade(doc: Document3, deletedFacts: Set<string>, deletedRels: Set<string>) {
  const keptRels = new Set(doc.facts.relations.map((r) => r.id));
  const comps = new Map(doc.facts.components.map((c) => [c.id, c]));
  for (const c of CHANNELS) for (const v of doc.channels[c].views) {
    const gone = new Set<string>();
    for (const p of v.nodes) {
      if (!p.facts.some((f) => deletedFacts.has(f))) continue;
      p.facts = p.facts.filter((f) => !deletedFacts.has(f));
      if (p.facts.length === 0) gone.add(p.id);
    }
    if (gone.size) {
      const byId = new Map(v.nodes.map((p) => [p.id, p]));
      for (const p of v.nodes) if (p.parent && gone.has(p.parent)) {
        let up: string | null = p.parent;
        while (up && gone.has(up)) up = byId.get(up)?.parent ?? null;
        p.parent = up;
      }
      v.nodes = v.nodes.filter((p) => !gone.has(p.id));
      v.edges = v.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
    }
    v.edges = v.edges.filter((e) => {
      if (!e.relations.some((r) => deletedRels.has(r) || !keptRels.has(r))) return true;
      e.relations = e.relations.filter((r) => keptRels.has(r));
      return e.relations.length > 0;
    });
    // A fact left with no items turns the panels that showed them into cards.
    for (const p of v.nodes) {
      if (p.form !== "panel" || isSet(p.items) || p.facts.length !== 1) continue;
      if ((comps.get(p.facts[0])?.items.length ?? 0) === 0) p.form = "card";
    }
  }
}

/**
 * A connection showing one relation and no own two-way flag follows the relation's direction
 * (rule 12): when the relation runs the other way its ends are swapped, which changes nothing it means.
 */
export function orient(doc: Document3) {
  const rels = new Map(doc.facts.relations.map((r) => [r.id, r]));
  for (const c of CHANNELS) for (const v of doc.channels[c].views) {
    const parts = new Map(v.nodes.map((p) => [p.id, p]));
    for (const e of v.edges) {
      const rel = e.relations.length === 1 ? rels.get(e.relations[0]) : undefined;
      if (!rel || rel.both || isSet(e.both)) continue;
      const a = parts.get(e.from), b = parts.get(e.to);
      if (a && b && b.facts.includes(rel.from) && a.facts.includes(rel.to) && !(a.facts.includes(rel.from) && b.facts.includes(rel.to))) [e.from, e.to] = [e.to, e.from];
    }
  }
}

function placeInOverview(doc: Document3, factId: string) {
  const view = doc.channels.overview.views[0];
  const used = new Set(doc.channels.overview.views.flatMap((v) => [...v.nodes.map((p) => p.id), ...v.edges.map((e) => e.id), ...v.texts.map((t) => t.id)]));
  const part: Part = { id: freeIdAmong(used, factId), facts: [factId], form: "card", icon: null, parent: null, detail: null, place: null, lane: null, x: 0, y: 0 };
  const drawn = joinView(doc, "overview", view);
  const rects = [...layoutRects(drawn).values()];
  const box = layoutRects({ nodes: [joinPart(part, new Map(doc.facts.components.map((c) => [c.id, c])))] }).get(part.id)!;
  const right = rects.length ? Math.max(...rects.map((r) => r.x + r.w)) : 40;
  const top = rects.length ? Math.min(...rects.map((r) => r.y)) : 40;
  const at = freeSpot(rects, { x: right + 88 + box.w / 2, y: top + box.h / 2 }, box.w, box.h);
  part.x = at.x; part.y = at.y;
  view.nodes.push(part);
}

/** An own text equal to its single fact's is cleared (contract, *Where a text edit goes*). */
function clearEqualOwnTexts(doc: Document3) {
  const comps = new Map(doc.facts.components.map((c) => [c.id, c]));
  const rels = new Map(doc.facts.relations.map((r) => [r.id, r]));
  for (const c of CHANNELS) for (const v of doc.channels[c].views) {
    for (const p of v.nodes) {
      const fact = p.facts.length === 1 ? comps.get(p.facts[0]) : undefined;
      if (!fact) continue;
      for (const f of TEXT_FIELDS) if (isSet(p[f]) && p[f] === fact[f]) delete p[f];
      if (isSet(p.items) && same(p.items, fact.items)) delete p.items;
    }
    for (const e of v.edges) {
      const rel = e.relations.length === 1 ? rels.get(e.relations[0]) : undefined;
      if (!rel) continue;
      for (const f of EDGE_FIELDS) if (isSet(e[f]) && e[f] === rel[f]) delete e[f];
    }
  }
}

/** What a channel shows: its facts and relations, and how each is shown. */
function shows(ch: Channel) {
  const facts = new Set<string>(), rels = new Set<string>();
  const indirect = new Map<string, Set<string>>(); // fact or relation id → fields not shown directly
  const add = (id: string, field: string) => { if (!indirect.has(id)) indirect.set(id, new Set()); indirect.get(id)!.add(field); };
  for (const v of ch.views) {
    for (const p of v.nodes) {
      p.facts.forEach((f) => facts.add(f));
      if (p.facts.length > 1) for (const f of p.facts) for (const k of [...TEXT_FIELDS, "items"]) add(f, k);
      else if (p.facts.length === 1) {
        for (const k of TEXT_FIELDS) if (isSet(p[k])) add(p.facts[0], k);
        if (p.form === "panel" && isSet(p.items)) add(p.facts[0], "items");
      }
    }
    for (const e of v.edges) {
      e.relations.forEach((r) => rels.add(r));
      if (e.relations.length > 1) for (const r of e.relations) for (const k of EDGE_FIELDS) add(r, k);
      else if (e.relations.length === 1) for (const k of EDGE_FIELDS) if (isSet(e[k])) add(e.relations[0], k);
    }
  }
  return { facts, rels, indirect };
}

/**
 * Mark `outdated` on every channel not in `madeIn` that holds a view, for the change from
 * `before` to `after` (contract, *Edits: facts or channel*, `outdated`). Returns a new document.
 */
export function markOutdated(before: Document3, after: Document3, madeIn: readonly ChannelId[]): Document3 {
  const out: Document3 = { ...after, channels: { ...after.channels } };
  const bComps = new Map(before.facts.components.map((c) => [c.id, c]));
  const aComps = new Map(after.facts.components.map((c) => [c.id, c]));
  const bRels = new Map(before.facts.relations.map((r) => [r.id, r]));
  const aRels = new Map(after.facts.relations.map((r) => [r.id, r]));
  for (const c of CHANNELS) {
    if (madeIn.includes(c) || after.channels[c].views.length === 0) continue;
    const was = shows(before.channels[c]), now = shows(after.channels[c]);
    const ids: string[] = [];
    for (const id of aComps.keys()) if (!bComps.has(id)) ids.push(id);
    for (const id of bComps.keys()) if (!aComps.has(id) && was.facts.has(id)) ids.push(id);
    for (const [id, r] of aRels) if (!bRels.has(id) && now.facts.has(r.from) && now.facts.has(r.to)) ids.push(id);
    for (const [id, r] of bRels) if (!aRels.has(id) && (was.rels.has(id) || (was.facts.has(r.from) && was.facts.has(r.to)))) ids.push(id);
    for (const [id, a] of aComps) {
      const b = bComps.get(id);
      if (!b) continue;
      const changed = [...TEXT_FIELDS.filter((f) => a[f] !== b[f]), ...(same(a.items, b.items) ? [] : ["items"])];
      if (changed.some((f) => was.indirect.get(id)?.has(f) || now.indirect.get(id)?.has(f))) ids.push(id);
    }
    for (const [id, a] of aRels) {
      const b = bRels.get(id);
      if (!b) continue;
      const changed = EDGE_FIELDS.filter((f) => a[f] !== b[f]);
      if (changed.some((f) => was.indirect.get(id)?.has(f) || now.indirect.get(id)?.has(f))) ids.push(id);
    }
    const prev = after.channels[c].outdated;
    const merged = [...prev, ...ids.filter((id, i) => !prev.includes(id) && ids.indexOf(id) === i)];
    if (merged.length !== prev.length) out.channels[c] = { ...after.channels[c], outdated: merged };
  }
  return out;
}

/** An outside write: the channels whose views changed made the change; the others get marks. */
export function markOutside(before: Document3, after: Document3): Document3 {
  const madeIn = CHANNELS.filter((c) => JSON.stringify(before.channels[c].views) !== JSON.stringify(after.channels[c].views));
  return markOutdated(before, after, madeIn);
}

/** "Keep as it is" or a redraw: the channel's `outdated` is emptied. */
export function clearOutdated(doc: Document3, channel: ChannelId): Document3 {
  return { ...doc, channels: { ...doc.channels, [channel]: { ...doc.channels[channel], outdated: [] } } };
}


/** The depth checks on every channel view (contract, Warnings); Flat and No held items skip LinkedIn. */
export function channelWarnings(doc: Document3): string[] {
  return CHANNELS.flatMap((c) => depthWarnings({ views: joinChannel(doc, c).views }, { prefix: `channels.${c}.views`, overview: c === "overview", share: c === "linkedin" }));
}

/**
 * Normalisation of a valid `@3` file (contract, Normalisation): defaults, connection ids, a
 * position for every part that has none, group positions from their boxes. Returns a new document.
 */
export function normalizeFile3(file: File3, ctx: { id: string; now: string; source?: DiagramSource | null }): Document3 {
  const doc = fillDefaults3(file, { id: file.id ?? ctx.id, now: ctx.now, source: ctx.source });
  assignConnectionIds(doc);
  for (const c of CHANNELS) for (const v of doc.channels[c].views) {
    const placed = layoutView(joinView(doc, c, v));
    const at = new Map(placed.nodes.map((n) => [n.id, n]));
    for (const p of v.nodes) { const n = at.get(p.id); if (n) { p.x = n.x; p.y = n.y; } }
  }
  return doc;
}
