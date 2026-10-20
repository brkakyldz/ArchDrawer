import { test, expect } from '@playwright/test';
import { drawing, component, workspace, openDrawing, readDrawing } from './helpers';

test('H35 [NAV-1, FILE-1] reach a detail view from the views menu, the part that holds it, the breadcrumb and a link, without editing the drawing', async ({ page, request }) => {
  const doc = drawing('Views shop'); doc.views[0].nodes[1].label = 'Audit intake'; doc.views[0].nodes[1].detail = 'inside-api';
  doc.views.push({ id: 'inside-api', title: 'Inside API', caption: { title: 'Checking an order', lede: '' }, nodes: [component('audit-worker', { label: 'Audit worker', kind: 'worker' })], edges: [], texts: [] });
  const { file } = await workspace('views', doc), opened = await openDrawing(page, request, file), baseline = await readDrawing(file);
  await page.getByTestId('views-button').click();
  for (const view of doc.views) await expect(page.getByTestId(`view-item-${view.id}`)).toHaveText(view.title);
  await expect(page.getByTestId('view-item-overview')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('view-item-inside-api').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  await expect(page.getByTestId('views-menu')).not.toBeVisible(); await expect(page.getByTestId('node-audit-worker')).toBeVisible();
  await expect(page.getByTestId('node-web')).toHaveCount(0); await expect(page.getByTestId('crumbs')).toContainText('Inside API');
  await page.getByTestId('crumb-overview').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview');
  await page.getByTestId('views-button').click(); await expect(page.getByTestId('view-item-overview')).toHaveAttribute('aria-current', 'true'); await page.getByTestId('view-item-overview').click();
  await page.getByTestId('node-api').getByTestId('node-inside').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  await expect(page.getByTestId('crumb-overview')).toBeVisible(); await page.getByTestId('crumb-overview').click();
  await page.goto(`/d/${opened.id}?view=inside-api`); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  await page.reload(); await expect(page.getByTestId('node-audit-worker')).toBeVisible();
  await page.getByTestId('views-button').click(); await expect(page.getByTestId('view-item-inside-api')).toHaveAttribute('aria-current', 'true');
  expect((await readDrawing(file)).views).toEqual(baseline.views); // Moving between views has not renamed, copied or edited a part.
});
