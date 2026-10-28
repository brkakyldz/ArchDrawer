import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocument3 } from "../core/file3";
import { DrawError, writeNewDrawing } from "./draw";
import { repoRootOf } from "./files";
import { FixtureEngine } from "./engines/fixture";
import { EngineError, type Engine } from "./engines/types";
import { makeApp, makeFolder, tempDir } from "./testkit";
import { choiceDoc, type Document4 } from "../core/file4";
import { ClaudeEngine } from "./engines/claude";

// The draw run (api contract, The draw run): what the held-out scenarios H117–H120 do not observe —
// the write's own failure paths, the temporary file, the root of a folder outside git, the event stages.

const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const g = (dir: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
const agentFiles = { "src/agent.ts": "export const agent = 1;\n", "src/app.ts": "export const app = 1;\n" };
function repo(files: Record<string, string> = agentFiles) {
  const dir = makeFolder(files);
  g(dir, "init", "-q"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "one");
  return dir;
}
const FOUR = [
  "ghost: dropped the evidence fixture/ghost.ts: not found",
  'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped',
  'Dropped "ghost-limit": its component "ghost" was dropped',
];

async function draw(t: ReturnType<typeof makeApp>, folder: string, body: Record<string, unknown> = {}) {
  const s = await json(await t.req("/api/scans", { method: "POST", json: { folder } }));
  await t.scans.wait(s.body.scanId);
  const r = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan: s.body.scanId, focus: { kind: "whole" }, channel: "readme", ...body } }));
  expect(r.status).toBe(202);
  return (await t.runs.wait(r.body.runId))!;
}

/** A finished run's progress lines with their stages, replayed. */
function linesOf(t: ReturnType<typeof makeApp>, id: string) {
  const out: { message: string; stage: string | null }[] = [];
  t.runs.subscribe(id, (e) => { if (e.type === "progress") out.push({ message: e.message, stage: e.stage }); });
  return out;
}

/** A folder as the server resolves it: the disk's own letter case, Windows short names (RUNNER~1) expanded. */
const real = (p: string) => realpathSync.native(p);

