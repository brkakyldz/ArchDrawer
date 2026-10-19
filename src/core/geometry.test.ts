import { describe, expect, it } from "vitest";
import { BADGE, CARD, GROUP, LABEL, bezierAt, labelWidth, layoutRects, measureNode, measureText, routeEdges, viewBounds, type Rect } from "./geometry";
import type { DiagramNode, DiagramView } from "./model";
import { edge, node } from "./testkit";
import { textWidth } from "./text";

const placed = (id: string, x: number, y: number, extra: Partial<DiagramNode> = {}): DiagramNode => ({ ...node(id, extra), x, y } as DiagramNode);

describe("sizes are a function of content", () => {
  it("card is 196 × 108 and a two-line label adds 18", () => {
    expect(measureNode(node("a", { label: "API" }))).toMatchObject({ w: CARD.w, h: 108 });
    const two = measureNode(node("a", { label: "A considerably longer component name" }));
    expect(two.lines.length).toBe(2);
    expect(two.h).toBe(126);
  });

  it("panel height follows its formula and shrinks without items", () => {
    const p = node("p", { form: "panel", sub: "every call passes here", items: ["Schema validation", "Scope re-check", "Typed errors"] });
    expect(measureNode(p).h).toBe(24 + 22 + 17 + 10 + 3 * 26 + 2 * 4);
    expect(measureNode(p, { items: false }).h).toBe(24 + 22 + 17);
    expect(measureNode(p).w).toBeGreaterThanOrEqual(184);
    expect(measureNode(p).w).toBeLessThanOrEqual(320);
  });

  it("compact is 46 tall and as wide as its text needs, within 140–320", () => {
    const short = measureNode(node("c", { form: "compact", label: "LLM" }));
    const long = measureNode(node("c", { form: "compact", label: "Conversation history", sub: "conversations.sqlite" }));
    expect(short).toMatchObject({ w: 140, h: 46 });
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.w).toBeLessThanOrEqual(320);
  });

  it("Geist metrics: wider text measures wider, bold wider than regular", () => {
    expect(textWidth("WWW", 14)).toBeGreaterThan(textWidth("iii", 14));
    expect(textWidth("Tool gateway", 14, 600)).toBeGreaterThan(textWidth("Tool gateway", 14, 400));
  });

  it("a group's box wraps its children with padding and a header; empty groups are 260 × 140", () => {
    const view = { nodes: [placed("g", 0, 0, { form: "group" }), placed("a", 100, 200, { parent: "g" }), placed("b", 400, 260, { parent: "g" }), placed("e", 0, 900, { form: "group", label: "E" })] };
    const r = layoutRects(view);
    expect(r.get("g")).toEqual({ x: 100 - GROUP.padX, y: 200 - GROUP.head, w: 400 + 196 - 100 + GROUP.padX * 2, h: 260 + 108 - 200 + GROUP.head + GROUP.padBottom });
    expect(r.get("e")).toEqual({ x: 0, y: 900, w: 260, h: 140 });
  });

  it("a text's box follows its lines and scales with its size", () => {
    const one = measureText({ text: "Order flow", size: 16 });
    expect(one.h).toBe(20);
    expect(measureText({ text: "Order flow\nand payments", size: 16 }).h).toBe(40);
    const twice = measureText({ text: "Order flow", size: 32 });
    expect(twice.h).toBe(40);
    expect(Math.abs(twice.w - one.w * 2)).toBeLessThanOrEqual(2);
  });
});

describe("connections", () => {
  const view = (): DiagramView => ({
    id: "v", title: "V", caption: { title: "V", lede: "" }, postOf: null, texts: [],
    nodes: [placed("hub", 0, 200), placed("a", 400, 0), placed("b", 400, 200), placed("c", 400, 400), placed("up", 0, -300)],
    edges: [
      { id: "e1", from: "hub", to: "a", label: "", style: "call", both: false, step: null },
      { id: "e2", from: "hub", to: "b", label: "reads", style: "async", both: false, step: 1 },
      { id: "e3", from: "hub", to: "c", label: "", style: "dep", both: true, step: null },
      { id: "e4", from: "up", to: "hub", label: "", style: "call", both: false, step: null },
    ],
  });

  it("leaves from facing sides and spreads several on one side, ordered by the other end", () => {
    const v = view();
    const routes = routeEdges(v, layoutRects(v));
    const [r1, r2, r3, r4] = ["e1", "e2", "e3", "e4"].map((id) => routes.get(id)!);
    expect([r1.side0, r2.side0, r3.side0]).toEqual(["r", "r", "r"]);
    expect([r4.side0, r4.side1]).toEqual(["b", "t"]);
    expect(r1.p0.y).toBeLessThan(r2.p0.y);
    expect(r2.p0.y).toBeLessThan(r3.p0.y);
    expect(r2.p0.y - r1.p0.y).toBeLessThanOrEqual(16);
    expect(r1.d).toMatch(/^M[\d.-]+,[\d.-]+ C/);
  });

  it("places a label on its line, and leaves it out when there is no free spot", () => {
    const v = view();
    const rects = layoutRects(v);
    expect(routeEdges(v, rects).get("e2")!.labelAt).not.toBeNull();
    const everywhere: Rect = { x: -2000, y: -2000, w: 6000, h: 6000 };
    expect(routeEdges(v, rects, { avoid: [everywhere] }).get("e2")!.labelAt).toBeNull();
    expect(routeEdges(v, rects, { labels: false }).get("e2")!.labelAt).toBeNull();
  });

  it("keeps a step badge off its own label", () => {
    const v = view();
    const r = routeEdges(v, layoutRects(v)).get("e2")!;
    const w = labelWidth("reads") / 2 + BADGE.r;
    expect(Math.abs(r.badgeAt.x - r.labelAt!.x) >= w || Math.abs(r.badgeAt.y - r.labelAt!.y) >= LABEL.h / 2 + BADGE.r).toBe(true);
  });

  it("is deterministic", () => {
    const v = view();
    expect([...routeEdges(v, layoutRects(v))]).toEqual([...routeEdges(v, layoutRects(v))]);
  });
});

describe("the drawing's box holds every point of every line (H70)", () => {
  it("measures a curve's bounds exactly, not from samples", () => {
    // a → c runs down past b, so in a post it goes around b on a side; c sits off a's column so the
    // curve's widest point falls between any fixed samples.
    let outside = 0, checked = 0;
    for (let dx = 0; dx <= 60; dx += 3) for (let y = 380; y <= 460; y += 10) {
      const v = { nodes: [node("a", { x: 0, y: 0 }), node("b", { x: 0, y: 200 }), node("c", { x: dx, y })], edges: [{ ...edge("a", "c"), id: "e1" }], texts: [], postOf: "x" } as Parameters<typeof viewBounds>[0];
      const rects = layoutRects(v), routes = routeEdges(v, rects);
      const r = routes.get("e1")!, b = viewBounds(v, rects, routes);
      for (let i = 0; i <= 2000; i++) {
        const p = bezierAt(r, i / 2000);
        checked++;
        if (p.x > b.x + b.w + 1e-9 || p.x < b.x - 1e-9 || p.y > b.y + b.h + 1e-9 || p.y < b.y - 1e-9) outside++;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(outside).toBe(0);
  });
});
