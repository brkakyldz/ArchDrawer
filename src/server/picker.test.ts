import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { loadConfig, startupLine } from "./config";
import { RunManager } from "./runs";
import { ScanManager } from "./scans";
import { Store } from "./store";
import { FixtureEngine } from "./engines/fixture";
import {
  DIALOG_TITLE, FolderPicker, WINDOWS_PRELUDE, dialogHelper, encodePowerShell, readAnswer, windowsPowerShell,
  type Helper, type HelperSystem,
} from "./picker";
import { BASE, PORT, TOKEN, makeFolder, tempDir } from "./testkit";

// The folder dialog (api contract, The folder dialog; testing contract, The test folder dialog):
// each system's helper as a fixed argument array, the test dialog's answers, one dialog at a time,
// output read as UTF-8, and a helper's process tree killed when its request goes away.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ok: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (ok()) return true;
  return ok();
};

/** A helper that runs a small Node script: what a real helper does is played by `code`. */
const nodeHelper = (code: string, extra: Partial<Helper> = {}): Helper => ({ file: process.execPath, args: ["-e", code], cancelCodes: [], ...extra });

describe("each system's dialog helper", () => {
  const sys = (over: Partial<HelperSystem>): HelperSystem => ({
    platform: "linux", env: {}, exists: () => true, find: () => null, home: "/home/me", ...over,
  });

  it("is Windows PowerShell by its absolute path with a fixed encoded script showing the Explorer folder picker", () => {
    const h = dialogHelper(sys({ platform: "win32", env: { SystemRoot: "D:\\Win" } }))!;
    expect(h.file).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(h.args.slice(0, 4)).toEqual(["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"]);
    expect(h.args).toHaveLength(5);
    const script = Buffer.from(h.args[4], "base64").toString("utf16le");
    // IFileDialog with FOS_PICKFOLDERS (0x20) and FOS_FORCEFILESYSTEM (0x40), owned by a topmost window.
    expect(script).toContain("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7");
    expect(script).toContain("options | 0x20 | 0x40");
    expect(script).toContain("$owner.TopMost = $true");
    expect(script).toContain(`'${DIALOG_TITLE}'`);
    expect(script).toContain("UTF8Encoding");
    // Without SystemRoot, C:\Windows; a missing powershell.exe is no dialog.
    expect(dialogHelper(sys({ platform: "win32" }))!.file).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(dialogHelper(sys({ platform: "win32", exists: () => false }))).toBeNull();
  });

  it("is osascript on macOS, activated, cancelled on -128", () => {
    const h = dialogHelper(sys({ platform: "darwin" }))!;
    expect(h.file).toBe("/usr/bin/osascript");
    expect(h.args).toEqual(["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${DIALOG_TITLE}")`]);
    expect(h.cancelText!.test("execution error: User canceled. (-128)")).toBe(true);
    expect(dialogHelper(sys({ platform: "darwin", exists: () => false }))).toBeNull();
  });

  it("is zenity, else kdialog, on Linux with a display; exit 1 is cancelled", () => {
    const both = (n: string) => `/usr/bin/${n}`;
    const z = dialogHelper(sys({ env: { DISPLAY: ":0" }, find: both }))!;
    expect(z).toEqual({ file: "/usr/bin/zenity", args: ["--file-selection", "--directory", "--modal", `--title=${DIALOG_TITLE}`], cancelCodes: [1] });
    const k = dialogHelper(sys({ env: { WAYLAND_DISPLAY: "wayland-0" }, find: (n) => (n === "kdialog" ? both(n) : null) }))!;
    expect(k).toEqual({ file: "/usr/bin/kdialog", args: ["--getexistingdirectory", "/home/me", "--title", DIALOG_TITLE], cancelCodes: [1] });
    expect(dialogHelper(sys({ find: both })), "no display").toBeNull();
    expect(dialogHelper(sys({ env: { DISPLAY: ":0" } })), "neither on PATH").toBeNull();
    expect(dialogHelper(sys({ platform: "freebsd", env: { DISPLAY: ":0" }, find: both }))).toBeNull();
  });

  it("reads the answer as UTF-8 with its line end and a BOM dropped", () => {
    expect(readAnswer(Buffer.from("\uFEFFC:\\Users\\me\\Masaüstü\\shop\r\n", "utf8"))).toBe("C:\\Users\\me\\Masaüstü\\shop");
    expect(readAnswer(Buffer.from("\n"))).toBe("");
  });

  it.runIf(process.platform === "win32" && existsSync(windowsPowerShell(process.env)))("compiles the Windows dialog's types and writes letters outside ASCII as UTF-8", () => {
    const script = `try {\n${WINDOWS_PRELUDE}\n[Console]::Out.Write([ArchdrawerFolderDialog].Name + ' C:\\Users\\me\\Masaüstü'); exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }`;
    const r = spawnSync(windowsPowerShell(process.env), ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodePowerShell(script)], { windowsHide: true, timeout: 60_000 });
    expect(r.stderr.toString("utf8")).toBe("");
    expect(readAnswer(r.stdout)).toBe("ArchdrawerFolderDialog C:\\Users\\me\\Masaüstü");
  }, 60_000);
});

describe("a helper's answer", () => {
  it("is the folder it printed, letters outside ASCII unchanged", async () => {
    const p = new FolderPicker({ testFile: null, helper: nodeHelper("process.stdout.write(Buffer.from('C:\\\\Users\\\\me\\\\Masaüstü\\\\shop\\n', 'utf8'))") });
    expect(await p.pick()).toEqual({ status: "picked", folder: "C:\\Users\\me\\Masaüstü\\shop" });
  });

  it("is cancelled on an empty answer, a cancel code or the cancel text; a failure names its first error line or its exit code", async () => {
    expect(await new FolderPicker({ testFile: null, helper: nodeHelper("") }).pick()).toEqual({ status: "cancelled" });
    expect(await new FolderPicker({ testFile: null, helper: nodeHelper("process.exit(1)", { cancelCodes: [1] }) }).pick()).toEqual({ status: "cancelled" });
    expect(await new FolderPicker({ testFile: null, helper: nodeHelper("console.error('User canceled. (-128)'); process.exit(1)", { cancelText: /\(-128\)/ }) }).pick()).toEqual({ status: "cancelled" });
    expect(await new FolderPicker({ testFile: null, helper: nodeHelper("console.error('\\nno display here\\nmore'); process.exit(3)") }).pick()).toEqual({ status: "failed", reason: "no display here" });
    expect(await new FolderPicker({ testFile: null, helper: nodeHelper("process.exit(3)") }).pick()).toEqual({ status: "failed", reason: "exit code 3" });
    expect(await new FolderPicker({ testFile: null, helper: { file: join(tempDir(), "missing-helper"), args: [], cancelCodes: [] } }).pick()).toMatchObject({ status: "failed" });
  });

  it("is unavailable when the system has no dialog", async () => {
    const p = new FolderPicker({ testFile: null, helper: null });
    expect(p.available()).toBe(false);
    expect(await p.pick()).toEqual({ status: "unavailable" });
  });
});

describe("an open dialog", () => {
  /** A helper that starts a child of its own, writes both process ids to `pids`, then waits as an open dialog does. */
  const treeHelper = (pids: string) => nodeHelper(
    `const { spawn } = require("node:child_process"); const fs = require("node:fs");
     const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
     fs.writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, c.pid]));
     setInterval(() => {}, 1000);`);
  const pidsOf = async (file: string) => {
    await until(() => existsSync(file) && readFileSync(file, "utf8").length > 0);
    return JSON.parse(readFileSync(file, "utf8")) as number[];
  };

  it("is closed, its whole process tree killed, when its request goes away; the next pick opens at once", async () => {
    const pids = join(tempDir(), "pids.json");
    const p = new FolderPicker({ testFile: null, helper: treeHelper(pids) });
    const request = new AbortController();
    const first = p.pick(request.signal);
    const [helper, child] = await pidsOf(pids);
    expect(alive(helper) && alive(child)).toBe(true);
    expect(await p.pick(), "one dialog at a time").toEqual({ status: "busy" });
    request.abort();
    expect(await first).toEqual({ status: "closed" });
    expect(await until(() => !alive(helper) && !alive(child)), "the helper and what it started are gone").toBe(true);
    // Free again: a quick helper answers.
    const next = new FolderPicker({ testFile: null, helper: nodeHelper("") });
    expect(await next.pick()).toEqual({ status: "cancelled" });
    writeFileSync(pids, "");
    const again = p.pick();
    expect(await pidsOf(pids)).toHaveLength(2);
    p.close();
    expect(await again).toEqual({ status: "closed" });
  }, 30_000);

  it("is closed with the server, and counts as cancelled after its time limit", async () => {
    const pids = join(tempDir(), "pids.json");
    const p = new FolderPicker({ testFile: null, helper: treeHelper(pids), limitMs: 1_500 });
    const r = p.pick();
    const [helper, child] = await pidsOf(pids);
    expect(await r).toEqual({ status: "cancelled" });
    expect(await until(() => !alive(helper) && !alive(child))).toBe(true);
  }, 30_000);
});

describe("the test folder dialog", () => {
  const picker = () => {
    const file = join(tempDir(), "picker.txt");
    return { file, p: new FolderPicker({ testFile: file, slowMs: 300, helper: nodeHelper("process.exit(9)") }), write: (t: string) => writeFileSync(file, t, "utf8") };
  };

  it("answers from its file at every request, and never runs a helper", async () => {
    const { p, write } = picker();
    expect(p.available()).toBe(true);
    expect(await p.pick(), "no file").toEqual({ status: "cancelled" });
    write(""); expect(await p.pick()).toEqual({ status: "cancelled" });
    write("  cancel  \nignored"); expect(await p.pick()).toEqual({ status: "cancelled" });
    write("fail"); expect(await p.pick()).toEqual({ status: "failed", reason: "Test dialog failure" });
    write("none"); expect(p.available()).toBe(false); expect(await p.pick()).toEqual({ status: "unavailable" });
    write("C:\\Users\\me\\Masaüstü\\shop\r\n"); expect(p.available()).toBe(true);
    expect(await p.pick()).toEqual({ status: "picked", folder: "C:\\Users\\me\\Masaüstü\\shop" });
  });

  it("is open for a while with `slow`: a second pick is refused, and a request that went away frees it", async () => {
    const { p, write } = picker();
    write("/x\nslow");
    const t0 = Date.now(), first = p.pick();
    expect(await p.pick()).toEqual({ status: "busy" });
    expect(await first).toEqual({ status: "picked", folder: "/x" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    const gone = new AbortController();
    const second = p.pick(gone.signal);
    gone.abort();
    expect(await second).toEqual({ status: "closed" });
    write("/y");
    expect(await p.pick(), "at once, not busy").toEqual({ status: "picked", folder: "/y" });
  });
});

describe("the API of the dialog", () => {
  const app = (testFile: string | null, helper?: Helper | null) => {
    const dataDir = tempDir("archdraw-data-");
    const config = loadConfig({ PORT: String(PORT), ARCHDRAW_DATA_DIR: dataDir, ARCHDRAW_ENGINES: "fixture", ARCHDRAW_SEARCH_HOME: tempDir(), ...(testFile ? { ARCHDRAW_TEST_PICKER: testFile } : {}) });
    const store = new Store(dataDir);
    const picker = new FolderPicker({ testFile: config.testPicker, helper, slowMs: 1_000 });
    const a = createApp({
      config, store, runs: new RunManager(store, { timeoutMs: 60_000 }), scans: new ScanManager(dataDir, { timeoutMs: 60_000 }),
      engines: new Map([["fixture", new FixtureEngine(1)]]), token: TOKEN, picker,
    });
    return async (signal?: AbortSignal, token: string | null = TOKEN) => a.request(`${BASE}/api/folders/pick`, {
      method: "POST", signal, headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json", ...(token ? { "x-archdraw-token": token } : {}) }, body: "{}",
    });
  };

  it("answers a picked folder as the folder check does, letters outside ASCII unchanged, and refuses what the check refuses", async () => {
    const file = join(tempDir(), "picker.txt");
    const pick = app(file);
    const dir = makeFolder({ "Masaüstü/dükkan/.git/HEAD": "ref: refs/heads/main\n", "Masaüstü/dükkan/a.ts": "" });
    writeFileSync(file, join(dir, "Masaüstü", "dükkan") + "\n", "utf8");
    const r = await pick();
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: "picked", git: false, drawing: null, link: null, branch: null, copied: false });
    expect(String(body.folder)).toContain("Masaüstü");
    expect(String(body.folder).endsWith("dükkan")).toBe(true);
    writeFileSync(file, "relative/folder", "utf8");
    expect(await (await pick()).json()).toEqual({ error: "The path must be absolute" });
    writeFileSync(file, "fail", "utf8");
    const failed = await pick();
    expect([failed.status, await failed.json()]).toEqual([500, { error: "The folder dialog failed: Test dialog failure" }]);
    expect((await pick(undefined, null)).status, "the token, as for every POST").toBe(403);
  });

  it("refuses a second pick while one is open, and frees the dialog when the first request goes away", async () => {
    const file = join(tempDir(), "picker.txt");
    writeFileSync(file, `${tempDir()}\nslow`, "utf8");
    const pick = app(file);
    const gone = new AbortController();
    const first = Promise.resolve(pick(gone.signal)).catch(() => null);
    await sleep(100);
    const second = await pick();
    expect([second.status, await second.json()]).toEqual([409, { error: "The folder dialog is already open" }]);
    gone.abort();
    await first;
    writeFileSync(file, "cancel", "utf8");
    expect(await (await pick()).json()).toEqual({ status: "cancelled" });
  });
});

describe("the start-up line", () => {
  it("names the test folder dialog only when its switch is on", () => {
    const base = { ARCHDRAW_DATA_DIR: "/data", ARCHDRAW_ENGINES: "fixture" };
    expect(startupLine(loadConfig({ ...base, ARCHDRAW_TEST_PICKER: "/tmp/picker.txt" }), ["fixture"])).toMatch(/^Data: .* · engines: fixture · test folder dialog$/);
    expect(startupLine(loadConfig(base), ["fixture"])).toMatch(/^Data: .* · engines: fixture$/);
    expect(startupLine(loadConfig({ ...base, ARCHDRAW_TEST_PICKER: "  " }), []), "an empty value is off").toMatch(/engines: none$/);
  });
});
