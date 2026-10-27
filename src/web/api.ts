import type { Changes } from "../core/diff";
import type { Document4 } from "../core/file4";
import type { RunScope } from "../core/repair";

export interface EngineModel { id: string; label: string }
export interface EngineInfo { id: string; label: string; available: boolean; version: string | null; detail: string; test: boolean; models: EngineModel[] }
export interface DiagramSummary { id: string; title: string; path: string | null; root: string | null; link?: string | null; updatedAt: string }
export type ScanType = "agent" | "backend" | "fullstack" | "other";
export interface RepoCard { name: string; sentence: string; type: ScanType; languages: string[]; entryPoints: string[] }
export interface FocusOption { id: string; kind: "section" | "flow"; title: string; sentence: string; files: string[] }
/** `POST /api/folders/check`: the folder as resolved (a link's copy for a link), and whether a copy of it is on disk. */
export interface FolderCheck { folder: string; root: string; git: boolean; drawing: string | null; link: string | null; branch: string | null; copied: boolean }
/** What a scan starts from: a folder, or a repository link (api contract, Folders). */
export type ScanTarget = { folder: string } | { link: string };
/** `POST /api/folders/pick` (api contract, The folder dialog). */
export type PickAnswer = ({ status: "picked" } & FolderCheck) | { status: "cancelled" } | { status: "unavailable" };
export interface ScanRecord {
  id: string; status: "running" | "succeeded" | "failed" | "cancelled"; progress: string[]; folder: string; root: string; commit: string | null;
  cached: boolean; card: RepoCard | null; options: FocusOption[] | null; warnings: string[]; error: string | null; link?: string | null;
}
export type DrawFocus = { kind: "option"; option: string } | { kind: "whole" } | { kind: "typed"; text: string };
export type DrawChannel = "linkedin" | "readme" | "presentation";
/** One choice of a draw run as its record lists it (api contract, Run record). */
export interface DrawChoiceState {
  id: string; kind: "system" | "section" | "flow" | "custom"; title: string; status: "waiting" | "running" | "done" | "failed" | "cancelled"; stage: "read" | "overview" | "channel" | null;
  error?: string | null; startedAt?: string | null; endedAt?: string | null; lastEngineEventAt?: string | null; filesRead?: number; parts?: number | null;
}
export interface RunRecord {
  id: string; status: "running" | "succeeded" | "failed" | "cancelled"; progress: string[]; diagramId: string | null; error: string | null;
  engine: string; model: string | null; changes: Changes | null; choice?: string; choices?: DrawChoiceState[] | null;
  /** A draw's own fields (api contract, Run record), absent from a record that does not carry them. */
  channel?: string | null; message?: string | null; writing?: boolean; folder?: string | null; root?: string | null; link?: string | null; name?: string | null;
  scan?: string | null; createdAt?: string; startedAt?: string | null; endedAt?: string | null; waiting?: boolean; lastEngineEventAt?: string | null;
}
/** An entry of Recent or Found on this computer (api contract, Recent and found). */
export interface SourceEntry { name: string; path: string; branch: string | null; lastCommitAt: string | null; link: string | null; diagrams: string[]; usedAt: string | null }
export interface Sources { picker: boolean; recent: SourceEntry[]; found: SourceEntry[]; foundAt: string }
export interface Health { ok: boolean; app: string; version: string; build: string }
/** What every job record carries for the activity list (api contract, Scan record, Run record). */
export interface JobFields { message: string | null; name: string | null; createdAt: string; startedAt: string | null; endedAt: string | null; link: string | null; events: string; waiting?: boolean }
/** A job of `GET /api/activity`: a scan or a draw run, its record with `type` and `events` added. */
export type Job =
  | (ScanRecord & JobFields & { type: "scan"; name: string })
  | (RunRecord & JobFields & { type: "draw"; kind: "draw"; folder: string; root: string; scan: string });
/** `GET /api/activity` (api contract, Activity). */
export interface Activity { instance: string; now: string; timeoutMs: number; slots: { total: number; busy: number; waiting: number }; jobs: Job[] }
export interface RunStart { engine: string | null; model: string | null; scope: RunScope; kind?: "refine" | "post" | "simplify" | "story" | "revise"; format?: string; readCode?: boolean; image?: string }

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown> | null = null) {
    super(message);
  }
}

const token = () => document.querySelector<HTMLMetaElement>('meta[name="archdraw-token"]')?.content ?? "";

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { ...headers };
  if (method !== "GET") h["X-Archdraw-Token"] = token();
  if (body !== undefined) h["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Could not reach the archdrawer server");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = typeof data?.error === "string" ? data.error : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, res.status === 403 && /token/i.test(msg) ? "The server restarted — reload the page" : msg, data);
  }
  return data as T;
}

