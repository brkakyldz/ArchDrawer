import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, component, workspace, openDrawing, project, finishRun, baseURL, callout as getCallout } from './helpers';
import { readChoice } from './helpers-drawing';

const drawnOf = async (file: string) => project(await readChoice(file));

test('H33 [AI-1 LOOK-3 #177] record exact changes for add, rename, hold, move and remove, show a hold in the callout and not on the part, and reject invalid scopes without edits', async ({ page, request }) => {
  const doc = drawing('Run ledger');
  doc.views.push({ id: 'inside', title: 'Inside', caption: { title: 'Inside the ledger', lede: '' }, nodes: [component('audit', { label: 'Audit store', kind: 'data' })], edges: [], texts: [] });
  const { file } = await workspace('run-ledger', doc), opened = await openDrawing(page, request, file);
  const baseline = await drawnOf(file), untouched = baseline.views[1];
  const empty = { added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] };
  async function run(instruction: string, scope = { kind: 'view' }, engine: string | null = 'fixture') {
    const response = await request.post(`${baseURL()}/api/runs`, { headers: { 'X-Archdraw-Token': opened.token },
      data: { diagramId: opened.id, view: 'overview', instruction, engine, model: 'fixture-fast', scope } });
    expect(response.status(), await response.text()).toBe(202); return await finishRun(request, (await response.json()).runId, 'succeeded');
  }
  const added = await run('add Cache', { kind: 'all' }, null); expect(added).toMatchObject({ engine: 'fixture', model: 'fixture-fast' });
  const withCache = await drawnOf(file), edge = withCache.views[0].edges.find(e => e.to === 'cache')!;
  expect(added.changes).toEqual({ ...empty, added: ['cache'], edgesAdded: [edge.id] });
  expect((await drawnOf(file)).views[1]).toEqual(untouched);
  await expect(page.getByTestId('node-cache')).toBeVisible();
  const renamed = await run('rename Cache to Fast cache'); expect(renamed.changes).toEqual({ ...empty, changed: ['cache'] });
  await expect(page.getByTestId('node-cache').getByTestId('node-label')).toHaveText('Fast cache');
  const held = await run('hold Recent orders in Fast cache'); expect(held.changes).toEqual({ ...empty, changed: ['cache'] });
  // The part is a panel that holds the row; the row is listed in its callout and the part draws none (ADR 0014).
  await expect(page.getByTestId('node-cache')).toHaveAttribute('data-form', 'panel'); await expect(page.getByTestId('node-cache').getByTestId('node-item')).toHaveCount(0);
  const cacheCallout = await getCallout(page, 'cache');
  await expect(cacheCallout.getByTestId('callout-item')).toHaveText([/Recent orders/]);
  await expect(page.getByTestId('node-cache')).not.toContainText('Recent orders'); // Must not happen: a row drawn on the part.
  await page.keyboard.press('Escape');
  const moved = await run('move Fast cache below Orders DB'); expect(moved.changes).toEqual({ ...empty, moved: ['cache'] });
  const removed = await run('remove Fast cache'); expect(removed.changes).toEqual({ ...empty, removed: ['cache'], edgesRemoved: [edge.id] });
  await expect(page.getByTestId('node-cache')).toHaveCount(0); await expect(page.getByTestId(`edge-${edge.id}`)).toHaveCount(0);
  const noChange = await run('leave the drawing alone'); expect(noChange.changes).toEqual(empty);
  const before = await readFile(file, 'utf8');
  for (const patch of [{ scope: { kind: 'unknown' } }, { scope: { kind: 'parts', ids: ['audit'] } }, { view: 'missing' }, { engine: 'not-installed' }, { model: 123 }, { instruction: '' }, { instruction: 'x'.repeat(4001) }]) {
    const rejected = await request.post(`${baseURL()}/api/runs`, { headers: { 'X-Archdraw-Token': opened.token }, data: {
      diagramId: opened.id, view: 'overview', instruction: 'add Unwanted', engine: 'fixture', model: null, scope: { kind: 'view' }, ...patch,
    } });
    expect(rejected.status()).toBe(400); expect((await rejected.json()).error).toEqual(expect.any(String));
    expect(await readFile(file, 'utf8')).toBe(before);
  }
  expect((await drawnOf(file)).views).toEqual(baseline.views); await expect(page.getByTestId('node-unwanted')).toHaveCount(0);
  // The fixture cannot change connection fields, so non-empty edgesChanged has no oracle here.
});
