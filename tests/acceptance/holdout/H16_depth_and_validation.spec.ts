import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, fromLegacy, repo, writeJSON, cli, token, baseURL, type Doc3 } from './helpers';

// The depth warnings are H134's (and the tuning number H114's), the broken fields and a missing repository path H90's: what is left
// here is the lane rules, each refused on its own by the command line and the server, and a file that is not JSON.
test('H16 [START-5, FILE-1, FILE-2, #182] every broken lane rule is refused by validate, open and the server, and a file that is not JSON by validate, without a write', async ({ request }) => {
  const { dir } = await repo('depth');
  const auth = await token(request);
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
    // A refused registration or import is not listed.
    expect((await (await request.get(`${baseURL()}/api/diagrams`)).json()).diagrams, input.name).toEqual(beforeList.diagrams);
  }
  const malformed = join(dir, 'malformed.json'); await writeFile(malformed, '{ nope');
  expect((await cli(['validate', malformed])).code).toBe(1);
  expect(await readFile(malformed, 'utf8')).toBe('{ nope');
});
