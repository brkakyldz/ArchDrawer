import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { layoutRects, measureText, routeEdges, textStyle, type EdgeRoute, type Rect } from "../../core/geometry";
import { badgeMarkup, drawOrder, edgeMarkup, groupHeadMarkup, labelMarkup, nodeMarkup, sharedDefs, textMarkup, toneOf } from "../../core/export/svg";
import { descendants, isPostView, LIMITS, type DiagramEdge, type DiagramNode, type DiagramText, type Kind } from "../../core/model";
import type { Palette } from "../../core/theme";
import { clampTextSize, connect, groupAt, moveNodes, moveTexts, setText, settleNodes, VIEW_FULL, withInside } from "./ops";
import type { Ctl, Selection } from "./types";
import { NOTHING } from "./types";
import { detailAt, toWorld, zoomAt } from "./viewport";

/* ---------- pieces of the drawing: the same markup as every export (invariant 5) ---------- */

/** A drag's marks on a part or a connection (ui contract, Dragging): lifted, or dimmed while others move. */
type DragMark = "lifted" | "dim" | undefined;

const NodeShape = memo(function NodeShape({ node, rect, P, selected, dim, changed, open = false, post, match, on = false, drag, subLines = true, dropTarget = false }: { node: DiagramNode; rect: Rect; P: Palette; selected: boolean; dim: boolean; changed: boolean; open?: boolean; post: boolean; match?: "true" | "current"; on?: boolean; drag?: DragMark; subLines?: boolean; dropTarget?: boolean }) {
  return (
    <g className={`nd${dim ? " dim" : ""}${changed ? " changed" : ""}${open ? " open" : ""}`} data-changed={changed ? "true" : undefined} data-dim={dim ? "true" : undefined} data-match={match} data-step={on ? "on" : undefined} data-testid={`node-${node.id}`} data-node-id={node.id} data-kind={node.kind} data-form={node.form}
      data-parent={node.parent ?? ""} data-selected={String(selected)} data-lifted={drag === "lifted" ? "true" : undefined} data-drag-dim={drag === "dim" ? "true" : undefined} data-drop-target={dropTarget ? "true" : undefined} style={{ ["--hover-k" as string]: P.kinds[node.kind] }}
      dangerouslySetInnerHTML={{ __html: nodeMarkup(node, rect, P, { testIds: true, post, subLines }) }} />
  );
});

/** A group's head (ui contract, `node-head-<id>`): over the connections and under the parts, its name on a halo. */
const GroupHead = memo(function GroupHead({ node, rect, P, dim, open = false, post, drag, subLines = true }: { node: DiagramNode; rect: Rect; P: Palette; dim: boolean; open?: boolean; post: boolean; drag?: DragMark; subLines?: boolean }) {
  return (
    <g className={`gh${dim ? " dim" : ""}${open ? " open" : ""}`} data-testid={`node-head-${node.id}`} data-group-head={node.id} data-node-id={node.id}
      data-lifted={drag === "lifted" ? "true" : undefined} data-drag-dim={drag === "dim" ? "true" : undefined}
      dangerouslySetInnerHTML={{ __html: groupHeadMarkup(node, rect, P, { testIds: true, post, subLines }) }} />
  );
});

const EdgeShape = memo(function EdgeShape({ edge, route, P, from, to, selected, dim, flow, open = false, focus = false, dragDim = false }: { edge: DiagramEdge; route: EdgeRoute; P: Palette; from: Kind; to: Kind; selected: boolean; dim: boolean; flow: boolean; open?: boolean; focus?: boolean; dragDim?: boolean }) {
  const tone = toneOf(edge, focus);
  return (
    <g className={`ed${dim ? " dim" : ""}${open ? " open" : ""}`} data-dim={dim ? "true" : undefined} data-testid={`edge-${edge.id}`} data-edge-id={edge.id} data-style={edge.style} data-both={String(edge.both)}
      data-step={edge.step ?? ""} data-selected={String(selected)} data-tone={tone} data-focus={focus ? "true" : undefined} data-drag-dim={dragDim ? "true" : undefined}>
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
  | { kind: "move"; ids: string[]; texts: string[]; start: { x: number; y: number }; off: { x: number; y: number }; moved: boolean; hit: { node?: string; text?: string; inside?: boolean }; shift: boolean }
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
  const routes = useMemo(() => {
    if (!dragOff || !moving) return restRoutes;
    const again = routeEdges(view, rects, { avoid: texts.map((t) => ({ x: t.x, y: t.y, ...measureText(t) })) });
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
      const id = (elem as Element).closest?.("[data-node-id]")?.getAttribute("data-node-id");
      if (id) return id;
    }
    return null;
  };

  /* Space held: the next drag pans, whatever the tool (ui contract canvas). */
  const spaceRef = useRef(false);
  const [space, setSpace] = useState(false);
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
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
    const nodeId = t.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
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
      d.off = { x: p.x - d.start.x, y: p.y - d.start.y };
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
      } else if (!d.shift && d.hit.node && d.hit.inside) {
        // The stack mark: go to the component's own view.
        const detail = view.nodes.find((n) => n.id === d.hit.node)?.detail;
        if (detail) c.goView(detail);
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

  const enterNode = (id: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (id) setHover(id);
    else hoverTimer.current = setTimeout(() => setHover(null), 140);
  };

  return (
    <div ref={el} className={`canvas${live?.kind === "pan" ? " panning" : ""}${space ? " space-pan" : ""}${steps ? " steps-on" : ""}`} data-testid="canvas" data-tool={ctl.tool} data-detail={detail} tabIndex={0}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={onDouble}
      // Leaving the canvas (for the zoom controls or a callout) ends any hover focus.
      onPointerLeave={() => { setHoverEdge(null); enterNode(null); }}
      onPointerOver={(e) => {
        const t = e.target as Element;
        const id = t.closest("[data-node-id]")?.getAttribute("data-node-id");
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
              focus={inFocus(e)} dragDim={!!moving && !touches(e)} /> : null;
          })}
          {groups.map((n) => <GroupHead key={`head-${n.id}`} node={n} rect={rects.get(n.id)!} P={P} dim={dimNode(n.id)} open={ctl.callout === n.id} post={post} drag={dragMark(n.id)} subLines={view.subLines !== false} />)}
          {plain.map((n) => <NodeShape key={n.id} node={n} rect={rects.get(n.id)!} P={P} selected={selNodes.has(n.id)} dim={dimNode(n.id)} changed={ctl.changed.has(n.id)} open={ctl.callout === n.id} post={post} match={matchOf(n.id)} on={!!step?.has(n.id)} drag={dragMark(n.id)} subLines={view.subLines !== false} />)}
          {view.edges.map((e) => {
            const r = routes.get(e.id);
            if (!r) return null;
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

