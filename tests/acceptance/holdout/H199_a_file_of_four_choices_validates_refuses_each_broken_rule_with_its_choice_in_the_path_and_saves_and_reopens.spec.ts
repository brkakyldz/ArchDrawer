import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repo, writeJSON, cli, outputLines, errorLines, warnLines, token, baseURL, openDrawing, saved } from './helpers';
import { fourChoices, workspace4, readRaw, getRaw, panelStructure, FOUR_PANEL_STRUCTURE, SCHEMA4, persistedRaw, where, type Doc4, type Choice4 } from './helpers-selections';

const more = (doc: Doc4, n: number) => {
  const model = doc.choices.find(c => c.id === 'howto')!;
  for (let i = 0; i < n; i++) {
    const copy = structuredClone(model) as Choice4; copy.id = `more${i}`; copy.title = `More ${i}`; copy.channels.overview.views![0].id = `more${i}-overview`; doc.choices.push(copy);
  }
  return doc;
};
// What a file of choices is, reduced to ids: the choices, their views, parts and connections in order.
const shape = (doc: Doc4) => doc.choices.map(c => ({ id: c.id, kind: c.kind, title: c.title, about: c.about ?? '',
  facts: c.facts.components.map(f => [f.id, f.label]), views: Object.entries(c.channels).flatMap(([name, ch]) => (ch?.views ?? []).map(v => [name, v.id, v.title, v.nodes.map(n => n.id), v.edges.map(e => e.id ?? `${e.from}>${e.to}`)])) }));

// Each case breaks one rule of the drawing contract on its own; the pattern is what `archdrawer validate` prints and what the server's
// refusal carries. A violation's path starts at its choice (`choices[2].channels.overview.views[0].nodes[0].detail`).
const cases: { name: string; pattern: RegExp; break: (d: Doc4) => void }[] = [
  { name: 'two-choices-share-an-id', pattern: /^ERROR choices\[\d\]\.id/m, break: d => { d.choices[1].id = d.choices[0].id; } },
  { name: 'two-system-choices', pattern: /^ERROR choices(\[\d\](\.kind)?)?[.:]/m, break: d => { d.choices.find(c => c.id === 'server')!.kind = 'system'; } },
  { name: 'choice-kind-unknown', pattern: /^ERROR choices\[\d\]\.kind/m, break: d => { d.choices[0].kind = 'story' as never; } },
  { name: 'choice-title-too-long', pattern: /^ERROR choices\[\d\]\.title/m, break: d => { d.choices[1].title = 'x'.repeat(81); } },
  { name: 'choice-title-empty', pattern: /^ERROR choices\[\d\]\.title/m, break: d => { d.choices[1].title = '  '; } },
  { name: 'choice-about-too-long', pattern: /^ERROR choices\[\d\]\.about/m, break: d => { d.choices[1].about = 'x'.repeat(301); } },
  { name: 'choice-with-another-key', pattern: /^ERROR choices\[0\]/m, break: d => { (d.choices[0] as unknown as Record<string, unknown>).extra = 1; } },
  { name: 'thirteen-choices', pattern: /^ERROR choices/m, break: d => { more(d, 9); } },
  { name: 'view-id-in-two-choices', pattern: /^ERROR choices\[\d\]\.channels\.(overview|linkedin)\.views\[\d\]\.id/m, break: d => { d.choices.find(c => c.id === 'server')!.channels.overview.views![0].id = 'checkout-overview'; } },
  { name: 'detail-names-a-view-of-another-choice', pattern: /^ERROR choices\[2\]\.channels\.overview\.views\[0\]\.nodes\[0\]\.detail/m, break: d => { d.choices[2].channels.overview.views![0].nodes[0].detail = 'checkout-charge'; } },
  { name: 'a-fact-no-view-of-its-choice-draws', pattern: /^ERROR (choices\[3\]\.facts\.components\[6\]|choices\[3\]\.channels\.overview)/m,
    break: d => { const sys = d.choices[3]; sys.channels.overview.views = sys.channels.overview.views!.filter(v => v.id !== 'appendix'); } },
  { name: 'request-names-no-choice', pattern: /^ERROR requests\[0\]\.(choice|channel|view)/m, break: d => { d.requests = [{ id: 'q1', text: 'Add a cache', choice: 'nope', channel: 'overview', view: 'overview', at: '2026-10-13T12:00:00.000Z' }]; } },
  { name: 'request-names-a-view-of-another-choice', pattern: /^ERROR requests\[0\]\.(choice|channel|view)/m, break: d => { d.requests = [{ id: 'q1', text: 'Add a cache', choice: 'server', channel: 'overview', view: 'checkout-overview', at: '2026-10-13T12:00:00.000Z' }]; } },
  { name: 'relation-names-a-fact-of-another-choice', pattern: /^ERROR choices\[2\]\.facts\.relations\[0\]/m, break: d => { d.choices[2].facts.relations![0].to = 'gateway'; } },
  { name: 'schema-not-this-format', pattern: /^ERROR schema/m, break: d => { d.schema = 'archdraw/diagram@9'; } },
];

