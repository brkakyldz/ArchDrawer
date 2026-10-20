import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDrawing, persisted, saved, settledReport, previewSVG, svgInfo, baseURL } from './helpers';

// Outcome: the layout report, the warning and the picture agree about cut text, and a user can fix it.
test('H85 [LAYOUT-3, QUAL-2, EDIT-1, SHARE-1] a sub-line the image shortens is drawn, listed and counted; after the user shortens it nothing is cut', async ({ page, request }) => {
  const fullSub = 'W'.repeat(60);
  const doc = drawing('Cut text shop'), view = doc.views[0];
  view.nodes[0].sub = fullSub; view.edges.forEach(edge => { edge.label = ''; });
  const labelOf = new Map(view.nodes.map(n => [n.id, n.label] as const));
  const { file } = await workspace('cut-text', doc), opened = await openDrawing(page, request, file);
  const baseline = await readDrawing(file);

  // Before: the same part is shortened in the picture, listed in the warning and counted in the report.
  await page.getByTestId('share-button').click();
  const before = await settledReport(page);
  expect(before.cut).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('share-clipped')).toBeVisible();
  const listed = await page.getByTestId('share-clipped-item').allTextContents();
  expect(listed.some(text => text.includes(`Web app: ${fullSub}`))).toBe(true);
  const drawnShort = (await svgInfo(page, await previewSVG(page))).nodes.filter(n => n.text.some(t => t.includes('…'))).map(n => labelOf.get(n.id));
  expect(drawnShort, 'the parts drawn with an ellipsis are the parts the warning lists').toEqual(['Web app']);
  expect(before.cut).toBeGreaterThanOrEqual(drawnShort.length);
  await page.getByTestId('share-close').click();

  // The user shortens the sub-line on the canvas.
  await page.getByTestId('node-web').getByTestId('node-sub').dblclick();
  await page.getByTestId('node-sub-input').fill('React'); await page.getByTestId('node-sub-input').press('Enter');
  await saved(page); await persisted(file, d => d.views[0].nodes.find(n => n.id === 'web')?.sub === 'React');

  // After: no cut text anywhere, and the report is clean.
  await page.getByTestId('share-button').click();
  const after = await settledReport(page);
  expect(after, 'the report of the fixed drawing').toMatchObject({ cut: 0, crossings: 0, overParts: 0 });
  await expect(page.getByTestId('share-clipped')).toHaveCount(0);
  expect((await svgInfo(page, await previewSVG(page))).text.join(' '), 'an ellipsis is still drawn').not.toContain('…');
  const http = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`); expect(http.status()).toBe(200);
  expect((await svgInfo(page, await http.text())).text.join(' '), 'an ellipsis is still exported').not.toContain('…');

  // Only the sub-line changed.
  const stored = await readDrawing(file);
  expect(stored.views[0].nodes.map(n => ({ ...n, sub: '' }))).toEqual(baseline.views[0].nodes.map(n => ({ ...n, sub: '' })));
  expect(stored.views[0].edges).toEqual(baseline.views[0].edges);
});
