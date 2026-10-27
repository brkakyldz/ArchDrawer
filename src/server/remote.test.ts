import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { copyMarkers } from "./engines/fixture";
import { copyOfPath, gitFailure, linkOfPath, readLink, RemoteError, Remotes, type Link, type PrepareContext } from "./remote";
import { makeApp, shopFile, tempDir } from "./testkit";

// A repository from a link (api contract, *A repository from a link*; testing contract, *Test links*):
// the link is read before git runs, git gets only the rebuilt URL after `--`, a copy is made in
// `.partial` and renamed into place, and an update never replaces a drawing.

const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const win = process.platform === "win32";
const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...a], { cwd, stdio: "pipe", encoding: "utf8" }).trim();
const real = (p: string) => realpathSync.native(p);

/** `<remotes>/<link>`: a repository whose HEAD names `main`, with two commits. */
function makeRemote(remotes: string, link: string) {
  const dir = join(remotes, ...link.split("/"));
  mkdirSync(dir, { recursive: true });
  g(dir, "init", "-q"); g(dir, "symbolic-ref", "HEAD", "refs/heads/main");
  const commit = (files: Record<string, string>) => {
    for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
    g(dir, "add", "--all"); g(dir, "commit", "-q", "-m", "next");
    return g(dir, "rev-parse", "HEAD");
  };
  commit({ "README.md": "# Shop\n", "package.json": '{"main": "src/server.ts"}', "src/server.ts": "// server\n", "src/agent.ts": "// agent\n" });
  commit({ "zz.md": "second\n" });
  return { dir, commit, head: () => g(dir, "rev-parse", "HEAD") };
}

function setup(opts: { timeoutMs?: number } = {}) {
  const remotes = real(tempDir("archdraw-remotes-"));
  const t = makeApp({ remotes, ...opts });
  const calls: { args: string[]; cwd: string }[] = [];
  const run = t.remotes.run;
  t.remotes.run = (args, cwd, signal) => { calls.push({ args, cwd }); return run(args, cwd, signal); };
  const repos = join(t.dataDir, "repos");
  const listing = () => ({ copies: readdirSync(repos).filter((n) => n !== ".partial").sort(), partial: readdirSync(join(repos, ".partial")) });
  const scan = async (body: object) => {
    const r = await json(await t.req("/api/scans", { method: "POST", json: { engine: "fixture", ...body } }));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    return (await t.scans.wait(r.body.scanId))!;
  };
  return { ...t, remotesDir: remotes, calls, listing, scan, copy: (link: string) => join(real(repos), ...link.split("/")) };
}

const ctx = (over: Partial<PrepareContext> = {}): PrepareContext & { lines: string[] } => {
  const lines: string[] = [];
  return { signal: new AbortController().signal, progress: (m) => lines.push(m), inUse: () => false, drawings: () => [], lines, ...over };
};

