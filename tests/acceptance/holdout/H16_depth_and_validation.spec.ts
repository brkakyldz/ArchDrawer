import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, fromLegacy, workspace, writeJSON, cli, token, baseURL, type Doc3, type Drawing } from './helpers';

const OVERVIEW = 'channels.overview.views[0]';

test('H16 [START-5, FILE-1, FILE-2, STORY-5, LOOK-3] depth warnings permit a drawing but every broken field is reported without repair', async ({ request }) => {
  const doc = drawing('Depth review');
  doc.views[0].nodes = Array.from({ length: 6 }, (_, i) => component(`part-${i}`, { place: { row: 0, col: i }, sub: i === 0 ? '90 s' : '' }));
  doc.views[0].edges = Array.from({ length: 5 }, (_, i) => ({ id: `flow-${i}`, from: `part-${i}`, to: `part-${i + 1}`, label: 'process', style: 'call', both: false, step: null }));
  const { dir, file } = await workspace('depth', doc);
  const bytes = await readFile(file, 'utf8'); const valid = await cli(['validate', file]);
  expect(valid.code).toBe(0); expect(valid.stdout).toMatch(/valid with \d+ warning/);
  const warningLines = valid.stdout.split(/\r?\n/).filter(line => /^WARN\s+/.test(line));
  // From 0.4 (LOOK-3) six parts with no panel are no longer asked for held items: three depth warnings remain.
  expect(warningLines.length).toBeGreaterThanOrEqual(3);
  for (const phrase of [/flat|pipeline/i, /main path|step/i, /repeat/i]) {
    expect(warningLines.some(line => phrase.test(line)), String(phrase)).toBe(true);
  }
  expect(warningLines.some(line => /held items|no panel/i.test(line)), 'no warning asks for held items').toBe(false);
  // From 0.3 a number that explains a guarantee may show outside LinkedIn (STORY-5): `90 s` on an overview part is no
  // longer a tuning-number warning, and no warning of any kind is left for the overview's size.
  expect(warningLines.some(line => /tuning|90 s/i.test(line)), 'the tuning-number warning is LinkedIn only').toBe(false);
  for (const line of warningLines) expect(line, 'only the depth warnings remain').toMatch(/flat|pipeline|main path|step|repeat/i);
  // Warnings are checked on every channel view and name it.
  expect(warningLines.every(line => /WARN\s+channels\.overview\.views\[0\]/.test(line))).toBe(true);
  expect(await readFile(file, 'utf8')).toBe(bytes);

  // A drawing authored in the drawn shape, then broken field by field in the stored shape.
  const broken = fromLegacy(drawing('Broken review')); const v = broken.channels.overview.views![0];
  broken.facts.components[0].kind = 'database'; broken.facts.components[0].files = ['../escape.ts'];
  broken.facts.components[1].items = []; v.nodes[2].parent = 'missing-group'; v.nodes[2].x = 40;
  v.edges[0].to = 'ghost'; broken.facts.relations![1].style = 'wire';
  const invalid = join(dir, 'invalid.json'); await writeJSON(invalid, broken);
  const before = await readFile(invalid, 'utf8');
  for (const command of ['validate', 'open']) {
    const result = await cli([command, invalid, ...(command === 'open' ? ['--no-browser'] : [])]);
    expect(result.code).toBe(1);
    const errors = `${result.stdout}\n${result.stderr}`;
    for (const path of ['facts.components[0].kind', 'facts.components[0].files', `${OVERVIEW}.nodes[2].parent`, `${OVERVIEW}.edges[0].to`, 'facts.relations[1].style']) expect(errors).toContain(`ERROR ${path}`);
    // A panel that shows no item is reported at the part or at the fact whose items it shows.
    expect(errors).toMatch(new RegExp(`ERROR (facts\\.components\\[1\\]\\.items|${OVERVIEW.replace(/[[\].]/g, '\\$&')}\\.nodes\\[1\\]\\.(form|items))`));
    expect(errors).toMatch(/actor.*client.*api.*service/s); expect(errors).toMatch(/call.*async.*dep/s);
    expect(errors).toMatch(/\d+ error/); expect(await readFile(invalid, 'utf8')).toBe(before);
  }
  const auth = await token(request);
  const registration = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: invalid } });
  expect(registration.status()).toBe(400); expect((await registration.json()).errors.length).toBeGreaterThanOrEqual(6);
  const listed = await (await request.get(`${baseURL()}/api/diagrams`)).json();
  expect(listed.diagrams.some((entry: { path: string }) => entry.path === invalid)).toBe(false);
  // Each lane rule is broken on its own, so an unrelated error cannot mask its acceptance.
  const laneCases: { name: string; break: (d: Doc3) => void }[] = [
    ...[
      ['lane-extra-key', { spine: 0, extra: true }], ['lane-mixed', { spine: 0, anchor: 'api', side: 'above' }],
      ['lane-empty', {}], ['lane-negative', { spine: -1 }], ['lane-fraction', { spine: 0.5 }],
      ['lane-bad-side', { anchor: 'api', side: 'left' }], ['lane-missing-side', { anchor: 'api' }],
      ['lane-missing-anchor', { side: 'above' }], ['lane-dangling-anchor', { anchor: 'ghost', side: 'above' }],
      ['lane-self-anchor', { anchor: 'web', side: 'above' }], ['lane-non-spine-anchor', { anchor: 'db', side: 'below' }],
    ].map(([name, lane]) => ({ name: name as string, break: (d: Doc3) => {
      const nodes = d.channels.overview.views![0].nodes; nodes[1].lane = { spine: 0 }; Object.assign(nodes[0], { lane });
    } })),
    { name: 'lane-duplicate-sibling-order', break: d => {
      const nodes = d.channels.overview.views![0].nodes; nodes[0].lane = { spine: 3 }; nodes[1].lane = { spine: 3 };
    } },
    { name: 'lane-cross-view-anchor', break: d => {
      const other = fromLegacy({ ...drawing('x'), views: [{ id: 'other', title: 'Other', caption: { title: 'Other', lede: '' }, texts: [], edges: [], nodes: [component('remote', { lane: { spine: 0 } })] }] });
      d.facts.components.push(...other.facts.components); d.channels.overview.views!.push(...other.channels.overview.views!);
      d.channels.overview.views![0].nodes[0].lane = { anchor: 'remote', side: 'below' };
    } },
    { name: 'lane-descendant-anchor', break: d => {
      const extra = fromLegacy({ ...drawing('x'), views: [{ id: 'x', title: 'X', caption: { title: 'X', lede: '' }, texts: [], edges: [], nodes: [
        component('zone', { form: 'group', lane: { anchor: 'member', side: 'above' } }), component('member', { parent: 'zone', lane: { spine: 0 } })] }] });
      d.facts.components.push(...extra.facts.components); d.channels.overview.views![0].nodes.push(...extra.channels.overview.views![0].nodes);
    } },
  ];
  for (const input of laneCases) {
    const candidate = fromLegacy(drawing(input.name)); input.break(candidate);
    const path = join(dir, `${input.name}.json`); await writeJSON(path, candidate);
    const original = await readFile(path, 'utf8');
    for (const command of ['validate', 'open']) {
      const result = await cli([command, path, ...(command === 'open' ? ['--no-browser'] : [])]);
      expect(result.code, input.name).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`, input.name).toContain('.lane');
      expect(await readFile(path, 'utf8'), input.name).toBe(original);
    }
    const beforeList = await (await request.get(`${baseURL()}/api/diagrams`)).json();
    for (const [endpoint, data] of [['files', { path }], ['diagrams', candidate]] as const) {
      const response = await request.post(`${baseURL()}/api/${endpoint}`, { headers: { 'X-Archdraw-Token': auth }, data });
      expect(response.status(), `${input.name}: ${endpoint}`).toBe(400);
      expect(JSON.stringify((await response.json()).errors), input.name).toContain('lane');
      expect(await readFile(path, 'utf8'), input.name).toBe(original);
    }
    expect((await (await request.get(`${baseURL()}/api/diagrams`)).json()).diagrams, input.name).toEqual(beforeList.diagrams);
  }
  const malformed = join(dir, 'malformed.json'); await writeFile(malformed, '{ nope');
  expect((await cli(['validate', malformed])).code).toBe(1);
  expect(await readFile(malformed, 'utf8')).toBe('{ nope');
  const missing: Drawing = drawing('Missing code'); missing.views[0].nodes[0].files = ['src/not-present.ts'];
  await writeJSON(join(dir, 'missing.json'), fromLegacy(missing));
  const absent = await cli(['validate', join(dir, 'missing.json')]);
  expect(absent.code).toBe(1); expect(`${absent.stdout}${absent.stderr}`).toContain('facts.components[0].files');
});
