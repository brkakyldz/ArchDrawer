import { joinChannel } from "../core/channels";
import type { Document3 } from "../core/file3";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDocument3 } from "../core/file3";
import type { DiagramDocument } from "../core/model";
import { FixtureEngine, OVERLONG_LEDE } from "./engines/fixture";
import type { EngineRunRequest } from "./engines/types";
import { makeApp, makeFolder, shopRepo } from "./testkit";

async function setup(stepMs = 1, engines?: FixtureEngine[]) {
  const t = makeApp({ stepMs, engines });
  const { file } = shopRepo();
  const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
  const run = async (instruction: string, extra: Record<string, unknown> = {}) => {
    const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, view: "overview", instruction, engine: "fixture", model: null, ...extra } });
    return { status: r.status, body: (await r.json()) as { runId?: string; error?: string } };
  };
  const doc = (): DiagramDocument => bothChannels(JSON.parse(readFileSync(file, "utf8")));
  const stored = () => JSON.parse(readFileSync(file, "utf8"));
  return { ...t, file, id, run, doc, stored };
}

/** The overview's views, then the LinkedIn channel's: both channels a refine or a post may write. */
const bothChannels = (d: Document3): DiagramDocument => {
  const o = joinChannel(d, "overview");
  return { ...o, views: [...o.views, ...joinChannel(d, "linkedin").views] };
};

