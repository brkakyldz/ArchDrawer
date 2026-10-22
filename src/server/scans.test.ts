import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EngineError } from "./engines/types";
import { FixtureEngine, fixtureScan } from "./engines/fixture";
import { makeApp, makeFolder } from "./testkit";

// The scan resource (api contract, Folders and Scans) through the server, with the fixture engine.

const json = async (r: Response) => ({ status: r.status, body: await r.json() });
/** A real git repository with one commit holding `files`. */
function gitRepo(files: Record<string, string>): string {
  const dir = makeFolder(files);
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
  g("init", "-q"); g("add", "-A"); g("commit", "-q", "-m", "one");
  return dir;
}
/** Whether the system's temporary folder is on a file system that ignores letter case (Windows, macOS). */
const caseInsensitive = tmpdir().toUpperCase() !== tmpdir() && existsSync(tmpdir().toUpperCase());
const FILES = { "README.md": "# Shop\nSells things.\n", "package.json": '{"main": "src/server.ts"}', "src/server.ts": "// server\n", "src/agent.ts": "// agent\n" };

async function scanOf(t: ReturnType<typeof makeApp>, folder: string, extra: object = {}) {
  const r = await json(await t.req("/api/scans", { method: "POST", json: { folder, ...extra } }));
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return (await t.scans.wait(r.body.scanId))!;
}

describe("folders", () => {
  it("checks a typed folder and says where its repository and its drawing are", async () => {
    const t = makeApp();
    const dir = gitRepo(FILES);
    mkdirSync(join(dir, "docs")); writeFileSync(join(dir, "docs", "architecture.archdraw.json"), "{}");
    const ok = await json(await t.req("/api/folders/check", { method: "POST", json: { folder: join(dir, "src") } }));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ git: true, drawing: null });
    expect(ok.body.root).toBe(realpathSync.native(dir));
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: dir } }))).body.drawing).toMatch(/architecture\.archdraw\.json$/);
    const plain = makeFolder({ "a.txt": "x" });
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: plain } }))).body.git).toBe(false);
    for (const [folder, error] of [[undefined, "Give the absolute path of a folder"], ["relative/path", "The path must be absolute"], [join(plain, "nope"), `Not found: ${join(plain, "nope")}`], [join(plain, "a.txt"), `Not a folder: ${join(plain, "a.txt")}`]] as const) {
      const r = await json(await t.req("/api/folders/check", { method: "POST", json: { folder } }));
      expect([r.status, r.body.error]).toEqual([400, error]);
    }
    // A bare .git without a commit is not in git.
    const bare = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n", "a.ts": "x" });
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: bare } }))).body.git).toBe(false);
  });
});

