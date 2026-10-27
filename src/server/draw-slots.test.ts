import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Document4 } from "../core/file4";
import { ClaudeEngine } from "./engines/claude";
import { FixtureEngine } from "./engines/fixture";
import { EngineError, type EngineRunRequest } from "./engines/types";
import type { RunEvent } from "./runs";
import { makeApp, makeFolder, shopRepo, tempDir } from "./testkit";

// Choices side by side in the server's engine slots (api contract, Engine slots, The draw run, Trying again; JOB-1,
// JOB-2, JOB-3, JOB-6, JOB-10; ADR 0016): what the held-out scenarios H209–H217 observe only through the HTTP surface
// and the fixture, here with engines that hang, wait or fail on purpose — the slot freed whichever way a job ends,
// ids whatever the finish order, every engine of a cancelled draw gone, the structured progress line by line.

type App = ReturnType<typeof makeApp>;
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const g = (dir: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function repo() {
  const dir = makeFolder({ "src/agent.ts": "export const agent = 1;\n", "src/app.ts": "export const app = 1;\n", "src/tools.ts": "export const tools = 1;\n" });
  g(dir, "init", "-q"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "one");
  return realpathSync.native(dir);
}
const scanOf = async (t: App, folder: string) => {
  const s = await json(await t.req("/api/scans", { method: "POST", json: { folder, engine: "fixture" } }));
  expect(s.status, JSON.stringify(s.body)).toBe(202);
  const scan = (await t.scans.wait(s.body.scanId))!;
  expect(scan.status).toBe("succeeded");
  return scan.id;
};
const start = async (t: App, scan: string, choices: unknown[], channel = "readme") => {
  const r = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, choices, channel } }));
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return r.body.runId as string;
};
const WHOLE = { kind: "whole" }, O1 = { kind: "option", option: "o1" }, O2 = { kind: "option", option: "o2" }, O3 = { kind: "option", option: "o3" };
const typed = (text: string) => ({ kind: "typed", text });
/** Every event of a run, replayed: the run has ended. */
const eventsOf = (t: App, id: string) => { const out: RunEvent[] = []; t.runs.subscribe(id, (e) => out.push(e)); return out; };
const viewIds = (doc: Document4) => doc.choices.map((c) => [c.id, ...(["overview", "linkedin", "readme", "presentation"] as const).flatMap((ch) => c.channels[ch].views.map((v) => `${ch}:${v.id}`))]);

/** A fixture whose calls first wait `ms[choiceIndex]`, that hangs until cancelled for a typed choice saying "Hold", and fails the indices in `fail`. */
function engineOf(o: { ms?: number[]; fail?: number[] } = {}) {
  return new (class extends FixtureEngine {
    override async run(req: EngineRunRequest) {
      const i = req.task?.data?.choiceIndex;
      if (req.instruction.includes("Hold")) {
        await new Promise<void>((resolve) => { if (req.signal.aborted) resolve(); else req.signal.addEventListener("abort", () => resolve(), { once: true }); });
        throw new EngineError("Cancelled");
      }
      if (typeof i === "number" && o.ms?.[i]) await sleep(o.ms[i]);
      if (typeof i === "number" && o.fail?.includes(i)) throw new EngineError(`Choice ${i + 1} failed`);
      return super.run(req);
    }
  })(1);
}

