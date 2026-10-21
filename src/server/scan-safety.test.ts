import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureScan } from "./engines/fixture";
import { readPart } from "./folders";
import type { Engine, EngineRunRequest } from "./engines/types";
import { makeApp, makeFolder, tempDir } from "./testkit";

// The repository being scanned is untrusted (api contract, Folders and Scans; AGENTS.md invariant 1):
// its git config runs nothing, its symlinks reach nothing outside it, and one folder scans once at a time.

const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const g = (dir: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
function repo(files: Record<string, string>) {
  const dir = makeFolder(files);
  g(dir, "init", "-q"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "one");
  return dir;
}
/** Whether this machine lets a test make a symlink (Windows needs developer mode). */
const canSymlink = (() => {
  const d = tempDir("archdraw-link-");
  try { writeFileSync(join(d, "t"), ""); symlinkSync(join(d, "t"), join(d, "l")); return true; } catch { return false; }
})();
/** An engine that records what it was asked and answers as the fixture does. */
function recorder() {
  const seen: EngineRunRequest[] = [];
  const engine: Engine = {
    id: "fixture", label: "Fixture (test)",
    detect: async () => ({ id: "fixture", label: "Fixture (test)", available: true, version: "1", detail: "", test: true, models: [] }),
    run: async (r) => { seen.push(r); await new Promise((ok) => setTimeout(ok, 50)); return fixtureScan(r.folderName, r.task?.data ?? {}); },
  };
  return { engine, seen };
}

describe("scanning an untrusted repository", () => {
  it("runs no command its git config names (core.fsmonitor)", async () => {
    const dir = repo({ "a.ts": "x\n" });
    const marker = join(tempDir("archdraw-fsmon-"), "ran");
    g(dir, "config", "core.fsmonitor", `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${marker.replace(/\\/g, "/")}"`);
    const t = makeApp();
    const r = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    expect((await t.scans.wait(r.body.scanId))!.status).toBe("succeeded");
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: dir } }))).body.git).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(!canSymlink)("quotes nothing a symlink brings in from outside the repository", async () => {
    const outside = makeFolder({ "secret.txt": "TOKEN=do-not-send\n" });
    const dir = makeFolder({ "a.ts": "x\n" });
    symlinkSync(join(outside, "secret.txt"), join(dir, "README.md"));
    g(dir, "init", "-q"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "one");
    const { engine, seen } = recorder();
    const t = makeApp({ engines: [engine] });
    const r = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    expect((await t.scans.wait(r.body.scanId))!.status).toBe("succeeded");
    expect(seen[0].task!.prompt).not.toContain("do-not-send");
    expect(seen[0].task!.data!.listing).toEqual(["a.ts"]);
  });

  it("lists the scanned repository even when the server inherited GIT_DIR and GIT_WORK_TREE", async () => {
    const other = repo({ "other.ts": "x\n" });
    const dir = repo({ "a.ts": "x\n" });
    const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(other, ".git"); process.env.GIT_WORK_TREE = other;
    try {
      const { engine, seen } = recorder();
      const t = makeApp({ engines: [engine] });
      expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: dir } }))).body.git).toBe(true);
      const r = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
      expect((await t.scans.wait(r.body.scanId))!.status).toBe("succeeded");
      expect(seen[0].task!.data!.listing).toEqual(["a.ts"]);
    } finally {
      for (const [k, v] of [["GIT_DIR", saved.dir], ["GIT_WORK_TREE", saved.tree]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("lists no path through a folder that leads out of the repository (a junction or a symlinked folder)", async () => {
    const outside = makeFolder({ "passwd": "root:x:0:0\n" });
    const dir = repo({ "a.ts": "x\n", "vendor/passwd": "inside\n" });
    // The index still holds vendor/passwd; the folder now leads outside (a junction needs no rights on Windows).
    rmSync(join(dir, "vendor"), { recursive: true });
    symlinkSync(outside, join(dir, "vendor"), "junction");
    const { engine, seen } = recorder();
    const t = makeApp({ engines: [engine] });
    const r = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    expect((await t.scans.wait(r.body.scanId))!.status).toBe("succeeded");
    expect(seen[0].task!.data!.listing).toEqual(["a.ts"]);
  });

  it("leaves archdrawer's own drawing files out of the listing", async () => {
    const dir = repo({ "a.ts": "x\n", "docs/architecture.archdraw.json": "{}\n", "b.ts": "y\n" });
    const { engine, seen } = recorder();
    const t = makeApp({ engines: [engine] });
    const r = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    await t.scans.wait(r.body.scanId);
    expect(seen[0].task!.data!.listing).toEqual(["a.ts", "b.ts"]);
  });

  it("does not call a folder in git when its .git is not a repository and one above it is", async () => {
    const outer = repo({ "a.ts": "x\n" });
    const inner = join(outer, "inner");
    mkdirSync(join(inner, ".git"), { recursive: true });
    writeFileSync(join(inner, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(inner, "b.ts"), "y\n");
    const t = makeApp();
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: inner } }))).body.git).toBe(false);
  });

  it("reads a large input cut to the budget, and says how long the whole file is", () => {
    const dir = makeFolder({ "big.txt": "x".repeat(100_000) });
    expect(readPart(dir, "big.txt", 1000)).toEqual({ text: "x".repeat(2000), length: 100_000 });
  });

  it("starts one scan when two arrive together", async () => {
    const dir = repo({ "a.ts": "x\n" });
    const { engine, seen } = recorder();
    const t = makeApp({ engines: [engine] });
    const [a, b] = await Promise.all([1, 2].map(() => Promise.resolve(t.req("/api/scans", { method: "POST", json: { folder: dir } })).then(json)));
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await t.scans.wait((a.status === 202 ? a : b).body.scanId);
    expect(seen).toHaveLength(1);
  });

  it("scans again when a cache entry is not a scan", async () => {
    const dir = repo({ "a.ts": "x\n" });
    const { engine, seen } = recorder();
    const t = makeApp({ engines: [engine] });
    const first = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    await t.scans.wait(first.body.scanId);
    const entry = readdirSync(join(t.dataDir, "scans"))[0];
    writeFileSync(join(t.dataDir, "scans", entry), JSON.stringify({ card: null }));
    const again = await json(await t.req("/api/scans", { method: "POST", json: { folder: dir } }));
    const s = (await t.scans.wait(again.body.scanId))!;
    expect([s.cached, s.status, s.card?.name]).toEqual([false, "succeeded", s.card?.name]);
    expect(s.card).not.toBeNull();
    expect(seen).toHaveLength(2);
  });
});
