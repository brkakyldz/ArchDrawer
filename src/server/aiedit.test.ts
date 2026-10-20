import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { joinDrawing } from "../core/drawing";
import { layoutRects } from "../core/geometry";
import type { DiagramDocument } from "../core/model";
import { BUILD } from "./config";
import { claudeModels } from "./engines/claude";
import { codexModels } from "./engines/codex";
import { fixtureAnswer, FixtureEngine } from "./engines/fixture";
import type { Engine, EngineInfo, EngineRunRequest } from "./engines/types";
import { makeApp, shopRepo } from "./testkit";

/** A stand-in for a real engine (Claude Code or Codex) that answers like the fixture. */
class FakeReal implements Engine {
  constructor(readonly id: string, readonly label: string, private readonly available = true) {}
  async detect(): Promise<EngineInfo> { return { id: this.id, label: this.label, available: this.available, version: "1", detail: "", test: false, models: [] }; }
  async run(req: EngineRunRequest): Promise<unknown> { return fixtureAnswer(req.base, req.view, req.instruction); }
}

async function setup(engines?: Engine[], engine: { id: string; model: null } | null = null) {
  const t = makeApp({ engines, stepMs: 1 });
  const { file } = shopRepo();
  if (engine) {
    const f = JSON.parse(readFileSync(file, "utf8"));
    f.engine = engine;
    (await import("node:fs")).writeFileSync(file, JSON.stringify(f));
  }
  const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
  const run = async (instruction: string, extra: Record<string, unknown> = {}) => {
    const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, view: "overview", instruction, engine: "fixture", model: null, ...extra } });
    const body = (await r.json()) as { runId?: string; error?: string };
    return { status: r.status, body, done: body.runId ? await t.runs.wait(body.runId) : null };
  };
  const doc = (): DiagramDocument => joinDrawing(JSON.parse(readFileSync(file, "utf8")));
  const stored = () => JSON.parse(readFileSync(file, "utf8"));
  return { ...t, file, id, run, doc, stored };
}

