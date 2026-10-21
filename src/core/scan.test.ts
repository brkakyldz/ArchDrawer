import { describe, expect, it } from "vitest";
import { checkScan, namedEntries, pickInputs, SCAN_BUDGET, scanText } from "./scan";

// The scan's pure parts (api contract, Scans): inputs from a listing, the budget, the answer's checks.

describe("the scan's inputs", () => {
  const listing = ["README.md", "app/package.json", "app/src/index.ts", "bin/run", "cmd/api/main.go", "docs/readme.txt", "lib/a/b/c/package.json", "package.json", "pyproject.toml", "src/main.py", "src/util.ts"];

  it("takes the folder's README, its dependency files two levels deep and its entry points, shallowest first", () => {
    const r = pickInputs(listing, "", ["src/util.ts"]);
    expect(r.readme).toBe("README.md");
    expect(r.deps).toEqual(["package.json", "pyproject.toml", "app/package.json"]);
    expect(r.entries).toEqual(["src/util.ts", "bin/run", "src/main.py", "app/src/index.ts", "cmd/api/main.go"]);
  });

  it("looks only inside a folder of the repository, and finds what package.json names", () => {
    const r = pickInputs(listing, "app");
    expect(r).toEqual({ readme: null, deps: ["app/package.json"], entries: ["app/src/index.ts"] });
    expect(namedEntries("app/package.json", '{"main": "./dist/x.js", "bin": {"t": "bin/t.js"}, "scripts": {"start": "node server.js --port 1"}}')).toEqual(["app/dist/x.js", "app/bin/t.js", "app/server.js"]);
    expect(namedEntries("pyproject.toml", "x")).toEqual([]);
  });

  it("fills the budget in order and marks what it cut", () => {
    const big = "x".repeat(SCAN_BUDGET.readme + 50);
    const t = scanText({ listing: ["a.ts"], more: 3, readme: { path: "README.md", text: big }, deps: [], entries: [{ path: "a.ts", text: "// a" }] });
    expect(t).toContain("--- Files ---\na.ts\n… 3 more");
    expect(t).toContain("[… cut: 50 more characters]");
    expect(t).toContain("--- Entry point a.ts ---\n// a");
    expect(t.length).toBeLessThan(SCAN_BUDGET.total + 500);
  });

  it("counts the cut from the whole file's length, not from what was read", () => {
    const t = scanText({ listing: [], more: 0, readme: { path: "README.md", text: "x".repeat(SCAN_BUDGET.readme * 2), length: 100_000 }, deps: [], entries: [] });
    expect(t).toContain(`[… cut: ${100_000 - SCAN_BUDGET.readme} more characters]`);
  });
});

describe("the scan's answer", () => {
  const exists = (p: string) => ["src/a.ts", "src/b.ts"].includes(p);

  it("keeps options backed by files that exist, at most five, with one warning per change", () => {
    const opt = (title: string, files: string[], kind = "flow") => ({ kind, title, sentence: `${title}.`, files });
    const r = checkScan({
      card: { name: "", sentence: "Sells things.", type: "robot", languages: ["TypeScript"], entryPoints: ["src/a.ts", "gone.ts"] },
      options: [opt("One", ["src/a.ts"]), opt("Gone", ["src/a.ts", "gone.ts"]), opt("None", []), opt("Two", ["./src/b.ts"], "loop"), opt("3", ["src/a.ts"]), opt("4", ["src/a.ts"]), opt("5", ["src/a.ts"]), opt("6", ["src/a.ts"])],
    }, { folderName: "shop", exists });
    expect(r.card).toEqual({ name: "shop", sentence: "Sells things.", type: "other", languages: ["TypeScript"], entryPoints: ["src/a.ts"] });
    expect(r.options.map((o) => [o.id, o.kind, o.title, o.files])).toEqual([["o1", "flow", "One", ["src/a.ts"]], ["o2", "flow", "Two", ["src/b.ts"]], ["o3", "flow", "3", ["src/a.ts"]], ["o4", "flow", "4", ["src/a.ts"]], ["o5", "flow", "5", ["src/a.ts"]]]);
    expect(r.warnings).toEqual([
      'The card had no name; named it "shop"',
      'Unknown repository type "robot", taken as other',
      'Dropped the entry point "gone.ts": not found',
      'Left out the option "Gone": "gone.ts" does not exist',
      'Left out the option "None": it names no file',
      'Unknown focus kind "loop" for "Two", taken as flow',
      'Left out the option "6": at most 5 options',
    ]);
  });

  it("fails an answer with no card or no options list", () => {
    expect(() => checkScan({ options: [] }, { folderName: "x", exists })).toThrow("The engine's scan has no card or no options");
  });
});
