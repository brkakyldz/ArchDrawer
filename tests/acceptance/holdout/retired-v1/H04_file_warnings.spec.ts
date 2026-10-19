import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test, expect, generate, openEditor } from './helpers';

test('H04 [SRC-1, ENG-6, GEN-4, DM-2] missing repository files produce visible warnings without losing components', async ({ page, request, token, workspace }) => {
  const empty = path.join(workspace, 'empty-repository');
  await fs.mkdir(empty);
  const { diagram } = await generate(request, token, empty);
  expect(diagram.nodes).toHaveLength(8);
  expect(diagram.edges).toHaveLength(8);
  expect(diagram.nodes.every(node => node.files.length === 0)).toBe(true);
  expect(diagram.warnings).toHaveLength(5);
  await openEditor(page, diagram.id);
  await expect(page.getByTestId('warnings')).toBeVisible();
  for (const file of ['web/index.html', 'server/api.js', 'server/auth.js', 'server/orders.js', 'db/schema.sql']) {
    expect(diagram.warnings.some(warning => warning.includes(file))).toBe(true);
    await expect(page.getByTestId('warnings')).toContainText(file);
  }
  await page.getByTestId('node-api').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('inspector-file')).toHaveCount(0);
  await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('API server');
  expect(await fs.readdir(empty)).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('warnings')).toContainText('server/api.js');
  await expect(page.getByTestId('node-api')).toBeVisible();
});
