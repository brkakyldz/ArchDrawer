import { test, expect, generate, openEditor, document } from './helpers';

test('H05 [ENG-6, ENG-7, GEN-2, DM-1, DM-3, PER-1] duplicate ids and dangling draft edges are repaired and the repairs survive reload', async ({ page, request, token, source }) => {
  const { diagram } = await generate(request, token, source, 'Draw the system [fixture:invalid]');
  expect(diagram.nodes).toHaveLength(9);
  expect(diagram.nodes.find(node => node.id === 'api')!.label).toBe('API server');
  expect(diagram.nodes.find(node => node.id === 'api-2')!.label).toBe('API duplicate');
  expect(diagram.edges).toHaveLength(8);
  const ids = [...diagram.nodes, ...diagram.groups, ...diagram.edges, ...diagram.notes].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every(id => /^[A-Za-z0-9_-]{1,64}$/.test(id))).toBe(true);
  expect(diagram.edges.every(edge => diagram.nodes.some(node => node.id === edge.from) && diagram.nodes.some(node => node.id === edge.to))).toBe(true);
  expect(diagram.edges.some(edge => edge.to === 'ghost' || edge.from === 'ghost')).toBe(false);
  expect(diagram.warnings).toHaveLength(2);
  expect(diagram.warnings.some(warning => warning.includes('api-2'))).toBe(true);
  expect(diagram.warnings.some(warning => warning.includes('ghost'))).toBe(true);
  await openEditor(page, diagram.id);
  await expect(page.getByTestId('node-api-2').getByTestId('node-label')).toHaveText('API duplicate');
  await expect(page.getByTestId('node-ghost')).toHaveCount(0);
  await expect(page.getByTestId('warnings')).toContainText('ghost');
  await expect(page.getByTestId('warnings')).toContainText('api-2');
  await page.reload();
  await expect(page.getByTestId('node-api-2')).toBeVisible();
  expect(await document(request, diagram.id)).toEqual(diagram);
});
