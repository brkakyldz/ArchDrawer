import { test, expect, createDiagram, openEditor, saved, library } from './helpers';

test('H10 [EDT-2, EDT-5, PER-1] one hundred keyboard undo and redo steps preserve inspector edits and autosave on reload', async ({ page, request, token }) => {
  const original = await createDiagram(request, token);
  await openEditor(page, original.id);
  await page.getByTestId('node-api').click();
  await page.getByTestId('inspector-tech').fill('Node 22 LTS');
  await page.getByTestId('inspector-tech').press('Tab');
  await saved(page, request, original.id, diagram => diagram.nodes.find(node => node.id === 'api')!.tech === 'Node 22 LTS');
  const label = page.getByTestId('node-api').getByTestId('node-label');
  for (let i = 1; i <= 100; i++) {
    await page.getByTestId('inspector-label').fill(`Revision ${i}`);
    await page.getByTestId('inspector-label').press('Tab');
    await expect(label).toHaveText(`Revision ${i}`);
  }
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  for (let i = 100; i >= 1; i--) {
    await page.keyboard.press(`${modifier}+z`);
    await expect(label).toHaveText(i === 1 ? 'Order API' : `Revision ${i - 1}`);
  }
  await saved(page, request, original.id, diagram => {
    const api = diagram.nodes.find(node => node.id === 'api')!;
    return api.label === 'Order API' && api.tech === 'Node 22 LTS';
  });
  for (let i = 1; i <= 100; i++) {
    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect(label).toHaveText(`Revision ${i}`);
  }
  const final = await saved(page, request, original.id, diagram => diagram.nodes.find(node => node.id === 'api')!.label === 'Revision 100');
  expect(final.nodes.find(node => node.id === 'api')!.tech).toBe('Node 22 LTS');
  expect(final.nodes).toHaveLength(original.nodes.length);
  expect(final.edges).toEqual(original.edges);
  await page.reload();
  await expect(label).toHaveText('Revision 100');
  await page.getByTestId('node-api').click();
  await expect(page.getByTestId('inspector-tech')).toHaveValue('Node 22 LTS');
  expect((await library(request)).filter(diagram => diagram.id === original.id)).toHaveLength(1);
});
