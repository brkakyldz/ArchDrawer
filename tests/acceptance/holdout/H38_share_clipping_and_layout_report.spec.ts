import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { component, drawing, workspace, openDrawing, readDrawing, previewSVG, svgInfo, reportAttributes } from './helpers';

test('H38 [SHARE-1, LAYOUT-3] warn about text the image shortens and count it in the layout report beside the readability check', async ({ page, request }) => {
  const doc = drawing('Parts shop'), fullSub = 'W'.repeat(60); doc.views[0].nodes[0].sub = fullSub;
  doc.views[0].nodes.push(component('runtime', { label: 'Runtime', form: 'group' }),
    component('child', { label: 'Worker', parent: 'runtime', form: 'compact' }),
    component('nested', { label: 'Nested runtime', parent: 'runtime', form: 'group' }),
    component('nested-child', { label: 'Queue', parent: 'nested', kind: 'data', form: 'compact' }));
  doc.views[0].edges.push({ id: 'within-group', from: 'child', to: 'nested-child', label: 'Queue work', style: 'async', both: false, step: null },
    { id: 'outside-group', from: 'api', to: 'child', label: 'Start work', style: 'call', both: false, step: null });
  const { file } = await workspace('share-clipping', doc); await openDrawing(page, request, file);
  const baseline = await readDrawing(file), bytes = await readFile(file, 'utf8');
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-clipped')).toContainText('Shortened in this image:');
  await expect(page.getByTestId('share-clipped-item').filter({ hasText: fullSub })).toContainText(`Web app: ${fullSub}`);
  expect((await svgInfo(page, await previewSVG(page))).nodes.find(n => n.id === 'web')!.text.join(' ')).toContain('…');
  // The layout report is always visible beside the readability check and counts what is drawn.
  const actions = page.getByTestId('share-actions'), report = actions.getByTestId('layout-report');
  await expect(report).toBeVisible(); await expect(actions.getByTestId('readability')).toBeVisible();
  await expect(report).toHaveAttribute('data-view', 'overview'); await expect(report).toHaveAttribute('data-format', 'readme');
  await expect(report).toHaveAttribute('data-parts', '5'); await expect(report).toHaveAttribute('data-zones', '1'); await expect(report).toHaveAttribute('data-connections', '4');
  expect((await reportAttributes(page)).cut).toBeGreaterThanOrEqual(1);
  expect(await report.getAttribute('data-level')).toBe(await actions.getByTestId('readability').getAttribute('data-level'));
  // Showing the shortened text in the dialog has written nothing into the drawing.
  expect((await readDrawing(file)).views).toEqual(baseline.views); expect(await readFile(file, 'utf8')).toBe(bytes);
});
