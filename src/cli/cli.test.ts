import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { BUILD, loadConfig, VERSION } from "../server/config";
import { shopFile, shopRepo, tempDir } from "../server/testkit";
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
    // The shop's overview has no zones: one overview-target warning, still valid.
    expect(await cli("validate", file)).toMatchObject({ code: 0, out: [expect.stringMatching(/^WARN  views\[0\]: the overview has 0 zones/), "valid with 1 warning(s)"] });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("lists every violation with its path and what is allowed, then the count", async () => {
    const { file } = shopRepo();
    const f = shopFile() as { views: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }[] };
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
});

describe("archdrawer migrate, usage", () => {
  it("rewrites a v1 file as v2 and leaves a v2 file alone", async () => {
    const dir = tempDir();
    const f = join(dir, "old.json");
    writeFileSync(f, JSON.stringify({
      schema: "archdraw/diagram@1", title: "Old", subtitle: "", theme: "light", showSteps: false, direction: "LR",
      nodes: [{ id: "a", label: "A", kind: "ui", tech: "", description: "A.", group: null, files: [], x: 0, y: 0 }], groups: [], edges: [], notes: [],
    }));
    const r = await cli("migrate", f);
    expect(r.out).toEqual(['Component "a": kind ui became client', "migrated"]);
    expect(JSON.parse(readFileSync(f, "utf8")).schema).toBe("archdraw/diagram@2");
    expect((await cli("migrate", f)).out).toEqual(["already archdraw/diagram@2"]);
    expect((await cli("validate", f)).code).toBe(0);
  });

  it("--version, --help, no arguments and unknown commands", async () => {
    expect(await cli("--version")).toMatchObject({ code: 0, out: [VERSION] });
    expect((await cli("--help")).code).toBe(0);
    expect((await cli()).code).toBe(2);
    expect((await cli("draw")).code).toBe(2);
    expect((await cli("validate")).code).toBe(2);
  });

  it("status says not running for an empty data directory", async () => {
    expect((await cli("status")).out).toEqual(["not running"]);
    expect((await cli("stop")).out).toEqual(["not running"]);
    expect(existsSync(join(tempDir(), "server.json"))).toBe(false);
  });
});

describe("archdrawer open replaces a server running older code", () => {
  /** A stand-in server answering health with `build` and counting shutdowns. */
  const fake = async (build: string) => {
    let shutdowns = 0;
    const srv = createServer((req, res) => {
      if (req.url === "/api/health") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, app: "archdrawer", build })); return; }
      if (req.url === "/api/shutdown" && req.method === "POST" && req.headers["x-archdraw-token"] === "t0k") { shutdowns++; res.end("{}"); srv.close(); srv.closeAllConnections(); return; }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    const dataDir = tempDir();
    writeFileSync(join(dataDir, "server.json"), JSON.stringify({ port, pid: 1, token: "t0k", version: VERSION, build }));
    return { dataDir, port, shutdowns: () => shutdowns, close: () => { srv.close(); srv.closeAllConnections(); } };
  };
  const io = () => { const out: string[] = []; return { out, io: { out: (l: string) => out.push(l), err: () => {}, env: {} } }; };
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
});