test('H199 [FILE-2 START-5 FILE-1 NAV-2 #182 #185 #200] a file of four choices validates, opens, imports, saves and reopens; each broken rule is refused with its choice in the path; twelve choices are valid and thirteen are not; a fact in a detail view is drawn', async ({ page, request }) => {
  test.setTimeout(60_000);
  const folder = await repo('f4-rules'); const auth = await token(request);
  const everyLine = (result: { stdout: string; stderr: string }) => outputLines(result);

  // A good file: valid, opens, registers, and the server keeps its choices as they are (layout apart).
  const fine = join(folder.dir, 'fine.json'); await writeJSON(fine, fourChoices());
  const accepted = await cli(['validate', fine]); expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0); expect(errorLines(accepted)).toEqual([]);
  expect(everyLine(accepted).filter(Boolean).at(-1)).toMatch(/^valid( with \d+ warning\(s\))?$/);
  const wanted = shape(fourChoices());
  const registered = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: fine } });
  expect(registered.status(), await registered.text()).toBe(200);
  const served = await getRaw(request, (await registered.json()).id);
  expect(served.schema).toBe(SCHEMA4); expect(shape(served)).toEqual(wanted); expect(shape(await readRaw(fine))).toEqual(wanted);
  const importedOne = await request.post(`${baseURL()}/api/diagrams`, { headers: { 'X-Archdraw-Token': auth }, data: fourChoices('Imported four') });
  expect(importedOne.status(), await importedOne.text()).toBe(201);
  expect(shape(await getRaw(request, (await importedOne.json()).id))).toEqual(shape(fourChoices('Imported four')));
  // Twelve choices are the most a file holds; a fact shown only in a detail view is drawn, so rule 16 is met by the channel's views together.
  const twelve = join(folder.dir, 'twelve.json'); await writeJSON(twelve, more(fourChoices(), 8));
  const ok12 = await cli(['validate', twelve]); expect(ok12.code, ok12.stdout + ok12.stderr).toBe(0);
  const moved = fourChoices(); const sys = moved.choices[3];
  sys.channels.overview.views = sys.channels.overview.views!.filter(v => v.id !== 'appendix'); sys.channels.overview.views!.find(v => v.id === 'orders-inside')!.nodes.push({ id: 'notes', facts: ['notes'], form: 'card', icon: null, parent: null, detail: null, place: { row: 1, col: 1 } });
  const detailFile = join(folder.dir, 'detail.json'); await writeJSON(detailFile, moved);
  const inDetail = await cli(['validate', detailFile]); expect(inDetail.code, inDetail.stdout + inDetail.stderr).toBe(0);

  // Each broken rule on its own: validate and open refuse it with its pattern and a count, print no warning and write nothing; the server refuses the same lines.
  for (const rule of cases) {
    const candidate = fourChoices(); rule.break(candidate);
    const path = join(folder.dir, `${rule.name}.json`); await writeJSON(path, candidate);
    const original = await readFile(path, 'utf8');
    for (const command of rule.name === 'two-choices-share-an-id' || rule.name === 'a-fact-no-view-of-its-choice-draws' ? ['validate', 'open'] : ['validate']) {
      const result = await cli([command, path, ...(command === 'open' ? ['--no-browser'] : [])]);
      const lines = everyLine(result);
      expect(result.code, `${rule.name}: ${command}`).toBe(1);
      expect(lines.join('\n'), `${rule.name}: ${command}`).toMatch(rule.pattern);
      expect(warnLines(result), `${rule.name}: an invalid file prints no warnings`).toEqual([]);
      const errors = lines.filter(line => /^ERROR /.test(line));
      expect(lines.filter(line => line === `${errors.length} error(s)`), `${rule.name}: the count line`).toHaveLength(1);
      expect(await readFile(path, 'utf8'), `${rule.name}: ${command} writes nothing`).toBe(original);
    }
    const response = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path } });
    expect(response.status(), rule.name).toBe(400);
    const lines = ((await response.json()).errors as string[]).join('\n');
    expect(lines, rule.name).toMatch(new RegExp(rule.pattern.source.replace(/^\^ERROR /, '^'), 'm'));
    expect(await readFile(path, 'utf8'), rule.name).toBe(original);
  }
  // Several broken rules in one file: every violation is listed, each at its own choice.
  const many = fourChoices(); many.choices[0].facts.components[0].kind = 'database'; many.choices[2].facts.components[1].files = ['../escape.ts']; many.choices[3].channels.linkedin!.outdated = ['db', 'db'];
  const manyPath = join(folder.dir, 'many.json'); await writeJSON(manyPath, many);
  const everything = await cli(['validate', manyPath]); expect(everything.code).toBe(1);
  const listed = errorLines(everything);
  for (const path of ['choices[0].facts.components[0].kind', 'choices[2].facts.components[1].files', 'choices[3].channels.linkedin.outdated']) expect(listed.some(line => line.startsWith(`ERROR ${path}`)), path).toBe(true);
  expect(everyLine(everything)).toContain(`${listed.length} error(s)`);

  // The editor: the file opens on its first choice, saves an edit into the right choice and reopens as it was.
  const editorFile = join(folder.dir, 'editor.json'); await writeJSON(editorFile, fourChoices('Editor four'));
  const opened = await openDrawing(page, request, editorFile);
  expect(await where(page)).toMatchObject({ choice: 'checkout', channel: 'overview', view: 'checkout-overview' });
  expect(await panelStructure(page)).toEqual(FOUR_PANEL_STRUCTURE);
  await page.getByTestId('node-cart').getByTestId('node-label').dblclick(); await page.getByTestId('node-label-input').fill('Basket'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await persistedRaw(editorFile, d => d.choices?.find((c: Choice4) => c.id === 'checkout')?.facts?.components?.find((f: { id: string }) => f.id === 'cart')?.label === 'Basket');
  const stored = await readRaw(editorFile) as Doc4;
  expect(stored.schema).toBe(SCHEMA4); expect(stored.choices.map(c => c.id)).toEqual(['checkout', 'howto', 'server', 'system']);
  await page.reload(); await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('node-cart').getByTestId('node-label')).toHaveText('Basket');
  await page.goto(`/d/${opened.id}?choice=server&channel=linkedin`);
  expect(await where(page)).toEqual({ choice: 'server', channel: 'linkedin', view: 'server-linkedin' });
  await expect(page.getByTestId('node-entry')).toBeVisible();
  expect(shape(await getRaw(request, opened.id)).map(c => c.id)).toEqual(['checkout', 'howto', 'server', 'system']);

  // The library imports a format 4 file and refuses a broken one with the server's message.
  await page.goto('/'); await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('import-input').setInputFiles(fine);
  await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'checkout');
  await expect(page.getByTestId('views-panel')).toBeVisible();
  await page.goto('/'); await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('import-input').setInputFiles(join(folder.dir, 'two-choices-share-an-id.json'));
  await expect(page.getByTestId('form-error')).toContainText('choices'); await expect(page.getByTestId('editor')).toHaveCount(0);
});