describe("engines say what they are and which models they offer", () => {
  it("lists the fixture as a test engine with its two models", async () => {
    const { req } = await setup();
    const { engines } = (await (await req("/api/engines")).json()) as { engines: EngineInfo[] };
    expect(engines).toEqual([expect.objectContaining({ id: "fixture", test: true, models: [{ id: "fixture-fast", label: "Fast (test)" }, { id: "fixture-careful", label: "Careful (test)" }] })]);
  });

  it("reads Claude Code's model aliases from its help", () => {
    const help = "  --fallback-model <model>  Enable fallback\n  --model <model>                       Model for the current session. Provide\n                                        an alias for the latest model (e.g.\n                                        'fable', 'opus', or 'sonnet') or a\n                                        model's full name.\n  -n, --name <name>  Set a name";
    expect(claudeModels(help)).toEqual([{ id: "fable", label: "Fable" }, { id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }]);
    expect(claudeModels("no such flag")).toEqual([]);
  });

  it("reads Codex's visible models by priority", () => {
    const json = JSON.stringify({ models: [
      { slug: "gpt-b", display_name: "GPT-B", visibility: "list", priority: 3 },
      { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide", priority: 1 },
      { slug: "gpt-a", display_name: "GPT-A", visibility: "list", priority: 1 },
    ] });
    expect(codexModels(json)).toEqual([{ id: "gpt-a", label: "GPT-A" }, { id: "gpt-b", label: "GPT-B" }]);
    expect(codexModels("not json")).toEqual([]);
    expect(codexModels("{}")).toEqual([]);
  });
});

describe("engine: null never picks the fixture over a real engine", () => {
  const chosen = async (engines: Engine[], remembered: { id: string; model: null } | null) => {
    const t = await setup(engines, remembered);
    const r = await t.run("add Cache", { engine: null });
    expect(r.status).toBe(202);
    return r.done!.engine;
  };
  it("takes the first real engine when the drawing remembers the fixture", async () => {
    expect(await chosen([new FixtureEngine(1), new FakeReal("claude", "Claude Code")], { id: "fixture", model: null })).toBe("claude");
  });
  it("takes the drawing's own engine when it is real and available", async () => {
    expect(await chosen([new FixtureEngine(1), new FakeReal("claude", "Claude Code"), new FakeReal("codex", "Codex")], { id: "codex", model: null })).toBe("codex");
  });
  it("skips an unavailable remembered engine for another real one", async () => {
    expect(await chosen([new FixtureEngine(1), new FakeReal("codex", "Codex", false), new FakeReal("claude", "Claude Code")], { id: "codex", model: null })).toBe("claude");
  });
  it("takes the fixture only when it is the only engine offered", async () => {
    expect(await chosen([new FixtureEngine(1), new FakeReal("claude", "Claude Code", false)], null)).toBe("fixture");
  });
});

describe("runs move components, respect the scope and report what changed", () => {
  it("records the model, says it in the progress and in the document", async () => {
    const { run, doc } = await setup();
    const { done } = await run("add Cache", { model: "fixture-fast" });
    expect(done).toMatchObject({ status: "succeeded", engine: "fixture", model: "fixture-fast" });
    expect(done!.progress[0]).toBe("Using model fixture-fast");
    expect(doc().engine).toEqual({ id: "fixture", model: "fixture-fast" });
    expect(done!.changes).toMatchObject({ added: ["cache"], removed: [], changed: [], moved: [], edgesAdded: [expect.any(String)] });
  });

  it("moves only the component named, beside the other one", async () => {
    const { run, doc } = await setup();
    const before = doc();
    const api = layoutRects(before.views[0]).get("api")!;
    const { done } = await run("move Orders DB right of Order API", { scope: { kind: "view" } });
    const after = doc();
    expect(after.views[0].nodes.find((n) => n.id === "db")).toMatchObject({ x: Math.round((api.x + api.w + 64) / 8) * 8, y: Math.round(api.y / 8) * 8 });
    for (const id of ["web", "api"]) expect(after.views[0].nodes.find((n) => n.id === id)).toMatchObject(before.views[0].nodes.find((n) => n.id === id)!);
    expect(done!.changes).toMatchObject({ moved: ["db"], added: [], changed: [] });
  });

  it("aligns tops, and ignores a move outside a parts scope with one warning", async () => {
    const { run, doc } = await setup();
    const before = doc();
    const kept = await run("move Orders DB right of Order API", { scope: { kind: "parts", ids: ["api"] } });
    expect(kept.done!.changes!.moved).toEqual([]);
    expect(doc().views[0].nodes.find((n) => n.id === "db")).toMatchObject({ x: before.views[0].nodes[2].x, y: before.views[0].nodes[2].y });
    expect(doc().warnings).toEqual(['Kept "Orders DB" as it was: it is outside the selected parts']);
    const aligned = await run("align Web app with Orders DB", { scope: { kind: "parts", ids: ["web"] } });
    expect(aligned.done!.changes!.moved).toEqual(["web"]);
    expect(doc().views[0].nodes.find((n) => n.id === "web")).toMatchObject({ x: before.views[0].nodes[0].x, y: Math.round(before.views[0].nodes[2].y / 8) * 8 });
  });

  it("refuses a malformed scope or a part that is not in the view", async () => {
    const { run } = await setup();
    expect((await run("x", { scope: { kind: "everything" } })).status).toBe(400);
    expect((await run("x", { scope: { kind: "parts", ids: [] } })).status).toBe(400);
    expect((await run("x", { model: 123 })).status).toBe(400);
    expect((await run("x", { engine: 7 })).status).toBe(400);
    const missing = await run("x", { scope: { kind: "parts", ids: ["ghost"] } });
    expect(missing).toMatchObject({ status: 400, body: { error: 'The component "ghost" is not in this view' } });
  });
});

describe("health and the example", () => {
  it("health names the build this process runs", async () => {
    const { req } = await setup();
    expect(await (await req("/api/health")).json()).toMatchObject({ ok: true, app: "archdrawer", build: BUILD });
    expect(BUILD).toMatch(/^[0-9a-f]{16}$/);
  });

  it("imports the bundled example as a new document each time", async () => {
    const { req } = await setup();
    const a = await req("/api/example", { method: "POST" });
    expect(a.status).toBe(201);
    const { id } = (await a.json()) as { id: string };
    expect(((await (await req(`/api/diagrams/${id}`)).json()) as DiagramDocument).title).toBe("Sample Shop");
    const b = (await (await req("/api/example", { method: "POST" })).json()) as { id: string };
    expect(b.id).not.toBe(id);
    expect((await req("/api/example", { method: "POST", token: null })).status).toBe(403);
  });
});
