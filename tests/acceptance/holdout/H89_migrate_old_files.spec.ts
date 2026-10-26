import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { legacyWithPost, drawing, repo, workspaceRaw, writeJSON, cli, token, baseURL, factOf, drawn, shop3, withLinkedIn } from './helpers';
// The stored file is format 4 (one choice, `system`): `readDocument`, `getDocument` and `readDrawing` here give that choice in the format 3 shape this
// scenario was written in; `readRaw` and `getRaw` give the stored document itself.
import { readDocument, readDrawing, getDocument, readRaw, getRaw, signature } from './helpers-selections';

const CONVERTED = 'Converted from archdraw/diagram@2';

// `archdrawer migrate` brings an `@1`, `@2` or `@3` file to the current format, prints every conversion warning and then
// `migrated`; a file in the current format is left alone; anything else is refused without a byte written.
test('H89 [FILE-2, START-5, #182] migrate rewrites an @1, an @2 and an @3 file as @4, leaves an @4 file alone and refuses what is not a drawing', async ({ request }) => {
  const folder = await repo('migrate');
  const lines = (stdout: string) => stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  // An `@2` file with a detail view and a post.
  const two = join(folder.dir, 'two.json'); await writeJSON(two, legacyWithPost('Migrating shop'));
  const twoBefore = await readFile(two, 'utf8');
  const migratedTwo = await cli(['migrate', two]); expect(migratedTwo.code, migratedTwo.stderr).toBe(0);
  const twoLines = lines(migratedTwo.stdout);
  expect(twoLines.at(-1)).toBe('migrated');
  expect(twoLines.findIndex(line => line.includes(CONVERTED)), 'the warning comes before "migrated"').toBeGreaterThanOrEqual(0);
  const twoDoc = await readDocument(two), twoRaw = await readRaw(two);
  expect(twoRaw.schema).toBe('archdraw/diagram@4'); expect(twoRaw).not.toHaveProperty('views'); expect(twoRaw.choices.map((c: { id: string }) => c.id)).toEqual(['system']);
  expect(twoDoc.warnings).toEqual([CONVERTED]);
  for (const warning of twoDoc.warnings!) expect(migratedTwo.stdout).toContain(warning);
  expect(twoDoc.channels.overview.views!.map(v => v.id)).toEqual(['overview', 'inside-api']);
  expect(twoDoc.channels.linkedin!.views!.map(v => v.id)).toEqual(['overview-linkedin']);
  expect(twoDoc.facts.components.map(f => f.id)).toEqual(['web', 'api', 'db', 'validator', 'writer']);
  expect((await readDrawing(two)).views[0].nodes.map(n => n.label)).toEqual(['Web app', 'Order API', 'Orders DB']);
  expect(await readFile(two, 'utf8')).not.toBe(twoBefore);
  const valid = await cli(['validate', two]); expect(valid.code, valid.stdout).toBe(0);
  const twoOnce = await readFile(two, 'utf8');
  const twoAgain = await cli(['migrate', two]); expect(twoAgain.code).toBe(0); expect(twoAgain.stdout).toContain('already archdraw/diagram@4');
  expect(await readFile(two, 'utf8')).toBe(twoOnce); // Nothing to convert: not a byte changes.

  // An `@3` file becomes one choice, with nothing lost and no warning of its own: `migrated` is the only line.
  const three = join(folder.dir, 'three.json'); const threeDoc = withLinkedIn(shop3('Three shop'), { outdated: ['db'] }); await writeJSON(three, threeDoc);
  const migratedThree = await cli(['migrate', three]); expect(migratedThree.code, migratedThree.stderr).toBe(0);
  expect(lines(migratedThree.stdout)).toEqual(['migrated']);
  const threeRaw = await readRaw(three);
  expect(threeRaw.schema).toBe('archdraw/diagram@4'); expect(threeRaw.choices).toHaveLength(1); expect(threeRaw.choices[0]).toMatchObject({ id: 'system', kind: 'system', title: 'The whole system' });
  expect(signature(await readDocument(three), false), 'every fact, view, part and connection as it was (the layout a file without places gets apart)').toEqual(signature(threeDoc, false));
  expect(threeRaw.warnings ?? []).toEqual([]);
  const threeOnce = await readFile(three, 'utf8'); expect((await cli(['migrate', three])).stdout).toContain('already archdraw/diagram@4'); expect(await readFile(three, 'utf8')).toBe(threeOnce);

  // An `@1` file goes through `@2` and `@3` and lands as `@4`.
  const one = join(folder.dir, 'one.json');
  await writeJSON(one, { schema: 'archdraw/diagram@1', id: 'd_legacy89', title: 'Legacy shop', subtitle: 'Before facts and channels', theme: 'dark',
    source: null, engine: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'legacy-web', label: 'Old web app', kind: 'ui', tech: 'React', description: 'The original storefront.', files: ['src/web.ts'], x: 80, y: 96 },
      { id: 'legacy-api', label: 'Old API', kind: 'api', tech: '', description: 'Takes the orders.', files: ['src/api.ts'], x: 400, y: 96 },
    ], edges: [], groups: [], notes: [], warnings: [] });
  const oneBefore = await readFile(one, 'utf8');
  const refused = await cli(['validate', one]);
  expect(refused.code).toBe(1); expect(`${refused.stdout}${refused.stderr}`).toContain('ERROR schema: this is archdraw/diagram@1; run "archdrawer migrate');
  expect(await readFile(one, 'utf8')).toBe(oneBefore);
  const migratedOne = await cli(['migrate', one]); expect(migratedOne.code, migratedOne.stderr).toBe(0);
  expect(lines(migratedOne.stdout).at(-1)).toBe('migrated');
  const oneDoc = await readDocument(one);
  expect((await readRaw(one)).schema).toBe('archdraw/diagram@4');
  expect(oneDoc.facts.components.map(f => f.id)).toEqual(['legacy-web', 'legacy-api']);
  expect(factOf(oneDoc, 'legacy-web')).toMatchObject({ label: 'Old web app', kind: 'client', sub: 'React', description: 'The original storefront.', files: ['src/web.ts'] });
  expect(oneDoc.facts.relations ?? []).toEqual([]);
  const overview = drawn(oneDoc);
  expect(overview).toMatchObject({ id: 'overview', title: 'Overview', caption: { title: 'Legacy shop', lede: 'Before facts and channels' } });
  expect(overview.nodes.map(n => [n.id, n.x, n.y])).toEqual([['legacy-web', 80, 96], ['legacy-api', 400, 96]]);
  expect(oneDoc.warnings!.length).toBeGreaterThanOrEqual(1); // `ui` became `client`: a change, so a warning.
  for (const warning of oneDoc.warnings!) expect(migratedOne.stdout).toContain(warning);
  expect(oneDoc.channels.linkedin?.views ?? []).toEqual([]); // An old file had no post: the LinkedIn channel stays empty.
  expect((await cli(['validate', one])).code).toBe(0);
  const oneOnce = await readFile(one, 'utf8');
  const oneAgain = await cli(['migrate', one]); expect(oneAgain.stdout).toContain('already archdraw/diagram@4'); expect(await readFile(one, 'utf8')).toBe(oneOnce);

  // A file already in the current format.
  const current = await workspaceRaw('migrate-current', (await readRaw(two)));
  const currentBytes = await readFile(current.file, 'utf8');
  const noop = await cli(['migrate', current.file]); expect(noop.code).toBe(0); expect(noop.stdout).toContain('already archdraw/diagram@4');
  expect(await readFile(current.file, 'utf8')).toBe(currentBytes);

  // What is not a drawing is refused and left as it is.
  const notJSON = join(folder.dir, 'not-json.json'); await writeFile(notJSON, '{ nope');
  const broken = await cli(['migrate', notJSON]); expect(broken.code).toBe(1); expect(`${broken.stdout}${broken.stderr}`).toContain('ERROR json:');
  expect(await readFile(notJSON, 'utf8')).toBe('{ nope');
  const other = join(folder.dir, 'other.json'); await writeJSON(other, { schema: 'no-such-schema', title: 'Not ours' });
  const otherBefore = await readFile(other, 'utf8');
  const foreign = await cli(['migrate', other]); expect(foreign.code).toBe(1); expect(`${foreign.stdout}${foreign.stderr}`).toContain('ERROR schema: not an archdrawer drawing');
  expect(await readFile(other, 'utf8')).toBe(otherBefore);

  // Importing an `@2` document converts it too: the stored copy is `@4`, the document that was sent is untouched.
  const auth = await token(request);
  const sent = drawing('Imported old shop');
  const imported = await request.post(`${baseURL()}/api/diagrams`, { headers: { 'X-Archdraw-Token': auth }, data: sent });
  expect(imported.status(), await imported.text()).toBe(201);
  const importedId = (await imported.json()).id, stored = await getDocument(request, importedId), storedRaw = await getRaw(request, importedId);
  expect(storedRaw.schema).toBe('archdraw/diagram@4'); expect(stored.facts.components.map(f => f.id)).toEqual(['web', 'api', 'db']);
  expect(stored.warnings).toContain(CONVERTED); expect(storedRaw).not.toHaveProperty('views');
  expect(sent.schema).toBe('archdraw/diagram@2');
  // An `@3` document is imported the same way, as one choice.
  const sentThree = shop3('Imported three');
  const importedThree = await request.post(`${baseURL()}/api/diagrams`, { headers: { 'X-Archdraw-Token': auth }, data: sentThree });
  expect(importedThree.status(), await importedThree.text()).toBe(201);
  const storedThree = await getRaw(request, (await importedThree.json()).id);
  expect(storedThree.schema).toBe('archdraw/diagram@4'); expect(storedThree.choices.map(c => c.id)).toEqual(['system']); expect(sentThree.schema).toBe('archdraw/diagram@3');
});
