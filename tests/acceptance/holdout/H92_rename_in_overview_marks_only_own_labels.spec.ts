import { test, expect, type Page } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, saved, exportOf, svgInfo, factOf, partOf, viewOf,
  outdatedOf, channelNames, getDocument } from './helpers';

async function renameLabel(page: Page, id: string, text: string) {
  await page.keyboard.press('Escape');
  await page.getByTestId(`node-${id}`).getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill(text); await page.getByTestId('node-label-input').press('Enter');
  await page.keyboard.press('Escape'); await saved(page);
}
async function renameSub(page: Page, id: string, text: string) {
  await page.keyboard.press('Escape');
  await page.getByTestId(`node-${id}`).getByTestId('node-sub').dblclick();
  await page.getByTestId('node-sub-input').fill(text); await page.getByTestId('node-sub-input').press('Enter');
  await page.keyboard.press('Escape'); await saved(page);
}

// A rename in the overview corrects the fact. A LinkedIn part that shows that fact directly shows the new name at once and
// needs nothing; a LinkedIn part that gave itself a shorter name keeps it and is marked as needing an update.
test('H92 [FILE-3, FILE-2, EDIT-1] a rename in the overview shows through the fact in a LinkedIn part with no mark, and marks the LinkedIn channel where a part keeps its own name', async ({ page, request }) => {
  const { file } = await workspaceRaw('rename-marks', withLinkedIn(shop3('Rename shop')));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  expect(outdatedOf(before, 'linkedin')).toEqual([]);
  const textOf = async (query: string) => (await svgInfo(page, await (await exportOf(request, opened.id, 'svg', query)).text())).text.join(' | ');

  // `api` is shown by the LinkedIn part `intake` without a name of its own.
  await renameLabel(page, 'api', 'Checkout API');
  await persistedDoc(file, d => factOf(d, 'api')?.label === 'Checkout API');
  const afterApi = await readDocument(file);
  expect(partOf(afterApi, 'overview', 'api')?.label ?? null).toBeNull(); // In the overview every field edits the fact.
  expect(outdatedOf(afterApi, 'linkedin'), 'a change the channel shows directly adds nothing').toEqual([]);
  const linkedinAfterApi = await textOf('channel=linkedin&format=feed');
  expect(linkedinAfterApi).toContain('Checkout API'); expect(linkedinAfterApi).not.toContain('Order API');
  expect(await textOf('channel=overview&format=readme')).toContain('Checkout API');

  // `db` is shown by `ledger`, which keeps its own name "Orders ledger".
  await renameLabel(page, 'db', 'Order store');
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Order store');
  const afterDb = await readDocument(file);
  expect(partOf(afterDb, 'overview', 'db')?.label ?? null).toBeNull();
  expect(outdatedOf(afterDb, 'linkedin')).toEqual(['db']);
  expect(partOf(afterDb, 'linkedin', 'ledger')?.label).toBe('Orders ledger'); // Not overwritten by the fact's new name.
  const linkedinAfterDb = await textOf('channel=linkedin&format=feed');
  expect(linkedinAfterDb).toContain('Orders ledger'); expect(linkedinAfterDb).not.toContain('Order store');
  expect(await textOf('channel=overview&format=readme')).toContain('Order store');

  // A second change to the same fact does not list it twice; a sub-line `visitor` shows directly adds nothing.
  await renameLabel(page, 'db', 'Order vault');
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Order vault');
  await renameSub(page, 'web', 'Next.js');
  await persistedDoc(file, d => factOf(d, 'web')?.sub === 'Next.js');
  const end = await getDocument(request, opened.id);
  expect(outdatedOf(end, 'linkedin')).toEqual(['db']);
  expect(factOf(end, 'web')?.sub).toBe('Next.js'); expect(partOf(end, 'linkedin', 'visitor')?.sub ?? null).toBeNull();
  expect(await textOf('channel=linkedin&format=feed')).toContain('Next.js');

  // Must not happen: the channel the edit was made in marked, an empty channel marked, or the LinkedIn drawing touched.
  expect(outdatedOf(end, 'overview')).toEqual([]);
  for (const channel of channelNames.filter(c => c === 'readme' || c === 'presentation')) expect(outdatedOf(end, channel)).toEqual([]);
  expect(viewOf(end, 'linkedin')).toEqual(viewOf(before, 'linkedin'));
  expect(end.facts.relations).toEqual(before.facts.relations); expect(end.facts.components.map(f => f.id)).toEqual(['web', 'api', 'db']);
  // Reloading shows the corrected names and keeps the one mark.
  await page.reload(); await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('Checkout API');
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order vault');
  expect(outdatedOf(await readDocument(file), 'linkedin')).toEqual(['db']);
});
