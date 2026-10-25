import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChannel, joinChannel } from "./channels";
import { readAnyFile } from "./convert";
import { validateFile3, type File3 } from "./file3";
import {
  choiceAsFile3, choiceDoc, choiceOfFocus, convertV3, normalizeFile4, resolveChoice, slugOf, validateFile4, withChoice,
  type ChoiceInput4, type Document4, type File4,
} from "./file4";

const NOW = "2026-10-25T00:00:00.000Z";
const shop3 = (): File3 => JSON.parse(readFileSync(join(__dirname, "..", "..", "examples", "shop.archdraw.json"), "utf8"));

/** The shop as a choice of its own: its overview view renamed, so view ids stay unique across the file. */
function asChoice(id: string, kind: ChoiceInput4["kind"], title: string): ChoiceInput4 {
  const f = shop3();
  f.channels.overview.views[0].id = `${id}-overview`;
  return { id, title, kind, about: `${title}.`, facts: f.facts, channels: f.channels };
}
/** Three choices: a flow, a section and the whole system, in that order. */
function three(): File4 {
  const f = convertV3(shop3());
  f.choices = [asChoice("checkout", "flow", "Checking out"), asChoice("server", "section", "The server side"), ...f.choices];
  return f;
}
const doc4 = (f: File4 = three()): Document4 => normalizeFile4(f, { id: "d_choices001", now: NOW, source: null });

