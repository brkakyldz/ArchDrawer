import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { APP_ROOT, BUILD, loadConfig, VERSION } from "../server/config";
import { shopFile2, shopRepo, tempDir } from "../server/testkit";
import { current, runCli } from "./main";

async function cli(...argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ARCHDRAW_DATA_DIR: tempDir(), ARCHDRAW_NO_OPEN: "1" } });
  return { code, out, err };
}

describe("archdrawer validate", () => {
  it("says valid and writes nothing", async () => {
    const { file } = shopRepo();
    const before = readFileSync(file, "utf8");
    // The overview has no count targets (ADR 0007): the shop is valid without a warning.
    expect(await cli("validate", file)).toMatchObject({ code: 0, out: ["valid"] });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("checks a file holding the removed presentation channel without it, with one warning, and writes nothing", async () => {
    const { file } = shopRepo();
    const f = JSON.parse(readFileSync(file, "utf8"));
    f.channels.presentation = { views: [{ ...f.channels.overview.views[0], id: "presentation", title: "Presentation" }], steps: [] };
    writeFileSync(file, JSON.stringify(f));
    const before = readFileSync(file, "utf8");
    const r = await cli("validate", file);
    expect(r.code).toBe(0);
    expect(r.out.filter((l) => l.startsWith("WARN "))).toEqual(["WARN  The presentation channel was removed"]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("lists every violation with its path and what is allowed, then the count", async () => {
    const { file } = shopRepo();
    const f = shopFile2() as { views: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] };
    f.views[0].nodes[0].kind = "database";
    f.views[0].nodes[1].files = ["src/missing.ts"];
    f.views[0].edges[1].to = "ghost";
    writeFileSync(file, JSON.stringify(f));
    const r = await cli("validate", file);
    expect(r.code).toBe(1);
    const errors = r.out.filter((l) => l.startsWith("ERROR "));
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/^ERROR views\[0\]\.nodes\[0\]\.kind: "database" is not a kind; use one of actor, client/);
    expect(r.out.at(-1)).toBe("3 error(s)");
  });

  it("not JSON → one ERROR line; a v1 file → points at migrate", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.json"), "{ nope");
    const bad = await cli("validate", join(dir, "a.json"));
    expect(bad.code).toBe(1);
    expect(bad.out[0]).toMatch(/^ERROR json: /);
    writeFileSync(join(dir, "old.json"), JSON.stringify({ schema: "archdraw/diagram@1", title: "x" }));
    expect((await cli("validate", join(dir, "old.json"))).out[0]).toBe('ERROR schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"');
  });
});

describe("archdrawer svg", () => {
  it("writes the share image next to the file by default, with embedded fonts", async () => {
    const { root, file } = shopRepo();
    const r = await cli("svg", file, "--format", "feed", "--theme", "dark");
    const out = join(root, "shop-overview-feed.svg");
    expect(r.code).toBe(0);
    expect(r.out.at(-1)).toBe(out);
    const svg = readFileSync(out, "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1080" height="1350"/);
    expect(svg).toContain('data-theme="dark"');
    expect(svg).toContain("@font-face{font-family:Geist;");
    const custom = join(tempDir(), "x.svg");
    expect((await cli("svg", file, "--out", custom)).code).toBe(0);
    expect(readFileSync(custom, "utf8")).toContain('width="1620" height="1080"');
  });

  it("refuses unknown formats, themes and views", async () => {
    const { file } = shopRepo();
    expect((await cli("svg", file, "--format", "poster")).code).toBe(2);
    expect((await cli("svg", file, "--theme", "blue")).code).toBe(2);
    expect((await cli("svg", file, "--view", "nope")).code).toBe(1);
  });

  it("draws a file whose part names a path missing from the repository, with a warning; validate still refuses it", async () => {
    const { file } = shopRepo();
    const f = shopFile2() as { views: { nodes: Record<string, unknown>[] }[] };
    f.views[0].nodes[1].files = ["src/gone.ts"];
    writeFileSync(file, JSON.stringify(f));
    const r = await cli("svg", file, "--out", join(tempDir(), "x.svg"));
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe('WARN  choices[0].facts.components[1].files[0]: "src/gone.ts" does not exist in the repository');
    expect(await cli("validate", file)).toMatchObject({ code: 1, out: ['ERROR views[0].nodes[1].files[0]: "src/gone.ts" does not exist in the repository', "1 error(s)"] });
  });
});

describe("archdrawer migrate, usage", () => {
  it("rewrites a v1 file as v4 through v2 and v3 and leaves a v4 file alone", async () => {
    const dir = tempDir();
    const f = join(dir, "old.json");
    writeFileSync(f, JSON.stringify({
      schema: "archdraw/diagram@1", title: "Old", subtitle: "", theme: "light", showSteps: false, direction: "LR",
      nodes: [{ id: "a", label: "A", kind: "ui", tech: "", description: "A.", group: null, files: [], x: 0, y: 0 }], groups: [], edges: [], notes: [],
    }));
    const r = await cli("migrate", f);
    expect(r.out).toEqual(['Component "a": kind ui became client', "Converted from archdraw/diagram@2", "migrated"]);
    expect(JSON.parse(readFileSync(f, "utf8")).schema).toBe("archdraw/diagram@4");
    expect((await cli("migrate", f)).out).toEqual(["already archdraw/diagram@4"]);
    expect((await cli("validate", f)).code).toBe(0);
  });

  it("--version, --help, no arguments and unknown commands", async () => {
    expect(await cli("--version")).toMatchObject({ code: 0, out: [VERSION] });
    expect((await cli("--help")).code).toBe(0);
    expect((await cli()).code).toBe(2);
    expect((await cli("draw")).code).toBe(2);
    expect((await cli("validate")).code).toBe(2);
  });

  it("an empty theme and a single-dash option are usage errors; -h and -v still work", async () => {
    const { file } = shopRepo();
    const help = 'Run "archdrawer --help" for the commands.';
    expect(await cli("svg", file, "--theme", "")).toMatchObject({ code: 2, out: [], err: ['Unknown theme ""; use light or dark', help] });
    expect(await cli("validate", "-x")).toMatchObject({ code: 2, out: [], err: ["Unknown or incomplete option -x", help] });
    expect(await cli("open", file, "-n")).toMatchObject({ code: 2, err: ["Unknown or incomplete option -n", help] });
    expect(await cli("-v")).toMatchObject({ code: 0, out: [VERSION] });
    expect((await cli("-h")).code).toBe(0);
  });

  it("status says not running for an empty data directory", async () => {
    expect((await cli("status")).out).toEqual(["not running"]);
    expect((await cli("stop")).out).toEqual(["not running"]);
    expect(existsSync(join(tempDir(), "server.json"))).toBe(false);
  });
});

describe("archdrawer open, status and stop find this data directory's server", () => {
  /**
   * A stand-in server holding the token "t0k": it answers health with `build`, refuses a mutating call
   * without its token as the real one does, and counts shutdowns. `fileToken` is the token server.json
   * names (another one: a stale server.json whose port this server took); `stops: false` keeps answering
   * after a shutdown; `refuses` answers the shutdown with an error.
   */
  const fake = async (build: string, o: { fileToken?: string; stops?: boolean; refuses?: boolean; port?: number } = {}) => {
    let shutdowns = 0;
    const srv = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method !== "GET" && req.headers["x-archdraw-token"] !== "t0k") { res.statusCode = 403; res.end(JSON.stringify({ error: "Missing or wrong token" })); return; }
      if (req.url === "/api/health" && req.method === "GET") { res.end(JSON.stringify({ ok: true, app: "archdrawer", build })); return; }
      if (req.url === "/api/shutdown" && req.method === "POST") {
        shutdowns++;
        if (o.refuses) { res.statusCode = 500; res.end(JSON.stringify({ error: "busy" })); return; }
        res.end("{}");
        if (o.stops !== false) { srv.close(); srv.closeAllConnections(); }
        return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ error: "Not found" }));
    });
    await new Promise<void>((r) => srv.listen(o.port ?? 0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    const dataDir = tempDir();
    writeFileSync(join(dataDir, "server.json"), JSON.stringify({ port, pid: 1, token: o.fileToken ?? "t0k", version: VERSION, build }));
    return { dataDir, port, shutdowns: () => shutdowns, close: () => { srv.close(); srv.closeAllConnections(); } };
  };
  const io = () => { const out: string[] = [], err: string[] = []; return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {} } }; };
  const run = async (dataDir: string, ...argv: string[]) => { const o = io(); const code = await runCli(argv, { ...o.io, env: { ARCHDRAW_DATA_DIR: dataDir } }); return { code, out: o.out, err: o.err }; };
  const started = { port: 1, pid: 2, token: "new", version: VERSION };

  it("stops an older server, says so and starts a new one", async () => {
    const f = await fake("0000000000000000");
    const o = io();
    let starts = 0;
    const info = await current(loadConfig({ ARCHDRAW_DATA_DIR: f.dataDir }), o.io, async () => { starts++; return started; });
    expect(info).toBe(started);
    expect([f.shutdowns(), starts]).toEqual([1, 1]);
    expect(o.out).toEqual(["Restarted the editor server (it was running older code)"]);
  });

  it("keeps a server that runs this build", async () => {
    const f = await fake(BUILD);
    const o = io();
    const info = await current(loadConfig({ ARCHDRAW_DATA_DIR: f.dataDir }), o.io, async () => { throw new Error("must not start"); });
    expect(info.port).toBe(f.port);
    expect([f.shutdowns(), o.out]).toEqual([0, []]);
    f.close();
  });

  it("ignores a stale server.json whose port another archdrawer server of this build now holds", async () => {
    const f = await fake(BUILD, { fileToken: "stale" });
    const o = io();
    let starts = 0;
    expect(await current(loadConfig({ ARCHDRAW_DATA_DIR: f.dataDir }), o.io, async () => { starts++; return started; })).toBe(started);
    expect([f.shutdowns(), starts, o.out]).toEqual([0, 1, []]);
    expect((await run(f.dataDir, "status")).out).toEqual(["not running"]);
    expect(await run(f.dataDir, "stop")).toMatchObject({ code: 0, out: ["not running"] });
    expect(f.shutdowns()).toBe(0);
    f.close();
  });

  it("stop says stopped only once the server no longer answers", async () => {
    const f = await fake(BUILD);
    expect(await run(f.dataDir, "stop")).toMatchObject({ code: 0, out: ["stopped"], err: [] });

    const refusing = await fake(BUILD, { refuses: true });
    expect(await run(refusing.dataDir, "stop")).toMatchObject({ code: 1, out: [], err: ["The editor server refused to stop: busy"] });
    expect((await run(refusing.dataDir, "status")).out).toEqual([`running on http://127.0.0.1:${refusing.port} (pid 1)`]);
    refusing.close();

    const stubborn = await fake(BUILD, { stops: false });
    expect(await run(stubborn.dataDir, "stop")).toMatchObject({ code: 1, out: [], err: [`The editor server on port ${stubborn.port} (pid 1) still answers after 5 s`] });
    expect(stubborn.shutdowns()).toBe(1);
    stubborn.close();
  });

  // These start real servers, on the ports this file owns (4506, 4516); the web client is built first,
  // so the time a test measures is the server's.
  const realEnv = (dataDir: string, port: number) => ({ ARCHDRAW_DATA_DIR: dataDir, PORT: String(port), ARCHDRAW_NO_OPEN: "1" });
  const buildClient = () => expect(spawnSync(process.execPath, [join(APP_ROOT, "scripts", "start.mjs"), "--build-only"], { cwd: APP_ROOT, stdio: "ignore" }).status).toBe(0);

  it("reports a port held by another data directory's server instead of waiting 15 s", async () => {
    buildClient();
    const f = await fake(BUILD, { fileToken: "stale", port: 4516 });
    try {
      const o = io();
      const t = Date.now();
      expect(await runCli(["open", shopRepo().file, "--no-browser"], { ...o.io, env: realEnv(f.dataDir, 4516) })).toBe(1);
      expect(o.err).toHaveLength(1);
      expect(o.err[0]).toMatch(/^The editor server did not start: Port 4516 is in use\. Set PORT to another port\.; see .*server\.log$/);
      expect(Date.now() - t).toBeLessThan(10_000);
      expect(f.shutdowns()).toBe(0);
    } finally { f.close(); }
  }, 180_000);

  it("two opens started together share the server one of them started", async () => {
    buildClient();
    const dataDir = tempDir();
    const [a, b] = [shopRepo().file, shopRepo().file];
    const open = (file: string) => { const o = io(); return runCli(["open", file, "--no-browser"], { ...o.io, env: realEnv(dataDir, 4506) }).then((code) => ({ code, ...o })); };
    try {
      const [ra, rb] = await Promise.all([open(a), open(b)]);
      expect([ra.code, ra.err, rb.code, rb.err]).toEqual([0, [], 0, []]);
      expect(ra.out.at(-1)).toMatch(/^Opened .* → http:\/\/127\.0\.0\.1:4506\/d\//);
      expect(rb.out.at(-1)).toMatch(/^Opened .* → http:\/\/127\.0\.0\.1:4506\/d\//);
    } finally {
      expect(await run(dataDir, "stop")).toMatchObject({ code: 0, out: ["stopped"] });
    }
    // The other command's server, still starting when its command adopted this one, was stopped:
    // it does not take the port once the shared server is gone.
    await new Promise((r) => setTimeout(r, 2500));
    expect(await fetch("http://127.0.0.1:4506/api/health").then(() => "answers", () => "gone")).toBe("gone");
  }, 180_000);
});