describe("instruction-box runs", () => {
  it("adds a component through the same pipeline, keeping positions, and reports progress", async () => {
    const { run, runs, doc, stored, id } = await setup();
    const before = doc();
    const { status, body } = await run("add Cache component");
    expect(status).toBe(202);
    const done = await runs.wait(body.runId!);
    expect(done).toMatchObject({ status: "succeeded", diagramId: id, error: null });
    expect(done!.progress).toEqual(["Changing the facts", "Reading the drawing", "Reading the code", "Updating the drawing", "Checking the drawing", "Saved"]);
    const after = doc();
    expect(validateDocument3(stored()).ok).toBe(true);
    const cache = after.views[0].nodes.find((n) => n.id === "cache")!;
    expect(cache).toMatchObject({ label: "Cache", kind: "service", form: "card", description: "Added by the fixture engine." });
    expect(after.views[0].edges).toContainEqual(expect.objectContaining({ from: "web", to: "cache", style: "call", both: false, step: null, label: "" }));
    for (const n of before.views[0].nodes) expect(after.views[0].nodes.find((m) => m.id === n.id)).toMatchObject({ x: n.x, y: n.y });
    expect(after.engine).toEqual({ id: "fixture", model: null });
  });

  it("removes, renames and adds held items", async () => {
    const { run, runs, doc } = await setup();
    await runs.wait((await run("rename Orders DB to Order store")).body.runId!);
    expect(doc().views[0].nodes.find((n) => n.id === "db")!.label).toBe("Order store");
    await runs.wait((await run("hold Retry policy in Orders DB")).body.runId!); // old label: no change
    await runs.wait((await run("hold Retry policy in order store")).body.runId!);
    expect(doc().views[0].nodes.find((n) => n.id === "db")).toMatchObject({ form: "panel", items: ["Retry policy"] });
    await runs.wait((await run("remove Order store")).body.runId!);
    expect(doc().views[0].nodes.map((n) => n.id)).toEqual(["web", "api"]);
    expect(doc().views[0].edges.every((e) => e.to !== "db" && e.from !== "db")).toBe(true);
  });

  it("repairs an invalid answer with one warning per repair", async () => {
    const { run, runs, doc } = await setup();
    await runs.wait((await run("[fixture:invalid] anything")).body.runId!);
    const after = doc();
    expect(after.views[0].nodes.map((n) => n.id)).toContain("web-2");
    expect(after.warnings).toEqual([
      'Renamed the duplicate id "web" to "web-2"', 'Dropped the connection web → ghost: "ghost" does not exist',
      // The copy names the same fact as "web", which this view already shows (drawing contract, rule 6).
      'View "overview": "web-2" no longer shows "web", which an earlier part shows',
    ]);
  });

  it("fails cleanly and leaves the file untouched", async () => {
    const { run, runs, file } = await setup();
    const before = readFileSync(file, "utf8");
    const done = await runs.wait((await run("add X [fixture:fail]")).body.runId!);
    expect(done).toMatchObject({ status: "failed", error: "Fixture failure requested", diagramId: null });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("runs one instruction at a time per drawing, and cancels", async () => {
    const { run, runs, req, file } = await setup(200);
    const before = readFileSync(file, "utf8");
    const first = await run("add A");
    expect((await run("add B")).status).toBe(409);
    await req(`/api/runs/${first.body.runId}/cancel`, { method: "POST" });
    expect(await runs.wait(first.body.runId!)).toMatchObject({ status: "cancelled" });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect((await run("add B")).status).toBe(202);
  });

  it("never overwrites a drawing that changed while it ran", async () => {
    const { run, runs, file } = await setup(60);
    const { body } = await run("add Cache");
    await new Promise((r) => setTimeout(r, 30));
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), title: "Edited meanwhile" }, null, 2));
    const done = await runs.wait(body.runId!);
    expect(done).toMatchObject({ status: "failed", error: "The drawing changed while the instruction ran." });
    const after = bothChannels(JSON.parse(readFileSync(file, "utf8")));
    expect(after.title).toBe("Edited meanwhile");
    expect(after.views[0].nodes.some((n: { id: string }) => n.id === "cache")).toBe(false);
  });

  it("checks the request: empty, too long, unknown view, unknown or missing engine", async () => {
    const { run } = await setup();
    expect((await run("  ")).status).toBe(400);
    expect((await run("x".repeat(4001))).status).toBe(400);
    expect((await run("add A", { view: "nope" })).status).toBe(400);
    expect((await run("add A", { engine: "gpt" })).status).toBe(400);
    expect((await run("add A", { diagramId: "d_missing00" })).status).toBe(404);
    expect((await run("add A", { engine: null })).status).toBe(202);
  });

  it("streams progress then exactly one done event", async () => {
    const { run, req, runs } = await setup(5);
    const { body } = await run("add A");
    await runs.wait(body.runId!);
    const text = await (await req(`/api/runs/${body.runId}/events`)).text();
    expect(text.match(/event: progress/g)).toHaveLength(6);
    expect(text.match(/event: done/g)).toHaveLength(1);
    expect(text).toContain('"status":"succeeded"');
  });

  it("a succeeded run carries its kind, view and the saved result's layout report; a failed one none", async () => {
    const { run, req, runs } = await setup();
    const { body } = await run("add Cache component", { format: "slide" });
    const done = (await runs.wait(body.runId!))!;
    expect(done).toMatchObject({ kind: "refine", view: "overview", status: "succeeded" });
    expect(done.layoutReport).toMatchObject({ view: "overview", format: "slide", crossings: expect.any(Number), cutText: expect.any(Array) });
    expect(done.layoutReport!.counts.parts).toBeGreaterThan(0);
    const got = (await (await req(`/api/runs/${body.runId}`)).json()) as { layoutReport: unknown; kind: string };
    expect(got.layoutReport).toEqual(JSON.parse(JSON.stringify(done.layoutReport)));
    const sse = await (await req(`/api/runs/${body.runId}/events`)).text();
    const final = JSON.parse(sse.split("event: done")[1].split("data:")[1].split("\n")[0]) as { layoutReport: unknown; view: string };
    expect(final).toMatchObject({ view: "overview", layoutReport: got.layoutReport });
    const plain = (await runs.wait((await run("add Queue component")).body.runId!))!;
    expect(plain.layoutReport!.format).toBe("readme");
    const failed = (await runs.wait((await run("add B [fixture:fail]")).body.runId!))!;
    expect(failed).toMatchObject({ status: "failed", layoutReport: null });
  });

  it("refuses an unknown kind or format before starting an engine", async () => {
    const { run } = await setup();
    expect((await run("add A", { kind: "draw" })).status).toBe(400);
    expect((await run("add A", { format: "poster" })).status).toBe(400);
    expect((await run("add A", { format: 3 })).status).toBe(400);
    expect((await run("add A", { kind: "refine", format: "feed" })).status).toBe(202);
  });

  it("reads and repairs against the store's repository root, not the base document's source", async () => {
    const t = makeApp();
    const { root, file } = shopRepo({ "src/api.ts": "// api\n" });
    const doc = t.store.register(file);
    const withApi = { ...doc, facts: { ...doc.facts, components: doc.facts.components.map((c) => (c.id === "api" ? { ...c, files: ["src/api.ts"] } : c)) } };
    t.store.put(doc.id, withApi);
    const cwds: string[] = [];
    const engine = new FixtureEngine(1);
    const run = engine.run.bind(engine);
    engine.run = (req) => { cwds.push(req.cwd); return run(req); };
    // A base naming another folder, where src/api.ts does not exist.
    const stored = { ...t.store.get(doc.id)!, source: { kind: "local" as const, path: makeFolder({}) } };
    const done = await t.runs.wait(t.runs.start({ engine, model: null, instruction: "add Cache component", view: "overview", base: joinChannel(stored, "overview"), stored }));
    expect(done).toMatchObject({ status: "succeeded" });
    // The routing question and the refine both run in the store's root.
    expect(cwds).toEqual([root, root]);
    const after = t.store.get(doc.id)!;
    expect(after.facts.components.find((c) => c.id === "api")!.files).toEqual(["src/api.ts"]);
    expect(after.warnings).toEqual([]);
  });
});

