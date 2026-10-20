import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeApp, PORT, shopFile, shopRepo } from "./testkit";

const json = async (r: Response) => ({ status: r.status, body: await r.json() });

async function opened() {
  const t = makeApp();
  const { file } = shopRepo();
  const r = await json(await t.req("/api/files", { method: "POST", json: { path: file } }));
  return { ...t, file, id: r.body.id as string, url: r.body.url as string };
}

describe("security envelope", () => {
  it("refuses a foreign Host or Origin with 403 and mutations without the token", async () => {
    const { req, file, id } = await opened();
    expect((await req("/api/health", { host: "evil.example" })).status).toBe(403);
    expect((await req("/api/health", { headers: { origin: "http://evil.example" } })).status).toBe(403);
    expect((await req("/api/health", { headers: { origin: `http://localhost:${PORT}` } })).status).toBe(200);
    const before = readFileSync(file, "utf8");
    expect((await req(`/api/diagrams/${id}`, { method: "DELETE", token: null })).status).toBe(403);
    expect((await req(`/api/diagrams/${id}`, { method: "PUT", token: "wrong", json: {} })).status).toBe(403);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("serves the app with the token on every non-API path", async () => {
    const { req } = makeApp();
    const html = await (await req("/d/d_anything")).text();
    expect(html).toContain('<meta name="archdraw-token" content="test-token">');
  });
});

describe("drawings over HTTP", () => {
  it("registers a file, lists it, serves it, saves an edit into the file", async () => {
    const { req, file, id, url } = await opened();
    expect(url).toBe(`http://127.0.0.1:${PORT}/d/${id}`);
    const list = (await json(await req("/api/diagrams"))).body.diagrams;
    expect(list).toEqual([{ id, title: "Sample Shop", path: file, updatedAt: expect.any(String) }]);
    const doc = (await json(await req(`/api/diagrams/${id}`))).body;
    doc.views[0].nodes[0].label = "Storefront";
    const put = await json(await req(`/api/diagrams/${id}`, { method: "PUT", json: doc, headers: { "If-Unmodified-Since-Version": doc.updatedAt } }));
    expect(put).toMatchObject({ status: 200, body: { ok: true } });
    expect(JSON.parse(readFileSync(file, "utf8")).views[0].nodes[0].label).toBe("Storefront");
    // The same base again is stale now.
    const stale = await json(await req(`/api/diagrams/${id}`, { method: "PUT", json: doc, headers: { "If-Unmodified-Since-Version": doc.updatedAt } }));
    expect(stale).toEqual({ status: 409, body: { error: expect.any(String), updatedAt: put.body.updatedAt } });
    expect((await req(`/api/diagrams/${id}`, { method: "PUT", json: { ...doc, id: "d_other0000" } })).status).toBe(400);
  });

  it("answers 400 with every error for an invalid file and 404 for unknown ids", async () => {
    const { req } = makeApp();
    const { file } = shopRepo();
    const f = shopFile() as { views: { edges: { style: string }[] }[] };
    f.views[0].edges[0].style = "wave";
    writeFileSync(file, JSON.stringify(f));
    const r = await json(await req("/api/files", { method: "POST", json: { path: file } }));
    expect(r.status).toBe(400);
    expect(r.body.errors[0]).toMatch(/^views\[0\]\.edges\[0\]\.style: /);
    expect((await req("/api/files", { method: "POST", json: { path: "shop.json" } })).status).toBe(400);
    expect((await req("/api/diagrams/d_nothere00")).status).toBe(404);
    expect((await req("/api/diagrams/d_nothere00/export.svg")).status).toBe(404);
  });

  it("imports a document and forgets a registered file without deleting it", async () => {
    const { req, file, id } = await opened();
    const imp = await json(await req("/api/diagrams", { method: "POST", json: shopFile() }));
    expect(imp.status).toBe(201);
    expect((await json(await req("/api/diagrams"))).body.diagrams.map((d: { path: string | null }) => d.path)).toEqual(expect.arrayContaining([null, file]));
    expect((await req(`/api/diagrams/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(readFileSync(file, "utf8")).toContain("Sample Shop");
    expect((await req(`/api/diagrams/${id}`)).status).toBe(404);
    expect((await json(await req("/api/diagrams", { method: "POST", json: { schema: "archdraw/diagram@2" } }))).status).toBe(400);
  });

  it("exports the share image per view, format and theme, and Mermaid", async () => {
    const { req, id } = await opened();
    const svg = await (await req(`/api/diagrams/${id}/export.svg?format=feed&theme=dark`)).text();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1080" height="1350"/);
    expect(svg).toContain('data-theme="dark"');
    expect((await req(`/api/diagrams/${id}/export.svg?format=poster`)).status).toBe(400);
    expect((await req(`/api/diagrams/${id}/export.svg?view=nope`)).status).toBe(400);
    expect(await (await req(`/api/diagrams/${id}/export.mmd`)).text()).toMatch(/^flowchart LR\n/);
  });

  it("saves an instruction in the file for the next session", async () => {
    const { req, id, file } = await opened();
    const r = await json(await req(`/api/diagrams/${id}/requests`, { method: "POST", json: { view: "overview", text: "Add a cache" } }));
    expect(r).toEqual({ status: 201, body: { id: "q1" } });
    expect(JSON.parse(readFileSync(file, "utf8")).requests).toEqual([{ id: "q1", text: "Add a cache", view: "overview", at: expect.any(String) }]);
    expect((await req(`/api/diagrams/${id}/requests`, { method: "POST", json: { view: "overview", text: "  " } })).status).toBe(400);
    expect((await req(`/api/diagrams/${id}/requests`, { method: "POST", json: { view: "nope", text: "x" } })).status).toBe(400);
  });

  it("names the paths that are not in the drawing's repository, with the token", async () => {
    const { req, id } = await opened();
    const check = (files: unknown, token?: string | null) => req(`/api/diagrams/${id}/check-files`, { method: "POST", json: { files }, token });
    expect(await json(await check(["web/index.html", "src/gone.ts"]))).toEqual({ status: 200, body: { missing: ["src/gone.ts"] } });
    expect((await check(["../outside.txt"])).status).toBe(400);
    expect((await check(Array.from({ length: 21 }, (_, i) => `f${i}.ts`))).status).toBe(400);
    expect((await check("web/index.html")).status).toBe(400);
    expect((await check(["web/index.html"], null)).status).toBe(403);
    expect((await req("/api/diagrams/d_unknown00/check-files", { method: "POST", json: { files: [] } })).status).toBe(404);
  });

  it("refuses a model name that an engine's command line would read as an option", async () => {
    const { req, id } = await opened();
    const start = async (model: string) => json(await req("/api/runs", { method: "POST", json: { diagramId: id, view: "overview", instruction: "add Cache component", engine: "fixture", model } }));
    for (const model of ["-x", "--dangerously-skip-permissions", "--sandbox=danger-full-access"]) {
      const r = await start(model);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Invalid model name/);
    }
    expect((await start("claude-opus-5-5")).status).toBe(202);
  });

  it("streams changed events for outside writes only", async () => {
    const { req, id, file, store } = await opened();
    const res = await req(`/api/diagrams/${id}/events`);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const doc = (await json(await req(`/api/diagrams/${id}`))).body;
    await req(`/api/diagrams/${id}`, { method: "PUT", json: { ...doc, title: "Own edit" } });
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), title: "Outside" }, null, 2));
    store.poll();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toMatch(/event: changed\ndata: \{"updatedAt":"[^"]+"\}/);
    expect(chunk).not.toContain("Own edit");
    await reader.cancel();
  });

  it("shutdown answers and then asks the process to exit", async () => {
    const t = makeApp();
    expect((await json(await t.req("/api/shutdown", { method: "POST" }))).body).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 80));
    expect(t.shutdowns()).toBe(1);
  });
});
