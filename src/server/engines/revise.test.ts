import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeFile } from "../../core/normalize";
import { validateFile } from "../../core/model";
import { documentToDraft, DRAFT_JSON_SCHEMA } from "../../core/repair";
import { APP_ROOT } from "../config";
import { makeApp, makeFolder, shopFile2, shopRepo, tempDir } from "../testkit";
import { ClaudeEngine } from "./claude";
import { CodexEngine } from "./codex";
import { fixtureNudge } from "./fixture";
import { decodeImage, isRunning, MAX_IMAGE_BYTES, PNG_SIGNATURE, reviseRoot, sweepReviseFolders, writeReviseImage } from "./revise";
import { EngineError, type Engine, type EngineInfo, type EngineRunRequest } from "./types";

// The second look (LAYOUT-4; api contract, The second look). Held-out H143 and H144 check the request,
// the answers and the editor; these check what they cannot see: the image's arguments on both CLIs, and
// that the image's folder is gone in every outcome, after the engine's process tree, and at start-up.

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const draft = documentToDraft(normalizeFile(validateFile(shopFile2()).file!, { id: "d_fake000001", now: "2026-10-13T00:00:00.000Z", source: null }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A fake `claude` or `codex` (a node script): answers `--version`/`--help`, logs its argv and stdin, then answers or hangs with a child. */
function fakeCli(kind: "claude" | "codex", behaviour: "ok" | "hang"): { bin: string; log: string } {
  const dir = tempDir("archdraw-fake-revise-");
  const log = join(dir, "log.json");
  const src = `
const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("${kind === "claude" ? "2.1.303 (Claude Code)" : "codex-cli 0.160.1"}"); process.exit(0); }
if (args.includes("--help")) { console.log("${kind === "claude" ? "--json-schema --safe-mode --restricted --strict-mcp-config --no-session-persistence" : "--output-schema --ephemeral"}"); process.exit(0); }
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin }));
  if (${JSON.stringify(behaviour)} === "hang") {
    const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(log)} + ".child", String(child.pid));
    setInterval(() => {}, 1000);
    return;
  }
  ${kind === "claude"
    ? `console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: ${JSON.stringify(draft)} }));`
    : `if (args.includes("-o")) fs.writeFileSync(args[args.indexOf("-o") + 1], ${JSON.stringify(JSON.stringify(draft))});`}
});`;
  const bin = join(dir, `${kind}.js`);
  writeFileSync(bin, src);
  return { bin, log };
}

/** An engine call for a revise: the image's folder named with shell characters, which must stay one argument. */
function reviseCall(signal = new AbortController().signal) {
  const data = tempDir("archdraw-data-");
  const image = writeReviseImage(join(data, "a folder; echo $(boom) & x"), Buffer.from(TINY_PNG, "base64"));
  const req: EngineRunRequest = {
    cwd: makeFolder({}), folderName: "shop", instruction: "", view: "overview", model: null, scope: { kind: "view" }, parts: [], base: draft,
    signal, timeoutMs: 20_000, progress: () => {}, image,
    task: { kind: "revise", schema: DRAFT_JSON_SCHEMA, tools: "image", prompt: `Read the image file ${image.file}` },
  };
  return { req, image };
}

describe("the image of a revise request (api contract, Runs)", () => {
  it("takes a base64 PNG of at most 4 MB and refuses the rest with the contract's sentences", () => {
    expect(decodeImage(TINY_PNG)).toHaveProperty("bytes");
    expect(decodeImage(undefined)).toEqual({ error: "A revise needs the drawing's image" });
    expect(decodeImage(7)).toEqual({ error: "A revise needs the drawing's image" });
    for (const bad of ["", "not base64 at all !!!", `data:image/png;base64,${TINY_PNG}`, Buffer.from("GIF89a").toString("base64")]) {
      expect(decodeImage(bad), bad.slice(0, 20)).toEqual({ error: "The image is not a PNG" });
    }
    const big = (n: number) => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(n - PNG_SIGNATURE.length)]).toString("base64");
    expect(decodeImage(big(MAX_IMAGE_BYTES))).toHaveProperty("bytes");
    expect(decodeImage(big(MAX_IMAGE_BYTES + 1))).toEqual({ error: "The image is too large (4 MB at most)" });
    // A large file that is no PNG is said to be no PNG, before its size.
    expect(decodeImage(Buffer.alloc(MAX_IMAGE_BYTES + 10, 0x41).toString("base64"))).toEqual({ error: "The image is not a PNG" });
  });

  it("is written to view.png in a new folder <pid>-<random> under the data directory's revise folder", () => {
    const data = tempDir("archdraw-data-");
    const a = writeReviseImage(data, Buffer.from(TINY_PNG, "base64")), b = writeReviseImage(data, Buffer.from(TINY_PNG, "base64"));
    expect(a.dir).not.toBe(b.dir);
    for (const x of [a, b]) {
      expect(x.dir.startsWith(join(data, "revise"))).toBe(true);
      expect(x.dir.slice(reviseRoot(data).length + 1)).toMatch(new RegExp(`^${process.pid}-\\w+$`));
      expect(x.file).toBe(join(x.dir, "view.png"));
      expect(readFileSync(x.file).toString("base64")).toBe(TINY_PNG);
      // Readable only by the user, where the system has modes.
      if (process.platform !== "win32") expect(statSync(x.dir).mode & 0o777).toBe(0o700);
    }
  });
});

