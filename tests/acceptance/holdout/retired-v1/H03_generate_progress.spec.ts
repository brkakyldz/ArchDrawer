import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test, expect, fixtureFiles, fixtureProgress, waitRun, document, events } from './helpers';

test('H03 [ENG-1, ENG-2, ENG-3, ENG-5, ENG-7, GEN-1, GEN-2, GEN-4, DM-1, DM-2, DM-3, PLT-3] editable presets generate the complete fixture with ordered progress', async ({ page, request, source }) => {
  const outgoing: string[] = [];
  page.on('request', request => outgoing.push(request.url()));
  const enginesResponse = await request.get('/api/engines');
  expect(enginesResponse.status()).toBe(200);
  const engines = (await enginesResponse.json()).engines;
  expect(engines).toHaveLength(1);
  expect(engines[0]).toMatchObject({ id: 'fixture', label: 'Fixture (test)', available: true });
  expect(engines[0]).toHaveProperty('version');
  expect(engines[0]).toHaveProperty('detail');
  await page.goto('/');
  await expect(page.getByTestId('engine-select')).toHaveValue('fixture');
  const presets: string[] = [];
  for (const id of ['full', 'request-flow', 'data', 'deployment', 'agent']) {
    await page.getByTestId(`preset-${id}`).click();
    const value = await page.getByTestId('instruction-input').inputValue();
    expect(value.trim().length).toBeGreaterThan(0);
    presets.push(value);
  }
  expect(new Set(presets).size).toBe(5);
  const instruction = `${presets[1]} Include the order checks.`;
  await page.getByTestId('instruction-input').fill(instruction);
  await page.getByTestId('source-input').fill(source);
  await page.getByTestId('model-input').fill('holdout-fixture-model');
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
  await page.getByTestId('generate-button').click();
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(page.getByTestId('generate-button')).toBeDisabled();
  await expect(page.getByTestId('run-panel')).toBeVisible();
  await expect(page.getByTestId('run-progress-line').filter({ hasText: 'Listing files' })).toBeVisible();
  const response = await pending;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({ engine: 'fixture', model: 'holdout-fixture-model', instruction });
  const runId = (await response.json()).runId;
  const run = await waitRun(request, runId);
  await expect(page).toHaveURL(new RegExp(`/d/${run.diagramId}$`));
  await expect(page.getByTestId('editor')).toBeVisible();
  const diagram = await document(request, run.diagramId!);
  expect(diagram).toMatchObject({ schema: 'archdraw/diagram@1', title: 'Sample Shop architecture', subtitle: `Fixture diagram of ${path.basename(source)}`, direction: 'LR', engine: { id: 'fixture', model: 'holdout-fixture-model' }, instruction });
  const expected = [
    ['shopper', 'Shopper', 'actor'], ['web', 'Web app', 'ui'], ['api', 'API server', 'service'],
    ['auth', 'Auth middleware', 'gate'], ['orders', 'Order service', 'service'],
    ['recs', 'Recommendation model', 'llm'], ['db', 'Postgres', 'data'], ['stripe', 'Stripe', 'external'],
  ];
  expect(diagram.nodes).toHaveLength(8);
  for (const [id, label, kind] of expected) {
    const node = page.getByTestId(`node-${id}`);
    await expect(node).toHaveAttribute('data-kind', kind);
    await expect(node.getByTestId('node-label')).toHaveText(label);
    const stored = diagram.nodes.find(node => node.id === id)!;
    expect(Number.isFinite(stored.x) && Number.isFinite(stored.y)).toBe(true);
  }
  expect(new Set(diagram.nodes.map(node => `${node.x},${node.y}`)).size).toBe(8);
  expect(diagram.groups.map(group => group.id).sort()).toEqual(['backend', 'storage']);
  expect(diagram.groups.every(group => group.w > 0 && group.h > 0)).toBe(true);
  for (const node of diagram.nodes.filter(node => node.group !== null)) {
    const group = diagram.groups.find(group => group.id === node.group)!;
    expect(node.x >= group.x && node.x < group.x + group.w && node.y >= group.y && node.y < group.y + group.h).toBe(true);
  }
  expect(diagram.edges.map(edge => [edge.from, edge.to, edge.label, edge.style, edge.step])).toEqual(expect.arrayContaining([
    ['shopper', 'web', 'browse', 'call', 1], ['web', 'api', 'POST /orders', 'call', 2],
    ['api', 'auth', 'verify', 'call', 3], ['api', 'orders', 'create order', 'call', 4],
    ['orders', 'db', 'insert', 'call', 5], ['orders', 'stripe', 'charge', 'async', null],
    ['orders', 'recs', 'suggest', 'call', null], ['api', 'web', '201 Created', 'result', null],
  ]));
  expect(diagram.edges).toHaveLength(8);
  expect(diagram.warnings).toEqual([]);
  await page.getByTestId('node-api').click();
  await expect(page.getByTestId('inspector-file')).toHaveText('server/api.js');
  const history = await events(request, runId);
  expect(history.filter(event => event.event === 'done')).toEqual([{ event: 'done', data: { status: 'succeeded', diagramId: diagram.id, error: null } }]);
  expect(history.at(-1)!.event).toBe('done');
  expect(history.filter(event => event.event === 'progress').map(event => event.data.message).filter(message => fixtureProgress.includes(message))).toEqual(fixtureProgress);
  expect(run.progress.filter(message => fixtureProgress.includes(message))).toEqual(fixtureProgress);
  for (const [relative, original] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(source, ...relative.split('/')), 'utf8')).toBe(original);
  await page.getByTestId('back-to-library').click();
  await page.reload();
  await expect(page.getByTestId('engine-select')).toHaveValue('fixture');
  await expect(page.getByTestId('model-input')).toHaveValue('holdout-fixture-model');
  expect(outgoing.filter(url => /^https?:/.test(url) && new URL(url).origin !== new URL(page.url()).origin)).toEqual([]);
});