describe("scans", () => {
  it("gives a card and the options whose files exist, one warning for the one left out", async () => {
    const t = makeApp();
    const dir = gitRepo(FILES);
    const s = await scanOf(t, dir);
    expect(s.status).toBe("succeeded");
    expect(s.cached).toBe(false);
    expect(s.card).toMatchObject({ sentence: "A project scanned by the test engine.", type: "agent", languages: ["TypeScript"] });
    expect(s.card!.entryPoints[0]).toBe("src/server.ts"); // named by package.json's main
    expect(s.options!.map((o) => [o.id, o.kind, o.title])).toEqual([["o1", "flow", "How a request moves through the project"], ["o2", "mechanism", "The agent loop"], ["o3", "overview", "The whole architecture"]]);
    expect(s.options![0].files).toEqual(["README.md", "package.json"]);
    expect(s.warnings).toEqual(['Left out the option "A path that is not there": "fixture/missing-file.ts" does not exist']);
    expect(s.progress).toEqual(["Gathering the repository", "Reading the inputs", "Writing the card", "Checking the scan", "Done"]);
  });

  it("is cached per commit: a second scan starts no engine, refresh and a new commit scan again", async () => {
    const t = makeApp();
    const dir = gitRepo(FILES);
    const first = await scanOf(t, dir);
    const again = await scanOf(t, dir);
    expect(again).toMatchObject({ status: "succeeded", cached: true, card: first.card, options: first.options });
    expect(again.progress).toEqual([`Scanned before at ${first.commit!.slice(0, 7)}`]);
    const fresh = await scanOf(t, dir, { refresh: true });
    expect(fresh.cached).toBe(false);
    writeFileSync(join(dir, "src", "new.ts"), "x");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qam", "two", "--allow-empty"], { cwd: dir, stdio: "pipe" });
    const next = await scanOf(t, dir);
    expect(next.cached).toBe(false);
    expect(next.commit).not.toBe(first.commit);
    expect(readdirSync(join(t.dataDir, "scans"))).toHaveLength(2);
  });

  it("never caches a folder that is not in git", async () => {
    const t = makeApp();
    const dir = makeFolder(FILES);
    expect((await scanOf(t, dir)).commit).toBeNull();
    expect((await scanOf(t, dir)).cached).toBe(false);
  });

  it("refuses what it cannot scan, one scan of a folder at a time, and caches nothing it cancelled", async () => {
    const t = makeApp();
    expect((await json(await t.req("/api/scans", { method: "POST", json: { folder: "nope" } }))).body.error).toBe("The path must be absolute");
    const dir = gitRepo(FILES);
    expect((await json(await t.req("/api/scans", { method: "POST", json: { folder: dir, refresh: "yes" } }))).body.error).toBe("refresh must be true or false");
    expect((await json(await t.req("/api/scans", { method: "POST", json: { folder: dir, model: "--x" } }))).body.error).toBe('Invalid model name "--x"');
    expect((await json(await t.req("/api/scans", { method: "POST", json: { folder: dir, engine: "nope" } }))).body.error).toBe('Unknown engine "nope"');
    // An engine that answers only when cancelled stands in for a slow scan.
    const slow = makeApp({ engines: [{ id: "fixture", label: "Fixture (test)", detect: async () => ({ id: "fixture", label: "Fixture (test)", available: true, version: "1", detail: "", test: true, models: [] }),
      run: (r) => new Promise((_, no) => r.signal.addEventListener("abort", () => no(new Error("aborted")))) }] });
    const started = await json(await slow.req("/api/scans", { method: "POST", json: { folder: dir } }));
    expect((await json(await slow.req("/api/scans", { method: "POST", json: { folder: dir } }))).status).toBe(409);
    expect((await json(await slow.req(`/api/scans/${started.body.scanId}/cancel`, { method: "POST" }))).status).toBe(200);
    expect((await slow.scans.wait(started.body.scanId))!.status).toBe("cancelled");
    expect(existsSync(join(slow.dataDir, "scans"))).toBe(false);
    expect((await json(await t.req("/api/scans/s_nope"))).status).toBe(404);
  }, 20_000);

  it.runIf(caseInsensitive)("one folder typed in another letter case is one folder: one cache entry, and a second scan is refused", async () => {
    const dir = gitRepo(FILES);
    const t = makeApp();
    const first = await scanOf(t, dir);
    expect(first.cached).toBe(false);
    const again = await scanOf(t, dir.toUpperCase());
    expect([again.cached, again.folder, again.root]).toEqual([true, first.folder, first.root]);
    const slow = makeApp({ engines: [{ id: "fixture", label: "Fixture (test)", detect: async () => ({ id: "fixture", label: "Fixture (test)", available: true, version: "1", detail: "", test: true, models: [] }),
      run: (r) => new Promise((_, no) => r.signal.addEventListener("abort", () => no(new Error("aborted")))) }] });
    const started = await json(await slow.req("/api/scans", { method: "POST", json: { folder: dir.toLowerCase() } }));
    expect(started.status).toBe(202);
    expect((await json(await slow.req("/api/scans", { method: "POST", json: { folder: dir.toUpperCase() } }))).status).toBe(409);
    await slow.scans.cancelAll();
    await slow.scans.wait(started.body.scanId);
  }, 20_000);

  it("a failing engine fails the scan and caches nothing", async () => {
    const t = makeApp({ engines: [{ id: "fixture", label: "Fixture (test)", detect: async () => ({ id: "fixture", label: "Fixture (test)", available: true, version: "1", detail: "", test: true, models: [] }),
      run: async () => { throw new EngineError("The engine gave up"); } }] });
    const s = await scanOf(t, gitRepo(FILES));
    expect([s.status, s.error, s.card]).toEqual(["failed", "The engine gave up", null]);
    expect(existsSync(join(t.dataDir, "scans"))).toBe(false);
  });

  it("the fixture reads its markers from the folder's name", async () => {
    const fx = new FixtureEngine(1);
    const req = { cwd: ".", folderName: "shop [fixture:fail]", instruction: "shop [fixture:fail]", view: "", model: null, scope: { kind: "view" as const }, parts: [], base: null, signal: new AbortController().signal, timeoutMs: 1000, progress: () => {}, task: { kind: "scan" as const, schema: {}, prompt: "", data: {} } };
    await expect(fx.run(req)).rejects.toThrow("Fixture failure requested");
    expect(fixtureScan("shop [fixture:slow]", {}).card.name).toBe("shop");
  });
});