describe("post runs", () => {
  it("draws the LinkedIn channel from the canned intent: one warning for the reverse pair, parts pointing at facts, the report of the saved view", async () => {
    const { run, runs, doc, stored } = await setup();
    const before = doc();
    const { status, body } = await run("", { kind: "post", view: undefined });
    expect(status).toBe(202);
    const done = (await runs.wait(body.runId!))!;
    expect(done).toMatchObject({ kind: "post", status: "succeeded", channel: "linkedin", view: "linkedin", error: null });
    expect(done.progress).toContain("Checking the post");
    const after = doc();
    expect(validateDocument3(stored()).ok).toBe(true);
    expect(after.views[0]).toEqual(before.views[0]);
    const post = after.views.find((v) => v.id === "linkedin")!;
    expect(post).toMatchObject({ postOf: "overview", caption: { title: "How a request becomes a result" } });
    expect(post.nodes.filter((n) => n.form === "group").map((n) => n.label)).toEqual(["App runtime"]);
    expect(post.edges.filter((e) => e.both)).toHaveLength(1);
    expect(post.edges.filter((e) => e.step !== null).every((e) => e.label === "")).toBe(true);
    expect(after.warnings.slice(before.warnings.length)).toEqual(["Joined result → approval and approval → result into one two-way connection"]);
    // part i shows the fact the overview's part i shows; the facts stay as they were
    expect(stored().channels.linkedin.views[0].nodes.find((n: { id: string }) => n.id === "request").facts).toEqual([before.views[0].nodes[0].id]);
    expect(stored().channels.linkedin.outdated).toEqual([]);
    expect(done.layoutReport).toMatchObject({ view: "linkedin", format: "feed", overLimitText: [], counts: { parts: 6, zones: 1, connections: 5 } });
  });

  it("redesigning keeps the post's id, and a wide post is measured wide", async () => {
    const { run, runs, doc } = await setup();
    await runs.wait((await run("", { kind: "post", view: undefined })).body.runId!);
    const again = (await runs.wait((await run("", { kind: "post", view: "linkedin", format: "linkedin" })).body.runId!))!;
    expect(again).toMatchObject({ status: "succeeded", view: "linkedin" });
    expect(again.layoutReport!.format).toBe("linkedin");
    expect(doc().views.map((v) => v.id)).toEqual(["overview", "linkedin"]);
  });

  it("keeps an over-target label whole and reports it", async () => {
    const { run, runs } = await setup();
    const long = (await runs.wait((await run("[fixture:long]", { kind: "post", view: undefined })).body.runId!))!;
    expect(long.layoutReport!.overLimitText).toContainEqual(expect.objectContaining({ field: "label", text: "A deliberately longer request name", limit: 28 }));
  });

  it("gives a broken answer one repair turn: saved when the second answer is right, failed naming the channel when a relation is still violated", async () => {
    const { run, runs, file, stored } = await setup();
    const fixed = (await runs.wait((await run("[fixture:invalid]", { kind: "post", view: undefined })).body.runId!))!;
    expect(fixed.status).toBe("succeeded");
    const at = fixed.progress.indexOf("Fixing 1 problem in the answer");
    expect(fixed.progress[at - 1]).toBe("Checking the post");
    expect(fixed.progress.slice(at + 1)).toEqual(["Reading the drawing", "Reading the code", "Updating the drawing", "Checking the post", "Saved with 1 warning"]);
    const view = (stored() as Document3).channels.linkedin.views[0];
    expect(view.edges.some((e) => e.to.includes("ghost"))).toBe(false);
    const snapshot = readFileSync(file, "utf8");
    const bad = (await runs.wait((await run("[fixture:invalid] [fixture:stubborn]", { kind: "post", view: undefined })).body.runId!))!;
    expect(bad).toMatchObject({ status: "failed", layoutReport: null });
    expect(bad.error).toBe("The engine's LinkedIn post cannot be drawn: a connection request → ghost names something that is not a part");
    expect(bad.progress.filter((l) => l === "Checking the post")).toHaveLength(2);
    expect(readFileSync(file, "utf8")).toBe(snapshot);
  });

  it("a revise's story gets the repair turn too, with no image and no tools", async () => {
    const t = makeApp({ stepMs: 1 });
    const { file } = shopRepo();
    const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
    const start = async (json: Record<string, unknown>) =>
      (await t.runs.wait(((await (await t.req("/api/runs", { method: "POST", json: { diagramId: id, engine: "fixture", model: null, ...json } })).json()) as { runId: string }).runId))!;
    expect((await start({ kind: "story", channel: "readme" })).status).toBe("succeeded");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const revised = await start({ kind: "revise", channel: "readme", view: "readme", image: png, instruction: "[fixture:overlong]" });
    expect([revised.status, revised.error]).toEqual(["succeeded", null]);
    expect(revised.progress[0]).toBe("Looking at the drawing");
    expect(revised.progress.filter((l) => l.startsWith("Fixing"))).toEqual(["Fixing 1 problem in the answer"]);
    expect((JSON.parse(readFileSync(file, "utf8")) as Document3).channels.readme.views[0].caption.lede).toBe("A detailed drawing made by the test engine.");
  });

  it("an over-long text is rewritten by the repair turn, or shortened with one warning after it", async () => {
    const { run, runs, stored } = await setup();
    const fixed = (await runs.wait((await run("[fixture:overlong]", { kind: "story", channel: "readme", view: undefined })).body.runId!))!;
    expect(fixed.status).toBe("succeeded");
    expect(fixed.progress.filter((l) => l.startsWith("Fixing"))).toEqual(["Fixing 1 problem in the answer"]);
    expect((stored() as Document3).channels.readme.views[0].caption.lede).toBe("A detailed drawing made by the test engine.");
    const kept = (await runs.wait((await run("[fixture:overlong][fixture:stubborn]", { kind: "story", channel: "readme", view: undefined })).body.runId!))!;
    expect(kept.status).toBe("succeeded");
    const doc = stored() as Document3;
    expect(doc.channels.readme.views[0].caption.lede).toBe(OVERLONG_LEDE.slice(0, 239) + "…");
    expect(doc.warnings.filter((w) => w.startsWith("Shortened"))).toEqual(["Shortened the description to 240 characters"]);
  });

  it("refuses a post's wrong scope, format, image or view before any engine", async () => {
    const { run } = await setup();
    expect(await run("", { kind: "post" })).toMatchObject({ status: 400, body: { error: 'Unknown view "overview"' } });
    expect((await run("", { kind: "post", scope: { kind: "all" } })).status).toBe(400);
    expect((await run("", { kind: "post", format: "readme" })).status).toBe(400);
    expect((await run("", { kind: "post", instruction: 3 })).status).toBe(400);
    // An image is for a revise only (api contract, Runs).
    expect(await run("", { kind: "post", view: undefined, image: "iVBORw0KGgo=" })).toMatchObject({ status: 400, body: { error: "An image is for a revise" } });
    expect((await run("")).status).toBe(400);
  });
});

