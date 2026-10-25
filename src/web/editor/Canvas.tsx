import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { curvePieces, edgesOverParts, hubsOf, layoutRects, measureText, routeEdges, textStyle, trunksOf, usedByBoxes, type EdgeRoute, type Rect, type Side } from "../../core/geometry";
import { badgeMarkup, drawOrder, edgeMarkup, groupHeadMarkup, labelMarkup, nodeMarkup, dashOf, sharedDefs, strokeOf, textMarkup, toneOf, trunkMarkup, type Trace } from "../../core/export/svg";
import { descendants, isPostView, LIMITS, type DiagramEdge, type DiagramNode, type DiagramText, type Kind } from "../../core/model";
import type { Palette } from "../../core/theme";
import { clampTextSize, connect, groupAt, moveNodes, moveTexts, setText, settleNodes, VIEW_FULL, withInside } from "./ops";
import { snapDrag, type Snap } from "./guides";
import type { Ctl, Selection } from "./types";
import { NOTHING } from "./types";
import { detailAt, toWorld, zoomAt } from "./viewport";

/* ---------- pieces of the drawing: the same markup as every export (invariant 5) ---------- */

/** A drag's marks on a part or a connection (ui contract, Dragging): lifted, or dimmed while others move. */
type DragMark = "lifted" | "dim" | undefined;

const NodeShape = memo(function NodeShape({ node, rect, P, selected, dim, changed, open = false, post, match, on = false, drag, subLines = true, dropTarget = false, traces, usedBy }: { node: DiagramNode; rect: Rect; P: Palette; selected: boolean; dim: boolean; changed: boolean; open?: boolean; post: boolean; match?: "true" | "current"; on?: boolean; drag?: DragMark; subLines?: boolean; dropTarget?: boolean; traces?: string; usedBy?: string }) {
  return (
    <g className={`nd${dim ? " dim" : ""}${changed ? " changed" : ""}${open ? " open" : ""}`} data-changed={changed ? "true" : undefined} data-dim={dim ? "true" : undefined} data-match={match} data-step={on ? "on" : undefined} data-testid={`node-${node.id}`} data-node-id={node.id} data-kind={node.kind} data-form={node.form}
      data-parent={node.parent ?? ""} data-selected={String(selected)} data-lifted={drag === "lifted" ? "true" : undefined} data-drag-dim={drag === "dim" ? "true" : undefined} data-drop-target={dropTarget ? "true" : undefined} style={{ ["--hover-k" as string]: P.kinds[node.kind] }}
      // A part with an inside is a button that opens it (ui contract, Opening a part's inside).
      {...(node.detail ? { "data-open": "true", tabIndex: 0, role: "button", "aria-label": `Open ${node.label}` } : {})}
      dangerouslySetInnerHTML={{ __html: nodeMarkup(node, rect, P, { testIds: true, post, subLines, traces: traces ? (JSON.parse(traces) as Trace[]) : undefined, usedBy: usedBy ? JSON.parse(usedBy) : undefined }) }} />
  );
});

/**
 * The part an element belongs to: its `node-<id>`, or a group's head, which stands for its group. The head carries no
 * `data-node-id`: in the editor as in the export, that names a part's own box (H87 reads each part's box from it).
 */
export const partIdOf = (el: Element | null): string | null => {
  const hit = el?.closest?.("[data-node-id], [data-group-head]");
  return hit ? hit.getAttribute("data-node-id") ?? hit.getAttribute("data-group-head") : null;
};

/** A group's head (ui contract, `node-head-<id>`): over the connections and under the parts, its name on a halo. */
const GroupHead = memo(function GroupHead({ node, rect, P, dim, open = false, post, drag, subLines = true }: { node: DiagramNode; rect: Rect; P: Palette; dim: boolean; open?: boolean; post: boolean; drag?: DragMark; subLines?: boolean }) {
  return (
    <g className={`gh${dim ? " dim" : ""}${open ? " open" : ""}`} data-testid={`node-head-${node.id}`} data-group-head={node.id}
      data-lifted={drag === "lifted" ? "true" : undefined} data-drag-dim={drag === "dim" ? "true" : undefined}
      dangerouslySetInnerHTML={{ __html: groupHeadMarkup(node, rect, P, { testIds: true, post, subLines }) }} />
  );
});

/** A route's ends and handles, in order. */
const curvePoints = (r: EdgeRoute) => [r.p0, r.c1, r.c2, r.p1];
/** `r` with each end and handle moved by `k` × its offset in `delta`. */
function shifted(r: EdgeRoute, delta: [number, number][], k: number): EdgeRoute {
  const [p0, c1, c2, p1] = curvePoints(r).map((p, i) => ({ x: Math.round((p.x + delta[i][0] * k) * 10) / 10, y: Math.round((p.y + delta[i][1] * k) * 10) / 10 }));
  return { ...r, p0, c1, c2, p1, d: `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}` };
}
const GLIDE_MS = 120;

/**
 * The route a connection is drawn on. While `on` (a drag, and once on its release), when its sides or an end's place on
 * its part change (`key`), it glides there over 120 ms: drawn at the new route plus the old offset, shrinking to none,
 * so it still follows a moving part. Otherwise, and at the end of every glide, exactly `route` (invariant 5).
 */
