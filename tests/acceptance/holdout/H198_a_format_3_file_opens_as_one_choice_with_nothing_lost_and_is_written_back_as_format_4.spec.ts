import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shop3, withDetail, withLinkedIn, withReadme, workspaceRaw, cli, outputLines, warnLines, errorLines, token, baseURL, exportOf, openDrawing, saved, factOf, type Doc3 } from './helpers';
import { signature, stampPositions, flat3, readRaw, getRaw, wrapAs4, workspace4, panelStructure, SCHEMA4, persistedRaw, type Doc4 } from './helpers-selections';

// FILE-2, START-5 (diagram contract, *Reading `archdraw/diagram@3`*, ADR 0015): a format 3 file becomes one choice, `system`, with
// every fact, view, view id, part, connection, text, step, own text, mark and request as it was; the conversion adds no warning;
// the server, `migrate`, `validate` and `svg` all read it, and written back it is format 4 which draws exactly what the format 3 drew.
function oldShop(): Doc3 {
  const doc = withReadme(withLinkedIn(withDetail(shop3('Old shop')), { outdated: ['db'] }));
  doc.theme = 'dark'; doc.channels.overview.showSteps = true;
  doc.channels.overview.views![0].texts = [{ id: 't1', text: 'Start here', x: 40, y: -120, size: 16 }];
  doc.requests = [{ id: 'q1', text: 'Add a cache', channel: 'overview', view: 'overview', at: '2026-10-13T12:00:00.000Z' }];
  doc.warnings = ['Kept from an earlier session'];
  return stampPositions(doc);
}
// The server normalises every file it reads (diagram contract, *Normalisation*): a missing channel gets its defaults. That is the one
// thing allowed to differ in its copy; `migrate` is not in that list, so its copy is compared exactly.
const EMPTY_CHANNEL = { showSteps: false, outdated: [] as string[], steps: [] as unknown[], views: [] as unknown[] };
function normalised(sig: ReturnType<typeof signature>, doc: Doc3) {
  const channels: Record<string, unknown> = { ...sig.channels };
  for (const name of ['overview', 'linkedin', 'readme', 'presentation']) if (!(name in doc.channels)) channels[name] = EMPTY_CHANNEL;
  return { ...sig, channels };
}
const IMAGES: { name: string; args: string[] }[] = [
  { name: 'overview', args: ['--channel', 'overview', '--format', 'readme'] }, { name: 'inside', args: ['--channel', 'overview', '--view', 'inside-api', '--format', 'readme'] },
  { name: 'linkedin', args: ['--channel', 'linkedin', '--format', 'feed'] }, { name: 'readme', args: ['--channel', 'readme', '--format', 'readme'] },
];

