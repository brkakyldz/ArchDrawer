import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDrawing, saved, box, persisted, callout, clickEdge } from './helpers';

test('H22 [EDIT-1, EDIT-2, FILE-1] connect two parts, merge the return direction and edit the whole connection', async ({ page, request }) => {
  const doc = drawing('Connection workshop'); doc.views[0].edges = [];
  const { file } = await workspace('connections', doc); await openDrawing(page, request, file);
  async function connect(from: string, to: string, port: boolean) {
    await page.keyboard.press('Escape'); const source = page.getByTestId(`node-${from}`); const target = page.getByTestId(`node-${to}`);
    await source.hover(); if (!port) await page.getByTestId('tool-connect').click();
    const start = await box(port ? page.getByTestId(`port-${from}-r`) : source); const end = await box(target);
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 }); await page.mouse.up(); await saved(page);
  }
  await connect('web', 'api', true); await persisted(file, d => d.views[0].edges.length === 1);
  let edge = (await readDrawing(file)).views[0].edges[0]; const id = edge.id!;
  expect(edge).toMatchObject({ from: 'web', to: 'api', label: '', style: 'call', both: false, step: null });
  await connect('api', 'web', false); await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-both', 'true');
  expect((await readDrawing(file)).views[0].edges).toHaveLength(1); // A reverse drag must not add a second edge.
  await connect('web', 'api', true); expect((await readDrawing(file)).views[0].edges).toHaveLength(1);
  await page.keyboard.press('Escape'); await clickEdge(page, id); await expect(page.getByTestId('edge-callout')).toBeVisible();
  await page.getByTestId('edge-label-input').fill('Accepted order'); await page.getByTestId('edge-label-input').press('Enter');
  await page.getByTestId('edge-style-async').click(); await expect(page.getByTestId('edge-style-async')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('edge-both').uncheck(); await page.getByTestId('edge-step-input').fill('3'); await page.getByTestId('edge-step-input').press('Tab');
  await page.getByTestId('edge-reverse').click(); await saved(page);
  edge = (await readDrawing(file)).views[0].edges[0]; expect(edge).toMatchObject({ id, from: 'api', to: 'web', label: 'Accepted order', style: 'async', both: false, step: 3 });
  await page.getByTestId('edge-style-dep').click(); await page.getByTestId('edge-step-input').fill(''); await page.getByTestId('edge-step-input').press('Tab');
  await page.getByTestId('edge-both').check(); await saved(page); await page.reload();
  await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-style', 'dep'); await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-step', '');
  await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute('data-both', 'true');
  await expect((await callout(page, 'web')).getByTestId('callout-link-api')).toHaveAttribute('data-direction', 'both');
  await page.keyboard.press('Escape'); await clickEdge(page, id); await page.getByTestId('edge-delete').click();
  await expect(page.getByTestId(`edge-${id}`)).toHaveCount(0); await page.getByTestId('tool-undo').click(); await expect(page.getByTestId(`edge-${id}`)).toBeVisible();
  await page.getByTestId('tool-redo').click(); await saved(page);
  expect((await readDrawing(file)).views[0].edges).toHaveLength(0); expect((await readDrawing(file)).views[0].nodes).toHaveLength(3);
});