describe("simplify runs (diagram contract, Simplify coverage)", () => {
  it("draws the overview as a map whose detail still shows every fact, and keeps the facts", async () => {
    const { run, runs, stored } = await setup();
    const before = stored();
    const done = await runs.wait((await run("", { kind: "simplify" })).body.runId!);
    expect(done).toMatchObject({ status: "succeeded", error: null });
    const after = stored();
    expect(after.facts).toEqual(before.facts);
    expect(after.channels.overview.views.map((v: { id: string }) => v.id)).toEqual(["overview", "inside-the-system"]);
    expect(after.warnings).toEqual([]);
  });

  it("fails a simplification that loses a fact and leaves the file untouched", async () => {
    const { run, runs, file } = await setup();
    const before = readFileSync(file, "utf8");
    const done = await runs.wait((await run("[fixture:lose]", { kind: "simplify" })).body.runId!);
    expect(done).toMatchObject({ status: "failed", diagramId: null, error: "The simplified drawing loses 1 component: db. Nothing was changed." });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("leaves out a new view nothing links to, with one warning", async () => {
    // The fixture's simplification, plus a view no part of the overview opens.
    class StrayView extends FixtureEngine {
      override async run(req: EngineRunRequest): Promise<unknown> {
        const answer = (await super.run(req)) as { views: { nodes: object[] }[] };
        if (req.simplify) {
          const part = { ...answer.views.at(-1)!.nodes[0], id: "stray-part" };
          answer.views.push({ id: "stray", title: "Stray", caption: { title: "Stray", lede: "" }, nodes: [part], edges: [], relayout: [] } as { nodes: object[] });
        }
        return answer;
      }
    }
    const { run, runs, stored } = await setup(1, [new StrayView(1)]);
    const done = await runs.wait((await run("", { kind: "simplify" })).body.runId!);
    expect(done).toMatchObject({ status: "succeeded", error: null });
    expect(stored().channels.overview.views.map((v: { id: string }) => v.id)).toEqual(["overview", "inside-the-system"]);
    expect(stored().warnings).toEqual(['Left out the new view "stray": no component of the overview links to it']);
  });
});
