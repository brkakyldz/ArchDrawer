import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, workspaceRaw, openDrawing, isolatedDrawing, sendInPanel, runDone, startedRun, openAiPanel } from './helpers';
import { countPuts } from './helpers-drawing';

const optionValues = async (select: Locator) => await select.evaluate(el => Array.from((el as HTMLSelectElement).options).map(o => o.value));

// AI-1: the instruction runs through a chosen engine and model; STORY-1: a channel is drawn from the facts on its own tab. #44: the empty LinkedIn stage
// shows the engine and model its Draw it uses, and they are the very choice the AI panel stores (and the home screen's `start-engine` shows).
test('H183 [AI-1 STORY-1 SHARE-2 #44] the empty LinkedIn stage chooses the engine and model that Draw it uses, shares the choice with the AI panel both ways, goes off while a run is going, and is absent with no engine', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { file } = await workspaceRaw('stage-engine', shop3('Stage engine')), opened = await openDrawing(page, request, file);
  const puts = countPuts(page), runs: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') runs.push(r.url()); });
  const before = await readFile(file, 'utf8');
  await page.getByTestId('channel-tab-linkedin').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');

  // The empty stage: the controls, the engine and the models, and everything else still off.
  const flow = page.getByTestId('linkedin-flow'), engine = page.getByTestId('stage-engine'), model = page.getByTestId('stage-model');
  await expect(page.getByTestId('channel-empty')).toBeVisible(); await expect(flow).toBeVisible();
  await expect(flow.getByTestId('stage-engine')).toBeVisible(); await expect(flow.getByTestId('stage-model')).toBeVisible();
  expect(await engine.evaluate(el => Array.from((el as HTMLSelectElement).options).map(o => [o.value, o.textContent?.trim()]))).toContainEqual(['fixture', 'Test engine (no AI)']);
  expect(await optionValues(model)).toEqual(['', 'fixture-fast', 'fixture-careful']);
  const stageStaysOff = async (what: string) => {
    for (const tool of ['tool-component', 'tool-connect', 'tool-text', 'share-button']) await expect(page.getByTestId(tool), `${what}: ${tool}`).toBeDisabled();
    await expect(page.getByTestId('channel-empty'), what).toBeVisible();
  };
  await stageStaysOff('at first');

  // Stage to panel: the model chosen on the stage is the AI panel's.
  await model.selectOption('fixture-careful');
  await openAiPanel(page);
  await expect(page.getByTestId('ai-model')).toHaveValue('fixture-careful');
  await expect(page.getByTestId('ai-engine')).toHaveValue(await engine.inputValue());
  await page.getByTestId('ai-input').fill('anything'); await expect(page.getByTestId('ai-send'), 'sending is off on a channel with no view').toBeDisabled(); await page.getByTestId('ai-input').fill('');
  // Panel to stage, at once, with the panel still open; then the stage again.
  await page.getByTestId('ai-model').selectOption('fixture-fast'); await expect(model).toHaveValue('fixture-fast');
  await model.selectOption('fixture-careful'); await expect(page.getByTestId('ai-model')).toHaveValue('fixture-careful');
  await stageStaysOff('after choosing');
  expect(runs, 'choosing starts no run').toEqual([]); expect(puts.count, 'choosing saves nothing').toBe(0);
  expect(await readFile(file, 'utf8'), 'choosing writes nothing').toBe(before);

  // The home screen's engine shows the same choice (when the start flow shows it there).
  await page.goto('/');
  const start = page.getByTestId('start-engine');
  if (await start.count()) {
    const values = await start.evaluate(el => Array.from(el.matches('select') ? [el] : Array.from(el.querySelectorAll('select'))).map(s => (s as HTMLSelectElement).value));
    expect(values, 'start-engine shows the stored model').toContain('fixture-careful');
  }
  await openDrawing(page, request, file);
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('stage-model'), 'the choice survives a reload of the drawing').toHaveValue('fixture-careful');

  // While a run is going the stage's choice is off, and so is the rest.
  const slow = await sendInPanel(page, '[fixture:slow] Show the loop');
  await expect(page.getByTestId('channel-tab-linkedin')).toBeEnabled(); await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('stage-engine')).toBeDisabled(); await expect(page.getByTestId('stage-model')).toBeDisabled();
  await stageStaysOff('during a run');
  await openAiPanel(page); await page.getByTestId('ai-cancel').click();
  expect(await runDone(page, slow.runId)).toBe('cancelled');
  await expect(page.getByTestId('stage-model')).toBeEnabled();

  // Draw it uses the model on the stage, and asks the engine to read no file.
  await page.getByTestId('stage-model').selectOption('fixture-fast');
  const draw = await startedRun(page, () => page.getByTestId('channel-draw').click());
  expect(draw.body.model).toBe('fixture-fast'); expect(draw.body.engine).toBe('fixture'); expect(draw.body.readCode).toBe(false);
  expect(draw.body.diagramId).toBe(opened.id);
  expect(await runDone(page, draw.runId)).not.toBe('running');

  // With no engine on the machine the stage has no choice to make: it offers the simple version.
  const bare = await workspaceRaw('stage-no-engine', shop3('Stage without an engine'));
  const alone = await isolatedDrawing(page, request, bare.file, '750', '');
  try {
    await page.getByTestId('channel-tab-linkedin').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
    await expect(page.getByTestId('stage-engine')).toHaveCount(0); await expect(page.getByTestId('stage-model')).toHaveCount(0);
    await expect(page.getByTestId('linkedin-prepare')).toBeVisible(); await expect(page.getByTestId('post-engine-note')).toBeVisible();
  } finally { await alone.close(); }
});
