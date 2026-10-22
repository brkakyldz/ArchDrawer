import { existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEvidence } from "../core/evidence";
import { checkFolder, repoFile } from "./folders";
import { makeFolder } from "./testkit";

// A typed folder's key (api contract, Folders) and the repository file check the evidence and scan
// checks use (diagram contract, The evidence check, step 1).

/** Whether the system's temporary folder is on a file system that ignores letter case (Windows, macOS). */
const caseInsensitive = tmpdir().toUpperCase() !== tmpdir() && existsSync(tmpdir().toUpperCase());

describe("a typed folder", () => {
  it.runIf(caseInsensitive)("is the same folder, with the disk's letter case, however its letters are typed", () => {
    const dir = makeFolder({ ".git/HEAD": "ref: refs/heads/main\n", "src/a.ts": "" });
    const typed = [dir, dir.toUpperCase(), dir.toLowerCase(), join(dir.toUpperCase(), "SRC")];
    const [a, b, c, sub] = typed.map((p) => checkFolder(p));
    for (const f of [a, b, c, sub]) expect(f).not.toHaveProperty("error");
    const key = (f: typeof a) => ("error" in f ? f.error : `${f.root}\0${f.rel}`);
    expect(key(b)).toBe(key(a));
    expect(key(c)).toBe(key(a));
    expect("error" in sub ? null : sub.rel).toBe("src");
  });
});

describe("the repository file check", () => {
  it("passes regular files only: a folder, with or without a trailing slash, is not found", () => {
    const root = makeFolder({ "src/a.ts": "one\ntwo\n", "src/deep/b.ts": "" });
    const exists = repoFile(root);
    expect(exists("src/a.ts")).toBe(true);
    expect(exists("src/deep/b.ts")).toBe(true);
    for (const dir of ["src", "src/", "src\\", "src/deep", "src/deep/", ".", "", "src/a.ts/"]) expect(exists(dir), dir).toBe(false);
    expect(exists("../x.ts")).toBe(false);
  });

  it("follows a link inside the repository to a file, never to a folder", () => {
    const root = makeFolder({ "src/a.ts": "" });
    // Windows makes a file link only with the right to; a junction (a folder link) needs none.
    const link = (target: string, path: string, type: "file" | "junction") => { try { symlinkSync(target, path, type); return true; } catch { return false; } };
    const exists = repoFile(root);
    expect(link(join(root, "src"), join(root, "linkdir"), "junction")).toBe(true);
    expect(exists("linkdir")).toBe(false);
    if (link(join(root, "src", "a.ts"), join(root, "link.ts"), "file")) expect(exists("link.ts")).toBe(true);
  });

  it("drops a folder cited as evidence with the usual warning", () => {
    const root = makeFolder({ "src/a.ts": "one\n" });
    const c = (id: string, evidence: { file: string; lines: [number, number] | null }[]) =>
      ({ id, label: id, kind: "service" as const, sub: "", description: "x", files: [], items: [], within: null, evidence });
    const r = checkEvidence({ components: [c("app", [{ file: "src", lines: null }, { file: "src/", lines: null }, { file: "src/a.ts", lines: null }]), c("web", [{ file: "src/", lines: null }])], relations: [], limits: [] },
      { exists: repoFile(root), lineCount: () => 1 });
    expect(r.warnings).toEqual([
      "app: dropped the evidence src: not found",
      "app: dropped the evidence src/: not found",
      "web: dropped the evidence src/: not found",
      'Dropped "web": no evidence left',
    ]);
    expect(r.facts.components.map((x) => [x.id, x.files])).toEqual([["app", ["src/a.ts"]]]);
  });
});