export const api = {
  health: () => call<Health>("GET", "/api/health"),
  engines: () => call<{ engines: EngineInfo[] }>("GET", "/api/engines").then((r) => r.engines),
  list: () => call<{ diagrams: DiagramSummary[] }>("GET", "/api/diagrams").then((r) => r.diagrams),
  /** The home screen's Recent and Found on this computer. */
  sources: () => call<Sources>("GET", "/api/sources"),
  /** Make the found list again now; answers as `sources()`. */
  refreshSources: () => call<Sources>("POST", "/api/sources/refresh"),
  forgetSource: (path: string, deleteCopy: boolean) => call<{ ok: true; deleted: boolean }>("POST", "/api/sources/forget", { path, deleteCopy }),
  get: (id: string) => call<Document4>("GET", `/api/diagrams/${encodeURIComponent(id)}`),
  /** Save; `base` is the `updatedAt` the edit started from (409 when the file moved on). */
  save: (doc: Document4, base: string | null) =>
    call<{ ok: true; updatedAt: string }>("PUT", `/api/diagrams/${encodeURIComponent(doc.id)}`, doc, base ? { "If-Unmodified-Since-Version": base } : {}),
  /** The paths among `files` that are not in the drawing's repository. */
  checkFiles: (id: string, files: string[]) =>
    call<{ missing: string[] }>("POST", `/api/diagrams/${encodeURIComponent(id)}/check-files`, { files }).then((r) => r.missing),
  import: (doc: unknown) => call<{ id: string }>("POST", "/api/diagrams", doc).then((r) => r.id),
  example: () => call<{ id: string }>("POST", "/api/example").then((r) => r.id),
  forget: (id: string, deleteCopy = false) => call<void>("DELETE", `/api/diagrams/${encodeURIComponent(id)}${deleteCopy ? "?deleteCopy=true" : ""}`),
  request: (id: string, choice: string, channel: string, view: string, text: string) => call<{ id: string }>("POST", `/api/diagrams/${encodeURIComponent(id)}/requests`, { choice, channel, view, text }),
  startRun: (diagramId: string, choice: string, channel: string, view: string | null, instruction: string, o: RunStart) =>
    call<{ runId: string }>("POST", "/api/runs", {
      diagramId, choice, ...(o.kind === "post" ? {} : { channel }), ...(view === null ? {} : { view }), instruction, engine: o.engine, model: o.model, scope: o.scope, ...(o.kind ? { kind: o.kind } : {}), ...(o.format ? { format: o.format } : {}), ...(o.readCode === false ? { readCode: false } : {}), ...(o.image ? { image: o.image } : {}),
    }).then((r) => r.runId),
  run: (id: string) => call<RunRecord>("GET", `/api/runs/${id}`),
  cancelRun: (id: string) => call<{ ok: true }>("POST", `/api/runs/${id}/cancel`),
  /** Register a drawing file by its path (POST /api/files). */
  openFile: (path: string) => call<{ id: string; url: string }>("POST", "/api/files", { path }).then((r) => r.id),
  checkFolder: (target: ScanTarget) => call<FolderCheck>("POST", "/api/folders/check", target),
  /** The system's folder dialog; answers when it closes. */
  pickFolder: () => call<PickAnswer>("POST", "/api/folders/pick", {}),
  startScan: (target: ScanTarget, o: { engine: string | null; model: string | null; refresh?: boolean }) =>
    call<{ scanId: string }>("POST", "/api/scans", { ...target, engine: o.engine, model: o.model, ...(o.refresh ? { refresh: true } : {}) }).then((r) => r.scanId),
  scan: (id: string) => call<ScanRecord>("GET", `/api/scans/${id}`),
  cancelScan: (id: string) => call<{ ok: true }>("POST", `/api/scans/${id}/cancel`),
  startDraw: (body: { scan: string; choices: DrawFocus[]; channel: DrawChannel; engine: string | null; model: string | null }) =>
    call<{ runId: string }>("POST", "/api/runs", { kind: "draw", ...body }).then((r) => r.runId),
  /** `Try again`: a new draw run from a draw that has ended (api contract, Trying again). */
  retryDraw: (runId: string) => call<{ runId: string }>("POST", `/api/runs/${runId}/retry`).then((r) => r.runId),
  /** Add choices to a running draw of the same folder; they take its channel, engine and model (api contract, Joining a running draw). */
  joinDraw: (runId: string, body: { scan: string; choices: DrawFocus[] }) =>
    call<{ runId: string; choices: string[] }>("POST", `/api/runs/${runId}/choices`, body),
  /** The running and recently ended scans and draws, newest first (api contract, Activity). */
  activity: () => call<Activity>("GET", "/api/activity"),
};
