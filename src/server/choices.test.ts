import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli/main";
import { convertV3, documentOf, type ChoiceInput4, type Document4, type File4 } from "../core/file4";
import { fillDefaults3, type File3, type Part } from "../core/file3";
import { splitMap } from "../core/map";
import { docText } from "./files";
import { makeApp, makeFolder, shopFile, tempDir } from "./testkit";

// Format 4 through the server and the command line (FILE-2, api contract: export.svg, export.mmd, requests, runs; cli contract, svg).

async function cli(...argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ARCHDRAW_DATA_DIR: tempDir(), ARCHDRAW_NO_OPEN: "1" } });
  return { code, out, err };
}
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

/** The shop as one choice of a file: its overview view renamed, and for a smaller one only its first two facts. */
function shopChoice(id: string, kind: ChoiceInput4["kind"], title: string, small = false): ChoiceInput4 {
  const f = shopFile() as unknown as File3;
  const v = f.channels.overview.views[0];
  v.id = `${id}-overview`;
  if (small) {
    const keep = new Set(f.facts.components.slice(0, 2).map((c) => c.id));
    f.facts.components = f.facts.components.filter((c) => keep.has(c.id));
    f.facts.relations = (f.facts.relations ?? []).filter((r) => keep.has(r.from) && keep.has(r.to));
    v.nodes = v.nodes.filter((n) => n.facts.every((x) => keep.has(x)) && n.facts.length);
    v.edges = v.edges.filter((e) => v.nodes.some((n) => n.id === e.from) && v.nodes.some((n) => n.id === e.to)).map((e) => ({ ...e, relations: (e.relations ?? []).filter((r) => f.facts.relations!.some((x) => x.id === r)) }));
  }
  return { id, title, kind, about: "", facts: f.facts, channels: { overview: f.channels.overview } };
}
/** A repository holding a file of three choices: a small flow first, a section, then the whole system. */
function threeRepo() {
  const root = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n" });
  const file = join(root, "three.archdraw.json");
  const f: File4 = convertV3(shopFile() as unknown as File3);
  f.choices = [shopChoice("checkout", "flow", "Checking out", true), shopChoice("server", "section", "The server side"), ...f.choices];
  writeFileSync(file, JSON.stringify(f, null, 2));
  return { root, file };
}
const nodeIds = (svg: string) => [...svg.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]).sort();

