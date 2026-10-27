import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUND_KEEP_MS, Sources, copyOf, walkFound, type Library } from "./sources";
import type { DiagramSummary } from "./store";
import { tempDir } from "./testkit";

// Recent and found (api contract, Recent and found; SRC-1, SRC-2): the folders used before and the
// repositories of the library's drawings, and the git repositories found on the disk.

const real = (p: string) => realpathSync.native(p);

/** A git repository at `dir` whose one commit has the given date; null makes one without a commit. */
function repo(dir: string, date: string | null, branch = "main"): string {
  mkdirSync(dir, { recursive: true });
  const git = (args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date ?? "", GIT_COMMITTER_DATE: date ?? "" }, stdio: "pipe" });
  git(["init", "-q"]);
  git(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  if (date) {
    writeFileSync(join(dir, "f.txt"), "one\n");
    git(["add", "f.txt"]);
    git(["commit", "-q", "-m", "first"]);
  }
  return dir;
}

const library = (list: DiagramSummary[] = []): Library & { list: () => DiagramSummary[]; items: DiagramSummary[] } => {
  const lib = { items: list, list: () => lib.items };
  return lib;
};
const drawing = (id: string, root: string, updatedAt: string): DiagramSummary =>
  ({ id, title: id, path: join(root, "docs", "architecture.archdraw.json"), root, updatedAt, link: null });

afterEach(() => { vi.useRealTimers(); });

