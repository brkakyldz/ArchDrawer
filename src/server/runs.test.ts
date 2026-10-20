import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDocument, type DiagramDocument } from "../core/model";
import { makeApp, shopRepo } from "./testkit";

async function setup(stepMs = 1) {
  const t = makeApp({ stepMs });
  const { file } = shopRepo();
  const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
  const run = async (instruction: string, extra: Record<string, unknown> = {}) => {
    const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, view: "overview", instruction, engine: "fixture", model: null, ...extra } });
    return { status: r.status, body: (await r.json()) as { runId?: string; error?: string } };
  };
  const doc = () => JSON.parse(readFileSync(file, "utf8")) as DiagramDocument;
  return { ...t, file, id, run, doc };
}

describe("instruction-box runs", () => {
  it("adds a component through the same pipeline, keeping positions, and reports progress", async () => {
    const { run, runs, doc, id } = await setup();
    const before = doc();
    const { status, body } = await run("add Cache component");
    expect(status).toBe(202);
    const done = await runs.wait(body.runId!);
    expect(done).toMatchObject({ status: "succeeded", diagramId: id, error: null });
    expect(done!.progress).toEqual(["Reading the drawing", "Reading the code", "Updating the drawing", "Checking the drawing", "Saved"]);
    const after = doc();
    expect(validateDocument(after).ok).toBe(true);
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
    expect(after.warnings).toEqual(['Renamed the duplicate id "web" to "web-2"', 'Dropped the connection web → ghost: "ghost" does not exist']);
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
    const after = JSON.parse(readFileSync(file, "utf8"));
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
    expect(text.match(/event: progress/g)).toHaveLength(5);
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
});

describe("post runs", () => {
  it("designs the view's post from the canned intent: postOf, one warning for the reverse pair, the report of the saved view", async () => {
    const { run, runs, doc } = await setup();
    const before = doc();
    const { status, body } = await run("", { kind: "post" });
    expect(status).toBe(202);
    const done = (await runs.wait(body.runId!))!;
    expect(done).toMatchObject({ kind: "post", status: "succeeded", view: "overview-linkedin", error: null });
    expect(done.progress).toContain("Checking the post");
    const after = doc();
    expect(validateDocument(after).ok).toBe(true);
    expect(after.views[0]).toEqual(before.views[0]);
    const post = after.views.find((v) => v.id === "overview-linkedin")!;
    expect(post).toMatchObject({ postOf: "overview", caption: { title: "How a request becomes a result" } });
    expect(post.nodes.filter((n) => n.form === "group").map((n) => n.label)).toEqual(["App runtime"]);
    expect(post.edges.filter((e) => e.both)).toHaveLength(1);
    expect(post.edges.filter((e) => e.step !== null).every((e) => e.label === "")).toBe(true);
    expect(after.warnings.slice(before.warnings.length)).toEqual(["Joined result → approval and approval → result into one two-way connection"]);
    // part i stands for the source's component i
    expect(post.nodes.find((n) => n.label === "Request")!.from).toEqual([before.views[0].nodes[0].id]);
    expect(done.layoutReport).toMatchObject({ view: "overview-linkedin", format: "feed", overLimitText: [], counts: { parts: 6, zones: 1, connections: 5 } });
  });

  it("redesigning keeps the post's id, and a wide post is measured wide", async () => {
    const { run, runs, doc } = await setup();
    await runs.wait((await run("", { kind: "post" })).body.runId!);
    const again = (await runs.wait((await run("", { kind: "post", view: "overview-linkedin", format: "linkedin" })).body.runId!))!;
    expect(again).toMatchObject({ status: "succeeded", view: "overview-linkedin" });
    expect(again.layoutReport!.format).toBe("linkedin");
    expect(doc().views.map((v) => v.id)).toEqual(["overview", "overview-linkedin"]);
  });

  it("keeps an over-target label whole and reports it; an invalid story saves nothing", async () => {
    const { run, runs, file } = await setup();
    const long = (await runs.wait((await run("[fixture:long]", { kind: "post" })).body.runId!))!;
    expect(long.layoutReport!.overLimitText).toContainEqual(expect.objectContaining({ field: "label", text: "A deliberately longer request name", limit: 28 }));
    const snapshot = readFileSync(file, "utf8");
    const bad = (await runs.wait((await run("[fixture:invalid]", { kind: "post" })).body.runId!))!;
    expect(bad).toMatchObject({ status: "failed", layoutReport: null });
    expect(bad.error).toMatch(/ghost/);
    expect(readFileSync(file, "utf8")).toBe(snapshot);
  });

  it("refuses a post's wrong scope, format or revision before any engine", async () => {
    const { run } = await setup();
    expect((await run("", { kind: "post", scope: { kind: "all" } })).status).toBe(400);
    expect((await run("", { kind: "post", format: "readme" })).status).toBe(400);
    expect((await run("", { kind: "post", instruction: 3 })).status).toBe(400);
    expect((await run("", { kind: "post", revise: true })).status).toBe(400);
    expect((await run("", { kind: "post", revise: "no" })).status).toBe(400);
    expect((await run("")).status).toBe(400);
  });
});