describe("the image reaches each engine as one argument (api contract, Engines)", () => {
  it("Claude Code gets Read only, and the image's folder as one --add-dir argument", async () => {
    const fake = fakeCli("claude", "ok");
    const engine = new ClaudeEngine({ ...process.env, ARCHDRAW_CLAUDE_BIN: fake.bin });
    await engine.detect();
    const { req, image } = reviseCall();
    await engine.run(req);
    const log = JSON.parse(readFileSync(fake.log, "utf8")) as { args: string[]; stdin: string };
    const val = (flag: string) => log.args[log.args.indexOf(flag) + 1];
    expect(val("--tools")).toBe("Read");
    expect(val("--allowedTools")).toBe("Read");
    expect(val("--add-dir")).toBe(image.dir);
    expect(log.args.filter((a) => a.includes(image.dir))).toEqual([image.dir]);
    // `--add-dir` takes several folders: an option follows it, never another value.
    expect(log.args[log.args.indexOf("--add-dir") + 2]).toMatch(/^--/);
    expect(val("--permission-mode")).toBe("dontAsk");
    expect(log.args.join(" ")).not.toMatch(/Grep|Glob|Edit|Write|Bash|--bare|bypassPermissions|dangerously/);
    expect(log.stdin).toContain(image.file);
  });

  it("Codex gets the image as one -i argument, followed by an option, in its read-only sandbox", async () => {
    const fake = fakeCli("codex", "ok");
    const engine = new CodexEngine({ ...process.env, ARCHDRAW_CODEX_BIN: fake.bin });
    await engine.detect();
    const { req, image } = reviseCall();
    await engine.run(req);
    const { args } = JSON.parse(readFileSync(fake.log, "utf8")) as { args: string[] };
    expect(args[args.indexOf("-i") + 1]).toBe(image.file);
    expect(args.filter((a) => a.includes(image.dir))).toEqual([image.file]);
    // `-i` takes several files: an option follows it, and the `-` that reads the prompt stays last.
    expect(args[args.indexOf("-i") + 2]).toMatch(/^--/);
    expect(args.at(-1)).toBe("-");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args.join(" ")).not.toMatch(/danger|workspace-write|bypass/);
  });

  it("a refine never gets the image arguments", async () => {
    const fake = fakeCli("claude", "ok");
    const engine = new ClaudeEngine({ ...process.env, ARCHDRAW_CLAUDE_BIN: fake.bin });
    await engine.detect();
    expect(engine.args(null)).not.toContain("--add-dir");
    expect(new CodexEngine().args("/repo", "/s.json", "/o.json", null)).not.toContain("-i");
  });
});

/** An engine that runs a revise as the test needs: answers, fails, or waits until it is stopped. */
class Looker implements Engine {
  readonly id = "fixture";
  readonly label = "Fixture (test)";
  seen: { dir: string; file: string; existed: boolean } | null = null;
  constructor(private readonly behaviour: "ok" | "fail" | "wait") {}
  async detect(): Promise<EngineInfo> { return { id: this.id, label: this.label, available: true, version: "1", detail: "", test: true, models: [] }; }
  async run(req: EngineRunRequest): Promise<unknown> {
    if (req.image) this.seen = { ...req.image, existed: existsSync(req.image.file) };
    if (this.behaviour === "fail") throw new EngineError("The engine failed");
    if (this.behaviour === "wait") await new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(new EngineError("Cancelled")), { once: true }));
    return fixtureNudge(req.base, req.view);
  }
}

async function revise(engine: Engine, opts: { timeoutMs?: number; cancel?: boolean } = {}) {
  const t = makeApp({ engines: [engine], timeoutMs: opts.timeoutMs });
  const { file } = shopRepo();
  const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
  const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, kind: "revise", view: "overview", image: TINY_PNG, engine: "fixture", model: null } });
  expect(r.status).toBe(202);
  const { runId } = (await r.json()) as { runId: string };
  if (opts.cancel) {
    for (let i = 0; i < 100 && !readdirSafe(reviseRoot(t.dataDir)).length; i++) await wait(20);
    await wait(50);
    expect((await t.req(`/api/runs/${runId}/cancel`, { method: "POST" })).status).toBe(200);
  }
  const done = await t.runs.wait(runId);
  return { t, done };
}
const readdirSafe = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

