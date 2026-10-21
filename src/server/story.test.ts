import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeApp, makeFolder, shopFile2 } from "./testkit";

// Story runs on every channel but the overview (api contract, Run kinds; diagram contract, Story answers).

const json = async (r: Response) => ({ status: r.status, body: await r.json() });
async function opened() {
  const t = makeApp();
  const root = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n" });
  const file = join(root, "shop.archdraw.json");
  writeFileSync(file, JSON.stringify(shopFile2(), null, 2));
  const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
  const run = async (body: object) => {
    const r = await json(await t.req("/api/runs", { method: "POST", json: { diagramId: id, engine: "fixture", model: null, ...body } }));
    return r.status === 202 ? t.runs.wait(r.body.runId) : r;
  };
  return { t, file, id, run, read: () => JSON.parse(readFileSync(file, "utf8")) };
}

describe("story runs", () => {
  it("draw the README from the overview's first view, from the facts alone, and change nothing else", async () => {
    const { run, read } = await opened();
    const before = read();
    const r = await run({ kind: "story", channel: "readme" });
    expect(r).toMatchObject({ status: "succeeded", kind: "story", channel: "readme", view: "readme", route: null, path: null });
    expect((r as { layoutReport: { format: string; targets: unknown } }).layoutReport).toMatchObject({ format: "readme", targets: { parts: null, zones: null, connections: null } });
    const after = read();
    expect(after.channels.readme.views[0]).toMatchObject({ id: "readme", title: "README" });
    expect(after.channels.readme.views[0].nodes.map((p: { id: string }) => p.id)).toEqual(before.channels.overview.views[0].nodes.map((p: { id: string }) => p.id));
    expect(after.facts).toEqual(before.facts);
    expect(after.channels.overview).toEqual(before.channels.overview);
  });

  it("give the presentation its steps, the fixture's ghost-part step dropped with a warning", async () => {
    const { run, read } = await opened();
    const r = await run({ kind: "story", channel: "presentation" });
    expect(r).toMatchObject({ status: "succeeded", channel: "presentation", view: "presentation" });
    const doc = read();
    expect(doc.channels.presentation.steps.map((s: { id: string; text: string }) => [s.id, s.text])).toEqual([["s1", "Step 1: Web app"], ["s2", "Step 2: Order API"], ["s3", "Step 3: Orders DB"]]);
    expect(doc.warnings.filter((w: string) => w.startsWith("Step 4"))).toEqual(["Step 4 names no part and was dropped"]);
    expect((r as { layoutReport: { format: string } }).layoutReport.format).toBe("slide");
  });

  it("on LinkedIn a story is a post, and a story's refusals come before any engine", async () => {
    const a = await opened(), b = await opened();
    await a.run({ kind: "story", channel: "linkedin" });
    await b.run({ kind: "post" });
    const strip = (d: { channels: { linkedin: unknown } }) => d.channels.linkedin;
    expect(strip(a.read())).toEqual(strip(b.read()));
    const refused = async (body: object) => (await a.run(body)) as { status: number; body: { error: string } };
    expect((await refused({ kind: "story" })).body.error).toBe("A story is drawn in the linkedin, readme or presentation channel");
    expect((await refused({ kind: "story", channel: "overview" })).body.error).toBe("A story is drawn in the linkedin, readme or presentation channel");
    expect((await refused({ kind: "story", channel: "readme", scope: { kind: "all" } })).body.error).toBe('A story draws the channel\'s one view: give no scope or {"kind": "view"}');
    expect((await refused({ kind: "story", channel: "linkedin", format: "readme" })).body.error).toBe('Invalid format "readme"; use one of feed, linkedin');
    expect((await refused({ kind: "story", channel: "readme", format: "square" })).body.error).toBe('Invalid format "square"; use one of readme');
    expect((await refused({ kind: "story", channel: "presentation", format: "readme" })).body.error).toBe('Invalid format "readme"; use one of slide');
    expect((await refused({ kind: "draw" })).body.error).toBe("Scan the folder first: that scan is unknown or did not succeed");
    expect((await refused({ kind: "refine", instruction: "x", view: "overview", readCode: true })).body.error).toBe("readCode is for a story");
    expect((await refused({ kind: "poster" })).body.error).toBe("Unknown run kind poster: use refine, story, post, simplify or draw");
  });
});
