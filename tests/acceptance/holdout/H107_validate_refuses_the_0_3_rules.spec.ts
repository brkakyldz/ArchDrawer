import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agent3, withReadme, withPresentation, part, repo, writeJSON, cli, register, outputLines, errorLines, warnLines, baseURL, type Doc3 } from './helpers';
import { getDocument, wrapAs4 } from './helpers-selections'; // the stored document is format 4: `getDocument` gives its choice in the format 3 shape the cases break, `wrapAs4` puts it back

// A violation's path starts at its choice (diagram contract, rule 1): these files are `archdraw/diagram@3`, converted first, one choice, `choices[0]`.
const OVERVIEW = 'choices\\[0\\]\\.channels\\.overview\\.views\\[0\\]';
const valid = () => withPresentation(withReadme(agent3('Rules agent')));
const long = (n: number) => 'x'.repeat(n);

// Each case breaks one rule on its own, so another error cannot mask it. The pattern is the place `archdrawer validate`
// must name (the documented path where the contract gives one, else the place to fix); the server's refusal carries the
// same `<path>: <message>` lines in `errors`.
const cases: { name: string; pattern: RegExp; break: (d: Doc3) => void }[] = [
  // rule 20: `within`
  { name: 'within-itself', pattern: /^ERROR choices\[0\]\.facts\.components\[2\]\.within/m, break: d => { d.facts.components[2].within = 'model-call'; } },
  { name: 'within-a-fact-that-is-not-there', pattern: /^ERROR choices\[0\]\.facts\.components\[2\]\.within/m, break: d => { d.facts.components[2].within = 'ghost'; } },
  { name: 'within-a-mechanism', pattern: /^ERROR choices\[0\]\.facts\.components\[(2|3)\]\.within/m, break: d => { d.facts.components[3].within = 'model-call'; } },
  // rule 21: a limit's `on`
  { name: 'limit-on-nothing', pattern: /^ERROR choices\[0\]\.facts\.limits\[0\]\.on/m, break: d => { d.facts.limits![0].on = 'ghost'; } },
  { name: 'limit-text-too-long', pattern: /^ERROR choices\[0\]\.facts\.limits\[0\]\.text/m, break: d => { d.facts.limits![0].text = long(61); } },
  { name: 'limit-id-is-a-fact-id', pattern: /^ERROR choices\[0\]\.facts\.(limits\[0\]|components\[1\])\.id/m, break: d => { d.facts.limits![0].id = 'agent'; } },
  // rule 22: `held` and `limits` of a part
  { name: 'held-is-not-within-the-part', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[1\\]\\.held`, 'm'),
    break: d => { d.channels.overview.views![0].nodes[1].held = ['model-call', 'store']; } },
  { name: 'held-twice', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[1\\]\\.held`, 'm'),
    break: d => { d.channels.overview.views![0].nodes[1].held = ['model-call', 'model-call', 'tool-check']; } },
  { name: 'limit-not-on-the-parts-facts', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[2\\]\\.limits`, 'm'),
    break: d => { Object.assign(d.channels.overview.views![0].nodes[2], { form: 'panel', limits: ['turn-limit'] }); } },
  { name: 'limit-shown-twice', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[1\\]\\.limits`, 'm'),
    break: d => { d.channels.overview.views![0].nodes[1].limits = ['turn-limit', 'turn-limit']; } },
  { name: 'more-than-twelve-rows', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[1\\]`, 'm'), // 12 items of the fact + 2 held + 1 limit
    break: d => { d.facts.components[1].items = Array.from({ length: 12 }, (_, i) => `Item ${i + 1}`); } },
  // rule 23: evidence
  { name: 'evidence-over-eight', pattern: /^ERROR choices\[0\]\.facts\.components\[0\]\.evidence/m,
    break: d => { d.facts.components[0].evidence = Array.from({ length: 9 }, (_, i) => ({ file: 'src/web.ts', lines: [i + 1, i + 1] as [number, number] })); } },
  { name: 'evidence-lines-reversed', pattern: /^ERROR choices\[0\]\.facts\.components\[0\]\.evidence/m, break: d => { d.facts.components[0].evidence = [{ file: 'src/web.ts', lines: [5, 2] }]; } },
  { name: 'evidence-line-zero', pattern: /^ERROR choices\[0\]\.facts\.components\[0\]\.evidence/m, break: d => { d.facts.components[0].evidence = [{ file: 'src/web.ts', lines: [0, 3] }]; } },
  { name: 'evidence-line-not-an-integer', pattern: /^ERROR choices\[0\]\.facts\.components\[0\]\.evidence/m,
    break: d => { d.facts.components[0].evidence = [{ file: 'src/web.ts', lines: [1, 2.5] as unknown as [number, number] }]; } },
  { name: 'evidence-file-outside-the-repository', pattern: /^ERROR choices\[0\]\.facts\.components\[0\]\.evidence/m, break: d => { d.facts.components[0].evidence = [{ file: '../escape.ts', lines: null }]; } },
  { name: 'relation-evidence-broken', pattern: /^ERROR choices\[0\]\.facts\.relations\[0\]\.evidence/m, break: d => { d.facts.relations![0].evidence = [{ file: '/etc/passwd', lines: null }]; } },
  { name: 'limit-evidence-broken', pattern: /^ERROR choices\[0\]\.facts\.limits\[0\]\.evidence/m, break: d => { d.facts.limits![0].evidence = [{ file: 'src/web.ts', lines: [3, 1] }]; } },
  // rule 24: steps
  { name: 'step-names-a-part-the-view-lacks', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps\[0\]\.parts/m, break: d => { d.channels.presentation!.steps![0].parts = ['ghost']; } },
  { name: 'step-names-a-part-twice', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps\[0\]\.parts/m, break: d => { d.channels.presentation!.steps![0].parts = ['app', 'app']; } },
  { name: 'step-names-no-part', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps\[0\]\.parts/m, break: d => { d.channels.presentation!.steps![0].parts = []; } },
  { name: 'step-text-too-long', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps\[0\]\.text/m, break: d => { d.channels.presentation!.steps![0].text = long(121); } },
  { name: 'step-note-too-long', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps\[0\]\.note/m, break: d => { d.channels.presentation!.steps![0].note = long(1001); } },
  { name: 'step-id-twice', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps\[1\]/m, break: d => { d.channels.presentation!.steps![1].id = d.channels.presentation!.steps![0].id; } },
  { name: 'more-than-twenty-steps', pattern: /^ERROR choices\[0\]\.channels\.presentation\.steps/m,
    break: d => { d.channels.presentation!.steps = Array.from({ length: 21 }, (_, i) => ({ id: `s${i + 1}`, parts: ['app'], text: `Step ${i + 1}`, note: '' })); } },
  { name: 'steps-without-a-view', pattern: /^ERROR choices\[0\]\.channels\.presentation/m, break: d => { d.channels.presentation!.views = []; } },
  // rule 5, changed: README and presentation hold one view; only the presentation has steps
  { name: 'presentation-holds-two-views', pattern: /^ERROR choices\[0\]\.channels\.presentation/m,
    break: d => { const second = structuredClone(d.channels.presentation!.views![0]); second.id = 'presentation-two'; d.channels.presentation!.views!.push(second); } },
  { name: 'readme-has-steps', pattern: /^ERROR choices\[0\]\.channels\.readme/m, break: d => { (d.channels.readme as unknown as Record<string, unknown>).steps = []; } },
  { name: 'linkedin-has-steps', pattern: /^ERROR choices\[0\]\.channels\.linkedin/m,
    break: d => { d.channels.linkedin = { views: [], steps: [{ id: 's1', parts: ['x'], text: 'x', note: '' }] }; } },
  { name: 'readme-has-an-unknown-key', pattern: /^ERROR choices\[0\]\.channels\.readme/m, break: d => { (d.channels.readme as unknown as Record<string, unknown>).pages = 3; } },
  // rule 6, changed: a fact is shown or held by at most one part of a view
  { name: 'mechanism-held-and-also-shown', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[(1|3)\\]\\.(facts|held)`, 'm'), // reported at the part that shows it again or at the one that holds it
    break: d => { d.channels.overview.views![0].nodes.push(part('loop', { facts: ['model-call'], x: 0, y: 0 })); } },
  // rule 8, changed: a panel shows at least one row; only a panel holds rows
  { name: 'panel-with-no-row', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[1\\]\\.(form|held|limits|items)`, 'm'),
    break: d => { Object.assign(d.channels.overview.views![0].nodes[1], { held: [], limits: [] }); } },
  { name: 'card-with-held-rows', pattern: new RegExp(`^ERROR ${OVERVIEW}\\.nodes\\[1\\]\\.(form|held|limits)`, 'm'), break: d => { d.channels.overview.views![0].nodes[1].form = 'card'; } },
  // rule 16, changed: a mechanism is drawn when a part holds it; a mechanism nobody holds or shows is missing
  { name: 'mechanisms-no-overview-part-draws', pattern: /^ERROR (choices\[0\]\.facts\.components\[(2|3)\]|choices\[0\]\.channels\.overview)/m,
    break: d => { d.channels.overview.views![0].nodes[1].held = []; } },
];

test('H107 [FILE-2, READ-2, STORY-4, STORY-5, #182] validate refuses each broken 0.3 rule with its path, writes nothing, and the server refuses the same file and the same save', async ({ request }) => {
  test.setTimeout(60_000); // every case runs the command twice and the server twice
  const folder = await repo('rules03');
  const fine = join(folder.dir, 'fine.json'); await writeJSON(fine, valid());
  const accepted = await cli(['validate', fine]); expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
  expect(errorLines(accepted)).toEqual([]);

  // The same registered file serves as the document each save is based on: it is valid and has a position everywhere.
  const target = join(folder.dir, 'architecture.archdraw.json'); await writeJSON(target, valid());
  const registered = await register(request, target), base = await getDocument(request, registered.id);
  const targetBytes = await readFile(target, 'utf8');

  for (const rule of cases) {
    const candidate = valid(); rule.break(candidate);
    const path = join(folder.dir, `${rule.name}.json`); await writeJSON(path, candidate);
    const original = await readFile(path, 'utf8');
    for (const command of ['validate', 'open']) {
      const result = await cli([command, path, ...(command === 'open' ? ['--no-browser'] : [])]);
      const lines = outputLines(result);
      expect(result.code, `${rule.name}: ${command}`).toBe(1);
      expect(lines.join('\n'), `${rule.name}: ${command}`).toMatch(rule.pattern);
      expect(warnLines(result), `${rule.name}: an invalid file prints no warnings`).toEqual([]);
      const errors = errorLines(result);
      expect(lines.filter(line => line === `${errors.length} error(s)`), `${rule.name}: the count line`).toHaveLength(1);
      expect(await readFile(path, 'utf8'), `${rule.name}: ${command} writes nothing`).toBe(original);
    }
    // The server refuses the file, and the same change made to the stored document, with the same lines.
    const auth = registered.token;
    const response = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path } });
    expect(response.status(), rule.name).toBe(400);
    expect(((await response.json()).errors as string[]).join('\n'), rule.name).toMatch(new RegExp(rule.pattern.source.replace(/^\^ERROR /, '^'), 'm'));
    const edit = structuredClone(base); rule.break(edit);
    const put = await request.put(`${baseURL()}/api/diagrams/${registered.id}`, { headers: { 'X-Archdraw-Token': auth }, data: wrapAs4(edit) });
    expect(put.status(), `${rule.name}: PUT`).toBe(400);
    const refusal = await put.json();
    expect(refusal.error, rule.name).toMatch(/^Invalid diagram/);
    expect(((refusal.errors ?? []) as string[]).join('\n') + '\n' + refusal.error, `${rule.name}: PUT`).toMatch(new RegExp(rule.pattern.source.replace(/^\^ERROR /, ''), 'm'));
    expect(await readFile(target, 'utf8'), `${rule.name}: a refused save writes nothing`).toBe(targetBytes);
  }

  // Several broken rules in one file: every violation is listed, and the count says how many.
  const many = valid(); many.facts.components[2].within = 'ghost'; many.facts.limits![0].on = 'ghost';
  many.channels.presentation!.steps![0].parts = ['ghost']; many.facts.components[0].evidence = [{ file: 'src/web.ts', lines: [4, 1] }];
  const manyPath = join(folder.dir, 'many.json'); await writeJSON(manyPath, many);
  const everything = await cli(['validate', manyPath]); expect(everything.code).toBe(1);
  const listed = errorLines(everything);
  for (const place of ['choices[0].facts.components[2].within', 'choices[0].facts.limits[0].on', 'choices[0].channels.presentation.steps[0].parts', 'choices[0].facts.components[0].evidence'])
    expect(listed.some(line => line.startsWith(`ERROR ${place}`)), place).toBe(true);
  expect(outputLines(everything)).toContain(`${listed.length} error(s)`);

  // What stays valid: a limit no part draws, a relation between two mechanisms, a panel that holds only a limit.
  const lenient = valid();
  lenient.channels.overview.views![0].nodes[1].limits = [];
  lenient.facts.relations!.push({ id: 'r3', from: 'model-call', to: 'tool-check', label: '', style: 'call', both: false });
  const lenientPath = join(folder.dir, 'lenient.json'); await writeJSON(lenientPath, lenient);
  const lenientResult = await cli(['validate', lenientPath]); expect(lenientResult.code, lenientResult.stdout + lenientResult.stderr).toBe(0);
  const limitOnly = agent3('Limit only'); limitOnly.channels.overview.views![0].nodes[1].held = [];
  limitOnly.facts.components[2].within = null; limitOnly.facts.components[3].within = null; // now ordinary facts, drawn by their own parts
  limitOnly.channels.overview.views![0].nodes.push(part('model-call', { x: 0, y: 0, place: { row: 2, col: 0 } }), part('tool-check', { x: 0, y: 0, place: { row: 2, col: 1 } }));
  const limitOnlyPath = join(folder.dir, 'limit-only.json'); await writeJSON(limitOnlyPath, limitOnly);
  const limitOnlyResult = await cli(['validate', limitOnlyPath]); expect(limitOnlyResult.code, limitOnlyResult.stdout + limitOnlyResult.stderr).toBe(0);

  // An evidence path missing from the repository is checked as `files` are: an error to `validate`, a warning to `open`.
  const missing = valid(); missing.facts.components[0].evidence = [{ file: 'src/not-written-yet.ts', lines: [1, 2] }];
  const missingPath = join(folder.dir, 'missing-evidence.json'); await writeJSON(missingPath, missing);
  const strict = await cli(['validate', missingPath]); expect(strict.code).toBe(1);
  expect(errorLines(strict).some(line => line.startsWith('ERROR choices[0].facts.components[0].evidence'))).toBe(true);
  const lenientOpen = await cli(['open', missingPath, '--no-browser']); expect(lenientOpen.code, lenientOpen.stderr).toBe(0);
  const warned = warnLines(lenientOpen).filter(line => line.includes('src/not-written-yet.ts'));
  expect(warned.length).toBeGreaterThanOrEqual(1); expect(warned[0]).toContain('choices[0].facts.components[0].evidence');
});