describe("the draw run", () => {
  it("writes a new drawing under the folder, registers it, and draws every fact in the overview's map and detail views", async () => {
    const dir = real(repo());
    const t = makeApp();
    const events: { message: string; stage: string | null }[] = [];
    const run = await draw(t, dir);
    expect([run.status, run.error]).toEqual(["succeeded", null]);
    expect(run.path).toBe(join(dir, "docs", "architecture.archdraw.json"));
    const doc = choiceDoc(t.store.get(run.diagramId!)!);
    expect(validateDocument3(doc).ok).toBe(true);
    expect([doc.source?.path, doc.warnings.slice(0, 4)]).toEqual([dir, FOUR]);
    const drawn = new Set(doc.channels.overview.views.flatMap((v) => v.nodes.flatMap((p) => [...p.facts, ...(p.held ?? [])])));
    expect([...drawn].sort()).toEqual(doc.facts.components.map((c) => c.id).sort());
    expect(doc.channels.readme.views).toHaveLength(1);
    expect([run.channel, run.view, run.layoutReport?.channel]).toEqual(["readme", "readme", "readme"]);
    expect(run.changes!.added.length).toBe(doc.channels.readme.views[0].nodes.length);
    // Stages: the read's lines, then the overview's, then the channel's (api contract, Progress).
    t.runs.subscribe(run.id, (e) => { if (e.type === "progress") events.push({ message: e.message, stage: e.stage }); });
    const stageOf = (m: string) => events.find((e) => e.message === m)?.stage;
    expect([stageOf("Checking the facts"), stageOf("Drawing the overview"), stageOf("Drawing the README drawing"), stageOf("Checking the drawing")]).toEqual(["read", "overview", "channel", "channel"]);
    expect(readdirSync(join(dir, "docs"))).toEqual(["architecture.archdraw.json"]);
  });

  it("draws the whole system as a map: the zone is a card whose inside is a detail view, and the channel is told from both (#183)", async () => {
    const t = makeApp();
    const run = await draw(t, real(repo()), { channel: "presentation" });
    expect(run.status).toBe("succeeded");
    const doc = choiceDoc(t.store.get(run.diagramId!)!);
    const [map, inside, ...more] = doc.channels.overview.views;
    expect([map.id, inside.id, more.length]).toEqual(["overview", "zone-runtime-inside", 0]);
    expect(map.nodes.map((n) => n.id).sort()).toEqual(["app", "zone-runtime"]);
    expect(map.nodes.find((n) => n.id === "zone-runtime")).toMatchObject({ facts: [], form: "card", label: "Agent runtime", kind: "service", description: "A group of components.", detail: "zone-runtime-inside", parent: null, lane: { spine: 1 } });
    expect(map.edges.map((e) => [e.id, e.from, e.to, e.step, e.relations])).toEqual([["app-zone-runtime", "app", "zone-runtime", 1, []]]);
    expect(inside).toMatchObject({ title: "Agent runtime", caption: { title: "Agent runtime", lede: "" }, texts: [] });
    expect(inside.nodes.map((n) => [n.id, n.parent]).sort()).toEqual([["agent", null], ["store", null]]);
    expect(inside.edges.map((e) => [e.from, e.to])).toEqual([["agent", "store"]]);
    // The presentation is told from the map's parts and the detail view's, the card with an inside skipped.
    expect(doc.channels.presentation.views[0].nodes.map((n) => n.id).sort()).toEqual(["agent", "app", "store"]);
    // The split adds no warning: the four evidence warnings and the fixture's step about nothing are all.
    expect(doc.warnings).toEqual([...FOUR, "Step 4 names no part and was dropped"]);
  });

  it("asks the whole system's overview for the map and a typed focus's for the complete overview (#183)", async () => {
    const asked: string[] = [];
    const fixture = new FixtureEngine(1);
    const spy: Engine = Object.assign(Object.create(Object.getPrototypeOf(fixture)), fixture, {
      run: (a: Parameters<Engine["run"]>[0]) => { if (a.task?.data?.draw === "overview") asked.push(a.task.prompt); return fixture.run(a); },
    });
    const t = makeApp({ engines: [spy] });
    expect((await draw(t, repo())).status).toBe("succeeded");
    expect((await draw(t, repo(), { focus: { kind: "typed", text: "The agent" } })).status).toBe("succeeded");
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/as the map of the whole system: its main groups only, about 5 to 9 top-level parts/);
    expect(asked[1]).toMatch(/as the overview: the complete map of the system/);
    expect(asked[1]).not.toMatch(/about 5 to 9 top-level parts/);
  });

  it("roots a drawing of a folder outside git at that folder, also when the file is opened again", async () => {
    const dir = real(makeFolder(agentFiles));
    const t = makeApp();
    const run = await draw(t, dir, { channel: "linkedin" });
    expect(run.status).toBe("succeeded");
    expect(t.store.rootOf(run.diagramId!)).toBe(dir);
    const again = await json(await t.req("/api/files", { method: "POST", json: { path: run.path } }));
    expect(t.store.get(again.body.id)!.source?.path).toBe(dir);
    // Its facts' evidence was checked against the folder, so no path of theirs is missing.
    expect((await json(await t.req(`/api/diagrams/${again.body.id}/check-files`, { method: "POST", json: { files: ["src/agent.ts", "src/app.ts"] } }))).body.missing).toEqual([]);
  });

  it("an empty or stray .git above a folder does not widen its root (the engine reads only the folder)", async () => {
    const outer = real(makeFolder({ "other/secret.txt": "x\n" }));
    mkdirSync(join(outer, ".git"));
    const dir = join(outer, "project");
    for (const [rel, text] of Object.entries(agentFiles)) { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), text); }
    const t = makeApp();
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: dir } }))).body).toMatchObject({ root: dir, git: false });
    const run = await draw(t, dir);
    expect([run.status, t.store.rootOf(run.diagramId!)]).toEqual(["succeeded", dir]);
    // A .git file naming a git folder (a worktree) still marks a root.
    const wt = real(makeFolder({ "a.ts": "x\n" }));
    mkdirSync(join(wt, "gitdir"));
    writeFileSync(join(wt, ".git"), `gitdir: ${join(wt, "gitdir")}\n`);
    mkdirSync(join(wt, "sub"));
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: join(wt, "sub") } }))).body.root).toBe(wt);
  });

  it("an over-long overview answer gets one repair turn in the overview stage", async () => {
    const dir = repo();
    const t = makeApp();
    const run = await draw(t, dir, { focus: { kind: "typed", text: "The agent [fixture:overlong]" } });
    expect(run.status).toBe("succeeded");
    const events = linesOf(t, run.id);
    const at = events.findIndex((e) => e.message === "Fixing 1 problem in the answer");
    expect(events[at].stage).toBe("overview");
    expect(events.slice(at + 1, at + 4)).toEqual(["Reading the drawing", "Reading the code", "Updating the drawing"].map((message) => ({ message, stage: "overview" })));
    expect(events.filter((e) => e.message.startsWith("Fixing"))).toHaveLength(1);
    const doc = choiceDoc(t.store.get(run.diagramId!)!);
    expect(doc.channels.overview.views[0].caption.lede).toBe("Drawn by the test engine.");
    expect(doc.warnings.some((w) => w.startsWith("Shortened"))).toBe(false);
  });

  it("a draw that failed after its read starts again from the stage that did not finish, with the warnings of a draw that never failed", async () => {
    const dir = repo();
    const t = makeApp();
    const s = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    await t.scans.wait(s.body.scanId);
    const start = async (focus: string, channel = "readme") => {
      const r = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan: s.body.scanId, focus: { kind: "typed", text: focus }, channel } }));
      return (await t.runs.wait(r.body.runId))!;
    };
    const failed = await start("The agent [fixture:flaky:channel]");
    expect([failed.status, failed.error, existsSync(join(dir, "docs"))]).toEqual(["failed", "Fixture failure requested", false]);
    // The channel may differ; the read and the overview are used again with no call.
    const again = await start("The agent [fixture:flaky:channel]", "presentation");
    expect(again.status).toBe("succeeded");
    const lines = linesOf(t, again.id);
    expect(lines.filter((e) => e.stage === "read" || e.stage === "overview")).toEqual([
      { message: 'Drawing "The agent [fixture:flaky:channel]" (1 of 1)', stage: "read" },
      { message: "Using the facts already read", stage: "read" }, { message: "Checking the facts", stage: "read" },
      { message: "Drawing the overview", stage: "overview" }, { message: "Using the overview already drawn", stage: "overview" },
    ]);
    const clean = await draw(t, repo(), { focus: { kind: "typed", text: "The agent" }, channel: "presentation" });
    const [doc, control] = [choiceDoc(t.store.get(again.diagramId!)!), choiceDoc(t.store.get(clean.diagramId!)!)];
    expect(doc.warnings).toEqual(control.warnings);
    const shape = (d: typeof doc) => ({ nodes: d.channels.overview.views[0].nodes, edges: d.channels.overview.views[0].edges });
    expect(shape(doc)).toEqual(shape(control));
    // A success removes what was kept: the next draw reads again.
    const third = await start("The agent [fixture:flaky:channel]");
    expect(linesOf(t, third.id)[1]).not.toEqual({ message: "Using the facts already read", stage: "read" });
  });

  it("a cancelled draw keeps only the stages it finished", async () => {
    // A fixture that waits in one stage until the run is cancelled, then answers as usual.
    let hang: string | null = "overview";
    class Hanging extends FixtureEngine {
      override run(req: Parameters<FixtureEngine["run"]>[0]) {
        if (req.task?.data?.draw !== hang) return super.run(req);
        return new Promise<unknown>((_, reject) => req.signal.addEventListener("abort", () => reject(new EngineError("Cancelled")), { once: true }));
      }
    }
    const dir = repo();
    const t = makeApp({ engines: [new Hanging(1)] });
    const s = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    await t.scans.wait(s.body.scanId);
    const start = async () => (await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan: s.body.scanId, focus: { kind: "whole" }, channel: "readme" } }))).body.runId as string;
    const cancelled = async () => {
      const id = await start();
      for (let i = 0; i < 200 && !t.runs.get(id)!.progress.includes(hang === "overview" ? "Drawing the overview" : "Drawing the README drawing"); i++) await new Promise((r) => setTimeout(r, 10));
      t.runs.cancel(id);
      expect((await t.runs.wait(id))!.status).toBe("cancelled");
    };
    await cancelled(); // in the overview: the read is kept, no overview
    hang = "channel";
    await cancelled(); // in the channel, from the kept read: now the overview is kept too
    hang = null;
    const id = await start();
    const done = (await t.runs.wait(id))!;
    expect(done.status).toBe("succeeded");
    expect(done.progress.slice(0, 5)).toEqual(['Drawing "The whole system" (1 of 1)', "Using the facts already read", "Checking the facts", "Drawing the overview", "Using the overview already drawn"]);
  });

  it("a kept read is checked again: a cited file gone since drops its facts, and the overview is drawn again", async () => {
    const dir = repo();
    const t = makeApp();
    const s = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    await t.scans.wait(s.body.scanId);
    const start = async (focus: string) => {
      const r = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan: s.body.scanId, focus: { kind: "typed", text: focus }, channel: "readme" } }));
      return (await t.runs.wait(r.body.runId))!;
    };
    const failed = await start("The agent [fixture:flaky:channel]");
    expect(failed.status).toBe("failed");
    unlinkSync(join(dir, "src/agent.ts"));
    const again = await start("The agent [fixture:flaky:channel]");
    expect(again.status).toBe("succeeded");
    const lines = linesOf(t, again.id).map((e) => e.message);
    expect(lines.slice(0, 4)).toEqual(['Drawing "The agent [fixture:flaky:channel]" (1 of 1)', "Using the facts already read", "Checking the facts", "Drawing the overview"]);
    expect(lines).not.toContain("Using the overview already drawn");
    const doc = choiceDoc(t.store.get(again.diagramId!)!);
    expect(JSON.stringify(doc.facts)).not.toContain("src/agent.ts");
    expect(doc.warnings.some((w) => w.includes("src/agent.ts"))).toBe(true);
    // Another focus is another request: it reads again.
    const other = await start("Something else [fixture:flaky:channel]");
    expect(linesOf(t, other.id).map((e) => e.message)).not.toContain("Using the facts already read");
  });

  it("a failure at any stage writes nothing and leaves no docs folder", async () => {
    for (const marker of ["[fixture:fail]", "[fixture:fail:overview]", "[fixture:fail:channel]"]) {
      const dir = repo();
      const t = makeApp();
      const run = await draw(t, dir, { focus: { kind: "typed", text: `The agent ${marker}` } });
      expect([marker, run.status, run.path, run.diagramId]).toEqual([marker, "failed", null, null]);
      expect(existsSync(join(dir, "docs"))).toBe(false);
      expect((await json(await t.req("/api/diagrams"))).body.diagrams).toEqual([]);
    }
  });

  it("keeps the latest finished scan of a folder for a draw, and forgets an earlier one", async () => {
    const dir = repo();
    const t = makeApp();
    const scan = async (refresh: boolean) => {
      const s = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir, refresh } }));
      await t.scans.wait(s.body.scanId);
      return s.body.scanId as string;
    };
    const first = await scan(false), second = await scan(true);
    expect([t.scans.get(first), t.scans.get(second)?.status]).toEqual([null, "succeeded"]);
    // A refresh that fails leaves the scan a draw can follow.
    const fixture = new FixtureEngine(1);
    let calls = 0;
    const flaky: Engine = { id: "fixture", label: "Fixture (test)", detect: () => fixture.detect(), run: async (r) => { if (calls++) throw new EngineError("down"); return fixture.run(r); } };
    const f = makeApp({ engines: [flaky] });
    const ok = await json(await f.req("/api/scans", { method: "POST", json: { folder: dir, refresh: true } }));
    await f.scans.wait(ok.body.scanId);
    const failed = await json(await f.req("/api/scans", { method: "POST", json: { folder: dir, refresh: true } }));
    await f.scans.wait(failed.body.scanId);
    expect([f.scans.get(ok.body.scanId)?.status, f.scans.get(failed.body.scanId)?.status]).toEqual(["succeeded", "failed"]);
    // A later failure forgets the earlier failure, never the success.
    const again = await json(await f.req("/api/scans", { method: "POST", json: { folder: dir, refresh: true } }));
    await f.scans.wait(again.body.scanId);
    expect([f.scans.get(ok.body.scanId)?.status, f.scans.get(failed.body.scanId), f.scans.get(again.body.scanId)?.status]).toEqual(["succeeded", null, "failed"]);
  });

  it("refuses a second draw of a folder while one runs", async () => {
    const dir = repo();
    const t = makeApp({ stepMs: 40 });
    const s = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    await t.scans.wait(s.body.scanId);
    const body = { kind: "draw", scan: s.body.scanId, focus: { kind: "whole" }, channel: "readme" };
    const first = await json(await t.req("/api/runs", { method: "POST", json: body }));
    const second = await json(await t.req("/api/runs", { method: "POST", json: body }));
    expect([first.status, second.status, second.body.error]).toEqual([202, 409, "A drawing of this folder is already being made"]);
    await t.runs.wait(first.body.runId);
  });
});