describe("a file of choices through the server", () => {
  it("opens as format 4, saves an edit into its choice and reopens with every other choice as it was", async () => {
    const t = makeApp();
    const { file } = threeRepo();
    const r = await json(await t.req("/api/files", { method: "POST", json: { path: file } }));
    expect(r.status).toBe(200);
    const served = (await json(await t.req(`/api/diagrams/${r.body.id}`))).body as Document4;
    expect(served.schema).toBe("archdraw/diagram@4");
    expect(served.choices.map((c) => c.id)).toEqual(["checkout", "server", "system"]);
    const edited = structuredClone(served);
    edited.choices[1].facts.components[0].label = "Storefront";
    expect((await json(await t.req(`/api/diagrams/${r.body.id}`, { method: "PUT", json: edited, headers: { "If-Unmodified-Since-Version": served.updatedAt } }))).status).toBe(200);
    const again = JSON.parse(readFileSync(file, "utf8")) as Document4;
    expect(again.choices[1].facts.components[0].label).toBe("Storefront");
    expect([again.choices[0], again.choices[2]]).toEqual([served.choices[0], served.choices[2]]);
    // A save that breaks a rule of one choice is refused with that choice in the path.
    const broken = structuredClone(again);
    broken.choices[2].channels.overview.views[0].nodes[0].detail = "checkout-overview";
    const refused = await json(await t.req(`/api/diagrams/${r.body.id}`, { method: "PUT", json: broken }));
    expect(refused.status).toBe(400);
    expect(refused.body.errors[0]).toMatch(/^choices\[2\]\.channels\.overview\.views\[0\]\.nodes\[0\]\.detail: /);
  });

  it("every export and request takes the named choice, else the one holding the view, else the first", async () => {
    const t = makeApp();
    const { file } = threeRepo();
    const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const svg = async (q: string) => { const res = await t.req(`/api/diagrams/${id}/export.svg${q}`); expect(res.status, q).toBe(200); return nodeIds(await res.text()); };
    const small = await svg("");
    expect(await svg("?choice=checkout")).toEqual(small);
    expect(await svg("?view=server-overview")).toEqual(await svg("?choice=server"));
    expect((await svg("?choice=system")).length).toBeGreaterThan(small.length);
    expect(await json(await t.req(`/api/diagrams/${id}/export.svg?choice=nope`))).toEqual({ status: 400, body: { error: 'Unknown choice "nope"' } });
    expect(await json(await t.req(`/api/diagrams/${id}/export.svg?choice=server&view=checkout-overview`))).toEqual({ status: 400, body: { error: 'Unknown view "checkout-overview"' } });
    expect((await t.req(`/api/diagrams/${id}/export.mmd?choice=system`)).status).toBe(200);
    expect(await json(await t.req(`/api/diagrams/${id}/export.mmd?choice=nope`))).toEqual({ status: 400, body: { error: 'Unknown choice "nope"' } });
    // A request names its choice: given, or the one holding its view.
    expect((await t.req(`/api/diagrams/${id}/requests`, { method: "POST", json: { view: "server-overview", text: "Add a cache" } })).status).toBe(201);
    expect((await t.req(`/api/diagrams/${id}/requests`, { method: "POST", json: { choice: "system", view: "overview", text: "Add a queue" } })).status).toBe(201);
    expect(await json(await t.req(`/api/diagrams/${id}/requests`, { method: "POST", json: { choice: "server", view: "overview", text: "x" } }))).toEqual({ status: 400, body: { error: 'Unknown view "overview"' } });
    expect((JSON.parse(readFileSync(file, "utf8")) as Document4).requests.map((q) => [q.id, q.choice, q.view])).toEqual([["q1", "server", "server-overview"], ["q2", "system", "overview"]]);
  });

  it("a run changes its choice alone and says which", async () => {
    const t = makeApp();
    const { file } = threeRepo();
    const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const before = JSON.parse(readFileSync(file, "utf8")) as Document4;
    const start = async (body: object) => json(await t.req("/api/runs", { method: "POST", json: { diagramId: id, engine: "fixture", model: null, ...body } }));
    expect(await start({ choice: "nope", view: "overview", instruction: "add Cache component" })).toEqual({ status: 400, body: { error: 'Unknown choice "nope"' } });
    expect(await start({ choice: "checkout", view: "server-overview", instruction: "add Cache component" })).toEqual({ status: 400, body: { error: 'Unknown view "server-overview"' } });
    const r = await start({ view: "server-overview", instruction: "add Cache component" });
    expect(r.status).toBe(202);
    const done = await t.runs.wait(r.body.runId);
    expect(done).toMatchObject({ status: "succeeded", choice: "server", channel: "overview", view: "server-overview" });
    const after = JSON.parse(readFileSync(file, "utf8")) as Document4;
    expect(after.choices[1].facts.components.map((c) => c.id)).toContain("cache");
    expect([after.choices[0], after.choices[2]]).toEqual([before.choices[0], before.choices[2]]);
  });
});

describe("views made in one choice (review 510f7bc-1)", () => {
  it("a simplification's new view takes no id another choice's view has", async () => {
    const t = makeApp();
    const { file } = threeRepo();
    const f = JSON.parse(readFileSync(file, "utf8")) as File4;
    // The first choice already holds a view with the id the fixture's simplification gives its new view.
    f.choices[0].channels.overview.views.push({ id: "inside-the-system", title: "Taken", caption: { title: "Taken", lede: "" }, nodes: [], edges: [] });
    writeFileSync(file, JSON.stringify(f, null, 2));
    const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const r = await json(await t.req("/api/runs", { method: "POST", json: { diagramId: id, kind: "simplify", choice: "server", view: "server-overview", engine: "fixture", model: null } }));
    expect(r.status).toBe(202);
    expect(await t.runs.wait(r.body.runId)).toMatchObject({ status: "succeeded", choice: "server" });
    const after = JSON.parse(readFileSync(file, "utf8")) as Document4;
    const made = after.choices[1].channels.overview.views.map((v) => v.id);
    expect(made).toContain("inside-the-system-2");
    expect(after.choices[0].channels.overview.views.map((v) => v.id)).toContain("inside-the-system");
  });
});