function useGlide(route: EdgeRoute, key: string, on: boolean): EdgeRoute {
  const glide = useRef<{ delta: [number, number][]; t0: number } | null>(null);
  const prev = useRef({ key, route, shown: route });
  const [, tick] = useState(0);
  const now = performance.now();
  if (!on) glide.current = null;
  else if (prev.current.route !== route && prev.current.key !== key) {
    const from = curvePoints(prev.current.shown), to = curvePoints(route);
    glide.current = { delta: from.map((p, i) => [p.x - to[i].x, p.y - to[i].y]), t0: now };
  }
  let shown = route;
  if (glide.current) {
    const t = Math.min(1, (now - glide.current.t0) / GLIDE_MS);
    // Ease out: quick at first, settling on the route.
    if (t >= 1) glide.current = null;
    else shown = shifted(route, glide.current.delta, (1 - t) * (1 - t));
  }
  prev.current = { key, route, shown };
  const active = !!glide.current;
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => tick((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  });
  return shown;
}

const EdgeShape = memo(function EdgeShape({ edge, route: target, P, from, to, selected, dim, flow, open = false, focus = false, dragDim = false, hidden = false, glide = false, glideKey = "" }: { edge: DiagramEdge; route: EdgeRoute; P: Palette; from: Kind; to: Kind; selected: boolean; dim: boolean; flow: boolean; open?: boolean; focus?: boolean; dragDim?: boolean; hidden?: boolean; glide?: boolean; glideKey?: string }) {
  const route = useGlide(target, glideKey, glide);
  const tone = toneOf(edge, focus);
  return (
    <g className={`ed${dim ? " dim" : ""}${open ? " open" : ""}`} data-dim={dim ? "true" : undefined} data-testid={`edge-${edge.id}`} data-edge-id={edge.id} data-style={edge.style} data-both={String(edge.both)}
      data-step={edge.step ?? ""} data-selected={String(selected)} data-tone={tone} data-focus={focus ? "true" : undefined} data-drag-dim={dragDim ? "true" : undefined} data-hidden={hidden ? "true" : undefined}>
      <g dangerouslySetInnerHTML={{ __html: edgeMarkup(edge, route, P, { fromKind: from, toKind: to, tone }) }} />
      {flow && <path className="flow" d={route.d} />}
      <path className="hit" d={route.d} />
      <EdgeBounds route={route} />
    </g>
  );
});

/** An invisible box around the curve: a straight edge's own box has no height, which would make it unmeasurable. */
function EdgeBounds({ route }: { route: EdgeRoute }) {
  const xs = [route.p0.x, route.p1.x, route.c1.x, route.c2.x], ys = [route.p0.y, route.p1.y, route.c1.y, route.c2.y];
  const x = Math.min(...xs) - 4, y = Math.min(...ys) - 4;
  return <rect className="bounds" x={x} y={y} width={Math.max(...xs) + 4 - x} height={Math.max(...ys) + 4 - y} fill="none" pointerEvents="none" />;
}

const TextShape = memo(function TextShape({ text, P, selected, typing }: { text: DiagramText; P: Palette; selected: boolean; typing: boolean }) {
  const m = measureText(text);
  return (
    <g className="tx" data-testid={`text-${text.id}`} data-text-id={text.id} data-size={text.size} data-selected={String(selected)} style={typing ? { visibility: "hidden" } : undefined}>
      {/* A transparent box makes the whole text easy to grab, not only its glyphs. Its margin covers
          the glyph box at the largest size (Geist rises 4.5% of the size above the line top), so the
          text's outline stays put on the corner that is held while it is scaled. */}
      <rect x={text.x - 4} y={text.y - 10} width={m.w + 8} height={m.h + 14} fill="transparent" />
      <g dangerouslySetInnerHTML={{ __html: textMarkup(text, P) }} />
    </g>
  );
});

/* ---------- interactions ---------- */

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  /** `off`: how far the pieces have moved, in drawing px; the document changes only on release (ui contract, Dragging). */
  | { kind: "move"; ids: string[]; texts: string[]; start: { x: number; y: number }; off: { x: number; y: number }; moved: boolean; hit: { node?: string; text?: string; inside?: boolean }; shift: boolean; snap?: Snap }
  | { kind: "marquee"; start: { x: number; y: number }; cur: { x: number; y: number }; shift: boolean }
  | { kind: "connect"; from: string; cur: { x: number; y: number } }
  | { kind: "scale"; id: string; corner: Corner; size0: number; box: Rect; moved: boolean };

/** A selected text's corner handles scale it, the opposite corner staying put (ui contract, Texts). */
const CORNERS = ["nw", "ne", "sw", "se"] as const;
type Corner = (typeof CORNERS)[number];

const SIDES = ["t", "r", "b", "l"] as const;
const portAt = (r: Rect, s: (typeof SIDES)[number]) =>
  s === "t" ? { x: r.x + r.w / 2, y: r.y } : s === "b" ? { x: r.x + r.w / 2, y: r.y + r.h } : s === "l" ? { x: r.x, y: r.y + r.h / 2 } : { x: r.x + r.w, y: r.y + r.h / 2 };

