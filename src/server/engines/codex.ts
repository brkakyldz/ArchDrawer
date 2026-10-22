import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFT_JSON_SCHEMA } from "../../core/repair";
import { extractJson } from "./claude";
import { instructionPrompt } from "./prompt";
import { helpText, outputOf, resolveCommand, runProcess, versionOf, type Command } from "./process";
import { EngineError, type Engine, type EngineInfo, type EngineModel, type EngineRunRequest } from "./types";

/** Codex CLI in headless mode: `codex exec --json --output-schema`, read-only sandbox. */
export class CodexEngine implements Engine {
  readonly id = "codex";
  readonly label = "Codex";
  private cmd: Command | null = null;
  private ephemeral = false;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async detect(): Promise<EngineInfo> {
    const base = { id: this.id, label: this.label, test: false, models: [] as EngineModel[] };
    this.cmd = resolveCommand("codex", this.env);
    if (!this.cmd) return { ...base, available: false, version: null, detail: "Not installed — install the Codex CLI and log in (npm i -g @openai/codex)" };
    const version = versionOf(this.cmd);
    const help = helpText(this.cmd, ["exec", "--help"]);
    if (!help.includes("--output-schema")) {
      return { ...base, available: false, version, detail: "This Codex CLI is too old: it has no --output-schema. Update it (codex update)." };
    }
    this.ephemeral = help.includes("--ephemeral");
    return { ...base, models: codexModels(outputOf(this.cmd, ["debug", "models"])), available: true, version, detail: "Uses your ChatGPT/Codex subscription through the codex CLI, read-only sandbox" };
  }

  /**
   * With `image` (a revise) the image goes as `-i <abs path>`, one argument, right after `--json`: `-i`
   * takes several files, so it is followed by an option, never by the `-` that reads the prompt.
   */
  args(cwd: string, schemaFile: string, outFile: string, model: string | null, image?: string): string[] {
    const a = ["exec", "--json", ...(image ? ["-i", image] : []), "--sandbox", "read-only", "--skip-git-repo-check", "--output-schema", schemaFile, "-o", outFile, "-C", cwd];
    if (this.ephemeral) a.push("--ephemeral");
    if (model) a.push("-m", model);
    a.push("-");
    return a;
  }

