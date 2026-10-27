import type { DrawChannel, DrawChoiceState, Job } from "../api";

/**
 * What the home screen says of a job (ui contract, *Following a job*, *Activity*): a draw's rows and their stages,
 * each row's line, the quiet notice, the Ready line, and each Activity row's status. Pure: every time is given.
 */

export const STAGES = ["read", "overview", "channel"] as const;
export type Stage = (typeof STAGES)[number];
export const CHANNELS: { id: DrawChannel; label: string; size: string; summary: string; name: string; page: { w: number; h: number } }[] = [
  { id: "linkedin", label: "LinkedIn post", size: "1080 × 1350", summary: " for a LinkedIn post", name: "LinkedIn post", page: { w: 44, h: 55 } },
  { id: "readme", label: "README drawing", size: "wide · light or dark", summary: " for a README", name: "README drawing", page: { w: 96, h: 40 } },
  { id: "presentation", label: "Presentation", size: "16 : 9 slides", summary: " for a presentation", name: "presentation", page: { w: 80, h: 45 } },
];
export const channelOf = (id: string | null | undefined) => CHANNELS.find((c) => c.id === id) ?? null;
/** A choice is quiet once no engine line came for this long. */
export const QUIET_MS = 30_000;

/** A row of a followed draw: its choice record, plus what its stream said of it. */
export interface Row extends DrawChoiceState {
  /** Progress events of this choice received so far (`draw-choice-pulse`'s `data-events`). */
  events: number;
  /** The message of its latest progress event. */
  message: string | null;
  /** The `at` of its latest progress event whose source is the engine. */
  engineAt: string | null;
}
export const rowOf = (c: DrawChoiceState, before?: Row): Row => ({ events: 0, message: null, engineAt: null, ...before, ...c });

const STATUS_RANK: Record<DrawChoiceState["status"], number> = { waiting: 0, running: 1, done: 2, failed: 2, cancelled: 2 };
const progressKey = (c: DrawChoiceState) => [STATUS_RANK[c.status], c.stage ? STAGES.indexOf(c.stage) : -1, c.filesRead ?? 0, c.parts ?? -1];

/**
 * A choice record from a stream or a record read, laid over the row: kept unless it is behind what the row already
 * shows. A choice only moves on (waiting, running through its stages, ended; files and parts only grow), so a past
 * event replayed by a stream opened late never takes a row back.
 */
export function mergeChoice(row: Row | undefined, c: DrawChoiceState): Row {
  if (!row) return rowOf(c);
  const a = progressKey(row), b = progressKey(c);
  for (let i = 0; i < a.length; i++) { if (b[i] > a[i]) break; if (b[i] < a[i]) return row; }
  return rowOf(c, row);
}
/** The rows after a list of choice records: each laid over its row, new ones added at the end, in the record's order. */
export function mergeRows(rows: Row[], choices: DrawChoiceState[]): Row[] {
  const by = new Map(rows.map((r) => [r.id, r]));
  const out = choices.map((c) => mergeChoice(by.get(c.id), c));
  return [...out, ...rows.filter((r) => !choices.some((c) => c.id === r.id))];
}

/** A row's stage as the screen shows it (ui contract, `draw-stage`). */
export function stageState(row: DrawChoiceState, s: Stage): "waiting" | "running" | "done" | "failed" {
  if (row.status === "done") return "done";
  if (row.status === "waiting" || !row.stage) return "waiting";
  const at = STAGES.indexOf(row.stage), me = STAGES.indexOf(s);
  if (me < at) return "done";
  if (me > at) return "waiting";
  return row.status === "running" ? "running" : "failed";
}
export function stageText(row: DrawChoiceState, s: Stage, channel: string | null | undefined): string {
  if (s === "read") return "Reading the code";
  if (s === "overview") return row.kind === "system" ? "Drawing the map" : "Drawing the overview";
  return `Drawing the ${channelOf(channel)?.name ?? "drawing"}`;
}

/** `mm:ss`, minutes past 59 allowed. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** `draw-choice-time`: from its start, every second while it runs; start to end once ended; nothing while it waits. */
export function choiceTime(row: DrawChoiceState, now: number): string {
  const start = at(row.startedAt);
  if (row.status === "waiting" || Number.isNaN(start)) return "";
  const end = row.status === "running" ? now : at(row.endedAt);
  return Number.isNaN(end) ? "" : clockText(end - start);
}

