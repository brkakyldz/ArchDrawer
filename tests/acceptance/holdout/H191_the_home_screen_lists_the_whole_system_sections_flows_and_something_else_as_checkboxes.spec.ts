import { test, expect } from '@playwright/test';
import { gitRepo, plainFolder, textLines } from './helpers';
import { OPTIONS, scanThroughHome, optionBox, isCheckbox, focusListOrder, optionsOnScreen } from './helpers-selections';

// SCAN-2 and SCAN-3 at the home screen (ADR 0015): after a scan the user sees "What should it draw?" and the choices as
// checkboxes, in this order: the whole system (with its line), the sections, the flows, "Something else". None is ticked at
// first; an option shows its title, its sentence and one line per file, and no part count and no start → end line. A folder
// the scan found no section or flow in says so and still offers the whole system and "Something else".
test('H191 [SCAN-2 SCAN-3 #180 #181] after a scan the home screen lists the whole system, the sections, the flows and something else as checkboxes, none ticked, each option with its title, sentence and files, and says so when the scan found no option', async ({ page }) => {
  test.setTimeout(180_000);
  const project = await gitRepo('home-list');
  await scanThroughHome(page, project.dir);

  // The list, its heading and its order. The radios of the older screen are gone.
  const list = page.getByTestId('focus-list');
  await expect(list).toContainText('What should it draw?');
  expect(await focusListOrder(page)).toEqual(['focus-whole', 'focus-sections', 'focus-flows', 'focus-typed']);
  const whole = page.getByTestId('focus-whole'), typed = page.getByTestId('focus-typed');
  await expect(whole).toHaveAttribute('data-kind', 'system'); await expect(typed).toHaveAttribute('data-kind', 'custom');
  await expect(whole).toContainText('The whole system'); await expect(whole).toContainText('A map of the main parts; open each one for its inside');
  await expect(typed).toContainText('Something else');
  expect(await isCheckbox(whole), 'the whole system is a checkbox').toBe(true); expect(await isCheckbox(typed), 'something else is a checkbox').toBe(true);

  // Sections first, then flows, each in the scan's option order; each option is a checkbox with its kind.
  await expect(page.getByTestId('focus-sections')).toContainText('Sections'); await expect(page.getByTestId('focus-flows')).toContainText('Flows');
  expect(await optionsOnScreen(page)).toEqual([['o2', 'section'], ['o3', 'section'], ['o1', 'flow']]);
  await expect(page.getByTestId('focus-sections').getByTestId('focus-option')).toHaveCount(2);
  await expect(page.getByTestId('focus-flows').getByTestId('focus-option')).toHaveCount(1);
  for (const [id, o] of Object.entries(OPTIONS)) {
    const box = optionBox(page, id);
    expect(await isCheckbox(box), `${id} is a checkbox`).toBe(true);
    await expect(box).toHaveAttribute('data-kind', o.kind);
    await expect(box).toContainText(o.title); await expect(box).toContainText(o.sentence);
    const files = await textLines(box.getByTestId('focus-option-files'));
    expect(files, `${id}: one line per file`).toHaveLength(o.files.length);
    o.files.forEach((file, i) => expect(files[i]).toContain(file));
    const text = (await box.innerText()).replace(/\s+/g, ' ');
    expect(text, `${id}: no part count`).not.toMatch(/\b\d+\s+parts?\b/i);
    expect(text, `${id}: no start → end line`).not.toMatch(/→|->|\bstart\b.*\bend\b/i);
  }
  // None is ticked at first, nothing is counted, no channel is asked for yet, and nothing can be drawn.
  for (const box of [whole, typed, optionBox(page, 'o1'), optionBox(page, 'o2'), optionBox(page, 'o3')]) await expect(box).not.toBeChecked();
  await expect(page.getByTestId('focus-count')).toHaveCount(0); await expect(page.getByTestId('focus-none')).toHaveCount(0);
  await expect(page.getByTestId('focus-text')).not.toBeVisible();
  for (const c of ['linkedin', 'readme', 'presentation']) await expect(page.getByTestId(`channel-choice-${c}`)).toHaveCount(0);
  await expect(page.getByTestId('draw-start')).toBeDisabled();

  // Something else: ticking shows and focuses its field; unticking hides it and keeps the words.
  await typed.click();
  await expect(typed).toBeChecked(); await expect(page.getByTestId('focus-text')).toBeVisible(); await expect(page.getByTestId('focus-text')).toBeFocused();
  await expect(page.getByTestId('focus-text')).toHaveAttribute('maxlength', '300');
  await page.getByTestId('focus-text').fill('How a booking is paid');
  await typed.click();
  await expect(typed).not.toBeChecked(); await expect(page.getByTestId('focus-text')).not.toBeVisible();
  await typed.click();
  await expect(page.getByTestId('focus-text')).toBeVisible(); await expect(page.getByTestId('focus-text')).toHaveValue('How a booking is paid');

  // A folder the scan finds nothing in: no section, no flow, one sentence, and the other two choices are still there.
  const bare = await plainFolder('home-list-none', {});
  await scanThroughHome(page, bare);
  await expect(page.getByTestId('focus-none')).toHaveText('The scan found no sections or flows. Draw the whole system, or say what to draw.');
  await expect(page.getByTestId('focus-sections')).toHaveCount(0); await expect(page.getByTestId('focus-flows')).toHaveCount(0); await expect(page.getByTestId('focus-option')).toHaveCount(0);
  await expect(page.getByTestId('focus-whole')).toBeVisible(); await expect(page.getByTestId('focus-typed')).toBeVisible();
  expect(await focusListOrder(page)).toEqual(['focus-whole', 'focus-typed']);
  // Must not happen: a scan or a look at the list starting a draw or writing a file.
  await expect(page.getByTestId('draw-progress')).toHaveCount(0); await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await project.git(['status', '--porcelain'])).toBe('');
});
