import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { channelNames, legacyWithPost, workspaceRaw, cli, readDocument, readDrawing, openDrawing, persisted, persistedDoc, getDocument,
  saved, drawn, partOf, factOf, relationOf, ownText, outdatedOf } from './helpers';

const CONVERTED = 'Converted from archdraw/diagram@2';

// An `archdraw/diagram@2` file (a view per post, `postOf`, `from`, one list of views) is converted when read:
// the command line and the editor see the same facts, the post becomes the LinkedIn channel, every id is kept.
test('H88 [FILE-2, START-5, FILE-1] an @2 file with a detail view and a LinkedIn post opens through the command and the editor and is read back as @3 with its ids kept', async ({ page, request }) => {
  const viaCommand = await workspaceRaw('convert-cli', legacyWithPost('Old shop'));
  const bytes = await readFile(viaCommand.file, 'utf8');
  expect(JSON.parse(bytes).schema).toBe('archdraw/diagram@2');

  // `validate` converts in memory, says so with a warning, and writes nothing.
  const checked = await cli(['validate', viaCommand.file]);
  expect(checked.code, checked.stderr).toBe(0);
  const warningLine = checked.stdout.split(/\r?\n/).find(line => line.includes(CONVERTED));
  expect(warningLine, 'the conversion is reported').toBeTruthy(); expect(warningLine).toMatch(/^WARN\s/);
  expect(await readFile(viaCommand.file, 'utf8')).toBe(bytes);

  // `open` writes it back as `@3`.
  const opened = await cli(['open', viaCommand.file, '--no-browser']); expect(opened.code, opened.stderr).toBe(0);
  const doc = await readDocument(viaCommand.file);
  expect(doc.schema).toBe('archdraw/diagram@3'); expect(doc.id).toMatch(/^d_[a-z0-9]{6,}$/);
  expect(doc).not.toHaveProperty('views'); expect(JSON.stringify(doc)).not.toContain('postOf');
  expect(doc.warnings).toEqual([CONVERTED]); expect(doc.requests).toEqual([]);
  for (const channel of channelNames) expect(outdatedOf(doc, channel), `${channel} starts with nothing to update`).toEqual([]);

  // Facts: every component of the non-post views, in file order; one relation per connection, with the connection's id.
  expect(doc.facts.components.map(f => f.id)).toEqual(['web', 'api', 'db', 'validator', 'writer']);
  expect(factOf(doc, 'api')).toMatchObject({ label: 'Order API', kind: 'api', sub: '', description: 'Handles api.', files: ['src/api.ts'], items: ['Validate order', 'Create order'] });
  expect(factOf(doc, 'web')).toMatchObject({ label: 'Web app', kind: 'client', sub: 'React' });
  expect((doc.facts.relations ?? []).map(r => r.id)).toEqual(['e1', 'e2', 'detail-edge']);
  expect(relationOf(doc, 'e1')).toMatchObject({ from: 'web', to: 'api', label: 'POST /orders', style: 'call', both: true });
  expect(relationOf(doc, 'e2')).toMatchObject({ from: 'api', to: 'db', label: '', style: 'async', both: false });
  expect(relationOf(doc, 'detail-edge')).toMatchObject({ from: 'validator', to: 'writer', label: 'valid' });

  // The overview channel: the two views that were not a post, each part pointing at its own fact, no own text.
  const overview = doc.channels.overview.views!;
  expect(overview.map(v => v.id)).toEqual(['overview', 'inside-api']);
  expect(overview[0]).toMatchObject({ title: 'Overview', caption: { title: 'How Old shop works', lede: 'A request becomes a stored order.' } });
  for (const view of overview) for (const p of view.nodes) {
    expect(p.facts, `${view.id}/${p.id}`).toEqual([p.id]);
    expect(ownText(p), `${view.id}/${p.id} takes its text from the fact`).toEqual({ label: null, kind: null, sub: null, description: null, items: null });
  }
  expect(partOf(doc, 'overview', 'api')).toMatchObject({ form: 'panel', detail: 'inside-api', place: { row: 0, col: 1 } });
  expect(overview[0].edges.map(e => [e.id, e.relations, e.step])).toEqual([['e1', ['e1'], 1], ['e2', ['e2'], 2]]);

  // The post is the LinkedIn channel's one view: same view id, same part ids, parts pointing at the facts their `from` named.
  const linkedin = doc.channels.linkedin!;
  expect(linkedin.views).toHaveLength(1);
  const post = linkedin.views![0];
  expect(post).toMatchObject({ id: 'overview-linkedin', title: 'LinkedIn', caption: { title: 'An order in three steps', lede: 'Someone orders and the shop keeps it.' } });
  expect(post.nodes.map(n => n.id)).toEqual(['web-linkedin', 'api-linkedin', 'db-linkedin']);
  expect(post.nodes.map(n => n.facts)).toEqual([['web'], ['api'], ['db']]);
  expect(post.nodes.every(n => n.detail === null)).toBe(true);
  expect(post.edges.map(e => e.relations)).toEqual([['e1'], ['e2']]);
  const drawnPost = drawn(doc, 'linkedin');
  expect(drawnPost.nodes.map(n => n.label)).toEqual(['Shop front', 'Order API', 'Orders DB']); // what the post said, drawn
  expect(drawnPost.nodes[0].sub).toBe('start here'); expect(drawnPost.nodes.find(n => n.id === 'api-linkedin')!.items).toEqual(['Validate order']);
  expect(drawnPost.edges.map(e => [e.from, e.to, e.label, e.style, e.both, e.step])).toEqual([
    ['web-linkedin', 'api-linkedin', 'POST /orders', 'call', true, 1], ['api-linkedin', 'db-linkedin', '', 'async', false, 2]]);
  // Must not happen: a shorter name or list in the post correcting the fact it points to.
  expect(factOf(doc, 'web')).toMatchObject({ label: 'Web app', sub: 'React' }); expect(factOf(doc, 'api')!.items).toEqual(['Validate order', 'Create order']);
  // The post is not also a view of the overview.
  expect(overview.some(v => v.id === 'overview-linkedin')).toBe(false);

  // A second `open` finds nothing to convert and writes nothing.
  const written = await readFile(viaCommand.file, 'utf8');
  expect((await cli(['open', viaCommand.file, '--no-browser'])).code).toBe(0);
  expect(await readFile(viaCommand.file, 'utf8')).toBe(written);

  // The editor reads the same file the same way, and writes `@3` back.
  const viaEditor = await workspaceRaw('convert-editor', legacyWithPost('Old shop'));
  const registered = await openDrawing(page, request, viaEditor.file);
  await expect(page.getByTestId('repo-name')).toHaveText('Old shop');
  for (const id of ['web', 'api', 'db']) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await expect(page.getByTestId('node-web-linkedin')).toHaveCount(0); // The editor shows the overview; the post is another channel.
  await page.getByTestId('views-button').click();
  await expect(page.getByTestId('view-item-overview')).toBeVisible(); await expect(page.getByTestId('view-item-inside-api')).toBeVisible();
  await expect(page.getByTestId('view-item-overview-linkedin')).toHaveCount(0);
  await page.getByTestId('view-item-overview').click();
  await expect(page.getByTestId('warnings')).toBeVisible(); await expect(page.getByTestId('warnings')).toContainText(CONVERTED);
  const served = await getDocument(request, registered.id);
  expect(served.schema).toBe('archdraw/diagram@3'); expect(served.facts).toEqual(doc.facts); // Both routes convert to the same facts.
  expect((await readDocument(viaEditor.file)).schema).toBe('archdraw/diagram@3');
  expect(served.channels.linkedin!.views!.map(v => v.id)).toEqual(['overview-linkedin']);

  await page.getByTestId('warnings-dismiss').click();
  await persistedDoc(viaEditor.file, d => (d.warnings ?? []).length === 0);
  await page.reload(); await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('warnings')).toHaveCount(0);

  // An edit in the editor is stored as `@3`; the post's parts and ids stay as they were.
  const postBefore = (await readDocument(viaEditor.file)).channels.linkedin!.views;
  await page.getByTestId('node-web').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Storefront'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page); await persisted(viaEditor.file, d => d.views[0].nodes.find(n => n.id === 'web')?.label === 'Storefront');
  const edited = await readDocument(viaEditor.file);
  expect(edited.schema).toBe('archdraw/diagram@3'); expect(edited).not.toHaveProperty('views');
  expect(edited.channels.linkedin!.views).toEqual(postBefore);
  expect((await readDrawing(viaEditor.file)).post!.nodes.map(n => n.id)).toEqual(['web-linkedin', 'api-linkedin', 'db-linkedin']);
});
