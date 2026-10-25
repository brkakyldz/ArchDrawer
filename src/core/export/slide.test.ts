import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFile, type DiagramDocument, type DiagramStep } from "../model";
import { normalizeFile } from "../normalize";
import { textWidth } from "../text";
import { renderShare, SWITCH_PRESETS } from "./share";
import { bandText, renderSlide, SLIDE_TEXT, SLIDE_TEXT_WIDTH, slideCount, type SlideOptions } from "./slide";

const load = (path: string) =>
  normalizeFile(validateFile(JSON.parse(readFileSync(path, "utf8"))).file!, { id: "d_test000001", now: "2026-10-22T00:00:00.000Z", source: null });

const STEPS: DiagramStep[] = [
  { id: "s1", parts: ["guest", "web"], text: "A guest writes to the hotel from the web page", note: "" },
  { id: "s2", parts: ["llm", "history"], text: "Inside the runtime the model reads the history", note: "" },
  { id: "s3", parts: ["runtime"], text: "The runtime is one group", note: "" },
];
/** The hotel's overview as a presentation: a group (`runtime` holding `llm` and `history`), a free text and three steps. */
const deck = (steps: DiagramStep[] = STEPS): DiagramDocument => {
  const d = load("tests/fixtures/hotel.archdraw.json");
  d.views[0].texts = [{ id: "t1", text: "Hotel agent", x: d.views[0].nodes[0].x, y: d.views[0].nodes[0].y - 120, size: 28 }];
  return { ...d, steps };
};
const OPTS: SlideOptions = { theme: "light", ...SWITCH_PRESETS.detailed };

/** `<g data-…-id="x" …>` opening tags of a slide, by id. */
const groups = (svg: string, kind: "node" | "edge" | "text") =>
  new Map([...svg.matchAll(new RegExp(`<g data-${kind}-id="([^"]*)"([^>]*)>`, "g"))].map((m) => [m[1], m[2]]));
const dimmed = (attrs: string) => {
  const dim = /data-dim="true"/.test(attrs);
  if (dim) expect(attrs).toContain('opacity="0.25"');
  else expect(attrs).not.toContain("opacity=");
  return dim;
};
const litIds = (svg: string, kind: "node" | "edge" | "text") => [...groups(svg, kind)].filter(([, a]) => !dimmed(a)).map(([id]) => id).sort();
const boxes = (svg: string) =>
  new Map([...svg.matchAll(/<g data-node-id="([^"]*)"[^>]*><rect class="box" x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/g)].map((m) => [m[1], m.slice(2).join(" ")]));
const transform = (svg: string) => /<rect width="1920" height="1080"[^>]*\/><g transform="([^"]*)"/.exec(svg)?.[1];

