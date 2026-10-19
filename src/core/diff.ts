import type { DiagramDocument, DiagramEdge, DiagramNode } from "./model";

/**
 * What a run changed (api contract, the change summary): components added, removed, changed (any
 * field but the position) and moved (non-group components whose position differs: a group's box
 * follows its members), and connections added, removed and changed. Connections are matched by
 * their ends, either way round when two-way, because a run gives connections new ids. Pure.
 */
export interface Changes {
  added: string[]; removed: string[]; changed: string[]; moved: string[];
  edgesAdded: string[]; edgesRemoved: string[]; edgesChanged: string[];
}

export const NO_CHANGES: Changes = { added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] };

const content = (n: DiagramNode) => JSON.stringify([n.label, n.kind, n.form, n.icon, n.sub, n.items, n.description, n.files, n.parent, n.detail]);
const edgeContent = (e: DiagramEdge) => JSON.stringify([e.label, e.style, e.both, e.step]);

/** Changes between two versions of a document over `views` (default: every view in either). */
export function diffDocuments(before: Pick<DiagramDocument, "views">, after: Pick<DiagramDocument, "views">, views?: string[]): Changes {
  const out: Changes = { added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] };
  const ids = views ?? [...new Set([...before.views.map((v) => v.id), ...after.views.map((v) => v.id)])];
  const ends = new Map<string, string>();
  for (const vid of ids) {
    const a = before.views.find((v) => v.id === vid), b = after.views.find((v) => v.id === vid);
    const was = new Map((a?.nodes ?? []).map((n) => [n.id, n]));
    const now = new Map((b?.nodes ?? []).map((n) => [n.id, n]));
    for (const [id, n] of now) {
      const o = was.get(id);
      if (!o) { out.added.push(id); continue; }
      if (content(o) !== content(n)) out.changed.push(id);
      if (n.form !== "group" && o.form !== "group" && (o.x !== n.x || o.y !== n.y)) out.moved.push(id);
    }
    for (const id of was.keys()) if (!now.has(id)) out.removed.push(id);

    const left = [...(a?.edges ?? [])];
    const find = (e: DiagramEdge) => {
      let i = left.findIndex((o) => o.from === e.from && o.to === e.to);
      if (i < 0) i = left.findIndex((o) => o.from === e.to && o.to === e.from && (o.both || e.both));
      return i < 0 ? null : left.splice(i, 1)[0];
    };
    for (const e of b?.edges ?? []) {
      const o = find(e);
      if (!o) { out.edgesAdded.push(e.id); ends.set(`+${e.id}`, `${e.from}>${e.to}`); }
      else if (edgeContent(o) !== edgeContent(e) || (o.from !== e.from && !(o.both && e.both))) out.edgesChanged.push(e.id);
    }
    for (const o of left) { out.edgesRemoved.push(o.id); ends.set(`-${o.id}`, `${o.from}>${o.to}`); }
  }
  // A component that leaves one view for another (a simplification moving it one view down) moved;
  // the connections that went with it, between the same ends, are not new.
  const findNode = (d: Pick<DiagramDocument, "views">, id: string) => { for (const v of d.views) { const n = v.nodes.find((x) => x.id === id); if (n) return n; } return null; };
  for (const id of out.added.filter((x) => out.removed.includes(x))) {
    out.added = out.added.filter((x) => x !== id); out.removed = out.removed.filter((x) => x !== id);
    const o = findNode(before, id), n = findNode(after, id);
    if (o && n && content(o) !== content(n)) out.changed.push(id);
    if (n && n.form !== "group") out.moved.push(id);
  }
  for (const id of [...out.edgesAdded]) {
    const k = ends.get(`+${id}`), gone = out.edgesRemoved.find((r) => ends.get(`-${r}`) === k);
    if (!gone) continue;
    out.edgesAdded = out.edgesAdded.filter((x) => x !== id); out.edgesRemoved = out.edgesRemoved.filter((x) => x !== gone);
  }
  return out;
}

/** The ids the editor marks after a run: added, changed and moved components. */
export const touched = (c: Changes): string[] => [...new Set([...c.added, ...c.changed, ...c.moved])];

/** `1 part added · 2 connections changed · 3 parts moved`, or `Nothing changed` (ui contract, ai-summary). */
export function summarize(c: Changes): string {
  const n = (k: number, one: string, many: string, what: string) => (k ? `${k} ${k === 1 ? one : many} ${what}` : "");
  const parts = [
    n(c.added.length, "part", "parts", "added"), n(c.removed.length, "part", "parts", "removed"),
    n(c.changed.length, "part", "parts", "changed"), n(c.moved.length, "part", "parts", "moved"),
    n(c.edgesAdded.length, "connection", "connections", "added"), n(c.edgesRemoved.length, "connection", "connections", "removed"),
    n(c.edgesChanged.length, "connection", "connections", "changed"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing changed";
}
