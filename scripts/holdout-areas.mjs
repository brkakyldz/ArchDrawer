// Which held-out scenarios a pull request runs (testing contract, *Test suites*, *Which scenarios a pull
// request runs*): the changed paths map to requirement prefixes, and the scenarios whose titles name one
// of them run, with the `@smoke` journeys. A path no rule names, or one every area depends on, runs them
// all. `main` always runs them all (.github/workflows/ci.yml).
//
//   node scripts/holdout-areas.mjs <base ref>   prints ALL, NONE, or a Playwright --grep pattern
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** First matching rule wins. `areas: "all"` runs every scenario, `[]` runs none. */
export const AREA_RULES = [
  // What no scenario observes.
  { match: /^tests\/e2e\//, areas: [] },
  { match: /\.test\.tsx?$/, areas: [] },
  { match: /^docs\/(decisions|media)\//, areas: [] },
  { match: /^(README|DESIGN|AGENTS|CONTRIBUTING|CLAUDE)\.md$|^(LICENSE|NOTICE)$/, areas: [] },
  { match: /^\.github\/(ISSUE_TEMPLATE\/|pull_request_template|CODEOWNERS|workflows\/issuepilot)/, areas: [] },
  { match: /^(\.claude-plugin|\.codex-plugin|skills|examples)\//, areas: [] },

  // Areas.
  { match: /^src\/web\/home\//, areas: ["HOME", "SRC", "SCAN", "JOB", "START"] },
  { match: /^src\/server\/(sources|folders|picker|remote|scans|files|serverfile)\.ts$/, areas: ["SRC", "SCAN", "HOME", "START", "FILE"] },
  { match: /^src\/server\/(slots|runs|draw|story-turn)\.ts$/, areas: ["JOB", "START", "STORY", "READ", "AI", "HOME"] },
  { match: /^src\/server\/engines\/(claude|codex|prompt|revise)\.ts$/, areas: ["STORY", "READ", "AI", "LAYOUT", "START", "JOB"] },
  { match: /^src\/core\/(repair|intent|read|evidence|scan|report|simple)\.ts$/, areas: ["READ", "STORY", "AI", "SCAN", "START", "FILE"] },
  { match: /^src\/core\/export\//, areas: ["SHARE", "PRES", "LOOK", "LAYOUT", "START"] },
  { match: /^src\/core\/(layout|geometry|channels|shapes|appearance|map|simplify|diff|migrate)\.ts$/, areas: ["LAYOUT", "LOOK", "NAV", "EDIT", "SHARE", "STORY", "FILE"] },
  { match: /^src\/web\/editor\//, areas: ["EDIT", "NAV", "AI", "LOOK", "FILE", "LAYOUT"] },
  { match: /^src\/web\/present\//, areas: ["PRES"] },
  { match: /^src\/web\/share\//, areas: ["SHARE", "PRES"] },
  { match: /^src\/cli\/|^bin\//, areas: ["START", "FILE", "SAFE"] },

  // Everything else (the model and file formats, the server's core, the app shell, the fixture
  // engine, the build, the contracts, the scenarios themselves) runs them all.
];

/** ALL, NONE, or the --grep pattern for these changed paths. */
export function holdoutSelection(paths) {
  const areas = new Set();
  for (const p of paths.map((x) => x.replace(/\\/g, "/")).filter(Boolean)) {
    const rule = AREA_RULES.find((r) => r.match.test(p));
    if (!rule) return "ALL";
    for (const a of rule.areas) areas.add(a);
  }
  if (areas.size === 0) return "NONE";
  return `@smoke|\\b(${[...areas].sort().join("|")})-[0-9]`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const base = process.argv[2];
  if (!base) { console.error("usage: node scripts/holdout-areas.mjs <base ref>"); process.exit(2); }
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" });
  console.log(holdoutSelection(out.split("\n")));
}