describe("reading a link", () => {
  it("reads every way of writing a link to the same link, branch and rebuilt URL", () => {
    for (const written of ["https://github.com/Acme/Shop", "www.github.com/acme/shop.git/", "https://github.com/acme/shop?tab=readme#top", "  https://GitHub.com/acme/shop  "]) {
      expect(readLink(written)).toEqual({ link: "github.com/acme/shop", host: "github.com", owner: "acme", repo: "shop", branch: null, url: "https://github.com/acme/shop.git" });
    }
    expect(readLink("https://github.com/acme/shop/tree/feature/pay")).toMatchObject({ link: "github.com/acme/shop", branch: "feature/pay" });
    expect(readLink("https://gitlab.com/Acme/Shop/-/tree/dev")).toMatchObject({ link: "gitlab.com/acme/shop", branch: "dev", url: "https://gitlab.com/acme/shop.git" });
    expect(readLink("https://bitbucket.org/acme/shop/src/dev")).toMatchObject({ link: "bitbucket.org/acme/shop", branch: "dev" });
    expect(readLink("https://github.com/acme/shop/tree/main/src")).toMatchObject({ branch: "main/src" });
  });

  it("refuses, with the contract's sentence in its order, every link that is not one", () => {
    const cases: [unknown, string][] = [
      ["  ", "Give the link of a repository"], [42, "Give the link of a repository"], [null, "Give the link of a repository"],
      ["http://github.com/a/b", "Not a repository link"], ["ssh://git@github.com/a/b", "Not a repository link"], ["file:///etc/passwd", "Not a repository link"],
      ['ext::sh -c "touch x"', "Not a repository link"], ["git@github.com:a/b.git", "Not a repository link"], ["https://github.com:8443/a/b", "Not a repository link"],
      [`https://github.com/a/${"x".repeat(300)}`, "Not a repository link"],
      ["https://user@github.com/a/b", "Leave the user name and password out of the link"], ["https://:secret@github.com/a/b", "Leave the user name and password out of the link"],
      ["https://user@example.com/a/b", "Leave the user name and password out of the link"],
      ["https://example.com/a/b", "Only github.com, gitlab.com and bitbucket.org links can be drawn"], ["https://github.com.evil.com/a/b", "Only github.com, gitlab.com and bitbucket.org links can be drawn"],
      ["--upload-pack=touch x", "Only github.com, gitlab.com and bitbucket.org links can be drawn"], ["-x", "Only github.com, gitlab.com and bitbucket.org links can be drawn"],
      ["https://github.com/acme/shop;touch x", "Not a repository link"], ["https://github.com/acme/shop$(id)", "Not a repository link"], ["https://github.com/acme/shop`id`", "Not a repository link"],
      ["https://github.com/acme/sh op", "Not a repository link"], ["https://github.com/acme/shop%0Aid", "Not a repository link"], ["https://github.com/acme/shop\\..\\x", "Not a repository link"],
      ["https://github.com/-x/y", "Not a repository link"], ["https://github.com/acme/-y", "Not a repository link"], ["https://github.com/.h/y", "Not a repository link"], ["https://github.com/acme/y.", "Not a repository link"],
      ["https://github.com/acme/con", "Not a repository link"], ["https://github.com/acme/LPT9.txt", "Not a repository link"], ["https://github.com/acme/nul.git", "Not a repository link"],
      ["https://github.com/acme", "Not a repository link"], ["https://github.com/acme/shop/issues/3", "Not a repository link"], ["https://gitlab.com/g/sub/repo", "Not a repository link"],
      ["https://github.com/acme/shop/tree", "Not a repository link"], ["https://gitlab.com/acme/shop/tree/main", "Not a repository link"],
      ["https://github.com/acme/shop/tree/-x", "Not a repository link"], ["https://github.com/acme/shop/tree/--upload-pack=x", "Not a repository link"],
      ["https://github.com/acme/shop/tree/a..b", "Not a repository link"], ["https://github.com/acme/shop/tree/a//b", "Not a repository link"],
      ["https://github.com/acme/shop/tree/x.lock", "Not a repository link"], ["https://github.com/acme/shop/tree/.x", "Not a repository link"],
      [`https://github.com/acme/shop/tree/${"b".repeat(201)}`, "Not a repository link"],
    ];
    for (const [raw, error] of cases) expect(readLink(raw), String(raw)).toEqual({ error });
  });

  it("refuses a link through the API before git runs, and copies nothing", async () => {
    const t = setup();
    makeRemote(t.remotesDir, "github.com/acme/shop");
    for (const link of ["https://github.com/acme/shop;touch x", "--upload-pack=touch x", "-c core.sshCommand=x", "https://user@github.com/acme/shop", "ext::sh -c id", "https://example.com/a/b", "https://github.com/acme/con"]) {
      for (const path of ["/api/folders/check", "/api/scans"]) {
        const r = await json(await t.req(path, { method: "POST", json: { link, engine: "fixture" } }));
        expect(r.status, `${path} ${link}`).toBe(400);
      }
    }
    expect(await json(await t.req("/api/folders/check", { method: "POST", json: { folder: t.remotesDir, link: "https://github.com/acme/shop" } })))
      .toEqual({ status: 400, body: { error: "Give a folder or a link, not both" } });
    expect(t.calls, "git never ran").toEqual([]);
    expect(t.listing()).toEqual({ copies: [], partial: [] });
  });
});

