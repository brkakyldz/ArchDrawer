import { test, expect, createDiagram, openEditor, saved, drag } from './helpers';

test('H09 [DM-3, EDT-1, EDT-3, EDT-5, EDT-6, EDT-7, PER-1] edge fields, layout, theme and step visibility survive undo and reload', async ({ page, request, token }) => {
  const original = await createDiagram(request, token);
  await openEditor(page, original.id);
  await page.getByTestId('edge-request').click({ force: true });
  await expect(page.getByTestId('inspector-edge-label')).toHaveValue('submit');
  await page.getByTestId('inspector-edge-label').fill('request order');
  await page.getByTestId('inspector-edge-step').fill('7');
  for (const style of ['result', 'call', 'async']) {
    await page.getByTestId('inspector-edge-style').selectOption(style);
    await saved(page, request, original.id, diagram => diagram.edges[0].style === style && diagram.edges[0].label === 'request order' && diagram.edges[0].step === 7);
    await expect(page.getByTestId('edge-request')).toHaveAttribute('data-style', style);
  }
  await expect(page.getByTestId('edge-label-request')).toContainText('7');
  await page.getByTestId('tool-delete').click();
  await saved(page, request, original.id, diagram => diagram.edges.length === 0);
  await expect(page.getByTestId('node-api')).toBeVisible();
  await page.getByTestId('tool-undo').click();
  await saved(page, request, original.id, diagram => diagram.edges.length === 1 && diagram.edges[0].style === 'async');
  await page.getByTestId('tool-redo').click();
  await saved(page, request, original.id, diagram => diagram.edges.length === 0);
  await page.getByTestId('tool-undo').click();
  await saved(page, request, original.id, diagram => diagram.edges.length === 1);
  await page.getByTestId('tool-theme').click();
  await page.getByTestId('tool-steps').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('edge-label-request')).toHaveText('request order');
  await drag(page, 'node-api', 67, -31);
  const beforeLayout = await saved(page, request, original.id, diagram => diagram.theme === 'light' && diagram.showSteps === false && diagram.nodes.find(node => node.id === 'api')!.x !== original.nodes.find(node => node.id === 'api')!.x);
  const positions = (diagram: typeof original) => diagram.nodes.map(node => [node.id, node.x, node.y]);
  await page.getByTestId('tool-layout').click();
  const laidOut = await saved(page, request, original.id, diagram => JSON.stringify(positions(diagram)) !== JSON.stringify(positions(beforeLayout)));
  expect(laidOut.nodes.map(({ x, y, ...node }) => node)).toEqual(beforeLayout.nodes.map(({ x, y, ...node }) => node));
  expect(laidOut.edges).toEqual(beforeLayout.edges);
  expect(laidOut.notes.map(note => note.text)).toEqual(beforeLayout.notes.map(note => note.text));
  expect([laidOut.title, laidOut.subtitle]).toEqual([beforeLayout.title, beforeLayout.subtitle]);
  await page.getByTestId('tool-undo').click();
  await saved(page, request, original.id, diagram => JSON.stringify(positions(diagram)) === JSON.stringify(positions(beforeLayout)));
  await page.getByTestId('tool-redo').click();
  await saved(page, request, original.id, diagram => JSON.stringify(positions(diagram)) === JSON.stringify(positions(laidOut)));
  await page.reload();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('edge-label-request')).toHaveText('request order');
  await expect(page.getByTestId('edge-request')).toHaveAttribute('data-style', 'async');
  expect(laidOut.nodes.some(node => node.label === '')).toBe(false);
});
