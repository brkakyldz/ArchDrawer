import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, win32 } from "node:path";

/**
 * The system's folder dialog (api contract, *The folder dialog*; ADR 0017): the modern Explorer
 * picker on Windows, Finder's `choose folder` on macOS, `zenity` or `kdialog` on Linux. Each
 * helper runs a fixed script as an argument array, never through a shell, with nothing from a
 * request in it (AGENTS.md invariant 1). Its output is read as UTF-8, it is asked to come to the
 * front, and its process tree is killed when the request goes away or the server stops.
 *
 * With `ARCHDRAW_TEST_PICKER` set no helper ever runs: the file it names answers instead
 * (testing contract, *The test folder dialog*; AGENTS.md invariant 7).
 */

export const DIALOG_TITLE = "Choose the folder of a project";

/** How long a dialog may stay open before it is closed and counts as cancelled. */
export const DIALOG_LIMIT_MS = 10 * 60_000;
/** How long a test dialog whose second line is `slow` takes to answer. */
export const SLOW_TEST_MS = 3_000;

export type PickResult =
  | { status: "picked"; folder: string }
  | { status: "cancelled" }
  | { status: "unavailable" }
  /** Another dialog is open (409). */
  | { status: "busy" }
  /** The helper failed: `reason` is its first line of error, or its exit code. */
  | { status: "failed"; reason: string }
  /** The request went away or the server stopped before the dialog answered: no answer is sent. */
  | { status: "closed" };

/** A dialog helper: the program, its fixed arguments, and how it says the user cancelled. */
export interface Helper {
  file: string;
  args: string[];
  /** Exit codes that mean the dialog was closed without a folder. */
  cancelCodes: number[];
  /** Text in the helper's error output that means the same (osascript's -128). */
  cancelText?: RegExp;
}

// The Windows helper: the shell's own folder picker (`IFileOpenDialog` with FOS_PICKFOLDERS and
// FOS_FORCEFILESYSTEM), owned by an invisible topmost window so it opens above the browser. The
// chosen path goes to stdout as UTF-8; a cancelled dialog writes nothing.
const WINDOWS_TYPES = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class ArchdrawerFolderDialog {",
  "  [ComImport, Guid(\"DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7\")] private class FileOpenDialog {}",
  "  [ComImport, Guid(\"42f85136-db7e-439c-85f1-e4075d135fc8\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
  "  private interface IFileDialog {",
  "    [PreserveSig] int Show(IntPtr owner);",
  "    void SetFileTypes(uint count, IntPtr specs);",
  "    void SetFileTypeIndex(uint index);",
  "    void GetFileTypeIndex(out uint index);",
  "    void Advise(IntPtr sink, out uint cookie);",
  "    void Unadvise(uint cookie);",
  "    void SetOptions(uint options);",
  "    void GetOptions(out uint options);",
  "    void SetDefaultFolder(IntPtr item);",
  "    void SetFolder(IntPtr item);",
  "    void GetFolder(out IntPtr item);",
  "    void GetCurrentSelection(out IntPtr item);",
  "    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);",
  "    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);",
  "    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);",
  "    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);",
  "    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);",
  "    void GetResult(out IShellItem item);",
  "  }",
  "  [ComImport, Guid(\"43826D1E-E718-42EE-BC55-A1E261C37BFE\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
  "  private interface IShellItem {",
  "    void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid iid, out IntPtr result);",
  "    void GetParent(out IShellItem parent);",
  "    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);",
  "  }",
  "  public static string Pick(IntPtr owner, string title) {",
  "    IFileDialog dialog = (IFileDialog)new FileOpenDialog();",
  "    uint options; dialog.GetOptions(out options);",
  "    dialog.SetOptions(options | 0x20 | 0x40);",
  "    dialog.SetTitle(title);",
  "    int shown = dialog.Show(owner);",
  "    if (shown == unchecked((int)0x800704C7)) return null;",
  "    if (shown != 0) Marshal.ThrowExceptionForHR(shown);",
  "    IShellItem item; dialog.GetResult(out item);",
  "    string path; item.GetDisplayName(0x80058000, out path);",
  "    return path;",
  "  }",
  "}",
].join("\n");

/** The part of the Windows script that loads the dialog's types; a test compiles it without showing anything. */
export const WINDOWS_PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -TypeDefinition @'",
  WINDOWS_TYPES,
  "'@",
].join("\n");

