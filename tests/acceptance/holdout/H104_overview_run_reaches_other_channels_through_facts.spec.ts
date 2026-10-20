import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, startKind, finishRun, exportOf, svgInfo, factOf, relationOf, partOf, viewOf, outdatedOf, sorted } from './helpers';

const empty = { added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] };

// A run on the overview is split like an edit made there: what it changes in the facts shows in every channel that draws it
// directly and marks the channels that keep their own text; the channel the run was made in is never marked.
test('H104 [AI-1, FILE-3, FILE-2] a fixture refine in the overview corrects the facts, reaches a LinkedIn part through the fact and marks only the part that keeps its own name', async ({ page, request }) => {
  const { file } = await workspaceRaw('runs-marks', withLinkedIn(shop3('Runs shop')));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  const run = async (instruction: string) => await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, channel: 'overview', view: 'overview', kind: 'refine', instruction, engine: 'fixture', model: null, scope: { kind: 'view' } }), 'succeeded');
  const linkedinText = async () => (await svgInfo(page, await (await exportOf(request, opened.id, 'svg', 'channel=linkedin&format=feed')).text())).text.join(' | ');

  // `api` is shown by LinkedIn's `intake` directly: the new name is there at once and nothing is marked.
  const renamed = await run('rename Order API to Checkout API');
  expect(renamed).toMatchObject({ kind: 'refine', channel: 'overview', view: 'overview', status: 'succeeded' });
  expect(renamed.changes).toEqual({ ...empty, changed: ['api'] });
  const afterApi = await readDocument(file);
  expect(factOf(afterApi, 'api')!.label).toBe('Checkout API'); expect(partOf(afterApi, 'overview', 'api')?.label ?? null).toBeNull(); // the fact was corrected
  expect(outdatedOf(afterApi, 'linkedin')).toEqual([]);
  expect(await linkedinText()).toContain('Checkout API');
  expect(viewOf(afterApi, 'linkedin')).toEqual(viewOf(before, 'linkedin'));

  // `db` is shown by `ledger` under its own name: it keeps it, and the channel is told the fact moved on.
  const second = await run('rename Orders DB to Order store');
  expect(second.changes).toEqual({ ...empty, changed: ['db'] });
  const afterDb = await readDocument(file);
  expect(factOf(afterDb, 'db')!.label).toBe('Order store'); expect(partOf(afterDb, 'linkedin', 'ledger')?.label).toBe('Orders ledger');
  expect(outdatedOf(afterDb, 'linkedin')).toEqual(['db']);
  const text = await linkedinText(); expect(text).toContain('Orders ledger'); expect(text).not.toContain('Order store');

  // A new component is a new fact: drawn in the overview, listed for LinkedIn, which is not given a part for it.
  const added = await run('add Cache component');
  expect(added.changes).toMatchObject({ added: ['cache'], removed: [], changed: [], moved: [] }); expect(added.changes.edgesAdded).toHaveLength(1);
  const afterAdd = await readDocument(file);
  expect(factOf(afterAdd, 'cache')).toMatchObject({ label: 'Cache', kind: 'service', description: 'Added by the fixture engine.' });
  expect(partOf(afterAdd, 'overview', 'cache')?.facts).toEqual(['cache']);
  const link = (afterAdd.facts.relations ?? []).find(r => r.to === 'cache')!;
  expect(link).toMatchObject({ from: 'web', label: '', style: 'call', both: false });
  expect(sorted(outdatedOf(afterAdd, 'linkedin'))).toEqual(['cache', 'db']);
  expect(viewOf(afterAdd, 'linkedin')!.nodes.map(n => n.id)).toEqual(['visitor', 'intake', 'ledger']);
  expect(relationOf(afterAdd, 'r1')).toEqual(relationOf(before, 'r1'));

  // Must not happen: the channel the runs were made in marked, an empty channel marked, or the LinkedIn drawing touched.
  expect(outdatedOf(afterAdd, 'overview')).toEqual([]); expect(outdatedOf(afterAdd, 'readme')).toEqual([]); expect(outdatedOf(afterAdd, 'presentation')).toEqual([]);
  expect(viewOf(afterAdd, 'linkedin')).toEqual(viewOf(before, 'linkedin'));
  expect(afterAdd.engine).toMatchObject({ id: 'fixture' });
  // The editor shows what the runs wrote.
  await page.reload();
  await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('Checkout API');
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store'); await expect(page.getByTestId('node-cache')).toBeVisible();
  await persistedDoc(file, d => sorted(outdatedOf(d, 'linkedin')).join() === 'cache,db');
});
