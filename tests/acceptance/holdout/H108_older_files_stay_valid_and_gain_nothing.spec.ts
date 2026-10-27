import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withDetail, withLinkedIn, legacyWithPost, workspaceRaw, openDrawing, cli, readDocument, readStoredRaw, persistedDoc, saved, factOf, outdatedOf,
  errorLines, outputLines, channelNames, type Doc3 } from './helpers';

const CONVERTED = 'Converted from archdraw/diagram@2';

// Every field 0.3 added is optional. A file written before it has none of them, stays valid, and nothing in opening it,
// converting it or editing it in the editor writes one into it.
function gainedNothing(doc: Doc3, where: string) {
  for (const f of doc.facts.components) {
    expect(f.within ?? null, `${where}: ${f.id} is no mechanism`).toBeNull(); expect(f.evidence ?? [], `${where}: ${f.id} has no evidence`).toEqual([]);
  }
  for (const r of doc.facts.relations ?? []) expect(r.evidence ?? [], `${where}: ${r.id} has no evidence`).toEqual([]);
  expect(doc.facts.limits ?? [], `${where}: no limit facts`).toEqual([]);
  for (const channel of channelNames) {
    for (const v of doc.channels[channel]?.views ?? []) for (const p of v.nodes) {
      expect(p.held ?? [], `${where}: ${channel}/${p.id} holds nothing`).toEqual([]); expect(p.limits ?? [], `${where}: ${channel}/${p.id} shows no limit`).toEqual([]);
    }
  }
  expect(doc.channels.presentation?.steps ?? [], `${where}: no steps`).toEqual([]);
  expect(doc.channels.readme?.views ?? [], `${where}: no README drawn`).toEqual([]); expect(doc.channels.presentation?.views ?? [], `${where}: no presentation drawn`).toEqual([]);
}
const core = (doc: Doc3) => doc.facts.components.map(({ id, label, kind, sub, description, files, items }) => ({ id, label, kind, sub, description, files, items }));

test('H108 [FILE-1, FILE-2, FILE-3, LOOK-3] a drawing written before 0.3 stays valid, opens and converts without gaining a mechanism, limit, evidence or step, and an edit in the editor adds none', async ({ page, request }) => {
  // A 0.2 file: facts, a detail view, a LinkedIn channel, and README and presentation written as empty channels.
  const old = withLinkedIn(withDetail(shop3('Old shop')), { outdated: ['db'] });
  old.channels.readme = {}; old.channels.presentation = {};
  const { file } = await workspaceRaw('older-v3', old);
  const written = await readFile(file, 'utf8');
  const checked = await cli(['validate', file]); expect(checked.code, checked.stdout + checked.stderr).toBe(0);
  expect(errorLines(checked)).toEqual([]); expect(await readFile(file, 'utf8')).toBe(written);

  const opened = await cli(['open', file, '--no-browser']); expect(opened.code, opened.stderr).toBe(0);
  const stored = await readDocument(file); // the first choice, `system`, in the shape the file had
  expect((await readStoredRaw(file)).schema, 'opened, the file is written back as format 4').toBe('archdraw/diagram@4');
  gainedNothing(stored, 'opened');
  expect(core(stored)).toEqual(core(old)); // every fact as written
  expect(stored.facts.relations!.map(r => [r.id, r.from, r.to, r.label, r.style, r.both])).toEqual(old.facts.relations!.map(r => [r.id, r.from, r.to, r.label, r.style, r.both]));
  expect(stored.channels.overview.views!.map(v => [v.id, v.nodes.map(n => [n.id, n.facts, n.form, n.detail])]))
    .toEqual(old.channels.overview.views!.map(v => [v.id, v.nodes.map(n => [n.id, n.facts, n.form, n.detail])]));
  expect(stored.channels.linkedin!.views![0].nodes.map(n => [n.id, n.facts, n.label ?? null])).toEqual(old.channels.linkedin!.views![0].nodes.map(n => [n.id, n.facts, n.label ?? null]));
  expect(outdatedOf(stored, 'linkedin')).toEqual(['db']); expect(stored.warnings ?? []).toEqual([]);
  const settled = await readFile(file, 'utf8');
  expect((await cli(['open', file, '--no-browser'])).code).toBe(0);
  expect(await readFile(file, 'utf8'), 'a second open changes nothing').toBe(settled);

  // An `@2` file is converted exactly as before: one warning, no mechanism, no limit, no step.
  const legacy = await workspaceRaw('older-v2', legacyWithPost('Older shop'));
  const legacyBytes = await readFile(legacy.file, 'utf8');
  const legacyChecked = await cli(['validate', legacy.file]); expect(legacyChecked.code, legacyChecked.stderr).toBe(0);
  expect(outputLines(legacyChecked).some(line => line.includes(CONVERTED))).toBe(true); expect(await readFile(legacy.file, 'utf8')).toBe(legacyBytes);
  expect((await cli(['open', legacy.file, '--no-browser'])).code).toBe(0);
  const converted = await readDocument(legacy.file);
  expect((await readStoredRaw(legacy.file)).schema).toBe('archdraw/diagram@4'); expect(converted.warnings).toEqual([CONVERTED]); gainedNothing(converted, 'converted');
  expect(converted.channels.linkedin!.views!.map(v => v.id)).toEqual(['overview-linkedin']);

  // The editor opens the 0.2 file as it always did, except that no part draws rows any more (LOOK-3): the items stay on the fact and are
  // listed in the callout; an edit stays an edit of the old shape.
  await openDrawing(page, request, file);
  for (const id of ['web', 'api', 'db']) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await expect(page.getByTestId('node-api').getByTestId('node-item')).toHaveCount(0); // no part draws a row; the items are in the callout, and no mechanism or limit appears
  await expect(page.getByTestId('node-web').getByTestId('node-item')).toHaveCount(0);
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(page.getByTestId('node-ledger').getByTestId('node-label')).toHaveText('Orders ledger');
  await page.getByTestId('channel-tab-overview').click();
  await page.getByTestId('node-api').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Checkout API'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page); await persistedDoc(file, d => factOf(d, 'api')?.label === 'Checkout API');
  const edited = await readDocument(file);
  gainedNothing(edited, 'edited'); expect(factOf(edited, 'api')!.items).toEqual(['Validate order', 'Create order']);
  expect(outdatedOf(edited, 'linkedin')).toEqual(['db']); // `intake` shows the fact directly: the rename adds no mark
  // Must not happen: the rename also touching a fact it was not made on.
  expect(factOf(edited, 'web')).toEqual(factOf(stored, 'web')); expect(factOf(edited, 'db')).toEqual(factOf(stored, 'db'));
});
