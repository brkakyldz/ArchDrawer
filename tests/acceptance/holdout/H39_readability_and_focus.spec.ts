import { test, expect, type Page } from '@playwright/test';
import { component, drawing, workspace, openDrawing } from './helpers';
import { readView } from './helpers-drawing';

// SHARE-3 helpers (kept in this file: helpers.ts is not edited). The `readability` line is the sentence alone: the
// details toggle and the details are cut out of a copy first, because the contract does not say whether they sit inside it.
const WHERE: Record<string, string> = { 'format-feed': 'in the LinkedIn feed', 'format-readme': 'in a GitHub README', 'format-slide': 'on a projected slide', 'format-square': 'in a feed' };
const SUGGESTIONS = ['hiding the sub-lines would help', 'the LinkedIn version would help', 'a larger format would help'];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function readabilitySentence(page: Page) {
  return (await page.getByTestId('share-dialog').getByTestId('readability').evaluate(el => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-testid="readability-details-toggle"],[data-testid="readability-details"]').forEach(n => n.remove());
    return copy.textContent ?? '';
  })).replace(/\s+/g, ' ').trim();
}
function sentencePattern(level: string, where: string, suggestions: string[]) {
  const tail = `(?:; (?:${suggestions.map(escape).join('|')}))?\\.`;
  if (level === 'good') return new RegExp(`^The text is readable ${escape(where)} as it is\\.$`);
  if (level === 'ok') return new RegExp(`^The text is too small to read ${escape(where)} until the image is opened${tail}$`);
  return new RegExp(`^The text will be too small to read ${escape(where)}, even when the image is opened${tail}$`);
}
async function expectSentence(page: Page, where: string, suggestions: string[], why: string) {
  const meter = page.getByTestId('share-dialog').getByTestId('readability');
  await expect.poll(async () => {
    const level = (await meter.getAttribute('data-level')) ?? '', line = await readabilitySentence(page);
    return { why, level, line, ok: sentencePattern(level, where, suggestions).test(line) && !/\d/.test(line) };
  }, { message: why }).toMatchObject({ ok: true });
}