describe("Found on this computer", () => {
  it("finds git repositories one or two levels below each root, newest commit first, and skips what the contract skips", async () => {
    const home = real(tempDir("archdraw-home-"));
    const data = join(home, "data");
    repo(join(home, "projects", "alpha"), "2024-01-01T12:00:00Z");
    repo(join(home, "projects", "team", "beta"), "2025-03-01T12:00:00Z");
    repo(join(home, "direct"), "2021-01-01T12:00:00Z", "trunk");
    repo(join(home, "fresh"), null);
    repo(join(home, "projects", "team", "deep", "gamma"), "2023-06-01T12:00:00Z"); // three levels below projects
    repo(join(home, "direct", "inner", "lib"), "2018-01-01T12:00:00Z"); // inside a repository
    for (const skipped of [".hidden", "node_modules", "AppData", "Library", "Applications", "vendor"]) repo(join(home, skipped, "pkg"), "2024-03-01T12:00:00Z");
    repo(join(data, "leak"), "2024-04-01T12:00:00Z");
    mkdirSync(join(home, "code", "plain"), { recursive: true });
    const found = await walkFound([home, join(home, "projects"), join(home, "projects"), join(home, "missing")], { dataDir: data });
    expect(found.map((r) => basename(r.path))).toEqual(["beta", "alpha", "direct", "fresh"]);
    expect(found[0]).toMatchObject({ branch: "main" });
    expect(Date.parse(found[0].lastCommitAt!)).toBe(Date.parse("2025-03-01T12:00:00Z"));
    expect(found[2]).toMatchObject({ branch: "trunk" });
    expect(found[3], "no commit: not in git").toMatchObject({ branch: null, lastCommitAt: null });
  });

  it("looks at no more folders than its limit", async () => {
    const home = real(tempDir("archdraw-home-"));
    for (let i = 0; i < 6; i++) repo(join(home, `r${i}`), "2024-01-01T12:00:00Z");
    expect((await walkFound([home], { dataDir: join(home, "data"), maxFolders: 3 }))).toHaveLength(3);
  });

  it("is kept five minutes, made again on request or after that, and leaves out what Recent lists", async () => {
    const home = real(tempDir("archdraw-home-"));
    const data = tempDir("archdraw-data-");
    repo(join(home, "one"), "2024-01-01T12:00:00Z");
    const s = new Sources({ dataDir: data, library: library(), searchHome: home });
    const first = await s.answer(true);
    expect(first).toMatchObject({ picker: true, recent: [] });
    expect(first.found.map((e) => e.name)).toEqual(["one"]);
    expect(first.found[0]).toMatchObject({ link: null, diagrams: [], usedAt: null, branch: "main" });
    repo(join(home, "two"), "2025-01-01T12:00:00Z");
    const kept = await s.answer(true);
    expect(kept.foundAt).toBe(first.foundAt);
    expect(kept.found.map((e) => e.name)).toEqual(["one"]);
    const again = await s.answer(false, true);
    expect(again.found.map((e) => e.name)).toEqual(["two", "one"]);
    expect(again.picker).toBe(false);
    repo(join(home, "three"), "2026-01-01T12:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + FOUND_KEEP_MS + 1_000);
    const later = await s.answer(true);
    expect(later.found.map((e) => e.name), "made again once five minutes have passed").toEqual(["three", "two", "one"]);
    vi.useRealTimers();
    s.use(join(home, "two"));
    expect((await s.answer(true)).found.map((e) => e.name), "Recent wins").toEqual(["three", "one"]);
    expect(existsSync(join(data, "sources.json"))).toBe(true);
  });

  it("shares one walk between requests that arrive while it is made", async () => {
    const home = real(tempDir("archdraw-home-"));
    repo(join(home, "one"), "2024-01-01T12:00:00Z");
    const s = new Sources({ dataDir: tempDir("archdraw-data-"), library: library(), searchHome: home });
    const [a, b] = await Promise.all([s.answer(true), s.answer(true)]);
    expect(a.foundAt).toBe(b.foundAt);
  });

  it("searches the parent of each drawing's repository too", async () => {
    const home = real(tempDir("archdraw-home-"));
    const extra = real(tempDir("archdraw-extra-"));
    const r1 = repo(join(extra, "r1"), "2024-01-01T12:00:00Z");
    repo(join(extra, "r2"), "2024-02-01T12:00:00Z");
    const s = new Sources({ dataDir: tempDir("archdraw-data-"), library: library([drawing("d_1", r1, "2026-01-01T00:00:00.000Z")]), searchHome: home });
    const a = await s.answer(true);
    expect(a.found.map((e) => e.name)).toEqual(["r2"]);
    expect(a.recent.map((e) => e.name)).toEqual(["r1"]);
  });
});

describe("Recent", () => {
  const setup = () => {
    const data = tempDir("archdraw-data-");
    const lib = library();
    const s = new Sources({ dataDir: data, library: lib, searchHome: real(tempDir("archdraw-home-")) });
    return { data, lib, s, file: join(data, "sources.json") };
  };

  it("lists the folders used, newest first, with their branch and last commit, writes nothing when asked, and leaves a gone folder out", async () => {
    const { s, file } = setup();
    const a = real(repo(join(tempDir(), "a"), "2024-05-01T10:00:00+03:00"));
    const b = real(repo(join(tempDir(), "b"), null));
    expect(await s.recent()).toEqual([]);
    expect(existsSync(file), "asking writes nothing").toBe(false);
    s.use(a); s.use(b);
    let recent = await s.recent();
    expect(recent.map((e) => e.path)).toEqual([b, a]);
    expect(recent[1]).toMatchObject({ name: "a", branch: "main", link: null, diagrams: [] });
    expect(Date.parse(recent[1].lastCommitAt!)).toBe(Date.parse("2024-05-01T10:00:00+03:00"));
    expect(recent[0]).toMatchObject({ branch: null, lastCommitAt: null });
    expect(Date.parse(recent[0].usedAt!)).toBeGreaterThan(Date.parse(recent[1].usedAt!));
    s.use(a);
    expect((await s.recent()).map((e) => e.path)).toEqual([a, b]);
    const text = readFileSync(file, "utf8");
    rmSync(b, { recursive: true, force: true });
    recent = await s.recent();
    expect(recent.map((e) => e.path)).toEqual([a]);
    expect(readFileSync(file, "utf8"), "a GET changes nothing on disk").toBe(text);
    s.use(a);
    expect(readFileSync(file, "utf8")).not.toContain(basename(b) + '"');
  });

  it("joins the repositories of registered drawings, at most twenty", async () => {
    const { s, lib } = setup();
    const roots = Array.from({ length: 22 }, (_, i) => real(repo(join(tempDir(), `r${i}`), null)));
    lib.items = roots.map((r, i) => drawing(`d_${i}`, r, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString())).reverse();
    const recent = await s.recent();
    expect(recent).toHaveLength(20);
    expect(recent.map((e) => e.path)).toEqual(roots.slice(2).reverse());
    expect(recent[0].diagrams).toEqual(["d_21"]);
  });

  it("forgets an entry with the contract's checks in their order", async () => {
    const { s, lib, file } = setup();
    const a = real(repo(join(tempDir(), "a"), null)), b = real(repo(join(tempDir(), "b"), null));
    s.use(a); s.use(b);
    lib.items = [drawing("d_a", a, "2020-01-01T00:00:00.000Z")];
    const before = readFileSync(file, "utf8");
    expect(await s.forget({})).toEqual({ status: 400, body: { error: "Give the path of a recent folder" } });
    expect(await s.forget({ path: 3 })).toEqual({ status: 400, body: { error: "Give the path of a recent folder" } });
    expect(await s.forget({ path: join(b, "x"), deleteCopy: "yes" })).toEqual({ status: 400, body: { error: "deleteCopy must be true or false" } });
    expect(await s.forget({ path: join(b, "x") })).toEqual({ status: 404, body: { error: "Not in the recent list" } });
    expect(await s.forget({ path: "relative" })).toEqual({ status: 404, body: { error: "Not in the recent list" } });
    expect(await s.forget({ path: a, deleteCopy: true })).toEqual({ status: 409, body: { error: "Remove its drawings from the list first" } });
    expect(await s.forget({ path: b, deleteCopy: true })).toEqual({ status: 400, body: { error: "Only a copy made from a link can be deleted" } });
    expect(readFileSync(file, "utf8"), "a refusal changes nothing").toBe(before);
    // The path is compared as the disk compares it (without case on Windows and macOS).
    expect(await s.forget({ path: process.platform === "linux" ? b : b.toUpperCase() })).toEqual({ status: 200, body: { ok: true, deleted: false } });
    expect(existsSync(b), "the folder stays").toBe(true);
    expect((await s.recent()).map((e) => e.path)).toEqual([a]);
  });

  it("deletes a copy only when nothing else is in it and nothing runs on it", async () => {
    const data = tempDir("archdraw-data-");
    const lib = library();
    let busy = true;
    const s = new Sources({ dataDir: data, library: lib, searchHome: real(tempDir("archdraw-home-")), copyInUse: () => busy });
    const copy = real(repo(join(data, "repos", "github.com", "acme", "shop"), "2024-01-01T12:00:00Z"));
    mkdirSync(join(copy, "sub"));
    writeFileSync(join(copy, "sub", "ro.txt"), "x", { mode: 0o444 });
    s.use(copy); s.use(join(copy, "sub"));
    const entry = (await s.recent()).find((e) => e.path === copy)!;
    expect(entry).toMatchObject({ link: "github.com/acme/shop", branch: "main" });
    // The entry is a folder in the copy; another drawing lies elsewhere in the same copy.
    const sub = join(copy, "sub");
    lib.items = [drawing("d_other", join(copy, "other"), "2020-01-01T00:00:00.000Z")];
    expect(await s.forget({ path: sub, deleteCopy: true })).toEqual({ status: 409, body: { error: "Other drawings in the list are in this copy" } });
    lib.items = [];
    expect(await s.forget({ path: sub, deleteCopy: true })).toEqual({ status: 409, body: { error: "This repository is in use: try again when its scans and instructions have ended" } });
    busy = false;
    expect(await s.forget({ path: sub, deleteCopy: true })).toEqual({ status: 200, body: { ok: true, deleted: true } });
    expect(existsSync(copy)).toBe(false);
    expect(await s.recent(), "every entry in the copy left the list").toEqual([]);
  });
});

describe("a copy's link", () => {
  it("is read from a path under the data folder's repos, lower-cased", () => {
    const data = join(tempDir(), "Data");
    expect(copyOf(data, join(data, "repos", "GitHub.com", "Acme", "Shop", "src"))).toEqual({ link: "github.com/acme/shop", dir: join(data, "repos", "github.com", "acme", "shop") });
    expect(copyOf(data, join(data, "repos", "github.com", "acme"))).toBeNull();
    expect(copyOf(data, join(data, "repos", ".partial", "1-x", "y"))).toBeNull();
    expect(copyOf(data, join(data, "elsewhere", "github.com", "a", "b"))).toBeNull();
  });
});
