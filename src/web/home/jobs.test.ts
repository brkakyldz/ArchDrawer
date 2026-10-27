import { describe, expect, it } from "vitest";
import type { DrawChoiceState, Job } from "../api";
import { choiceTime, clockText, endedLine, jobStatus, mergeRows, orderJobs, quietSeconds, quietText, readyText, rowOf, stageState } from "./jobs";

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const choice = (id: string, more: Partial<DrawChoiceState> = {}): DrawChoiceState => ({ id, kind: "section", title: id, status: "running", stage: "read", startedAt: iso(0), endedAt: null, filesRead: 0, parts: null, ...more });
const draw = (more: Partial<Extract<Job, { type: "draw" }>>): Job => ({
  type: "draw", kind: "draw", id: "r_1", status: "running", progress: [], diagramId: null, error: null, engine: "fixture", model: null, changes: null,
  folder: "/p", root: "/p", scan: "s_1", channel: "linkedin", writing: false, message: null, name: "shop", createdAt: iso(0), startedAt: iso(0), endedAt: null,
  link: null, events: "/api/runs/r_1/events", choices: [], ...more,
});

describe("a draw's rows", () => {
  it("a replayed past event never takes a row back, and a later one moves it on", () => {
    const now = mergeRows([], [choice("a", { stage: "overview", filesRead: 2, parts: 8 })]);
    expect(mergeRows(now, [choice("a", { stage: "read", filesRead: 1 })])[0]).toMatchObject({ stage: "overview", filesRead: 2, parts: 8 });
    expect(mergeRows(now, [choice("a", { stage: "channel", filesRead: 2, parts: 8 })])[0].stage).toBe("channel");
    expect(mergeRows(now, [choice("a", { status: "done", stage: "channel", endedAt: iso(9000) })])[0].status).toBe("done");
  });

  it("keeps what the stream said of a row, and adds a joined choice at the end", () => {
    const rows = [{ ...rowOf(choice("a")), events: 4, message: "Reading src/a.ts" }];
    const next = mergeRows(rows, [choice("a", { filesRead: 1 }), choice("b", { status: "waiting", stage: null, startedAt: null })]);
    expect(next.map((r) => [r.id, r.events, r.message])).toEqual([["a", 4, "Reading src/a.ts"], ["b", 0, null]]);
  });

  it("shows the stages as the contract says, a cancelled read as failed", () => {
    const states = (c: DrawChoiceState) => (["read", "overview", "channel"] as const).map((s) => stageState(c, s));
    expect(states(choice("a", { status: "waiting", stage: null }))).toEqual(["waiting", "waiting", "waiting"]);
    expect(states(choice("a", { stage: "overview" }))).toEqual(["done", "running", "waiting"]);
    expect(states(choice("a", { status: "cancelled", stage: "read" }))).toEqual(["failed", "waiting", "waiting"]);
    expect(states(choice("a", { status: "done", stage: "channel" }))).toEqual(["done", "done", "done"]);
  });

  it("counts a running row's time to now, an ended one's to its end, and none while it waits", () => {
    expect(clockText(65_400)).toBe("01:05"); expect(clockText(61 * 60_000)).toBe("61:00");
    expect(choiceTime(choice("a"), T0 + 7_900)).toBe("00:07");
    expect(choiceTime(choice("a", { status: "done", endedAt: iso(12_000) }), T0 + 99_000)).toBe("00:12");
    expect(choiceTime(choice("a", { status: "waiting", stage: null, startedAt: null }), T0 + 5_000)).toBe("");
  });

  it("says a row is quiet from the latest engine line it heard, else its record's, else its start", () => {
    const row = rowOf(choice("a", { lastEngineEventAt: iso(10_000) }));
    expect(quietSeconds(row, T0 + 39_000)).toBeNull();
    expect(quietSeconds(row, T0 + 41_500)).toBe(31);
    expect(quietSeconds({ ...row, engineAt: iso(20_000) }, T0 + 41_500)).toBeNull();
    expect(quietSeconds(rowOf(choice("a")), T0 + 30_000)).toBe(30);
    expect(quietSeconds(rowOf(choice("a", { status: "done" })), T0 + 90_000)).toBeNull();
    expect(quietText(31, 600_000)).toBe("Quiet for 31 s — still running (limit 10 min)");
  });

  it("writes an ended row's line and the Ready sentence", () => {
    expect(endedLine(choice("a", { status: "done", parts: 8 }), false)).toBe("Drawn · 8 parts");
    expect(endedLine(choice("a", { status: "failed", error: "Boom" }), false)).toBe("Could not draw: Boom");
    expect(endedLine(choice("a", { status: "waiting" }), true)).toBe("Waiting for a free engine");
    expect(endedLine(choice("a", { status: "waiting" }), false)).toBe("Not started");
    expect(endedLine(choice("a", { status: "cancelled" }), false)).toBe("Cancelled");
    expect(readyText([choice("a", { status: "done" }), choice("b", { status: "failed" })], "linkedin")).toBe("1 drawing for a LinkedIn post · 1 could not be drawn");
    expect(readyText([choice("a", { status: "done" }), choice("b", { status: "done" })], "readme")).toBe("2 drawings for a README");
  });
});

describe("Activity", () => {
  it("lists the running jobs newest first, then the ended ones by their end, newest first", () => {
    const jobs = [draw({ id: "a", createdAt: iso(1) }), draw({ id: "b", status: "succeeded", endedAt: iso(50) }), draw({ id: "c", createdAt: iso(5) }), draw({ id: "d", status: "failed", endedAt: iso(90) })];
    const { running, done } = orderJobs(jobs);
    expect(running.map((j) => j.id)).toEqual(["c", "a"]); expect(done.map((j) => j.id)).toEqual(["d", "b"]);
  });

  it("says where a draw is after its channel's name", () => {
    const now = T0 + 5_000;
    expect(jobStatus(draw({ choices: [choice("a", { stage: "overview" })] }), now)).toBe("LinkedIn post · step 2 of 3");
    expect(jobStatus(draw({ choices: [choice("a", { status: "done" }), choice("b")] }), now)).toBe("LinkedIn post · 1 of 2 drawn");
    expect(jobStatus(draw({ writing: true, choices: [choice("a", { status: "done" })] }), now)).toBe("LinkedIn post · writing the drawing");
    expect(jobStatus(draw({ channel: "readme", choices: [choice("a"), choice("b", { lastEngineEventAt: iso(-40_000) })] }), T0 + 45_000)).toBe("README drawing · quiet for 45 s");
    expect(jobStatus(draw({ status: "succeeded", choices: [choice("a", { status: "done" }), choice("b", { status: "failed" })] }), now)).toBe("LinkedIn post · Ready, 1 failed");
    expect(jobStatus(draw({ status: "cancelled" }), now)).toBe("LinkedIn post · cancelled");
    expect(jobStatus(draw({ waiting: true }), now)).toBe("Waiting for a free engine");
  });

  it("says where a scan is", () => {
    const scan = (more: object) => ({ type: "scan", id: "s", status: "running", options: null, ...more }) as unknown as Job;
    expect(jobStatus(scan({}), T0)).toBe("Scanning");
    expect(jobStatus(scan({ waiting: true }), T0)).toBe("Waiting for a free engine");
    expect(jobStatus(scan({ status: "succeeded", options: [{}, {}, {}] }), T0)).toBe("Scan · 3 sections and flows");
    expect(jobStatus(scan({ status: "failed" }), T0)).toBe("Scan failed");
    expect(jobStatus(scan({ status: "cancelled" }), T0)).toBe("Scan cancelled");
  });
});
