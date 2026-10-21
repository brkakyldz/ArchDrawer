import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocument3 } from "../core/file3";
import { DrawError, writeNewDrawing } from "./draw";
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
