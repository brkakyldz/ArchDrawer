import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { home, drawingRepo, shopDoc, register, view, part, box } from './helpers';

const product = useProduct();

// A new user's library is empty: they open the example, come back, add two drawings of their own, find one by searching, switch to the list
// layout and the dark theme (both kept after a reload), and use the home screen at four window widths.
test('H02 [HOME-1 HOME-9 HOME-11 HOME-12 START-2 LOOK-1] an empty library offers the example, and the drawings come back as cards that search, keep their layout and theme, and fold with the window @smoke', async ({ page }) => {
  const p = product();
  await home(page, p);
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await expect(page.getByTestId('home-continue'), 'nothing to continue yet').toHaveCount(0);
  await expect(page.getByTestId('library-example')).toBeVisible();

  await page.getByTestId('library-example').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('repo-name')).toHaveText('Sample Shop');

  // Two drawings of the user's own: one with a detail view (two views in its overview).
  const billing = shopDoc('Billing service');
  billing.choices[0].channels.overview.views[0].nodes[1].detail = 'api-inside';
  // Part ids are unique within a channel (drawing contract rule 2): the detail view's copy of the API has its own id, pointing to the
  // same fact (rule 6 allows one part per view to show it).
  billing.choices[0].channels.overview.views.push(view('api-inside', 'Inside the API', [part('api-inside-copy', { facts: ['api'], form: 'panel' })], []));
  const first = await drawingRepo('library-billing', billing);
  const second = await drawingRepo('library-warehouse', shopDoc('Warehouse'));
  const billingId = (await register(p, first.file)).id;
  await register(p, second.file);

  await home(page, p);
  const cards = page.getByTestId('library-item');
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId('library-count')).toHaveText(/3/);
  await expect(page.getByTestId('home-nav-drawings')).toContainText('3');
  await expect(cards.first().getByTestId('library-item-title'), 'newest first').toHaveText('Warehouse');
  const example = cards.filter({ hasText: 'Sample Shop' });
  await expect(example.getByTestId('library-item-path')).toHaveText(/Imported/);
  await expect(example.getByTestId('library-item-updated')).toHaveText(/just now/);
  const kinds = await example.getByTestId('library-item-kinds').locator('[title]').count();
  expect(kinds).toBeGreaterThan(0); expect(kinds).toBeLessThanOrEqual(5);
  const billingCard = page.locator(`[data-testid="library-item"][data-diagram-id="${billingId}"]`);
  await expect(billingCard.getByTestId('library-item-path')).toContainText('architecture.archdraw.json');
  await expect(billingCard.getByTestId('library-item-preview').locator('svg').first()).toBeVisible();
  await expect(billingCard.getByTestId('library-item-views')).toHaveText(/2 views/);
  await expect(page.getByTestId('home-continue')).toContainText('Warehouse');

  // Search narrows the cards by title or path; the count stays the library's.
  await page.getByTestId('library-search').fill('WARE');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByTestId('library-item-title')).toHaveText('Warehouse');
  await expect(page.getByTestId('library-count')).toHaveText(/3/);
  await page.getByTestId('library-search').fill('zebra');
  await expect(cards).toHaveCount(0);
  await expect(page.getByTestId('library-none')).toContainText('zebra');
  await page.getByTestId('library-search').fill('');
  await expect(cards).toHaveCount(3);

  // The list layout and the dark theme are kept in this browser.
  const before = await page.getByTestId('home').getAttribute('data-theme');
  await page.getByTestId('library-layout-list').click();
  await page.getByTestId('home-theme').click();
  const after = before === 'dark' ? 'light' : 'dark';
  await expect(page.getByTestId('home')).toHaveAttribute('data-theme', after);
  await page.reload();
  await expect(page.getByTestId('library-layout-list')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('library-layout-grid')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('home')).toHaveAttribute('data-theme', after);
  expect(await page.getByTestId('home').evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/Geist/);

  // Three columns, then the side column under the work column, then the navigation in one row, then one column.
  const at = async (width: number) => {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByTestId('activity')).toBeVisible();
    return { nav: await box(page.getByTestId('home-nav')), start: await box(page.getByTestId('start')), side: await box(page.getByTestId('activity')) };
  };
  let l = await at(1600);
  expect(l.nav.x + l.nav.width).toBeLessThanOrEqual(l.start.x + 1);
  expect(l.side.x, 'side column right of the work column').toBeGreaterThanOrEqual(l.start.x + l.start.width - 1);
  l = await at(1200);
  expect(l.side.y, 'side column under the work column').toBeGreaterThanOrEqual(l.start.y + l.start.height - 1);
  expect(l.nav.x + l.nav.width).toBeLessThanOrEqual(l.start.x + 1);
  l = await at(800);
  expect(l.nav.y + l.nav.height, 'navigation in one row at the top').toBeLessThanOrEqual(l.start.y + 1);
  await expect(page.getByTestId('home-nav-new')).toBeVisible();
  await expect(page.getByTestId('home-continue')).toBeHidden();
  // At 640 px or less every column is full width. The contract sizes columns, not the blocks inside them, so the side column is measured
  // as the span of its blocks (`activity`, `start-engine`) and compared with the work column's `start`, which fills its column.
  await at(600);
  await expect.poll(async () => {
    const work = await box(page.getByTestId('start'));
    const blocks = [await box(page.getByTestId('activity')), await box(page.getByTestId('start-engine'))];
    const left = Math.min(...blocks.map(b => b.x)), right = Math.max(...blocks.map(b => b.x + b.width));
    return Math.max(Math.abs(left - work.x), Math.abs(right - (work.x + work.width)));
  }, { message: 'every column full width: the side column spans the work column' }).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // An unknown drawing is never a blank page.
  await page.goto(`${p.base}/d/d_unknown0000`);
  await expect(page.getByTestId('not-found')).toBeVisible();
  await page.getByTestId('not-found').getByRole('link').click();
  await expect(page.getByTestId('start')).toBeVisible();

  // Must not happen: a hero, a slogan, a process guide or a footer line on the home screen.
  await expect(page.getByTestId('home').locator('footer')).toHaveCount(0);
  await expect(page.getByTestId('home').getByText(/welcome|get started|how it works|in seconds/i)).toHaveCount(0);
});