const WINDOWS_SCRIPT = [
  "try {",
  WINDOWS_PRELUDE,
  "  $owner = New-Object System.Windows.Forms.Form",
  "  $owner.TopMost = $true",
  "  $owner.ShowInTaskbar = $false",
  "  $owner.FormBorderStyle = 'None'",
  "  $owner.Opacity = 0",
  "  $owner.StartPosition = 'CenterScreen'",
  "  $owner.Size = New-Object System.Drawing.Size 1, 1",
  // The first window a hidden-console process shows may take the hidden state it was started with;
  // the owner takes it, and is shown again so the dialog it owns is topmost and in front.
  "  $owner.Show(); $owner.Hide(); $owner.Show(); [void]$owner.Activate()",
  `  try { $path = [ArchdrawerFolderDialog]::Pick($owner.Handle, '${DIALOG_TITLE}') } finally { $owner.Close() }`,
  "  if ($path) { [Console]::Out.Write($path) }",
  "  exit 0",
  "} catch {",
  "  [Console]::Error.WriteLine($_.Exception.Message)",
  "  exit 2",
  "}",
].join("\n");

/** A PowerShell script as `-EncodedCommand` takes it: base64 of its UTF-16LE text. */
export const encodePowerShell = (script: string): string => Buffer.from(script, "utf16le").toString("base64");

/** Windows PowerShell by its absolute path (never looked up on PATH). */
export const windowsPowerShell = (env: NodeJS.ProcessEnv): string =>
  win32.join(env.SystemRoot?.trim() || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

/** The first executable called `name` in the PATH's folders, else null. */
export function onPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try {
      if (!statSync(p).isFile()) continue;
      accessSync(p, constants.X_OK);
      return p;
    } catch { /* not here */ }
  }
  return null;
}

export interface HelperSystem {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  find: (name: string) => string | null;
  home: string;
}

/** The dialog helper for this system, or null when no dialog is available (api contract, *The folder dialog*). */
export function dialogHelper(sys: HelperSystem): Helper | null {
  if (sys.platform === "win32") {
    const file = windowsPowerShell(sys.env);
    if (!sys.exists(file)) return null;
    return { file, args: ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodePowerShell(WINDOWS_SCRIPT)], cancelCodes: [] };
  }
  if (sys.platform === "darwin") {
    const file = "/usr/bin/osascript";
    if (!sys.exists(file)) return null;
    return {
      file,
      args: ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${DIALOG_TITLE}")`],
      cancelCodes: [],
      cancelText: /\(-128\)/,
    };
  }
  if (sys.platform === "linux") {
    if (!sys.env.DISPLAY && !sys.env.WAYLAND_DISPLAY) return null;
    const zenity = sys.find("zenity");
    if (zenity) return { file: zenity, args: ["--file-selection", "--directory", "--modal", `--title=${DIALOG_TITLE}`], cancelCodes: [1] };
    const kdialog = sys.find("kdialog");
    if (kdialog) return { file: kdialog, args: ["--getexistingdirectory", sys.home, "--title", DIALOG_TITLE], cancelCodes: [1] };
  }
  return null;
}

/** This machine's system, as `dialogHelper` reads it. */
export const thisSystem = (): HelperSystem => ({ platform: process.platform, env: process.env, exists: existsSync, find: (n) => onPath(n), home: homedir() });

/** The helper's stdout as the folder chosen: read as UTF-8, its BOM and line end dropped; "" is no folder. */
export function readAnswer(out: Buffer): string {
  return out.toString("utf8").replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");
}

/** The first line of a helper's error output worth showing (PowerShell's CLIXML header skipped). */
export function firstErrorLine(err: Buffer): string | null {
  for (const line of err.toString("utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#< CLIXML") && !t.startsWith("<Objs ")) return t;
  }
  return null;
}

