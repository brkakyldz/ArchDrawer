import { test, expect, type Page } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, saved, callout, exportOf, svgInfo, factOf, partOf, viewOf, outdatedOf, channelNames, type Doc3 } from './helpers';

async function rename(page: Page, id: string, text: string) {
  await page.keyboard.press('Escape');
  await page.getByTestId(`node-${id}`).getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill(text); await page.getByTestId('node-label-input').press('Enter');
  await page.keyboard.press('Escape'); await saved(page);
}
const nothingToUpdate = (doc: Doc3) => { for (const channel of channelNames) expect(outdatedOf(doc, channel), `${channel} has nothing to update`).toEqual([]); };

// In the LinkedIn channel a name is that channel's own shorter name, content (description, kind, files, items) is still the
// fact's, and deleting a part only leaves it out of this channel.
test('H101 [FILE-3, EDIT-1, NAV-2] a rename in the LinkedIn channel becomes that channel own name and leaves the overview alone, a description edit corrects the fact, and deleting a part there keeps the fact', async ({ page, request }) => {
  const { file } = await workspaceRaw('li-edit', withLinkedIn(shop3('Channel edit shop')));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  const editor = page.getByTestId('editor');
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(editor).toHaveAttribute('data-channel', 'linkedin'); await expect(page.getByTestId('node-intake')).toBeVisible();
  const overviewText = async () => (await svgInfo(page, await (await exportOf(request, opened.id, 'svg')).text())).text.join(' | ');

  // `intake` shows its fact's name; renaming it gives that part a name of its own and leaves the fact alone.
  await rename(page, 'intake', 'Intake');
  await persistedDoc(file, d => partOf(d, 'linkedin', 'intake')?.label === 'Intake');
  const renamed = await readDocument(file);
  expect(factOf(renamed, 'api')!.label).toBe('Order API'); expect(partOf(renamed, 'overview', 'api')?.label ?? null).toBeNull();
  expect(viewOf(renamed, 'overview')).toEqual(viewOf(before, 'overview'));
  nothingToUpdate(renamed); // an own name is not a change to the facts
  expect(await overviewText()).toContain('Order API'); expect(await overviewText()).not.toContain('Intake');
  // Back to the fact's own name: the part has no name of its own again.
  await rename(page, 'intake', 'Order API');
  await persistedDoc(file, d => (partOf(d, 'linkedin', 'intake')?.label ?? null) === null);
  // `ledger` already has its own name; a new one replaces it, the fact `db` keeps its.
  await rename(page, 'ledger', 'Ledger');
  await persistedDoc(file, d => partOf(d, 'linkedin', 'ledger')?.label === 'Ledger');
  const names = await readDocument(file);
  expect(factOf(names, 'db')!.label).toBe('Orders DB'); expect(viewOf(names, 'overview')).toEqual(viewOf(before, 'overview')); nothingToUpdate(names);

  // A description is content: edited from here it corrects the fact, and the overview, which shows it directly, needs nothing.
  await page.keyboard.press('Escape');
  const detail = await callout(page, 'visitor');
  await detail.getByTestId('callout-description').dblclick();
  await page.getByTestId('callout-description-input').fill('The storefront customers use.');
  await page.getByTestId('callout-description-input').press('ControlOrMeta+Enter'); await saved(page);
  await persistedDoc(file, d => factOf(d, 'web')?.description === 'The storefront customers use.');
  const described = await readDocument(file);
  expect(partOf(described, 'linkedin', 'visitor')?.description ?? null).toBeNull(); expect(partOf(described, 'overview', 'web')?.description ?? null).toBeNull();
  nothingToUpdate(described);
  await page.keyboard.press('Escape');
  await page.getByTestId('channel-tab-overview').click(); await expect(editor).toHaveAttribute('data-channel', 'overview');
  await page.getByTestId('node-web').getByTestId('node-label').click();
  await expect(page.getByTestId('callout-web').getByTestId('callout-description')).toHaveText('The storefront customers use.');
  await page.keyboard.press('Escape');
  await page.getByTestId('channel-tab-linkedin').click(); await expect(page.getByTestId('node-ledger')).toBeVisible();

  // Deleting a part here leaves it out of this channel only: the fact, its connection and its overview part stay.
  await page.keyboard.press('Escape');
  await (await callout(page, 'ledger')).getByTestId('callout-delete').click(); await saved(page);
  await persistedDoc(file, d => !partOf(d, 'linkedin', 'ledger'));
  const left = await readDocument(file);
  expect(viewOf(left, 'linkedin')!.nodes.map(n => n.id)).toEqual(['visitor', 'intake']);
  expect(viewOf(left, 'linkedin')!.edges.map(e => e.id)).toEqual(['visitor-intake']);
  expect(left.facts).toEqual(described.facts); expect(factOf(left, 'db')).toBeTruthy(); expect((left.facts.relations ?? []).map(r => r.id)).toEqual(['r1', 'r2']);
  expect(viewOf(left, 'overview')).toEqual(viewOf(described, 'overview')); expect(partOf(left, 'overview', 'db')).toBeTruthy();
  nothingToUpdate(left); // leaving a part out of one channel is not a change to the facts

  // Undo brings the part back with its own name and its connection.
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => !!partOf(d, 'linkedin', 'ledger'));
  const back = await readDocument(file);
  expect(partOf(back, 'linkedin', 'ledger')?.label).toBe('Ledger'); expect(viewOf(back, 'linkedin')!.edges.map(e => e.id)).toEqual(['visitor-intake', 'intake-ledger']);
  await expect(page.getByTestId('node-ledger').getByTestId('node-label')).toHaveText('Ledger');
  expect(back.facts).toEqual(described.facts);
});
