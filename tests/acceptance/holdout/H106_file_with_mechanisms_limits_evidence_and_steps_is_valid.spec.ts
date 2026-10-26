import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { agent3, withReadme, withPresentation, workspaceRaw, cli, register, baseURL, errorLines, warnLines, outputLines, viewOf, partOf, type Doc3 } from './helpers';
// The stored file is format 4 (one choice, `system`): these give that choice in the format 3 shape the scenario was written in; `wrapAs4` puts a
// changed choice back into a document to save, and `readRaw` is the stored document itself.
import { readDocument, getDocument, wrapAs4, readRaw } from './helpers-selections';

// The 0.3 file format: mechanisms (a fact with `within`), limit facts, evidence, a part's `held` and `limits`, one README
// view and one presentation view with ordered steps. Everything is optional, so the file below is only valid because the
// new rules accept it; nothing it holds may be dropped on the way through the command, the server or a save.
test('H106 [FILE-2, READ-2, STORY-3, STORY-4, STORY-5, #182] a file with mechanisms, limits, evidence, held rows, a README view and a presentation with steps is valid, opens unchanged and saves through the server', async ({ request }) => {
  const doc = withPresentation(withReadme(agent3('Agent shop')), { steps: [
    { id: 's1', parts: ['app'], text: 'A request starts at the app', note: 'The app only asks.\nIt never decides.' },
    { id: 's2', parts: ['agent', 'store'], text: 'The agent keeps its state', note: '' },
  ] });
  // Evidence in a file is checked for its path only: lines past the end of a short file are accepted as written.
  doc.facts.components[4].evidence = [{ file: 'src/db.ts', lines: [40, 48] }, { file: 'src/extra.ts', lines: null }];
  const { file } = await workspaceRaw('format-ok', doc);
  const written = await readFile(file, 'utf8');

  const checked = await cli(['validate', file]);
  expect(checked.code, checked.stdout + checked.stderr).toBe(0);
  expect(errorLines(checked)).toEqual([]); expect(outputLines(checked).some(line => /^valid( with \d+ warning)?/.test(line))).toBe(true);
  expect(await readFile(file, 'utf8'), 'validate writes nothing').toBe(written);
  // The README and the presentation each hold their one view; the warnings, if any, name a channel view and are only warnings.
  for (const line of warnLines(checked)) expect(line).toMatch(/^WARN\s+choices\[0\]\.channels\.(overview|readme|presentation)\.views\[0\]/);

  const opened = await cli(['open', file, '--no-browser']); expect(opened.code, opened.stderr).toBe(0);
  const stored = await readDocument(file);
  expect((await readRaw(file)).schema, 'opened, the file is format 4').toBe('archdraw/diagram@4');
  // Nothing the file said is lost by normalising it.
  expect(stored.facts.components.map(f => [f.id, f.within ?? null])).toEqual([['app', null], ['agent', null], ['model-call', 'agent'], ['tool-check', 'agent'], ['store', null]]);
  expect(stored.facts.components[4].evidence).toEqual(doc.facts.components[4].evidence);
  expect(stored.facts.components[3]).toMatchObject({ kind: 'gate', within: 'agent', evidence: [{ file: 'src/extra.ts', lines: [1, 1] }] });
  expect(stored.facts.limits).toEqual(doc.facts.limits);
  expect(stored.facts.relations![0].evidence).toEqual([{ file: 'src/web.ts', lines: [1, 1] }]);
  expect(partOf(stored, 'overview', 'agent')).toMatchObject({ form: 'panel', held: ['model-call', 'tool-check'], limits: ['turn-limit'] });
  expect(viewOf(stored, 'readme')).toMatchObject({ id: 'readme', title: 'README' });
  expect(partOf(stored, 'readme', 'agent')).toMatchObject({ held: ['model-call', 'tool-check'], limits: ['turn-limit'] });
  expect(stored.channels.presentation!.steps).toEqual(doc.channels.presentation!.steps);
  // A part with no stored position is placed: the README and presentation parts are laid out like any other.
  for (const channel of ['overview', 'readme', 'presentation'] as const)
    for (const p of viewOf(stored, channel)!.nodes) expect([typeof p.x, typeof p.y], `${channel}/${p.id}`).toEqual(['number', 'number']);
  const settled = await readFile(file, 'utf8');
  expect((await cli(['open', file, '--no-browser'])).code).toBe(0);
  expect(await readFile(file, 'utf8'), 'a second open changes nothing').toBe(settled);

  // The server registers it, serves it whole, and saves an edit to a step without touching anything else.
  const registered = await register(request, file), served = await getDocument(request, registered.id);
  expect(served.channels.presentation!.steps).toEqual(stored.channels.presentation!.steps); expect(served.facts).toEqual(stored.facts);
  const edited = structuredClone(served); edited.channels.presentation!.steps![0].text = 'Start at the app';
  const saved = await request.put(`${baseURL()}/api/diagrams/${registered.id}`, { headers: { 'X-Archdraw-Token': registered.token }, data: wrapAs4(edited) });
  expect(saved.status(), await saved.text()).toBe(200); expect((await saved.json()).ok).toBe(true);
  const after = await readDocument(file);
  expect(after.channels.presentation!.steps![0]).toMatchObject({ id: 's1', text: 'Start at the app', note: 'The app only asks.\nIt never decides.' });
  expect(after.channels.presentation!.steps![1]).toEqual(stored.channels.presentation!.steps![1]);
  expect(after.facts).toEqual(stored.facts); expect(after.channels.readme).toEqual(stored.channels.readme);

  // Must not happen: a refused save changing the file. A step that names a part the presentation does not draw is refused.
  const bad: Doc3 = structuredClone(after); bad.channels.presentation!.steps![1].parts = ['ghost'];
  const before = await readFile(file, 'utf8');
  const refused = await request.put(`${baseURL()}/api/diagrams/${registered.id}`, { headers: { 'X-Archdraw-Token': registered.token }, data: wrapAs4(bad) });
  expect(refused.status()).toBe(400); expect((await refused.json()).error).toMatch(/^Invalid diagram/);
  expect(await readFile(file, 'utf8')).toBe(before);
});