describe("choices side by side in the engine slots", () => {
  it("three choices on three slots start together and write one file holding all three in request order", async () => {
    const t = makeApp({ slots: 3, stepMs: 20 });
    const dir = repo();
    const id = await start(t, await scanOf(t, dir), [WHOLE, O2, typed("How a tool runs")]);
    const early = t.runs.get(id)!;
    expect(early.choices!.map((c) => [c.status, c.stage])).toEqual([["running", "read"], ["running", "read"], ["running", "read"]]);
    expect([early.waiting, early.writing, t.slots.stats()]).toEqual([false, false, { total: 3, busy: 3, waiting: 0 }]);
    const run = (await t.runs.wait(id))!;
    expect([run.status, run.choices!.map((c) => c.status)]).toEqual(["succeeded", ["done", "done", "done"]]);
    const file = JSON.parse(readFileSync(run.path!, "utf8")) as Document4;
    expect(file.choices.map((c) => c.id)).toEqual(["system", "the-agent-loop", "how-a-tool-runs"]);
    expect(readdirSync(join(dir, "docs"))).toEqual(["architecture.archdraw.json"]);
    // All three overlapped: each started before any ended.
    const firstEnd = Math.min(...run.choices!.map((c) => Date.parse(c.endedAt!)));
    expect(run.choices!.every((c) => Date.parse(c.startedAt!) < firstEnd)).toBe(true);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 0, waiting: 0 });
  });

  it("a fourth choice waits and says so: the first events are each choice's line and record, and it starts once a slot is free", async () => {
    const t = makeApp({ slots: 3, stepMs: 20 });
    const id = await start(t, await scanOf(t, repo()), [WHOLE, O2, O1, typed("Paying")], "linkedin");
    expect(t.runs.get(id)!.choices!.map((c) => c.status)).toEqual(["running", "running", "running", "waiting"]);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 3, waiting: 1 });
    await t.runs.wait(id);
    const events = eventsOf(t, id);
    const head = events.slice(0, 8).map((e) => (e.type === "progress" ? `${e.choice}|${e.message}|${e.stage}|${e.source}` : e.type === "choice" ? `${e.id}:${e.status}:${e.stage}` : e.type));
    expect(head).toEqual([
      'system|Drawing "The whole system" (1 of 4)|read|server', "system:running:read",
      'the-agent-loop|Drawing "The agent loop" (2 of 4)|read|server', "the-agent-loop:running:read",
      'how-a-request-moves-through-the-project|Drawing "How a request moves through the project" (3 of 4)|read|server', "how-a-request-moves-through-the-project:running:read",
      "paying|Waiting for a free engine|null|server", "paying:waiting:null",
    ]);
    const fourth = events.findIndex((e) => e.type === "progress" && e.choice === "paying" && e.message === 'Drawing "Paying" (4 of 4)');
    expect(events[fourth + 1]).toMatchObject({ type: "choice", id: "paying", status: "running", stage: "read" });
    expect(events.slice(0, fourth).some((e) => e.type === "choice" && e.status === "done"), "a slot was freed first").toBe(true);
    expect(t.runs.get(id)!.choices!.map((c) => c.status)).toEqual(["done", "done", "done", "done"]);
  });

  it("with one slot the choices go one after another, and a scan and an instruction run wait their turn in the same queue", async () => {
    const t = makeApp({ slots: 1, stepMs: 20 });
    const a = repo(), b = repo();
    const scanA = await scanOf(t, a);
    const reg = shopRepo();
    const diagram = await json(await t.req("/api/files", { method: "POST", json: { path: reg.file } }));
    const id = await start(t, scanA, [O2, O3, O1]);
    const scanB = await json(await t.req("/api/scans", { method: "POST", json: { folder: b } }));
    const refine = await json(await t.req("/api/runs", { method: "POST", json: { diagramId: diagram.body.id, view: "overview", instruction: "add Cache" } }));
    expect(t.slots.stats()).toEqual({ total: 1, busy: 1, waiting: 4 });
    expect([t.scans.get(scanB.body.scanId)!.waiting, t.scans.get(scanB.body.scanId)!.progress, t.runs.get(refine.body.runId)!.waiting, t.runs.get(refine.body.runId)!.progress])
      .toEqual([true, ["Waiting for a free engine"], true, ["Waiting for a free engine"]]);
    const run = (await t.runs.wait(id))!;
    const [scan, edit] = [(await t.scans.wait(scanB.body.scanId))!, (await t.runs.wait(refine.body.runId))!];
    expect([run.status, scan.status, edit.status]).toEqual(["succeeded", "succeeded", "succeeded"]);
    // Never two at once: each choice starts after the one before ended; then the scan, then the instruction.
    const spans = [...run.choices!.map((c) => [c.startedAt!, c.endedAt!]), [scan.startedAt!, scan.endedAt!], [edit.startedAt!, edit.endedAt!]].map(([s, e]) => [Date.parse(s), Date.parse(e)]);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0], `job ${i} starts after job ${i - 1} ended`).toBeGreaterThanOrEqual(spans[i - 1][1]);
    expect(scan.progress.indexOf("Gathering the repository")).toBeGreaterThan(scan.progress.indexOf("Waiting for a free engine"));
    expect(t.slots.stats()).toEqual({ total: 1, busy: 0, waiting: 0 });
  });

  describe("a slot is freed whichever way a job ends, and the next waiting job starts", () => {
    it("a failed choice", async () => {
      const t = makeApp({ slots: 1, stepMs: 5 });
      const run = (await t.runs.wait(await start(t, await scanOf(t, repo()), [typed("Pay [fixture:fail]"), WHOLE])))!;
      expect([run.status, run.choices!.map((c) => `${c.status}:${c.error}`)]).toEqual(["succeeded", ["failed:Fixture failure requested", "done:null"]]);
      expect(Date.parse(run.choices![1].startedAt!)).toBeGreaterThanOrEqual(Date.parse(run.choices![0].endedAt!));
      expect(t.slots.stats()).toEqual({ total: 1, busy: 0, waiting: 0 });
    });

    it("a choice past its deadline", async () => {
      const t = makeApp({ slots: 1, engines: [engineOf()], timeoutMs: 600 });
      const run = (await t.runs.wait(await start(t, await scanOf(t, repo()), [typed("Hold"), O2])))!;
      expect([run.status, run.choices!.map((c) => `${c.status}:${c.stage}`)]).toEqual(["succeeded", ["failed:read", "done:channel"]]);
      expect(run.choices![0].error).toMatch(/^Timed out after/);
      expect(t.slots.stats()).toEqual({ total: 1, busy: 0, waiting: 0 });
    });

    it("a cancelled draw: its running choice stops, its waiting ones never start, a waiting scan leaves the queue, and the next draw takes the slot", async () => {
      const t = makeApp({ slots: 1, engines: [engineOf()] });
      const [a, b, c] = [repo(), repo(), repo()];
      const [scanA, scanB] = [await scanOf(t, a), await scanOf(t, b)];
      const held = await start(t, scanA, [typed("Hold"), O2]);
      const next = await start(t, scanB, [O3]);
      const waitingScan = await json(await t.req("/api/scans", { method: "POST", json: { folder: c } }));
      expect(t.slots.stats()).toEqual({ total: 1, busy: 1, waiting: 3 });
      expect(t.runs.get(next)!.waiting).toBe(true);
      expect((await json(await t.req(`/api/scans/${waitingScan.body.scanId}/cancel`, { method: "POST" }))).body).toEqual({ ok: true });
      const scan = (await t.scans.wait(waitingScan.body.scanId))!;
      expect([scan.status, scan.progress, scan.startedAt, scan.waiting]).toEqual(["cancelled", ["Waiting for a free engine"], null, false]);
      expect((await json(await t.req(`/api/runs/${held}/cancel`, { method: "POST" }))).body).toEqual({ ok: true });
      const cancelled = (await t.runs.wait(held))!;
      expect([cancelled.status, cancelled.path, cancelled.choices!.map((x) => `${x.status}:${x.stage}:${x.startedAt === null}`)]).toEqual(["cancelled", null, ["cancelled:read:false", "waiting:null:true"]]);
      expect(existsSync(join(a, "docs"))).toBe(false);
      const after = (await t.runs.wait(next))!;
      expect([after.status, after.choices!.map((x) => x.status)]).toEqual(["succeeded", ["done"]]);
      expect(Date.parse(after.choices![0].startedAt!)).toBeGreaterThanOrEqual(Date.parse(cancelled.endedAt!) - 50);
      expect(t.slots.stats()).toEqual({ total: 1, busy: 0, waiting: 0 });
    });
  });

  it("a draw in which every choice failed ends failed with the first one's error and writes nothing", async () => {
    // The first choice fails last, so the error is the first in the draw's order, not the first to happen.
    const t = makeApp({ engines: [engineOf({ ms: [300, 0], fail: [0, 1] })] });
    const dir = repo();
    const run = (await t.runs.wait(await start(t, await scanOf(t, dir), [WHOLE, O2])))!;
    expect(Date.parse(run.choices![0].endedAt!)).toBeGreaterThan(Date.parse(run.choices![1].endedAt!));
    expect([run.status, run.error, run.diagramId, run.path, run.choices!.map((c) => c.status)]).toEqual(["failed", "Choice 1 failed", null, null, ["failed", "failed"]]);
    expect(eventsOf(t, run.id).some((e) => e.type === "progress" && e.message === "Writing the drawing")).toBe(false);
    expect(existsSync(join(dir, "docs"))).toBe(false);
  });

  it("view ids do not depend on which choice finishes first: they are those of the same choices drawn in request order", async () => {
    const drawIn = async (ms: number[]) => {
      const t = makeApp({ slots: 3, engines: [engineOf({ ms })] });
      const run = (await t.runs.wait(await start(t, await scanOf(t, repo()), [typed("Slow first"), WHOLE, O2])))!;
      expect(run.status).toBe("succeeded");
      return { run, file: JSON.parse(readFileSync(run.path!, "utf8")) as Document4 };
    };
    const slow = await drawIn([400, 0, 0]);
    const ends = slow.run.choices!.map((c) => Date.parse(c.endedAt!));
    expect(ends[0], "the first choice finished last").toBeGreaterThan(Math.max(ends[1], ends[2]));
    const control = await drawIn([0, 0, 0]);
    expect(viewIds(slow.file)).toEqual([
      ["slow-first", "overview:overview", "readme:readme"],
      ["system", "overview:system-overview", "overview:zone-runtime-inside", "readme:system-readme"],
      ["the-agent-loop", "overview:the-agent-loop-overview", "readme:the-agent-loop-readme"],
    ]);
    expect(viewIds(control.file)).toEqual(viewIds(slow.file));
    // The map's part opens the detail view by its settled id.
    expect(slow.file.choices[1].channels.overview.views[0].nodes.find((n) => n.detail)?.detail).toBe("zone-runtime-inside");
    expect(slow.file.warnings).toEqual(control.file.warnings);
  });

  it("with the first choice failed, the next finished one is the file's first and takes the channels' own names", async () => {
    const t = makeApp({ stepMs: 5 });
    const run = (await t.runs.wait(await start(t, await scanOf(t, repo()), [typed("Pay [fixture:fail]"), WHOLE, O2])))!;
    expect([run.status, run.choice, run.view]).toEqual(["succeeded", "system", "readme"]);
    expect(viewIds(JSON.parse(readFileSync(run.path!, "utf8")) as Document4)).toEqual([
      ["system", "overview:overview", "overview:zone-runtime-inside", "readme:readme"],
      ["the-agent-loop", "overview:the-agent-loop-overview", "readme:the-agent-loop-readme"],
    ]);
  });

  it("cancel stops every engine of the draw: each running choice's process tree exits and every slot is freed", async () => {
    const fake = hangingCli();
    const claude = new ClaudeEngine({ ...process.env, ARCHDRAW_CLAUDE_BIN: fake.bin });
    const t = makeApp({ engines: [claude, new FixtureEngine(1)] });
    const scan = await scanOf(t, repo());
    const r = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, choices: [WHOLE, O2, typed("Third")], channel: "readme", engine: "claude" } }));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    for (let i = 0; i < 300 && children(fake.dir).length < 3; i++) await sleep(50);
    const pids = children(fake.dir);
    expect(pids).toHaveLength(3);
    expect(t.runs.get(r.body.runId)!.choices!.map((c) => c.status)).toEqual(["running", "running", "running"]);
    t.runs.cancel(r.body.runId);
    const run = (await t.runs.wait(r.body.runId))!;
    expect([run.status, run.choices!.map((c) => c.status)]).toEqual(["cancelled", ["cancelled", "cancelled", "cancelled"]]);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 40 && pids.some(alive); i++) await sleep(50);
    expect(pids.filter(alive)).toEqual([]);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 0, waiting: 0 });
  });
});

