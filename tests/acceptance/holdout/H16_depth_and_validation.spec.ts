import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, writeJSON, cli, token, baseURL, type Drawing } from './helpers';

test('H16 [START-5, FILE-1] depth warnings permit a drawing but every broken field is reported without repair', async ({ request }) => {
  const doc = drawing('Depth review');
  doc.views[0].nodes = Array.from({ length: 6 }, (_, i) => component(`part-${i}`, { place: { row: 0, col: i }, sub: i === 0 ? '90 s' : '' }));
  doc.views[0].edges = Array.from({ length: 5 }, (_, i) => ({ id: `flow-${i}`, from: `part-${i}`, to: `part-${i + 1}`, label: 'process', style: 'call', both: false, step: null }));
  const { dir, file } = await workspace('depth', doc);
  const bytes = await readFile(file, 'utf8'); const valid = await cli(['validate', file]);
  expect(valid.code).toBe(0); expect(valid.stdout).toMatch(/valid with \d+ warning/);
  const warningLines = valid.stdout.split(/\r?\n/).filter(line => /^WARN\s+/.test(line));
  expect(warningLines.length).toBeGreaterThanOrEqual(5);
  for (const phrase of [/flat|pipeline/i, /held items|panel/i, /tuning|90 s/i, /main path|step/i, /repeat/i]) {
    expect(warningLines.some(line => phrase.test(line)), String(phrase)).toBe(true);
  }
  expect(warningLines.every(line => /WARN\s+views\[0\]/.test(line))).toBe(true);
  expect(await readFile(file, 'utf8')).toBe(bytes);

  const broken = drawing('Broken review'); const v = broken.views[0];
  v.nodes[0].kind = 'database'; v.nodes[0].files = ['../escape.ts'];
  v.nodes[1].items = []; v.nodes[2].parent = 'missing-group'; v.nodes[2].x = 40;
  v.edges[0].to = 'ghost'; v.edges[1].style = 'wire';
  const invalid = join(dir, 'invalid.json'); await writeJSON(invalid, broken);
  const before = await readFile(invalid, 'utf8');
  for (const command of ['validate', 'open']) {
    const result = await cli([command, invalid, ...(command === 'open' ? ['--no-browser'] : [])]);
    expect(result.code).toBe(1);
    const errors = `${result.stdout}\n${result.stderr}`;
    for (const path of ['views[0].nodes[0].kind', 'views[0].nodes[0].files', 'views[0].nodes[1].items', 'views[0].nodes[2].parent', 'views[0].edges[0].to', 'views[0].edges[1].style']) expect(errors).toContain(`ERROR ${path}`);
    expect(errors).toMatch(/actor.*client.*api.*service/s); expect(errors).toMatch(/call.*async.*dep/s);
    expect(errors).toMatch(/\d+ error/); expect(await readFile(invalid, 'utf8')).toBe(before);
  }
  const auth = await token(request);
  const registration = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: invalid } });
  expect(registration.status()).toBe(400); expect((await registration.json()).errors.length).toBeGreaterThanOrEqual(6);
  const listed = await (await request.get(`${baseURL()}/api/diagrams`)).json();
  expect(listed.diagrams.some((entry: { path: string }) => entry.path === invalid)).toBe(false);
  // Each new relation is invalid on its own, so an unrelated error cannot mask its acceptance.
  const relationCases: { name: string; field: string; break: (d: Drawing) => void }[] = [
    ...[
      ['lane-extra-key', { spine: 0, extra: true }], ['lane-mixed', { spine: 0, anchor: 'api', side: 'above' }],
      ['lane-empty', {}], ['lane-negative', { spine: -1 }], ['lane-fraction', { spine: 0.5 }],
      ['lane-bad-side', { anchor: 'api', side: 'left' }], ['lane-missing-side', { anchor: 'api' }],
      ['lane-missing-anchor', { side: 'above' }], ['lane-dangling-anchor', { anchor: 'ghost', side: 'above' }],
      ['lane-self-anchor', { anchor: 'web', side: 'above' }], ['lane-non-spine-anchor', { anchor: 'db', side: 'below' }],
    ].map(([name, lane]) => ({ name: name as string, field: 'lane', break: (d: Drawing) => {
      d.views[0].nodes[1].lane = { spine: 0 }; Object.assign(d.views[0].nodes[0], { lane });
    } })),
    { name: 'lane-duplicate-sibling-order', field: 'lane', break: d => {
      d.views[0].nodes[0].lane = { spine: 3 }; d.views[0].nodes[1].lane = { spine: 3 };
    } },
    { name: 'lane-cross-view-anchor', field: 'lane', break: d => {
      d.views.push({ id: 'other', title: 'Other', caption: { title: 'Other', lede: '' }, texts: [], edges: [], nodes: [component('remote', { lane: { spine: 0 } })] });
      d.views[0].nodes[0].lane = { anchor: 'remote', side: 'below' };
    } },
    { name: 'lane-descendant-anchor', field: 'lane', break: d => {
      d.views[0].nodes.push(component('zone', { form: 'group', lane: { anchor: 'member', side: 'above' } }),
        component('member', { parent: 'zone', lane: { spine: 0 } }));
    } },
    ...[
      ['from-duplicate', ['original', 'original']], ['from-bad-id', ['bad id']],
      ['from-non-array', 'original'], ['from-non-string', [42]],
    ].map(([name, from]) => ({ name: name as string, field: 'from', break: (d: Drawing) => Object.assign(d.views[0].nodes[0], { from }) })),
  ];
  for (const input of relationCases) {
    const candidate = drawing(input.name); input.break(candidate);
    const path = join(dir, `${input.name}.json`); await writeJSON(path, candidate);
    const original = await readFile(path, 'utf8');
    for (const command of ['validate', 'open']) {
      const result = await cli([command, path, ...(command === 'open' ? ['--no-browser'] : [])]);
      expect(result.code, input.name).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`, input.name).toContain(input.field);
      expect(await readFile(path, 'utf8'), input.name).toBe(original);
    }
    const beforeList = await (await request.get(`${baseURL()}/api/diagrams`)).json();
    for (const [endpoint, data] of [['files', { path }], ['diagrams', candidate]] as const) {
      const response = await request.post(`${baseURL()}/api/${endpoint}`, { headers: { 'X-Archdraw-Token': auth }, data });
      expect(response.status(), `${input.name}: ${endpoint}`).toBe(400);
      expect(JSON.stringify((await response.json()).errors), input.name).toContain(input.field);
      expect(await readFile(path, 'utf8'), input.name).toBe(original);
    }
    expect((await (await request.get(`${baseURL()}/api/diagrams`)).json()).diagrams, input.name).toEqual(beforeList.diagrams);
  }
  const malformed = join(dir, 'malformed.json'); await writeFile(malformed, '{ nope');
  expect((await cli(['validate', malformed])).code).toBe(1);
  expect(await readFile(malformed, 'utf8')).toBe('{ nope');
  const missing = drawing('Missing code'); missing.views[0].nodes[0].files = ['src/not-present.ts'];
  await writeJSON(join(dir, 'missing.json'), missing);
  const absent = await cli(['validate', join(dir, 'missing.json')]);
  expect(absent.code).toBe(1); expect(`${absent.stdout}${absent.stderr}`).toContain('views[0].nodes[0].files');
});