describe("the slide image (PRES-1, PRES-3)", () => {
  it("is exactly 1920 × 1080 on every slide, in both themes, with its index", () => {
    const d = deck();
    expect(slideCount(d)).toBe(4);
    for (const theme of ["light", "dark"] as const) {
      for (let i = 0; i < slideCount(d); i++) {
        const img = renderSlide(d, i, { ...OPTS, theme });
        expect([img.width, img.height]).toEqual([1920, 1080]);
        const root = /^<svg\b[^>]*>/.exec(img.svg)![0];
        for (const a of ['width="1920"', 'height="1080"', 'viewBox="0 0 1920 1080"', 'data-format="slide"', `data-slide="${i}"`, `data-theme="${theme}"`]) expect(root).toContain(a);
        expect(img.svg).not.toMatch(/foreignObject|<script|archdrawer/i);
      }
    }
  });

  it("opens on the slide format's share image of the whole view: caption, nothing dimmed, no band", () => {
    const d = deck();
    const img = renderSlide(d, 0, OPTS);
    expect(img.svg).toBe(renderShare(d, d.views[0].id, { ...OPTS, format: "slide" }).svg.replace(' data-format="slide"', ' data-format="slide" data-slide="0"'));
    expect(img.svg).toContain('data-caption="title"');
    expect(img.svg).not.toContain("data-dim");
    expect(img.svg).not.toContain("data-slide-band");
  });

  it("lights exactly the step's parts and dims every other part and every text", () => {
    const d = deck();
    const img = renderSlide(d, 1, OPTS);
    expect(litIds(img.svg, "node")).toEqual(["guest", "web"]);
    expect(groups(img.svg, "node").size).toBe(d.views[0].nodes.length);
    expect(litIds(img.svg, "text")).toEqual([]);
    expect(groups(img.svg, "text").size).toBe(1);
    expect(img.svg).not.toContain('data-caption="title"');
  });

  it("lights a connection only when both its ends are lit", () => {
    const d = deck([...STEPS, { id: "s4", parts: ["guest_api", "run_service", "scope"], text: "Three parts", note: "" }]);
    for (let i = 1; i < slideCount(d); i++) {
      const parts = new Set(d.steps![i - 1].parts);
      const want = d.views[0].edges.filter((e) => parts.has(e.from) && parts.has(e.to)).map((e) => e.id).sort();
      const svg = renderSlide(d, i, OPTS).svg;
      expect(litIds(svg, "edge")).toEqual(want);
      expect(groups(svg, "edge").size).toBe(d.views[0].edges.length);
    }
    // guest_api → run_service and guest_api → scope are lit; guest_api → domain_svc has one end out.
    expect(litIds(renderSlide(d, 4, OPTS).svg, "edge")).toHaveLength(2);
  });

  it("dims a group unless the step names it; a lit group does not light what it holds", () => {
    const d = deck();
    const inside = renderSlide(d, 2, OPTS).svg;
    expect(litIds(inside, "node")).toEqual(["history", "llm"]);
    expect(dimmed(groups(inside, "node").get("runtime")!)).toBe(true);
    // Its head, drawn over the connections, dims with it (review 222ed43-1).
    expect(inside).toContain(`<g data-group-head="runtime" data-dim="true" opacity="0.25">`);
    expect(renderSlide(d, 3, OPTS).svg).toContain(`<g data-group-head="runtime">`);
    const group = renderSlide(d, 3, OPTS).svg;
    expect(litIds(group, "node")).toEqual(["runtime"]);
    expect(dimmed(groups(group, "node").get("llm")!)).toBe(true);
  });

  it("keeps every part's box and the drawing's place the same on every step slide", () => {
    const d = deck([...STEPS, { id: "s4", parts: ["web"], text: "A step text long enough to need a second line at the band's first size, which moves nothing above it at all, or so we hope", note: "" }]);
    const first = renderSlide(d, 1, OPTS);
    expect(boxes(first.svg).size).toBe(d.views[0].nodes.length);
    for (let i = 2; i < slideCount(d); i++) {
      const svg = renderSlide(d, i, OPTS).svg;
      expect(boxes(svg)).toEqual(boxes(first.svg));
      expect(transform(svg)).toBe(transform(first.svg));
    }
    // Dimming changes no size: the boxes are the drawing's own, lit or not.
    const all = renderSlide({ ...d, steps: [{ id: "x", parts: d.views[0].nodes.map((n) => n.id), text: "All", note: "" }] }, 1, OPTS).svg;
    expect(boxes(all)).toEqual(boxes(first.svg));
  });

  it("fits the drawing above the band", () => {
    const d = deck();
    const img = renderSlide(d, 1, OPTS);
    const bandTop = Math.min(...[.../<g data-slide-band="">.*$/.exec(img.svg)![0].matchAll(/<tspan x="40" y="([\d.]+)"/g)].map((m) => Number(m[1]))) - 34;
    const [tx, ty] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform(img.svg)!)!.slice(1).map(Number);
    for (const r of img.drawn.rects.values()) {
      expect(r.y * img.scale + ty + r.h * img.scale).toBeLessThan(bandTop);
      expect(r.x * img.scale + tx).toBeGreaterThanOrEqual(39.5);
    }
  });

  it("sets the step's text and the counter in the band", () => {
    const img = renderSlide(deck(), 2, OPTS);
    const band = /<g data-slide-band="">(.*?)<\/g>/.exec(img.svg)![1];
    const text = /<text data-slide-text="" font-size="(\d+)" font-weight="500"[^>]*>(.*?)<\/text>/.exec(band)!;
    expect(text[1]).toBe("34");
    expect(text[2].replace(/<[^>]+>/g, "")).toBe(STEPS[1].text);
    const count = /<text data-slide-count="" x="1880" y="([\d.]+)" text-anchor="end" font-family="[^"]*Geist Mono[^"]*" font-size="24"[^>]*>([^<]*)<\/text>/.exec(band)!;
    expect(count[2]).toBe("2 / 3");
    const lastLine = [...text[2].matchAll(/y="([\d.]+)"/g)].at(-1)![1];
    expect(count[1]).toBe(lastLine);
  });

  it("fits 120 wide characters at one of the band's sizes, whole", () => {
    const wide = "WMWMWMWMWM ".repeat(11).slice(0, 120);
    expect(wide).toHaveLength(120);
    const t = bandText(wide);
    const at = SLIDE_TEXT.find((s) => s.size === t.size)!;
    expect(t.lines.length).toBeLessThanOrEqual(at.lines);
    for (const l of t.lines) expect(textWidth(l, t.size, 500)).toBeLessThanOrEqual(SLIDE_TEXT_WIDTH);
    expect(t.lines.join(" ")).toBe(wide.trim());
    // One unbroken run of 120 wide characters is broken, never shortened.
    const run = bandText("W".repeat(120));
    expect(run.lines.length).toBeLessThanOrEqual(SLIDE_TEXT.find((s) => s.size === run.size)!.lines);
    expect(run.lines.join("")).toBe("W".repeat(120));
    const svg = renderSlide(deck([{ id: "w", parts: ["web"], text: wide, note: "" }]), 1, OPTS).svg;
    expect(/<text data-slide-text=""[^>]*>(.*?)<\/text>/.exec(svg)![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe(wide.trim());
  });

  it("chooses 34 px up to two lines, then 28 px up to three, then 22 px", () => {
    expect(bandText("Short").size).toBe(34);
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect([5, 30, 50, 120].map((n) => { const t = bandText(words(n)); return [t.size, t.lines.length]; })).toEqual([[34, 1], [34, 2], [28, 3], [22, 5]]);
  });

  it("follows the toggles on a step slide: badges, labels, held items, texts, key, fonts", () => {
    const d = deck();
    d.views[0].edges[0] = { ...d.views[0].edges[0], step: 1, label: "writes" };
    const on = renderSlide(d, 1, { ...OPTS, fonts: { sans: "U0FOUw==", mono: "TU9OTw==" } }).svg;
    expect(on).toContain("data-step-badge");
    expect(on).toContain("data-edge-label");
    expect(on).toContain("data-text-id");
    expect(on).toContain("data-key=");
    expect(on).toContain("base64,U0FOUw==");
    const off = renderSlide(d, 1, { ...OPTS, steps: false, labels: false, texts: false, legend: false, sub: false }).svg;
    for (const s of ["data-step-badge", "data-edge-label", "data-text-id", "data-key=", "node-item", "@font-face"]) expect(off).not.toContain(s);
    expect(off).toContain("data-slide-band");
  });

  it("throws for an index outside the slides", () => {
    const d = deck();
    for (const i of [-1, 4, 1.5, Number.NaN]) expect(() => renderSlide(d, i, OPTS)).toThrow(RangeError);
    expect(() => renderSlide({ ...d, steps: undefined }, 1, OPTS)).toThrow(RangeError);
    expect(renderSlide({ ...d, steps: undefined }, 0, OPTS).svg).toContain('data-slide="0"');
  });
});