// Several choices in one draw (#181; api contract, The draw run, What a failed draw keeps, Run record).
describe("a draw of several choices", () => {
  const scanOf = async (t: ReturnType<typeof makeApp>, folder: string) => {
    const s = await json(await t.req("/api/scans", { method: "POST", json: { folder } }));
    await t.scans.wait(s.body.scanId);
    return s.body.scanId as string;
  };
  const start = async (t: ReturnType<typeof makeApp>, scan: string, choices: unknown[], channel = "readme", extra: object = {}) =>
    json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, choices, channel, ...extra } }));

  it("two choices give one run, with lines that name their choice, and one file holding both", async () => {
    const dir = real(repo());
    const t = makeApp();
    const scan = await scanOf(t, dir);
    const r = await start(t, scan, [{ kind: "whole" }, { kind: "typed", text: "How a tool runs" }]);
    expect(r.status).toBe(202);
    expect(t.runs.get(r.body.runId)!.choices!.map((c) => [c.id, c.kind, c.title])).toEqual([["system", "system", "The whole system"], ["how-a-tool-runs", "custom", "How a tool runs"]]);
    const events: { message: string; stage: string | null; choice: string | null }[] = [];
    const run = (await t.runs.wait(r.body.runId))!;
    t.runs.subscribe(run.id, (e) => { if (e.type === "progress") events.push({ message: e.message, stage: e.stage, choice: e.choice }); });
    expect([run.status, run.error, run.choice, run.view]).toEqual(["succeeded", null, "system", "readme"]);
    expect(run.choices!.map((c) => [c.id, c.status, c.stage])).toEqual([["system", "done", "channel"], ["how-a-tool-runs", "done", "channel"]]);
    // Every line names its choice, but the two of the write (api contract, The draw run).
    expect(events.filter((e) => e.choice === null).map((e) => [e.message, e.stage])).toEqual([["Writing the drawing", null], [expect.stringMatching(/^Saved/), null]]);
    expect(events.every((e) => e.choice === null || e.choice === "system" || e.choice === "how-a-tool-runs")).toBe(true);
    expect(events.filter((e) => e.message.startsWith("Drawing \"")).map((e) => [e.message, e.choice])).toEqual([
      ['Drawing "The whole system" (1 of 2)', "system"], ['Drawing "How a tool runs" (2 of 2)', "how-a-tool-runs"],
    ]);
    const file = JSON.parse(readFileSync(run.path!, "utf8")) as Document4;
    expect(file.schema).toBe("archdraw/diagram@4");
    expect(file.choices.map((c) => c.id)).toEqual(["system", "how-a-tool-runs"]);
    // View ids are unique across the file: the second choice's take its id.
    expect(file.choices[1].channels.overview.views.map((v) => v.id)).toEqual(["how-a-tool-runs-overview"]);
    expect(file.choices[1].channels.readme.views.map((v) => v.id)).toEqual(["how-a-tool-runs-readme"]);
    expect(file.choices[0].channels.overview.views.map((v) => v.id)).toEqual(["overview", "zone-runtime-inside"]);
    // Each choice's warnings start with its title.
    expect(file.warnings.slice(0, 4)).toEqual(FOUR.map((w) => `The whole system: ${w}`));
    expect(file.warnings.every((w) => w.startsWith("The whole system: ") || w.startsWith("How a tool runs: "))).toBe(true);
  });

  it("a failure in the second choice ends it alone: the file holds the first, and Try again draws the second into that file", async () => {
    const dir = real(repo());
    const t = makeApp();
    const scan = await scanOf(t, dir);
    const choices = [{ kind: "whole" }, { kind: "typed", text: "Notes [fixture:flaky:second]" }];
    const first = (await t.runs.wait((await start(t, scan, choices, "linkedin")).body.runId))!;
    expect([first.status, first.error, first.path]).toEqual(["succeeded", null, join(dir, "docs", "architecture.archdraw.json")]);
    expect(first.choices!.map((c) => [c.status, c.stage, c.error])).toEqual([["done", "channel", null], ["failed", "read", "Fixture failure requested"]]);
    const lines: { message: string; choice: string | null; stage: string | null }[] = [];
    t.runs.subscribe(first.id, (e) => { if (e.type === "progress") lines.push({ message: e.message, choice: e.choice, stage: e.stage }); });
    expect(lines).toContainEqual({ message: 'Could not draw "Notes [fixture:flaky:second]": Fixture failure requested', choice: "notes-fixture-flaky-second", stage: "read" });
    expect((JSON.parse(readFileSync(first.path!, "utf8")) as Document4).choices.map((c) => c.id)).toEqual(["system"]);
    // Try again: the failed choice only, into the file the draw wrote (the second read answers this time).
    const retried = await json(await t.req(`/api/runs/${first.id}/retry`, { method: "POST" }));
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    const again = (await t.runs.wait(retried.body.runId))!;
    expect([again.status, again.diagramId, again.path, again.into, again.retryOf, again.choice]).toEqual(["succeeded", first.diagramId, first.path, first.diagramId, first.id, "notes-fixture-flaky-second"]);
    const file = JSON.parse(readFileSync(first.path!, "utf8")) as Document4;
    expect(file.choices.map((c) => c.id)).toEqual(["system", "notes-fixture-flaky-second"]);
    expect(file.choices[1].channels.linkedin.views.map((v) => v.id)).toEqual(["notes-fixture-flaky-second-linkedin"]);
    expect(readdirSync(join(dir, "docs"))).toEqual(["architecture.archdraw.json"]);
    // Nothing is left to try.
    expect(await json(await t.req(`/api/runs/${again.id}/retry`, { method: "POST" }))).toEqual({ status: 400, body: { error: "Every choice of this draw was drawn" } });
  });

  it("a choice kept by a draw that wrote nothing is put where a later draw places it: its views take that place's ids", async () => {
    const dir = real(repo());
    const t = makeApp();
    const scan = await scanOf(t, dir);
    const notes = { kind: "typed", text: "Notes [fixture:flaky:channel]" };
    const alone = (await t.runs.wait((await start(t, scan, [notes], "linkedin")).body.runId))!;
    expect([alone.status, alone.error]).toEqual(["failed", "Fixture failure requested"]);
    const moved = (await t.runs.wait((await start(t, scan, [{ kind: "whole" }, notes], "linkedin")).body.runId))!;
    expect(moved.status).toBe("succeeded");
    const lines: { message: string; choice: string | null }[] = [];
    t.runs.subscribe(moved.id, (e) => { if (e.type === "progress") lines.push({ message: e.message, choice: e.choice }); });
    expect(lines.filter((l) => l.choice === "notes-fixture-flaky-channel").map((l) => l.message)).toEqual(expect.arrayContaining(["Using the facts already read", "Using the overview already drawn"]));
    const file = JSON.parse(readFileSync(moved.path!, "utf8")) as Document4;
    expect(file.choices[1].channels.overview.views.map((v) => v.id)).toEqual(["notes-fixture-flaky-channel-overview"]);
    expect(file.choices[1].channels.linkedin.views.map((v) => v.id)).toEqual(["notes-fixture-flaky-channel-linkedin"]);
  });

  it("cancel in the second choice stops its engine's whole process tree, keeps the first done and writes nothing", async () => {
    const fake = fakeCli("hang");
    const claude = new ClaudeEngine({ ...process.env, ARCHDRAW_CLAUDE_BIN: fake.bin });
    const fixture = new FixtureEngine(1);
    // The first choice through the fixture, the second through a Claude Code that hangs with a child.
    const mixed: Engine = { id: "claude", label: "Claude Code", detect: () => claude.detect(), run: (req) => (req.task?.data?.choiceIndex === 1 ? claude.run(req) : fixture.run(req)) };
    const dir = real(repo());
    const t = makeApp({ engines: [mixed, fixture] });
    const scan = await scanOf(t, dir);
    const r = await start(t, scan, [{ kind: "whole" }, { kind: "typed", text: "Second" }], "readme", { engine: "claude" });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    for (let i = 0; i < 200 && !existsSync(fake.log + ".child"); i++) await new Promise((res) => setTimeout(res, 50));
    const child = Number(readFileSync(fake.log + ".child", "utf8"));
    // Side by side: the first finishes while the second's engine hangs.
    for (let i = 0; i < 200 && t.runs.get(r.body.runId)!.choices![0].status !== "done"; i++) await new Promise((res) => setTimeout(res, 50));
    expect(t.runs.get(r.body.runId)!.choices!.map((c) => c.status)).toEqual(["done", "running"]);
    t.runs.cancel(r.body.runId);
    const run = (await t.runs.wait(r.body.runId))!;
    expect([run.status, run.path, run.diagramId]).toEqual(["cancelled", null, null]);
    expect(run.choices!.map((c) => [c.status, c.stage])).toEqual([["done", "channel"], ["cancelled", "read"]]);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 20 && alive(child); i++) await new Promise((res) => setTimeout(res, 50));
    expect(alive(child)).toBe(false);
    expect(existsSync(join(dir, "docs"))).toBe(false);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 0, waiting: 0 });
  });

  it("each choice has its own deadline from taking its slot: waiting counts toward none, and a choice past its own ends alone", async () => {
    // No race against the clock: the only real wait is one while nothing runs, and a slower machine only makes it longer.
    const DEADLINE = 2500;
    const hangs = (index: number) => new (class extends FixtureEngine {
      override async run(req: Parameters<FixtureEngine["run"]>[0]) {
        if (req.task?.data?.choiceIndex === index) {
          await new Promise<void>((resolve) => { if (req.signal.aborted) resolve(); else req.signal.addEventListener("abort", () => resolve(), { once: true }); });
        }
        return super.run(req);
      }
    })(1);
    const app = async (engine: FixtureEngine, slots: number) => {
      const t = makeApp({ engines: [engine], timeoutMs: DEADLINE, slots });
      return { t, scan: await scanOf(t, real(repo())) };
    };
    const draw2 = async (t: ReturnType<typeof makeApp>, scan: string) =>
      (await start(t, scan, [{ kind: "whole" }, { kind: "typed", text: "Second" }])).body.runId as string;
    // The test holds the only slot for longer than the deadline; both choices wait, then finish.
    const one = await app(new FixtureEngine(1), 1);
    const held = await one.t.slots.take(new AbortController().signal);
    const waiting = await draw2(one.t, one.scan);
    await new Promise((r) => setTimeout(r, DEADLINE + 500));
    expect(one.t.runs.get(waiting)!.choices!.map((c) => c.status)).toEqual(["waiting", "waiting"]);
    held.release();
    const both = (await one.t.runs.wait(waiting))!;
    expect([both.status, both.error, both.choices!.map((c) => c.error)]).toEqual(["succeeded", null, [null, null]]);
    expect(Date.parse(both.choices![1].endedAt!) - Date.parse(both.createdAt)).toBeGreaterThan(DEADLINE);
    // A choice that never answers fails alone at its deadline; the file holds the other.
    const three = await app(hangs(1), 3);
    const late = (await three.t.runs.wait(await draw2(three.t, three.scan)))!;
    expect(late.status).toBe("succeeded");
    expect(late.choices!.map((c) => [c.status, c.error])).toEqual([["done", null], ["failed", "Timed out after 1 min — try a narrower instruction"]]);
    expect((JSON.parse(readFileSync(late.path!, "utf8")) as Document4).choices.map((c) => c.id)).toEqual(["system"]);
  }, 30_000);

  it("refuses a list of choices in the contracted order", async () => {
    const dir = real(repo());
    const t = makeApp();
    const scan = await scanOf(t, dir);
    const refused = async (body: object) => { const r = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, channel: "readme", ...body } })); return [r.status, r.body.error]; };
    expect(await refused({ choices: [{ kind: "whole" }], focus: { kind: "whole" } })).toEqual([400, "Give choices or focus, not both"]);
    expect(await refused({})).toEqual([400, "Choose what to draw: give 1 to 10 choices"]);
    expect(await refused({ choices: [] })).toEqual([400, "Choose what to draw: give 1 to 10 choices"]);
    expect(await refused({ choices: Array.from({ length: 11 }, (_, i) => ({ kind: "typed", text: `t${i}` })) })).toEqual([400, "Choose what to draw: give 1 to 10 choices"]);
    expect(await refused({ choices: [{ kind: "whole" }, { kind: "nope" }] })).toEqual([400, 'Unknown focus: use {"kind": "option" | "whole" | "typed"}']);
    expect(await refused({ choices: [{ kind: "whole" }, { kind: "whole" }] })).toEqual([400, "The whole system is chosen twice"]);
    expect(await refused({ choices: [{ kind: "option", option: "o2" }, { kind: "option", option: "o2" }] })).toEqual([400, 'The option "o2" is chosen twice']);
    expect(await refused({ choices: [{ kind: "typed", text: "a" }, { kind: "typed", text: "b" }] })).toEqual([400, "Only one choice can be in your own words"]);
    expect(await refused({ choices: [{ kind: "whole" }, { kind: "whole" }], channel: "nope" })).toEqual([400, "The whole system is chosen twice"]);
  });
});