describe("the image's folder is gone however the run ends (api contract, The second look)", () => {
  it("after success: the engine saw the image, and the folder is gone", async () => {
    const engine = new Looker("ok");
    const { t, done } = await revise(engine);
    expect(done).toMatchObject({ status: "succeeded", kind: "revise", route: null });
    expect(done!.progress[0]).toBe("Looking at the drawing");
    expect(engine.seen?.existed).toBe(true);
    expect(existsSync(engine.seen!.dir)).toBe(false);
    expect(readdirSafe(reviseRoot(t.dataDir))).toEqual([]);
  });

  it("after a failure", async () => {
    const engine = new Looker("fail");
    const { t, done } = await revise(engine);
    expect(done).toMatchObject({ status: "failed", error: "The engine failed" });
    expect(engine.seen?.existed).toBe(true);
    expect(readdirSafe(reviseRoot(t.dataDir))).toEqual([]);
  });

  it("after a cancel", async () => {
    const engine = new Looker("wait");
    const { t, done } = await revise(engine, { cancel: true });
    expect(done?.status).toBe("cancelled");
    expect(engine.seen?.existed).toBe(true);
    expect(readdirSafe(reviseRoot(t.dataDir))).toEqual([]);
  });

  it("after a timeout", async () => {
    const engine = new Looker("wait");
    const { t, done } = await revise(engine, { timeoutMs: 400 });
    expect(done).toMatchObject({ status: "failed", error: expect.stringMatching(/^Timed out after/) });
    expect(engine.seen?.existed).toBe(true);
    expect(readdirSafe(reviseRoot(t.dataDir))).toEqual([]);
  });

  it("after a cancel, only once Claude Code's whole process tree has exited", async () => {
    const fake = fakeCli("claude", "hang");
    const engine = new ClaudeEngine({ ...process.env, ARCHDRAW_CLAUDE_BIN: fake.bin });
    const t = makeApp({ engines: [engine] });
    const { file } = shopRepo();
    const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
    const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, kind: "revise", view: "overview", image: TINY_PNG, engine: "claude", model: null } });
    expect(r.status).toBe(202);
    const { runId } = (await r.json()) as { runId: string };
    for (let i = 0; i < 200 && !existsSync(fake.log + ".child"); i++) await wait(50);
    const child = Number(readFileSync(fake.log + ".child", "utf8"));
    const { args } = JSON.parse(readFileSync(fake.log, "utf8")) as { args: string[] };
    const dir = args[args.indexOf("--add-dir") + 1];
    expect(existsSync(join(dir, "view.png"))).toBe(true);
    await t.req(`/api/runs/${runId}/cancel`, { method: "POST" });
    const done = await t.runs.wait(runId);
    expect(done?.status).toBe("cancelled");
    // When the run has ended, the folder is gone and so is the engine's child.
    expect(existsSync(dir)).toBe(false);
    for (let i = 0; i < 20 && alive(child); i++) await wait(50);
    expect(alive(child)).toBe(false);
  });
});

/** A pid no process has any more: a node that has already exited. */
const deadPid = () => spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout.trim();

function leftovers(data: string, pids: Record<string, string>) {
  const dirs: Record<string, string> = {};
  for (const [name, pid] of Object.entries(pids)) {
    dirs[name] = join(reviseRoot(data), `${pid}-abc${name}`);
    mkdirSync(dirs[name], { recursive: true });
    writeFileSync(join(dirs[name], "view.png"), Buffer.from(TINY_PNG, "base64"));
  }
  return dirs;
}

