import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocument } from "../core/model";
import { Store } from "./store";
import { makeFolder, shopFile, shopRepo, tempDir } from "./testkit";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("file-backed store", () => {
  it("registers a file: validates, gives an id, normalises and writes it back; same path → same id", () => {
    const store = new Store(tempDir());
    const { root, file } = shopRepo();
    const doc = store.register(file);
    expect(doc.id).toMatch(/^d_[a-z0-9]{6,}$/);
    expect(doc.source).toEqual({ kind: "local", path: root });
    const onDisk = read(file);
    expect(validateDocument(onDisk).ok).toBe(true);
    expect(onDisk.id).toBe(doc.id);
    expect(readFileSync(file, "utf8").endsWith("}\n")).toBe(true);
    expect(store.register(file).id).toBe(doc.id);
    expect(read(join(store.dataDir, "files.json"))).toEqual([{ id: doc.id, path: file }]);
    // A second store over the same data directory sees the registry.
    expect(new Store(store.dataDir).get(doc.id)?.title).toBe("Sample Shop");
  });

  it("refuses an invalid file with every error, and a relative path", () => {
    const store = new Store(tempDir());
    const dir = makeFolder({});
    const bad = join(dir, "bad.json");
    const f = shopFile() as { views: { nodes: { kind: string }[] }[] };
    f.views[0].nodes[0].kind = "database";
    f.views[0].nodes[1].kind = "queue";
    writeFileSync(bad, JSON.stringify(f));
    expect(() => store.register(bad)).toThrow(/not a valid drawing/);
    try { store.register(bad); } catch (e) { expect((e as { errors: string[] }).errors).toHaveLength(2); }
    expect(() => store.register("relative.json")).toThrow(/absolute/);
  });

  it("gives a colliding file a new id, written back", () => {
    const store = new Store(tempDir());
    const a = shopRepo(), b = shopRepo();
    const first = store.register(a.file);
    writeFileSync(b.file, JSON.stringify({ ...shopFile(), id: first.id }));
    const second = store.register(b.file);
    expect(second.id).not.toBe(first.id);
    expect(read(b.file).id).toBe(second.id);
  });

  it("detects an outside change: normalises, moves updatedAt and fires changed", () => {
    const store = new Store(tempDir());
    const { file } = shopRepo();
    const doc = store.register(file);
    const events: string[] = [];
    store.on("changed", (id: string, at: string) => events.push(`${id}@${at}`));
    // A session adds a component without a position and does not touch updatedAt.
    const edited = read(file);
    edited.views[0].nodes.push({ id: "cache", label: "Cache", kind: "data", form: "card", icon: null, sub: "", items: [], description: "Caches.", files: [], parent: null, detail: null, place: null });
    writeFileSync(file, JSON.stringify(edited));
    const next = store.get(doc.id)!;
    expect(next.views[0].nodes.find((n) => n.id === "cache")).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(next.updatedAt > doc.updatedAt).toBe(true);
    expect(events).toEqual([`${doc.id}@${next.updatedAt}`]);
    expect(validateDocument(read(file)).ok).toBe(true);
    // Reading again changes nothing.
    expect(store.get(doc.id)!.updatedAt).toBe(next.updatedAt);
    expect(events).toHaveLength(1);
  });

  it("poll() notices a changed file without a request", () => {
    const store = new Store(tempDir());
    const { file } = shopRepo();
    const doc = store.register(file);
    let fired = 0;
    store.on("changed", () => fired++);
    store.poll();
    expect(fired).toBe(0);
    writeFileSync(file, JSON.stringify({ ...read(file), title: "Renamed shop" }, null, 2));
    store.poll();
    expect(fired).toBe(1);
    expect(store.get(doc.id)!.title).toBe("Renamed shop");
  });

  it("refuses a save based on an older version (409) and accepts one based on the current", () => {
    const store = new Store(tempDir());
    const { file } = shopRepo();
    const doc = store.register(file);
    const ok = store.put(doc.id, { ...doc, title: "One" }, { base: doc.updatedAt });
    expect(ok).toMatchObject({ ok: true });
    const stale = store.put(doc.id, { ...doc, title: "Two" }, { base: doc.updatedAt });
    expect(stale).toEqual({ ok: false, conflict: true, updatedAt: (ok as { updatedAt: string }).updatedAt });
    expect(store.get(doc.id)!.title).toBe("One");
    // An outside write without an updatedAt change still makes the editor's base stale.
    const cur = store.get(doc.id)!;
    writeFileSync(file, JSON.stringify({ ...read(file), title: "From the session" }, null, 2));
    expect(store.put(doc.id, { ...cur, title: "Editor" }, { base: cur.updatedAt })).toMatchObject({ ok: false, conflict: true });
    expect(store.get(doc.id)!.title).toBe("From the session");
    // A writer that sets its own new updatedAt keeps it, and a save based on the old one is refused with it.
    const before = store.get(doc.id)!;
    writeFileSync(file, JSON.stringify({ ...read(file), title: "Newer", updatedAt: "2099-01-01T00:00:00.000Z" }, null, 2));
    expect(store.put(doc.id, { ...before, title: "Editor" }, { base: before.updatedAt })).toEqual({ ok: false, conflict: true, updatedAt: "2099-01-01T00:00:00.000Z" });
  });

  it("refuses a save naming a file that is not in the repository, so the drawing still opens after a restart", () => {
    const store = new Store(tempDir());
    const { file } = shopRepo();
    const doc = store.register(file);
    const withFiles = (files: string[]) => ({ ...doc, views: doc.views.map((v, i) => (i ? v : { ...v, nodes: v.nodes.map((n, j) => (j ? n : { ...n, files })) })) });
    const bad = store.put(doc.id, withFiles(["src/missing.ts"]), { base: doc.updatedAt });
    expect(bad).toMatchObject({ ok: false, conflict: false });
    expect((bad as { error: string }).error).toMatch(/src\/missing\.ts.*does not exist/);
    const good = store.put(doc.id, withFiles(["web/index.html"]), { base: doc.updatedAt });
    expect(good).toMatchObject({ ok: true });
    // A fresh process (no hash known) checks the file against the repository, as `open` does.
    const reopened = new Store(store.dataDir).read(doc.id);
    expect(reopened).toMatchObject({ ok: true });
    expect((reopened as { doc: typeof doc }).doc.views[0].nodes[0].files).toEqual(["web/index.html"]);
  });

  it("imports v1 and v2 documents under new ids and forgets or deletes", () => {
    const store = new Store(tempDir());
    const v2 = store.import({ ...shopFile(), id: "d_whatever1" });
    expect(v2.ok).toBe(true);
    const id = (v2 as { id: string }).id;
    expect(id).not.toBe("d_whatever1");
    const v1 = store.import({
      schema: "archdraw/diagram@1", title: "Old", subtitle: "", theme: "light", showSteps: false, direction: "LR",
      nodes: [{ id: "a", label: "A", kind: "service", tech: "", description: "A.", group: null, files: [], x: 0, y: 0 }],
      groups: [], edges: [], notes: [],
    });
    expect(v1.ok).toBe(true);
    const { file } = shopRepo();
    const reg = store.register(file);
    expect(store.list().map((d) => d.path)).toEqual(expect.arrayContaining([null, null, file]));
    expect(store.delete(reg.id)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain(reg.id); // the file stays
    expect(store.delete(id)).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.import({ schema: "archdraw/diagram@2", title: "x", views: [] }).ok).toBe(false);
  });
});