/** A fake `claude` (a node script) that answers its checks, then hangs with a child that only killing the tree stops. */
function fakeCli(_: "hang"): { bin: string; log: string } {
  const dir = tempDir("archdraw-fake-draw-");
  const log = join(dir, "log.json");
  const src = `
const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.303 (Claude Code)"); process.exit(0); }
if (args.includes("--help")) { console.log("--json-schema --safe-mode --restricted --strict-mcp-config --no-session-persistence"); process.exit(0); }
if (args[0] === "debug") { console.log('{"models":[]}'); process.exit(0); }
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
  fs.writeFileSync(${JSON.stringify(log)} + ".child", String(child.pid));
  setInterval(() => {}, 1000);
});`;
  const bin = join(dir, "claude.js");
  writeFileSync(bin, src);
  return { bin, log };
}

describe("writing a new drawing", () => {
  it("takes the next free name and never replaces a file, nor leaves its temporary file", () => {
    const dir = makeFolder({ "docs/architecture.archdraw.json": "not a drawing\n" });
    expect(writeNewDrawing(dir, "{}\n")).toBe(join(dir, "docs", "architecture-2.archdraw.json"));
    expect(writeNewDrawing(dir, "{}\n")).toBe(join(dir, "docs", "architecture-3.archdraw.json"));
    expect(readFileSync(join(dir, "docs", "architecture.archdraw.json"), "utf8")).toBe("not a drawing\n");
    expect(readdirSync(join(dir, "docs")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("never writes through a docs that is a link (a junction or a symlink) to somewhere else", () => {
    const elsewhere = makeFolder({});
    const dir = makeFolder({});
    symlinkSync(elsewhere, join(dir, "docs"), "junction");
    expect(() => writeNewDrawing(dir, "{}\n")).toThrow(new DrawError(`Could not write the drawing in ${join(dir, "docs")}: docs is a link, not a folder of this project`));
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("roots a drawing in docs at its folder even when docs holds its own .git", () => {
    const dir = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n", "docs/.git": "gitdir: ../.git\n" });
    const file = writeNewDrawing(dir, JSON.stringify({ source: { kind: "local", path: dir } }));
    expect(repoRootOf(file)).toBe(dir);
  });

  it.skipIf(process.platform === "linux")("roots a drawing in an existing Docs folder at its parent, where the disk ignores case", () => {
    const dir = makeFolder({ "Docs/readme.md": "x\n" });
    writeNewDrawing(dir, JSON.stringify({ source: { kind: "local", path: dir } }));
    expect(repoRootOf(join(dir, "Docs", "architecture.archdraw.json"))).toBe(dir);
  });

  it("fails with the contracted sentence when docs is a file or every name is taken", () => {
    const file = makeFolder({ docs: "a file\n" });
    expect(() => writeNewDrawing(file, "{}\n")).toThrow(new DrawError(`Could not write the drawing in ${join(file, "docs")}: docs is not a folder`));
    const full = makeFolder({});
    mkdirSync(join(full, "docs"));
    for (const n of ["", ...Array.from({ length: 98 }, (_, i) => `-${i + 2}`)]) writeFileSync(join(full, "docs", `architecture${n}.archdraw.json`), "x");
    expect(() => writeNewDrawing(full, "{}\n")).toThrow(/every name from architecture\.archdraw\.json to architecture-99\.archdraw\.json is taken/);
    expect(readdirSync(join(full, "docs")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
