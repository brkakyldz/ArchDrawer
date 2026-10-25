import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutRects, overlaps } from "../geometry";
import { depthWarnings, KINDS, LIMITS, validateFile, type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramView } from "../model";
import { normalizeFile } from "../normalize";
import { PALETTES } from "../theme";
import { arrangeForFeed, explainInstruction, foldForFeed, importance, rearrangeForFeed } from "./feed";
import { makeLinkedInView } from "../testkit";
import { renderMermaid } from "./mermaid";
import { DEFAULT_SHARE, FORMAT_IDS, FORMATS, readabilityOf, renderShare, shortenedIn, startSwitches, subLinesOf, suggestionFor, withSubLines } from "./share";
import { drawView, esc, shapeOf, sharedDefs as sharedDefsOf } from "./svg";
import { shapeGeometry, type PartShape } from "../shapes";
import { textWidth } from "../text";

const load = (path: string) =>
  normalizeFile(validateFile(JSON.parse(readFileSync(path, "utf8"))).file!, { id: "d_test000001", now: "2026-10-13T00:00:00.000Z", source: null });
const shop = () => load("tests/fixtures/shop.archdraw.json");
const hotel = () => load("tests/fixtures/hotel.archdraw.json");

const firstRect = (svg: string, id: string) => {
  const m = new RegExp(`data-node-id="${id}"[^>]*>[^]*?<rect[^>]*?width="([\\d.]+)"[^>]*?height="([\\d.]+)"`).exec(svg)
    ?? new RegExp(`data-node-id="${id}"[^>]*>[^]*?<rect[^>]*?height="([\\d.]+)"[^>]*?width="([\\d.]+)"`).exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

describe("drawing (editor/export parity)", () => {
  it("draws every component, connection and badge, and each component's first rect is its measured box", () => {
    const v = shop().views[0];
    const d = drawView(v, PALETTES.light, { steps: true });
    const rects = layoutRects(v);
    for (const n of v.nodes) {
      expect(d.body).toContain(`data-node-id="${n.id}"`);
      expect(firstRect(d.body, n.id)).toEqual({ w: rects.get(n.id)!.w, h: rects.get(n.id)!.h });
    }
    for (const e of v.edges) expect(d.body).toContain(`data-edge-id="${e.id}"`);
    expect(d.body.match(/data-testid="step-badge/g) ?? d.body.match(/>1<\/text>|>2<\/text>/g)).toBeTruthy();
  });

  it("is the same in both themes apart from colours and glow strength", () => {
    const v = shop().views[0];
    const strip = (s: string) => s.replace(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g, "C").replace(/(opacity|stop-opacity)="[\d.]+"/g, '$1="O"');
    expect(strip(drawView(v, PALETTES.light).body)).toEqual(strip(drawView(v, PALETTES.dark).body));
  });

  it("never draws a panel's rows, and leaves the sub-lines out when the switch is off", () => {
    const v = shop().views[0];
    expect(drawView(v, PALETTES.light).body).not.toContain("Validate order");
    expect(drawView(v, PALETTES.light).body).toContain("Postgres");
    expect(drawView(v, PALETTES.light, { subLines: false }).body).not.toContain("Postgres");
    expect(drawView({ ...v, subLines: false }, PALETTES.light).body).not.toContain("Postgres");
  });

  it("escapes text", () => {
    const v = shop().views[0];
    v.nodes[0].label = `<script>"&"</script>`;
    const body = drawView(v, PALETTES.light).body;
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("shapes by kind (LOOK-2, ADR 0014)", () => {
  const SHAPED: [DiagramNode["kind"], string][] = [["actor", "person"], ["client", "window"], ["api", "port"], ["service", "card"], ["worker", "stack"],
    ["llm", "agent"], ["external", "external"], ["ops", "pulse"], ["gate", "check"], ["data", "store"]];
  const node = (id: string, kind: DiagramNode["kind"], form: DiagramNode["form"], extra: Partial<DiagramNode> = {}): DiagramNode => ({
    id, label: "Probe", kind, form, icon: null, sub: "probe line", items: form === "panel" ? ["One"] : [], description: "D.",
    files: [], parent: null, detail: null, place: null, x: 40 + (extra.place?.col ?? 0) * 260, y: 40 + (extra.place?.row ?? 3) * 200, ...extra,
  });
  const view = (id = "main"): DiagramView => {
    const nodes = SHAPED.flatMap(([k], col) => [node(`card-${k}`, k, "card", { place: { row: 0, col } }), node(`compact-${k}`, k, "compact", { place: { row: 1, col } })]);
    nodes.push(node("panel-llm", "llm", "panel", { place: { row: 2, col: 0 } }), node("group-data", "data", "group", { place: { row: 2, col: 2 } }), node("inner-gate", "gate", "compact", { parent: "group-data" }));
    return { id, title: "T", caption: { title: "T", lede: "" }, postOf: null, nodes, edges: [], texts: [] };
  };
  /** Each part's outline: the one element with class `body` in its `g[data-node-id]`, whatever the order of its markup. */
  const bodies = (svg: string) => new Map(svg.split('<g data-node-id="').slice(1).map((chunk) => {
    const id = chunk.slice(0, chunk.indexOf('"'));
    const els = [...chunk.matchAll(/<(?:rect|path)\b[^>]*>/g)].map((m) => m[0]).filter((el) => /\sclass="body"/.test(el));
    expect(els, `${id}: one body`).toHaveLength(1);
    return [id, els[0]] as const;
  }));
  const attr = (el: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(el)?.[1];
  const shapes = (svg: string) => Object.fromEntries([...bodies(svg)].map(([id, el]) => [id, attr(el, "data-shape")]));
  const expected: Record<string, string> = {
    ...Object.fromEntries(SHAPED.flatMap(([k, s]) => [[`card-${k}`, s], [`compact-${k}`, s]])),
    "panel-llm": "agent", "group-data": "group", "inner-gate": "check",
  };
  const extent = (loops: { x: number; y: number }[][]) => {
    const pts = loops.flat();
    return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
  };

  it("names each card's, compact part's and panel's outline by its kind; a group is a group", () => {
    for (const P of [PALETTES.light, PALETTES.dark]) expect(shapes(drawView(view(), P).body)).toEqual(expected);
  });

  it("sizes each part by its shape's content box, with the box as the first rect and every outline inside it", () => {
    const tall: Record<string, number> = { person: 108, window: 108, port: 108, card: 108, stack: 116, agent: 108, external: 118, pulse: 108, check: 126, store: 124 };
    const compactTall: Record<string, number> = { person: 46, window: 46, port: 46, card: 46, stack: 52, agent: 46, external: 52, pulse: 46, check: 54, store: 54 };
    const v = view(), d = drawView(v, PALETTES.light);
    for (const x of v.nodes) {
      const r = d.rects.get(x.id)!;
      expect(firstRect(d.body, x.id), `${x.id}: first rect`).toEqual({ w: r.w, h: r.h });
      if (x.form === "group") continue;
      const shape = expected[x.id] as PartShape;
      if (x.form !== "compact") expect([r.w, r.h], x.id).toEqual([196 + (shape === "port" ? 28 : shape === "stack" ? 8 : 0), tall[shape]]);
      else expect(r.h, x.id).toBe(compactTall[shape]);
      const e = extent(shapeGeometry(shape, x.form === "compact", false, r).loops);
      expect(e.x0, `${x.id} left`).toBeGreaterThanOrEqual(r.x - 0.01); expect(e.x1, `${x.id} right`).toBeLessThanOrEqual(r.x + r.w + 0.01);
      expect(e.y0, `${x.id} top`).toBeGreaterThanOrEqual(r.y - 0.01); expect(e.y1, `${x.id} bottom`).toBeLessThanOrEqual(r.y + r.h + 0.01);
    }
  });

  it("strokes every outline with round joins, so a browser measures it as it measures a rect", () => {
    const body = drawView(view(), PALETTES.light).body;
    const paths = [...body.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]).filter((el) => /\sclass="(?:body|shape-back)"/.test(el));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toContain('stroke-linejoin="round"');
  });

  it("draws the same shapes in the post style", () => {
    expect(shapes(drawView(view("main-linkedin"), PALETTES.dark).body)).toEqual(expected);
  });

  it("an agent's outline is the kind-to-violet gradient; an external one is dashed; no part draws a row", () => {
    const body = drawView(view(), PALETTES.dark).body;
    expect(bodies(body).get("card-llm")).toContain('stroke="url(#ad-agent)"');
    expect(sharedDefsOf(PALETTES.dark)).toContain(`<stop offset="1" stop-color="${PALETTES.dark.agentEnd}"/>`);
    expect(bodies(body).get("card-external")).toContain('stroke-dasharray="6 4"');
    expect(body).not.toContain('class="item"');
    expect(body).not.toContain(">One<");
  });

  it("gives every outline a measured edge inside the box: the cylinder, the avatar and the shield's point touch it", () => {
    const r = { x: 10, y: 20, w: 196, h: 124 };
    expect(extent(shapeGeometry("store", false, false, r).loops)).toMatchObject({ y0: 20, y1: 144 });
    expect(extent(shapeGeometry("person", false, false, r).loops)).toMatchObject({ y0: 20, y1: 144 });
    expect(extent(shapeGeometry("check", false, false, r).loops)).toEqual({ x0: 10, x1: 206, y0: 20, y1: 144 });
    expect(shapeGeometry("port", false, false, r).d).toBe("M24,20 L192,20 L206,82 L192,144 L24,144 L10,82 Z");
    expect(shapeOf({ kind: "llm", form: "panel" })).toBe("agent");
    expect(shapeOf({ kind: "data", form: "group" })).toBe("group");
    expect(shapeOf({ kind: "actor", form: "compact" })).toBe("person");
  });
});

describe("share image", () => {
  it("is exactly the format's size in every format and theme, with no product mark", () => {
    for (const doc of [shop(), hotel()])
      for (const format of FORMAT_IDS)
        for (const theme of ["light", "dark"] as const) {
          const img = renderShare(doc, doc.views[0].id, { ...DEFAULT_SHARE, format, theme });
          expect([img.width, img.height]).toEqual([FORMATS[format].w, FORMATS[format].h]);
          expect(img.svg).toMatch(new RegExp(`^<svg [^>]*width="${FORMATS[format].w}" height="${FORMATS[format].h}"`));
          expect(img.svg).toContain(`data-theme="${theme}"`);
          expect(img.svg.toLowerCase()).not.toContain("archdrawer");
          expect(img.svg.toLowerCase()).not.toContain("archdraw ");
        }
  });

  it("draws sub-lines as the view's switch says unless show-sub is given, each part kept around its own centre (review R177-4, R177-5)", () => {
    const doc = shop(), v = doc.views[0];
    expect(v.nodes.some((n) => n.form !== "group" && n.sub)).toBe(true);
    const off: DiagramDocument = { ...doc, views: [{ ...v, subLines: false }, ...doc.views.slice(1)] };
    const subs = (d: DiagramDocument, sub?: boolean) => renderShare(d, v.id, { ...DEFAULT_SHARE, theme: "light", ...(sub === undefined ? {} : { sub }) }).svg.includes('class="sub"');
    expect([subs(doc), subs(off), subs(off, true), subs(doc, false)]).toEqual([true, false, true, false]);
    expect([subLinesOf({}), subLinesOf({ subLines: false }), subLinesOf({ subLines: false }, true), subLinesOf({}, false), subLinesOf({}, null)]).toEqual([true, false, true, false, true]);
    expect(withSubLines(withSubLines(v, false), true).subLines).toBeUndefined();
    // In the post style a long sub-line widens its card, so hiding it narrows the card as well as shortening it.
    const first = v.nodes.find((x) => x.form === "card")!;
    const post: DiagramView = { ...v, postOf: "elsewhere", nodes: v.nodes.map((x) => (x.id === first.id ? { ...x, sub: "a sub-line long enough to widen" } : x)) };
    const own = layoutRects(post), hidden = withSubLines(post, false), drawn = layoutRects(hidden);
    expect(hidden.subLines).toBe(false);
    expect(drawn.get(first.id)!.w).toBeLessThan(own.get(first.id)!.w);
    for (const n of post.nodes.filter((x) => x.form !== "group")) {
      const a = own.get(n.id)!, b = drawn.get(n.id)!;
      expect(Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)), n.id).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)), n.id).toBeLessThanOrEqual(1);
    }
  });

  it("carries a figure caption and colour key, and drops them when switched off; the user's texts switch off", () => {
    const doc = shop();
    doc.views[0].texts.push({ id: "t1", text: "Checkout, end to end", x: 0, y: -80, size: 40 });
    const on = renderShare(doc, "overview", { ...DEFAULT_SHARE, theme: "light" }).svg;
    expect(on).toContain('data-caption="title"');
    expect(on).toContain("data-key=");
    expect(on).toContain('data-text-id="t1"');
    const off = renderShare(doc, "overview", { ...DEFAULT_SHARE, theme: "light", title: false, legend: false, texts: false }).svg;
    expect(off).not.toContain("data-caption");
    expect(off).not.toContain("data-key=");
    expect(off).not.toContain("Checkout, end to end");
  });

  it("reports readability honestly: a large drawing in the feed is too small, a small one is readable", () => {
    const big = renderShare(hotel(), hotel().views[0].id, { ...DEFAULT_SHARE, theme: "light", format: "linkedin" });
    expect(big.readability.level).toBe("warn");
    expect(big.readability.text).toBe("The text will be too small to read in the LinkedIn feed, even when the image is opened; hiding the sub-lines would help.");
    expect(big.readability.detail).toMatch(/^Names \d+\.\d px and text \d+\.\d px in the LinkedIn feed, \d+\.\d px opened\.$/);
    const small = renderShare(shop(), "overview", { ...DEFAULT_SHARE, theme: "light", format: "slide" });
    expect(small.readability.level).toBe("good");
    expect(small.readability.inPlace).toBeGreaterThanOrEqual(9);
    expect(small.readability.text).toBe("The text is readable on a projected slide as it is.");
  });

  it("says readability in one plain sentence per destination, with the numbers apart", () => {
    const whole = { id: "v", postOf: null } as DiagramView;
    const say = (px: number, format: keyof typeof FORMATS, o: { sub?: boolean; whole?: DiagramView } = {}) =>
      readabilityOf({ names: [px], all: [px] }, FORMATS[format], { sub: false, whole, ...o });
    // ok: readable once opened (8 px or more in the image), too small where it lands.
    expect(say(10, "readme").level).toBe("ok");
    expect(say(10, "readme").text).toBe("The text is too small to read in a GitHub README until the image is opened; a larger format would help.");
    expect(say(10, "square").text).toBe("The text is too small to read in a feed until the image is opened; the LinkedIn version would help.");
    expect(say(4, "slide", { sub: true }).text).toBe("The text will be too small to read on a projected slide, even when the image is opened; hiding the sub-lines would help.");
    expect(say(20, "slide").text).toBe("The text is readable on a projected slide as it is.");
    for (const f of FORMAT_IDS) {
      const r = say(4, f);
      expect(r.text).not.toMatch(/\d/);
      expect(r.text.split(/[.;] /)).toHaveLength(r.text.includes(";") ? 2 : 1);
      expect(r.detail).toContain(`${(4 * FORMATS[f].seen / FORMATS[f].w).toFixed(1)} px ${FORMATS[f].where}, 4.0 px opened.`);
    }
    expect(readabilityOf({ names: [], all: [] }, FORMATS.readme, { sub: false, whole })).toMatchObject({ level: "warn", text: "The image has no text to read." });
  });

  it("embeds fonts when given", () => {
    const img = renderShare(shop(), "overview", { ...DEFAULT_SHARE, theme: "dark", fonts: { sans: "AAAA", mono: "BBBB" } });
    expect(img.svg).toContain("@font-face{font-family:Geist;");
    expect(img.svg).toContain("base64,BBBB");
  });

  it("draws its text at the font's own advances (diagram contract, Geometry)", () => {
    const img = renderShare(shop(), "overview", { ...DEFAULT_SHARE, theme: "light" });
    expect(img.svg).toMatch(/^<svg [^>]*\btext-rendering="geometricPrecision"/);
  });

  it("keeps a long title in the strip under the drawing clear of a full colour key (#138)", () => {
    const doc = hotel();
    const v = doc.views[0];
    v.nodes.forEach((n, i) => { n.kind = KINDS[i % KINDS.length]; });
    v.caption.title = "Orders go in at the shop and out to the courier, the bank and the warehouse";
    // A free text in each corner of a 16:9 box round the drawing: no corner of the image is free.
    const b = drawView(v, PALETTES.light).bounds;
    const w = Math.max(b.w, (b.h * 16) / 9), h = (w * 9) / 16, x = b.x + b.w / 2 - w / 2, y = b.y + b.h / 2 - h / 2;
    for (const [i, [tx, ty]] of [[x, y], [x + w - 60, y], [x, y + h - 50], [x + w - 60, y + h - 50]].entries()) v.texts.push({ id: `c${i}`, text: "ok", x: tx, y: ty, size: 40 });
    for (const format of ["readme", "slide"] as const) {
      const f = FORMATS[format];
      const svg = renderShare(doc, v.id, { ...DEFAULT_SHARE, format, theme: "light" }).svg;
      expect(svg, format).toContain('data-caption="strip"');
      const title = /<text data-caption="title"[^>]*>(.*?)<\/text>/.exec(svg)![1];
      const lines = [...title.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
      const titleRight = f.m + Math.max(...lines.map((l) => textWidth(l, f.t, 600, -0.02)));
      const dots = [...svg.matchAll(/<g data-key="[a-z]+"><circle cx="([\d.]+)"[^>]*r="([\d.]+)"/g)];
      expect(dots, format).toHaveLength(KINDS.length);
      const keyLeft = Math.min(...dots.map((m) => Number(m[1]) - Number(m[2])));
      expect(titleRight, format).toBeLessThan(keyLeft);
    }
  });
});

/** XML 1.0 well-formedness, enough for our own markup: legal characters, known entities, balanced tags. */
function wellFormed(xml: string): string | null {
  const bad = /[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/u.exec(xml);
  if (bad) return `Invalid character U+${bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} at ${bad.index}`;
  const amp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(xml);
  if (amp) return `Bare & at ${amp.index}`;
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|>/g)) {
    if (!m[2]) { if (m[0] === "<") return `Stray < at ${m.index}`; continue; }
    if (m[1]) { if (stack.pop() !== m[2]) return `Unbalanced </${m[2]}> at ${m.index}`; }
    else if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? `Unclosed <${stack.pop()}>` : null;
}

describe("exports are well-formed XML (#135)", () => {
  const C0 = ["\u0001", "\u0008", "\u000B", "\u000C", "\u001F", "\uFFFE"];
  it("drops characters XML forbids from every user text, in the drawing and the share image", () => {
    const doc = shop();
    const v = doc.views[0];
    const panel = v.nodes.find((n) => n.form === "panel");
    for (const [i, n] of v.nodes.entries()) { n.label = `Order${C0[i % C0.length]}desk`; n.sub = `sub${C0[(i + 1) % C0.length]}line`; }
    if (panel) panel.items = panel.items.map((t) => `${t}\u000B`);
    for (const e of v.edges) e.label = "pays\u000Cout";
    v.texts.push({ id: "t1", text: "free\u0001text", x: 0, y: -80, size: 24 });
    v.caption.title = "Title\u0002 with\u0003 controls";
    expect(wellFormed(drawView(v, PALETTES.light).body)).toBeNull();
    for (const format of FORMAT_IDS) {
      const svg = renderShare(doc, v.id, { ...DEFAULT_SHARE, lede: true, format, theme: "dark" }).svg;
      expect(wellFormed(svg), format).toBeNull();
      expect(svg).toContain("Orderdesk");
    }
  });
  it("still escapes markup characters", () => {
    expect(esc(`a<b>&"c'\u000B`)).toBe("a&lt;b&gt;&amp;&quot;c&#39;");
    expect(wellFormed(`<svg><text>${esc("x\u0000\uD800y")}</text></svg>`)).toBeNull();
  });
});

describe("LinkedIn version", () => {
  const part = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
    id, label: `Part ${id}`, kind: "service", form: "panel", icon: null, sub: `what ${id} does`, items: ["held"], description: "D.",
    files: [], parent: null, detail: null, place: null, x: 0, y: 0, ...extra,
  });
  const edge = (id: string, from: string, to: string, step: number | null, label = ""): DiagramEdge => ({ id, from, to, label, style: "call", both: false, step });
  // A group whose inside holds step 2: folding it would leave the path numbered 1, 3.
  const grouped = (): DiagramView => ({
    id: "main", title: "Main", caption: { title: "How it works", lede: "One sentence." }, postOf: null,
    nodes: [part("x"), part("g", { form: "group", items: [] }), part("a", { parent: "g" }), part("b", { parent: "g" }), part("y")],
    edges: [edge("e1", "x", "a", 1, "asks"), edge("e2", "a", "b", 2, "inside"), edge("e3", "b", "y", 3, "answers"), edge("e4", "y", "x", null, "back")],
    texts: [{ id: "n1", text: "A text", x: 0, y: 0, size: 16 }],
  });

  it("folds groups into one part, keeps sub-lines and labels, and numbers the path 1, 2, 3 again", () => {
    const a = arrangeForFeed(grouped());
    expect(a.nodes.map((n) => n.id).sort()).toEqual(["g", "x", "y"]);
    // Every part is on the path, connected twice, holds something and has a description: all open.
    expect(a.nodes.map((n) => [n.id, n.form, n.items])).toEqual([["x", "panel", ["held"]], ["g", "panel", ["Part a", "Part b"]], ["y", "panel", ["held"]]]);
    expect(a.nodes.every((n) => !n.parent && n.sub.startsWith("what"))).toBe(true);
    const steps = a.edges.filter((e) => e.step !== null).sort((p, q) => p.step! - q.step!);
    expect(steps.map((e) => [e.from, e.to, e.step, e.label])).toEqual([["x", "g", 1, "asks"], ["g", "y", 2, "answers"]]);
    expect(a.edges.find((e) => e.step === null)).toMatchObject({ from: "y", to: "x", label: "back" });
    expect(a.texts).toEqual([]);
  });

  it("keeps the hotel's top-level parts, is deterministic and fits the tall frame", () => {
    const v = hotel().views[0];
    const top = v.nodes.filter((n) => !n.parent);
    const a = arrangeForFeed(v);
    expect(a.nodes.map((n) => n.id).sort()).toEqual(top.map((n) => n.id).sort());
    const ids = new Set(a.nodes.map((n) => n.id));
    expect(a.edges.every((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)).toBe(true);
    const r = [...layoutRects(a).values()];
    expect(r.every((p, i) => r.every((q, j) => i === j || !overlaps(p, q)))).toBe(true);
    expect(arrangeForFeed(v)).toEqual(arrangeForFeed(v));
    expect(v.nodes.some((n) => n.parent)).toBe(true); // the source view is untouched
  });

  it("keeps loose parts in a grid instead of one column", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => part(`p${i}`, { form: "card", items: [], y: i * 10 }));
    const v: DiagramView = { id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null, nodes, edges: [], texts: [] };
    const a = arrangeForFeed(v), rects = layoutRects(a, { post: true }); // the feed draws in the post style
    const xs = new Set(a.nodes.map((n) => Math.round((n.x + rects.get(n.id)!.w / 2) / 50))), ys = new Set(a.nodes.map((n) => n.y));
    expect(xs.size).toBe(3);
    expect(ys.size).toBe(4);
  });

  it("scores parts by the main path, connections, what they hold and their own description", () => {
    const ps = [part("a", { description: "No description yet." }), part("b", { form: "card", items: [] }), part("c", { form: "card", items: [] })];
    const es = [edge("1", "a", "b", 1), edge("2", "b", "c", null), edge("3", "b", "a", null)];
    const s = importance(ps, es, (n) => n.items);
    // a: path 4 + 2 connections + holds 2 + placeholder 0; b: 4 + 3 + 0 + 1; c: 0 + 1 + 0 + 1.
    expect([...s]).toEqual([["a", 8], ["b", 8], ["c", 2]]);
  });

  it("opens at most four parts with a score of 5 or more; other path parts are cards, the rest compact", () => {
    const ps = Array.from({ length: 7 }, (_, i) => part(`p${i}`, { items: ["one", "two"] }));
    const es = ps.slice(1, 6).map((n, i) => edge(`s${i}`, ps[i].id, n.id, i + 1));
    const v: DiagramView = { id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null, nodes: [...ps, part("loose", { form: "card", items: [] })], edges: es, texts: [] };
    const f = foldForFeed(v);
    const form = (id: string) => f.nodes.find((n) => n.id === id)!.form;
    // p1..p4 have two path connections (score 4 + 2 + 2 + 1 = 9); p0 and p5 one (8); p6 holds items but is off the path (2 + 1 = 3).
    expect(["p1", "p2", "p3", "p4"].map(form)).toEqual(["panel", "panel", "panel", "panel"]);
    expect([form("p0"), form("p5")]).toEqual(["card", "card"]);
    expect([form("p6"), form("loose")]).toEqual(["compact", "compact"]);
  });

  it("lists a folded group's members, ending a long list with + n more", () => {
    const kids = Array.from({ length: 7 }, (_, i) => part(`k${i}`, { parent: "g", form: "card", items: [] }));
    const v: DiagramView = {
      id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null,
      nodes: [part("g", { form: "group", items: [] }), ...kids, part("x")],
      edges: [edge("1", "x", "k0", 1), edge("2", "k6", "x", 2)], texts: [],
    };
    const g = foldForFeed(v).nodes.find((n) => n.id === "g")!;
    expect(g).toMatchObject({ form: "panel", items: ["Part k0", "Part k1", "Part k2", "Part k3", "+ 3 more"] });
  });

  it("keeps a panel's held and limit rows whole and named; a cut list counts its limits in + n more", () => {
    const limit = "Each job tried once; the 3-try limit never comes into play";
    const panel = (items: string[], heldIds: string[], limitIds: string[]) => part("p", { form: "panel", items, heldIds, limitIds });
    const view = (p: DiagramNode): DiagramView => ({ id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null, nodes: [part("x"), p], edges: [edge("1", "x", "p", 1)], texts: [] });
    const short = foldForFeed(view(panel(["Mech one", "Item a", limit], ["m1"], ["l1"]))).nodes.find((n) => n.id === "p")!;
    expect(short).toMatchObject({ form: "panel", items: ["Mech one", "Item a", limit], heldIds: ["m1"], limitIds: ["l1"] });
    const long = foldForFeed(view(panel(["Mech one", "Mech two", "Item a", "Item b", "Item c", "Item d", limit], ["m1", "m2"], ["l1"]))).nodes.find((n) => n.id === "p")!;
    expect(long).toMatchObject({ form: "panel", items: ["Mech one", "Mech two", "Item a", "Item b", "+ 3 more"], heldIds: ["m1", "m2"] });
    expect(long.limitIds).toBeUndefined();
  });

  it("makes a path card compact when its sub-line would be shortened, and lists what is still shortened", () => {
    const long = "a sub-line far too long to fit on one card";
    const v: DiagramView = {
      id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null,
      nodes: [part("a", { form: "card", items: [], sub: long, description: "No description yet." }), part("b", { form: "card", items: [], description: "No description yet." })],
      edges: [edge("1", "a", "b", 1)], texts: [],
    };
    const f = foldForFeed(v);
    expect(f.nodes.map((n) => n.form)).toEqual(["compact", "card"]);
    const cut = { ...v.nodes[1], form: "card" as const, sub: long };
    expect(shortenedIn({ nodes: [cut] }, { sub: true })).toEqual([{ id: "b", label: "Part b", text: long }]);
    expect(shortenedIn({ nodes: [v.nodes[1]] }, { sub: true })).toEqual([]);
  });

  it("starts each destination with its own toggles: the post's for a post or LinkedIn, fewer for Square", () => {
    const on = (format: Parameters<typeof startSwitches>[0], post = false) =>
      Object.entries(startSwitches(format, post)).filter(([, v]) => v).map(([k]) => k).sort();
    expect(on("feed")).toEqual(["labels", "lede", "steps", "texts", "title"]);
    expect(on("readme", true)).toEqual(on("feed"));
    expect(on("square")).toEqual(["lede", "steps", "texts", "title"]);
    for (const f of ["readme", "slide", "linkedin"] as const) expect(on(f)).toEqual(["labels", "legend", "steps", "texts", "title"]);
  });

  it("suggests one change that has not been made yet", () => {
    const s = (o: Partial<Parameters<typeof suggestionFor>[1]>, level: "ok" | "warn" | "good" = "warn") =>
      suggestionFor(level, { sub: false, format: "readme", linkedInVersion: false, ...o });
    expect(s({ sub: true })).toBe("hiding the sub-lines would help");
    expect(s({ format: "feed" })).toBe("the LinkedIn version would help");
    expect(s({ format: "feed", linkedInVersion: true })).toBe("a larger format would help");
    expect(s({ sub: true }, "good")).toBeNull();
  });

  it("wraps a long title instead of cutting it short, and never shortens a numbered label", () => {
    const long = "A very long title that goes on and on about what this system does for the people who use it every single day";
    const v = { ...grouped(), caption: { title: long, lede: "" } };
    v.edges[0] = { ...v.edges[0], label: "the request travels a long way through many hands before it is finally answered by someone" };
    const { doc, view } = makeLinkedInView({ ...shop(), views: [v] } as DiagramDocument, "main");
    const img = renderShare(doc, view, { ...DEFAULT_SHARE, format: "feed", theme: "light" });
    const caption = img.svg.split('data-caption="title"')[1].split("</text>")[0];
    expect(caption).not.toContain("…");
    expect(caption).toContain("every single day");
    expect(img.svg).not.toContain('data-caption="step"');
    for (const label of img.svg.matchAll(/data-edge-label="[^"]*"[^>]*>[^]*?<\/g>/g)) expect(label[0]).not.toContain("…");
  });

  it("handles an empty view", () => {
    const v: DiagramView = { id: "v", title: "V", caption: { title: "", lede: "" }, postOf: null, nodes: [], edges: [], texts: [] };
    expect(arrangeForFeed(v).nodes).toEqual([]);
  });

  it("suggests the LinkedIn version on an ordinary -linkedin view and not on a post", () => {
    const tiny = { names: [4], all: [4] };
    const plain = { ...grouped(), id: "main-linkedin", postOf: null };
    expect(readabilityOf(tiny, FORMATS.feed, { sub: false, whole: plain }).text).toContain("the LinkedIn version would help");
    expect(readabilityOf(tiny, FORMATS.feed, { sub: false, whole: { ...plain, id: "story", postOf: "main" } }).text).not.toContain("the LinkedIn version");
  });

  it("re-arranges a LinkedIn view without changing the forms the user chose", () => {
    const v = { ...arrangeForFeed(grouped()), id: "main-linkedin" };
    v.nodes[0] = { ...v.nodes[0], form: "compact" };
    const r = rearrangeForFeed(v);
    expect(r.nodes.map((n) => n.form)).toEqual(v.nodes.map((n) => n.form));
    expect(r.edges).toEqual(v.edges);
  });

  it("keeps the main path on its turn-back grid however the other parts pull", () => {
    // The shape of a real engine rewrite: the first step's part also talks to two side parts.
    const P = (id: string, form: DiagramNode["form"]) => part(id, form === "panel" ? { form } : { form, items: [] });
    const v: DiagramView = {
      id: "main-linkedin", title: "T", caption: { title: "T", lede: "" }, postOf: null,
      nodes: [P("session", "panel"), P("cli", "card"), P("server", "panel"), P("editor", "panel"), P("share", "card"), P("repo", "compact"), P("file", "compact"), P("engines", "compact")],
      edges: [edge("e1", "session", "cli", 1), edge("e2", "cli", "server", 2), edge("e3", "server", "editor", 3), edge("e4", "editor", "share", 4),
        edge("e5", "session", "repo", null), edge("e6", "session", "file", null), edge("e7", "server", "file", null), edge("e8", "server", "engines", null), edge("e9", "engines", "repo", null)],
      texts: [],
    };
    const r = rearrangeForFeed(v), rects = layoutRects(r);
    const mid = (id: string) => { const b = rects.get(id)!; return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
    // Rows in path order: each row's parts share a centre line, rows go down, and the path turns back.
    const rows: { y: number; xs: number[] }[] = [];
    for (const p of ["session", "cli", "server", "editor", "share"].map(mid)) {
      const last = rows.at(-1);
      if (last && Math.abs(last.y - p.y) <= 1) last.xs.push(p.x);
      else { if (last) expect(p.y).toBeGreaterThan(last.y); rows.push({ y: p.y, xs: [p.x] }); }
    }
    expect(rows.length).toBeGreaterThan(1);
    const cols = rows[0].xs.length;
    expect([2, 3]).toContain(cols);
    rows.forEach((row, i) => {
      expect(row.xs.length).toBeLessThanOrEqual(cols);
      expect(row.xs).toEqual([...row.xs].sort((a, b) => (i % 2 ? b - a : a - b)));
    });
    expect(rows.slice(0, -1).every((row) => row.xs.length === cols)).toBe(true);
  });

  it("does not ask a LinkedIn view for panels or side rows", () => {
    const flat = Array.from({ length: 7 }, (_, i) => part(`q${i}`, { form: "card", items: [] }));
    const edges = flat.slice(1).map((n, i) => edge(`s${i}`, flat[i].id, n.id, i + 1));
    const views = (id: string) => [{ id, title: "T", caption: { title: "T", lede: "" }, postOf: null, nodes: flat, edges, texts: [] }];
    expect(depthWarnings({ views: views("main") }).join(" ")).toMatch(/flat pipeline/);
    expect(depthWarnings({ views: views("main-linkedin") }).join(" ")).not.toMatch(/flat pipeline/);
  });

  it("asks the engine to rewrite only that view, in plain words", () => {
    const text = explainInstruction("main-linkedin");
    expect(text).toContain('"main-linkedin"');
    expect(text).toMatch(/Change no other view/);
    expect(text.length).toBeLessThanOrEqual(LIMITS.request);
  });

  it("draws both post formats with the caption on top and nothing under the drawing", () => {
    const { doc, view } = makeLinkedInView({ ...shop(), views: [grouped()] } as DiagramDocument, "main");
    for (const [format, size] of [["feed", [1080, 1350]], ["linkedin", [1620, 1080]]] as const) {
      const img = renderShare(doc, view, { ...DEFAULT_SHARE, format, lede: true, theme: "light" });
      expect([img.width, img.height]).toEqual(size);
      expect(img.svg).not.toContain('data-caption="step"');
      expect(img.svg).not.toContain('data-caption="strip"');
      // Numbered badges sit in the drawing; every label, numbered or not, stays on its connection.
      expect([...img.svg.matchAll(/data-step-badge="/g)]).toHaveLength(2);
      expect(img.svg).toMatch(/data-edge-label="[^"]*"[^>]*>[^]*?>asks</);
      expect(img.svg).toMatch(/data-edge-label="[^"]*"[^>]*>[^]*?>back</);
      const title = Number(/data-caption="title"[^>]*><tspan x="[\d.]+" y="([\d.]+)"/.exec(img.svg)![1]);
      expect(title).toBeLessThan(200);
      const off = renderShare(doc, view, { ...DEFAULT_SHARE, format, steps: false, theme: "light" }).svg;
      expect(off).not.toContain("data-step-badge");
    }
  });
});

describe("mermaid", () => {
  it("writes groups as subgraphs and every connection with its arrow", () => {
    const v = shop().views[0];
    const text = renderMermaid(v);
    expect(text.startsWith("flowchart LR\n")).toBe(true);
    expect(text).toContain('web["Web app"]'.replace("Web app", v.nodes.find((n) => n.id === "web")!.label));
    expect(text).toMatch(/web <-->\|POST \/orders\| api/);
    expect(text).toMatch(/api --> db/);
  });
});