describe("structured progress (JOB-6)", () => {
  it("every line has its time and source; a choice reports the files read at the read's line, its parts once checked, and its last engine line", async () => {
    const t = makeApp({ stepMs: 5 });
    const scanId = await scanOf(t, repo());
    const scanLines: { message: string; at: string; source: string }[] = [];
    t.scans.subscribe(scanId, (e) => { if (e.type === "progress") scanLines.push(e); });
    const scan = t.scans.get(scanId)!;
    expect(scanLines.map((l) => `${l.message}|${l.source}`)).toEqual(["Gathering the repository|server", "Reading the inputs|engine", "Writing the card|engine", "Checking the scan|server", "Done|server"]);
    expect(scan).toMatchObject({ message: "Done", waiting: false, link: null, name: scan.card!.name, lastEngineEventAt: scanLines[2].at });
    const id = await start(t, scanId, [O1], "linkedin");
    const run = (await t.runs.wait(id))!;
    const events = eventsOf(t, id);
    const lines = events.flatMap((e) => (e.type === "progress" ? [e] : []));
    expect(lines.every((l) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(l.at))).toBe(true);
    expect(lines.map((l) => l.at)).toEqual([...lines.map((l) => l.at)].sort());
    expect(lines.filter((l) => ["Reading the drawing", "Reading the code", "Updating the drawing"].includes(l.message)).every((l) => l.source === "engine")).toBe(true);
    expect(lines.filter((l) => /^(Drawing |Checking |Writing the drawing|Saved)/.test(l.message)).every((l) => l.source === "server")).toBe(true);
    // The read's `Reading the code` line, then a record with two files read; the parts after the read is checked.
    const code = events.findIndex((e) => e.type === "progress" && e.message === "Reading the code" && e.stage === "read");
    expect(events[code + 1]).toMatchObject({ type: "choice", filesRead: 2, parts: null });
    expect(events.slice(0, code).filter((e) => e.type === "choice").every((e) => e.type === "choice" && e.filesRead === 0)).toBe(true);
    const checking = events.findIndex((e) => e.type === "progress" && e.message === "Checking the facts");
    const parts = events.findIndex((e) => e.type === "choice" && e.parts !== null);
    const overview = events.findIndex((e) => e.type === "progress" && e.message === "Drawing the overview");
    expect([checking < parts, parts < overview, (events[parts] as { parts: number }).parts]).toEqual([true, true, 8]);
    // A record after each new stage's line, and one at the end.
    expect(events[overview + 1]).toMatchObject({ type: "choice", stage: "overview" });
    const records = events.flatMap((e) => (e.type === "choice" ? [e] : []));
    expect(records.at(-1)).toMatchObject({ status: "done", stage: "channel", filesRead: 2, parts: 8, error: null });
    const lastEngine = lines.filter((l) => l.source === "engine").at(-1)!.at;
    expect(run.choices![0]).toMatchObject({ lastEngineEventAt: lastEngine, filesRead: 2, parts: 8 });
    expect(run).toMatchObject({ lastEngineEventAt: lastEngine, message: lines.at(-1)!.message, waiting: false, writing: false, scan: scanId, name: scan.card!.name, folder: scan.folder, root: scan.root, link: null, into: null, retryOf: null });
    expect(Date.parse(run.createdAt) <= Date.parse(run.startedAt!) && Date.parse(run.startedAt!) <= Date.parse(run.endedAt!)).toBe(true);
    // The write's two lines belong to no choice.
    expect(lines.slice(-2).map((l) => [l.message.replace(/ with \d+ warnings?$/, ""), l.choice, l.stage])).toEqual([["Writing the drawing", null, null], ["Saved", null, null]]);
  });

  it("a reused read reads no file: filesRead stays 0 and the parts are counted again", async () => {
    const t = makeApp({ stepMs: 5 });
    const scan = await scanOf(t, repo());
    const failed = (await t.runs.wait(await start(t, scan, [typed("Notes [fixture:flaky:overview]")])))!;
    expect(failed.status).toBe("failed");
    const retried = await json(await t.req(`/api/runs/${failed.id}/retry`, { method: "POST" }));
    const again = (await t.runs.wait(retried.body.runId))!;
    expect([again.status, again.into, again.retryOf, again.choices![0].filesRead, again.choices![0].parts]).toEqual(["succeeded", null, failed.id, 0, 8]);
  });
});

