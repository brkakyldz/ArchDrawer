// Independent checks of the held-out suite itself; no product code, browser, engine or installed dependency.
//   node --disable-warning=ExperimentalWarning suite/author-check.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const here = new URL('.', import.meta.url);

// Every requirement id of the product spec, with its status as spec.md states it: 'today' (Today), 'change' (To change) or
// 'build' (To build). A title may carry only ids that the product does today or is changing; an id still 'build' has nothing
// to observe yet. Everything the 0.2, 0.3 and 0.4 rounds and the story-limits round (START-6, STORY-7) built is 'today' now.
// START-1 (To change), and START-2, NAV-4, PRES-1–3 and QUAL-1/3 (To build) are the others.
const requirements = {
  'START-1': 'change', 'START-2': 'build', 'START-3': 'today', 'START-4': 'today', 'START-5': 'today', 'START-6': 'today',
  'SCAN-1': 'today', 'SCAN-2': 'today', 'SCAN-3': 'today', 'SCAN-4': 'today',
  'READ-1': 'today', 'READ-2': 'today', 'READ-3': 'today',
  'STORY-1': 'today', 'STORY-2': 'today', 'STORY-3': 'today', 'STORY-4': 'today', 'STORY-5': 'today', 'STORY-6': 'today', 'STORY-7': 'today',
  'LAYOUT-1': 'today', 'LAYOUT-2': 'today', 'LAYOUT-3': 'today', 'LAYOUT-4': 'today',
  'LOOK-1': 'today', 'LOOK-2': 'today', 'LOOK-3': 'today',
  'FILE-1': 'today', 'FILE-2': 'today', 'FILE-3': 'today',
  'EDIT-1': 'today', 'EDIT-2': 'today', 'EDIT-3': 'today', 'EDIT-4': 'today',
  'AI-1': 'today', 'AI-2': 'today', 'AI-3': 'today', 'AI-4': 'today', 'AI-5': 'today',
  'NAV-1': 'today', 'NAV-2': 'today', 'NAV-3': 'today', 'NAV-4': 'build',
  'PRES-1': 'build', 'PRES-2': 'build', 'PRES-3': 'build',
  'SHARE-1': 'today', 'SHARE-2': 'today', 'SHARE-3': 'today',
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

// The 0.2 and 0.3 helpers every batch relies on stay exported from the one helper file (no later batch may change it).
const helpers = sources.get('helpers.ts');
for (const name of ['readDocument', 'readDrawing', 'writeDrawing', 'workspace', 'workspaceRaw', 'joinView', 'fromLegacy', 'persistedDoc', 'exportOf', 'refusedRun', 'withLinkedIn', 'shop3',
  'agent3', 'withReadme', 'withPresentation', 'gitRepo', 'plainFolder', 'gitWithoutCommit', 'markerFolder', 'markerRepo', 'writeExistingDrawing', 'scanCacheCount',
  'postJSON', 'checkFolder', 'startScan', 'finishScan', 'scanFolder', 'scanRecord', 'startDraw', 'refusedDraw', 'drawFolder', 'sseEvents', 'scanEvents', 'runEvents', 'listedDiagrams',
  'tabTo', 'stepIds', 'litParts', 'nodeSizes', 'samePath', 'warnLines', 'errorLines',
  // 0.4: shapes, the AI conversation, previews, suggestions and the second look.
  'shapeFor', 'editorShape', 'editorShapes', 'svgShapes', 'thumbShapes', 'openAiPanel', 'aiTurns', 'aiTurn', 'turnStates', 'turnTexts', 'startedRun', 'sendInPanel',
  'runDone', 'acceptPreview', 'noToast', 'paddedPng', 'pngInfo', 'TINY_PNG', 'SUGGESTIONS', 'SUGGESTION_TEXT', 'DEFAULT_IMAGE', 'REFUSED_WHILE_PREVIEW', 'noChanges'])
  assert.ok(new RegExp(`export (async )?(function|const) ${name}\\b`).test(helpers), `helpers.ts no longer exports ${name}`);

// The ask box and the old one-click fold are gone (0.4): a scenario may name their test ids only to say they are not there.
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  for (const [i, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*(\/\/|const ASK_BOX)/.test(line)) continue;
    if (/['"`](ask-(input|send|expand|status|cancel|error|retry|saved)|simplify-overview)['"`]/.test(line))
      assert.ok(/toHaveCount\(0\)/.test(line), `${name}:${i + 1}: uses a control that 0.4 removed, other than to assert it is gone`);
  }
}

// A fixture marker such as [fixture:slow] cannot be part of a Windows folder name (":"), so a scenario that creates a folder
// with one must guard it, and keep the rest of its journey running on Windows.
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  if (/markerRepo\(|markerFolder\(/.test(source)) assert.ok(/process\.platform\s*!==?\s*'win32'/.test(source), `${name}: a folder named with a fixture marker needs the win32 guard`);
}

console.log(`author-check: ${scenarios.length} scenarios, ${used.size} requirement ids observed, ${sources.size} typed files parse, imports stay inside the suite: ok`);
