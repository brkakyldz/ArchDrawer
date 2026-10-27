import { test, expect } from '@playwright/test';
import { gitRepo } from './helpers';
import { optionBox, scanThroughHome, watchPosts, isCheckbox, isRadio } from './helpers-selections';
import { homeServer, stepper, squash } from './helpers-home';

// HOME-2, HOME-3 (ui contract, *Choosing what to draw*, `start-steps`): after a scan the stepper is on Focus, the choices are cards
// (the whole system first, sections, flows, something else) with their files as chips, a count says how many are ticked, the
// destination cards appear with a ticked choice, the summary says how many drawings for what, the draw button says `Draw it` or
// `Draw all <n>` and stays off until the channel is chosen and a typed choice has words; Change folder goes back to the Folder
// step with the folder kept and every tick and the channel cleared. Nothing is drawn.
test('H236 [HOME-2 HOME-3 SCAN-3 STORY-1 #200] the choosing step shows the choices with file chips, counts what is ticked, writes the summary for each destination, and Change folder clears the ticks and the channel but keeps the folder', async ({ page, request }) => {
  test.setTimeout(60_000);
  const project = await gitRepo('home-choose');
  const server = await homeServer(page, request);
  try {
    const posts = watchPosts(page);
    await scanThroughHome(page, project.dir, server.base);
    await expect.poll(() => stepper(page)).toMatchObject({ now: expect.stringContaining('Focus'), nowCount: 1, done: 1 });

    // The cards: the heading, the whole system's line, the sections and flows with their files as chips, none ticked, no count yet.
    const list = page.getByTestId('focus-list');
    await expect(list).toContainText('What should it draw?'); await expect(page.getByTestId('focus-whole')).toContainText('A map of the main parts; open each one for its inside');
    await expect(page.getByTestId('focus-sections')).toContainText('Sections'); await expect(page.getByTestId('focus-flows')).toContainText('Flows');
    await expect(optionBox(page, 'o1').getByTestId('focus-option-files')).toContainText('alpha.ts'); await expect(optionBox(page, 'o1').getByTestId('focus-option-files')).toContainText('beta.ts');
    await expect(optionBox(page, 'o2').getByTestId('focus-option-files')).toContainText('gamma.ts');
    for (const id of ['o1', 'o2', 'o3']) await expect(optionBox(page, id).getByTestId('focus-option-files-more'), `${id} has no more than three files`).toHaveCount(0);
    await expect(page.getByTestId('focus-count')).toHaveCount(0); await expect(page.getByTestId('draw-summary')).toHaveText('Pick at least one');
    await expect(page.getByTestId('draw-start')).toBeDisabled(); await expect(page.getByTestId('start-change-folder')).toBeVisible();

    // Ticking: the count, the stepper on Destination, the three destinations (none chosen), the summary for each destination.
    await page.getByTestId('focus-whole').click();
    await expect(page.getByTestId('focus-count')).toHaveText('1 chosen'); expect(await stepper(page)).toMatchObject({ now: expect.stringContaining('Destination'), nowCount: 1, done: 2 });
    await expect(page.getByTestId('draw-summary')).toHaveText('1 drawing: choose where it will go'); await expect(page.getByTestId('draw-start')).toHaveText('Draw it'); await expect(page.getByTestId('draw-start')).toBeDisabled();
    const channels = { linkedin: ['LinkedIn post', '1080 × 1350'], readme: ['README drawing', 'wide · light or dark'], presentation: ['Presentation', '16 : 9 slides'] } as const;
    for (const [id, [name, size]] of Object.entries(channels)) {
      const card = page.getByTestId(`channel-choice-${id}`); await expect(card).not.toBeChecked();
      expect(await isRadio(card), `${id} is a radio`).toBe(true);
      // the card's own words: the element itself, or the label it sits in
      const text = squash(await card.evaluate(el => (el.closest('label') ?? el).textContent ?? ''));
      expect(text).toContain(name); expect(text).toContain(size);
    }
    await optionBox(page, 'o2').click();
    await expect(page.getByTestId('focus-count')).toHaveText('2 chosen'); await expect(page.getByTestId('draw-summary')).toHaveText('2 drawings: choose where it will go');
    await expect(page.getByTestId('draw-start')).toHaveText('Draw all 2'); await expect(page.getByTestId('draw-start')).toBeDisabled();
    await page.getByTestId('channel-choice-readme').click(); await expect(page.getByTestId('draw-summary')).toHaveText('2 drawings for a README');
    await page.getByTestId('channel-choice-presentation').click(); await expect(page.getByTestId('draw-summary')).toHaveText('2 drawings for a presentation');
    await page.getByTestId('channel-choice-linkedin').click(); await expect(page.getByTestId('draw-summary')).toHaveText('2 drawings for a LinkedIn post'); await expect(page.getByTestId('draw-start')).toBeEnabled();
    await optionBox(page, 'o2').click(); await expect(page.getByTestId('draw-summary')).toHaveText('1 drawing for a LinkedIn post'); await expect(page.getByTestId('draw-start')).toHaveText('Draw it');

    // Something else: its field gets the focus, an empty one stops the draw, the words survive unticking.
    await page.getByTestId('focus-typed').click(); await expect(page.getByTestId('focus-text')).toBeFocused();
    expect(await isCheckbox(page.getByTestId('focus-typed'))).toBe(true); await expect(page.getByTestId('draw-start')).toBeDisabled(); await expect(page.getByTestId('draw-start')).toHaveText('Draw all 2');
    await page.getByTestId('focus-text').fill('How a booking is paid'); await expect(page.getByTestId('draw-start')).toBeEnabled();
    await page.getByTestId('focus-typed').click(); await expect(page.getByTestId('focus-text')).toBeHidden(); await expect(page.getByTestId('draw-start')).toHaveText('Draw it');
    await page.getByTestId('focus-typed').click(); await expect(page.getByTestId('focus-text')).toHaveValue('How a booking is paid'); await page.getByTestId('focus-typed').click();

    // Change folder: the Folder step, the folder kept and editable, ticks and channel gone; the same scan comes back untouched.
    await page.getByTestId('start-change-folder').click();
    await expect.poll(() => stepper(page)).toMatchObject({ now: expect.stringContaining('Folder'), nowCount: 1, done: 0 });
    await expect(page.getByTestId('start-folder')).toHaveValue(project.dir); await expect(page.getByTestId('start-folder')).toBeEnabled(); await expect(page.getByTestId('start-scan')).toBeEnabled();
    await expect(page.getByTestId('focus-list')).toHaveCount(0); await expect(page.getByTestId('draw-start')).toHaveCount(0); await expect(page.getByTestId('home-continue').or(page.getByTestId('scan-card')).first()).toBeVisible();
    await page.getByTestId('start-scan').click(); await expect(page.getByTestId('focus-list')).toBeVisible({ timeout: 60_000 }); await expect(page.getByTestId('scan-cached')).toContainText('Scanned before at ');
    for (const box of [page.getByTestId('focus-whole'), page.getByTestId('focus-typed'), optionBox(page, 'o1'), optionBox(page, 'o2')]) await expect(box).not.toBeChecked();
    await expect(page.getByTestId('focus-count')).toHaveCount(0); await expect(page.getByTestId('draw-summary')).toHaveText('Pick at least one');
    for (const id of Object.keys(channels)) await expect(page.getByTestId(`channel-choice-${id}`)).toHaveCount(0);

    // Must not have happened: any draw.
    expect(posts.filter(p => p.path === '/api/runs')).toEqual([]);
    await expect(page.getByTestId('draw-progress')).toHaveCount(0);
  } finally { await server.close(); }
});
