import { relative } from "node:path";
import { DRAFT_JSON_SCHEMA } from "../../core/repair";
import { instructionPrompt } from "./prompt";
import { helpText, resolveCommand, runProcess, versionOf, type Command } from "./process";
import { EngineError, type Engine, type EngineInfo, type EngineModel, type EngineRunRequest } from "./types";

const READ_TOOLS = "Read,Grep,Glob";

interface Caps { safeMode: boolean; restricted: boolean; settingSources: boolean; strictMcp: boolean; noPersist: boolean }

/** Claude Code in headless mode: `claude -p`, stream-json events, `--json-schema` answer. */
export class ClaudeEngine implements Engine {
  readonly id = "claude";
  readonly label = "Claude Code";
  private cmd: Command | null = null;
  private caps: Caps | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async detect(): Promise<EngineInfo> {
    const base = { id: this.id, label: this.label, test: false, models: [] as EngineModel[] };
    this.cmd = resolveCommand("claude", this.env);
    if (!this.cmd) return { ...base, available: false, version: null, detail: "Not installed — install Claude Code and log in (claude.com/claude-code)" };
    const version = versionOf(this.cmd);
    const help = helpText(this.cmd, ["-p", "--help"]);
    if (!help.includes("--json-schema")) {
      return { ...base, available: false, version, detail: "This Claude Code is too old: it has no --json-schema. Update it (claude update)." };
    }
    this.caps = {
      safeMode: help.includes("--safe-mode"),
      restricted: help.includes("--restricted"),
      settingSources: help.includes("--setting-sources"),
      strictMcp: help.includes("--strict-mcp-config"),
      noPersist: help.includes("--no-session-persistence"),
    };
    // Fail closed: the repository being drawn is untrusted. Without a way to skip its own settings
    // (hooks run shell commands) and its MCP servers, drawing it could execute its code.
    const skipsSettings = this.caps.safeMode || this.caps.restricted || this.caps.settingSources;
    const skipsMcp = this.caps.safeMode || this.caps.strictMcp;
    if (!skipsSettings || !skipsMcp) {
      return { ...base, available: false, version, detail: "This Claude Code cannot skip a repository's own hooks and MCP servers. Update it (claude update)." };
    }
    return { ...base, models: claudeModels(help), available: true, version, detail: "Uses your Claude subscription through the claude CLI, read-only" };
  }

  args(model: string | null, schema: object = DRAFT_JSON_SCHEMA): string[] {
    const caps = this.caps ?? { safeMode: false, restricted: false, settingSources: false, strictMcp: false, noPersist: false };
    const a = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--json-schema", JSON.stringify(schema),
      "--tools", READ_TOOLS,
      "--allowedTools", READ_TOOLS,
      "--permission-mode", "dontAsk",
    ];
    if (caps.noPersist) a.push("--no-session-persistence");
    if (caps.strictMcp) a.push("--strict-mcp-config");
    if (caps.safeMode) a.push("--safe-mode");
    if (caps.restricted) a.push("--restricted");
    // Only the user's own settings: never the drawn repository's project or local settings.
    if (!caps.safeMode && !caps.restricted && caps.settingSources) a.push("--setting-sources", "user");
    if (model) a.push("--model", model);
    return a;
  }

  async run(req: EngineRunRequest): Promise<unknown> {
    if (!this.cmd) await this.detect();
    if (!this.cmd) throw new EngineError("Claude Code is not installed");
    const prompt = req.task?.prompt ?? instructionPrompt(req);
    const parser = new ClaudeStreamParser(req.cwd, req.progress, req.task ? "Writing the post" : "Writing the diagram");
    req.progress("Starting Claude Code");
    const r = await runProcess(this.cmd, this.args(req.model, req.task?.schema), {
      cwd: req.cwd, stdin: prompt, signal: req.signal, timeoutMs: req.timeoutMs, onLine: (l) => parser.line(l),
    });
    if (r.aborted) throw new EngineError("Cancelled");
    if (r.timedOut) throw new EngineError(`Claude Code did not finish within ${Math.round(req.timeoutMs / 60000)} minutes`);
    return parser.finish(r.code, r.stderr);
  }
}

/**
 * The models Claude Code offers: it has no list command, so these are the aliases its
 * `claude -p --help` names for `--model`. Default sends no flag.
 */
export function claudeModels(help: string): EngineModel[] {
  const m = /--model <model>([\s\S]*?)(?=\n\s{2}-|$)/.exec(help);
  const ids = [...new Set([...(m?.[1] ?? "").matchAll(/'([a-z][a-z0-9.-]*)'/g)].map((x) => x[1]))];
  return ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
}

/** Turns `--output-format stream-json` lines into progress messages and the final structured answer. */
export class ClaudeStreamParser {
  private result: Record<string, unknown> | null = null;
  constructor(private readonly cwd: string, private readonly progress: (m: string) => void, private readonly writing = "Writing the diagram") {}

  line(raw: string): void {
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(raw); } catch { return; }
    if (ev.type === "assistant") {
      const content = ((ev.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
      for (const c of content) if (c.type === "tool_use") this.toolUse(String(c.name), (c.input ?? {}) as Record<string, unknown>);
    } else if (ev.type === "result") {
      this.result = ev;
    }
  }

  private rel(p: unknown): string {
    const s = String(p ?? "");
    const r = relative(this.cwd, s).replace(/\\/g, "/");
    return !r || r.startsWith("..") ? s : r;
  }

  private toolUse(name: string, input: Record<string, unknown>) {
    if (name === "Read") this.progress(`Reading ${this.rel(input.file_path)}`);
    else if (name === "Grep") this.progress(`Searching for “${String(input.pattern ?? "").slice(0, 60)}”`);
    else if (name === "Glob") this.progress(`Listing ${String(input.pattern ?? "")}`);
    else if (name === "StructuredOutput") this.progress(this.writing);
    else this.progress(`Using ${name}`);
  }

  finish(code: number | null, stderr: string): unknown {
    const r = this.result;
    if (!r) {
      const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
      throw new EngineError(`Claude Code exited (${code ?? "killed"}) without a result${tail ? `: ${tail}` : ""}`);
    }
    if (r.subtype !== "success" || r.is_error === true) {
      const msg = typeof r.result === "string" && r.result ? r.result : String(r.subtype ?? "error");
      throw new EngineError(`Claude Code failed: ${msg.slice(0, 400)}`);
    }
    if (r.structured_output && typeof r.structured_output === "object") return r.structured_output;
    const parsed = extractJson(typeof r.result === "string" ? r.result : "");
    if (parsed) return parsed;
    throw new EngineError("Claude Code finished without a structured answer");
  }
}

/** The first JSON object in a text (a fenced block or bare braces), or null. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return v;
    } catch { /* next */ }
  }
  return null;
}