/** Whole seconds since the engine last spoke for a running choice, once that is 30 s or more; else null. */
export function quietSeconds(row: Row, now: number): number | null {
  if (row.status !== "running") return null;
  const last = Math.max(...[row.engineAt, row.lastEngineEventAt, row.startedAt].map(at).filter((t) => !Number.isNaN(t)));
  if (!Number.isFinite(last) || now - last < QUIET_MS) return null;
  return Math.floor((now - last) / 1000);
}
export const quietText = (s: number, timeoutMs: number | null) =>
  `Quiet for ${s} s — still running${timeoutMs ? ` (limit ${Math.floor(timeoutMs / 60_000)} min)` : ""}`;

export const filesText = (n: number) => (n === 1 ? "1 file read" : `${n} files read`);
export const partsText = (n: number) => (n === 1 ? "1 part found" : `${n} parts found`);
/** `draw-choice-line` of a row that is not running. */
export function endedLine(row: DrawChoiceState, drawRuns: boolean): string {
  if (row.status === "waiting") return drawRuns ? "Waiting for a free engine" : "Not started";
  if (row.status === "done") return `Drawn${row.parts != null ? ` · ${row.parts} parts` : ""}`;
  if (row.status === "failed") return `Could not draw: ${row.error ?? "unknown error"}`;
  return "Cancelled";
}

/** `draw-ready`'s sentence after `Ready`: the drawings made, where they go, and how many could not be drawn. */
export function readyText(rows: DrawChoiceState[], channel: string | null | undefined): string {
  const k = rows.filter((r) => r.status === "done").length, f = rows.filter((r) => r.status === "failed").length;
  return `${k} ${k === 1 ? "drawing" : "drawings"}${channelOf(channel)?.summary ?? ""}${f ? ` · ${f} could not be drawn` : ""}`;
}
/** Where `Open` goes for a draw that succeeded. */
export const openUrl = (diagramId: string, choice: string | null | undefined, channel: string | null | undefined) =>
  `/d/${diagramId}?choice=${encodeURIComponent(choice ?? "")}&channel=${encodeURIComponent(channel ?? "")}`;

/** A job's `data-state`: `waiting` while it waits for a slot, else its status. */
export const jobState = (j: Job) => (j.status === "running" && j.waiting === true ? "waiting" : j.status);
/** Activity's order: the running jobs, newest `createdAt` first, then the ended ones, newest `endedAt` first. */
export function orderJobs(jobs: Job[]): { running: Job[]; done: Job[] } {
  const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
  return {
    running: jobs.filter((j) => j.status === "running").sort((a, b) => t(b.createdAt) - t(a.createdAt)),
    done: jobs.filter((j) => j.status !== "running").sort((a, b) => t(b.endedAt) - t(a.endedAt)),
  };
}
/** The time a running job shows: from its start, from its acceptance while it has none. */
export const jobTime = (j: Job, now: number) => clockText(now - at(j.startedAt ?? j.createdAt));

/** `activity-job-status` (ui contract, *Activity*). */
export function jobStatus(j: Job, now: number): string {
  if (j.status === "running" && j.waiting === true) return "Waiting for a free engine";
  if (j.type === "scan") {
    if (j.status === "running") return "Scanning";
    if (j.status === "succeeded") return `Scan · ${j.options?.length ?? 0} sections and flows`;
    return j.status === "failed" ? "Scan failed" : "Scan cancelled";
  }
  const choices = j.choices ?? [];
  const prefix = channelOf(j.channel) ? `${channelOf(j.channel)!.label} · ` : "";
  if (j.status === "succeeded") { const f = choices.filter((c) => c.status === "failed").length; return `${prefix}Ready${f ? `, ${f} failed` : ""}`; }
  if (j.status !== "running") return `${prefix}${j.status}`;
  if (j.writing) return `${prefix}writing the drawing`;
  const quiet = Math.max(-1, ...choices.map((c) => quietSeconds(rowOf(c), now) ?? -1));
  if (quiet >= 0) return `${prefix}quiet for ${quiet} s`;
  if (choices.length > 1) return `${prefix}${choices.filter((c) => c.status === "done").length} of ${choices.length} drawn`;
  const one = choices[0];
  const step = !one || !one.stage ? 1 : one.status === "done" ? 3 : STAGES.indexOf(one.stage) + 1;
  return `${prefix}step ${step} of 3`;
}
/** A draw job with a running choice that is quiet (its dot and status turn amber). */
export const jobQuiet = (j: Job, now: number) => j.type === "draw" && j.status === "running" && !j.writing && (j.choices ?? []).some((c) => quietSeconds(rowOf(c), now) !== null);