describe("format 4 (FILE-2, diagram contract Choice)", () => {
  it("a format 3 file becomes one choice, the whole system, with nothing lost and no warning", () => {
    const f3 = { ...shop3(), theme: "dark" as const, requests: [{ id: "q1", text: "Add a cache", channel: "overview" as const, view: "overview", at: NOW }], warnings: ["Kept"] };
    expect(validateFile3(f3).ok).toBe(true);
    const r = readAnyFile(f3);
    expect([r.ok, r.from, r.warnings]).toEqual([true, "@3", []]);
    const f4 = r.file!;
    expect(f4.schema).toBe("archdraw/diagram@4");
    expect(f4.choices.map((c) => [c.id, c.title, c.kind, c.about])).toEqual([["system", "The whole system", "system", ""]]);
    expect(f4.requests).toEqual([{ ...f3.requests[0], choice: "system" }]);
    expect([f4.title, f4.theme, f4.warnings]).toEqual([f3.title, "dark", ["Kept"]]);
    // Every fact, view, part and connection is as it was: reading the choice back gives the @3 file.
    expect(choiceAsFile3(f4)).toEqual(f3);
    // An invalid one is not converted; its violations are named under the choice it would be (rule 1).
    const broken = shop3();
    broken.facts.components[0].kind = "database" as never;
    expect(readAnyFile(broken)).toMatchObject({ ok: false, from: "@3", file: null, errors: [expect.stringMatching(/^choices\[0\]\.facts\.components\[0\]\.kind: /)] });
  });

  it("a file of three choices validates, normalises and keeps each choice as it was", () => {
    const f = three();
    expect(validateFile4(f)).toMatchObject({ ok: true, errors: [] });
    const d = doc4(f);
    expect(d.choices.map((c) => [c.id, c.kind])).toEqual([["checkout", "flow"], ["server", "section"], ["system", "system"]]);
    for (const c of d.choices) expect(c.channels.overview.views[0].nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    // Read back, it is the same document.
    expect(doc4(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("refuses each broken rule with its choice in the path", () => {
    const bad = (change: (f: File4) => void) => { const f = three(); change(f); return validateFile4(f).errors; };
    expect(bad((f) => { f.choices[1].id = "checkout"; })).toContain('choices[1].id: "checkout" is used twice; choice ids are unique');
    expect(bad((f) => { f.choices[0].kind = "system"; })).toEqual([expect.stringMatching(/^choices\[2\]\.kind: choices\[0\] is already the system choice/)]);
    expect(bad((f) => { (f.choices[0] as { kind: string }).kind = "story"; })[0]).toMatch(/^choices\[0\]\.kind: "story" is not a kind of choice/);
    expect(bad((f) => { f.choices[1].title = "x".repeat(81); })).toEqual(["choices[1].title: is 81 characters; at most 80"]);
    expect(bad((f) => { f.choices[1].title = "  "; })).toEqual(["choices[1].title: must not be empty"]);
    expect(bad((f) => { f.choices[1].about = "x".repeat(301); })).toEqual(["choices[1].about: is 301 characters; at most 300"]);
    expect(bad((f) => { (f.choices[0] as unknown as Record<string, unknown>).extra = 1; })[0]).toMatch(/^choices\[0\]\.extra: /);
    expect(bad((f) => { f.choices = []; })).toEqual(["choices: must hold at least one choice"]);
    expect(bad((f) => { for (let i = 0; i < 10; i++) f.choices.push(asChoice(`more${i}`, "custom", `More ${i}`)); })).toEqual(["choices: has 13 choices; at most 12"]);
    expect(bad((f) => { f.choices[1].channels.overview.views[0].id = "checkout-overview"; })).toEqual(['choices[1].channels.overview.views[0].id: "checkout-overview" is a view of choices[0]; view ids are unique across the file']);
    expect(bad((f) => { f.choices[0].channels.overview.views[0].nodes[0].detail = "server-overview"; })[0]).toMatch(/^choices\[0\]\.channels\.overview\.views\[0\]\.nodes\[0\]\.detail: /);
    expect(bad((f) => { f.choices[1].facts.components[0].kind = "database" as never; })[0]).toMatch(/^choices\[1\]\.facts\.components\[0\]\.kind: /);
    expect(bad((f) => { f.requests = [{ id: "q1", text: "x", choice: "nope", channel: "overview", view: "overview", at: NOW }]; })).toEqual(['requests[0].choice: "nope" is not a choice of this file']);
    expect(bad((f) => { f.requests = [{ id: "q1", text: "x", choice: "server", channel: "overview", view: "checkout-overview", at: NOW }]; })).toEqual(['requests[0].view: view "checkout-overview" is not in the overview channel of the choice "server"']);
    expect(bad((f) => { (f as { schema: string }).schema = "archdraw/diagram@9"; })).toEqual(['schema: must be "archdraw/diagram@4"']);
    // Twelve choices are the most a file holds.
    const twelve = three();
    for (let i = 0; i < 9; i++) twelve.choices.push(asChoice(`more${i}`, "custom", `More ${i}`));
    expect(validateFile4(twelve).ok).toBe(true);
  });

  it("an edit in one choice changes no other", () => {
    const d = doc4();
    const one = choiceDoc(d, "server");
    expect(one.channels.overview.views[0].id).toBe("server-overview");
    const draft = joinChannel(one, "overview");
    draft.views[0].nodes[0].label = "Storefront";
    const r = applyChannel(one, "overview", draft);
    if (!r.ok) throw new Error(r.error);
    const after = withChoice(d, "server", r.doc);
    expect(after.choices.find((c) => c.id === "server")!.facts.components[0].label).toBe("Storefront");
    for (const id of ["checkout", "system"]) expect(after.choices.find((c) => c.id === id)).toEqual(d.choices.find((c) => c.id === id));
    expect(validateFile4(after).ok).toBe(true);
  });

  it("names the choice an export, a request or a run acts on: the named one, else the one holding the view, else the first", () => {
    const d = doc4();
    expect((resolveChoice(d, undefined, undefined) as { id: string }).id).toBe("checkout");
    expect((resolveChoice(d, "system", undefined) as { id: string }).id).toBe("system");
    expect((resolveChoice(d, undefined, "server-overview") as { id: string }).id).toBe("server");
    expect(resolveChoice(d, "nope", undefined)).toBe('Unknown choice "nope"');
  });

  it("a requested focus becomes a choice with a slug id (api contract, The choices)", () => {
    expect(slugOf("  Réserver une Chambre! ")).toBe("reserver-une-chambre");
    expect(slugOf("!!!")).toBe("choice");
    expect(choiceOfFocus({ kind: "whole" })).toEqual({ id: "system", title: "The whole system", kind: "system", about: "" });
    expect(choiceOfFocus({ kind: "option", option: { title: "The server side", sentence: "Serves.", kind: "section" } })).toEqual({ id: "the-server-side", title: "The server side", kind: "section", about: "Serves." });
    expect(choiceOfFocus({ kind: "option", option: { title: "System", sentence: "S.", kind: "flow" } }).id).toBe("system-2");
    const typed = choiceOfFocus({ kind: "typed", text: "x".repeat(90) }, new Set(["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]));
    expect([typed.id, typed.kind, typed.title.length, typed.title.endsWith("…")]).toEqual(["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-2", "custom", 80, true]);
  });
});

describe("views made in a choice (diagram contract, The view; review 510f7bc-1)", () => {
  it("take the channel's name in the first choice, `<choice id>-<channel>` elsewhere, and never another choice's id", async () => {
    const { prepareLinkedIn } = await import("./export/feed");
    const { prepareChannel } = await import("./simple");
    const d = doc4();
    // The first choice gets `linkedin`; the next its own name, even though `linkedin` is free in its own channels.
    const first = prepareLinkedIn(choiceDoc(d, "checkout"));
    if (!first.ok) throw new Error(first.error);
    expect(first.doc.channels.linkedin.views[0].id).toBe("linkedin");
    const d2 = withChoice(d, "checkout", first.doc);
    const next = prepareLinkedIn(choiceDoc(d2, "server"));
    if (!next.ok) throw new Error(next.error);
    expect(next.doc.channels.linkedin.views[0].id).toBe("server-linkedin");
    const readme = prepareChannel(choiceDoc(d2, "server"), "readme");
    if (!readme.ok) throw new Error(readme.error);
    expect(readme.doc.channels.readme.views[0].id).toBe("server-readme");
    expect(validateFile4(withChoice(d2, "server", next.doc)).ok).toBe(true);
  });
});
