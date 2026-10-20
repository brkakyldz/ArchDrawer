import { test, expect } from '@playwright/test';
import { drawing, workspace, openDrawing, readDrawing, persisted, saved, finishRun, startRun, baseURL, outsideWrite, svgInfo, overlaps } from './helpers';

test('H24 [AI-1, FILE-1, LAYOUT-1] apply and repair an instruction, undo it, cancel and protect a concurrent session edit', async ({ page, request }) => {
  const { file } = await workspace('fixture', drawing('Fixture shop')); const opened = await openDrawing(page, request, file);
  const baseline = await readDrawing(file);
  const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('ai-button').click();
  await page.getByTestId('ai-input').fill('add Cache component\n[fixture:invalid]'); await page.getByTestId('ai-send').click();
  const started = await responsePromise; expect(started.status()).toBe(202); const runId = (await started.json()).runId;
  await expect(page.getByTestId('ai-progress')).toBeVisible();
  const success = await finishRun(request, runId, 'succeeded');
  for (const message of ['Reading the drawing', 'Reading the code', 'Updating the drawing']) expect(success.progress.filter((line: string) => line === message)).toHaveLength(1);
  await expect(page.getByTestId('node-cache')).toBeVisible(); await saved(page);
  let changed = await readDrawing(file); expect(changed.warnings).toHaveLength(2);
  await expect(page.getByTestId('warnings')).toBeVisible(); expect(changed.views[0].nodes.find(n => n.id === 'web-2')?.label).toBe('Duplicate');
  expect(changed.views[0].edges.some(e => e.from === 'ghost' || e.to === 'ghost')).toBe(false);
  expect(new Set(changed.views[0].nodes.map(n => n.id)).size).toBe(changed.views[0].nodes.length);
  for (const n of baseline.views[0].nodes) expect(changed.views[0].nodes.find(after => after.id === n.id)).toMatchObject({ x: n.x, y: n.y, place: n.place });
  const exportResponse = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg`); const shapes = (await svgInfo(page, await exportResponse.text())).nodes;
  const cache = changed.views[0].nodes.find(n => n.id === 'cache')!; const cacheSize = shapes.find(n => n.id === 'cache')!;
  for (const node of changed.views[0].nodes.filter(n => n.id !== 'cache')) {
    const size = shapes.find(n => n.id === node.id)!; expect(overlaps({ x: cache.x!, y: cache.y!, width: cacheSize.width, height: cacheSize.height }, { x: node.x!, y: node.y!, width: size.width, height: size.height })).toBe(false);
  }
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('node-cache')).toHaveCount(0); await persisted(file, d => d.views[0].nodes.length === baseline.views[0].nodes.length);
  expect((await readDrawing(file)).views).toEqual(baseline.views); expect((await readDrawing(file)).warnings).toEqual(baseline.warnings);
  await page.getByTestId('ai-close').click();
  // A genuinely single-line quick ask still submits with Enter.
  const quickResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('ask-input').fill('leave it alone'); await page.getByTestId('ask-input').press('Enter');
  await finishRun(request, (await (await quickResponse).json()).runId, 'succeeded');
  await expect(page.getByTestId('toast')).toContainText(/updated/i); await saved(page);
  expect((await readDrawing(file)).views).toEqual(baseline.views);
  await page.getByTestId('ai-button').click();
  const failResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('ai-input').fill('leave it alone\n[fixture:fail]'); await page.getByTestId('ai-send').click();
  const failId = (await (await failResponse).json()).runId; await finishRun(request, failId, 'failed');
  await expect(page.getByTestId('ai-error')).toContainText('Fixture failure requested'); expect((await readDrawing(file)).views).toEqual(baseline.views);
  const cancelResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('ai-input').fill('add Cancelled part\n[fixture:slow]'); await page.getByTestId('ai-send').click();
  const cancelId = (await (await cancelResponse).json()).runId;
  await expect(page.getByTestId('ai-progress')).toContainText(/Working \d+\/30/);
  const second = await request.post(`${baseURL()}/api/runs`, { headers: { 'X-Archdraw-Token': opened.token }, data: { diagramId: opened.id, view: 'overview', instruction: 'add Other', engine: 'fixture', model: null } });
  expect(second.status()).toBe(409); await page.getByTestId('ai-cancel').click(); await finishRun(request, cancelId, 'cancelled');
  expect((await readDrawing(file)).views).toEqual(baseline.views); await expect(page.getByTestId('node-cancelled-part')).toHaveCount(0);
  // Slow is the contracted stand-in for an in-flight paid model, not a timing sleep.
  const raced = await startRun(request, opened.id, opened.token, 'add Stale part\n[fixture:slow]');
  await expect.poll(async () => (await (await request.get(`${baseURL()}/api/runs/${raced}`)).json()).progress.some((p: string) => /^Working /.test(p))).toBe(true);
  const external = await readDrawing(file); external.title = 'Session owned title'; external.updatedAt = '2099-10-13T10:00:00.000Z';
  await outsideWrite(file, external);
  const raceResult = await finishRun(request, raced, 'failed'); expect(raceResult.error).toBe('The drawing changed while the instruction ran.');
  changed = await readDrawing(file); expect(changed.title).toBe('Session owned title'); expect(changed.views).toEqual(baseline.views);
  expect(changed.views[0].nodes.some(n => n.label === 'Stale part')).toBe(false);
});