describe("git for a link", () => {
  it("builds the four calls exactly, with the rebuilt URL after -- and the branch after --branch or -B", () => {
    const r = new Remotes(tempDir());
    const l = readLink("https://GitHub.com/Acme/Shop/tree/feature/pay?x#y") as Link;
    const safe = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-optional-locks", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
      "-c", "core.symlinks=false", "-c", "core.askPass=", ...(win ? ["-c", "core.longpaths=true"] : [])];
    const url = "https://github.com/acme/shop.git";
    expect(r.args.clone(l, "feature/pay", "P")).toEqual([...safe, "clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet", "--branch", "feature/pay", "--", url, "P"]);
    expect(r.args.clone(l, null, "P")).toEqual([...safe, "clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet", "--", url, "P"]);
    expect(r.args.defaultBranch(l)).toEqual([...safe, "ls-remote", "--symref", "--", url, "HEAD"]);
    expect(r.args.fetch(l, "feature/pay")).toEqual([...safe, "fetch", "--depth", "1", "--no-tags", "--quiet", "--", url, "refs/heads/feature/pay"]);
    expect(r.args.checkout("feature/pay")).toEqual([...safe, "checkout", "--quiet", "-B", "feature/pay", "FETCH_HEAD"]);
    // A test link: the file transport instead of https, the URL into the test folder.
    const test = new Remotes(tempDir(), "/remotes");
    expect(test.args.clone(l, null, "P")).toContain("protocol.file.allow=always");
    expect(test.args.clone(l, null, "P")).not.toContain("protocol.https.allow=always");
    expect(test.urlOf(l)).toBe(pathToFileURL(join("/remotes", "github.com", "acme", "shop")).href);
  });

  it("runs git with no prompt, no askpass and none of the server's redirecting GIT_* variables", () => {
    const saved = { ...process.env };
    Object.assign(process.env, { GIT_DIR: "/elsewhere", GIT_WORK_TREE: "/w", GIT_CONFIG_PARAMETERS: "'core.fsmonitor=x'", GIT_ASKPASS: "/askpass", SSH_ASKPASS: "/ssh", GIT_ALLOW_PROTOCOL: "ext:file" });
    try {
      const env = Remotes.env();
      for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_PARAMETERS", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_ALLOW_PROTOCOL"]) expect(env[k], k).toBeUndefined();
      expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_LFS_SKIP_SMUDGE: "1", LC_ALL: "C" });
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });

  it("reads git's error output into the contract's sentences", () => {
    const l = readLink("https://github.com/acme/shop") as Link;
    expect(gitFailure("fatal: transport 'ssh' not allowed", l, null)).toBe("Your git settings send github.com links over another transport than https: archdrawer copies over https only");
    expect(gitFailure("fatal: Remote branch nope not found in upstream origin", l, "nope")).toBe('The branch "nope" does not exist in github.com/acme/shop');
    expect(gitFailure("fatal: couldn't find remote ref refs/heads/x", l, "x")).toBe('The branch "x" does not exist in github.com/acme/shop');
    expect(gitFailure("fatal: unable to access '…': Could not resolve host: github.com", l, null)).toBe("Could not reach github.com");
    expect(gitFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled", l, null)).toBe("This repository is private or does not exist");
    expect(gitFailure("remote: Repository not found.\nfatal: repository '…' not found", l, null)).toBe("This repository is private or does not exist");
    expect(gitFailure("error: something\nfatal: odd thing", l, null)).toBe("Could not copy github.com/acme/shop: fatal: odd thing");
  });

  it("asks the host for its default branch, and refuses one whose name breaks the branch rule", async () => {
    const data = tempDir();
    const r = new Remotes(data);
    const l = readLink("https://github.com/acme/shop") as Link;
    const copy = r.copyDir(l);
    mkdirSync(dirname(copy), { recursive: true });
    g(dirname(copy), "init", "-q", "shop"); g(copy, "symbolic-ref", "HEAD", "refs/heads/main");
    writeFileSync(join(copy, "a.txt"), "a\n"); g(copy, "add", "--all"); g(copy, "commit", "-q", "-m", "one");
    const seen: string[][] = [];
    let head = "ref: refs/heads/trunk\tHEAD\r\n0123456789012345678901234567890123456789\tHEAD\r\n";
    r.run = async (args) => { seen.push(args); return args.includes("ls-remote") ? { code: 0, stdout: head, stderr: "" } : { code: 1, stdout: "", stderr: "fatal: Could not resolve host: github.com" }; };
    const c = ctx();
    await expect(r.prepare(l, { branch: null }, c)).rejects.toThrow("Could not reach github.com");
    expect(c.lines).toEqual(["Fetching the newest commit of github.com/acme/shop", "Fetching trunk of github.com/acme/shop"]);
    expect(seen.at(-1)).toContain("refs/heads/trunk");
    head = "ref: refs/heads/-x\tHEAD\n";
    await expect(r.prepare(l, { branch: null }, ctx())).rejects.toThrow('Could not copy github.com/acme/shop: its default branch "-x" has a name archdrawer does not take');
  });

  it("fails a private repository at once, with no prompt, and leaves nothing", async () => {
    const data = tempDir();
    const r = new Remotes(data);
    const seen: string[][] = [];
    r.run = async (args) => { seen.push(args); return { code: 128, stdout: "", stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }; };
    const started = Date.now();
    await expect(r.prepare(readLink("https://github.com/acme/secret") as Link, { branch: null }, ctx())).rejects.toThrow(new RemoteError("This repository is private or does not exist"));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("core.askPass=");
    expect(readdirSync(join(data, "repos")).filter((n) => n !== ".partial")).toEqual([]);
    expect(readdirSync(join(data, "repos", ".partial"))).toEqual([]);
  });
});

