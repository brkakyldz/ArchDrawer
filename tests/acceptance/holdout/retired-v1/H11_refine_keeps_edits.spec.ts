import { test, expect, generate, openEditor, saved, drag, waitRun, document, library, type Diagram } from './helpers';

test('H11 [GEN-3, ENG-2, ENG-5, DM-2, DM-3, EDT-2, PER-1] refine adds, renames and removes while kept nodes retain positions and manual edits', async ({ page, request, token, source }) => {
  const { diagram } = await generate(request, token, source);
  const beforeLibrary = await library(request);
  await openEditor(page, diagram.id);
  await page.getByTestId('node-api').click();
  await page.getByTestId('inspector-label').fill('Reviewed API');
  await page.getByTestId('inspector-kind').selectOption('gate');
  await page.getByTestId('inspector-tech').fill('Reviewed Node runtime');
  await page.getByTestId('inspector-description').fill('Approved by the platform review');
  await page.getByTestId('inspector-description').press('Tab');
  await drag(page, 'node-api', 45, 35);
  const edited = await saved(page, request, diagram.id, current => {
    const api = current.nodes.find(node => node.id === 'api')!;
    return api.label === 'Reviewed API' && api.kind === 'gate' && api.tech === 'Reviewed Node runtime' && api.description === 'Approved by the platform review' && api.x !== diagram.nodes.find(node => node.id === 'api')!.x;
  });
  async function refine(instruction: string) {
    await page.getByTestId('refine-input').fill(instruction);
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
    await page.getByTestId('refine-button').click();
    const response = await pending;
    expect(response.status()).toBe(202);
    expect(response.request().postDataJSON()).toMatchObject({ diagramId: diagram.id, instruction, engine: 'fixture' });
    const run = await waitRun(request, (await response.json()).runId);
    expect(run.diagramId).toBe(diagram.id);
    await expect(page.getByTestId('run-status')).toHaveText('succeeded');
    await expect(page).toHaveURL(new RegExp(`/d/${diagram.id}$`));
    return document(request, diagram.id);
  }
  function kept(before: Diagram, after: Diagram, removed: string[] = [], relabelled: Record<string, string> = {}) {
    for (const node of before.nodes.filter(node => !removed.includes(node.id))) {
      expect(after.nodes.find(candidate => candidate.id === node.id)).toEqual({ ...node, ...(relabelled[node.id] ? { label: relabelled[node.id] } : {}) });
    }
  }
  const added = await refine('add Cache node');
  kept(edited, added);
  const cache = added.nodes.find(node => node.id === 'cache')!;
  expect(cache).toMatchObject({ label: 'Cache', kind: 'service', group: null });
  expect(Number.isFinite(cache.x) && Number.isFinite(cache.y)).toBe(true);
  expect(added.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'api', to: 'cache', label: 'uses', style: 'call', step: null })]));
  await expect(page.getByTestId('node-cache').getByTestId('node-label')).toHaveText('Cache');
  const renamed = await refine('rename Web app to Customer portal');
  kept(added, renamed, [], { web: 'Customer portal' });
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Customer portal');
  const removed = await refine('remove Order service');
  kept(renamed, removed, ['orders']);
  expect(removed.nodes.some(node => node.id === 'orders')).toBe(false);
  expect(removed.edges.some(edge => edge.from === 'orders' || edge.to === 'orders')).toBe(false);
  expect(removed.nodes.filter(node => node.id === 'cache')).toHaveLength(1);
  await expect(page.getByTestId('node-orders')).toHaveCount(0);
  expect((await library(request)).map(entry => entry.id).sort()).toEqual(beforeLibrary.map(entry => entry.id).sort());
  await page.reload();
  await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('Reviewed API');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Customer portal');
  expect(await document(request, diagram.id)).toEqual(removed);
});
