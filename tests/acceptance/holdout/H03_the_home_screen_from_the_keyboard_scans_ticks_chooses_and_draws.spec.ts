import { test, expect, type Page } from '@playwright/test';
import { useProduct } from './server';
import { gitRepo, home, startedRun } from './helpers';

const product = useProduct();

async function tabTo(page: Page, selector: string, back = false, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(s => !!document.activeElement?.closest(s), selector)) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Tab never reached ${selector}`);
}
// The destinations are radio cards: Tab reaches the group, the arrow keys move within it, as radios do; Space then chooses.
async function toDestination(page: Page, channel: 'linkedin' | 'readme') {
  await tabTo(page, '[data-testid^="channel-choice-"]');
  const target = `[data-testid="channel-choice-${channel}"]`;
  for (let i = 0; i < 4 && !(await page.evaluate(s => !!document.activeElement?.closest(s), target)); i++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(s => !!document.activeElement?.closest(s), target), { message: `focus on the ${channel} destination` }).toBe(true);
}
const at = (testId: string, extra = '') => `[data-testid="${testId}"]${extra}`;

// A keyboard user goes from the shortcut to a drawing without the mouse: Ctrl K, the path, Enter; Tab and Space to tick; Change folder
// clears the ticks; Space on a destination and Enter on it draws.
test('H03 [HOME-10 HOME-3 SCAN-3 STORY-1] the home screen works from the keyboard: Ctrl K finds the folder field, Space ticks, Change folder clears, Enter on a destination draws in list order', async ({ page }) => {
  const p = product();
  const project = await gitRepo('keyboard');
  const runPosts: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') runPosts.push(r.postData() ?? ''); });

  await home(page, p);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(page.getByTestId('start-folder')).toBeFocused();
  await page.keyboard.type(project.dir);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });

  // Space ticks the focused card; the bar counts what is ticked.
  await tabTo(page, at('focus-whole'));
  await page.keyboard.press('Space');
  await expect(page.getByTestId('draw-summary')).toHaveText(/1 drawing/);
  await tabTo(page, at('focus-option', '[data-option="o1"]'));
  await page.keyboard.press('Space');
  await expect(page.getByTestId('draw-summary')).toHaveText(/2 drawings/);
  await expect(page.getByTestId('draw-start')).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('channel-choice-linkedin')).toBeVisible();

  // Change folder: back to the Folder step with the folder kept and the ticks and the channel cleared.
  await toDestination(page, 'readme');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('draw-summary')).toHaveText(/2 drawings.*README/);
  await expect(page.getByTestId('draw-start')).toHaveText(/Draw all 2/);
  await page.getByTestId('start-change-folder').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('start-steps').locator('[data-state="now"]')).toHaveText(/Folder/);
  await expect(page.getByTestId('start-folder')).toHaveValue(project.dir);
  await page.getByTestId('start-folder').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('focus-list')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('draw-summary')).toHaveText(/Pick at least one/);
  await expect(page.getByTestId('channel-choice-readme'), 'no channel until a choice is ticked').toHaveCount(0);

  // Something else first, then the whole system: the draw still lists them in the order of the list.
  await tabTo(page, at('focus-typed'));
  await page.keyboard.press('Space');
  await expect(page.getByTestId('focus-text')).toBeFocused();
  await page.keyboard.type('How a refund is approved');
  await tabTo(page, at('focus-whole'), true); // the whole system is before the text field in the order
  await page.keyboard.press('Space');
  await expect(page.getByTestId('draw-summary')).toHaveText(/2 drawings/);
  await toDestination(page, 'readme');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('draw-start')).toBeEnabled();
  const run = await startedRun(page, () => page.keyboard.press('Enter'));
  expect(run.sent.choices).toEqual([{ kind: 'whole' }, { kind: 'typed', text: 'How a refund is approved' }]);
  expect(run.sent.channel).toBe('readme');
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });

  // Must not happen: the Enter pressed with no channel chosen starting a draw.
  expect(runPosts).toHaveLength(1);
});
