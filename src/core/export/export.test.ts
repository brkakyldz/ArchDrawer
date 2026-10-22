import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutRects, overlaps } from "../geometry";
import { depthWarnings, LIMITS, validateFile, type DiagramDocument, type DiagramEdge, type DiagramNode, type DiagramView } from "../model";
import { normalizeFile } from "../normalize";
import { PALETTES } from "../theme";
import { arrangeForFeed, explainInstruction, foldForFeed, importance, rearrangeForFeed } from "./feed";
import { makeLinkedInView } from "../testkit";
import { renderMermaid } from "./mermaid";
import { DEFAULT_SHARE, FORMAT_IDS, FORMATS, readabilityOf, renderShare, shortenedIn, startSwitches, suggestionFor } from "./share";
import { drawView, outlineOf, outlineSize, shapeOf } from "./svg";

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

  it("leaves held items out when asked, and panels shrink", () => {
    const v = shop().views[0];
    expect(drawView(v, PALETTES.light).body).toContain("Validate order");
    expect(drawView(v, PALETTES.light, { items: false }).body).not.toContain("Validate order");
  });

  it("escapes text", () => {
    const v = shop().views[0];
    v.nodes[0].label = `<script>"&"</script>`;
    const body = drawView(v, PALETTES.light).body;
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("shapes by kind (LOOK-2)", () => {
  const SHAPED: [DiagramNode["kind"], string][] = [["llm", "agent"], ["actor", "person"], ["data", "store"], ["external", "external"], ["gate", "check"], ["service", "card"], ["client", "card"]];
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
    "panel-llm": "card", "group-data": "group", "inner-gate": "check",
  };
  /** Every point of a path's segments, and for an arc of a half ellipse its far side too. */
  const extent = (d: string) => {
    const xs: number[] = [], ys: number[] = [];
    let x = 0, y = 0;
    for (const [, c, args] of d.matchAll(/([MHVLA])([^MHVLAZ]*)/g)) {
      const v = args.trim().split(/[\s,]+/).map(Number);
      if (c === "H") x = v[0]; else if (c === "V") y = v[0];
      else if (c === "A") { const [rx, ry, , , sweep, ex, ey] = v; if (ey === y && Math.abs(ex - x) === 2 * rx) ys.push(y + (ex > x === !!sweep ? -ry : ry)); x = ex; y = ey; }
      else { x = v[0]; y = v[1]; }
      xs.push(x); ys.push(y);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };

  it("names each card's and compact part's outline by its kind; a panel is a card and a group a group", () => {
    for (const P of [PALETTES.light, PALETTES.dark]) expect(shapes(drawView(view(), P).body)).toEqual(expected);
  });

  it("draws every shape inside the unchanged box, with the box as the first rect", () => {
    for (const id of ["main", "main-linkedin"]) {
      const v = view(id), d = drawView(v, PALETTES.light), plain = layoutRects({ ...v, nodes: v.nodes.map((x) => ({ ...x, kind: x.form === "group" ? x.kind : "service" })) });
      for (const x of v.nodes) {
        const r = d.rects.get(x.id)!;
        expect(r, `${id} ${x.id}: the box of a plain part`).toEqual(plain.get(x.id));
        expect(firstRect(d.body, x.id), `${id} ${x.id}: first rect`).toEqual({ w: r.w, h: r.h });
        const outline = attr(bodies(d.body).get(x.id)!, "d");
        if (!outline || !["agent", "person", "store", "external", "check"].includes(expected[x.id])) continue;
        const e = extent(outline);
        expect(e.x0, `${id} ${x.id} left`).toBeGreaterThanOrEqual(r.x - 0.01); expect(e.x1, `${id} ${x.id} right`).toBeLessThanOrEqual(r.x + r.w + 0.01);
        expect(e.y0, `${id} ${x.id} top`).toBeGreaterThanOrEqual(r.y - 0.01); expect(e.y1, `${id} ${x.id} bottom`).toBeLessThanOrEqual(r.y + r.h + 0.01);
      }
    }
  });

  it("strokes a shaped outline with round joins, so a browser measures it as it measures a rect", () => {
    const body = drawView(view(), PALETTES.light).body;
    const paths = [...body.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]).filter((el) => /\sclass="(?:body|shape-mark)"/.test(el));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toContain('stroke-linejoin="round"');
  });

  it("draws the same shapes in the post style", () => {
    expect(shapes(drawView(view("main-linkedin"), PALETTES.dark).body)).toEqual(expected);
  });

  it("gives every outline a measured edge: the store's ellipse and the head touch the box", () => {
    const r = { x: 10, y: 20, w: 196, h: 108 }, s = outlineSize("card");
    expect(extent(outlineOf("store", r, s).d)).toEqual({ x0: 10, x1: 206, y0: 20, y1: 128 });
    expect(extent(outlineOf("person", r, s).d)).toMatchObject({ y0: 20, y1: 128 });
    expect(outlineOf("check", r, s).d).toMatch(/^M22,20 H194 L206,32 V116 L194,128 H22 L10,116 V32 Z$/);
    expect(outlineOf("external", r, s).dash).toBeTruthy();
    expect(shapeOf({ kind: "llm", form: "panel" })).toBe("card");
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
    expect(big.readability.text).toBe("The text will be too small to read in the LinkedIn feed, even when the image is opened; hiding what each part holds would help.");
    expect(big.readability.detail).toMatch(/^Names \d+\.\d px and text \d+\.\d px in the LinkedIn feed, \d+\.\d px opened\.$/);
    const small = renderShare(shop(), "overview", { ...DEFAULT_SHARE, theme: "light", format: "slide" });
    expect(small.readability.level).toBe("good");
    expect(small.readability.inPlace).toBeGreaterThanOrEqual(9);
    expect(small.readability.text).toBe("The text is readable on a projected slide as it is.");
  });

  it("says readability in one plain sentence per destination, with the numbers apart", () => {
    const whole = { id: "v", postOf: null } as DiagramView;
    const say = (px: number, format: keyof typeof FORMATS, o: { items?: boolean; whole?: DiagramView } = {}) =>
      readabilityOf({ names: [px], all: [px] }, FORMATS[format], { items: false, whole, ...o });
    // ok: readable once opened (8 px or more in the image), too small where it lands.
    expect(say(10, "readme").level).toBe("ok");
    expect(say(10, "readme").text).toBe("The text is too small to read in a GitHub README until the image is opened; a larger format would help.");
    expect(say(10, "square").text).toBe("The text is too small to read in a feed until the image is opened; the LinkedIn version would help.");
    expect(say(4, "slide", { items: true }).text).toBe("The text will be too small to read on a projected slide, even when the image is opened; hiding what each part holds would help.");
    expect(say(20, "slide").text).toBe("The text is readable on a projected slide as it is.");
    for (const f of FORMAT_IDS) {
      const r = say(4, f);
      expect(r.text).not.toMatch(/\d/);
      expect(r.text.split(/[.;] /)).toHaveLength(r.text.includes(";") ? 2 : 1);
      expect(r.detail).toContain(`${(4 * FORMATS[f].seen / FORMATS[f].w).toFixed(1)} px ${FORMATS[f].where}, 4.0 px opened.`);
    }
    expect(readabilityOf({ names: [], all: [] }, FORMATS.readme, { items: false, whole })).toMatchObject({ level: "warn", text: "The image has no text to read." });
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
    expect(shortenedIn({ nodes: [cut] }, { items: true })).toEqual([{ id: "b", label: "Part b", text: long }]);
    expect(shortenedIn({ nodes: [v.nodes[1]] }, { items: true })).toEqual([]);
  });

  it("starts each destination with its own toggles: the post's for a post or LinkedIn, fewer for Square", () => {
    const on = (format: Parameters<typeof startSwitches>[0], post = false) =>
      Object.entries(startSwitches(format, post)).filter(([, v]) => v).map(([k]) => k).sort();
    expect(on("feed")).toEqual(["items", "labels", "lede", "steps", "texts", "title"]);
    expect(on("readme", true)).toEqual(on("feed"));
    expect(on("square")).toEqual(["lede", "steps", "texts", "title"]);
    for (const f of ["readme", "slide", "linkedin"] as const) expect(on(f)).toEqual(["items", "labels", "legend", "steps", "texts", "title"]);
  });

  it("suggests one change that has not been made yet", () => {
    const s = (o: Partial<Parameters<typeof suggestionFor>[1]>, level: "ok" | "warn" | "good" = "warn") =>
      suggestionFor(level, { items: false, format: "readme", linkedInVersion: false, ...o });
    expect(s({ items: true })).toBe("hiding what each part holds would help");
    expect(s({ format: "feed" })).toBe("the LinkedIn version would help");
    expect(s({ format: "feed", linkedInVersion: true })).toBe("a larger format would help");
    expect(s({ items: true }, "good")).toBeNull();
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
    expect(readabilityOf(tiny, FORMATS.feed, { items: false, whole: plain }).text).toContain("the LinkedIn version would help");
    expect(readabilityOf(tiny, FORMATS.feed, { items: false, whole: { ...plain, id: "story", postOf: "main" } }).text).not.toContain("the LinkedIn version");
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
