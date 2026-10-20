import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, outsideWrite, fact, part, factOf, partOf, viewOf, outdatedOf, sorted } from './helpers';

// An agent session edits the file itself. The same split applies to what it wrote: the facts it changed mark every
// channel whose drawing it did not change in that write, by the same rules as an editor edit.
test('H95 [FILE-3, FILE-1, FILE-2] a session that edits the facts in the file marks the LinkedIn channel it did not redraw, and the editor follows', async ({ page, request }) => {
  const { file } = await workspaceRaw('outside-marks', withLinkedIn(shop3('Session shop')));
  await openDrawing(page, request, file);
  const before = await readDocument(file);
  expect(outdatedOf(before, 'linkedin')).toEqual([]);
  const toast = page.getByTestId('toast');

  // 1. Two names corrected in the facts, no drawing touched. `api` is shown directly by both channels, `db` is named
  //    separately by LinkedIn's `ledger`.
  const first = await readDocument(file);
  factOf(first, 'db')!.label = 'Order store'; factOf(first, 'api')!.label = 'Checkout API'; first.updatedAt = '2098-01-01T00:00:00.000Z';
  await outsideWrite(file, first);
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store', { timeout: 5000 });
  await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('Checkout API'); await expect(toast).toHaveText('Updated from the file');
  await persistedDoc(file, d => outdatedOf(d, 'linkedin').length > 0);
  const afterNames = await readDocument(file);
  expect(outdatedOf(afterNames, 'linkedin')).toEqual(['db']);
  expect(outdatedOf(afterNames, 'overview')).toEqual([]); // the overview shows both names directly
  expect(viewOf(afterNames, 'linkedin')).toEqual(viewOf(before, 'linkedin'));
  expect(partOf(afterNames, 'linkedin', 'ledger')?.label).toBe('Orders ledger');

  // 2. A new component, drawn in the overview by the same write. The overview changed in it, so it is not marked;
  //    LinkedIn did not, so it is.
  const second = await readDocument(file);
  second.facts.components.push(fact('cache', { label: 'Cache', kind: 'data', description: 'Keeps recent orders.' }));
  viewOf(second)!.nodes.push(part('cache', { place: { row: 2, col: 0 } })); second.updatedAt = '2099-01-01T00:00:00.000Z';
  await outsideWrite(file, second);
  await expect(page.getByTestId('node-cache')).toBeVisible({ timeout: 5000 });
  await persistedDoc(file, d => outdatedOf(d, 'linkedin').includes('cache'));
  const afterCache = await readDocument(file);
  expect(sorted(outdatedOf(afterCache, 'linkedin'))).toEqual(['cache', 'db']);
  expect(outdatedOf(afterCache, 'overview')).toEqual([]);
  expect(viewOf(afterCache, 'linkedin')!.nodes.map(n => n.id)).toEqual(['visitor', 'intake', 'ledger']); // not given a part for it

  // 3. The session changes a fact and gives LinkedIn's part its own text for it in the same write: that write changed
  //    the LinkedIn drawing, so the channel is not marked for it.
  const third = await readDocument(file);
  factOf(third, 'api')!.items = ['Validate order', 'Create order', 'Audit']; partOf(third, 'linkedin', 'intake')!.items = ['Check it'];
  third.updatedAt = '2100-01-01T00:00:00.000Z';
  await outsideWrite(file, third);
  await expect(page.getByTestId('node-api').getByTestId('node-item')).toHaveText(['Validate order', 'Create order', 'Audit'], { timeout: 5000 });
  await page.waitForTimeout(1200); // longer than the poll that notices an outside write: a mark for it would be there by now
  const end = await readDocument(file);
  expect(sorted(outdatedOf(end, 'linkedin'))).toEqual(['cache', 'db']);
  expect(partOf(end, 'linkedin', 'intake')?.items).toEqual(['Check it']);
  expect(outdatedOf(end, 'overview')).toEqual([]); expect(outdatedOf(end, 'readme')).toEqual([]); expect(outdatedOf(end, 'presentation')).toEqual([]);
  // The editor never wrote over the session: the file is the session's, plus the marks.
  expect(end.facts.components.map(f => f.id)).toEqual(['web', 'api', 'db', 'cache']);
  expect(factOf(end, 'db')!.label).toBe('Order store');
});
