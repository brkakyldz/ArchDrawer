import { test, expect } from '@playwright/test';
import { drawing, component, workspace, openDrawing, readDrawing, box } from './helpers';

test('H35 [VIEW-6, VIEW-7, VIEW-2, VIEW-3] find a part across overview, detail and LinkedIn views and navigate from one views menu', async ({ page, request }) => {
  const doc = drawing('Find shop'); doc.views[0].nodes[1].label = 'Audit intake'; doc.views[0].nodes[1].detail = 'inside-api';
  doc.views.push({ id: 'inside-api', title: 'Inside API', caption: { title: 'Checking an order', lede: '' }, nodes: [component('audit-worker', { label: 'Audit worker', kind: 'worker' })], edges: [], texts: [] },
    { id: 'overview-linkedin', title: 'LinkedIn', caption: { title: 'How orders reach us', lede: '' }, nodes: [component('audit-reader-li', { label: 'Audit reader', kind: 'client' })], edges: [], texts: [] });
  const { file } = await workspace('search', doc), opened = await openDrawing(page, request, file), baseline = await readDrawing(file);
  await page.getByTestId('views-button').click();
  for (const view of doc.views) await expect(page.getByTestId(`view-item-${view.id}`)).toHaveText(view.title);
  await expect(page.getByTestId('view-item-overview')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('view-item-overview-linkedin').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview-linkedin'); await expect(page.getByTestId('views-menu')).not.toBeVisible();
  await page.getByTestId('search-button').click(); await expect(page.getByTestId('search-input')).toBeFocused();
  await page.getByTestId('search-input').fill('aUdIt'); await expect(page.getByTestId('search-result')).toHaveCount(3);
  const result = page.locator('[data-testid="search-result"][data-view="inside-api"][data-node-id="audit-worker"]');
  await expect(result).toContainText('Audit worker'); await expect(result).toContainText('Inside API'); await result.click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api'); await expect(page.getByTestId('node-audit-worker')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('callout-audit-worker')).toBeVisible(); await expect(page.getByTestId('node-web')).toHaveCount(0);
  expect(Number((await page.getByTestId('zoom-level').innerText()).replace('%', ''))).toBeGreaterThanOrEqual(100);
  const stage = await box(page.getByTestId('canvas')), node = await box(page.getByTestId('node-audit-worker'));
  expect(Math.abs(node.x + node.width / 2 - stage.x - stage.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(node.y + node.height / 2 - stage.y - stage.height / 2)).toBeLessThanOrEqual(2);
  await page.getByTestId('callout-audit-worker').getByTestId('callout-close').click(); await page.keyboard.press('Escape'); await page.keyboard.press('/');
  await expect(page.getByTestId('search-input')).toBeFocused(); await page.getByTestId('search-input').fill('Audit reader');
  await expect(page.getByTestId('search-result')).toHaveCount(1); await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview-linkedin'); await expect(page.getByTestId('callout-audit-reader-li')).toBeVisible();
  await page.getByTestId('views-button').click(); await expect(page.getByTestId('view-item-overview-linkedin')).toHaveAttribute('aria-current', 'true'); await page.getByTestId('view-item-overview').click();
  await page.getByTestId('node-api').getByTestId('node-inside').click(); await expect(page.getByTestId('crumb-overview')).toBeVisible(); await page.getByTestId('crumb-overview').click();
  await page.goto(`/d/${opened.id}?view=inside-api`); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api'); await page.reload(); await expect(page.getByTestId('node-audit-worker')).toBeVisible();
  expect((await readDrawing(file)).views).toEqual(baseline.views); // Finding and navigating have not renamed, copied or edited a part.
});
