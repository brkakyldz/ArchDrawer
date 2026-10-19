#!/usr/bin/env node
/**
 * Product-level check: the repository is a plugin for Claude Code and Codex.
 *
 *   node scripts/check-plugin.mjs           manifests, skill front matter, launchers, and a copy
 *                                           of the plugin without node_modules (as an install
 *                                           leaves it) that finds its own dependencies
 *   node scripts/check-plugin.mjs --codex   also: Codex lists the plugin from this repository's
 *                                           marketplace, in a temporary CODEX_HOME
 *
 * Nothing outside temporary folders is touched; the user's ~/.codex is never read or written.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 300_000, ...opts });
  return { code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};
const example = join(root, "examples", "shop.archdraw.json");

// Manifests.
const market = json(".claude-plugin/marketplace.json");
const claude = json(".claude-plugin/plugin.json");
const codex = json(".codex-plugin/plugin.json");
check(market.name === "archdrawer" && market.plugins?.length === 1 && market.plugins[0].name === "archdrawer" && market.plugins[0].source === "./", "marketplace lists one plugin, archdrawer, at the repository root");
check(claude.name === "archdrawer" && codex.name === "archdrawer", "both plugin manifests are named archdrawer");
check(claude.version === codex.version && /^\d+\.\d+\.\d+$/.test(claude.version), `both manifests carry one version (${claude.version})`);
check(codex.skills === "./skills/", "the Codex manifest points at ./skills/");

// The skill.
const skill = readFileSync(join(root, "skills", "archdrawer", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
check(/^name: archdrawer$/m.test(front) && /^description: .{40,}$/m.test(front), "skill front matter: name and description");
check(existsSync(join(root, "skills", "archdrawer", "rules.md")), "the rules file sits beside the skill");

// Launchers, from the repository.
const sh = win ? "bash" : "sh";
// The shop example's overview has no zones: validate prints one overview-depth warning before "valid with 1 warning(s)".
const valid = (out) => /(^|\n)valid( with \d+ warning\(s\))?$/.test(out.trim());
const viaSh = run(sh, [join(root, "bin", "archdrawer"), "validate", example]);
check(viaSh.code === 0 && valid(viaSh.out), `bin/archdrawer runs under ${sh} (${viaSh.out || viaSh.err})`);
if (win) {
  const viaCmd = run("cmd.exe", ["/d", "/c", join(root, "bin", "archdrawer.cmd"), "validate", example]);
  check(viaCmd.code === 0 && valid(viaCmd.out), `bin/archdrawer.cmd runs under cmd (${viaCmd.out || viaCmd.err})`);
  const viaPs = run("powershell.exe", ["-NoProfile", "-Command", `& '${join(root, "bin", "archdrawer.cmd")}' validate '${example}'; exit $LASTEXITCODE`]);
  check(viaPs.code === 0 && valid(viaPs.out), `bin/archdrawer.cmd runs under PowerShell (${viaPs.out || viaPs.err})`);
}

// An installed copy: the tracked files, no node_modules; the launcher installs what it needs.
const work = mkdtempSync(join(tmpdir(), "archdrawer-plugin-"));
try {
  const plugin = join(work, "archdrawer");
  const files = run("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root }).out.split(/\r?\n/).filter(Boolean);
  for (const f of files) {
    if (f.startsWith("tests/") || f.startsWith("docs/") || f.startsWith("reports/") || !existsSync(join(root, f))) continue;
    mkdirSync(dirname(join(plugin, f)), { recursive: true });
    cpSync(join(root, f), join(plugin, f));
  }
  check(!existsSync(join(plugin, "node_modules")), "the copy has no node_modules");
  const first = run(sh, [join(plugin, "bin", "archdrawer"), "validate", join(plugin, "examples", "shop.archdraw.json")]);
  check(first.code === 0 && valid(first.out) && /installing its dependencies/.test(first.err), `first run installs the dependencies, then validates (${first.code}: ${first.out} / ${first.err.slice(-300)})`);
  const again = run(sh, [join(plugin, "bin", "archdrawer"), "--version"]);
  check(again.code === 0 && again.out === JSON.parse(readFileSync(join(plugin, "package.json"), "utf8")).version && again.err === "", "second run starts directly");
  check(!existsSync(join(plugin, "node_modules", "vitest")), "only the runtime dependencies were installed");

  if (process.argv.includes("--codex")) {
    const home = join(work, "codex-home");
    mkdirSync(home);
    const env = { ...process.env, CODEX_HOME: home };
    const add = run("codex", ["plugin", "marketplace", "add", root], { env, shell: win });
    check(add.code === 0, `codex plugin marketplace add (${(add.out || add.err).split(/\r?\n/).at(-1)})`);
    const list = run("codex", ["plugin", "list"], { env, shell: win });
    check(list.code === 0 && /archdrawer/.test(list.out), "codex plugin list shows archdrawer");
    const inst = run("codex", ["plugin", "add", "archdrawer@archdrawer"], { env, shell: win });
    check(inst.code === 0, `codex plugin add archdrawer@archdrawer (${(inst.out || inst.err).split(/\r?\n/).at(-1)})`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failures.length ? `\nCHECK-PLUGIN FAILED (${failures.length})` : "\nCHECK-PLUGIN OK");
process.exit(failures.length ? 1 : 0);
