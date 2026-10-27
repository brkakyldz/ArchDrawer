import { test, expect } from '@playwright/test';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing, startedRun, tabTo, postJSON } from './helpers';
import { scanThroughHome, optionBox, focusedChoice, watchPosts } from './helpers-selections';

const TYPED = 'How a booking is paid';

// SCAN-3, HOME-10, START-7, STORY-1 at the home screen (ui contract, *The keyboard*, `focus-list`, `draw-start`): the user ticks the whole
// system, a section, a flow and their own words from the keyboard (Tab walks the list in its order, Space ticks, Space on Something else
// focuses its field), Tab reaches the destinations and Space chooses one, and Enter on the draw button sends one draw of all four, in the
// order of the list, with no `focus`. Nothing is drawn before Enter. The draw itself (its rows, Ready, Open and the file) is H192; here it
// is cancelled over the API once it was asked for.
test('H250 [SCAN-3 HOME-10 START-7 STORY-1 #200] tick the whole system, a section, a flow and your own words from the keyboard, choose the LinkedIn post with Space, and Enter sends one draw of all four in the order of the list', async ({ page, request }) => {
  test.setTimeout(60_000);
  const project = await gitRepo('home-keyboard');
  const other = await workspaceRaw('home-keyboard-lib', shop3('Home shop'));
  const server = await isolatedDrawing(page, request, other.file, '300');
  try {
    const posts = watchPosts(page);
    await scanThroughHome(page, project.dir, server.base);

    // The keyboard path through the list: the whole system, the sections, the flows, then something else; Space ticks.
    await tabTo(page, 'focus-whole');
    expect(await focusedChoice(page)).toBe('focus-whole');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('focus-whole')).toBeChecked(); await expect(page.getByTestId('focus-count')).toHaveText('1 chosen');
    await expect(page.getByTestId('draw-start')).toContainText('Draw it'); await expect(page.getByTestId('draw-start')).toBeDisabled(); // no channel yet
    for (const c of ['linkedin', 'readme', 'presentation']) { await expect(page.getByTestId(`channel-choice-${c}`)).toBeVisible(); await expect(page.getByTestId(`channel-choice-${c}`)).not.toBeChecked(); }
    const walked: (string | null)[] = [];
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page)); await page.keyboard.press('Space'); // the first section
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page)); // the second section: passed over
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page)); await page.keyboard.press('Space'); // the flow
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page));
    expect(walked, 'sections in option order, then flows, then something else').toEqual(['focus-option:o2', 'focus-option:o3', 'focus-option:o1', 'focus-typed']);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('focus-typed')).toBeChecked(); await expect(page.getByTestId('focus-text')).toBeFocused();
    await page.keyboard.type(TYPED);
    await expect(optionBox(page, 'o2')).toBeChecked(); await expect(optionBox(page, 'o1')).toBeChecked(); await expect(optionBox(page, 'o3')).not.toBeChecked();
    await expect(page.getByTestId('focus-count')).toHaveText('4 chosen');
    await expect(page.getByTestId('draw-start')).toContainText('Draw all 4');
    // The next stop is the channel; none is chosen until Space chooses it, and then Draw all is on.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? '')).toMatch(/^channel-choice-/);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(page.getByTestId('draw-start')).toBeEnabled();
    for (let i = 0; i < 8 && (await focusedChoice(page)) !== 'draw-start'; i++) await page.keyboard.press('Tab');
    expect(await focusedChoice(page)).toBe('draw-start');
    expect(posts.filter(p => p.path === '/api/runs'), 'nothing is drawn before the user asks').toEqual([]);

    // Enter on Draw all: one run whose choices are in the order of the list, not of the ticking, and carry no `focus`.
    const run = await startedRun(page, () => page.keyboard.press('Enter'));
    expect(run.body).not.toHaveProperty('focus');
    expect(run.body).toMatchObject({ kind: 'draw', channel: 'linkedin' });
    expect(run.body.choices).toEqual([{ kind: 'whole' }, { kind: 'option', option: 'o2' }, { kind: 'option', option: 'o1' }, { kind: 'typed', text: TYPED }]);
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);

    // The draw is followed in H192; this one is cancelled so the server stops with nothing running.
    expect((await postJSON(request, server.token, `/api/runs/${run.runId}/cancel`, {}, server.base)).status).toBe(200);
  } finally { await server.close(); }
});
