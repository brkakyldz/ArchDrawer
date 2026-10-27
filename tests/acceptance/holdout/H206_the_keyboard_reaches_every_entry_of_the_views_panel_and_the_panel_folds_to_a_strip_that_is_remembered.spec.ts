import { test, expect } from '@playwright/test';
import { shop3, overlaps, box, workspaceRaw } from './helpers';
import { fourChoices, workspace4, openFourChoices, panelEntries, where, FOUR_PANEL } from './helpers-selections';

const focusedId = (page: import('@playwright/test').Page) => page.evaluate(() => (document.activeElement?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? null);

// NAV-2 (ui contract, *Choices and the views panel*): every entry is in the tab order, after the header and before the canvas; Up and
// Down move to the entry above or below without wrapping, Home and End to the first and the last, Enter or Space goes to the entry's
// view. At 900 px and over the panel is 240 px wide beside the stage, which narrows so nothing is covered; `views-collapse` folds it to a
// 40 px strip holding only that button, and the browser remembers that for every drawing. A drawing of one choice with one view has none.
test('H206 [NAV-2 #185] the keyboard reaches every entry of the views panel in order, Up and Down do not wrap, Home and End, Enter and Space go to the view; the panel is 240 px beside a stage that narrows, folds to a 40 px strip that is remembered for every drawing, and is absent for one choice with one view', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspace4('f4-keys', fourChoices('Keys four'));
  const opened = await openFourChoices(page, request, file);
  const entries = FOUR_PANEL.map(e => `views-entry-${e.view}`);

  // The tab order: the header first, then every entry in the panel's order, then the canvas's parts.
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  const walked: (string | null)[] = [];
  for (let i = 0; i < 140; i++) { await page.keyboard.press('Tab'); const id = await focusedId(page); walked.push(id); if (id === 'canvas' || id?.startsWith('node-')) break; }
  const stop = walked.length - 1;
  expect(walked[stop] === 'canvas' || walked[stop]?.startsWith('node-'), `Tab reached the canvas or a part of it: ${walked.join(' > ')}`).toBe(true);
  const seen = walked.filter(id => id?.startsWith('views-entry-'));
  expect(seen, 'every entry is reached by Tab, in the panel\'s order, before the canvas').toEqual(entries);
  const firstEntry = walked.indexOf(entries[0]);
  expect(walked.slice(0, firstEntry).some(id => id === 'channel-tab-overview' || id === 'search-button' || id === 'ai-button' || id === 'share-button'), 'after the header').toBe(true);
  expect(walked.includes('views-collapse'), 'the fold button is in the tab order too').toBe(true);

  // Up and Down move by entry (across the choices' headings), do not wrap; Home and End.
  await page.getByTestId(entries[0]).focus();
  for (let i = 1; i < entries.length; i++) { await page.keyboard.press('ArrowDown'); expect(await focusedId(page), `Down ${i}`).toBe(entries[i]); }
  await page.keyboard.press('ArrowDown'); expect(await focusedId(page), 'Down at the last entry does not wrap').toBe(entries.at(-1));
  for (let i = entries.length - 2; i >= 0; i--) { await page.keyboard.press('ArrowUp'); expect(await focusedId(page), `Up to ${i}`).toBe(entries[i]); }
  await page.keyboard.press('ArrowUp'); expect(await focusedId(page), 'Up at the first entry does not wrap').toBe(entries[0]);
  await page.keyboard.press('End'); expect(await focusedId(page)).toBe(entries.at(-1));
  await page.keyboard.press('Home'); expect(await focusedId(page)).toBe(entries[0]);
  expect(await where(page), 'moving the focus goes nowhere').toEqual({ choice: 'checkout', channel: 'overview', view: 'checkout-overview' });

  // Enter or Space goes to the entry's view: every entry from the keyboard alone.
  for (const [i, e] of FOUR_PANEL.entries()) {
    await page.getByTestId(entries[0]).focus(); for (let k = 0; k < i; k++) await page.keyboard.press('ArrowDown');
    expect(await focusedId(page)).toBe(entries[i]);
    await page.keyboard.press(i % 2 === 0 ? 'Enter' : 'Space');
    expect(await where(page), e.view).toEqual({ choice: e.choice, channel: 'overview', view: e.view });
    expect((await panelEntries(page)).filter(x => x.current).map(x => x.view)).toEqual([e.view]);
  }
  await page.waitForTimeout(500); await expect(page.getByTestId('tool-undo'), 'going by keyboard is no edit').toBeDisabled();

  // The panel beside the stage: 240 px wide, and the stage narrows so that nothing is covered.
  const panel = page.getByTestId('views-panel'), canvas = page.getByTestId('canvas'), fold = page.getByTestId('views-collapse');
  await expect(fold).toHaveAttribute('aria-expanded', 'true'); await expect(page.getByRole('button', { name: 'Hide views' })).toBeVisible();
  const open = { panel: await box(panel), canvas: await box(canvas) };
  expect(Math.abs(open.panel.width - 240), `the panel is 240 px wide: ${open.panel.width}`).toBeLessThanOrEqual(2);
  expect(overlaps(open.panel, open.canvas), 'the panel covers none of the stage').toBe(false);
  expect(open.panel.x).toBeLessThan(open.canvas.x);

  // Folded: a 40 px strip holding only the button; the stage takes the room.
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false'); await expect(page.getByRole('button', { name: 'Show views' })).toBeVisible();
  for (const e of entries) await expect(page.getByTestId(e)).not.toBeVisible();
  const folded = { panel: await box(panel), canvas: await box(canvas) };
  expect(Math.abs(folded.panel.width - 40), `the strip is 40 px wide: ${folded.panel.width}`).toBeLessThanOrEqual(2);
  expect(folded.canvas.width, 'the stage widens by what the panel gave up').toBeGreaterThan(open.canvas.width + 150);
  expect(overlaps(folded.panel, folded.canvas)).toBe(false);
  expect(await panel.evaluate(el => Array.from(el.querySelectorAll('button')).filter(b => (b as HTMLElement).offsetParent !== null).length), 'the strip holds only the button').toBe(1);
  // It is remembered by the browser, for every drawing.
  await page.reload(); await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('views-collapse')).toHaveAttribute('aria-expanded', 'false');
  const second = await workspace4('f4-keys-second', fourChoices('Second four'));
  await openFourChoices(page, request, second.file);
  await expect(page.getByTestId('views-collapse')).toHaveAttribute('aria-expanded', 'false'); await expect(page.getByTestId('views-entry-overview')).not.toBeVisible();
  await page.getByTestId('views-collapse').click();
  await expect(page.getByTestId('views-collapse')).toHaveAttribute('aria-expanded', 'true'); await expect(page.getByTestId('views-entry-overview')).toBeVisible();
  await page.goto(`/d/${opened.id}`); await expect(page.getByTestId('views-collapse')).toHaveAttribute('aria-expanded', 'true');
  expect(Math.abs((await box(page.getByTestId('views-panel'))).width - 240)).toBeLessThanOrEqual(2);

  // One choice with one view: no panel.
  const plain = await workspaceRaw('f4-keys-plain', shop3('Plain shop')); await openFourChoices(page, request, plain.file);
  await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('views-panel')).toHaveCount(0);
});
