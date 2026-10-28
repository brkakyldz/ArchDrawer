import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import {
  drawingRepo, choice, comp, rel, part, link, view, shopDoc, openDrawing, stored, saved, box, exportSvg, readImage, choiceOf, viewOf, nodeOf, drag,
} from './helpers';

const product = useProduct();

function drawing() {
  const shop = shopDoc('Many choices');
  const system = shop.choices[0];
  system.channels.linkedin = { views: [view('linkedin', 'LinkedIn', [part('web'), part('api'), part('db')], [link('web', 'api', ['r1'], 1), link('api', 'db', ['r2'], 2)])], showSteps: false, outdated: [] };
  system.channels.readme = { views: [view('readme', 'README', [part('web'), part('api', { form: 'panel' }), part('db')], [link('web', 'api', ['r1']), link('api', 'db', ['r2'])])], showSteps: false, outdated: [] };
  const small = (id: string, title: string, kind: string, label: string) => choice(id, title, kind, {
    components: [comp(`${id}-a`, label, 'service'), comp(`${id}-b`, `${label} store`, 'data')], relations: [rel('r1', `${id}-a`, `${id}-b`)],
  }, [view(`${id}-overview`, 'Overview', [part(`${id}-a`), part(`${id}-b`)], [link(`${id}-a`, `${id}-b`, ['r1'])])], { about: `${title}.` });
  shop.choices.push(small('billing', 'Billing', 'section', 'Invoicer'), small('checkout', 'Checkout', 'flow', 'Cart'), small('refund', 'How a refund works', 'custom', 'Refunder'));
  return shop;
}

// A user opens a drawing of four choices: the views panel lists them by kind. In the whole system they rename a part (every channel shows
// it at once), move one on LinkedIn (no other channel cares), and add one in the overview (LinkedIn and README now need an update, which
// README keeps as it is). An edit in one choice changes no other, and one undo history covers the edits of every choice.
test('H27 [FILE-2 FILE-3 NAV-2 EDIT-1 SHARE-1] a file of several choices is listed by kind, an edit changes only its own choice, content marks the other channels and appearance does not, and undo covers every choice', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('choices', drawing());
  const id = await openDrawing(page, p, file);
  const panel = page.getByTestId('views-panel');
  const order = await panel.locator('[data-testid^="views-choice-"], [data-testid^="views-heading-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  expect(order).toEqual(['views-choice-system', 'views-heading-section', 'views-choice-billing', 'views-heading-flow', 'views-choice-checkout', 'views-heading-custom', 'views-choice-refund']);
  await expect(panel.getByTestId('views-heading-custom')).toHaveText(/Your own/);
  const untouched = (await stored(p, id)).choices.filter((c: any) => c.id !== 'system');

  // A rename in the overview edits the fact: every channel shows it, none is marked.
  await page.getByTestId('node-api').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Order intake');
  await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await expect.poll(async () => choiceOf(await stored(p, id), 'system').facts.components.find((f: any) => f.id === 'api').label).toBe('Order intake');
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('Order intake');
  await expect(page.getByTestId('channel-tab-readme')).not.toHaveAttribute('data-outdated', /.+/);

  // Moving a part on LinkedIn is appearance: the facts and the other channels stay as they were.
  const before = await stored(p, id);
  await drag(page, page.getByTestId('node-db'), 0, 80);
  await saved(page);
  await expect.poll(async () => nodeOf(viewOf(await stored(p, id), 'linkedin'), 'db').y).not.toBe(nodeOf(viewOf(before, 'linkedin'), 'db').y);
  const moved = await stored(p, id);
  expect(choiceOf(moved, 'system').facts).toEqual(choiceOf(before, 'system').facts);
  expect(viewOf(moved, 'overview')).toEqual(viewOf(before, 'overview'));
  expect(choiceOf(moved, 'system').channels.overview.outdated).toEqual([]);

  // A new part in the overview is content: LinkedIn and README need an update; README keeps as it is; undo brings the mark back.
  await page.getByTestId('channel-tab-overview').click();
  await page.getByTestId('tool-component').click();
  const canvas = await box(page.getByTestId('canvas'));
  await page.mouse.click(canvas.x + canvas.width - 90, canvas.y + 90);
  await page.getByTestId('picker-add').click();
  await page.keyboard.press('Enter');
  await saved(page);
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('data-outdated', '1');
  await expect(page.getByTestId('channel-tab-readme')).toHaveAttribute('data-outdated', '1');
  await expect(page.getByTestId('channel-outdated-readme')).toHaveAccessibleName(/Needs update: 1/);
  await page.getByTestId('channel-tab-readme').click();
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);
  await page.getByTestId('channel-keep').click();
  await expect(page.getByTestId('channel-tab-readme')).not.toHaveAttribute('data-outdated', /.+/);
  await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('channel-tab-readme')).toHaveAttribute('data-outdated', '1');
  await saved(page);

  // An edit in another choice: the URL names it, and the whole system is not touched by it.
  await panel.getByTestId('views-entry-checkout-overview').click();
  await expect(page).toHaveURL(/choice=checkout/);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'overview');
  await page.getByTestId('node-checkout-a').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Basket');
  await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  const afterCheckout = await stored(p, id);
  expect(choiceOf(afterCheckout, 'checkout').facts.components[0].label).toBe('Basket');
  for (const c of untouched.filter((c: any) => c.id !== 'checkout')) expect(choiceOf(afterCheckout, c.id), `${c.id} is untouched`).toEqual(c);
  await page.reload();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'checkout');

  // One undo history: after the reload it starts anew, so undo in the editor steps only through edits made since.
  await page.getByTestId('node-checkout-b').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Basket store');
  await page.getByTestId('node-label-input').press('Enter');
  await panel.getByTestId('views-entry-overview').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'system');
  await page.getByTestId('node-web').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Storefront');
  await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await page.getByTestId('tool-undo').click();
  await page.getByTestId('tool-undo').click();
  await saved(page);
  await expect.poll(async () => { const d = await stored(p, id); return [choiceOf(d, 'system').facts.components[0].label, choiceOf(d, 'checkout').facts.components[1].label]; })
    .toEqual(['Web app', 'Cart store']);

  // An older link naming only a view opens the choice and channel that hold it.
  await page.goto(`${p.base}/d/${id}?view=readme`);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'readme');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'system');

  // Exports name their choice; a choice that does not exist is refused.
  const billing = await readImage(page, await exportSvg(p, id, 'choice=billing&format=readme'));
  expect(billing.nodes.map(n => n.id).sort()).toEqual(['billing-a', 'billing-b']);
  const unknown = await fetch(`${p.base}/api/diagrams/${id}/export.svg?choice=nope`);
  expect(unknown.status).toBe(400);
  expect((await unknown.json()).error).toMatch(/Unknown choice .nope./);
});
