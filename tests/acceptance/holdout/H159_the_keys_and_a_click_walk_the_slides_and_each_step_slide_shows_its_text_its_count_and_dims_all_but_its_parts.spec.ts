import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { slideShop, SLIDE_STEPS, workspaceRaw, openDrawing, toPresentation, openLayer, slideRead, slideDimming, dimsAgree, slideSized, squeezed, saved } from './helpers';

// PRES-1 + STORY-4: presenting walks the opening slide and the three steps with the keys of the contract and a click on the slide,
// never past either end. Each step slide shows its text and its `i / n` in the band, lights the step's parts and the connections
// whose two ends are both lit, and dims everything else, a group even when a part inside it is lit and every text; the opening slide
// dims nothing and has no band. `present-status` says where the presentation is; the hint goes with the first move.
const TITLE = 'Selling with Keys shop', LEDE = 'From a click to a stored order.';
const STEP_SLIDES: Record<number, { nodes: { lit: string[]; dim: string[] }; edges: { lit: string[]; dim: string[] } }> = {
  1: { nodes: { lit: ['api', 'web'], dim: ['cache', 'db', 'zone'] }, edges: { lit: ['e1'], dim: ['e2', 'e3'] } },
  2: { nodes: { lit: ['db', 'zone'], dim: ['api', 'cache', 'web'] }, edges: { lit: [], dim: ['e1', 'e2', 'e3'] } },
  3: { nodes: { lit: ['api', 'db'], dim: ['cache', 'web', 'zone'] }, edges: { lit: ['e3'], dim: ['e1', 'e2'] } },
};

test('H159 [PRES-1, STORY-4, SHARE-1] the arrow, Space, Page, Home and End keys and a click walk the opening slide and three steps without passing either end, and every step slide shows its text and count, lights its parts and dims the rest as the slide image says', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('present-keys', slideShop('Keys shop'));
  await openDrawing(page, request, file); await toPresentation(page);
  const bytes = await readFile(file, 'utf8');
  const layer = await openLayer(page, 'present');
  const status = page.getByTestId('present-status'), hint = page.getByTestId('present-hint'), toast = page.getByTestId('toast');
  const opening = await slideRead(page);
  const ratios = Object.fromEntries(opening.nodes.map(n => [n.id, n.ratio]));

  // What the slide at this index draws; the layer, the slide's own index and the live region agree on it.
  const showing = async (index: number) => {
    await expect(layer).toHaveAttribute('data-index', String(index));
    await expect.poll(async () => (await slideRead(page)).slide).toBe(String(index));
    const read = await slideRead(page), prose = squeezed(read.words.join(''));
    expect(read).toMatchObject({ format: 'slide', theme: await page.getByTestId('editor').getAttribute('data-theme') });
    expect(slideSized(read), `slide ${index}: 1920 × 1080 in its own coordinates`).toBe(true);
    expect(dimsAgree(read), `slide ${index}: a dimmed group says opacity 0.25, a lit one does not`).toBe(true);
    for (const node of read.nodes) expect(Math.abs(node.ratio - ratios[node.id]), `slide ${index}: ${node.id} keeps its box`).toBeLessThan(0.02);
    expect(read.nodes.map(n => n.id).sort()).toEqual(['api', 'cache', 'db', 'web', 'zone']);
    if (index === 0) {
      await expect(status).toHaveText(TITLE);
      expect(read.band, 'no band on the opening slide').toBe(false);
      expect(slideDimming(read)).toEqual({ nodes: { lit: ['api', 'cache', 'db', 'web', 'zone'], dim: [] }, edges: { lit: ['e1', 'e2', 'e3'], dim: [] }, texts: { lit: ['t1'], dim: [] } });
      expect(prose, 'the opening slide always shows the caption title').toContain(squeezed(TITLE));
      expect(prose, 'and the lede, which is not empty').toContain(squeezed(LEDE));
      return;
    }
    const step = SLIDE_STEPS[index - 1];
    await expect(status).toHaveText(`Step ${index} of 3: ${step.text}`);
    expect(read.band).toBe(true); expect(squeezed(read.bandText), 'the step text, never shortened').toBe(squeezed(step.text)); expect(read.bandCount).toBe(`${index} / 3`);
    expect(prose, 'a step slide has no caption').not.toContain(squeezed(TITLE)); expect(prose).not.toContain(squeezed(LEDE));
    expect(slideDimming(read), `slide ${index}`).toEqual({ ...STEP_SLIDES[index], texts: { lit: [], dim: ['t1'] } });
  };
  const key = async (name: string, index: number) => { await page.keyboard.press(name); await showing(index); };
  // A key that must do nothing: the slide, the layer and the page stay as they were.
  const stays = async (name: string, index: number) => {
    await page.keyboard.press(name); await page.waitForTimeout(150); await showing(index);
    await expect(layer).toBeVisible(); await expect(toast).toHaveCount(0);
  };

  // The opening slide, with the hint that goes away with the first move.
  await showing(0); await expect(hint).toBeVisible(); await expect(hint).toHaveText('← → to move · Esc to exit');
  expect(await status.evaluate(el => el.getAttribute('aria-live') === 'polite' || el.getAttribute('role') === 'status')).toBe(true);
  await stays('ArrowLeft', 0); await stays('PageUp', 0); await stays('ArrowUp', 0);
  await expect(hint, 'moving past the start is no change of slide').toBeVisible();

  // Forward with each of the next keys, and the last step is the end.
  await key('ArrowRight', 1); await expect(hint).toBeHidden();
  await key('ArrowDown', 2); await key('Space', 3);
  await stays('PageDown', 3); await stays('ArrowRight', 3); await stays('Space', 3); await stays('ArrowDown', 3); await stays('End', 3);
  // Back with each of the previous keys, and the opening slide is the start.
  await key('ArrowLeft', 2); await key('ArrowUp', 1); await key('PageUp', 0); await stays('ArrowLeft', 0);
  // Page keys and Home and End jump; Home is the opening slide, End the last step.
  await key('PageDown', 1); await key('PageDown', 2); await key('Home', 0); await key('End', 3); await key('Home', 0); await key('End', 3); await key('PageUp', 2);
  await expect(hint, 'the hint is gone for good once the slide has changed').toBeHidden();

  // A click on the slide is the next slide, and past the last one it does nothing.
  await key('Home', 0);
  const slide = page.getByTestId('present-slide');
  await slide.click(); await showing(1); await slide.click(); await showing(2); await slide.click(); await showing(3);
  await slide.click(); await page.waitForTimeout(150); await showing(3);
  await expect(layer).toBeVisible(); await expect(toast).toHaveCount(0);

  // Must not happen: walking the slides being an edit.
  await page.keyboard.press('Escape'); await expect(layer).toHaveCount(0);
  await page.waitForTimeout(1200); // longer than the 350 ms save delay: a hidden edit would have been written by now
  expect(await readFile(file, 'utf8')).toBe(bytes); await saved(page); await expect(page.getByTestId('tool-undo')).toBeDisabled();
});
