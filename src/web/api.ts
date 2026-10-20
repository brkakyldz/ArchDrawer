import type { Changes } from "../core/diff";
import type { DiagramDocument } from "../core/model";
import type { RunScope } from "../core/repair";

export interface EngineModel { id: string; label: string }
export interface EngineInfo { id: string; label: string; available: boolean; version: string | null; detail: string; test: boolean; models: EngineModel[] }
export interface DiagramSummary { id: string; title: string; path: string | null; updatedAt: string }
export interface RunRecord {
  id: string; status: "running" | "succeeded" | "failed" | "cancelled"; progress: string[]; diagramId: string | null; error: string | null;
  engine: string; model: string | null; changes: Changes | null;
}
export interface Health { ok: boolean; app: string; version: string; build: string }
export interface RunStart { engine: string | null; model: string | null; scope: RunScope; kind?: "refine" | "post" | "simplify"; format?: string }

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
  get: (id: string) => call<DiagramDocument>("GET", `/api/diagrams/${encodeURIComponent(id)}`),
  /** Save; `base` is the `updatedAt` the edit started from (409 when the file moved on). */
  save: (doc: DiagramDocument, base: string | null) =>
    call<{ ok: true; updatedAt: string }>("PUT", `/api/diagrams/${encodeURIComponent(doc.id)}`, doc, base ? { "If-Unmodified-Since-Version": base } : {}),
  /** The paths among `files` that are not in the drawing's repository. */
  checkFiles: (id: string, files: string[]) =>
    call<{ missing: string[] }>("POST", `/api/diagrams/${encodeURIComponent(id)}/check-files`, { files }).then((r) => r.missing),
  import: (doc: unknown) => call<{ id: string }>("POST", "/api/diagrams", doc).then((r) => r.id),
  example: () => call<{ id: string }>("POST", "/api/example").then((r) => r.id),
  forget: (id: string) => call<void>("DELETE", `/api/diagrams/${encodeURIComponent(id)}`),
  request: (id: string, view: string, text: string) => call<{ id: string }>("POST", `/api/diagrams/${encodeURIComponent(id)}/requests`, { view, text }),
  startRun: (diagramId: string, view: string, instruction: string, o: RunStart) =>
    call<{ runId: string }>("POST", "/api/runs", {
      diagramId, view, instruction, engine: o.engine, model: o.model, scope: o.scope, ...(o.kind ? { kind: o.kind } : {}), ...(o.format ? { format: o.format } : {}),
    }).then((r) => r.runId),
  run: (id: string) => call<RunRecord>("GET", `/api/runs/${id}`),
  cancelRun: (id: string) => call<{ ok: true }>("POST", `/api/runs/${id}/cancel`),
};
