import { describe, expect, it } from "vitest";
import { contentBox, layoutRects, measureNode, routeEdges } from "./geometry";
import { PALETTES } from "./theme";
import { drawView, nodeMarkup } from "./export/svg";
import { CARD_SHAPE, COMPACT_SHAPE, outlineDepth, PART_SHAPES, SHAPE_OF_KIND, shapeGeometry, shapeOf, type PartShape } from "./shapes";
import { KINDS, type DiagramNode, type DiagramView, type Kind } from "./model";

/** LOOK-2 and LOOK-3 (#177, ADR 0014): an outline per kind, a content box that sizes the part, the sub-line switch. */
const part = (id: string, kind: Kind, form: DiagramNode["form"], extra: Partial<DiagramNode> = {}): DiagramNode => ({
  id, label: "Probe", kind, form, icon: null, sub: "probe line", items: [], description: "", files: [], parent: null, detail: null, place: null, x: 0, y: 0, ...extra,
} as DiagramNode);

describe("an outline per kind", () => {
  it("every body's stroke reaches at most half a pixel past the part's box, the agent's wider one too", () => {
    const r = { x: 10, y: 20, w: 200, h: 120 };
    for (const kind of KINDS) for (const form of ["card", "compact"] as const) {
      const html = nodeMarkup(part("p", kind, form), r, PALETTES.light);
      const m = /class="body" data-shape="[a-z]+" d="([^"]+)"[^>]*stroke-width="([\d.]+)"/.exec(html)!;
      // Each command's end point (its last two numbers); the outline's extremes are end points on the box's edges.
      const ends = m[1].split(/(?=[MLCAZ])/).map((c) => [...c.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]))).filter((v) => v.length >= 2).map((v) => v.slice(-2));
      const xs = ends.map((e) => e[0]), ys = ends.map((e) => e[1]), half = Number(m[2]) / 2;
      const reach = Math.max(r.x - Math.min(...xs), Math.max(...xs) - (r.x + r.w), r.y - Math.min(...ys), Math.max(...ys) - (r.y + r.h)) + half;
      expect(reach, `${kind} ${form}`).toBeLessThanOrEqual(0.51);
    }
  });

  it("names each kind's data-shape, for a card, a compact part and a panel; a group is a group", () => {
    expect(SHAPE_OF_KIND).toEqual({ actor: "person", client: "window", api: "port", service: "card", worker: "stack", llm: "agent", external: "external", ops: "pulse", gate: "check", data: "store" });
    for (const kind of KINDS) for (const form of ["card", "compact", "panel"] as const) {
      expect(shapeOf({ kind, form })).toBe(SHAPE_OF_KIND[kind]);
      expect(nodeMarkup(part("p", kind, form), { x: 0, y: 0, w: 200, h: 120 }, PALETTES.light)).toContain(`class="body" data-shape="${SHAPE_OF_KIND[kind]}"`);
    }
    expect(shapeOf({ kind: "data", form: "group" })).toBe("group");
  });

  it("every outline lies inside the part's box, card and compact, plain and post", () => {
    for (const shape of PART_SHAPES) for (const compact of [false, true]) for (const post of [false, true]) {
      const r = { x: 10, y: 20, w: 220, h: compact ? COMPACT_SHAPE[shape].h : 126 };
      const g = shapeGeometry(shape, compact, post, r);
      for (const p of g.loops.flat()) {
        expect(p.x, `${shape} ${compact} ${post}`).toBeGreaterThanOrEqual(r.x - 1e-6);
        expect(p.x).toBeLessThanOrEqual(r.x + r.w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(r.y - 1e-6);
        expect(p.y).toBeLessThanOrEqual(r.y + r.h + 1e-6);
      }
    }
  });
});