describe("a copy", () => {
  it("is made by a scan of a link with one commit on a local branch, scanned like a folder, and named by its link", async () => {
    const t = setup();
    const shop = makeRemote(t.remotesDir, "github.com/acme/shop");
    const checked = await json(await t.req("/api/folders/check", { method: "POST", json: { link: "https://github.com/Acme/Shop" } }));
    expect(checked.body).toMatchObject({ git: false, drawing: null, link: "github.com/acme/shop", branch: null, copied: false, folder: t.copy("github.com/acme/shop") });
    expect(t.listing()).toEqual({ copies: [], partial: [] });

    const s = await t.scan({ link: "https://GitHub.com/Acme/Shop?tab=readme" });
    expect(s).toMatchObject({ status: "succeeded", link: "github.com/acme/shop", cached: false, commit: shop.head(), name: "shop" });
    expect(s.progress[0]).toBe("Copying github.com/acme/shop");
    expect(s.progress).toContain("Gathering the repository");
    const copy = t.copy("github.com/acme/shop");
    expect(g(copy, "rev-list", "--count", "HEAD")).toBe("1");
    expect(g(copy, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(t.listing()).toEqual({ copies: ["github.com"], partial: [] });
    // Every git call is one of the contract's, with the rebuilt URL after `--`, never the text typed.
    const url = pathToFileURL(join(t.remotesDir, "github.com", "acme", "shop")).href;
    for (const { args } of t.calls) {
      expect(args.slice(0, 5)).toEqual(["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-optional-locks"]);
      expect(args.join(" ")).not.toMatch(/Acme|Shop|tab=readme/);
      if (args.includes("--")) expect(args[args.indexOf("--") + 1]).toBe(url);
    }
    expect(t.calls.map((c) => c.args.find((a) => ["clone", "ls-remote", "fetch", "checkout"].includes(a)))).toEqual(["clone"]);

    // The copy chosen as a folder knows its link; a drawing registered in it is listed with the link.
    expect((await json(await t.req("/api/folders/check", { method: "POST", json: { folder: copy } }))).body).toMatchObject({ link: "github.com/acme/shop", branch: null, copied: true, git: true });
    mkdirSync(join(copy, "docs"));
    writeFileSync(join(copy, "docs", "architecture.archdraw.json"), JSON.stringify(shopFile()));
    const reg = await json(await t.req("/api/files", { method: "POST", json: { path: join(copy, "docs", "architecture.archdraw.json") } }));
    expect(reg.status).toBe(200);
    const listed = (await json(await t.req("/api/diagrams"))).body.diagrams;
    expect(listed.find((d: { id: string }) => d.id === reg.body.id).link).toBe("github.com/acme/shop");
    expect(linkOfPath(t.dataDir, join(copy, "docs"))).toBe("github.com/acme/shop");
    expect(copyOfPath(t.dataDir, t.remotesDir)).toBeNull();
  });

  it("is fetched by a later scan, and an update leaves a drawing byte for byte, or keeps the copy when it would replace one", async () => {
    const t = setup();
    const shop = makeRemote(t.remotesDir, "github.com/acme/shop");
    await t.scan({ link: "https://github.com/acme/shop" });
    const copy = t.copy("github.com/acme/shop");
    const drawing = join(copy, "docs", "architecture.archdraw.json");
    mkdirSync(dirname(drawing));
    writeFileSync(drawing, JSON.stringify(shopFile(), null, 2));
    expect((await t.req("/api/files", { method: "POST", json: { path: drawing } })).status).toBe(200);
    const bytes = readFileSync(drawing);

    const same = await t.scan({ link: "https://github.com/acme/shop" });
    expect(same.progress.slice(0, 3)).toEqual(["Fetching the newest commit of github.com/acme/shop", `Up to date at ${shop.head().slice(0, 7)}`, `Scanned before at ${shop.head().slice(0, 7)}`]);
    expect(same.cached).toBe(true);

    const next = shop.commit({ "src/new.ts": "// new\n" });
    const updated = await t.scan({ folder: copy });
    expect(updated.progress.slice(0, 2)).toEqual(["Fetching the newest commit of github.com/acme/shop", `Updated to ${next.slice(0, 7)}`]);
    expect(updated).toMatchObject({ commit: next, link: "github.com/acme/shop" });
    expect(readFileSync(drawing).equals(bytes), "the drawing is unchanged").toBe(true);

    // The remote now holds a file at the drawing's path: the copy is kept as it is.
    const clash = shop.commit({ "docs/architecture.archdraw.json": "{}\n" });
    const kept = await t.scan({ link: "https://github.com/acme/shop" });
    expect(kept.progress.slice(0, 2)).toEqual(["Fetching the newest commit of github.com/acme/shop", `Kept the copy at ${next.slice(0, 7)}: the newest commit would replace ${drawing}`]);
    expect(g(copy, "rev-parse", "HEAD")).toBe(next);
    expect(clash).not.toBe(next);
    expect(readFileSync(drawing).equals(bytes)).toBe(true);
  });

  it("switches to a branch a link names, and is not updated or switched while in use", async () => {
    const data = tempDir(), remotesDir = real(tempDir());
    const r = new Remotes(data, remotesDir);
    const shop = makeRemote(remotesDir, "github.com/acme/shop");
    const l = readLink("https://github.com/acme/shop") as Link;
    await r.prepare(l, { branch: null }, ctx());
    const copy = r.copyDir(l);
    const head = g(copy, "rev-parse", "HEAD");
    g(shop.dir, "checkout", "-q", "-b", "feature/pay"); const pay = shop.commit({ "pay.ts": "// pay\n" }); g(shop.dir, "checkout", "-q", "main");
    shop.commit({ "later.ts": "x\n" });

    const busy = ctx({ inUse: () => true });
    await r.prepare(l, { branch: null }, busy);
    expect(busy.lines).toEqual(["Fetching the newest commit of github.com/acme/shop", `This repository is in use: scanning the copy at ${head.slice(0, 7)} on main`]);
    expect(g(copy, "rev-parse", "HEAD")).toBe(head);
    await expect(r.prepare(l, { branch: "feature/pay" }, ctx({ inUse: () => true })))
      .rejects.toThrow('This repository is in use on the branch "main": try again when its drawings and instructions have ended');

    const sw = ctx();
    await r.prepare(l, { branch: "feature/pay" }, sw);
    expect(sw.lines).toEqual(["Fetching the newest commit of github.com/acme/shop", "Fetching feature/pay of github.com/acme/shop", `Switched to feature/pay at ${pay.slice(0, 7)}`]);
    expect(g(copy, "symbolic-ref", "--short", "HEAD")).toBe("feature/pay");
    await expect(r.prepare(l, { branch: "nope" }, ctx())).rejects.toThrow('The branch "nope" does not exist in github.com/acme/shop');
    expect(g(copy, "symbolic-ref", "--short", "HEAD")).toBe("feature/pay");
  });

  it("leaves nothing outside .partial when a clone fails, is cancelled or times out, and frees its lock", async () => {
    const t = setup({ timeoutMs: 1_500 });
    makeRemote(t.remotesDir, "github.com/acme/shop");
    makeRemote(t.remotesDir, "github.com/acme/slow"); writeFileSync(join(t.remotesDir, "github.com", "acme", "slow.slow"), "");
    mkdirSync(join(t.remotesDir, "github.com", "acme", "plain"));

    for (const [link, error] of [
      ["https://github.com/acme/shop/tree/nope", 'The branch "nope" does not exist in github.com/acme/shop'],
      ["https://github.com/acme/ghost", "This repository is private or does not exist"],
      ["https://github.com/acme/plain", "This repository is private or does not exist"],
      ["https://gitlab.com/acme/shop", "Could not reach gitlab.com"],
    ]) {
      const s = await t.scan({ link });
      expect([s.status, s.error, s.card], link).toEqual(["failed", error, null]);
      expect(t.listing(), link).toEqual({ copies: [], partial: [] });
    }

    // Cancelled while it waits to copy: at once, nothing left, the lock free again.
    const r = await json(await t.req("/api/scans", { method: "POST", json: { link: "https://github.com/acme/slow", engine: "fixture" } }));
    expect(r.status).toBe(202);
    const again = await json(await t.req("/api/scans", { method: "POST", json: { link: "https://github.com/acme/slow", engine: "fixture" } }));
    expect(again).toEqual({ status: 409, body: { error: "A scan of this repository is already running", scanId: r.body.scanId } });
    t.scans.cancel(r.body.scanId);
    expect((await t.scans.wait(r.body.scanId))!.status).toBe("cancelled");
    expect(t.listing()).toEqual({ copies: [], partial: [] });

    // Timed out while it waits: failed, nothing left.
    const timed = await t.scan({ link: "https://github.com/acme/slow" });
    expect(timed.status).toBe("failed");
    expect(timed.error).toMatch(/^Timed out/);
    expect(t.listing()).toEqual({ copies: [], partial: [] });
  });

  it("removes a dead server's partial copies at start-up and keeps a live one's", () => {
    const data = tempDir();
    const r = new Remotes(data);
    const partial = join(data, "repos", ".partial");
    mkdirSync(join(partial, "999999999-dead", "x"), { recursive: true });
    mkdirSync(join(partial, `${process.pid}-live`));
    expect(r.sweepPartial()).toEqual(["999999999-dead"]);
    expect(readdirSync(partial)).toEqual([`${process.pid}-live`]);
  });

  it("is deleted with its last drawing only when it is a copy and no other drawing is in it", async () => {
    const t = setup();
    makeRemote(t.remotesDir, "github.com/acme/shop");
    await t.scan({ link: "https://github.com/acme/shop" });
    const copy = t.copy("github.com/acme/shop");
    const reg = async (path: string) => {
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(shopFile()));
      return (await json(await t.req("/api/files", { method: "POST", json: { path } }))).body.id as string;
    };
    const d1 = await reg(join(copy, "docs", "architecture.archdraw.json"));
    const d2 = await reg(join(copy, "other.archdraw.json"));
    const local = await reg(join(tempDir(), "local.archdraw.json"));
    const imported = (await json(await t.req("/api/example", { method: "POST" }))).body.id;
    const del = async (id: string) => { const r = await t.req(`/api/diagrams/${id}?deleteCopy=true`, { method: "DELETE" }); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };

    expect(await del("d_nope")).toMatchObject({ status: 404 });
    expect(await del(local)).toEqual({ status: 400, body: { error: "This drawing is not in a copy made from a link" } });
    expect(await del(imported)).toEqual({ status: 400, body: { error: "This drawing is not in a copy made from a link" } });
    expect(await del(d1)).toEqual({ status: 409, body: { error: "Other drawings in the list are in this copy" } });
    expect(t.store.exists(d1) && existsSync(copy)).toBe(true);
    expect((await t.req(`/api/diagrams/${d2}?deleteCopy=yes`, { method: "DELETE" })).status, "another value is ignored").toBe(204);
    expect(existsSync(join(copy, "other.archdraw.json"))).toBe(true);

    expect(await del(d1)).toEqual({ status: 204, body: null });
    expect(existsSync(copy)).toBe(false);
    expect(t.store.exists(d1)).toBe(false);
    expect(t.listing()).toEqual({ copies: [], partial: [] });
    // A copy already gone counts as deleted.
    expect(t.remotes.deleteCopy("github.com/acme/shop")).toEqual({ ok: true });
  });
});

describe("fixture markers in a copy", () => {
  it("reads the dashed markers of a copy's repository name", () => {
    const at = (repo: string) => join("C:", "data", "repos", "github.com", "acme", repo);
    expect(copyMarkers(at("shop-fixture-fail"))).toEqual(["[fixture:fail]"]);
    expect(copyMarkers(at("shop-fixture-fail-overview"))).toEqual(["[fixture:fail:overview]"]);
    expect(copyMarkers(at("shop-fixture-slow-fixture-many"))).toEqual(["[fixture:slow]", "[fixture:many]"]);
    expect(copyMarkers(at("shop"))).toEqual([]);
    expect(copyMarkers(join("C:", "code", "shop-fixture-fail")), "outside a copy").toEqual([]);
  });
});
