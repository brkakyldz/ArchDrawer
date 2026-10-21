// Independent checks of the held-out suite itself; no product code, browser, engine or installed dependency.
//   node --disable-warning=ExperimentalWarning suite/author-check.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const here = new URL('.', import.meta.url);

// Every requirement id of the product spec, with its status. A title may carry only ids that the product
// does today ('today') or has but is changing ('change'); an id still 'build' has nothing to observe yet.
// FILE-2, FILE-3, NAV-2 and STORY-1 are built in 0.2 (the batches A–F of the suite land with their steps), so
// from this round on they may appear in titles.
const requirements = {
  'START-1': 'change', 'START-2': 'build', 'START-3': 'today', 'START-4': 'build', 'START-5': 'today',
  'SCAN-1': 'build', 'SCAN-2': 'build', 'SCAN-3': 'build', 'SCAN-4': 'build',
  'READ-1': 'build', 'READ-2': 'build', 'READ-3': 'build',
  'STORY-1': 'change', 'STORY-2': 'build', 'STORY-3': 'build', 'STORY-4': 'build', 'STORY-5': 'build', 'STORY-6': 'change',
  'LAYOUT-1': 'today', 'LAYOUT-2': 'today', 'LAYOUT-3': 'today', 'LAYOUT-4': 'build',
  'LOOK-1': 'today', 'LOOK-2': 'build', 'LOOK-3': 'change',
  'FILE-1': 'today', 'FILE-2': 'change', 'FILE-3': 'change',
  'EDIT-1': 'today', 'EDIT-2': 'today', 'EDIT-3': 'today', 'EDIT-4': 'today',
  'AI-1': 'today', 'AI-2': 'change', 'AI-3': 'build', 'AI-4': 'build', 'AI-5': 'build',
  'NAV-1': 'today', 'NAV-2': 'change', 'NAV-3': 'change', 'NAV-4': 'build',
  'PRES-1': 'build', 'PRES-2': 'build', 'PRES-3': 'build',
  'SHARE-1': 'today', 'SHARE-2': 'change', 'SHARE-3': 'change',
  'SAFE-1': 'today', 'SAFE-2': 'today', 'SAFE-3': 'today', 'SAFE-4': 'today', 'SAFE-5': 'today',
  'QUAL-1': 'build', 'QUAL-2': 'today', 'QUAL-3': 'build',
};
const builtins = ['@playwright/test', 'node:fs/promises', 'node:fs', 'node:path', 'node:os', 'node:url', 'node:net', 'node:child_process', 'node:crypto'];
// Scenarios and files that left the suite; none of them may come back.
const retiredScenarios = ['H37', 'H42', 'H43', 'H45', 'H49', 'H50', 'H51', 'H52', 'H53', 'H54', 'H55', 'H56', 'H60', 'H61', 'H62',
  ...Array.from({ length: 19 }, (_, i) => `H${65 + i}`)];
const retiredFiles = [/^helpers-v\d+\.ts$/, /^border-cases\.ts$/, /^review.*baseline\.json$/, /^retired-v1$/];

const entries = await readdir(here, { withFileTypes: true });
const names = entries.map(entry => entry.name);
for (const name of names) assert.ok(!retiredFiles.some(pattern => pattern.test(name)), `${name} was removed from the suite and is back`);
for (const name of names) assert.ok(!retiredScenarios.some(id => name.startsWith(`${id}_`)), `${name}: a retired scenario is back`);
assert.ok(entries.filter(entry => entry.isDirectory()).length === 0, 'the suite folder holds no subfolder');

const sources = new Map();
for (const entry of entries.filter(e => e.isFile() && e.name.endsWith('.ts'))) {
  const source = await readFile(new URL(entry.name, here), 'utf8');
  stripTypeScriptTypes(source); // throws when a file does not parse
  sources.set(entry.name, source);
}
const suiteFiles = new Set(names);

