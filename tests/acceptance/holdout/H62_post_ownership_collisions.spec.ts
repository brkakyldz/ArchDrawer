import { test, expect } from '@playwright/test';
import { drawing, component, workspace, openDrawing, readDrawing, startKind, finishRun, postViewOf, labelled, ids, baseURL } from './helpers';
import { sendControl } from './helpers-v5';

test('H62 [SHR-3, SHR-9, DEP-5, SHR-10] allocate a bounded post around a legacy collision and resolve its full source after reload', async ({ page, request }) => {
  const doc = drawing('Long source identity'), sourceId = 's'.repeat(64), collisionId = `${sourceId.slice(0, 55)}-linkedin`;
  doc.views[0].id = sourceId;
  doc.views.push({ id: collisionId, title: 'Hand written legacy post', caption: { title: 'Keep the hand written post', lede: 'This is separate work.' },
    nodes: [component('legacy-node', { x: 160, y: 120 })], edges: [], texts: [{ id: 'legacy-note', text: 'Keep me', x: 40, y: 40, size: 20 }] });
  const { file } = await workspace('h62', doc), opened = await openDrawing(page, request, file);
  const before = await readDrawing(file);
  await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', sourceId);
  const first = await sendControl(page, 'design-post'), result = await finishRun(request, first.id, 'succeeded');
  let stored = await readDrawing(file), post = postViewOf(stored, sourceId);
  const expectedId = `${sourceId.slice(0, 53)}-2-linkedin`;
  expect(post.id).toBe(expectedId); expect(post.id.length).toBeLessThanOrEqual(64); expect(result.view).toBe(post.id);
  expect(stored.views.find(v => v.id === collisionId)).toEqual(before.views[1]); expect(stored.views[0]).toEqual(before.views[0]);
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', expectedId);
  await page.reload(); await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', expectedId);
  const second = await sendControl(page, 'explain-feed'); expect(second.body).toMatchObject({ kind: 'post', view: expectedId });
  const redesigned = await finishRun(request, second.id, 'succeeded'); expect(redesigned.view).toBe(expectedId);
  stored = await readDrawing(file); post = postViewOf(stored, sourceId);
  expect(labelled(post, 'Request').from).toEqual(['web']); // The context is the full source, not the generated post's first node.
  expect(stored.views).toHaveLength(3); expect(stored.views[0]).toEqual(before.views[0]);
  expect(stored.views.find(v => v.id === collisionId)).toEqual(before.views[1]);
  const beforeLegacyRun = await readDrawing(file);
  const legacyRun = await startKind(request, opened.token, { diagramId: opened.id, kind: 'post', view: collisionId, engine: 'fixture', model: null });
  const legacyResult = await finishRun(request, legacyRun, 'succeeded');
  stored = await readDrawing(file); const associated = postViewOf(stored, collisionId);
  expect(associated.id).not.toBe(collisionId); expect(associated.id).not.toBe(expectedId);
  expect(associated.id.length).toBeLessThanOrEqual(64); expect(legacyResult.view).toBe(associated.id);
  expect(labelled(associated, 'Request').from).toEqual(['legacy-node']);
  for (const unchanged of beforeLegacyRun.views) expect(stored.views.find(v => v.id === unchanged.id)).toEqual(unchanged);
  expect(new Set(ids(stored)).size).toBe(ids(stored).length);
  const image = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=${collisionId}&format=feed`);
  expect(image.status()).toBe(200); expect(await image.text()).toContain('Keep the hand written post');
});
