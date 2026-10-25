import { describe, expect, it } from "vitest";
import { layoutRects, routeEdges } from "../geometry";
import type { DiagramView } from "../model";
import { PALETTES } from "../theme";
import { drawView, edgeMarkup, toneOf } from "./svg";

/** LOOK-4 (#170): neutral connections, colour with a step or in focus, no start ring, readable dotted lines. */
const part = (id: string, x: number, kind: "service" | "data" | "client") => ({
  id, label: id, kind, form: "card" as const, icon: null, sub: "", items: [], description: "", files: [], parent: null, detail: null, place: null, x, y: 0,
});
const view = (): DiagramView => ({
  id: "v", title: "V", caption: { title: "V", lede: "" }, postOf: null, texts: [],
  nodes: [part("a", 0, "client"), part("b", 400, "service"), part("c", 800, "data")],
  edges: [
    { id: "plain", from: "a", to: "b", label: "asks", style: "call", both: false, step: null },
    { id: "num", from: "b", to: "c", label: "keeps", style: "async", both: false, step: 1 },
    { id: "dots", from: "a", to: "c", label: "", style: "dep", both: true, step: null },
  ],
} as unknown as DiagramView);
const group = (body: string, id: string) => { const i = body.indexOf(`<g data-edge-id="${id}"`); return body.slice(i, body.indexOf("</g>", body.indexOf('class="line"', i)) + 4); };

describe("connection colour", () => {
  for (const theme of ["light", "dark"] as const) {
    const P = PALETTES[theme], body = drawView(view(), P, { steps: true }).body;

    it(`${theme}: a connection without a step is the neutral colour, line and arrowhead, with no gradient or glow`, () => {
      const g = group(body, "plain");
      expect(g).toContain('data-tone="neutral"');
      expect(g).toMatch(new RegExp(`class="line"[^>]*stroke="${P.edge}"`));
      expect(g).toContain(`<path d="M1 1.4 8.8 5 1 8.6z" fill="${P.edge}"/>`);
      expect(g).not.toContain("linearGradient");
      expect(g).not.toContain('class="glow"');
      expect(body).toMatch(new RegExp(`data-edge-label="plain"[^]*?stroke="${P.line}"`));
    });

    it(`${theme}: a numbered connection keeps its kind colours in the export: gradient, target-coloured arrowhead, glow, label border`, () => {
      const g = group(body, "num");
      expect(g).toContain('data-tone="kind"');
      expect(g).toContain(`<stop offset="0" stop-color="${P.kinds.service}"/><stop offset="1" stop-color="${P.kinds.data}"/>`);
      expect(g).toContain(`fill="${P.kinds.data}"/></marker>`);
      expect(g).toContain('class="glow"');
      expect(body).toMatch(new RegExp(`data-edge-label="num"[^]*?stroke="${P.kinds.data}"`));
    });
  }

  it("the editor's focus colours a connection: kind colours for the same line", () => {
    const v = view(), rects = layoutRects(v), r = routeEdges(v, rects).get("plain")!, e = v.edges[0];
    expect(toneOf(e)).toBe("neutral");
    expect(toneOf(e, true)).toBe("kind");
    const lit = edgeMarkup(e, r, PALETTES.light, { fromKind: "client", toKind: "service", tone: toneOf(e, true) });
    expect(lit).toContain(`stop-color="${PALETTES.light.kinds.client}"`);
    expect(lit).toContain(`fill="${PALETTES.light.kinds.service}"/></marker>`);
    expect(lit).toContain('class="glow"');
  });
});

describe("ends and dotted lines", () => {
  const body = drawView(view(), PALETTES.light, { steps: true }).body;

  it("a one-way connection draws nothing at its start: no circle but its step badge's", () => {
    for (const id of ["plain", "num"]) {
      const whole = body.slice(body.indexOf(`<g data-edge-id="${id}"`), body.indexOf("<g data-edge-id=", body.indexOf(`<g data-edge-id="${id}"`) + 5));
      const circles = whole.match(/<circle/g)?.length ?? 0;
      expect(circles, id).toBe(id === "num" ? 1 : 0);
      expect(whole).not.toContain("marker-start");
    }
  });

  it("a two-way connection has an arrowhead at each end", () => {
    expect(group(body, "dots")).toContain("marker-start=");
  });

  it("dotted lines are 1.9 px with a 2 5 dash and round caps; async 6 5; call solid; no glow on dep in focus", () => {
    const dots = group(body, "dots");
    expect(dots).toContain('stroke-width="1.9" stroke-dasharray="2 5" stroke-linecap="round"');
    expect(group(body, "num")).toContain('stroke-width="1.75" stroke-dasharray="6 5"');
    expect(group(body, "plain")).not.toContain("stroke-dasharray");
    const v = view(), r = routeEdges(v, layoutRects(v)).get("dots")!;
    expect(edgeMarkup(v.edges[2], r, PALETTES.dark, { fromKind: "client", toKind: "data", tone: "kind" })).not.toContain('class="glow"');
  });
});