// Imports stay inside the suite: the test runner, Node built-ins and the suite's own files.
for (const [name, source] of sources) {
  const statements = [...source.matchAll(/^import\s+[^;'"]*?\sfrom\s+['"]([^'"]+)['"]/gm), ...source.matchAll(/^import\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g), ...source.matchAll(/^export\s+[^;'"]*?\sfrom\s+['"]([^'"]+)['"]/gm)];
  for (const match of statements) {
    const target = match[1];
    if (target.startsWith('./')) {
      assert.ok(!target.slice(2).includes('/'), `${name}: ${target} leaves the suite folder`);
      assert.ok([`${target.slice(2)}.ts`, target.slice(2)].some(file => suiteFiles.has(file)), `${name}: ${target} is not a file of the suite`);
    } else assert.ok(builtins.includes(target), `${name}: imports ${target}, which is neither @playwright/test nor a Node built-in`);
  }
  assert.ok(!/\bcreateRequire\b/.test(source), `${name}: createRequire could reach outside the suite folder`);
  assert.ok(!/from\s+['"]\.\.\//.test(source), `${name}: reaches outside the suite folder`);
}

// Scenarios: one test per file, its title is `H<nn> [IDS] journey`, the number matches the file name.
const scenarios = [];
const used = new Set();
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  assert.ok(name.endsWith('.spec.ts'), `${name}: scenario files end in .spec.ts`);
  const tests = [...source.matchAll(/^test\('([^']+)'/gm)];
  assert.equal(tests.length, 1, `${name}: exactly one test per file`);
  const title = tests[0][1];
  const parts = title.match(/^(H\d+) \[([^\]]+)\] (\S.*)$/);
  assert.ok(parts, `${name}: title must read H<nn> [IDS] journey: ${title}`);
  assert.equal(parts[1], name.split('_')[0], `${name}: title number differs from the file name`);
  const ids = parts[2].split(',').map(id => id.trim());
  assert.ok(ids.length >= 1 && ids.every(Boolean), `${name}: at least one requirement id`);
  assert.equal(new Set(ids).size, ids.length, `${name}: an id is repeated`);
  for (const id of ids) {
    assert.ok(id in requirements, `${name}: ${id} is not a requirement of the spec`);
    assert.notEqual(requirements[id], 'build', `${name}: ${id} is not built yet, so nothing can observe it`);
    used.add(id);
  }
  scenarios.push(parts[1]);
}
const byNumber = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
scenarios.sort(byNumber);
assert.equal(new Set(scenarios).size, scenarios.length, 'a scenario number is used twice');

// verify.json lists exactly the scenarios present and keeps the pass thresholds.
const verify = JSON.parse(await readFile(new URL('verify.json', here), 'utf8'));
assert.deepEqual([...verify.expected].sort(byNumber), scenarios, 'verify.json ids differ from the scenario files');
assert.deepEqual(verify.expected, [...verify.expected].sort(byNumber), 'verify.json ids are not in order');
assert.deepEqual([verify.runs, verify.perScenario, verify.overall, verify.timeoutMs], [3, 2, 0.9, 1800000]);
assert.equal(verify.command, 'npx playwright test -c tests/acceptance/holdout');
assert.equal(verify.format, 'playwright-json'); assert.equal(verify.report, 'test-results/holdout.json');

// The written index agrees with the files: the scenario count, and a row for every scenario in COVERAGE.md.
const coverage = await readFile(new URL('COVERAGE.md', here), 'utf8');
assert.equal(Number(coverage.match(/The suite has (\d+) scenarios/)?.[1]), scenarios.length, 'COVERAGE.md states another scenario count');
for (const id of scenarios) assert.ok(new RegExp(`^\\| ${id} \\|`, 'm').test(coverage), `COVERAGE.md has no row for ${id}`);
const readme = await readFile(new URL('README.md', here), 'utf8');
assert.equal(Number(readme.match(/The suite holds (\d+) Playwright/)?.[1]), scenarios.length, 'README.md states another scenario count');

// The 0.2 helpers every batch relies on stay exported from the one helper file (no later batch may change it).
const helpers = sources.get('helpers.ts');
for (const name of ['readDocument', 'readDrawing', 'writeDrawing', 'workspace', 'workspaceRaw', 'joinView', 'fromLegacy', 'persistedDoc', 'exportOf', 'refusedRun', 'withLinkedIn', 'shop3'])
  assert.ok(new RegExp(`export (async )?(function|const) ${name}\\b`).test(helpers), `helpers.ts no longer exports ${name}`);

console.log(`author-check: ${scenarios.length} scenarios, ${used.size} requirement ids observed, ${sources.size} typed files parse, imports stay inside the suite: ok`);
