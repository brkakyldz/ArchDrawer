import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { joinDrawing } from "../core/drawing";
import { runCli } from "../cli/main";
import { makeApp, makeFolder, shopFile, shopFile2, tempDir } from "./testkit";

async function cli(...argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ARCHDRAW_DATA_DIR: tempDir(), ARCHDRAW_NO_OPEN: "1" } });
  return { code, out, err };
}

const json = async (r: Response) => ({ status: r.status, body: await r.json() });

/** A repository holding an @2 drawing with a LinkedIn post of its overview. */
function v2WithPost() {
  const root = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n" });
  const f = shopFile2() as { views: Record<string, unknown>[] };
  const overview = f.views[0] as { nodes: { id: string }[] };
  f.views.push({
    id: "overview-linkedin", title: "LinkedIn", caption: { title: "Shop in one look", lede: "" }, postOf: "overview",
    nodes: overview.nodes.map((n) => ({ ...n, id: `${n.id}-li`, from: [n.id], form: "card", items: [], place: null })),
    edges: [], texts: [],
  });
  const file = join(root, "shop.archdraw.json");
  writeFileSync(file, JSON.stringify(f, null, 2));
  return { root, file };
}

describe("@3 through the server (FILE-2)", () => {
  it("opens an @2 file, writes it back as @3 with one warning, and serves both channels", async () => {
    const t = makeApp();
    const { file } = v2WithPost();
    const r = await json(await t.req("/api/files", { method: "POST", json: { path: file } }));
    expect(r.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.schema).toBe("archdraw/diagram@3");
    expect(onDisk.facts.components.map((c: { id: string }) => c.id)).toEqual(["web", "api", "db"]);
    expect(onDisk.channels.linkedin.views[0].nodes.map((n: { facts: string[] }) => n.facts)).toEqual([["web"], ["api"], ["db"]]);
    expect(onDisk.warnings).toEqual(["Converted from archdraw/diagram@2"]);
    const id = r.body.id as string;
    // Exports take the channel (the overview by default); an empty one is refused.
    const li = await t.req(`/api/diagrams/${id}/export.svg?channel=linkedin&format=feed`);
    expect(li.status).toBe(200);
    expect(await li.text()).toContain('data-node-id="web-li"');
    expect(await json(await t.req(`/api/diagrams/${id}/export.svg?view=overview-linkedin`))).toEqual({ status: 400, body: { error: 'Unknown view "overview-linkedin"' } });
    expect(await json(await t.req(`/api/diagrams/${id}/export.svg?channel=readme`))).toEqual({ status: 400, body: { error: 'The channel "readme" has no drawing' } });
    expect(await json(await t.req(`/api/diagrams/${id}/export.mmd?channel=blog`))).toEqual({ status: 400, body: { error: 'Unknown channel "blog"; use one of overview, linkedin, readme, presentation' } });
    expect(await json(await t.req(`/api/diagrams/${id}/export.svg?channel=overview&view=overview-linkedin`))).toEqual({ status: 400, body: { error: 'Unknown view "overview-linkedin"' } });
    // A request names its channel.
    const q = await json(await t.req(`/api/diagrams/${id}/requests`, { method: "POST", json: { channel: "linkedin", view: "overview-linkedin", text: "Shorter" } }));
    expect(q.status).toBe(201);
    expect(JSON.parse(readFileSync(file, "utf8")).requests).toEqual([expect.objectContaining({ channel: "linkedin", view: "overview-linkedin" })]);
  });

  it("marks the LinkedIn channel when a session renames a fact that LinkedIn names in its own words", async () => {
    const t = makeApp();
    const { file } = v2WithPost();
    const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.channels.linkedin.views[0].nodes[0].label = "Shop";
    t.store.put(id, doc);
    const outside = JSON.parse(readFileSync(file, "utf8"));
    outside.facts.components[0].label = "Storefront";
    writeFileSync(file, JSON.stringify(outside, null, 2));
    const after = t.store.get(id)!;
    expect(after.channels.linkedin.outdated).toEqual(["web"]);
    expect(after.channels.overview.outdated).toEqual([]);
    expect(joinDrawing(after).views[0].nodes[0].label).toBe("Storefront");
  });

  it("refuses a PUT that breaks an @3 rule, with its path", async () => {
    const t = makeApp();
    const { file } = v2WithPost();
    const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.channels.overview.views[0].nodes.pop();
    const r = await json(await t.req(`/api/diagrams/${id}`, { method: "PUT", json: doc }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^Invalid diagram — /);
    expect(r.body.errors).toContain('facts.components[2]: "db" is shown by no part of the overview channel; draw it there or remove it');
  });

  it("imports @3, @2 and @1 documents", async () => {
    const t = makeApp();
    for (const body of [shopFile(), shopFile2()]) expect((await t.req("/api/diagrams", { method: "POST", json: body })).status).toBe(201);
  });
});

describe("the command line on @3 (FILE-2, START-5)", () => {
  it("migrate converts @2, svg takes a channel", async () => {
    const { file, root } = v2WithPost();
    const m = await cli("migrate", file);
    expect(m.out).toEqual(["Converted from archdraw/diagram@2", "migrated"]);
    expect((await cli("migrate", file)).out).toEqual(["already archdraw/diagram@3"]);
    const out = join(root, "post.svg");
    const svg = await cli("svg", file, "--channel", "linkedin", "--format", "feed", "--out", out);
    expect(svg.code).toBe(0);
    expect(svg.out.at(-1)).toBe(out);
    expect(readFileSync(out, "utf8")).toContain('data-node-id="api-li"');
    expect(await cli("svg", file, "--channel", "blog")).toMatchObject({ code: 2, err: ['Unknown channel "blog"; use one of overview, linkedin, readme, presentation', 'Run "archdrawer --help" for the commands.'] });
    expect(await cli("svg", file, "--channel", "readme")).toMatchObject({ code: 1, err: [`The channel "readme" has no drawing in ${file}`] });
    expect(await cli("svg", file, "--channel", "linkedin", "--view", "overview")).toMatchObject({ code: 1, err: [`No view "overview" in the linkedin channel of ${file}; views: overview-linkedin`] });
  });
});