export function Canvas({ ctl, steps, onDouble }: { ctl: Ctl; steps: boolean; onDouble: (e: React.MouseEvent) => void }) {
  const { view, P, vp, sel } = ctl;
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** The connection under the pointer: its line, its label or its badge. */
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;

  const post = isPostView(view);
  const restRects = useMemo(() => layoutRects(view), [view]);
  const restRoutes = useMemo(() => routeEdges(view, restRects, { avoid: view.texts.map((t) => ({ x: t.x, y: t.y, ...measureText(t) })) }), [view, restRects]);
  // While a drag is on, only the dragged pieces and their own connections move (ui contract, Dragging):
  // every other box, path, label and badge, the frames of the dragged parts' groups too, holds until release.
  const dragOff = live?.kind === "move" && live.moved ? live.off : null;
  const moving = useMemo(() => (live?.kind === "move" && live.moved && live.ids.length ? withInside(view, live.ids) : null), [live, view]);
  const movingTexts = useMemo(() => new Set(live?.kind === "move" && live.moved ? live.texts : []), [live]);
  const texts = useMemo(() => (dragOff && movingTexts.size ? view.texts.map((t) => (movingTexts.has(t.id) ? { ...t, x: t.x + dragOff.x, y: t.y + dragOff.y } : t)) : view.texts), [view, dragOff, movingTexts]);
  const rects = useMemo(() => {
    if (!dragOff || !moving) return restRects;
    const out = new Map(restRects);
    for (const id of moving) { const r = restRects.get(id); if (r) out.set(id, { ...r, x: r.x + dragOff.x, y: r.y + dragOff.y }); }
    return out;
  }, [restRects, moving, dragOff]);
  const touches = (e: DiagramEdge) => !!moving && (moving.has(e.from) || moving.has(e.to));
  // The group the piece under the pointer would join on release, by its centre (ui contract, Dragging: The target group).
  const dropTarget = useMemo(() => {
    if (!dragOff || !moving || live?.kind !== "move" || !live.hit.node || !moving.has(live.hit.node)) return null;
    const parentOf = (id: string) => view.nodes.find((n) => n.id === id)?.parent ?? null;
    let piece = live.hit.node;
    for (let p = parentOf(piece); p && moving.has(p); p = parentOf(p)) piece = p;
    const shifted = { ...view, nodes: view.nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dragOff.x, y: n.y + dragOff.y } : n)) };
    const r = layoutRects(shifted).get(piece);
    return r ? groupAt(shifted, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, piece) : null;
  }, [view, moving, dragOff, live]);
  // A drag just ended: its ends may glide once to the stateless routes (diagram contract, While dragging).
  const dragged = useRef(false);
  const [afterDrag, setAfterDrag] = useState(false);
  useEffect(() => {
    if (moving) { dragged.current = true; return; }
    if (!dragged.current) return;
    dragged.current = false;
    setAfterDrag(true);
    const t = setTimeout(() => setAfterDrag(false), GLIDE_MS + 60);
    return () => clearTimeout(t);
  }, [moving]);
  // The sides each dragged part's connections had at the previous move (diagram contract, While dragging): held until
  // a pair is clearly cheaper. They start from the drawing at rest and are forgotten on release.
  const heldSides = useRef<Map<string, [Side, Side]> | null>(null);
  const routes = useMemo(() => {
    if (!dragOff || !moving) { heldSides.current = null; return restRoutes; }
    const own = view.edges.filter((e) => moving.has(e.from) || moving.has(e.to));
    const before = heldSides.current ?? new Map(own.flatMap((e) => { const r = restRoutes.get(e.id); return r ? [[e.id, [r.side0, r.side1] as [Side, Side]] as const] : []; }));
    const again = routeEdges(view, rects, { avoid: texts.map((t) => ({ x: t.x, y: t.y, ...measureText(t) })), held: before });
    heldSides.current = new Map(own.flatMap((e) => { const r = again.get(e.id); return r ? [[e.id, [r.side0, r.side1] as [Side, Side]] as const] : []; }));
    const out = new Map(restRoutes);
    for (const e of view.edges) {
      if (!moving.has(e.from) && !moving.has(e.to)) continue;
      const r = again.get(e.id);
      if (r) out.set(e.id, r); else out.delete(e.id);
    }
    return out;
  }, [view, rects, texts, restRoutes, moving, dragOff]);
  const order = useMemo(() => drawOrder(view), [view]);
  const kindOf = useMemo(() => new Map(view.nodes.map((n) => [n.id, n.kind])), [view]);
  const defs = useMemo(() => sharedDefs(P, "ad"), [P]);

  // What stays lit while a component's callout is open: it, its neighbours, its group and its members.
  const lit = useMemo(() => {
    if (!ctl.callout || !rects.has(ctl.callout)) return null;
    const id = ctl.callout;
    const s = new Set<string>([id, ...descendants(view, id)]);
    for (let p = view.nodes.find((n) => n.id === id)?.parent; p; p = view.nodes.find((n) => n.id === p)?.parent) s.add(p);
    for (const e of view.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); }
    return s;
  }, [ctl.callout, view, rects]);

  const selNodes = new Set(sel.nodes), selEdges = new Set(sel.edges), selTexts = new Set(sel.texts);

  /* wheel zoom around the pointer; Ctrl+wheel and pinch are faster */
  useEffect(() => {
    const node = el.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = node.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      ctlRef.current.setVp(zoomAt(ctlRef.current.vp, f, { x: e.clientX - b.left, y: e.clientY - b.top }));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const b = el.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const world = (e: { clientX: number; clientY: number }) => toWorld(ctlRef.current.vp, local(e));
  const nodeUnder = (x: number, y: number): string | null => {
    for (const elem of document.elementsFromPoint(x, y)) {
      const id = partIdOf(elem as Element);
      if (id) return id;
    }
    return null;
  };

  /* Space held: the next drag pans, whatever the tool (ui contract canvas). */
  const spaceRef = useRef(false);
  const [space, setSpace] = useState(false);
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
    // Space on a views-panel entry goes to its view (ui contract, Choices and the views panel), so it is not held for panning there.
    const entry = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('[data-testid="views-panel"]');
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target) || entry(e.target)) return;
      e.preventDefault();
      if (!spaceRef.current) { spaceRef.current = true; setSpace(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") { spaceRef.current = false; setSpace(false); } };
    const blur = () => { spaceRef.current = false; setSpace(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const c = ctlRef.current;
    const t = e.target as Element;
    // A drag on the canvas never selects page text (it made panning feel stuck).
    if (!t.closest("input, textarea, [contenteditable]")) e.preventDefault();
    el.current!.focus({ preventScroll: true });
    const port = t.closest("[data-port]")?.getAttribute("data-port");
    const nodeId = partIdOf(t);
    const edgeId = t.closest("[data-edge-id]")?.getAttribute("data-edge-id") ?? t.closest("[data-edge-label-of]")?.getAttribute("data-edge-label-of") ?? null;
    const textId = t.closest("[data-text-id]")?.getAttribute("data-text-id") ?? null;
    const p = world(e);
    if (c.picker) c.setPicker(null);
    if (c.editing) return;
    const start = (d: Drag) => { drag.current = d; setLive(d); el.current!.setPointerCapture(e.pointerId); };

    // Pan with the pan tool, or from any tool with Space held, the middle or the right button.
    if (e.button === 1 || e.button === 2 || spaceRef.current || c.tool === "pan") return start({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: c.vp.x, vy: c.vp.y });
    if (port) return start({ kind: "connect", from: port, cur: p });
    const handle = t.closest("[data-text-handle]");
    if (handle) {
      const id = handle.getAttribute("data-text-of")!;
      const tx = c.view.texts.find((x) => x.id === id);
      if (tx) return start({ kind: "scale", id, corner: handle.getAttribute("data-text-handle") as Corner, size0: tx.size, box: { x: tx.x, y: tx.y, ...measureText(tx) }, moved: false });
    }
    if (c.tool === "component") {
      // A full view is refused before the picker opens (diagram contract, validation).
      if (c.view.nodes.length >= LIMITS.nodesPerView) { c.toast(VIEW_FULL); return; }
      const b = local(e);
      c.setPicker({ screen: b, world: p });
      return;
    }
    if (c.tool === "text") {
      // Clicking on a text edits it; elsewhere the caret's first line is centred on the click.
      const tx = textId ? c.view.texts.find((x) => x.id === textId) : null;
      const size = c.textSize.current;
      c.setTool("select");
      c.setSel(tx ? { ...NOTHING, texts: [tx.id] } : NOTHING);
      c.setEditing(tx ? { kind: "text", id: tx.id, at: { x: tx.x, y: tx.y }, size: tx.size }
        : { kind: "text", id: null, at: { x: Math.round(p.x), y: Math.round(p.y - textStyle(size).line / 2) }, size });
      return;
    }
    if (c.tool === "connect") {
      if (nodeId) start({ kind: "connect", from: nodeId, cur: p });
      return;
    }
    // select tool
    if (nodeId || textId) {
      let next: Selection = c.sel;
      const already = nodeId ? c.sel.nodes.includes(nodeId) : c.sel.texts.includes(textId!);
      if (e.shiftKey) {
        next = nodeId
          ? { ...c.sel, nodes: already ? c.sel.nodes.filter((x) => x !== nodeId) : [...c.sel.nodes, nodeId] }
          : { ...c.sel, texts: already ? c.sel.texts.filter((x) => x !== textId) : [...c.sel.texts, textId!] };
      } else if (!already) {
        next = nodeId ? { ...NOTHING, nodes: [nodeId] } : { ...NOTHING, texts: [textId!] };
      }
      c.setSel(next);
      return start({ kind: "move", ids: next.nodes, texts: next.texts, start: p, off: { x: 0, y: 0 }, moved: false, hit: { node: nodeId ?? undefined, text: textId ?? undefined, inside: !!t.closest("[data-testid=node-inside]") }, shift: e.shiftKey });
    }
    if (edgeId) {
      c.setSel(e.shiftKey ? { ...c.sel, edges: c.sel.edges.includes(edgeId) ? c.sel.edges.filter((x) => x !== edgeId) : [...c.sel.edges, edgeId] } : { ...NOTHING, edges: [edgeId] });
      c.setCallout(null);
      return;
    }
    start({ kind: "marquee", start: p, cur: p, shift: e.shiftKey });
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const c = ctlRef.current;
    if (d.kind === "pan") {
      c.setVp({ ...c.vp, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
      return;
    }
    const p = world(e);
    if (d.kind === "move") {
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) * c.vp.k < 3) return;
      if (!d.moved) {
        // A run pauses edits: the piece does not lift, and the reason shows once.
        const no = c.refused();
        if (no) { c.toast(no); drag.current = null; setLive(null); return; }
        d.moved = true;
        if (d.ids.length) c.setDragging(true);
      }
      // Nothing in the document changes until release: one edit, one save, one undo step.
      const raw = { x: p.x - d.start.x, y: p.y - d.start.y };
      // Guides, equal gaps or the grid place the dragged components during the drag, so release moves nothing
      // (ui contract, Dragging: Guides and snapping); Alt turns snapping off.
      const snap = d.ids.length ? snapOf(d.ids, raw, c.vp.k, e.altKey) : null;
      d.snap = snap ?? undefined;
      d.off = snap ? { x: Math.round(raw.x + snap.dx), y: Math.round(raw.y + snap.dy) } : raw;
      setLive({ ...d });
    } else if (d.kind === "scale") {
      const b = d.box, west = d.corner.endsWith("w"), north = d.corner.startsWith("n");
      // The pointer's distance from the fixed corner, as a share of the box, on whichever axis moved more.
      const w = west ? b.x + b.w - p.x : p.x - b.x, h = north ? b.y + b.h - p.y : p.y - b.y;
      const size = clampTextSize(d.size0 * Math.max(0.05, Math.max(w / b.w, h / b.h)));
      if (!d.moved) { if (size === d.size0) return; d.moved = true; c.checkpoint(); }
      const m = measureText({ text: c.view.texts.find((x) => x.id === d.id)?.text ?? "", size });
      c.apply((doc) => setText(doc, c.vid, d.id, { size, x: west ? b.x + b.w - m.w : b.x, y: north ? b.y + b.h - m.h : b.y }), { record: false });
      c.textSize.current = size;
    } else {
      d.cur = p;
      setLive({ ...d });
    }
  };

  /** The snap of the dragged components' box at `raw` (ui contract, Dragging): against every other component that holds none of them. */
  const snapOf = (ids: string[], raw: { x: number; y: number }, k: number, alt: boolean): Snap | null => {
    const v = ctlRef.current.view;
    const moved = withInside(v, ids);
    const holders = new Set<string>();
    for (const id of moved) for (let p = v.nodes.find((n) => n.id === id)?.parent; p; p = v.nodes.find((n) => n.id === p)?.parent) holders.add(p);
    const own = [...moved].map((id) => restRects.get(id)).filter((r): r is Rect => !!r);
    if (!own.length) return null;
    const x0 = Math.min(...own.map((r) => r.x)), y0 = Math.min(...own.map((r) => r.y));
    const box = { x: x0 + raw.x, y: y0 + raw.y, w: Math.max(...own.map((r) => r.x + r.w)) - x0, h: Math.max(...own.map((r) => r.y + r.h)) - y0 };
    const others = v.nodes.filter((n) => !moved.has(n.id) && !holders.has(n.id)).map((n) => restRects.get(n.id)).filter((r): r is Rect => !!r);
    return snapDrag(box, others, k, alt);
  };

  /**
   * The keyboard on parts with an inside (ui contract, Opening a part's inside): Enter goes in; Tab and Shift+Tab move
   * between them in the order of the view's parts, after `canvas` (the drawing order puts groups first).
   */
  const onOpenKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as Element;
    const c = ctlRef.current;
    const openable = c.view.nodes.filter((n) => n.detail);
    const focusPart = (id: string) => (el.current?.querySelector(`[data-testid="node-${CSS.escape(id)}"]`) as HTMLElement | SVGElement | null)?.focus();
    const at = t.getAttribute?.("data-open") === "true" ? t.getAttribute("data-node-id") : null;
    if (e.key === "Enter" && at) {
      e.preventDefault();
      const detail = c.view.nodes.find((n) => n.id === at)?.detail;
      if (detail) c.goView(detail);
      return;
    }
    if (e.key !== "Tab" || !openable.length || c.editing) return;
    const i = at ? openable.findIndex((n) => n.id === at) : -1;
    if (t === el.current && !e.shiftKey) { e.preventDefault(); focusPart(openable[0].id); return; }
    if (i < 0) return;
    const next = i + (e.shiftKey ? -1 : 1);
    if (next >= 0 && next < openable.length) { e.preventDefault(); focusPart(openable[next].id); return; }
    // Before the first: back to the canvas; after the last, the page's own order goes on past the canvas.
    if (next < 0) { e.preventDefault(); el.current?.focus({ preventScroll: true }); }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setLive(null);
    if (!d) return;
    const c = ctlRef.current;
    if (d.kind === "move") {
      if (d.moved) c.setDragging(false);
      if (d.moved) {
        const { x: dx, y: dy } = d.off;
        c.apply((doc) => moveTexts(settleNodes(moveNodes(doc, c.vid, d.ids, dx, dy), c.vid, d.ids), c.vid, d.texts, dx, dy, true));
      } else if (d.hit.node && view.nodes.find((n) => n.id === d.hit.node)?.detail) {
        // A part with an inside (ui contract, Opening a part's inside): a click goes to its view, selecting nothing;
        // Shift+click toggles it in the selection and opens its callout when it is then the only part selected.
        const detail = view.nodes.find((n) => n.id === d.hit.node)!.detail!;
        if (!d.shift) c.goView(detail);
        else if (d.ids.length === 1 && d.ids[0] === d.hit.node) c.setCallout(d.hit.node);
      } else if (!d.shift && d.hit.node) {
        // A click: open or close the component's callout.
        c.setSel({ ...NOTHING, nodes: [d.hit.node] });
        c.setCallout(c.callout === d.hit.node ? null : d.hit.node);
      } else if (!d.shift && d.hit.text) {
        c.setSel({ ...NOTHING, texts: [d.hit.text] });
        c.setCallout(null);
      }
    } else if (d.kind === "marquee") {
      const x0 = Math.min(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y), x1 = Math.max(d.start.x, d.cur.x), y1 = Math.max(d.start.y, d.cur.y);
      if ((x1 - x0) * c.vp.k < 4 && (y1 - y0) * c.vp.k < 4) {
        if (!d.shift) { c.setSel(NOTHING); c.setCallout(null); }
        return;
      }
      const touch = (r: Rect) => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
      const nodes = view.nodes.filter((n) => touch(rects.get(n.id)!)).map((n) => n.id);
      const texts = view.texts.filter((t) => touch({ x: t.x, y: t.y, ...measureText(t) })).map((t) => t.id);
      const merge = (a: string[], b: string[]) => (d.shift ? [...new Set([...a, ...b])] : b);
      c.setSel({ nodes: merge(c.sel.nodes, nodes), texts: merge(c.sel.texts, texts), edges: d.shift ? c.sel.edges : [] });
      c.setCallout(null);
    } else if (d.kind === "connect") {
      const to = nodeUnder(e.clientX, e.clientY);
      if (to && to !== d.from) {
        let msg: string | null = null;
        c.apply((doc) => { const r = connect(doc, c.vid, d.from, to); msg = r.message; return r.doc; });
        if (msg) c.toast(msg);
      }
    }
  };

  /* ---------- render ---------- */
  const groups = order.filter((n) => n.form === "group");
  const plain = order.filter((n) => n.form !== "group");
  // While searching, the matches stay lit and everything else dims (ui contract, search); otherwise an open callout decides.
  const found = ctl.found;
  const matchOf = (id: string) => (!found?.ids.has(id) ? undefined : found.current === id ? "current" : "true");
  // A presentation step lights its parts the way search does, never changing a part's size.
  const step = found ? null : ctl.step;
  const dimNode = (id: string) => (found ? !found.ids.has(id) : step ? !step.has(id) : !!lit && !lit.has(id));
  const dimEdge = (e: DiagramEdge) => (steps && e.step === null) || (step ? !(step.has(e.from) && step.has(e.to)) : found ? !(found.ids.has(e.from) && found.ids.has(e.to))
    : !!lit && !(lit.has(e.from) && lit.has(e.to) && (e.from === ctl.callout || e.to === ctl.callout || descendants(view, ctl.callout!).has(e.from))));
  const hovered = hover && rects.get(hover) && ctl.tool !== "pan" && !live ? hover : null;
  const k = vp.k;
  // Semantic zoom: the level comes from the zoom only; sizes never change.
  const detail = detailAt(k);
  const touchesOpen = (e: DiagramEdge) => !!ctl.callout && (e.from === ctl.callout || e.to === ctl.callout);
  // Connections in focus take their kind colours (ui contract, Connections in focus); the rest stay neutral.
  const ends = (e: DiagramEdge, has: (id: string) => boolean) => has(e.from) || has(e.to);
  const inFocus = (e: DiagramEdge) => touches(e) || selEdges.has(e.id) || (!live && hoverEdge === e.id)
    || (!live && !!hover && ends(e, (id) => id === hover)) || ends(e, (id) => selNodes.has(id) || id === ctl.callout)
    || (!!step && step.has(e.from) && step.has(e.to)) || (!!found && found.ids.has(e.from) && found.ids.has(e.to));
  const dragMark = (id: string): DragMark => (!moving ? undefined : moving.has(id) ? "lifted" : "dim");
  // Ends glide while a drag is on and once on its release, to the stateless routes (diagram contract, While dragging).
  const gliding = !!moving || afterDrag || dragged.current;
  // Its sides and where each end sits on its part: a change of these glides, a part carrying its ends does not.
  const endsKey = (e: DiagramEdge, r: EdgeRoute) => {
    const a = rects.get(e.from), b = rects.get(e.to);
    return a && b ? `${r.side0}${r.side1} ${Math.round(r.p0.x - a.x)},${Math.round(r.p0.y - a.y)} ${Math.round(r.p1.x - b.x)},${Math.round(r.p1.y - b.y)}` : "";
  };
  // A connection a hub hides shows while one of its ends is hovered, selected or dragged (ui contract, Parts many parts
  // use), where the routing put it: nothing else moves.
  const showing = (e: DiagramEdge) => touches(e) || selEdges.has(e.id) || (!live && !!hover && ends(e, (id) => id === hover)) || ends(e, (id) => selNodes.has(id));
  const hiddenNow = (e: DiagramEdge) => !!routes.get(e.id)?.hidden && !showing(e);
  const shownKey = view.edges.filter((e) => routes.get(e.id)?.hidden && showing(e)).map((e) => e.id).join(" ");
  const usedBy = useMemo(() => {
    const n = hubsOf(view), marks = usedByBoxes(view, rects);
    return new Map([...marks].map(([id, box]) => [id, JSON.stringify({ n: n.get(id), box })]));
  }, [view, rects]);
  // A connection passing behind a part shows as a faint trace over it (diagram contract, Traces), coloured as its line is now;
  // a hidden one only while it shows.
  const over = useMemo(() => {
    const shown = new Set(shownKey ? shownKey.split(" ") : []);
    const drawn = new Map([...routes].map(([id, r]) => [id, r.hidden && shown.has(id) ? { ...r, hidden: false } : r]));
    return edgesOverParts(view, rects, drawn);
  }, [view, rects, routes, shownKey]);
  const tracesFor = (id: string): string | undefined => {
    const list = over.filter((o) => o.node === id).map((o) => {
      const e = view.edges.find((x) => x.id === o.edge)!;
      // The pieces of the line inside the part: the part's element keeps the part's own box (node-<id> measures as the
      // part), its dashes offset to fall where the whole line's do (review ab05869-1).
      const cut = curvePieces(routes.get(e.id)!, rects.get(id)!);
      return { edge: e.id, d: cut.d, offset: cut.offset, stroke: strokeOf(e, toneOf(e, inFocus(e)), "ad", P), dash: dashOf(e) };
    });
    // A string, so the memoised part draws again only when its traces change.
    return list.length ? JSON.stringify(list) : undefined;
  };

  const enterNode = (id: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (id) setHover(id);
    else hoverTimer.current = setTimeout(() => setHover(null), 140);
  };

  return (
    <div ref={el} className={`canvas${live?.kind === "pan" ? " panning" : ""}${space ? " space-pan" : ""}${steps ? " steps-on" : ""}`} data-testid="canvas" data-tool={ctl.tool} data-detail={detail} tabIndex={0}
      onKeyDown={onOpenKey}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={onDouble}
      // Leaving the canvas (for the zoom controls or a callout) ends any hover focus.
      onPointerLeave={() => { setHoverEdge(null); enterNode(null); }}
      onPointerOver={(e) => {
        const t = e.target as Element;
        const id = partIdOf(t);
        setHoverEdge(id ? null : t.closest("[data-edge-id]")?.getAttribute("data-edge-id") ?? t.closest("[data-edge-label-of]")?.getAttribute("data-edge-label-of") ?? null);
        if (id) enterNode(id);
        else if (!t.closest("[data-port]")) enterNode(null);
      }}>
      <svg className="world" aria-label={view.title}>
        <defs dangerouslySetInnerHTML={{ __html: defs }} />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${k})`}>
          {groups.map((n) => <NodeShape key={n.id} node={n} rect={rects.get(n.id)!} P={P} selected={selNodes.has(n.id)} dim={dimNode(n.id)} changed={ctl.changed.has(n.id)} open={ctl.callout === n.id} post={post} match={matchOf(n.id)} on={!!step?.has(n.id)} drag={dragMark(n.id)} subLines={view.subLines !== false} dropTarget={dropTarget === n.id} />)}
          {/* A dragged part's own connections are drawn above every other one, still under the parts. */}
          {[...view.edges.filter((e) => !touches(e)), ...view.edges.filter(touches)].map((e) => {
            const r = routes.get(e.id);
            return r ? <EdgeShape key={e.id} edge={e} route={r} P={P} from={kindOf.get(e.from)!} to={kindOf.get(e.to)!} selected={selEdges.has(e.id)} dim={dimEdge(e)} flow={steps && e.step !== null} open={touchesOpen(e)}
              focus={inFocus(e)} dragDim={!!moving && !touches(e)} hidden={hiddenNow(e)} glide={gliding && (!moving || touches(e))} glideKey={endsKey(e, r)} /> : null;
          })}
          {/* Each trunk once, after the connections (diagram contract, Trunks): coloured while a member is, dim when all are. */}
          {trunksOf(routes).map((t) => {
            const members = t.edges.map((id) => view.edges.find((x) => x.id === id)!).filter(Boolean);
            if (!members.length) return null;
            const tone = members.some((e) => toneOf(e, inFocus(e)) === "kind") ? "kind" : "neutral";
            // It fades as its connections do: dimmed, at overview zoom when none has a step or an open end, and
            // while parts it carries none of are dragged (review bb42c16-1; ui contract, Semantic zoom and Dragging).
            const dim = members.every((e) => dimEdge(e));
            const open = members.some((e) => touchesOpen(e)), stepped = members.some((e) => e.step !== null);
            const dragDim = !!moving && members.every((e) => !touches(e));
            const m = trunkMarkup(t, members[0].style, tone, kindOf.get(t.part)!, P);
            return (
              <g key={`t-${t.key}-${t.edges.join(" ")}`}>
                <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: m.defs }} />
                {/* `trunk` (ui contract): its own hit stroke, so hovering it is hovering none of its connections. */}
                <g className={`tk${dim ? " dim" : ""}${open ? " open" : ""}`} data-testid="trunk" data-trunk={t.key} data-part={t.part} data-side={t.side} data-edges={t.edges.join(" ")} data-tone={tone}
                  data-step={stepped ? "on" : ""} data-drag-dim={dragDim ? "true" : undefined}>
                  <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: m.path }} />
                  <path className="trunk-hit" d={t.d} />
                </g>
              </g>
            );
          })}
          {groups.map((n) => <GroupHead key={`head-${n.id}`} node={n} rect={rects.get(n.id)!} P={P} dim={dimNode(n.id)} open={ctl.callout === n.id} post={post} drag={dragMark(n.id)} subLines={view.subLines !== false} />)}
          {plain.map((n) => <NodeShape key={n.id} node={n} rect={rects.get(n.id)!} P={P} selected={selNodes.has(n.id)} dim={dimNode(n.id)} changed={ctl.changed.has(n.id)} open={ctl.callout === n.id} post={post} match={matchOf(n.id)} on={!!step?.has(n.id)} drag={dragMark(n.id)} subLines={view.subLines !== false} traces={tracesFor(n.id)} usedBy={usedBy.get(n.id)} />)}
          {view.edges.map((e) => {
            const r = routes.get(e.id);
            if (!r || hiddenNow(e)) return null;
            return (
              <g key={`l-${e.id}`}>
                {r.labelAt && e.label && (
                  <g className={`lb${dimEdge(e) ? " dim" : ""}${touchesOpen(e) ? " open" : ""}`} data-testid={`edge-label-${e.id}`} data-edge-label-of={e.id} style={{ cursor: "pointer" }}
                    dangerouslySetInnerHTML={{ __html: labelMarkup(e.label, r.labelAt, P, post, toneOf(e, inFocus(e)) === "kind" ? P.kinds[kindOf.get(e.to)!] : P.line) }} />
                )}
                {steps && e.step !== null && (
                  <g data-testid={`step-badge-${e.id}`} data-edge-label-of={e.id} dangerouslySetInnerHTML={{ __html: badgeMarkup(e.step, r.badgeAt, P, "ad", post) }} />
                )}
              </g>
            );
          })}
          {texts.map((t) => <TextShape key={t.id} text={t} P={P} selected={selTexts.has(t.id)} typing={ctl.editing?.kind === "text" && ctl.editing.id === t.id} />)}

          {/* editor-only marks: search matches, selection, ports, drag feedback (never in an export) */}
          {/* Guides and equal gaps while dragging: editor-only marks, never in an export (ui contract, Dragging). */}
          {live?.kind === "move" && live.moved && live.snap && (
            <g className="drag-marks" pointerEvents="none">
              {live.snap.guides.map((g) => (
                <line key={`g-${g.axis}-${g.at}`} className="drag-guide" data-testid="drag-guide" data-axis={g.axis} data-at={g.at} strokeWidth={1 / k}
                  x1={g.axis === "x" ? g.at : g.from} x2={g.axis === "x" ? g.at : g.to} y1={g.axis === "x" ? g.from : g.at} y2={g.axis === "x" ? g.to : g.at} />
              ))}
              {live.snap.gaps.map((g) => (
                <g key={`p-${g.axis}-${g.start}`} className="drag-gap" data-testid="drag-gap" data-axis={g.axis} data-size={Math.round(g.size)}>
                  <line strokeWidth={1 / k} x1={g.axis === "x" ? g.start : g.cross} x2={g.axis === "x" ? g.start + g.size : g.cross} y1={g.axis === "x" ? g.cross : g.start} y2={g.axis === "x" ? g.cross : g.start + g.size} />
                </g>
              ))}
            </g>
          )}
          {dropTarget && rects.get(dropTarget) && (() => {
            const r = rects.get(dropTarget)!;
            return <rect className="drop-ring" data-testid="drop-target-ring" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={22} strokeWidth={2 / k} pointerEvents="none" />;
          })()}
          {found && [...found.ids].map((id) => {
            const r = rects.get(id);
            if (!r) return null;
            const rx = (view.nodes.find((n) => n.id === id)?.form === "group" ? 18 : 12) + 4;
            return <rect key={`m-${id}`} className={`search-ring${found.current === id ? " current" : ""}`} x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={rx}
              strokeWidth={(found.current === id ? 3 : 2) / k} pointerEvents="none" />;
          })}
          {sel.nodes.map((id) => {
            const r = rects.get(id);
            if (!r) return null;
            const rx = view.nodes.find((n) => n.id === id)?.form === "group" ? 18 : 12;
            return (
              <g key={`s-${id}`}>
                <rect className="sel-halo" x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} rx={rx + 2} strokeWidth={6 / k} />
                <rect className="sel-ring" x={r.x} y={r.y} width={r.w} height={r.h} rx={rx} strokeWidth={1.5 / k} />
              </g>
            );
          })}
          {sel.texts.map((id) => {
            const t = texts.find((x) => x.id === id);
            if (!t) return null;
            const m = measureText(t);
            const pad = 6 / k, box = { x: t.x - pad, y: t.y - pad, w: m.w + pad * 2, h: m.h + pad * 2 };
            const one = sel.texts.length === 1 && !sel.nodes.length && !ctl.editing;
            const hs = 9 / k;
            return (
              <g key={`st-${id}`}>
                <rect className="sel-ring" x={box.x} y={box.y} width={box.w} height={box.h} rx={2 / k} strokeWidth={1.5 / k} />
                {one && CORNERS.map((cn) => (
                  <rect key={cn} className="text-handle" data-testid={`text-handle-${cn}`} data-text-handle={cn} data-text-of={id}
                    x={(cn.endsWith("w") ? box.x : box.x + box.w) - hs / 2} y={(cn.startsWith("n") ? box.y : box.y + box.h) - hs / 2}
                    width={hs} height={hs} rx={2 / k} strokeWidth={1.5 / k} />
                ))}
              </g>
            );
          })}
          {hovered && SIDES.map((s) => {
            const q = portAt(rects.get(hovered)!, s);
            return (
              <circle key={s} className="port" data-testid={`port-${hovered}-${s}`} data-port={hovered} cx={q.x} cy={q.y} r={5.5 / k} strokeWidth={2 / k}
                onPointerEnter={() => enterNode(hovered)} onPointerLeave={() => enterNode(null)} />
            );
          })}
          {live?.kind === "connect" && (() => {
            const r = rects.get(live.from);
            if (!r) return null;
            const target = nodeUnderWorld(view.nodes, rects, live.cur, live.from);
            return (
              <g>
                <path className="ghost" d={`M${r.x + r.w / 2},${r.y + r.h / 2} L${live.cur.x},${live.cur.y}`} strokeWidth={1.75 / k} />
                {target && (() => { const tr = rects.get(target)!; return <rect className="target-ring" x={tr.x - 4} y={tr.y - 4} width={tr.w + 8} height={tr.h + 8} rx={14} strokeWidth={2 / k} />; })()}
              </g>
            );
          })()}
          {live?.kind === "marquee" && (
            <rect className="marquee" x={Math.min(live.start.x, live.cur.x)} y={Math.min(live.start.y, live.cur.y)} width={Math.abs(live.cur.x - live.start.x)} height={Math.abs(live.cur.y - live.start.y)} strokeWidth={1 / k} />
          )}
        </g>
      </svg>
    </div>
  );
}

/** The innermost non-group component under a world point, else the innermost group. */
function nodeUnderWorld(nodes: DiagramNode[], rects: Map<string, Rect>, p: { x: number; y: number }, except: string): string | null {
  let best: string | null = null;
  for (const n of nodes) {
    if (n.id === except) continue;
    const r = rects.get(n.id)!;
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
    if (!best || n.form !== "group") best = n.id;
  }
  return best;
}