test('H198 [FILE-2 START-5 NAV-2 #182] a format 3 file opens as one choice with every fact, view, request and mark as it was and no new warning, is written back as format 4 by migrate and by the server, draws exactly the same images, and an invalid one is not converted', async ({ page, request }) => {
  test.setTimeout(240_000);
  const old = oldShop(), before = signature(old);
  const made = await workspaceRaw('f3-to-f4', old); const bytes = await readFile(made.file, 'utf8');

  // The command line reads it as it is and writes nothing; the conversion adds no warning.
  const checked = await cli(['validate', made.file]);
  expect(checked.code, checked.stdout + checked.stderr).toBe(0); expect(errorLines(checked)).toEqual([]);
  expect(warnLines(checked).filter(line => /Converted|diagram@3/i.test(line)), 'no warning for the conversion').toEqual([]);
  expect(outputLines(checked).filter(Boolean).at(-1)).toMatch(/^valid( with \d+ warning\(s\))?$/);
  expect(await readFile(made.file, 'utf8'), 'validate writes nothing').toBe(bytes);
  expect(JSON.parse(bytes).schema).toBe('archdraw/diagram@3');

  // The images the format 3 file draws, written by the command next to it.
  const image = async (file: string, tag: string, name: string, args: string[]) => {
    const out = join(made.dir, `${tag}-${name}.svg`); const result = await cli(['svg', file, ...args, '--out', out]);
    expect(result.code, `${tag} ${name}: ${result.stdout}${result.stderr}`).toBe(0); return await readFile(out, 'utf8');
  };
  const drawnBefore: Record<string, string> = {};
  for (const i of IMAGES) drawnBefore[i.name] = await image(made.file, 'before', i.name, i.args);
  expect(JSON.parse(await readFile(made.file, 'utf8')).schema, 'drawing an image does not convert the file').toBe('archdraw/diagram@3');

  // migrate: no warning, `migrated`, and one choice that holds everything.
  const migrated = await cli(['migrate', made.file]);
  expect(migrated.code, migrated.stdout + migrated.stderr).toBe(0); expect(outputLines(migrated).map(l => l.trim()).filter(Boolean)).toEqual(['migrated']);
  const raw = await readRaw(made.file) as Doc4;
  expect(raw.schema).toBe(SCHEMA4); expect(raw).not.toHaveProperty('facts'); expect(raw).not.toHaveProperty('channels');
  expect(raw.choices).toHaveLength(1);
  expect(raw.choices[0]).toMatchObject({ id: 'system', title: 'The whole system', kind: 'system', about: '' });
  expect(signature(flat3(raw)), 'every fact, view, part, connection, text, mark and step as it was').toEqual(before);
  expect(raw).toMatchObject({ title: 'Old shop', theme: 'dark' });
  expect(raw.requests, 'a request names the choice').toEqual([{ ...old.requests![0], choice: 'system' }]);
  expect(raw.warnings, 'nothing is added to the warnings').toEqual(['Kept from an earlier session']);
  expect(factOf(flat3(raw), 'db')).toMatchObject({ label: 'Orders DB', kind: 'data' });
  // Read back it draws what the format 3 file drew, in every image.
  for (const i of IMAGES) expect(await image(made.file, 'after', i.name, i.args), `${i.name}: the same image`).toBe(drawnBefore[i.name]);
  const again = await cli(['migrate', made.file]); const migratedBytes = await readFile(made.file, 'utf8');
  expect(again.code).toBe(0); expect(outputLines(again).join('\n')).toContain('already archdraw/diagram@4');
  expect((await cli(['migrate', made.file])).code).toBe(0); expect(await readFile(made.file, 'utf8')).toBe(migratedBytes);

  // The server converts a format 3 file it registers, writes it back as format 4 and serves the same document.
  const second = await workspaceRaw('f3-to-f4-server', old);
  const auth = await token(request);
  const registered = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: second.file } });
  expect(registered.status(), await registered.text()).toBe(200);
  const { id } = await registered.json() as { id: string };
  const stored = await readRaw(second.file) as Doc4;
  expect(stored.schema).toBe(SCHEMA4); expect(stored.choices.map(c => [c.id, c.kind, c.title])).toEqual([['system', 'system', 'The whole system']]);
  expect(signature(flat3(stored)), "only the normalisation the contract names is added").toEqual(normalised(before, old));
  const served = await getRaw(request, id); expect(served.schema).toBe(SCHEMA4); expect(signature(flat3(served))).toEqual(normalised(before, old));
  expect(served.requests).toEqual([{ ...old.requests![0], choice: 'system' }]); expect(served.warnings).toEqual(['Kept from an earlier session']);
  // The image the server makes of it is the one the command made of the format 3 file.
  const http = await exportOf(request, id, 'svg', 'channel=readme&format=readme');
  expect(http.status()).toBe(200); expect(await http.text()).toBe(drawnBefore.readme);
  const mermaid = await exportOf(request, id, 'mmd', 'channel=overview'); expect(mermaid.status()).toBe(200); expect(await mermaid.text()).toMatch(/^flowchart LR/);

  // The same content written by hand as format 4 is the same drawing again.
  const hand = await workspace4('f3-to-f4-hand', wrapAs4(old));
  expect(hand.dir).not.toBe(second.dir);
  expect(await image(hand.file, 'hand', 'readme', IMAGES[3].args)).toBe(drawnBefore.readme);
  expect(await image(hand.file, 'hand', 'inside', IMAGES[1].args)).toBe(drawnBefore.inside);

  // Imported as a document, it is stored as format 4 too.
  const imported = await request.post(`${baseURL()}/api/diagrams`, { headers: { 'X-Archdraw-Token': auth }, data: old });
  expect(imported.status(), await imported.text()).toBe(201);
  const importedDoc = await getRaw(request, (await imported.json()).id); expect(importedDoc.schema).toBe(SCHEMA4); expect(importedDoc.choices).toHaveLength(1);
  expect(signature(flat3(importedDoc))).toEqual(normalised(before, old));

  // In the editor: one choice, the first view of its overview, and the views panel because that overview holds two views.
  const inEditor = await workspaceRaw('f3-to-f4-editor', old);
  await openDrawing(page, request, inEditor.file);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'system'); await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('views-panel')).toBeVisible();
  expect(await panelStructure(page)).toEqual(['choice:system', 'entry:overview', 'entry:inside-api']);
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Web app');
  await page.getByTestId('node-web').getByTestId('node-label').dblclick(); await page.getByTestId('node-label-input').fill('Storefront'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await persistedRaw(inEditor.file, d => d.choices?.[0]?.facts?.components?.find((f: { id: string }) => f.id === 'web')?.label === 'Storefront');
  const edited = await readRaw(inEditor.file) as Doc4; expect(edited.schema).toBe(SCHEMA4); expect(edited.choices).toHaveLength(1);

  // A file that is invalid as format 3 is invalid and is not converted: the path starts at its choice and nothing is written.
  const broken = oldShop(); broken.facts.components[0].kind = 'database';
  const bad = await workspaceRaw('f3-invalid', broken); const badBytes = await readFile(bad.file, 'utf8');
  for (const command of [['validate', bad.file], ['open', bad.file, '--no-browser'], ['migrate', bad.file]]) {
    const result = await cli(command);
    if (command[0] !== 'migrate') {
      expect(result.code, command[0]).toBe(1);
      expect(outputLines(result).join('\n'), command[0]).toMatch(/^ERROR choices\[0\]\.facts\.components\[0\]\.kind: /m);
    }
    expect(await readFile(bad.file, 'utf8'), `${command[0]} converts nothing`).toBe(badBytes);
  }
  const refused = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: bad.file } });
  expect(refused.status()).toBe(400); expect(((await refused.json()).errors as string[])[0]).toMatch(/^choices\[0\]\.facts\.components\[0\]\.kind: /);
  expect(await readFile(bad.file, 'utf8')).toBe(badBytes);
});