describe("the command line on a file of choices", () => {
  it("validate lists a choice's errors under it; svg takes --choice, else the choice holding --view, else the first", async () => {
    const { root, file } = threeRepo();
    expect((await cli("validate", file)).code).toBe(0);
    const first = join(root, "first.svg"), server = join(root, "server.svg");
    expect((await cli("svg", file, "--out", first)).code).toBe(0);
    expect((await cli("svg", file, "--view", "server-overview", "--out", server)).code).toBe(0);
    expect(nodeIds(readFileSync(first, "utf8"))).not.toEqual(nodeIds(readFileSync(server, "utf8")));
    const named = join(root, "named.svg");
    expect((await cli("svg", file, "--choice", "checkout", "--out", named)).code).toBe(0);
    expect(nodeIds(readFileSync(named, "utf8"))).toEqual(nodeIds(readFileSync(first, "utf8")));
    expect(await cli("svg", file, "--choice", "nope")).toMatchObject({ code: 1, err: [`No choice "nope" in ${file}; choices: checkout, server, system`] });
    expect(await cli("svg", file, "--choice", "server", "--view", "checkout-overview")).toMatchObject({ code: 1, err: [`No view "checkout-overview" in the overview channel of ${file}; views: server-overview`] });
    const f = JSON.parse(readFileSync(file, "utf8"));
    f.choices[2].facts.components[0].kind = "database";
    writeFileSync(file, JSON.stringify(f));
    const bad = await cli("validate", file);
    expect(bad.code).toBe(1);
    expect(bad.out[0]).toMatch(/^ERROR choices\[2\]\.facts\.components\[0\]\.kind: /);
    expect((await cli("migrate", file)).out).toEqual(["already archdraw/diagram@4"]);
  });
});

describe("a system choice's channels are told from its map and detail views (review c6b6f72-1)", () => {
  it("a story run and a refine routed to the story see the map's parts and the detail view's, the card with an inside skipped", async () => {
    const d = fillDefaults3(shopFile() as unknown as File3);
    const v = d.channels.overview.views[0];
    v.nodes.push({ id: "zone-back", facts: [], form: "group", icon: null, parent: null, detail: null, place: null, label: "Back end", x: 0, y: 0 } as Part);
    for (const n of v.nodes) if (n.id === "api" || n.id === "db") n.parent = "zone-back";
    const split = splitMap(d);
    expect(split.channels.overview.views.map((x) => x.id)).toEqual(["overview", "zone-back-inside"]);
    const root = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n" });
    const file = join(root, "map.archdraw.json");
    writeFileSync(file, docText(documentOf(split)));
    const t = makeApp();
    const id = (await json(await t.req("/api/files", { method: "POST", json: { path: file } }))).body.id as string;
    const start = async (body: object) => {
      const r = await json(await t.req("/api/runs", { method: "POST", json: { diagramId: id, engine: "fixture", model: null, ...body } }));
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      return (await t.runs.wait(r.body.runId))!;
    };
    const readmeParts = () => (JSON.parse(readFileSync(file, "utf8")) as Document4).choices[0].channels.readme.views[0].nodes.map((n) => n.id).sort();
    const story = await start({ kind: "story", channel: "readme", readCode: false });
    expect([story.status, story.error]).toEqual(["succeeded", null]);
    expect(readmeParts()).toEqual(["api", "db", "web"]);
    // The report names the choice it measured (review c6b6f72-5).
    expect(story.layoutReport?.choice).toBe("system");
    // A refine routed to the story draws the channel again from the same base.
    const routed = await start({ kind: "refine", channel: "readme", view: "readme", instruction: "Tell it again [fixture:story]" });
    expect([routed.status, routed.route]).toEqual(["succeeded", "story"]);
    expect(readmeParts()).toEqual(["api", "db", "web"]);
  });
});
