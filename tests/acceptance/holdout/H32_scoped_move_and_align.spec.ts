import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDrawing, finishRun, persisted, svgInfo, baseURL } from './helpers';

test('H32 [AI-1, LAYOUT-1, EDIT-1] move and align just one part and warn once for a move outside selected parts', async ({ page, request }) => {
  const doc = drawing('Position shop');
  for (const [i, node] of doc.views[0].nodes.entries()) { node.place = null; node.x = [80, 400, 80][i]; node.y = [80, 240, 480][i]; }
  doc.views[0].texts.push({ id: 'position-title', text: 'A stored order', x: 80, y: 680, size: 28 });
  const { file } = await workspace('positions', doc), opened = await openDrawing(page, request, file);
  const baseline = await readDrawing(file), api = baseline.views[0].nodes.find(n => n.id === 'api')!;
  const sizes = await svgInfo(page, await (await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg`)).text());
  await page.getByTestId('ai-button').click();
  async function send(instruction: string) {
    await page.getByTestId('ai-input').fill(instruction);
    const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
    await page.getByTestId('ai-send').click(); const response = await waiting; expect(response.status()).toBe(202);
    const run = await finishRun(request, (await response.json()).runId, 'succeeded'); await expect(page.getByTestId('ai-summary')).toBeVisible(); return run;
  }
  const moved = await send('move Orders DB right of Order API');
  expect(moved.changes).toEqual({ added: [], removed: [], changed: [], moved: ['db'], edgesAdded: [], edgesRemoved: [], edgesChanged: [] });
  await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-moved', '1'); await expect(page.getByTestId('node-db')).toHaveAttribute('data-changed', 'true');
  await expect(page.getByTestId('node-api')).not.toHaveAttribute('data-changed', 'true');
  await persisted(file, d => d.views[0].nodes.find(n => n.id === 'db')?.y === api.y);
  const afterMove = await readDrawing(file), db = afterMove.views[0].nodes.find(n => n.id === 'db')!;
  expect(db.x).toBe(Math.round((api.x! + sizes.nodes.find(n => n.id === 'api')!.width + 64) / 8) * 8); expect(db.y).toBe(api.y);
  for (const node of baseline.views[0].nodes.filter(n => n.id !== 'db')) expect(afterMove.views[0].nodes.find(n => n.id === node.id)).toEqual(node);
  expect(afterMove.views[0].texts).toEqual(baseline.views[0].texts);
  const aligned = await send('align Orders DB with Web app'); expect(aligned.changes.moved).toEqual(['db']);
  await persisted(file, d => d.views[0].nodes.find(n => n.id === 'db')?.y === 80);
  const beforeIgnored = await readDrawing(file); expect(beforeIgnored.views[0].nodes.find(n => n.id === 'db')?.x).toBe(db.x);
  for (const node of afterMove.views[0].nodes.filter(n => n.id !== 'db')) expect(beforeIgnored.views[0].nodes.find(n => n.id === node.id)).toEqual(node);
  expect(beforeIgnored.views[0].edges).toEqual(afterMove.views[0].edges); expect(beforeIgnored.views[0].texts).toEqual(afterMove.views[0].texts);
  // The panel stays open and selection on the canvas sets the parts scope.
  await page.getByTestId('node-db').getByTestId('node-label').click(); await page.getByTestId('ai-scope-selection').check();
  await expect(page.getByTestId('ai-scope-selection')).toHaveAccessibleName('Selected parts (1)');
  const ignored = await send('move Web app below Order API');
  expect(ignored.changes).toEqual({ added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] });
  await expect(page.getByTestId('ai-summary')).toHaveText('Nothing changed');
  const afterIgnored = await readDrawing(file); expect(afterIgnored.views).toEqual(beforeIgnored.views);
  expect(afterIgnored.warnings!.length - beforeIgnored.warnings!.length).toBe(1); await expect(page.getByTestId('warnings')).toBeVisible();
  expect(afterIgnored.warnings!.at(-1)).toMatch(/scope|outside|ignored/i);
  await page.getByTestId('ai-scope-view').check(); await send('move Orders DB below Order API');
  await expect(page.getByTestId('node-db')).toHaveAttribute('data-changed', 'true');
  await page.getByTestId('tool-undo').click(); await persisted(file, d => d.views[0].nodes.find(n => n.id === 'db')?.y === 80);
  expect((await readDrawing(file)).views).toEqual(beforeIgnored.views);
});
