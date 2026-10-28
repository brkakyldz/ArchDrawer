import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { gitRepo, scan, startDraw, waitRun, openDrawing, stored, viewOf, nodeOf, exportSvg, readImage, saved, box, WHOLE, option, OPTION } from './helpers';

const product = useProduct();

// A developer opens the drawing of their agent project: the views panel lists the map and its inside, then the flow. They go into the
// runtime by clicking it (a drag only moves it), come back by the crumb, go in again with Enter, and read the agent's loop and its checks in
// the agent's callout, which is the only place its rows show.
test('H20 [STORY-8 NAV-1 NAV-2 READ-3 LOOK-3 EDIT-2] the map lists its inside in the views panel, a click or Enter goes into a part with an inside while a drag moves it, and the agent\'s callout lists its loop', async ({ page }) => {
  const p = product();
  const project = await gitRepo('map-editor');
  const run = await waitRun(p, await startDraw(p, (await scan(p, { folder: project.dir })).id, [WHOLE, option('o1')], 'readme'));
  const puts: string[] = [];
  page.on('request', r => { if (r.method() === 'PUT') puts.push(r.url()); });
  await openDrawing(page, p, run.path);
  const editor = page.getByTestId('editor');
  await expect(editor).toHaveAttribute('data-view', 'overview');

  // The views panel: the whole system with its inside, then the flows.
  const panel = page.getByTestId('views-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('views-choice-system').getByTestId('views-entry-overview')).toHaveAttribute('data-depth', '0');
  await expect(panel.getByTestId('views-choice-system').getByTestId('views-entry-zone-runtime-inside')).toHaveAttribute('data-depth', '1');
  await expect(panel.getByTestId('views-entry-overview')).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByTestId('views-heading-flow')).toBeVisible();
  await expect(panel.getByTestId(`views-choice-${OPTION.o1.id}`)).toHaveAttribute('data-kind', 'flow');
  await expect(panel.getByTestId('views-heading-section')).toHaveCount(0);

  // The part with an inside wears the open mark, in the editor and in the image.
  const runtime = page.getByTestId('node-zone-runtime');
  await expect(runtime).toHaveAttribute('data-open', 'true');
  await expect(runtime.locator('.open-mark')).toHaveCount(1);
  const image = await readImage(page, await exportSvg(p, run.diagramId, 'view=overview&format=readme'));
  expect(image.nodes.find(n => n.id === 'zone-runtime')).toMatchObject({ open: 'true', openMark: true });
  expect(image.nodes.find(n => n.id === 'app')).toMatchObject({ openMark: false });

  // A click without moving goes in: no selection, no callout, no edit.
  await runtime.getByTestId('node-label').click();
  await expect(editor).toHaveAttribute('data-view', 'zone-runtime-inside');
  await expect(page).toHaveURL(/view=zone-runtime-inside/);
  await expect(page.getByTestId('callout-zone-runtime')).toHaveCount(0);
  await expect(panel.getByTestId('views-entry-zone-runtime-inside')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('crumbs')).toContainText('Agent runtime');
  await page.getByTestId('crumb-overview').click();
  await expect(editor).toHaveAttribute('data-view', 'overview');
  expect(puts, 'going to a view is not an edit').toEqual([]);

  // A drag moves it and goes nowhere.
  const before = nodeOf(viewOf(await stored(p, run.diagramId), 'overview'), 'zone-runtime');
  const b = await box(runtime);
  await page.mouse.move(b.x + 20, b.y + b.height - 12); await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + b.height + 108, { steps: 10 }); await page.mouse.up();
  await saved(page);
  await expect(editor).toHaveAttribute('data-view', 'overview');
  await expect.poll(async () => nodeOf(viewOf(await stored(p, run.diagramId), 'overview'), 'zone-runtime').y).toBeGreaterThan(before.y);

  // Enter on the focused part goes in.
  await expect(runtime).toHaveAttribute('role', 'button');
  await expect(runtime).toHaveAccessibleName(/Open Agent runtime/);
  await runtime.focus();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveAttribute('data-view', 'zone-runtime-inside');

  // The agent's callout: what it is for, its connections, its files, and its loop and limit as rows listed only here.
  const agent = page.getByTestId('node-agent');
  await agent.getByTestId('node-label').click();
  const callout = page.getByTestId('callout-agent');
  await expect(callout).toBeVisible();
  await expect(callout.getByTestId('callout-description')).toContainText(/Agent/);
  await expect(callout.getByTestId('callout-link-store')).toHaveAttribute('data-direction', 'to');
  await expect(callout.getByTestId('callout-file').filter({ hasText: 'beta.ts' })).toHaveCount(1);
  await expect(callout.locator('[data-testid="callout-item"][data-row="held"]')).toHaveText([/Model call/, /Tool proposal/, /Tool check/, /Tool execution/, /Tool result/]);
  await expect(callout.locator('[data-testid="callout-item"][data-row="limit"]')).toHaveText([/Stops after 12 turns/]);
  for (const row of ['Model call', 'Tool check', 'Stops after 12 turns']) await expect(agent, `no row drawn: ${row}`).not.toContainText(row);
  const facts = (await stored(p, run.diagramId)).choices[0].facts.components;
  expect(facts.find((f: any) => f.id === 'tool-check')).toMatchObject({ kind: 'gate', within: 'agent' });

  // One click on the flow's entry goes to that choice's overview; its tabs are its own channels.
  await panel.getByTestId(`views-entry-${OPTION.o1.id}-overview`).click();
  await expect(editor).toHaveAttribute('data-choice', OPTION.o1.id);
  await expect(editor).toHaveAttribute('data-view', `${OPTION.o1.id}-overview`);
  await expect(page.getByTestId('crumbs')).toBeVisible();
  await page.getByTestId('channel-tab-readme').click();
  await expect(editor).toHaveAttribute('data-view', `${OPTION.o1.id}-readme`);
  await expect(panel.getByTestId(`views-entry-${OPTION.o1.id}-overview`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('node-zone-runtime'), 'the map is not drawn in another choice').toHaveCount(0);

  // The keyboard walks the entries; the panel folds to a strip the browser remembers; below 900 px it lives in the header menu.
  await panel.getByTestId('views-entry-overview').focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel.getByTestId('views-entry-zone-runtime-inside')).toBeFocused();
  await page.keyboard.press('End');
  await expect(panel.getByTestId(`views-entry-${OPTION.o1.id}-overview`)).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveAttribute('data-view', 'zone-runtime-inside');
  const fold = page.getByTestId('views-collapse');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByTestId('views-entry-overview')).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('views-collapse'), 'the strip is remembered').toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('views-collapse').click();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.getByTestId('header-menu-button')).toBeVisible();
  await page.getByTestId('header-menu-button').click();
  const menu = page.getByTestId('header-menu');
  await expect(menu.getByTestId('views-entry-overview')).toBeVisible();
  await menu.getByTestId('views-entry-overview').click();
  await expect(editor).toHaveAttribute('data-view', 'overview');
  await expect(menu, 'choosing an entry closes the menu').toBeHidden();
  await page.setViewportSize({ width: 1600, height: 1000 });
});