describe("Try again (api contract, Trying again)", () => {
  it("is refused in the contracted order", async () => {
    const t = makeApp({ slots: 1, engines: [engineOf(), new FixtureEngine(1)] });
    const dir = repo();
    const scan = await scanOf(t, dir);
    const retry = async (id: string) => json(await t.req(`/api/runs/${id}/retry`, { method: "POST" }));
    expect(await retry("r_nothing")).toEqual({ status: 404, body: { error: "Run not found" } });
    const reg = shopRepo();
    const diagram = await json(await t.req("/api/files", { method: "POST", json: { path: reg.file } }));
    const refine = await json(await t.req("/api/runs", { method: "POST", json: { diagramId: diagram.body.id, view: "overview", instruction: "add Cache", engine: "fixture" } }));
    await t.runs.wait(refine.body.runId);
    expect(await retry(refine.body.runId)).toEqual({ status: 400, body: { error: "Only a draw can be tried again" } });
    // A draw whose first choice hangs: still running; then cancelled, tried again while that retry runs.
    const hanging = await start(t, scan, [typed("Hold")]);
    expect(await retry(hanging)).toEqual({ status: 409, body: { error: "The draw is still running" } });
    t.runs.cancel(hanging);
    await t.runs.wait(hanging);
    const busy = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, choices: [O2], channel: "readme", engine: "fixture" } }));
    expect(await retry(hanging)).toEqual({ status: 409, body: { error: "A drawing of this folder is already being made", runId: busy.body.runId } });
    const done = (await t.runs.wait(busy.body.runId))!;
    expect(await retry(done.id)).toEqual({ status: 400, body: { error: "Every choice of this draw was drawn" } });
    // A draw that succeeded with a failed choice cannot add to a drawing that is gone.
    const partial = await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, choices: [O2, typed("Pay [fixture:fail]")], channel: "readme", engine: "fixture" } }));
    const ran = (await t.runs.wait(partial.body.runId))!;
    expect([ran.status, ran.choices!.map((c) => c.status)]).toEqual(["succeeded", ["done", "failed"]]);
    expect((await t.req(`/api/diagrams/${ran.diagramId}`, { method: "DELETE" })).status).toBe(204);
    expect(await retry(ran.id)).toEqual({ status: 409, body: { error: "The drawing this draw wrote is gone: start a new draw" } });
  });

  it("a choice the file already holds gets -2, and every view of the file counts as earlier", async () => {
    const t = makeApp({ stepMs: 5 });
    const dir = repo();
    const scan = await scanOf(t, dir);
    const first = (await t.runs.wait(await start(t, scan, [WHOLE, typed("Pay [fixture:flaky:channel]")], "linkedin")))!;
    expect(first.choices!.map((c) => c.status)).toEqual(["done", "failed"]);
    // The user adds a choice of that id to the file in the meantime: the retried choice takes the next free id.
    const doc = JSON.parse(readFileSync(first.path!, "utf8")) as Document4;
    doc.choices.push({ ...structuredClone(doc.choices[0]), id: "pay-fixture-flaky-channel", kind: "custom", title: "Mine", about: "Mine",
      channels: { ...structuredClone(doc.choices[0].channels), overview: { ...structuredClone(doc.choices[0].channels.overview), views: doc.choices[0].channels.overview.views.map((v) => ({ ...structuredClone(v), id: `mine-${v.id}`, nodes: v.nodes.map((n) => ({ ...n, detail: n.detail ? `mine-${n.detail}` : null })) })) }, linkedin: { ...doc.choices[0].channels.linkedin, views: doc.choices[0].channels.linkedin.views.map((v) => ({ ...structuredClone(v), id: "mine-linkedin" })) } } });
    const put = await json(await t.req(`/api/diagrams/${first.diagramId}`, { method: "PUT", json: doc }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const retried = await json(await t.req(`/api/runs/${first.id}/retry`, { method: "POST" }));
    expect(t.runs.get(retried.body.runId)!.choices!.map((c) => c.id)).toEqual(["pay-fixture-flaky-channel-2"]);
    const again = (await t.runs.wait(retried.body.runId))!;
    expect(again.status, again.error ?? "").toBe("succeeded");
    const after = JSON.parse(readFileSync(first.path!, "utf8")) as Document4;
    expect(after.choices.map((c) => c.id)).toEqual(["system", "pay-fixture-flaky-channel", "pay-fixture-flaky-channel-2"]);
    expect(viewIds(after)[2]).toEqual(["pay-fixture-flaky-channel-2", "overview:pay-fixture-flaky-channel-2-overview", "linkedin:pay-fixture-flaky-channel-2-linkedin"]);
    const all = viewIds(after).flatMap((v) => v.slice(1).map((x) => x.split(":")[1]));
    expect(new Set(all).size).toBe(all.length);
  });
});

/** A fake `claude` (a node script) that answers its checks, then hangs with a child; each run writes `<pid>.child`. */
function hangingCli(): { bin: string; dir: string } {
  const dir = tempDir("archdraw-fake-slots-");
  const src = `
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.303 (Claude Code)"); process.exit(0); }
if (args.includes("--help")) { console.log("--json-schema --safe-mode --restricted --strict-mcp-config --no-session-persistence"); process.exit(0); }
if (args[0] === "debug") { console.log('{"models":[]}'); process.exit(0); }
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
  fs.writeFileSync(path.join(${JSON.stringify(dir)}, child.pid + ".child"), String(child.pid));
  setInterval(() => {}, 1000);
});`;
  const bin = join(dir, "claude.js");
  writeFileSync(bin, src);
  return { bin, dir };
}
const children = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".child")).map((f) => Number(f.slice(0, -6)));
