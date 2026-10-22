import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocument3 } from "../core/file3";
import { DrawError, writeNewDrawing } from "./draw";
import { repoRootOf } from "./files";
import { FixtureEngine } from "./engines/fixture";
import { EngineError, type Engine } from "./engines/types";
import { makeApp, makeFolder } from "./testkit";

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

describe("the draw run", () => {
  it("writes a new drawing under the folder, registers it, and draws every fact in the overview", async () => {
    const dir = repo();
    const t = makeApp();
    const events: { message: string; stage: string | null }[] = [];
    const run = await draw(t, dir);
    expect([run.status, run.error]).toEqual(["succeeded", null]);
    expect(run.path).toBe(join(dir, "docs", "architecture.archdraw.json"));
    const doc = t.store.get(run.diagramId!)!;
    expect(validateDocument3(doc).ok).toBe(true);
    expect([doc.source?.path, doc.warnings.slice(0, 4)]).toEqual([dir, FOUR]);
    const drawn = new Set(doc.channels.overview.views[0].nodes.flatMap((p) => [...p.facts, ...(p.held ?? [])]));
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

  it("roots a drawing of a folder outside git at that folder, also when the file is opened again", async () => {
    const dir = makeFolder(agentFiles);
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
    const outer = makeFolder({ "other/secret.txt": "x\n" });
    mkdirSync(join(outer, ".git"));
    const dir = join(outer, "project");
    for (const [rel, text] of Object.entries(agentFiles)) { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), text); }
    const t = makeApp();
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: dir } }))).body).toMatchObject({ root: dir, git: false });
    const run = await draw(t, dir);
    expect([run.status, t.store.rootOf(run.diagramId!)]).toEqual(["succeeded", dir]);
    // A .git file naming a git folder (a worktree) still marks a root.
    const wt = makeFolder({ "a.ts": "x\n" });
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
    const doc = t.store.get(run.diagramId!)!;
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
    expect(lines.filter((e) => e.stage !== "channel")).toEqual([
      { message: "Using the facts already read", stage: "read" }, { message: "Checking the facts", stage: "read" },
      { message: "Drawing the overview", stage: "overview" }, { message: "Using the overview already drawn", stage: "overview" },
    ]);
    const clean = await draw(t, repo(), { focus: { kind: "typed", text: "The agent" }, channel: "presentation" });
    const [doc, control] = [t.store.get(again.diagramId!)!, t.store.get(clean.diagramId!)!];
    expect(doc.warnings).toEqual(control.warnings);
    const shape = (d: typeof doc) => ({ nodes: d.channels.overview.views[0].nodes, edges: d.channels.overview.views[0].edges });
    expect(shape(doc)).toEqual(shape(control));
    // A success removes what was kept: the next draw reads again.
    const third = await start("The agent [fixture:flaky:channel]");
    expect(linesOf(t, third.id)[0]).not.toEqual({ message: "Using the facts already read", stage: "read" });
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
    expect(done.progress.slice(0, 4)).toEqual(["Using the facts already read", "Checking the facts", "Drawing the overview", "Using the overview already drawn"]);
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
    expect(lines.slice(0, 3)).toEqual(["Using the facts already read", "Checking the facts", "Drawing the overview"]);
    expect(lines).not.toContain("Using the overview already drawn");
    const doc = t.store.get(again.diagramId!)!;
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