  async run(req: EngineRunRequest): Promise<unknown> {
    if (!this.cmd) await this.detect();
    if (!this.cmd) throw new EngineError("Codex is not installed");
    const dir = mkdtempSync(join(tmpdir(), "archdraw-codex-"));
    try {
      const schemaFile = join(dir, "schema.json");
      const outFile = join(dir, "answer.json");
      // Both paths are absolute: codex resolves -o against -C.
      writeFileSync(schemaFile, JSON.stringify(withoutMaxLength(req.task?.schema ?? DRAFT_JSON_SCHEMA)));
      const prompt = req.task?.prompt ?? instructionPrompt(req);
      const parser = new CodexEventParser(req.progress);
      req.progress("Starting Codex");
      const image = req.task?.tools === "image" && req.image ? req.image.file : undefined;
      const r = await runProcess(this.cmd, this.args(req.cwd, schemaFile, outFile, req.model, image), {
        cwd: req.cwd, stdin: prompt, signal: req.signal, timeoutMs: req.timeoutMs, onLine: (l) => parser.line(l),
      });
      if (r.aborted) throw new EngineError("Cancelled");
      if (r.timedOut) throw new EngineError(`Codex did not finish within ${Math.round(req.timeoutMs / 60000)} minutes`);
      let text = "";
      try { text = readFileSync(outFile, "utf8"); } catch { /* handled below */ }
      if (parser.error && !text.trim()) throw new EngineError(`Codex failed: ${parser.error}`);
      const answer = text.trim() ? (() => { try { return JSON.parse(text); } catch { return extractJson(text); } })() : null;
      if (answer && typeof answer === "object") return answer;
      if (parser.error) throw new EngineError(`Codex failed: ${parser.error}`);
      const tail = r.stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
      throw new EngineError(`Codex finished without a structured answer (exit ${r.code})${tail ? `: ${tail}` : ""}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * The models the user's Codex offers: the visible entries of `codex debug models`, by priority
 * Anything unreadable gives an empty list, never an error.
 */
export function codexModels(json: string): EngineModel[] {
  let list: unknown;
  try { list = (JSON.parse(json) as { models?: unknown }).models; } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Record<string, unknown>).slug === "string" && (m as Record<string, unknown>).visibility !== "hide")
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
    .map((m) => ({ id: String(m.slug), label: typeof m.display_name === "string" && m.display_name ? m.display_name : String(m.slug) }));
}

/** Split a command line into words, keeping quoted text together. */
function words(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const READ = new Set(["get-content", "gc", "cat", "type", "head", "tail", "sed", "nl", "less", "more", "awk"]);
const SEARCH = new Set(["rg", "grep", "select-string", "sls", "findstr", "ag"]);
const LIST = new Set(["ls", "dir", "get-childitem", "gci", "find", "tree", "fd"]);
const SKIP = new Set(["get-location", "pwd", "cd", "set-location", "echo", "write-output"]);

/**
 * A progress line for a command Codex runs: "Reading src/app.ts", "Searching for “import”",
 * "Listing src" — not the raw shell wrapper (`"C:\…\powershell.exe" -Command 'Get-Content …'`).
 */
export function describeCommand(raw: string): string {
  let cmd = raw.trim().replace(/^"?[^"\s]*?(?:bash|pwsh|powershell|sh|cmd)(?:\.exe)?"?\s+(?:-NoProfile\s+)?(?:-lc|-c|-Command|\/c)\s+/i, "");
  if (/^(["']).*\1$/s.test(cmd)) cmd = cmd.slice(1, -1);
  const stages = cmd.split(/;|&&|\|\||\|/).map((x) => x.trim()).filter(Boolean);
  const stage = stages.find((x) => !SKIP.has((words(x)[0] ?? "").toLowerCase())) ?? stages[0] ?? "";
  const w = words(stage);
  const verb = (w[0] ?? "").toLowerCase();
  const args = w.slice(1).filter((x) => !x.startsWith("-"));
  const pathish = (x: string) => /[./\\]/.test(x) && !/^\d+(,\d+)?p?$/.test(x);
  const clip = (x: string) => (x.length > 70 ? `${x.slice(0, 69)}…` : x);
  const slash = (x: string) => x.replace(/\\+/g, "/");
  if (READ.has(verb)) {
    const file = [...args].reverse().find(pathish);
    return file ? `Reading ${clip(slash(file))}` : "Reading files";
  }
  if (SEARCH.has(verb) || (verb === "git" && w[1] === "grep")) {
    if (w.includes("--files")) return "Listing files";
    const pattern = (verb === "git" ? args.slice(1) : args)[0];
    return pattern ? `Searching for “${clip(pattern)}”` : "Searching the code";
  }
  if (LIST.has(verb)) {
    const dir = args.find(pathish);
    return dir ? `Listing ${clip(slash(dir))}` : "Listing files";
  }
  if (verb === "git") return `Running git ${w[1] ?? ""}`.trim();
  return verb ? `Running ${clip(w[0])}` : "Running a command";
}

/** Turns `codex exec --json` JSONL events into progress messages; remembers the last error. */
export class CodexEventParser {
  error: string | null = null;
  constructor(private readonly progress: (m: string) => void) {}

  line(raw: string): void {
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(raw); } catch { return; }
    const type = String(ev.type ?? "");
    if (type === "item.started" || type === "item.completed") {
      const item = (ev.item ?? {}) as Record<string, unknown>;
      if (item.type === "command_execution" && type === "item.started") {
        this.progress(describeCommand(String(item.command ?? "")));
      } else if (item.type === "reasoning" && type === "item.completed") {
        const t = String(item.text ?? "").replace(/\*\*/g, "").trim().split(/\r?\n/)[0];
        if (t) this.progress(t.slice(0, 90));
      }
    } else if (type === "turn.failed") {
      const err = ev.error as { message?: string } | undefined;
      this.error = err?.message ?? "turn failed";
    } else if (type === "error") {
      this.error = String(ev.message ?? "error");
    } else if (type === "turn.started") {
      this.progress("Exploring the repository");
    }
  }
}

/**
 * The schema as Codex gets it: without `maxLength`. Codex accepts it but holds it by cutting the text
 * at the limit mid-sentence, with no ellipsis and no warning, and the cut answer would pass every check
 * (ADR 0009, the Codex spike). The prompt states every limit; an over-long text gets the repair turn.
 */
export function withoutMaxLength(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutMaxLength);
  if (typeof schema !== "object" || schema === null) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "maxLength").map(([k, v]) => [k, withoutMaxLength(v)]));
}
