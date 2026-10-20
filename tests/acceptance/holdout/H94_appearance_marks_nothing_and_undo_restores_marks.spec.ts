import { test, expect, type Page } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, persistedDoc, saved, drag, callout, getDocument,
  factOf, partOf, viewOf, outdatedOf, sorted } from './helpers';

async function rename(page: Page, id: string, text: string) {
  await page.keyboard.press('Escape');
  await page.getByTestId(`node-${id}`).getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill(text); await page.getByTestId('node-label-input').press('Enter');
  await page.keyboard.press('Escape'); await saved(page);
}

// Moving, the form and the numbered path are appearance: they touch their channel only and mark nothing. Content edits
// mark, and undo and redo carry the marks with the edit; the file always has the state the editor shows.
test('H94 [FILE-3, EDIT-1, FILE-1] appearance edits in the overview mark nothing, content edits mark the LinkedIn channel, and undo, redo and a reload keep the marks with the edits', async ({ page, request }) => {
  const { file } = await workspaceRaw('undo-marks', withLinkedIn(shop3('Undo shop'), { intakeItems: ['Check it'] }));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  const webBefore = partOf(before, 'overview', 'web')!;

  // Appearance: a move, a form, the steps switch.
  await drag(page, page.getByTestId('node-web'), 48, 24); await saved(page);
  await persistedDoc(file, d => partOf(d, 'overview', 'web')?.x !== webBefore.x);
  await page.keyboard.press('Escape');
  await (await callout(page, 'db')).getByTestId('callout-form').click(); await page.getByTestId('form-option-compact').click();
  await saved(page); await persistedDoc(file, d => partOf(d, 'overview', 'db')?.form === 'compact');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-steps').click(); await saved(page); await persistedDoc(file, d => d.channels.overview.showSteps === true);
  const looked = await readDocument(file);
  expect(outdatedOf(looked, 'linkedin'), 'appearance marks nothing').toEqual([]);
  expect(viewOf(looked, 'linkedin')).toEqual(viewOf(before, 'linkedin')); // The other channel's drawing is not touched.
  expect(looked.channels.linkedin!.showSteps ?? false).toBe(false); // The steps switch is the current channel's alone.
  expect(looked.facts).toEqual(before.facts); // No fact changed.
  expect(partOf(looked, 'overview', 'web')?.x).not.toBe(webBefore.x);

  // Content: a rename (LinkedIn's `ledger` keeps its own name) and a held item (LinkedIn's `intake` keeps its own list).
  await rename(page, 'db', 'Order store');
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Order store');
  await page.keyboard.press('Escape');
  await page.getByTestId('node-api').getByTestId('node-item').first().dblclick();
  await page.getByTestId('node-item-input').fill('Check scope'); await page.getByTestId('node-item-input').press('Enter');
  await page.keyboard.press('Escape'); await saved(page);
  await persistedDoc(file, d => factOf(d, 'api')?.items[0] === 'Check scope');
  const marked = await readDocument(file);
  expect(factOf(marked, 'api')?.items).toEqual(['Check scope', 'Create order']);
  expect(sorted(outdatedOf(marked, 'linkedin'))).toEqual(['api', 'db']);
  expect(partOf(marked, 'linkedin', 'intake')?.items).toEqual(['Check it']); // its own list stays
  expect(partOf(marked, 'linkedin', 'ledger')?.label).toBe('Orders ledger');
  expect(outdatedOf(marked, 'overview')).toEqual([]);

  // Undo takes the item back, and the mark it set; the rename and its mark stay.
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => factOf(d, 'api')?.items[0] === 'Validate order' && sorted(outdatedOf(d, 'linkedin')).join() === 'db');
  await expect(page.getByTestId('node-api').getByTestId('node-item')).toHaveText(['Validate order', 'Create order']);
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store');
  // Undo again takes the rename back, and its mark: the LinkedIn channel needs nothing.
  await page.getByTestId('tool-undo').click();
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Orders DB' && outdatedOf(d, 'linkedin').length === 0);
  await saved(page);
  expect(viewOf(await readDocument(file), 'linkedin')).toEqual(viewOf(before, 'linkedin'));
  // Redo brings the rename and its mark back; the item stays undone.
  await page.getByTestId('tool-redo').click();
  await persistedDoc(file, d => factOf(d, 'db')?.label === 'Order store' && sorted(outdatedOf(d, 'linkedin')).join() === 'db');
  expect(factOf(await readDocument(file), 'api')?.items).toEqual(['Validate order', 'Create order']);

  // A reload shows what the file holds, marks included; the server returns the same document.
  await saved(page); await page.reload();
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Order store');
  await expect(page.getByTestId('tool-steps')).toHaveAttribute('aria-pressed', 'true'); // the appearance edits are still there
  const stored = await readDocument(file);
  expect(outdatedOf(stored, 'linkedin')).toEqual(['db']); expect(partOf(stored, 'overview', 'db')?.form).toBe('compact');
  expect((await getDocument(request, opened.id)).channels.linkedin!.outdated).toEqual(['db']);
});
