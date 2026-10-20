import { test, expect, type Page } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, saved, box, callout, canvasClick, emptyCanvasPoint, clickEdge,
  factOf, relationOf, viewOf, partOf, outdatedOf, sorted } from './helpers';

async function connect(page: Page, from: string, to: string) {
  await page.keyboard.press('Escape');
  const source = page.getByTestId(`node-${from}`), target = page.getByTestId(`node-${to}`);
  await source.hover(); await page.getByTestId('tool-connect').click();
  const start = await box(source), end = await box(target);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 }); await page.mouse.up(); await saved(page);
  await page.keyboard.press('Escape');
}

// Adding and deleting in the overview change the facts. The LinkedIn channel is told what it has not taken up (a new
// fact, a relation between two things it shows, a fact it showed that is gone) and is left drawn as it was, except
// that a part of it whose only fact is gone leaves with it.
test('H93 [FILE-3, FILE-2, EDIT-1] adding and deleting a part and a connection in the overview change the facts, and the LinkedIn channel is marked and keeps its drawing', async ({ page, request }) => {
  const { file } = await workspaceRaw('add-delete', withLinkedIn(shop3('Facts shop')));
  await openDrawing(page, request, file);
  const before = await readDocument(file);

  // A new part is a new fact. LinkedIn is told, and is not given a part for it.
  await page.getByTestId('tool-component').click();
  const point = await emptyCanvasPoint(page); await canvasClick(page, point.x, point.y);
  await page.getByTestId('picker-kind-data').click(); await page.getByTestId('picker-add').click();
  await expect(page.getByTestId('node-label-input')).toHaveValue('New component');
  await page.getByTestId('node-label-input').fill('Cache'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page); await persistedDoc(file, d => d.facts.components.some(f => f.label === 'Cache'));
  const added = await readDocument(file);
  expect(factOf(added, 'new-component')).toMatchObject({ label: 'Cache', kind: 'data' });
  expect(partOf(added, 'overview', 'new-component')?.facts).toEqual(['new-component']);
  expect(viewOf(added)!.nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'new-component', 'web']);
  expect(outdatedOf(added, 'linkedin')).toEqual(['new-component']);
  expect(viewOf(added, 'linkedin')!.nodes.map(n => n.id)).toEqual(['visitor', 'intake', 'ledger']); // no part was added for it
  expect(viewOf(added, 'linkedin')).toEqual(viewOf(before, 'linkedin'));

  // A connection from it to a part LinkedIn shows is a new relation, but LinkedIn does not show both ends: no mark for it.
  await connect(page, 'api', 'new-component');
  await persistedDoc(file, d => (d.facts.relations ?? []).length === 3);
  const linked = await readDocument(file);
  expect(relationOf(linked, 'r3')).toMatchObject({ from: 'api', to: 'new-component', label: '', style: 'call', both: false });
  expect(viewOf(linked)!.edges.some(e => (e.relations ?? []).includes('r3'))).toBe(true);
  expect(outdatedOf(linked, 'linkedin')).toEqual(['new-component']);

  // A connection between two parts LinkedIn does show: a relation between two things it draws, so it is listed.
  await connect(page, 'web', 'db');
  await persistedDoc(file, d => (d.facts.relations ?? []).length === 4);
  const joined = await readDocument(file);
  expect(relationOf(joined, 'r4')).toMatchObject({ from: 'web', to: 'db', both: false });
  expect(sorted(outdatedOf(joined, 'linkedin'))).toEqual(['new-component', 'r4']);
  expect(viewOf(joined, 'linkedin')!.edges.map(e => e.id)).toEqual(['visitor-intake', 'intake-ledger']); // LinkedIn draws no such line

  // Deleting that connection in the overview deletes the relation; the mark stays, once.
  const edgeId = viewOf(joined)!.edges.find(e => (e.relations ?? []).includes('r4'))!.id!;
  await page.keyboard.press('Escape'); await clickEdge(page, edgeId); await page.getByTestId('edge-delete').click();
  await saved(page); await persistedDoc(file, d => !relationOf(d, 'r4'));
  const cut = await readDocument(file);
  expect(sorted(outdatedOf(cut, 'linkedin'))).toEqual(['new-component', 'r4']);
  expect((cut.facts.relations ?? []).map(r => r.id)).toEqual(['r1', 'r2', 'r3']);

  // Deleting a part in the overview deletes its fact and its relations; LinkedIn loses the part that showed only that fact.
  await page.keyboard.press('Escape');
  await (await callout(page, 'db')).getByTestId('callout-delete').click();
  await saved(page); await persistedDoc(file, d => !factOf(d, 'db'));
  const gone = await readDocument(file);
  expect(gone.facts.components.map(f => f.id)).toEqual(['web', 'api', 'new-component']);
  expect((gone.facts.relations ?? []).map(r => r.id)).toEqual(['r1', 'r3']);
  expect(viewOf(gone)!.nodes.map(n => n.id).sort()).toEqual(['api', 'new-component', 'web']);
  const overviewEdges = viewOf(gone)!.edges.map(e => e.id);
  expect(overviewEdges).toContain('e1'); expect(overviewEdges).not.toContain('e2');
  expect(viewOf(gone, 'linkedin')!.nodes.map(n => n.id)).toEqual(['visitor', 'intake']);
  expect(viewOf(gone, 'linkedin')!.edges.map(e => e.id)).toEqual(['visitor-intake']);
  const marks = outdatedOf(gone, 'linkedin');
  for (const id of ['db', 'new-component', 'r4']) expect(marks, `${id} is listed`).toContain(id);
  expect(new Set(marks).size).toBe(marks.length);
  for (const id of ['web', 'api', 'r1', 'r3']) expect(marks, `${id} was not what changed`).not.toContain(id);

  // Must not happen: the channel the edits were made in, or a channel with no drawing, marked.
  expect(outdatedOf(gone, 'overview')).toEqual([]); expect(outdatedOf(gone, 'readme')).toEqual([]); expect(outdatedOf(gone, 'presentation')).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('node-db')).toHaveCount(0); await expect(page.getByTestId('node-new-component')).toBeVisible();
  await expect(page.getByTestId('node-api')).toBeVisible();
});
