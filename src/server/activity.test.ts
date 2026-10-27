import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { makeApp, makeFolder, shopRepo } from "./testkit";

// The activity list (api contract, Activity; JOB-7, JOB-9) through the server, with the fixture engine:
// what H220 and H221 do not observe at this layer — a scan and a draw listed running, then finished,
// then gone after the keep time; a listed job's stream replaying its past; the 409s naming the job.

const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const FILES = { "README.md": "# Shop\nSells things.\n", "package.json": '{"main": "src/server.ts"}', "src/server.ts": "// server\n", "src/agent.ts": "// agent\n" };
function gitRepo(): string {
  const dir = makeFolder(FILES);
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
  g("init", "-q"); g("add", "-A"); g("commit", "-q", "-m", "one");
  return dir;
}
type App = ReturnType<typeof makeApp>;
const activity = async (t: App) => (await json(await t.req("/api/activity"))).body;
const jobOf = (act: { jobs: { id: string }[] }, id: string) => act.jobs.find((j) => j.id === id) as Record<string, any> | undefined;
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`Timed out; last: ${JSON.stringify(v).slice(0, 500)}`);
    await sleep(25);
  }
}
/** The events of a stream until `stop` accepts them (or it closes), then the stream is cancelled. */
async function readEvents(t: App, path: string, stop: (events: { event: string; data: any }[]) => boolean) {
  const res = await t.req(path);
  expect(res.status).toBe(200);
  const reader = res.body!.getReader(), decoder = new TextDecoder(), events: { event: string; data: any }[] = [];
  let buffer = "";
  while (!stop(events)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      const event = /^event: ?(.*)$/m.exec(block)?.[1], data = /^data: ?(.*)$/m.exec(block)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return events;
}

describe("the activity list", () => {
  it("answers this process's instance, the clock, the time limit and the slots, with no job at first", async () => {
    const t = makeApp();
    const a = await activity(t), b = await activity(t);
    expect(a.instance).toMatch(/^[0-9a-f]{16}$/);
    expect(b.instance, "the same process answers the same instance").toBe(a.instance);
    expect((await activity(makeApp())).instance, "another process, another instance").not.toBe(a.instance);
    expect(a.now).toMatch(ISO_MS);
    expect(a).toMatchObject({ timeoutMs: 1_200_000, slots: { total: 3, busy: 0, waiting: 0 }, jobs: [] });
  });

  it("lists a running scan, then the finished scan with its card and options, until the keep time has passed; the scan stays usable", async () => {
    const t = makeApp({ stepMs: 150, keepMs: 1000 });
    const dir = gitRepo();
    const started = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    expect(started.status).toBe(202);
    const id = started.body.scanId as string;
    // A second scan of the folder names the one to follow.
    expect(await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }))).toEqual({ status: 409, body: { error: "A scan of this folder is already running", scanId: id } });

    const running = jobOf(await until(() => activity(t), (x) => !!jobOf(x, id)?.message), id)!;
    expect(running).toMatchObject({ type: "scan", events: `/api/scans/${id}/events`, status: "running", endedAt: null, card: null, options: null, link: null, cached: false });
    expect(running.createdAt).toMatch(ISO_MS); expect(running.startedAt).toMatch(ISO_MS);
    expect(running.name, "before success, the folder's last segment").toBe(dir.split(/[\\/]/).pop());
    expect((await activity(t)).slots).toMatchObject({ busy: 1, waiting: 0 });

    const done = (await t.scans.wait(id))!;
    const act = await activity(t);
    const { type: _type, events: _events, ...record } = jobOf(act, id)!;
    expect(record, "the listed job is the scan's record").toEqual((await json(await t.req(`/api/scans/${id}`))).body);
    expect(record).toMatchObject({ status: "succeeded", card: done.card, options: done.options, name: done.card!.name, message: "Done" });
    expect(record.endedAt).toMatch(ISO_MS);
    expect(Date.parse(record.endedAt) >= Date.parse(record.startedAt)).toBe(true);
    expect(act.slots.busy).toBe(0);

    // A finished scan's stream replays every line, then `done` with the card.
    const events = await readEvents(t, `/api/scans/${id}/events`, (e) => e.some((x) => x.event === "done"));
    expect(events.filter((e) => e.event === "progress").map((e) => e.data.message)).toEqual(done.progress);
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "succeeded", card: done.card } });

    await sleep(1100);
    expect(jobOf(await activity(t), id), "no longer listed after the keep time").toBeUndefined();
    expect(t.scans.succeeded(id), "still what a draw can follow").not.toBeNull();
    expect((await t.req(`/api/scans/${id}`)).status).toBe(200);
  });

  it("lists a cached scan from the moment it is accepted, started when it was created", async () => {
    const t = makeApp();
    const dir = gitRepo();
    await t.scans.wait((await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }))).body.scanId);
    const again = (await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }))).body.scanId as string;
    const job = jobOf(await activity(t), again)!;
    expect(job).toMatchObject({ type: "scan", status: "succeeded", cached: true, message: job.progress[0] });
    expect(job.startedAt).toBe(job.createdAt);
  });

  it("lists a running draw with its folder, scan and choices, replays its past lines, then lists it finished until the keep time; other runs are no job", async () => {
    const t = makeApp({ stepMs: 1, keepMs: 1000 });
    const dir = gitRepo();
    const scanId = (await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }))).body.scanId as string;
    const scan = (await t.scans.wait(scanId))!;
    const draw = (body: object) => t.req("/api/runs", { method: "POST", json: { kind: "draw", scan: scanId, channel: "readme", ...body } });
    const started = await json(await draw({ focus: { kind: "typed", text: "Hold [fixture:slow]" } }));
    expect(started.status).toBe(202);
    const runId = started.body.runId as string;
    expect(await json(await draw({ focus: { kind: "whole" } }))).toEqual({ status: 409, body: { error: "A drawing of this folder is already being made", runId } });

    // An instruction run of the editor is no job.
    const { file } = shopRepo();
    const diagramId = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const refineId = (await json(await t.req("/api/runs", { method: "POST", json: { diagramId, view: "overview", instruction: "add Cache" } }))).body.runId as string;

    const act = await until(() => activity(t), (x) => !!jobOf(x, runId)?.message);
    expect(act.jobs.map((j: { id: string }) => j.id), "newest first; the refine is not listed").toEqual([runId, scanId]);
    const job = jobOf(act, runId)!;
    expect(job).toMatchObject({ type: "draw", kind: "draw", events: `/api/runs/${runId}/events`, status: "running", endedAt: null, scan: scanId, name: scan.card!.name, folder: scan.folder, root: scan.root, link: null, channel: "readme" });
    expect(job.choices.map((c: { status: string }) => c.status)).toEqual(["running"]);
    expect(job.createdAt).toMatch(ISO_MS);
    const { type: _type, events: _events, ...record } = job;
    expect(record).toEqual((await json(await t.req(`/api/runs/${runId}`))).body);
    expect((await t.runs.wait(refineId))!.status).toBe("succeeded");
    expect((await activity(t)).slots, "the running draw holds an engine").toMatchObject({ busy: 1, waiting: 0 });

    // Following it again replays the lines it has said, then goes on.
    const said = t.runs.get(runId)!.progress;
    const replay = await readEvents(t, `/api/runs/${runId}/events`, (e) => e.length >= said.length);
    expect(replay.slice(0, said.length).map((e) => e.data.message)).toEqual(said);
    expect(replay.some((e) => e.event === "done")).toBe(false);

    expect((await json(await t.req(`/api/runs/${runId}/cancel`, { method: "POST" }))).status).toBe(200);
    await t.runs.wait(runId);
    const ended = jobOf(await activity(t), runId)!;
    expect(ended).toMatchObject({ status: "cancelled" });
    expect(ended.endedAt).toMatch(ISO_MS);
    const past = await readEvents(t, `/api/runs/${runId}/events`, (e) => e.some((x) => x.event === "done"));
    expect(past.at(-1)).toMatchObject({ event: "done", data: { status: "cancelled" } });

    await sleep(1100);
    expect(jobOf(await activity(t), runId), "forgotten after the keep time").toBeUndefined();
    expect((await t.req(`/api/runs/${runId}`)).status).toBe(404);
    expect((await t.req(`/api/runs/${runId}/events`)).status).toBe(404);
  });

  it("orders jobs newest first, equal times by id", async () => {
    const t = makeApp();
    const a = gitRepo(), b = gitRepo();
    const first = (await json(await t.req("/api/scans", { method: "POST", json: { folder: a } }))).body.scanId;
    const second = (await json(await t.req("/api/scans", { method: "POST", json: { folder: b } }))).body.scanId;
    await t.scans.wait(first); await t.scans.wait(second);
    expect((await activity(t)).jobs.map((j: { id: string }) => j.id)).toEqual([second, first]);
  });
});

describe("the keep time", () => {
  it("is ARCHDRAW_JOB_KEEP_MS, one hour by default and at least a second (testing contract)", () => {
    expect(loadConfig({}).jobKeepMs).toBe(3_600_000);
    expect(loadConfig({ ARCHDRAW_JOB_KEEP_MS: "3000" }).jobKeepMs).toBe(3000);
    expect(loadConfig({ ARCHDRAW_JOB_KEEP_MS: "10" }).jobKeepMs).toBe(1000);
    expect(loadConfig({ ARCHDRAW_JOB_KEEP_MS: "soon" }).jobKeepMs).toBe(3_600_000);
  });
});