test('H39 [SHARE-2 SHARE-3 LAYOUT-3 LOOK-3 #177] share the view as it is, keep keyboard focus inside sharing and call a drawing too wide to read too small in one plain sentence that suggests hiding the sub-lines while they show, in the report and the meter alike', async ({ page, request }) => {
  const doc = drawing('Wide shop'), view = doc.views[0];
  view.nodes = Array.from({ length: 18 }, (_, i) => component(`wide-${i}`, { label: `Order station ${i + 1}`, form: 'panel', sub: 'Handle an order', items: ['Check order', 'Keep record'], x: i * 900, y: 160 }));
  view.edges = Array.from({ length: 17 }, (_, i) => ({ id: `wide-edge-${i}`, from: `wide-${i}`, to: `wide-${i + 1}`, label: 'Next station', style: 'call', both: false, step: i + 1 }));
  const { file } = await workspace('readability', doc); await openDrawing(page, request, file); const source = await readView(file);
  await page.getByTestId('share-button').click(); const dialog = page.getByTestId('share-dialog'), actions = page.getByTestId('share-actions');
  await expect(dialog).toHaveAttribute('role', 'dialog'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  // The details of the readability line are closed when the dialog opens.
  await expect(page.getByTestId('readability-details-toggle')).toHaveText('Details');
  await expect(page.getByTestId('readability-details-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('readability-details')).toBeHidden();
  // Sharing only packages: no simplifying and no sharing of one part, for a LinkedIn and a README destination.
  const removed = ['preset-simple', 'preset-detailed', 'share-part', 'fix-simplify', 'fix-part'];
  for (const format of ['format-feed', 'format-readme', 'format-slide', 'format-square']) {
    await page.getByTestId(format).click(); await expect(page.getByTestId(format)).toHaveAttribute('aria-pressed', 'true');
    for (const id of removed) await expect(dialog.getByTestId(id), `${id} with ${format}`).toHaveCount(0);
    await expect(dialog.getByTestId('show-items'), `no part draws rows, so no show-items with ${format}`).toHaveCount(0);
  }
  await page.getByTestId('share-advanced-toggle').click(); await expect(page.getByTestId('share-advanced')).toBeVisible();
  for (const id of removed) await expect(dialog.getByTestId(id), `${id} in advanced options`).toHaveCount(0);
  await expect(page.getByTestId('show-sub'), 'the sub-line switch is offered').toBeVisible();
  await page.getByTestId('share-advanced-toggle').click();
  await page.getByTestId('format-readme').click(); await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
  // Exercise both wrapping boundaries using actual, enabled, visible dialog controls.
  const tabbable = 'button,input,select,textarea,a[href],[tabindex]';
  await dialog.locator(tabbable).evaluateAll(els => {
    const controls = els.filter(el => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length);
    (controls.at(-1) as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');
  expect(await dialog.locator(tabbable).evaluateAll(els => {
    const controls = els.filter(el => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length);
    return document.activeElement === controls[0];
  })).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.locator(tabbable).evaluateAll(els => {
    const controls = els.filter(el => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length);
    return document.activeElement === controls.at(-1);
  })).toBe(true);
  for (let i = 0; i < 32; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
  // SHARE-3: for each destination the meter states its level in one plain sentence with no digit.
  for (const format of ['format-feed', 'format-readme', 'format-slide', 'format-square']) {
    await page.getByTestId(format).click(); await expect(page.getByTestId(format)).toHaveAttribute('aria-pressed', 'true');
    if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
    // Sub-lines start as the view's switch (on here), whichever the format.
    await expect(page.getByTestId('show-sub'), `${format}: sub-lines start on`).toBeChecked();
    const shown = await page.getByTestId('show-sub').isChecked();
    if (format === 'format-feed' || format === 'format-readme') await expect(actions.getByTestId('readability')).toHaveAttribute('data-level', 'warn');
    // With sub-lines shown the one suggestion is the first one; otherwise any contracted suggestion.
    await expectSentence(page, WHERE[format], shown ? [SUGGESTIONS[0]] : SUGGESTIONS, `${format}, sub-lines ${shown ? 'shown' : 'hidden'}`);
    if (shown && format === 'format-readme') expect(await readabilitySentence(page)).toBe('The text will be too small to read in a GitHub README, even when the image is opened; hiding the sub-lines would help.');
  }
  // With the sub-lines hidden the suggestion is no longer that one.
  await page.getByTestId('format-readme').click(); await page.getByTestId('show-sub').uncheck();
  await expectSentence(page, WHERE['format-readme'], SUGGESTIONS.slice(1), 'format-readme, sub-lines hidden');
  expect(await readabilitySentence(page)).not.toContain('sub-lines');
  await page.getByTestId('show-sub').check();
  await page.getByTestId('share-advanced-toggle').click();
  await page.getByTestId('format-readme').click(); await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
  // The numbers live behind Details only.
  const toggle = page.getByTestId('readability-details-toggle'), details = page.getByTestId('readability-details');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(details).toBeHidden();
  expect(await actions.getByTestId('readability').innerText()).not.toMatch(/\d/);
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(details).toBeVisible();
  await expect(details).toHaveText(/Names \d+\.\d px and text \d+\.\d px .+, \d+\.\d px opened\./);
  await expect.poll(async () => await readabilitySentence(page)).toMatch(/^The text will be too small to read in a GitHub README/);
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(details).toBeHidden();
  expect(await actions.getByTestId('readability').innerText()).not.toMatch(/\d/);
  // The 18 wide stations cannot be read at the size README is shown: the meter and the report say so, and agree.
  await expect(actions.getByTestId('readability')).toHaveAttribute('data-level', 'warn');
  await expect(actions.getByTestId('download-png')).toBeVisible(); await expect(actions.getByTestId('download-svg')).toBeVisible();
  const report = actions.getByTestId('layout-report'); await expect(report).toBeVisible();
  await expect(report).toHaveAttribute('data-level', 'warn'); await expect(report).toHaveAttribute('data-view', 'overview');
  await expect(actions.getByTestId('readability')).toHaveText(/\S/);
  await expect(actions.getByTestId('readability')).not.toContainText(/Share one part|Simplify/i);
  for (const id of removed) await expect(page.getByTestId(id)).toHaveCount(0);
  // Must not happen: reading the report, or switching sub-lines in the dialog, writing anything into the drawing.
  expect(await readView(file)).toEqual(source);
  // Closing with the details open: they are closed again when the dialog next opens.
  await toggle.click(); await expect(details).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByTestId('share-button')).toBeFocused();
  await page.getByTestId('share-button').click(); await expect(dialog).toBeVisible();
  await expect(page.getByTestId('readability-details-toggle')).toHaveAttribute('aria-expanded', 'false'); await expect(page.getByTestId('readability-details')).toBeHidden();
});
