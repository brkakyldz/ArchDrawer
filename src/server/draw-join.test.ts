import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Document4 } from "../core/file4";
import { FixtureEngine } from "./engines/fixture";
import { EngineError, type EngineRunRequest } from "./engines/types";
import type { RunEvent } from "./runs";
import { makeApp, makeFolder, shopRepo } from "./testkit";

// Joining a running draw (api contract, Joining a running draw; JOB-4, JOB-10; ADR 0016): what H218 and H219 observe
// through the HTTP surface and the fixture, here with engines that wait or hang on purpose — the joined choices' first
// events and ids, the one file, the refusals in their order, the answer once the draw writes, cancel, the scan the
// draw holds, and a joined choice drawn from what a failed draw kept.

type App = ReturnType<typeof makeApp>;
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const g = (dir: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function repo() {
  const dir = makeFolder({ "src/agent.ts": "export const agent = 1;\n", "src/app.ts": "export const app = 1;\n", "src/tools.ts": "export const tools = 1;\n" });
  g(dir, "init", "-q"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "one");
  return realpathSync.native(dir);
}
const scanOf = async (t: App, folder: string, refresh = false) => {
  const s = await json(await t.req("/api/scans", { method: "POST", json: { folder, engine: "fixture", ...(refresh ? { refresh } : {}) } }));
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
const joinTo = async (t: App, runId: string, body: unknown) => json(await t.req(`/api/runs/${runId}/choices`, { method: "POST", json: body }));
const WHOLE = { kind: "whole" }, O1 = { kind: "option", option: "o1" }, O2 = { kind: "option", option: "o2" }, O3 = { kind: "option", option: "o3" };
const typed = (text: string) => ({ kind: "typed", text });
/** Every event of a run, replayed: the run has ended. */
const eventsOf = (t: App, id: string) => { const out: RunEvent[] = []; t.runs.subscribe(id, (e) => out.push(e)); return out; };
const brief = (e: RunEvent) => (e.type === "progress" ? `${e.choice}|${e.message}|${e.stage}` : e.type === "choice" ? `${e.id}:${e.status}` : e.type);
const statuses = (t: App, id: string) => t.runs.get(id)!.choices!.map((c) => `${c.id}:${c.status}`);
const until = async (ok: () => boolean, what: string, ms = 10_000) => {
  for (const end = Date.now() + ms; !ok();) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await sleep(10); }
};

/** A fixture whose calls first wait `ms` for a typed choice saying "Slow", and that hang until cancelled for one saying "Hold". */
function engineOf(ms = 300) {
  return new (class extends FixtureEngine {
    override async run(req: EngineRunRequest) {
      if (req.instruction.includes("Hold")) {
        await new Promise<void>((resolve) => { if (req.signal.aborted) resolve(); else req.signal.addEventListener("abort", () => resolve(), { once: true }); });
        throw new EngineError("Cancelled");
      }
      if (req.instruction.includes("Slow")) await sleep(ms);
      return super.run(req);
    }
  })(1);
}

describe("joining a running draw", () => {
  it("choices that join while two run are listed at the end, start as the draw's own, and are written into its one file after them", async () => {
    const t = makeApp({ slots: 3, engines: [engineOf()] });
    const dir = repo(), scan = await scanOf(t, dir);
    const id = await start(t, scan, [typed("Slow path"), O2]);
    // A second draw of the folder is told which draw to join.
    expect(await json(await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan, choices: [WHOLE], channel: "readme" } })))
      .toEqual({ status: 409, body: { error: "A drawing of this folder is already being made", runId: id } });
    // The body's channel, engine and model are ignored: the joined choices take the draw's.
    const joined = await joinTo(t, id, { scan, choices: [O3, WHOLE], channel: "presentation", engine: "nope", model: "--x" });
    expect(joined).toEqual({ status: 200, body: { runId: id, choices: ["the-server-side", "system"] } });
    // Two slots taken by the draw's own, the first joined takes the third, the second waits.
    expect(statuses(t, id)).toEqual(["slow-path:running", "the-agent-loop:running", "the-server-side:running", "system:waiting"]);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 3, waiting: 1 });
    const run = (await t.runs.wait(id))!;
    expect([run.status, run.channel, run.choice, run.choices!.map((c) => c.status)]).toEqual(["succeeded", "readme", "slow-path", ["done", "done", "done", "done"]]);
    const events = eventsOf(t, id).map(brief);
    const at = events.indexOf('the-server-side|Added "The server side" to this draw|null');
    expect(events.slice(at, at + 6)).toEqual([
      'the-server-side|Added "The server side" to this draw|null',
      'the-server-side|Drawing "The server side" (3 of 4)|read',
      "the-server-side:running",
      'system|Added "The whole system" to this draw|null',
      "system|Waiting for a free engine|null",
      "system:waiting",
    ]);
    expect(events.filter((e) => e.startsWith("null|Writing the drawing")), "written once").toHaveLength(1);
    const doc = JSON.parse(readFileSync(run.path!, "utf8")) as Document4;
    expect(doc.choices.map((c) => c.id)).toEqual(["slow-path", "the-agent-loop", "the-server-side", "system"]);
    // Ids as a draw of the four, one after another, would give them; only the draw's channel is drawn.
    expect(doc.choices.map((c) => [c.channels.readme.views[0]?.id, c.channels.presentation.views.length])).toEqual([
      ["readme", 0], ["the-agent-loop-readme", 0], ["the-server-side-readme", 0], ["system-readme", 0],
    ]);
    expect(readdirSync(join(dir, "docs"))).toEqual(["architecture.archdraw.json"]);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 0, waiting: 0 });
  });

  it("refuses in the contract's order, counts a failed choice of the draw, and a refusal changes nothing", async () => {
    const t = makeApp({ slots: 3, engines: [engineOf()] });
    const scan = await scanOf(t, repo());
    const id = await start(t, scan, [typed("Hold on [fixture:fail]"), WHOLE, O2]);
    const refused = async (runId: string, body: unknown, status: number, error: string) => expect(await joinTo(t, runId, body), JSON.stringify(body)).toEqual({ status, body: { error } });
    await refused("r_nothing", { scan, choices: [O1] }, 404, "Run not found");
    await refused(id, { choices: [O1] }, 400, "Give the scan the choices come from");
    await refused(id, { scan: 7, choices: [O1] }, 400, "Give the scan the choices come from");
    await refused(id, { scan: "s_nothing", choices: [] }, 400, "Scan the folder first: that scan is unknown or did not succeed");
    await refused(id, { scan, choices: [] }, 400, "Choose what to draw: give 1 to 10 choices");
    await refused(id, { scan, choices: [{ kind: "x" }, { kind: "option", option: "o9" }] }, 400, 'Unknown focus: use {"kind": "option" | "whole" | "typed"}');
    await refused(id, { scan, choices: [{ kind: "option", option: "o9" }] }, 400, 'Unknown focus option "o9"');
    await refused(id, { scan, choices: [O1, O1] }, 400, 'The option "o1" is chosen twice');
    await refused(id, { scan, choices: [typed("a"), typed("b")] }, 400, "Only one choice can be in your own words");
    await refused(id, { scan, choices: [O1, WHOLE] }, 400, "The whole system is already in this draw");
    await refused(id, { scan, choices: [O1, O2] }, 400, 'The option "o2" is already in this draw');
    await refused(id, { scan, choices: [typed("Another")] }, 400, "This draw already has a choice in your own words");
    expect(statuses(t, id)).toEqual(["hold-on-fixture-fail:running", "system:running", "the-agent-loop:running"]);
    expect(t.slots.stats()).toEqual({ total: 3, busy: 3, waiting: 0 });
    // A run of another kind takes no choices.
    const reg = await json(await t.req("/api/files", { method: "POST", json: { path: shopRepo().file } }));
    const refine = await json(await t.req("/api/runs", { method: "POST", json: { diagramId: reg.body.id, view: "overview", instruction: "add Cache", engine: "fixture" } }));
    await refused(refine.body.runId, { scan, choices: [O1] }, 400, "Only a draw takes more choices");
    await t.runs.wait(refine.body.runId);
    t.runs.cancel(id);
    await t.runs.wait(id);
    await refused(id, { scan, choices: [O1] }, 409, "This draw has ended: start a new one");
  });

  it("once the draw writes its file a join is refused, and the file holds only what the draw held", async () => {
    const t = makeApp({ slots: 2, stepMs: 5 });
    const dir = repo(), scan = await scanOf(t, dir);
    const id = await start(t, scan, [WHOLE, O2]);
    let atWrite: unknown = null;
    let route: Promise<{ status: number; body: { error?: string } }> | null = null;
    t.runs.subscribe(id, (e) => {
      if (e.type !== "progress" || e.message !== "Writing the drawing") return;
      expect(t.runs.get(id)!.writing).toBe(true);
      atWrite = t.runs.joinDraw(id, [{ kind: "typed", text: "Late" }]);
      route = joinTo(t, id, { scan, choices: [O3] });
    });
    const run = (await t.runs.wait(id))!;
    expect(atWrite).toEqual({ refused: "writing" });
    const late = await route!;
    expect(late.status).toBe(409);
    expect(["The draw is writing its file: start a new one once it has finished", "This draw has ended: start a new one"]).toContain(late.body.error);
    expect(run.choices!.map((c) => c.id)).toEqual(["system", "the-agent-loop"]);
    expect((JSON.parse(readFileSync(run.path!, "utf8")) as Document4).choices.map((c) => c.id)).toEqual(["system", "the-agent-loop"]);
    expect(await joinTo(t, id, { scan, choices: [O3] })).toEqual({ status: 409, body: { error: "This draw has ended: start a new one" } });
  });

  it("a choice that joins in the moment every choice has ended is still drawn and written", async () => {
    const t = makeApp({ slots: 2, stepMs: 5 });
    const scan = await scanOf(t, repo());
    const id = await start(t, scan, [O2]);
    // Joined from the last choice's `done` record: every choice of the draw has ended, the file is not yet being written.
    let joined: unknown = null;
    t.runs.subscribe(id, (e) => { if (e.type === "choice" && e.status === "done" && !joined) joined = t.runs.joinDraw(id, [{ kind: "whole" }]); });
    const run = (await t.runs.wait(id))!;
    expect(joined).toEqual({ choices: ["system"] });
    expect([run.status, run.choices!.map((c) => `${c.id}:${c.status}`)]).toEqual(["succeeded", ["the-agent-loop:done", "system:done"]]);
    expect((JSON.parse(readFileSync(run.path!, "utf8")) as Document4).choices.map((c) => c.id)).toEqual(["the-agent-loop", "system"]);
  });

  it("cancelling the draw cancels the joined choice too: its engine stops, its slot is freed, nothing is written", async () => {
    const t = makeApp({ slots: 2, engines: [engineOf()] });
    const dir = repo(), scan = await scanOf(t, dir);
    const id = await start(t, scan, [O2]);
    expect((await joinTo(t, id, { scan, choices: [typed("Hold this"), WHOLE] })).status).toBe(200);
    await until(() => t.runs.get(id)!.choices![0].status === "done", "the draw's own choice to be done");
    await until(() => t.runs.get(id)!.choices![2].status === "running", "the whole system to take the freed slot");
    expect(statuses(t, id)).toEqual(["the-agent-loop:done", "hold-this:running", "system:running"]);
    expect((await json(await t.req(`/api/runs/${id}/cancel`, { method: "POST" }))).body).toEqual({ ok: true });
    // A join after the cancel was asked is refused, even before the draw has ended.
    expect(await joinTo(t, id, { scan, choices: [O1] })).toEqual({ status: 409, body: { error: "This draw has ended: start a new one" } });
    const run = (await t.runs.wait(id))!;
    expect([run.status, run.choices!.map((c) => c.status), run.path, run.diagramId]).toEqual(["cancelled", ["done", "cancelled", "cancelled"], null, null]);
    expect(existsSync(join(dir, "docs"))).toBe(false);
    expect(t.slots.stats()).toEqual({ total: 2, busy: 0, waiting: 0 });
  });

  it("joins from a newer scan of the same commit and options, not from another commit or other options, and holds its own scan until it ends", async () => {
    const t = makeApp({ slots: 2, engines: [engineOf()] });
    const dir = repo(), scan = await scanOf(t, dir);
    const id = await start(t, scan, [typed("Hold the draw")]);
    // A cached scan of the same commit is newer, has its own id, and is accepted; the draw's scan is not forgotten.
    const cached = await scanOf(t, dir);
    expect([cached === scan, t.scans.get(cached)!.cached]).toEqual([false, true]);
    expect(await joinTo(t, id, { scan: cached, choices: [O1] })).toEqual({ status: 200, body: { runId: id, choices: ["how-a-request-moves-through-the-project"] } });
    expect(t.scans.get(scan)?.status).toBe("succeeded");
    // Other options at the same commit (a new file that sorts first), then another commit.
    writeFileSync(join(dir, "src", "aaa.ts"), "export const a = 1;\n");
    const changed = await scanOf(t, dir, true);
    expect([t.scans.get(changed)!.commit, t.scans.get(changed)!.options]).not.toEqual([t.scans.get(scan)!.commit, t.scans.get(scan)!.options]);
    expect(t.scans.get(changed)!.commit).toBe(t.scans.get(scan)!.commit);
    expect(await joinTo(t, id, { scan: changed, choices: [O2] })).toEqual({ status: 409, body: { error: "The draw was started from another scan of this folder" } });
    g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "two");
    const later = await scanOf(t, dir);
    expect(t.scans.get(later)!.commit).not.toBe(t.scans.get(scan)!.commit);
    expect(await joinTo(t, id, { scan: later, choices: [O2] })).toEqual({ status: 409, body: { error: "The draw was started from another scan of this folder" } });
    // A scan of another folder is another scan too.
    const other = await scanOf(t, repo());
    expect(await joinTo(t, id, { scan: other, choices: [O2] })).toEqual({ status: 409, body: { error: "The draw was started from another scan of this folder" } });
    expect(t.scans.get(scan)?.status, "held while the draw runs").toBe("succeeded");
    // The draw's own scan is always accepted.
    expect((await joinTo(t, id, { scan, choices: [O2] })).status).toBe(200);
    t.runs.cancel(id);
    await t.runs.wait(id);
    await sleep(0);
    // Once the draw has ended, the newer success forgets it.
    expect(t.scans.get(scan)).toBeNull();
    expect(t.scans.get(later)?.status).toBe("succeeded");
  });

  it("a joined choice gets an id free among the draw's, and is drawn from what a failed draw kept", async () => {
    const t = makeApp({ slots: 2, engines: [engineOf()] });
    const scan = await scanOf(t, repo());
    // A cancelled draw keeps the agent loop past its read.
    const first = await start(t, scan, [O2, typed("Hold back")]);
    await until(() => t.runs.get(first)!.choices![0].status === "done", "the agent loop to be done");
    t.runs.cancel(first);
    await t.runs.wait(first);
    // A typed text whose slug is the option's id: the joined option gets `-2`, and reuses what was kept.
    const id = await start(t, scan, [typed("The agent loop")]);
    expect(await joinTo(t, id, { scan, choices: [O2] })).toEqual({ status: 200, body: { runId: id, choices: ["the-agent-loop-2"] } });
    const run = (await t.runs.wait(id))!;
    expect(run.status).toBe("succeeded");
    const lines = eventsOf(t, id).filter((e) => e.type === "progress" && e.choice === "the-agent-loop-2").map((e) => (e as { message: string }).message);
    expect(lines).toContain("Using the facts already read");
    expect(lines.some((m) => m.startsWith("Reading"))).toBe(false);
  });
});
