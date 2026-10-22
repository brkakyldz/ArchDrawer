import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, workspace, writeJSON, cli, openDrawing, register, baseURL } from './helpers';
import { readRaw, readDrawing } from './helpers-selections'; // a file the server wrote is format 4: `readRaw` is the stored document, `readDrawing` its first choice drawn

test('H27 [START-5, FILE-1, FILE-2, #182] migrate an old drawing, import both versions and forget them without deleting repository files', async ({ page, request }) => {
  const { dir, file } = await workspace('library', drawing('Library source'));
  const first = await openDrawing(page, request, file); const normal = await readRaw(file);
  // This legacy example uses only fields named in the v2 migration contract.
  const legacy = { schema: 'archdraw/diagram@1', id: 'd_legacy27', title: 'Legacy shop', subtitle: 'Before the editor upgrade', theme: 'light',
    source: null, engine: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [{ id: 'legacy-web', label: 'Old web app', kind: 'ui', tech: 'React', description: 'The original storefront.', files: ['src/web.ts'], x: 80, y: 96 }],
    edges: [], groups: [], notes: [], warnings: [] };
  const legacyFile = join(dir, 'legacy.json'); const legacyImport = join(dir, 'legacy-import.json');
  await writeJSON(legacyFile, legacy); await writeJSON(legacyImport, legacy);
  const before = await readFile(legacyFile, 'utf8'); const refused = await cli(['validate', legacyFile]);
  expect(refused.code).toBe(1); expect(`${refused.stdout}${refused.stderr}`).toContain('archdraw/diagram@1'); expect(`${refused.stdout}${refused.stderr}`).toMatch(/migrate/);
  expect(await readFile(legacyFile, 'utf8')).toBe(before);
  const migration = await cli(['migrate', legacyFile]); expect(migration.code, migration.stderr).toBe(0); expect(migration.stdout).toMatch(/migrated/);
  // An `@1` file converts through `@2` and `@3` and lands as `@4`, one choice: the old kind `ui` is now `client`, which is a change and is reported.
  const migratedDoc = await readRaw(legacyFile); expect(migratedDoc.schema).toBe('archdraw/diagram@4'); expect(migratedDoc.choices.map((c: { id: string; kind: string }) => [c.id, c.kind])).toEqual([['system', 'system']]);
  const migrated = await readDrawing(legacyFile); expect(migrated.views).toHaveLength(1);
  expect(migrated.views[0]).toMatchObject({ id: 'overview', title: 'Overview', caption: { title: 'Legacy shop', lede: 'Before the editor upgrade' } });
  expect(migrated.views[0].nodes[0]).toMatchObject({ id: 'legacy-web', label: 'Old web app', kind: 'client', form: 'card', sub: 'React', description: 'The original storefront.', files: ['src/web.ts'], x: 80, y: 96 });
  expect(migratedDoc.choices[0].facts.components.map((f: { id: string }) => f.id)).toEqual(['legacy-web']);
  expect(migrated.warnings!.length).toBeGreaterThanOrEqual(1);
  for (const warning of migrated.warnings!) expect(migration.stdout).toContain(warning);
  expect((await cli(['validate', legacyFile])).code).toBe(0);
  const once = await readFile(legacyFile, 'utf8'); const already = await cli(['migrate', legacyFile]); expect(already.code).toBe(0); expect(already.stdout).toContain('already archdraw/diagram@4'); expect(await readFile(legacyFile, 'utf8')).toBe(once);
  // A second registered file cannot steal the first file's document id.
  const duplicateFile = join(dir, 'second.json'); normal.title = 'Second repository drawing'; await writeJSON(duplicateFile, normal);
  const second = await register(request, duplicateFile); expect(second.id).not.toBe(first.id); expect((await readDrawing(duplicateFile)).id).toBe(second.id);
  expect((await readDrawing(file)).id).toBe(first.id);
  await page.goto('/'); await expect(page.getByTestId('library')).toBeVisible();
  const ownRow = page.getByTestId('library-item').filter({ has: page.getByTestId('library-item-title').filter({ hasText: 'Library source' }) });
  await expect(ownRow).toHaveAttribute('data-diagram-id', first.id); await expect(ownRow.getByTestId('library-item-path')).toHaveText(file);
  await ownRow.getByTestId('library-open').click(); await expect(page.getByTestId('repo-name')).toHaveText('Library source'); await page.goto('/');
  await page.getByTestId('import-input').setInputFiles(legacyImport); await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('node-legacy-web')).toHaveAttribute('data-kind', 'client'); await expect(page.getByTestId('warnings')).toBeVisible();
  const importedV1 = new URL(page.url()).pathname.split('/').at(-1)!; expect(importedV1).not.toBe(first.id);
  expect(await readFile(legacyImport, 'utf8')).toBe(before); // Import must not migrate the user's source file in place.
  await page.goto('/'); await page.getByTestId('import-input').setInputFiles(file); await expect(page.getByTestId('editor')).toBeVisible();
  const importedV2 = new URL(page.url()).pathname.split('/').at(-1)!; expect(importedV2).not.toBe(first.id);
  const list = (await (await request.get(`${baseURL()}/api/diagrams`)).json()).diagrams as { id: string; updatedAt: string; path: string | null }[];
  expect(list.map(row => row.updatedAt)).toEqual(list.map(row => row.updatedAt).sort((a, b) => b.localeCompare(a)));
  expect(list.find(row => row.id === importedV1)?.path).toBeNull(); expect(list.find(row => row.id === importedV2)?.path).toBeNull();
  await page.goto('/'); const rows = page.getByTestId('library-item');
  await expect(rows).toHaveCount(list.length);
  const uiIDs = await rows.evaluateAll(els => els.map(el => el.getAttribute('data-diagram-id')!));
  expect(uiIDs.slice().sort()).toEqual(list.map(row => row.id).sort());
  const uiDates = uiIDs.map(id => list.find(row => row.id === id)!.updatedAt);
  expect(uiDates).toEqual(uiDates.slice().sort((a, b) => b.localeCompare(a))); // Equal timestamps have no contracted tie-breaker.
  const invalidFile = join(dir, 'bad-import.json'); await writeJSON(invalidFile, { schema: 'no-such-schema' });
  const count = await rows.count(); await page.getByTestId('import-input').setInputFiles(invalidFile); await expect(page.getByTestId('form-error')).toBeVisible(); await expect(rows).toHaveCount(count);
  for (const id of [first.id, importedV1, importedV2]) {
    const row = page.locator(`[data-testid="library-item"][data-diagram-id="${id}"]`);
    if (id !== first.id) await expect(row.getByTestId('library-item-path')).toHaveText('Imported');
    await row.getByTestId('library-menu').click();
    await expect(page.getByTestId('library-menu-list')).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await page.getByTestId('library-menu-list').getByTestId('library-forget').click(); await expect(row).toHaveCount(0);
    expect((await request.get(`${baseURL()}/api/diagrams/${id}`)).status()).toBe(404);
  }
  expect((await readDrawing(file)).id).toBe(first.id); expect((await readDrawing(duplicateFile)).id).toBe(second.id);
  await page.goto(`/d/${importedV1}`); await expect(page.getByTestId('not-found')).toBeVisible();
  await expect(page.getByTestId('not-found').locator('a[href="/"]')).toBeVisible();
});
