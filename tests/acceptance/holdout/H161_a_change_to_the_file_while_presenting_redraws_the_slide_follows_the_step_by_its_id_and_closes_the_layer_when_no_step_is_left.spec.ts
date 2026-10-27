import { test, expect } from '@playwright/test';
import { slideShop, SLIDE_STEPS, workspaceRaw, openDrawing, toPresentation, openLayer, slideRead, slideDimming, sessionWrite, watchToasts, toastsSeen, noToast, factOf, squeezed } from './helpers';

// PRES-1 + FILE-1 + STORY-4: an agent session writes the file while the talk is on. The slide shown is drawn again with no
// `Updated from the file` toast; the step shown is followed by its id wherever it moved, the last step is shown when it was
// removed, the opening slide stays the opening slide, and when no step is left the layer closes with its own toast. Once the
// layer is closed an outside change shows the usual toast again.
test('H161 [PRES-1, FILE-1, STORY-4] an outside change to the file while presenting redraws the slide shown with no Updated from the file toast, follows the step by its id, shows the last step when it was removed, and closes the layer with its own toast when no step is left', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('present-outside', slideShop('Outside shop'));
  await openDrawing(page, request, file); await toPresentation(page);
  await watchToasts(page);
  const layer = await openLayer(page, 'present'), status = page.getByTestId('present-status'), slow = { timeout: 15_000 };
  const step = (id: string) => SLIDE_STEPS.find(s => s.id === id)!;
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(layer).toHaveAttribute('data-index', '2'); await expect(status).toHaveText(`Step 2 of 3: ${step('s2').text}`);

  // 1. The step's text and a part's name change in the file: the slide shown is drawn again, on the same step.
  await sessionWrite(file, d => { d.channels.presentation!.steps![1].text = 'Changed in the file'; factOf(d, 'api')!.label = 'Order window'; });
  await expect(status).toHaveText('Step 2 of 3: Changed in the file', slow);
  await expect(layer).toBeVisible(); await expect(layer).toHaveAttribute('data-index', '2');
  await expect.poll(async () => { const read = await slideRead(page); return [squeezed(read.bandText), read.bandCount, squeezed(read.words.join('')).includes(squeezed('Order window'))]; }, slow)
    .toEqual([squeezed('Changed in the file'), '2 / 3', true]);

  // 2. The step moves to the front: it is still the one shown, now the first.
  await sessionWrite(file, d => { const steps = d.channels.presentation!.steps!; d.channels.presentation!.steps = [steps[1], steps[0], steps[2]]; });
  await expect(status).toHaveText('Step 1 of 3: Changed in the file', slow); await expect(layer).toHaveAttribute('data-index', '1');
  const moved = await slideRead(page); expect(moved.bandCount).toBe('1 / 3'); expect(slideDimming(moved).nodes.lit).toEqual(['db', 'zone']);

  // 3. The step shown is removed: the last step is shown.
  await sessionWrite(file, d => { d.channels.presentation!.steps = d.channels.presentation!.steps!.filter(s => s.id !== 's2'); });
  await expect(status).toHaveText(`Step 2 of 2: ${step('s3').text}`, slow); await expect(layer).toHaveAttribute('data-index', '2');
  const last = await slideRead(page); expect(last.bandCount).toBe('2 / 2'); expect(slideDimming(last).nodes.lit).toEqual(['api', 'db']);

  // 4. On the opening slide a new caption is drawn, and the opening slide stays the opening slide.
  await page.keyboard.press('Home'); await expect(layer).toHaveAttribute('data-index', '0');
  await sessionWrite(file, d => { d.channels.presentation!.views![0].caption = { title: 'Rewritten opening', lede: 'Now with a new lede.' }; });
  await expect(status).toHaveText('Rewritten opening', slow); await expect(layer).toHaveAttribute('data-index', '0');
  await expect.poll(async () => squeezed((await slideRead(page)).words.join('')).includes(squeezed('Now with a new lede.')), slow).toBe(true);
  expect((await slideRead(page)).slide).toBe('0'); await expect(layer).toBeVisible();

  // Through all of it the usual toast stayed away.
  expect(await toastsSeen(page)).toEqual([]); await expect(page.getByTestId('toast')).toHaveCount(0);

  // 5. No step is left: the layer closes and says why. Present and Tour are off again.
  await sessionWrite(file, d => { d.channels.presentation!.steps = []; });
  await expect(layer).toHaveCount(0, slow);
  await expect(page.getByTestId('toast')).toHaveText('The presentation has no steps any more');
  expect(await toastsSeen(page)).toEqual(['The presentation has no steps any more']);
  await expect(page.getByTestId('step-none')).toBeVisible();
  for (const id of ['present-start', 'tour-start']) { await expect(page.getByTestId(id)).toBeDisabled(); await expect(page.getByTestId(id)).toHaveAttribute('title', 'Add a step first'); }

  // 6. With the layer closed an outside change is announced as ever.
  await noToast(page);
  await sessionWrite(file, d => { d.channels.presentation!.steps = [{ id: 's9', parts: ['web'], text: 'Back again', note: '' }]; });
  await expect(page.getByTestId('toast')).toHaveText('Updated from the file', slow);
  await expect(page.getByTestId('step-item')).toHaveCount(1); await expect(page.getByTestId('present-start')).toBeEnabled();
});