describe("the content box sizes the part", () => {
  const card = (kind: Kind, o: { post?: boolean; subLines?: boolean } = {}) => measureNode(part("p", kind, "card"), o);

  it("cards: 108 as card, person, window, port, agent and pulse; 116 stack, 118 external, 124 store, 126 check", () => {
    const want: Record<string, number> = { person: 108, window: 108, port: 108, card: 108, stack: 116, agent: 108, external: 118, pulse: 108, check: 126, store: 124 };
    for (const kind of KINDS) expect(card(kind).h, kind).toBe(want[SHAPE_OF_KIND[kind]]);
    expect(card("api").w).toBe(224);
    expect(card("worker").w).toBe(204);
  });

  it("post cards: 84 card, port and agent; 86 person; 92 window, stack, external; 94 pulse; 96 store; 98 check", () => {
    const want: Record<string, number> = { card: 84, port: 84, agent: 84, person: 86, window: 92, stack: 92, external: 92, pulse: 94, store: 96, check: 98 };
    for (const kind of KINDS) expect(card(kind, { post: true }).h, kind).toBe(want[SHAPE_OF_KIND[kind]]);
    expect(card("api", { post: true }).w).toBe(200);
  });

  it("sub-lines off take the 18 px sub-line row from every card and the sub-line text from a compact part", () => {
    for (const kind of KINDS) {
      expect(card(kind).h - card(kind, { subLines: false }).h, kind).toBe(18);
      expect(card(kind, { subLines: false }).sub).toBe("");
      expect(measureNode(part("c", kind, "compact", { sub: "a sub-line" }), { subLines: false }).sub).toBe("");
    }
  });

  it("compact parts: the shape's height, 140–320 plus the extra width", () => {
    for (const kind of KINDS) {
      const s = SHAPE_OF_KIND[kind], short = measureNode(part("c", kind, "compact", { label: "A", sub: "" }));
      expect(short.h, kind).toBe(COMPACT_SHAPE[s].h);
      expect(short.w, kind).toBe(140 + COMPACT_SHAPE[s].extra);
      const long = measureNode(part("c", kind, "compact", { label: "A very long compact label that goes past every width", sub: "" }));
      expect(long.w, kind).toBe(320 + COMPACT_SHAPE[s].extra);
    }
  });

  it("the icon, label and sub-line of a card are drawn inside its content box", () => {
    for (const kind of KINDS) {
      const n = part("p", kind, "card", { label: "A label long enough to wrap onto two lines here" });
      const b = measureNode(n), r = { x: 0, y: 0, w: b.w, h: b.h }, cb = contentBox(n, r);
      const [t, rt, bt, l] = CARD_SHAPE[SHAPE_OF_KIND[kind]].plain;
      expect(cb).toEqual({ x: l, y: t, w: b.w - l - rt, h: b.h - t - bt });
      const ys = [...nodeMarkup(n, r, PALETTES.light).matchAll(/<tspan x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
      for (const y of ys) { expect(y, kind).toBeGreaterThan(cb.y); expect(y).toBeLessThan(cb.y + cb.h); }
    }
  });

  it("a view's subLines false is read by layout and the drawing; a share image can override it", () => {
    const v: DiagramView = { id: "v", title: "V", caption: { title: "V", lede: "" }, postOf: null, subLines: false, texts: [], edges: [], nodes: [part("a", "service", "card")] };
    expect(layoutRects(v).get("a")!.h).toBe(90);
    expect(drawView(v, PALETTES.light).body).not.toContain("probe line");
    expect(layoutRects(v, { subLines: true }).get("a")!.h).toBe(108);
  });
});

describe("ends attach to the outline", () => {
  const view = (to: DiagramNode, at: { x: number; y: number }): DiagramView => ({
    id: "v", title: "V", caption: { title: "V", lede: "" }, postOf: null, texts: [], nodes: [part("a", "service", "card", at), to],
    edges: [{ id: "e", from: "a", to: to.id, label: "", style: "call", both: false, step: null }, { id: "f", from: "a2", to: to.id, label: "", style: "call", both: false, step: null }],
  } as DiagramView);

  it("every end on an API's left or right side attaches at its point, not spread", () => {
    const api = part("api", "api", "card", { x: 400, y: 0 });
    const v = view(api, { x: 0, y: -60 });
    v.nodes.push(part("a2", "service", "card", { x: 0, y: 80 }));
    const rects = layoutRects(v), routes = routeEdges(v, rects), r = rects.get("api")!;
    // Their drawn end: the port of the trunk they share (diagram contract, Trunks), else the curve's end.
    for (const id of ["e", "f"]) { const e = routes.get(id)!; expect(e.trunk?.port ?? e.p1).toEqual({ x: r.x, y: r.y + r.h / 2 }); }
  });

  it("ends along a shield's curve move in to meet the outline, so each arrowhead touches the part", () => {
    const gate = part("gate", "gate", "card", { x: 400, y: 0 });
    const v = view(gate, { x: 300, y: 400 });
    v.nodes.push(part("a2", "service", "card", { x: 520, y: 400 }));
    const rects = layoutRects(v), routes = routeEdges(v, rects), r = rects.get("gate")!;
    const loops = shapeGeometry("check", false, false, r).loops;
    for (const id of ["e", "f"]) {
      const e = routes.get(id)!;
      expect(e.side1, id).toBe("b");
      const depth = outlineDepth(loops, r, "b", { x: e.p1.x, y: r.y + r.h });
      expect(depth, id).toBeGreaterThan(0.2);
      // Ends are rounded to 0.1, so within 0.06 of the outline; an end left on the box would miss by the depth (review R177-2).
      expect(Math.abs(e.p1.y - (r.y + r.h - depth)), id).toBeLessThan(0.06);
    }
  });

  it("every end of every kind, card and compact, from all four directions lies on its part's outline", () => {
    const near = (p: { x: number; y: number }, loops: { x: number; y: number }[][]) => Math.min(...loops.flatMap((l) => l.slice(1).map((b, i) => {
      const a = l[i], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    })));
    for (const kind of KINDS) for (const form of ["card", "compact"] as const) {
      const v: DiagramView = { id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null, texts: [], nodes: [
        part("c", kind, form, { x: 400, y: 400 }), part("n", "service", "card", { x: 400, y: 0 }), part("s", "service", "card", { x: 400, y: 800 }),
        part("w", "service", "card", { x: 0, y: 400 }), part("o", "service", "card", { x: 800, y: 400 })],
        edges: ["n", "s", "w", "o"].map((id) => ({ id, from: id, to: "c", label: "", style: "call", both: false, step: null })) } as unknown as DiagramView;
      const rects = layoutRects(v), routes = routeEdges(v, rects), r = rects.get("c")!;
      const loops = shapeGeometry(shapeOf({ kind, form }) as PartShape, form === "compact", false, r).loops;
      for (const id of ["n", "s", "w", "o"]) expect(near(routes.get(id)!.p1, loops), `${kind} ${form} from ${id}`).toBeLessThan(0.06);
    }
  });
});
