// A drawing the server cannot write back (read-only, or held open by another process; issue #125).
// `writeAtomic` is replaced so the failure is the same on every platform and for every user.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApp, shopFile, shopRepo, tempDir } from "./testkit";
import { Store } from "./store";

const locked = vi.hoisted(() => new Set<string>());
vi.mock("./files", async (orig) => {
  const real = await orig<typeof import("./files")>();
  return {
    ...real,
    writeAtomic: (path: string, text: string, mode?: number) => {
      if (locked.has(path)) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${path}'`), { code: "EPERM" });
      real.writeAtomic(path, text, mode);
    },
  };
});

afterEach(() => { locked.clear(); vi.restoreAllMocks(); });

/** A minified drawing: valid, but reading it normalises the text, so it is written back. */
const minified = (file: string, patch: Record<string, unknown> = {}) => writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }));

describe("a drawing that cannot be written back", () => {
  it("poll() survives it, keeps the change in memory and writes it once the file is free", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new Store(tempDir());
    const { file } = shopRepo();
    const doc = store.register(file);
    let fired = 0;
    store.on("changed", () => fired++);
    locked.add(file);
    minified(file, { title: "Changed outside" });
    expect(() => store.poll()).not.toThrow();
    expect(fired).toBe(1);
    const held = store.get(doc.id)!;
    expect(held.title).toBe("Changed outside");
    // Reading again is the same version, not another outside change.
    store.poll();
    expect(store.get(doc.id)!.updatedAt).toBe(held.updatedAt);
    expect(fired).toBe(1);
    expect(readFileSync(file, "utf8").endsWith("}\n")).toBe(false);
    // The file comes free: the next poll writes the normalised text.
    locked.clear();
    store.poll();
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify(held, null, 2) + "\n");
    expect(store.get(doc.id)!.updatedAt).toBe(held.updatedAt);
    expect(fired).toBe(1);
  });

  it("register() fails and keeps no registry entry", () => {
    const dataDir = tempDir();
    const store = new Store(dataDir);
    const { file } = shopRepo();
    minified(file);
    locked.add(file);
    expect(() => store.register(file)).toThrow(/cannot be written/);
    expect(store.list()).toEqual([]);
    expect(() => readFileSync(join(dataDir, "files.json"), "utf8")).toThrow();
    expect(new Store(dataDir).list()).toEqual([]);
  });

  it("list() still lists the other drawings when reading one throws", () => {
    const store = new Store(tempDir());
    const a = shopRepo(), b = shopRepo();
    const da = store.register(a.file);
    store.register(b.file);
    const read = store.read.bind(store);
    vi.spyOn(store, "read").mockImplementation((id) => { if (id === da.id) throw new Error("boom"); return read(id); });
    const list = store.list();
    expect(list.map((d) => d.path).sort()).toEqual([a.file, b.file].sort());
    expect(list.find((d) => d.id === da.id)?.title).toBe("shop.archdraw.json");
  });

  it("answers the contract's JSON error over HTTP: register, list, save and a request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { req } = makeApp();
    const bad = shopRepo();
    minified(bad.file);
    locked.add(bad.file);
    const reg = await req("/api/files", { method: "POST", json: { path: bad.file } });
    expect(reg.status).toBe(500);
    expect(await reg.json()).toEqual({ error: expect.stringContaining("cannot be written") });
    // Nothing was registered, so the library still answers.
    const list = await req("/api/diagrams");
    expect(list.status).toBe(200);
    expect((await list.json()).diagrams).toEqual([]);
    locked.clear();

    const good = shopRepo();
    const id = (await (await req("/api/files", { method: "POST", json: { path: good.file } })).json()).id as string;
    const doc = await (await req(`/api/diagrams/${id}`)).json();
    locked.add(good.file);
    const put = await req(`/api/diagrams/${id}`, { method: "PUT", json: { ...doc, title: "Edited" }, headers: { "If-Unmodified-Since-Version": doc.updatedAt } });
    expect(put.status).toBe(500);
    expect(put.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await put.json()).toEqual({ error: expect.stringContaining("EPERM") });
    const asked = await req(`/api/diagrams/${id}/requests`, { method: "POST", json: { view: "overview", text: "Add a cache" } });
    expect(asked.status).toBe(500);
    expect(await asked.json()).toEqual({ error: expect.any(String) });
    expect((await req("/api/diagrams")).status).toBe(200);
    // The file was not touched, and saves work again once it is free.
    expect(JSON.parse(readFileSync(good.file, "utf8")).title).toBe(shopFile().title);
    locked.clear();
    expect((await req(`/api/diagrams/${id}`, { method: "PUT", json: { ...doc, title: "Edited" }, headers: { "If-Unmodified-Since-Version": doc.updatedAt } })).status).toBe(200);
  });
});
