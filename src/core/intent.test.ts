import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { intentToDocument, parseIntent, postSource, postViewId, StoryError, storyProblems, type StoryIntent, type StoryPart } from "./intent";
import { assignEdgeIds, fillDefaults, validateDocument, type DiagramDocument } from "./model";
import { layoutReport } from "./report";
import { startSwitches } from "./export/share";

const shop = (): DiagramDocument => {
  const d = fillDefaults(JSON.parse(readFileSync("tests/fixtures/shop.archdraw.json", "utf8")), { id: "d_test000001" });
  assignEdgeIds(d);
  const v = validateDocument({ ...d, views: d.views.map((x) => ({ ...x, nodes: x.nodes.map((n, i) => ({ ...n, x: n.x ?? i * 300, y: n.y ?? 0 })) })) });
  if (!v.ok) throw new Error(v.error);
  return v.doc;
};
const intent = (name: string): StoryIntent => parseIntent(JSON.parse(readFileSync(`tests/fixtures/story/${name}.json`, "utf8")));
const part = (id: string, extra: Partial<StoryPart> = {}): StoryPart =>
  ({ id, label: id, sub: "", kind: "service", chips: [], zone: null, spine: null, anchor: null, side: null, from: [], inside: null, held: [], limits: [], ...extra });
const small = (extra: Partial<StoryIntent> = {}): StoryIntent => ({
  title: "Orders end to end", lede: "A shop takes an order.", zones: [], steps: [],
  parts: [part("web", { spine: 0, from: ["web"] }), part("api", { spine: 1, chips: ["Validate", "Create"], from: ["api"] }), part("db", { anchor: "api", side: "below", from: ["db", "ghost"] })],
  edges: [{ from: "web", to: "api", label: "", style: "call", step: 1 }, { from: "api", to: "db", label: "writes", style: "call", step: null }],
  ...extra,
});