/** Kill a helper and everything it started: `taskkill /T` on Windows, its process group elsewhere. */
export function killTree(child: ChildProcess, env: NodeJS.ProcessEnv = process.env): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const taskkill = win32.join(env.SystemRoot?.trim() || "C:\\Windows", "System32", "taskkill.exe");
    const k = spawn(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    k.on("error", () => { try { child.kill(); } catch { /* gone */ } });
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

export interface PickerOptions {
  /** `ARCHDRAW_TEST_PICKER`: the file the test dialog answers from; null for the real dialog. */
  testFile: string | null;
  /** The real dialog's helper; found from this machine when absent. */
  helper?: Helper | null;
  /** How long a dialog may stay open (default ten minutes). */
  limitMs?: number;
  /** How long a `slow` test dialog takes (default 3 s). */
  slowMs?: number;
}

/** One dialog at a time per server, living no longer than its request. */
export class FolderPicker {
  private open = false;
  /** Ends the open dialog: its helper's tree is killed, or its test wait stops. */
  private closeOpen: (() => void) | null = null;
  private helper: Helper | null | undefined;

  constructor(private readonly opts: PickerOptions) {
    this.helper = opts.helper;
  }

  /** Whether `pick` can open a dialog (`picker` in `GET /api/sources`): found once, or read from the test file at every request. */
  available(): boolean {
    if (this.opts.testFile !== null) return this.testLines().first !== "none";
    if (this.helper === undefined) this.helper = dialogHelper(thisSystem());
    return this.helper !== null;
  }

  /** Open the dialog and wait for it; `signal` is the request's, aborted when its connection closes. */
  async pick(signal?: AbortSignal): Promise<PickResult> {
    if (this.open) return { status: "busy" };
    if (!this.available()) return { status: "unavailable" };
    this.open = true;
    try {
      return this.opts.testFile !== null ? await this.testDialog(signal) : await this.realDialog(this.helper!, signal);
    } finally {
      this.open = false;
      this.closeOpen = null;
    }
  }

  /** Close the open dialog, if any (the server is stopping). */
  close(): void {
    this.closeOpen?.();
  }

  private testLines(): { first: string; slow: boolean } {
    let text = "";
    try { text = readFileSync(this.opts.testFile!, "utf8"); } catch { /* no file: cancelled */ }
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    return { first: (lines[0] ?? "").trim(), slow: (lines[1] ?? "").trim() === "slow" };
  }

  private async testDialog(signal?: AbortSignal): Promise<PickResult> {
    const { first, slow } = this.testLines();
    if (slow) {
      const waited = await new Promise<boolean>((done) => {
        const timer = setTimeout(() => finish(true), this.opts.slowMs ?? SLOW_TEST_MS);
        const finish = (ok: boolean) => { clearTimeout(timer); signal?.removeEventListener("abort", stop); done(ok); };
        const stop = () => finish(false);
        if (signal?.aborted) return finish(false);
        signal?.addEventListener("abort", stop, { once: true });
        this.closeOpen = stop;
      });
      if (!waited) return { status: "closed" };
    }
    if (first === "" || first === "cancel") return { status: "cancelled" };
    if (first === "none") return { status: "unavailable" };
    if (first === "fail") return { status: "failed", reason: "Test dialog failure" };
    return { status: "picked", folder: first };
  }

  private realDialog(helper: Helper, signal?: AbortSignal): Promise<PickResult> {
    return new Promise((done) => {
      if (signal?.aborted) return done({ status: "closed" });
      let child: ChildProcess;
      try {
        child = spawn(helper.file, helper.args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          // Its own process group elsewhere, so the whole tree can be killed at once.
          detached: process.platform !== "win32",
        });
      } catch (e) {
        return done({ status: "failed", reason: (e as Error).message });
      }
      const out: Buffer[] = [], err: Buffer[] = [];
      child.stdout!.on("data", (b: Buffer) => out.push(b));
      child.stderr!.on("data", (b: Buffer) => err.push(b));
      let ended: PickResult | null = null;
      const end = (r: PickResult) => {
        if (ended) return;
        ended = r;
        clearTimeout(limit);
        signal?.removeEventListener("abort", onAbort);
        done(r);
      };
      const stop = (r: PickResult) => { killTree(child); end(r); };
      const onAbort = () => stop({ status: "closed" });
      const limit = setTimeout(() => stop({ status: "cancelled" }), this.opts.limitMs ?? DIALOG_LIMIT_MS);
      limit.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.closeOpen = () => stop({ status: "closed" });
      child.on("error", (e) => end({ status: "failed", reason: e.message }));
      child.on("close", (code) => {
        const errors = Buffer.concat(err);
        if (code === 0) {
          const folder = readAnswer(Buffer.concat(out));
          return end(folder ? { status: "picked", folder } : { status: "cancelled" });
        }
        if ((code !== null && helper.cancelCodes.includes(code)) || helper.cancelText?.test(errors.toString("utf8"))) return end({ status: "cancelled" });
        end({ status: "failed", reason: firstErrorLine(errors) ?? `exit code ${code ?? "none"}` });
      });
    });
  }
}
