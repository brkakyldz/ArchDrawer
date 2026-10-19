import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { renderMermaid } from "../core/export/mermaid";
import { DEFAULT_SHARE, FORMAT_IDS, renderShare, type FormatId } from "../core/export/share";
import { LIMITS, THEMES, type Theme } from "../core/model";
import type { RunScope } from "../core/repair";
import { APP_ROOT } from "./config";
import type { Config } from "./config";
import { FileError, nowIso, type Store } from "./store";
import type { RunManager } from "./runs";
import type { Engine, EngineInfo } from "./engines/types";

export interface AppDeps {
  config: Config;
  store: Store;
  runs: RunManager;
  engines: Map<string, Engine>;
  token: string;
  /** Called after `POST /api/shutdown` has answered. */
  onShutdown?: () => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

/** The Host/Origin half of the envelope; a message when the request must get 403, else null. */
export function envelopeError(port: number, host: string | undefined, origin: string | undefined): string | null {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes((host ?? "").toLowerCase())) return "Forbidden host";
  if (origin !== undefined && !hosts.some((h) => `http://${h}` === origin.toLowerCase())) return "Forbidden origin";
  return null;
}

/** The HTTP surface of docs/contracts/api.md, as a Hono app (testable with app.request). */
export function createApp(deps: AppDeps): Hono {
  const { config, store, runs, engines, token } = deps;
  const app = new Hono();
  type Status = 400 | 403 | 404 | 409 | 413 | 500;
  const err = (c: Context, status: Status, message: string, extra: Record<string, unknown> = {}) => c.json({ error: message, ...extra }, status);

  // Security envelope: Host allow-list against DNS rebinding, foreign Origin refused, token on mutations.
  app.use("*", async (c, next) => {
    const refused = envelopeError(config.port, c.req.header("host"), c.req.header("origin"));
    if (refused) return err(c, 403, refused);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(c.req.method) && c.req.header("x-archdraw-token") !== token) {
      return err(c, 403, "Missing or wrong token");
    }
    await next();
  });
  app.use("/api/*", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => err(c, 413, "Request body too large") }));

  const detected = new Map<string, { at: number; info: Promise<EngineInfo> }>();
  const detect = (e: Engine) => {
    const hit = detected.get(e.id);
    if (hit && Date.now() - hit.at < 60_000) return hit.info;
    const info = e.detect().catch((x: Error): EngineInfo => ({ id: e.id, label: e.label, available: false, version: null, detail: `Detection failed: ${x.message}`, test: e.id === "fixture", models: [] }));
    detected.set(e.id, { at: Date.now(), info });
    return info;
  };

  const readJson = async (c: Context): Promise<unknown> => {
    try { return await c.req.json(); } catch { return undefined; }
  };
  /** The stored document, or the error response for a missing or unreadable one. */
  const load = (c: Context, id: string) => {
    const r = store.read(id);
    if (!r) return { res: err(c, 404, "Diagram not found") };
    if (!r.ok) return { res: err(c, 400, r.error, { errors: r.errors }) };
    return { doc: r.doc };
  };

  app.get("/api/health", (c) => c.json({ ok: true, app: "archdrawer", version: config.version, build: config.build }));

  app.get("/api/engines", async (c) => c.json({ engines: await Promise.all([...engines.values()].map(detect)) }));

  app.get("/api/diagrams", (c) => c.json({ diagrams: store.list() }));

  app.post("/api/files", async (c) => {
    const body = await readJson(c);
    const path = body && typeof body === "object" ? (body as { path?: unknown }).path : undefined;
    if (typeof path !== "string" || !path.trim()) return err(c, 400, "Give the absolute path of a drawing file");
    try {
      const doc = store.register(path.trim());
      return c.json({ id: doc.id, url: `http://127.0.0.1:${config.port}/d/${doc.id}` });
    } catch (e) {
      if (e instanceof FileError) return err(c, 400, e.message, e.errors.length ? { errors: e.errors } : {});
      throw e;
    }
  });

  app.post("/api/diagrams", async (c) => {
    const body = await readJson(c);
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(c, 400, "Invalid diagram — expected a JSON object");
    const r = store.import(body);
    return r.ok ? c.json({ id: r.id }, 201) : err(c, 400, r.error, { errors: r.errors });
  });

  // The bundled example, imported as a new document (an empty library offers it, ui contract Library).
  app.post("/api/example", (c) => {
    const r = store.import(JSON.parse(readFileSync(join(APP_ROOT, "examples", "shop.archdraw.json"), "utf8")));
    return r.ok ? c.json({ id: r.id }, 201) : err(c, 500, r.error);
  });

  app.get("/api/diagrams/:id", (c) => {
    const { doc, res } = load(c, c.req.param("id"));
    return doc ? c.json(doc) : res!;
  });

  app.put("/api/diagrams/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.exists(id)) return err(c, 404, "Diagram not found");
    const body = await readJson(c);
    if (!body || typeof body !== "object") return err(c, 400, "Invalid diagram — expected a JSON object");
    const r = store.put(id, body, { base: c.req.header("if-unmodified-since-version") ?? null });
    if (!r) return err(c, 404, "Diagram not found");
    if (r.ok) return c.json({ ok: true, updatedAt: r.updatedAt });
    if (r.conflict) return err(c, 409, "The drawing changed since you opened it", { updatedAt: r.updatedAt });
    return err(c, 400, r.error, { errors: r.errors });
  });

  app.delete("/api/diagrams/:id", (c) => (store.delete(c.req.param("id")) ? c.body(null, 204) : err(c, 404, "Diagram not found")));

  app.get("/api/diagrams/:id/events", (c) => {
    const id = c.req.param("id");
    if (!store.exists(id)) return err(c, 404, "Diagram not found");
    return streamSSE(c, async (stream) => {
      await new Promise<void>((done) => {
        let chain = Promise.resolve();
        const on = (changed: string, updatedAt: string) => {
          if (changed !== id) return;
          chain = chain.then(() => stream.writeSSE({ event: "changed", data: JSON.stringify({ updatedAt }) })).catch(() => {});
        };
        store.on("changed", on);
        // A comment line now and then keeps proxies and the browser from closing an idle stream.
        const ping = setInterval(() => { chain = chain.then(() => stream.write(": ping\n\n")).then(() => {}).catch(() => {}); }, 20_000);
        stream.onAbort(() => { store.off("changed", on); clearInterval(ping); done(); });
      });
    });
  });

  app.get("/api/diagrams/:id/export.svg", (c) => {
    const { doc, res } = load(c, c.req.param("id"));
    if (!doc) return res!;
    const viewId = c.req.query("view") || doc.views[0].id;
    if (!doc.views.some((v) => v.id === viewId)) return err(c, 400, `Unknown view "${viewId}"`);
    const format = (c.req.query("format") || "linkedin") as FormatId;
    if (!FORMAT_IDS.includes(format)) return err(c, 400, `Unknown format "${format}"; use one of ${FORMAT_IDS.join(", ")}`);
    const q = c.req.query("theme");
    const theme: Theme = THEMES.includes(q as Theme) ? (q as Theme) : doc.theme;
    const view = doc.views.find((v) => v.id === viewId)!;
    const parts = (c.req.query("parts") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = parts.find((p) => !view.nodes.some((n) => n.id === p));
    if (unknown) return err(c, 400, `Unknown component "${unknown}" in the view "${viewId}"`);
    const img = renderShare(doc, viewId, { ...DEFAULT_SHARE, format, theme, parts: parts.length ? parts : null });
    return c.body(img.svg, 200, { "Content-Type": "image/svg+xml; charset=utf-8" });
  });

  app.get("/api/diagrams/:id/export.mmd", (c) => {
    const { doc, res } = load(c, c.req.param("id"));
    if (!doc) return res!;
    const view = doc.views.find((v) => v.id === (c.req.query("view") || doc.views[0].id));
    if (!view) return err(c, 400, `Unknown view "${c.req.query("view")}"`);
    return c.body(renderMermaid(view), 200, { "Content-Type": "text/plain; charset=utf-8" });
  });

  app.post("/api/diagrams/:id/requests", async (c) => {
    const id = c.req.param("id");
    const { doc, res } = load(c, id);
    if (!doc) return res!;
    const body = (await readJson(c)) as { view?: unknown; text?: unknown } | undefined;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const view = typeof body?.view === "string" ? body.view : "";
    if (!text) return err(c, 400, "The instruction is empty");
    if (text.length > LIMITS.request) return err(c, 400, `The instruction is too long (${LIMITS.request} characters at most)`);
    if (!doc.views.some((v) => v.id === view)) return err(c, 400, `Unknown view "${view}"`);
    const used = new Set(doc.requests.map((r) => r.id));
    let n = doc.requests.length + 1;
    while (used.has(`q${n}`)) n++;
    const request = { id: `q${n}`, text, view, at: nowIso() };
    const saved = store.put(id, { ...doc, requests: [...doc.requests, request] }, { announce: true });
    if (!saved?.ok) return err(c, 409, "The drawing could not be saved");
    return c.json({ id: request.id }, 201);
  });

  app.post("/api/runs", async (c) => {
    const body = await readJson(c);
    if (!body || typeof body !== "object") return err(c, 400, "Body must be a JSON object");
    const b = body as Record<string, unknown>;
    if (b.kind !== undefined && b.kind !== "refine" && b.kind !== "post" && b.kind !== "simplify") return err(c, 400, `Unknown run kind ${JSON.stringify(b.kind)}: use refine, post or simplify`);
    const kind = (b.kind as "refine" | "post" | "simplify" | undefined) ?? "refine";
    const formats: readonly string[] = kind === "post" ? ["feed", "linkedin"] : FORMAT_IDS;
    if (b.format !== undefined && !(typeof b.format === "string" && formats.includes(b.format))) return err(c, 400, `Invalid format ${JSON.stringify(b.format)}; use one of ${formats.join(", ")}`);
    const format = (b.format as FormatId | undefined) ?? (kind === "post" ? "feed" : "readme");
    // A report-driven revision round is not enabled yet: `revise: true` is refused.
    if (b.revise !== undefined && typeof b.revise !== "boolean") return err(c, 400, "revise must be true or false");
    if (b.revise === true) return err(c, 400, "Layout revision is not enabled");
    if (kind !== "refine" && b.instruction !== undefined && typeof b.instruction !== "string") return err(c, 400, "instruction must be a string");
    if (kind !== "refine" && b.scope !== undefined && !(typeof b.scope === "object" && b.scope !== null && (b.scope as { kind?: unknown }).kind === "view" && Object.keys(b.scope).length === 1)) {
      return err(c, 400, kind === "post" ? 'A post designs one view: give no scope or {"kind": "view"}' : 'A simplification works on the overview: give no scope or {"kind": "view"}');
    }
    const instruction = typeof b.instruction === "string" ? b.instruction.trim() : "";
    if (!instruction && kind === "refine") return err(c, 400, "Say what to change: the instruction is empty");
    if (instruction.length > LIMITS.request) return err(c, 400, `The instruction is too long (${LIMITS.request} characters at most)`);
    if (b.model !== undefined && b.model !== null && typeof b.model !== "string") return err(c, 400, "model must be a model id or null");
    if (b.engine !== undefined && b.engine !== null && typeof b.engine !== "string") return err(c, 400, "engine must be an engine id or null");
    const model = typeof b.model === "string" && b.model.trim() ? b.model.trim().slice(0, 100) : null;
    // A leading "-" would reach the engine's command line as an option.
    if (model !== null && (model.startsWith("-") || !/^[A-Za-z0-9._:\/@\[\]-]+$/.test(model))) return err(c, 400, `Invalid model name "${model}"`);
    const { doc, res } = load(c, typeof b.diagramId === "string" ? b.diagramId : "");
    if (!doc) return res!;
    const view = typeof b.view === "string" ? b.view : "";
    if (!doc.views.some((v) => v.id === view)) return err(c, 400, `Unknown view "${view}"`);
    if (kind === "simplify" && view !== doc.views[0].id) return err(c, 400, `Only the overview is simplified: give the view "${doc.views[0].id}"`);
    const scope = parseScope(b.scope, doc.views.find((v) => v.id === view)!.nodes.map((n) => n.id));
    if (typeof scope === "string") return err(c, 400, scope);
    let engine: Engine | undefined;
    if (typeof b.engine === "string") {
      engine = engines.get(b.engine);
      if (!engine) return err(c, 400, `Unknown engine "${b.engine}"`);
      const info = await detect(engine);
      if (!info.available) return err(c, 400, `${info.label} is not available: ${info.detail}`);
    } else {
      engine = await defaultEngine(doc.engine?.id ?? null);
      if (!engine) return err(c, 400, "No engine is available: install and log in to Claude Code or Codex");
    }
    if (runs.runningOn(doc.id)) return err(c, 409, "An instruction is already running on this drawing");
    const runId = runs.start({ engine, model, instruction, view, base: doc, scope: kind === "refine" ? scope : { kind: "view" }, format, kind });
    return c.json({ runId }, 202);
  });

  app.get("/api/runs/:id", (c) => {
    const r = runs.get(c.req.param("id"));
    return r ? c.json(r) : err(c, 404, "Run not found");
  });

  /**
   * `engine: null`: the document's engine when it is available and not the fixture, else
   * the first available real engine, else the fixture when it is the only one offered.
   */
  const defaultEngine = async (remembered: string | null): Promise<Engine | undefined> => {
    const infos = await Promise.all([...engines.values()].map(async (e) => ({ e, info: await detect(e) })));
    const ok = infos.filter((x) => x.info.available);
    return (ok.find((x) => x.e.id === remembered && !x.info.test) ?? ok.find((x) => !x.info.test) ?? ok[0])?.e;
  };

  app.get("/api/runs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!runs.get(id)) return err(c, 404, "Run not found");
    return streamSSE(c, async (stream) => {
      await new Promise<void>((done) => {
        let chain = Promise.resolve();
        let unsub: (() => void) | null = null;
        unsub = runs.subscribe(id, (e) => {
          const data = e.type === "progress" ? { message: e.message } : { status: e.status, diagramId: e.diagramId, error: e.error, changes: e.changes, view: e.view, layoutReport: e.layoutReport };
          chain = chain.then(() => stream.writeSSE({ event: e.type, data: JSON.stringify(data) })).catch(() => {});
          if (e.type === "done") void chain.then(() => { unsub?.(); done(); });
        });
        stream.onAbort(() => { unsub?.(); done(); });
      });
    });
  });

  app.post("/api/runs/:id/cancel", (c) => (runs.cancel(c.req.param("id")) ? c.json({ ok: true }) : err(c, 404, "Run not found")));

  app.post("/api/shutdown", (c) => {
    setTimeout(() => deps.onShutdown?.(), 50).unref?.();
    return c.json({ ok: true });
  });

  app.all("/api/*", (c) => err(c, 404, "Not found"));

  // Web client: static files from the build, everything else gets index.html with the token.
  const webRoot = resolve(config.webDir);
  const indexHtml = () => {
    const file = join(webRoot, "index.html");
    const html = existsSync(file)
      ? readFileSync(file, "utf8")
      : `<!doctype html><html><head><title>archdrawer</title></head><body><p>The web client is not built. Run <code>npm run build</code>.</p></body></html>`;
    return html.replace("</head>", `<meta name="archdraw-token" content="${token}"></head>`);
  };
  app.get("*", (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (path !== "/" && !path.endsWith("/")) {
      const file = resolve(webRoot, "." + path);
      if (file.startsWith(webRoot + sep) && existsSync(file) && statSync(file).isFile()) {
        const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
        return c.body(readFileSync(file), 200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": cache });
      }
    }
    return c.html(indexHtml(), 200, { "Cache-Control": "no-store" });
  });

  return app;
}

/** A run's `scope` (api contract): absent → all; a list of component ids must name parts of the view. */
export function parseScope(raw: unknown, inView: string[]): RunScope | string {
  if (raw === undefined || raw === null) return { kind: "all" };
  if (typeof raw !== "object" || Array.isArray(raw)) return 'Invalid scope: give {"kind": "view"}, {"kind": "parts", "ids": [...]} or {"kind": "all"}';
  const s = raw as { kind?: unknown; ids?: unknown };
  if (s.kind === "all" || s.kind === "view") return { kind: s.kind };
  if (s.kind !== "parts") return `Invalid scope kind ${JSON.stringify(s.kind)}: use view, parts or all`;
  if (!Array.isArray(s.ids) || !s.ids.length || !s.ids.every((x) => typeof x === "string")) return "A parts scope needs the ids of the selected components";
  const missing = (s.ids as string[]).find((id) => !inView.includes(id));
  if (missing) return `The component "${missing}" is not in this view`;
  return { kind: "parts", ids: [...new Set(s.ids as string[])] };
}
