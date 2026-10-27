// Independent checks of the held-out suite itself; no product code, browser, engine or installed dependency.
//   node --disable-warning=ExperimentalWarning suite/author-check.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const here = new URL('.', import.meta.url);

// Every requirement id of the product spec, with its status as spec.md states it: 'today' (Today), 'change' (To change) or
// 'build' (To build) or 'landing'. A title may carry only ids that the product does today or is changing, or that the round being
// landed observes; an id still 'build' has nothing to observe yet. Everything the 0.2, 0.3 and 0.4 rounds and the story-limits round
// (START-6, STORY-7) built is 'today' now. 'landing' is PRES-1–3: `spec.md` keeps them To build until the integration of 0.5 marks
// them Today, and the 0.5 scenarios (H158–H166) observe them, so a title may carry them. START-1 (To change), and START-2, NAV-4 and
// QUAL-1/3 (To build) are the others.
// The ADR 0013–0015 round (archdraw/diagram@4, calm connections, an outline per kind, choices) marks START-7, STORY-8, LAYOUT-5,
// LAYOUT-6, LOOK-2, LOOK-3, LOOK-4 and EDIT-5 To build and changes START-1, SCAN-2, SCAN-3, STORY-1, LAYOUT-2, FILE-2, NAV-1 and
// NAV-2: the ones To build are 'round' (a title may carry them, they are being landed by the issues of the round and each needs a
// scenario, as PRES-1–3 did), the others 'change'. LOOK-2 and LOOK-3 carry 'today' from 0.4; the spec now calls them To build.
// The ADR 0016–0017 round (jobs side by side in shared engine slots, sources, the home screen) rewrites START-4 and START-7 (both
// To change now) and adds JOB-1–10, SRC-1–6 and HOME-1–12, all To build: 'round', each needs a scenario (JOB-8 and HOME-1–12 are
// observed on the screen, the others over the API).
const requirements = {
  'START-1': 'change', 'START-2': 'build', 'START-3': 'today', 'START-4': 'change', 'START-5': 'today', 'START-6': 'today', 'START-7': 'change',
  ...Object.fromEntries([...Array.from({ length: 10 }, (_, i) => `JOB-${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `SRC-${i + 1}`),
    ...Array.from({ length: 12 }, (_, i) => `HOME-${i + 1}`)].map(id => [id, 'round'])),
  'SCAN-1': 'today', 'SCAN-2': 'change', 'SCAN-3': 'change', 'SCAN-4': 'today',
  'READ-1': 'today', 'READ-2': 'today', 'READ-3': 'today',
  'STORY-1': 'change', 'STORY-2': 'today', 'STORY-3': 'today', 'STORY-4': 'today', 'STORY-5': 'today', 'STORY-6': 'today', 'STORY-7': 'today', 'STORY-8': 'round',
  'LAYOUT-1': 'today', 'LAYOUT-2': 'change', 'LAYOUT-3': 'today', 'LAYOUT-4': 'today', 'LAYOUT-5': 'round', 'LAYOUT-6': 'round',
  'LOOK-1': 'today', 'LOOK-2': 'round', 'LOOK-3': 'round', 'LOOK-4': 'round',
  'FILE-1': 'today', 'FILE-2': 'change', 'FILE-3': 'today',
  'EDIT-1': 'today', 'EDIT-2': 'today', 'EDIT-3': 'today', 'EDIT-4': 'today', 'EDIT-5': 'round',
  'AI-1': 'today', 'AI-2': 'today', 'AI-3': 'today', 'AI-4': 'today', 'AI-5': 'today',
  'NAV-1': 'change', 'NAV-2': 'change', 'NAV-3': 'today', 'NAV-4': 'build',
  'PRES-1': 'landing', 'PRES-2': 'landing', 'PRES-3': 'landing',
  'SHARE-1': 'today', 'SHARE-2': 'today', 'SHARE-3': 'today',
  'SAFE-1': 'today', 'SAFE-2': 'today', 'SAFE-3': 'today', 'SAFE-4': 'today', 'SAFE-5': 'today',
  'QUAL-1': 'build', 'QUAL-2': 'today', 'QUAL-3': 'build',
};
const builtins = ['@playwright/test', 'node:fs/promises', 'node:fs', 'node:path', 'node:os', 'node:url', 'node:net', 'node:child_process', 'node:crypto'];
// Scenarios and files that left the suite; none of them may come back.
const retiredScenarios = ['H37', 'H42', 'H43', 'H45', 'H49', 'H50', 'H51', 'H52', 'H53', 'H54', 'H55', 'H56', 'H60', 'H61', 'H62',
  ...Array.from({ length: 19 }, (_, i) => `H${65 + i}`)];
// H195 was renamed by the ADR 0016 round (a later failure no longer stops the file); its old name must not come back beside the new one.
const retiredFiles = [/^helpers-v\d+\.ts$/, /^border-cases\.ts$/, /^review.*baseline\.json$/, /^retired-v1$/,
  /^H195_a_failure_in_a_later_choice_keeps_the_finished_ones_and_the_next_draw_starts_from_the_first_unfinished\.spec\.ts$/];

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

// Scenarios: one test per file, its title is `H<nn> [IDS] journey`, the number matches the file name. Since the ADR 0013–0015 round the
// bracket also holds the build issues the scenario accepts, as `#<number>` tokens, and its tokens are separated by commas or by spaces
// (older titles use commas; the round's use spaces). Every title needs at least one requirement id; every scenario from H167 on
// (the round that makes the build issues) names at least one issue; an issue number is written once per title.
const scenarios = [];
const used = new Set();
const issuesOf = new Map();
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  assert.ok(name.endsWith('.spec.ts'), `${name}: scenario files end in .spec.ts`);
  const tests = [...source.matchAll(/^test\('([^']+)'/gm)];
  assert.equal(tests.length, 1, `${name}: exactly one test per file`);
  const title = tests[0][1];
  const parts = title.match(/^(H\d+) \[([^\]]+)\] (\S.*)$/);
  assert.ok(parts, `${name}: title must read H<nn> [IDS] journey: ${title}`);
  assert.equal(parts[1], name.split('_')[0], `${name}: title number differs from the file name`);
  const tokens = parts[2].split(/[\s,]+/).filter(Boolean);
  assert.ok(tokens.every(token => /^[A-Z]+-\d+$/.test(token) || /^#\d+$/.test(token)), `${name}: the bracket holds requirement ids and #issue tokens only: ${parts[2]}`);
  const ids = tokens.filter(token => !token.startsWith('#')), issues = tokens.filter(token => token.startsWith('#'));
  assert.ok(ids.length >= 1, `${name}: at least one requirement id`);
  assert.equal(new Set(tokens).size, tokens.length, `${name}: an id or an issue is repeated`);
  if (Number(parts[1].slice(1)) >= 167) assert.ok(issues.length >= 1, `${name}: a scenario from H167 on names at least one build issue`);
  issuesOf.set(parts[1], issues);
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
  'runDone', 'acceptPreview', 'noToast', 'paddedPng', 'pngInfo', 'TINY_PNG', 'SUGGESTIONS', 'SUGGESTION_TEXT', 'DEFAULT_IMAGE', 'REFUSED_WHILE_PREVIEW', 'noChanges',
  // 0.5: the slide image, presenting, the tour and the slide exports.
  'SLIDE_STEPS', 'slideShop', 'tourShop', 'TOUR_DESK_FIRST', 'toPresentation', 'openLayer', 'slideRead', 'slideDimming', 'dimsAgree', 'squeezed', 'textLines',
  'fullscreenAgrees', 'focusStaysIn', 'watchToasts', 'toastsSeen', 'sessionWrite', 'slugOf', 'downloaded', 'crc32Of', 'readZip', 'readPdf', 'pngSize',
  'slideSized', 'slideBox', 'pixelGrids', 'gridDistance', 'gridMean'])
  assert.ok(new RegExp(`export (async )?(function|const) ${name}\\b`).test(helpers), `helpers.ts no longer exports ${name}`);

// The ask box and the old one-click fold are gone (0.4); the parts' rows, the `show-items` switch and the `views-button` are gone
// (ADR 0014, ADR 0015): a scenario may name their test ids only to say they are not there.
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  for (const [i, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*(\/\/|const ASK_BOX)/.test(line)) continue;
    if (/['"`](ask-(input|send|expand|status|cancel|error|retry|saved)|simplify-overview|show-items|node-item|node-item-input|views-button)['"`]/.test(line))
      assert.ok(/toHaveCount\(0\)/.test(line), `${name}:${i + 1}: uses a control that a later round removed, other than to assert it is gone`);
  }
}

// A fixture marker such as [fixture:slow] cannot be part of a Windows folder name (":"), so a scenario that creates a folder
// with one must guard it, and keep the rest of its journey running on Windows.
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  if (/markerRepo\(|markerFolder\(/.test(source)) assert.ok(/process\.platform\s*!==?\s*'win32'/.test(source), `${name}: a folder named with a fixture marker needs the win32 guard`);
}

// 0.5 is built by two lanes at the same time, so a scenario belongs to one lane's surface: the present lane builds `present-start`,
// `tour-start` and the `present` layer, the share lane the two slide downloads. A file that uses one lane's test ids or helpers
// must not use the other's (it could not pass on either lane before the merge), and no file counts the buttons of `share-actions`
// (the slide downloads are added to it after the merge). The helper file may hold both.
const presentSurface = /['"`](present|present-[a-z-]+|tour-[a-z-]+)['"`]|\b(openLayer|slideRead|slideDimming|dimsAgree|slideSized|slideBox|fullscreenAgrees|focusStaysIn|tourShop|TOUR_DESK_FIRST)\b/;
const slidesSurface = /download-slides-(pdf|png)|\b(downloaded|readPdf|readZip|pixelGrids)\b/;
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  const present = presentSurface.test(source), slides = slidesSurface.test(source);
  assert.ok(!(present && slides), `${name}: uses both the present lane's surface (present, tour) and the share lane's (the slide downloads)`);
  for (const [i, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*\/\//.test(line)) continue;
    assert.ok(!(/share-actions/.test(line) && /toHaveCount\(|\.count\(\)|getByRole\(\s*['"]button['"]|locator\(\s*['"]button['"]|\.children\b|\.all\(\)/.test(line)),
      `${name}:${i + 1}: counts what share-actions holds, which changes when the slide downloads join it`);
  }
}
// The 0.5 title rule: PRES ids appear only in scenarios from H158 on (the round that observes them), and each PRES id has a scenario.
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  const number = Number(name.match(/^H(\d+)_/)[1]), title = source.match(/^test\('([^']+)'/m)[1];
  if (/\bPRES-\d\b/.test(title)) assert.ok(number >= 158, `${name}: a PRES id in a scenario older than the 0.5 round`);
}
for (const id of ['PRES-1', 'PRES-2', 'PRES-3']) assert.ok(used.has(id), `no scenario observes ${id}`);

// The ADR 0013–0015 round: every requirement it marks To build or To change has a scenario, and so has every build issue it makes
// (ISSUES-drawing.md and ISSUES-selections.md); a title may name no other issue number.
for (const id of Object.keys(requirements).filter(id => requirements[id] === 'round')) assert.ok(used.has(id), `no scenario observes ${id}`);
for (const id of ['START-1', 'SCAN-2', 'SCAN-3', 'STORY-1', 'LAYOUT-2', 'FILE-2', 'NAV-1', 'NAV-2', 'START-4', 'START-7']) assert.ok(used.has(id), `no scenario observes ${id}`);
const roundIssues = [44, 164, 165, 166, 167, 168, 170, 171, 172, 174, 175, 176, 177, 180, 181, 182, 183, 184, 185, 186, 195, 196, 197, 198, 199, 200, 201, 202].map(n => `#${n}`);
const named = new Set([...issuesOf.values()].flat());
for (const issue of named) assert.ok(roundIssues.includes(issue), `a title names ${issue}, which is not a build issue of the round`);
for (const issue of roundIssues) assert.ok(named.has(issue), `no scenario accepts ${issue}`);

// The round's helper files keep the names the batches' scenarios import (the reading of a stored file, whichever format it has).
for (const [file, exported] of Object.entries({
  'helpers-drawing.ts': ['readChoice', 'persistedChoice', 'sketch', 'shapeForKind', 'cardSize', 'pickUp', 'dragMarks', 'edgeSnaps', 'drawnRoutes', 'expectSameRoutes', 'inspectImage'],
  'helpers-selections.ts': ['readChoice', 'readChoices', 'flat3', 'wrapAs4', 'workspace4', 'choice4', 'doc4'],
  'helpers.ts': ['flattenChoice', 'readStoredRaw', 'getStoredRaw'],
})) {
  assert.ok(sources.has(file), `${file} is missing`);
  for (const name of exported) assert.ok(new RegExp(`export (async )?(function|const) ${name}\\b`).test(sources.get(file)), `${file} no longer exports ${name}`);
}
// A reader of helpers.ts hands back one choice of a `@4` document in the `@3` shape, whichever format is on disk.
for (const name of ['readDocument', 'getDocument', 'sessionWrite'])
  assert.ok(new RegExp(`export async function ${name}\\b[\\s\\S]{0,900}?(flattenChoice|readStoredRaw|getStoredRaw)`).test(helpers), `helpers.ts: ${name} does not read a format 4 document as a choice`);

// The ADR 0016–0017 round (jobs, sources, the home screen). The shared harness server sets none of the variables these scenarios need
// (slots, time limits, keep time, search home, test dialog, test links), so H209–H247 each start a server of their own through one
// helper: H209–H228 `jobServer` (helpers-jobs.ts), H229–H247 `homeServer` (helpers-home.ts). Whichever file starts one stops it in a
// `finally` (a server left running keeps its port, its engines and its temp folder for the next scenario).
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  const number = Number(name.match(/^H(\d+)_/)[1]);
  const own = [...source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*await\s+(jobServer|homeServer)\(/g)];
  if (number >= 209 && number <= 228) assert.ok(own.some(match => match[2] === 'jobServer'), `${name}: a scenario of the jobs and sources batch starts its own server with jobServer(`);
  if (number >= 229 && number <= 247) assert.ok(own.some(match => match[2] === 'homeServer'), `${name}: a scenario of the home batch starts its own server with homeServer(`);
  for (const match of own)
    assert.ok(new RegExp(`\\bfinally\\s*\\{\\s*await\\s+${match[1]}\\.(stop|close)\\(\\)`).test(source), `${name}: the server started as ${match[1]} is not stopped in a finally`);
  if (number >= 209 && number <= 247) assert.ok(!/ARCHDRAW_HOLDOUT|playwright\.config/.test(source), `${name}: a round scenario must not depend on the shared harness server's settings`);
  // A scenario that asserts a duration is allowed only where the contract names one; the rest assert states and orders.
  if (number >= 209 && number <= 247) assert.ok(!/(waitForTimeout|sleep)\(\s*[1-9][\d_]{4,}\s*\)/.test(source), `${name}: a fixed wait of ten seconds or more; poll for the state instead`);
}
// The helper files of the round keep exporting what their scenarios import.
for (const [file, exported] of Object.entries({
  'helpers-jobs.ts': ['jobServer', 'watch', 'eventsOf', 'runEventsOf', 'scanEventsOf', 'until', 'sleep', 'ms', 'lines', 'ofChoice', 'scanRec', 'runRec', 'activityOf', 'jobOf',
    'startScanOn', 'awaitScan', 'scanOn', 'drawOn', 'awaitRun', 'states', 'runningOf', 'sampleRun', 'refineOn', 'registerDrawing', 'diagramIds', 'viewsByChoice', 'readDoc',
    'tempDir', 'gitIn', 'quickRepo', 'makeRemote', 'copyOf', 'branchOf', 'headOf', 'short', 'reposListing', 'writePicker', 'ISO_MS', 'HEX16', 'WAITING'],
  'helpers-home.ts': ['homeServer', 'openHome', 'makeRepo', 'makeRemote', 'copyDir', 'comboOptions', 'navItems', 'stepper', 'jobsOnScreen', 'jobIn', 'rowFacts', 'recordRowFacts',
    'recordedFacts', 'maxRunning', 'startedRetry', 'startedJoin', 'answerDialogs', 'tickOnHome', 'drawOnHome', 'activityNow'],
})) {
  assert.ok(sources.has(file), `${file} is missing`);
  for (const name of exported) assert.ok(new RegExp(`export (async )?(function|const) ${name}\\b`).test(sources.get(file)), `${file} no longer exports ${name}`);
}
// The fixture's markers travel in a typed text or in a link's repository name; `makeRepo` of the home batch has no win32 guard.
for (const [name, source] of sources) {
  if (!/^H\d+_/.test(name)) continue;
  for (const [i, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*\/\//.test(line)) continue;
    assert.ok(!/\bmakeRepo\(\s*[^)]*\[fixture:/.test(line), `${name}:${i + 1}: a fixture marker in a folder name needs the win32 guard of markerRepo`);
  }
}

console.log(`author-check: ${scenarios.length} scenarios, ${used.size} requirement ids observed, ${sources.size} typed files parse, imports stay inside the suite: ok`);
