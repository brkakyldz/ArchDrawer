import { test, expect } from '@playwright/test';
import { component, drawing, workspace, isolatedDrawing, readDrawing, persisted, finishRun, reportNumber, drag } from './helpers';

test('H30 [AI-1, EDIT-1, EDIT-4, FILE-1] expand a quick ask, pick a test model, follow progress and undo the reported change', async ({ page, request }) => {
  const doc = drawing('Panel shop');
  doc.views.push({ id: 'storage', title: 'Storage', caption: { title: 'Kept records', lede: '' }, nodes: [component('ledger', { label: 'Ledger' })], edges: [], texts: [] });
  const { file } = await workspace('panel', doc), server = await isolatedDrawing(page, request, file);
  try {
    const baseline = await readDrawing(file);
    const enginesResponse = await request.get(`${server.base}/api/engines`); expect(enginesResponse.status()).toBe(200);
    const engines = (await enginesResponse.json()).engines;
    for (const engine of engines) {
      for (const key of ['id', 'label', 'available', 'version', 'detail', 'test', 'models']) expect(engine).toHaveProperty(key);
      expect(typeof engine.available).toBe('boolean'); expect(typeof engine.test).toBe('boolean'); expect(Array.isArray(engine.models)).toBe(true);
      expect(engine.test).toBe(engine.id === 'fixture');
      for (const model of engine.models) expect(model).toMatchObject({ id: expect.any(String), label: expect.any(String) });
    }
    const fixture = engines.find((e: { id: string }) => e.id === 'fixture');
    expect(fixture).toMatchObject({ available: true, test: true, label: 'Fixture (test)', models: [
      { id: 'fixture-fast', label: 'Fast (test)' }, { id: 'fixture-careful', label: 'Careful (test)' },
    ] });
    expect(engines.filter((e: { available: boolean }) => e.available).map((e: { id: string }) => e.id)).toEqual(['fixture']);
    await expect(page.getByTestId('ask-input')).toHaveAttribute('placeholder', 'Ask the test engine (no AI) to change this drawing');
    await page.getByTestId('ask-input').fill('add Cache component'); await page.getByTestId('ask-expand').click();
    await expect(page.getByTestId('ai-input')).toHaveValue('add Cache component'); await expect(page.getByTestId('ask-input')).toHaveValue('');
    await expect(page.getByTestId('ai-engine')).toHaveValue('fixture');
    await expect(page.getByTestId('ai-engine').locator('option')).toHaveText(['Test engine (no AI)']);
    // The note names the test engine and the six instructions it understands.
    const note = page.getByTestId('ai-engine-note'); await expect(note).toContainText('Test engine (no AI)');
    for (const command of ['add', 'remove', 'rename', 'hold', 'move', 'align']) await expect(note).toContainText(command);
    await expect(page.getByTestId('ai-model').locator('option')).toHaveText(['Default', 'Fast (test)', 'Careful (test)']);
    await expect(page.getByTestId('ai-model')).toHaveValue(''); await expect(page.getByTestId('ai-scope-view')).toBeChecked();
    await expect(page.getByTestId('ai-scope-selection')).toBeDisabled();
    await page.getByTestId('ai-model').selectOption('fixture-careful');
    const instruction = 'add Cache component\nKeep the storage view intact.'; await page.getByTestId('ai-input').fill(instruction);
    const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
    await page.getByTestId('ai-input').press('ControlOrMeta+Enter'); const started = await waiting;
    expect(started.status()).toBe(202);
    expect(started.request().postDataJSON()).toMatchObject({ diagramId: server.id, view: 'overview', instruction, engine: 'fixture', model: 'fixture-careful', scope: { kind: 'view' } });
    await expect(page.getByTestId('ai-send')).toBeDisabled(); await expect(page.getByTestId('ai-progress')).toBeVisible();
    // While the instruction runs, an edit on the canvas is refused: a drag moves nothing and says why.
    await drag(page, page.getByTestId('node-web'), 48, 24);
    await expect(page.getByTestId('toast')).toHaveText('Edits are paused while the instruction runs');
    const running =await (await request.get(`${server.base}/api/runs/${(await started.json()).runId}`)).json();
    expect(running.status).toBe('running'); expect(running.changes).toBeNull();
    for (const message of ['Using model fixture-careful', 'Reading the drawing', 'Reading the code', 'Updating the drawing']) {
      await expect(page.getByTestId('ai-progress-line').filter({ hasText: message }).first()).toHaveText(message);
    }
    const result = await finishRun(request, (await started.json()).runId, 'succeeded', 20_000, server.base);
    expect(result).toMatchObject({ engine: 'fixture', model: 'fixture-careful' });
    const wanted = ['Using model fixture-careful', 'Reading the drawing', 'Reading the code', 'Updating the drawing'];
    // The routing question of a refine (0.3) is a call of its own; the refine's lines come in this order whether or not the question reports lines too.
    const seen = result.progress.filter((line: string) => wanted.includes(line));
    expect(seen.slice(-wanted.length)).toEqual(wanted); expect(seen[0]).toBe('Using model fixture-careful');
    expect(result.progress).toContain('Changing the facts');
    const summary = page.getByTestId('ai-summary');
    await expect(summary).toContainText(/\badd(?:ed)?\b/i);
    await expect(summary).toContainText(/\b1\b/); await expect(summary).toContainText(/\bparts?\b/i); await expect(summary).toContainText(/\bconnections?\b/i);
    await expect(summary).not.toContainText(/\b0 (?:part|connection)s?\b/);
    for (const [key, value] of Object.entries({ added: 1, removed: 0, changed: 0, moved: 0, 'edges-added': 1, 'edges-removed': 0, 'edges-changed': 0 }))
      await expect.poll(async () => reportNumber(await summary.getAttribute(`data-${key}`), key)).toBe(value);
    await expect(page.getByTestId('node-cache')).toHaveAttribute('data-changed', 'true');
    await expect(page.getByTestId('node-web')).not.toHaveAttribute('data-changed', 'true'); await expect(page.getByTestId('ai-input')).toHaveValue('');
    await persisted(file, d => d.engine?.id === 'fixture' && d.engine.model === 'fixture-careful' && d.views[0].nodes.some(n => n.id === 'cache'));
    const after = await readDrawing(file); expect(after.views[1]).toEqual(baseline.views[1]);
    for (const node of baseline.views[0].nodes) expect(after.views[0].nodes.find(n => n.id === node.id)).toEqual(node);
    await expect(page.getByTestId('node-cache')).not.toHaveAttribute('data-changed', 'true', { timeout: 6000 });
    await page.getByTestId('ai-close').click(); await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-model')).toHaveValue('fixture-careful');
    await page.reload(); await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-engine')).toHaveValue('fixture'); await expect(page.getByTestId('ai-model')).toHaveValue('fixture-careful');
    // Reload ends browser undo history; use a fresh run to test the undo boundary.
    await page.getByTestId('ai-input').fill('rename Cache to Request cache');
    const renamed = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
    await page.getByTestId('ai-send').click(); await finishRun(request, (await (await renamed).json()).runId, 'succeeded', 20_000, server.base);
    await expect(page.getByTestId('node-cache').getByTestId('node-label')).toHaveText('Request cache');
    await expect.poll(async () => reportNumber(await page.getByTestId('ai-summary').getAttribute('data-changed'), 'changed')).toBe(1);
    await page.getByTestId('tool-undo').click(); await persisted(file, d => d.views[0].nodes.find(n => n.id === 'cache')?.label === 'Cache');
    expect((await readDrawing(file)).views).toEqual(after.views);
  } finally { await server.close(); }
});