describe("story intent → post view", () => {
  it("draws each fixture intent as the source's post: valid, placed, the source untouched, good in the feed", () => {
    for (const name of ["reference", "claude", "codex"]) {
      const base = shop();
      const { doc, view, warnings } = intentToDocument(base, "overview", intent(name), { portrait: true });
      expect(view).toBe("overview-linkedin");
      const post = doc.views.find((v) => v.id === view)!;
      expect(post.postOf).toBe("overview");
      expect(doc.views[0]).toEqual(base.views[0]);
      expect(post.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number")).toBe(true);
      expect(warnings.length).toBe(doc.warnings.length - base.warnings.length);
      const r = layoutReport(doc, view, { ...startSwitches("feed", true), format: "feed", theme: "light" });
      expect(r).toMatchObject({ crossings: 0, edgesOverParts: [], cutText: [] });
      expect(r.smallestText.level).toBe("good");
    }
  });

  it("takes descriptions and files from the components a part represents, and drops an unknown one with a warning", () => {
    const base = shop();
    const { doc, view, warnings } = intentToDocument(base, "overview", small(), { portrait: true });
    const post = doc.views.find((v) => v.id === view)!;
    const api = post.nodes.find((n) => n.label === "api")!, src = base.views[0].nodes.find((n) => n.id === "api")!;
    expect(api).toMatchObject({ form: "panel", items: ["Validate", "Create"], description: src.description, files: src.files, from: ["api"], lane: { spine: 1 } });
    expect(post.nodes.find((n) => n.label === "db")).toMatchObject({ form: "card", from: ["db"], lane: { side: "below" } });
    expect(warnings).toEqual(['Dropped "ghost" from what "db" represents: no such component']);
    // Ids never clash with the source's: the post's own are fresh.
    expect(post.nodes.map((n) => n.id).some((id) => base.views[0].nodes.some((m) => m.id === id))).toBe(false);
  });

  it("keeps the first 20 files a part represents, with one warning", () => {
    const base = shop();
    const files = (k: string, n: number) => Array.from({ length: n }, (_, i) => `src/${k}/f${i}.ts`);
    base.views[0].nodes.find((n) => n.id === "web")!.files = files("web", 15);
    base.views[0].nodes.find((n) => n.id === "api")!.files = files("api", 10);
    const i = small({ parts: [part("web", { spine: 0, from: ["web", "api"] }), part("db", { spine: 1, from: ["db"] })], edges: [] });
    const { doc, view, warnings } = intentToDocument(base, "overview", i, { portrait: true });
    expect(doc.views.find((v) => v.id === view)!.nodes.find((n) => n.label === "web")!.files).toEqual([...files("web", 15), ...files("api", 5)]);
    expect(warnings).toEqual(['Kept the first 20 of the 25 files "web" represents']);
  });

  it("joins reverse pairs, drops repeats and renumbers steps, one warning each", () => {
    const i = small({ edges: [
      { from: "web", to: "api", label: "", style: "call", step: 4 },
      { from: "api", to: "web", label: "reply", style: "async", step: null },
      { from: "web", to: "api", label: "again", style: "call", step: null },
      { from: "api", to: "db", label: "", style: "call", step: 9 },
    ] });
    const { doc, view, warnings } = intentToDocument(shop(), "overview", i, { portrait: true });
    const edges = doc.views.find((v) => v.id === view)!.edges;
    expect(edges.map((e) => [e.both, e.label, e.style, e.step])).toEqual([[true, "reply", "call", 1], [false, "", "call", 2]]);
    expect(warnings.filter((w) => /Joined|repeated|Renumbered/.test(w))).toHaveLength(4);
  });

  it("keeps over-target text whole with a warning, and a spine label too", () => {
    const long = "A deliberately longer request name";
    const i = small({ parts: [part("web", { spine: 0, label: long }), part("api", { spine: 1 }), part("db", { anchor: "api", side: "below" })],
      edges: [{ from: "web", to: "api", label: "sends it", style: "call", step: 1 }] });
    const { doc, view, warnings } = intentToDocument(shop(), "overview", i, { portrait: true });
    const post = doc.views.find((v) => v.id === view)!;
    expect(post.nodes.some((n) => n.label === long)).toBe(true);
    expect(post.edges[0].label).toBe("sends it");
    expect(warnings).toHaveLength(2);
  });

  it("fails without changing anything on an impossible story", () => {
    const bad: [string, Partial<StoryIntent>][] = [
      ["ghost edge", { edges: [{ from: "web", to: "ghost", label: "", style: "call", step: 1 }] }],
      ["self edge", { edges: [{ from: "web", to: "web", label: "", style: "call", step: 1 }] }],
      ["edge to a zone", { zones: [{ id: "z", label: "Z" }], edges: [{ from: "web", to: "z", label: "", style: "call", step: 1 }] }],
      ["missing anchor", { parts: [part("web", { spine: 0 }), part("db", { anchor: "nope", side: "below" })] }],
      ["side part anchored to a side part", { parts: [part("web", { spine: 0 }), part("a", { anchor: "web", side: "above" }), part("b", { anchor: "a", side: "above" })] }],
      ["duplicate spine", { parts: [part("web", { spine: 0 }), part("api", { spine: 0 })] }],
      ["unknown zone", { parts: [part("web", { spine: 0, zone: "z" })] }],
      ["gap in a zone's spine", { zones: [{ id: "z", label: "Z" }], parts: [part("a", { spine: 0, zone: "z" }), part("b", { spine: 1 }), part("c", { spine: 2, zone: "z" })] }],
      ["no parts", { parts: [], edges: [] }],
    ];
    for (const [what, change] of bad) {
      const base = shop(), before = JSON.stringify(base);
      expect(() => intentToDocument(base, "overview", small(change), { portrait: true }), what).toThrow(StoryError);
      expect(JSON.stringify(base), what).toBe(before);
    }
  });

  it("names the channel in a failure, and keeps the first 12 rows of a part with more chips", () => {
    const ghost = small({ edges: [{ from: "web", to: "ghost", label: "", style: "call", step: 1 }] });
    expect(() => intentToDocument(shop(), "overview", ghost, { portrait: true })).toThrow(/^The engine's LinkedIn post cannot be drawn: /);
    expect(() => intentToDocument(shop(), "overview", ghost, { portrait: false, channel: "readme" })).toThrow(/^The engine's README drawing cannot be drawn: /);
    const chips = Array.from({ length: 13 }, (_, i) => `Chip ${i + 1}`);
    const i = small({ parts: [part("web", { spine: 0, from: ["web"] }), part("api", { spine: 1, chips, from: ["api"] }), part("db", { anchor: "api", side: "below", from: ["db"] })] });
    const { doc, view, warnings } = intentToDocument(shop(), "overview", i, { portrait: true });
    expect(doc.views.find((v) => v.id === view)!.nodes.find((n) => n.label === "api")!.items).toEqual(chips.slice(0, 12));
    expect(warnings.filter((w) => w.includes("rows"))).toEqual(['Kept the first 12 rows of "api"']);
  });

  it("lists every problem of an answer at once: relations, texts over their limits, an empty title, the steps", () => {
    const i = small({
      title: " ", lede: "x".repeat(241),
      parts: [part("web", { spine: 0, label: "L".repeat(49), chips: ["c".repeat(45)] }), part("api", { spine: 0 }), part("db", { anchor: "api", side: "below" })],
    });
    expect(storyProblems(i, "linkedin")).toEqual([
      'part "api" has spine 0, which is negative or taken',
      "the description is 241 characters, over the 240 it may hold",
      'the label of "web" is 49 characters, over the 48 it may hold',
      'a chip of "web" is 45 characters, over the 44 it may hold',
      "it has no title",
    ]);
    expect(storyProblems(small(), "linkedin")).toEqual([]);
    const steps = Array.from({ length: 21 }, (_, k) => ({ parts: ["web"], text: k === 2 ? "" : `Step ${k + 1}`, note: "" }));
    expect(storyProblems(small({ steps }), "presentation")).toEqual(["it has 21 steps, over the 20 a presentation holds", "step 3 has no text"]);
    expect(storyProblems(small({ steps }), "readme")).toEqual([]);
    const many = small({ zones: [{ id: "z", label: "Z" }], parts: Array.from({ length: 60 }, (_, k) => part(`p${k}`, { spine: k })), edges: [] });
    expect(storyProblems(many, "overview")).toEqual(["it has 60 parts and 1 zones, over the 60 a view holds"]);
  });

  it("after the repair turn, shortens a text over its limit with one warning each, and fails naming every relation still violated", () => {
    const long = small({ lede: "a".repeat(250), parts: [part("web", { spine: 0, sub: "s".repeat(61) }), part("api", { spine: 1 }), part("db", { anchor: "api", side: "below" })], edges: [{ from: "web", to: "api", label: "l".repeat(41), style: "call", step: 1 }] });
    const { doc, view, warnings } = intentToDocument(shop(), "overview", long, { portrait: true });
    const v = doc.views.find((x) => x.id === view)!;
    expect(v.caption.lede).toBe("a".repeat(239) + "…");
    expect(v.nodes.find((n) => n.label === "web")!.sub).toBe("s".repeat(59) + "…");
    expect(v.edges[0].label).toHaveLength(40);
    expect(warnings.filter((w) => w.startsWith("Shortened"))).toEqual(["Shortened the description to 240 characters", 'Shortened the sub-line of "web" to 60 characters', "Shortened the label of web → api to 40 characters"]);
    const broken = small({ edges: [{ from: "web", to: "web", label: "", style: "call", step: 1 }, { from: "web", to: "ghost", label: "", style: "call", step: null }] });
    expect(() => intentToDocument(shop(), "overview", broken, { portrait: false, channel: "readme" })).toThrow(
      `The engine's README drawing cannot be drawn: a connection from "web" to itself; a connection web → ghost names something that is not a part`,
    );
    // A holder's chips are dropped with one warning, never a problem or shortened; a cut never splits a surrogate pair.
    const holder = small({ parts: [part("web", { spine: 0, chips: ["h".repeat(45)] }), part("api", { spine: 0, inside: "web" })], edges: [] });
    expect(storyProblems(holder, "readme")).toEqual([]);
    const held = intentToDocument(shop(), "overview", holder, { portrait: false, channel: "readme" }).warnings.filter((w) => w.includes('"web"'));
    expect(held).toEqual(['"web" holds parts, so it draws no chips']);
    const emoji = intentToDocument(shop(), "overview", small({ lede: "a".repeat(238) + "😀😀" }), { portrait: true });
    const lede = emoji.doc.views.find((v) => v.id === emoji.view)!.caption.lede;
    expect([lede.length, lede.endsWith("a…")]).toEqual([239, true]);
    const untitled = intentToDocument(shop(), "overview", small({ title: "" }), { portrait: true });
    expect(untitled.warnings).toContain(`The LinkedIn post has no title, kept "${shop().title}"`);
  });

  it("checks the answer against the schema exactly, with no takeaway", () => {
    const raw = JSON.parse(readFileSync("tests/fixtures/story/reference.json", "utf8"));
    expect(() => parseIntent({ ...raw, takeaway: "x" })).toThrow(/unknown property "takeaway"/);
    expect(() => parseIntent({ ...raw, parts: [{ ...raw.parts[0], spine: 1.5 }] })).toThrow(/integer/);
    const { title: _t, ...noTitle } = raw;
    expect(() => parseIntent(noTitle)).toThrow(/missing "title"/);
    const { steps: _s, ...noSteps } = raw;
    expect(() => parseIntent(noSteps)).toThrow(/missing "steps"/);
    const { held: _h, ...noHeld } = raw.parts[0];
    expect(() => parseIntent({ ...raw, parts: [noHeld] })).toThrow(/parts\[0\] is missing "held"/);
  });
});

describe("post-view identity", () => {
  it("replaces a source's own post keeping its id, and resolves a post to its source", () => {
    const first = intentToDocument(shop(), "overview", small(), { portrait: true });
    const again = intentToDocument(first.doc, postSource(first.doc, first.view), small({ title: "Second take" }), { portrait: true });
    expect(again.view).toBe(first.view);
    expect(again.doc.views).toHaveLength(2);
    expect(again.doc.views[1].caption.title).toBe("Second take");
  });

  it("never takes over a legacy -linkedin view, and keeps every id within 64 characters", () => {
    const d = shop();
    d.views.push({ ...structuredClone(d.views[0]), id: "overview-linkedin", postOf: null, nodes: [], edges: [] });
    expect(postViewId(d, "overview")).toBe("overview-2-linkedin");
    const { doc } = intentToDocument(d, "overview", small(), { portrait: true });
    expect(doc.views.map((v) => [v.id, v.postOf])).toEqual([["overview", null], ["overview-linkedin", null], ["overview-2-linkedin", "overview"]]);
    const long = "v".repeat(64);
    expect(postViewId({ views: [{ ...d.views[0], id: long }], requests: [] }, long)).toHaveLength(64);
  });

  it("the validator refuses chains, self-posts, dangling sources and two posts of one view", () => {
    const { doc } = intentToDocument(shop(), "overview", small(), { portrait: true });
    const post = doc.views[1];
    const cases = [
      { ...doc, views: [doc.views[0], { ...post, postOf: post.id }] },
      { ...doc, views: [doc.views[0], { ...post, postOf: "nowhere" }] },
      { ...doc, views: [{ ...doc.views[0], postOf: post.id }, post] },
      { ...doc, views: [...doc.views, { ...structuredClone(post), id: "twin", nodes: [], edges: [] }] },
    ];
    for (const c of cases) expect(validateDocument(c).ok).toBe(false);
    expect(validateDocument(doc).ok).toBe(true);
  });
});