describe("a starting server removes a dead server's images, never a live one's", () => {
  it("removes the folders whose pid no longer runs and keeps the others", () => {
    const live = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      const data = tempDir("archdraw-data-");
      const dirs = leftovers(data, { dead: deadPid(), live: String(live.pid), own: String(process.pid) });
      mkdirSync(join(reviseRoot(data), "not-a-pid"));
      expect(sweepReviseFolders(data)).toEqual([dirs.dead]);
      expect(existsSync(dirs.dead)).toBe(false);
      expect(existsSync(dirs.live)).toBe(true);
      expect(existsSync(dirs.own)).toBe(true);
      expect(existsSync(join(reviseRoot(data), "not-a-pid"))).toBe(true);
      expect(sweepReviseFolders(tempDir("archdraw-empty-"))).toEqual([]);
    } finally { live.kill(); }
  });

  it("a pid that is no process's is never running", () => {
    expect(isRunning(0)).toBe(false);
    expect(isRunning(-1)).toBe(false);
    expect(isRunning(Number(deadPid()))).toBe(false);
    expect(isRunning(process.pid)).toBe(true);
  });

  it("the server sweeps once its port is bound", async () => {
    const live = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const data = tempDir("archdraw-data-");
    const dirs = leftovers(data, { dead: deadPid(), live: String(live.pid) });
    const server = startServer(data, await freePort());
    try {
      for (let i = 0; i < 300 && !server.out().includes("listening on"); i++) await wait(50);
      expect(server.out()).toContain("listening on");
      expect(existsSync(dirs.dead)).toBe(false);
      expect(existsSync(dirs.live)).toBe(true);
    } finally {
      server.child.kill();
      live.kill();
    }
  });

  it("a server that cannot bind its port sweeps nothing", async () => {
    const data = tempDir("archdraw-data-");
    const dirs = leftovers(data, { dead: deadPid() });
    // Another process holds the port: this server stops before it is bound.
    const holder = createServer();
    const port = await new Promise<number>((res) => holder.listen(0, "127.0.0.1", () => res((holder.address() as { port: number }).port)));
    try {
      const server = startServer(data, port);
      const code = await new Promise<number | null>((res) => server.child.on("exit", res));
      expect(code).toBe(1);
      expect(server.out()).toContain(`Port ${port} is in use`);
      expect(existsSync(dirs.dead)).toBe(true);
    } finally {
      await new Promise((r) => holder.close(r));
    }
  });
});

const freePort = () => new Promise<number>((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });

/** The real server (`src/server/main.ts`) on a data directory and port, with no engine; its output so far. */
function startServer(data: string, port: number) {
  const child = spawn(process.execPath, ["--import", "tsx", join(APP_ROOT, "src", "server", "main.ts")], {
    cwd: APP_ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), ARCHDRAW_DATA_DIR: data, ARCHDRAW_ENGINES: "", ARCHDRAW_NO_OPEN: "1" },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return { child, out: () => out };
}

describe("review F168-F170", () => {
  it("an image on a draw run is refused before the draw's own checks", async () => {
    const t = makeApp();
    const r = await t.req("/api/runs", { method: "POST", json: { kind: "draw", scan: "s_nothere", focus: { kind: "whole" }, channel: "readme", engine: "fixture", model: null, image: TINY_PNG } });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "An image is for a revise" });
  });

  it("an image that cannot be written leaves no folder behind", () => {
    const data = tempDir("archdraw-data-");
    // Not bytes: the write fails after the folder was made.
    expect(() => writeReviseImage(data, 7 as unknown as Buffer)).toThrow();
    expect(readdirSafe(reviseRoot(data))).toEqual([]);
  });

  it("a revise whose image cannot be saved answers 500 with a sentence and starts nothing", async () => {
    const t = makeApp();
    const { file } = shopRepo();
    const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
    // A file where the revise folder should be: the image cannot be written.
    writeFileSync(reviseRoot(t.dataDir), "in the way");
    const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, kind: "revise", view: "overview", image: TINY_PNG, engine: "fixture", model: null } });
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).toMatch(/^The drawing's image could not be saved for the engine: /);
    expect(t.runs.runningOn(id)).toBeNull();
  });

  it("Claude Code is told to read the image with its Read tool; Codex, which gets it attached, to read no file", async () => {
    const prompts: Record<string, string> = {};
    class Recorder implements Engine {
      readonly label: string;
      constructor(readonly id: string) { this.label = id; }
      async detect(): Promise<EngineInfo> { return { id: this.id, label: this.label, available: true, version: "1", detail: "", test: false, models: [] }; }
      async run(req: EngineRunRequest): Promise<unknown> { prompts[this.id] = req.task?.prompt ?? ""; return fixtureNudge(req.base, req.view); }
    }
    const t = makeApp({ engines: [new Recorder("claude"), new Recorder("codex")] });
    const { file } = shopRepo();
    const id = ((await (await t.req("/api/files", { method: "POST", json: { path: file } })).json()) as { id: string }).id;
    for (const engine of ["claude", "codex"]) {
      const r = await t.req("/api/runs", { method: "POST", json: { diagramId: id, kind: "revise", view: "overview", image: TINY_PNG, engine, model: null } });
      const { runId } = (await r.json()) as { runId: string };
      expect((await t.runs.wait(runId))?.status).toBe("succeeded");
    }
    expect(prompts.claude).toContain("with your Read tool");
    // The path on its own line, then the sentence with no stray space before it.
    expect(prompts.claude).toMatch(/view\.png\r?\nThat image is the only file you may read/);
    expect(prompts.codex).not.toMatch(/Read tool/);
    expect(prompts.codex).toContain("The image attached to this message");
    expect(prompts.codex).toContain("Read, list or search no file.");
  });
});
