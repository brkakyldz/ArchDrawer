import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, startKind, finishRun, postViewOf, labelled, previewBoxes, download, box, overlaps, baseURL } from './helpers';
import { checkReadability, exportedBadgeLabels } from './helpers-v5';

test('H45 [LAY-6, LAY-7, SHR-10] keep a step badge clear of every drawn label and reserve no room for a label nobody sees', async ({ page, request }) => {
  const doc = drawing('Badge shop'), view = doc.views[0];
  view.nodes = ['Front', 'Intake', 'Worker', 'Store', 'Watcher', 'Owner'].map((label, i) => component(`part-${i}`, {
    label, kind: ['client', 'api', 'worker', 'data', 'ops', 'actor'][i], place: { row: i > 3 ? -1 : 0, col: i % 4 },
  }));
  view.nodes[1].form = 'panel'; view.nodes[1].items = ['Check it'];
  view.edges = [
    { id: 'g1', from: 'part-0', to: 'part-1', label: 'Send the request', style: 'call', both: false, step: 1 },
    { id: 'g2', from: 'part-1', to: 'part-2', label: 'Hand the work over', style: 'call', both: false, step: 2 },
    { id: 'g3', from: 'part-2', to: 'part-3', label: 'Keep the result', style: 'call', both: false, step: 3 },
    { id: 'g4', from: 'part-1', to: 'part-4', label: 'Record a trace', style: 'dep', both: false, step: null },
  ];
  const { dir, file } = await workspace('badges', doc); const opened = await openDrawing(page, request, file);
  const designed = await finishRun(request, await startKind(request, opened.token, {
    diagramId: opened.id, view: 'overview', kind: 'post', format: 'feed', engine: 'fixture', model: null, scope: { kind: 'view' },
  }), 'succeeded', 60_000);
  await persisted(file, d => d.views.length === 2);
  const post = postViewOf(await readDrawing(file), 'overview'); expect(designed.view).toBe(post.id);
  const numbered = post.edges.filter(edge => edge.step !== null); expect(numbered).toHaveLength(3);
  const labelledEdges = post.edges.filter(edge => edge.label !== '');
  expect(labelledEdges.length).toBeGreaterThan(0);

  // In the editor: every step badge keeps clear of every label that is actually drawn.
  await page.goto(`${baseURL()}/d/${opened.id}?view=${post.id}`);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', post.id);
  await page.getByTestId('tool-steps').click(); await expect(page.getByTestId('tool-steps')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    if (await page.getByTestId('canvas').getAttribute('data-detail') !== 'full') await page.getByTestId('zoom-in').click();
    return page.getByTestId('canvas').getAttribute('data-detail');
  }).toBe('full');
  for (const edge of numbered) await expect(page.getByTestId(`step-badge-${edge.id}`)).toHaveText(String(edge.step));
  let comparisons = 0, drawnLabels = 0;
  for (const other of labelledEdges) {
    const label = page.getByTestId(`edge-label-${other.id}`);
    if (!await label.count()) continue; // A label with no free spot is legitimately absent.
    await expect(label).toBeVisible();
    const visible = await label.evaluate(el => {
      for (let part: Element | null = el; part; part = part.parentElement) {
        const style = getComputedStyle(part);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    });
    expect(visible, other.id).toBe(true); drawnLabels++;
    for (const edge of numbered) {
      comparisons++;
      expect(overlaps(await box(page.getByTestId(`step-badge-${edge.id}`)), await box(label)), `badge ${edge.id} over label ${other.id}`).toBe(false);
    }
  }
  expect(drawnLabels).toBeGreaterThan(0); expect(comparisons).toBe(numbered.length * drawnLabels);

  // In the share image: the same rule, measured in image pixels.
  await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await page.getByTestId('share-advanced-toggle').click();
  await page.getByTestId('show-steps').check(); await page.getByTestId('show-labels').check();
  const badgeBoxes = await previewBoxes(page, '[data-testid^="step-badge-"]');
  const labelBoxes = await previewBoxes(page, '[data-testid^="edge-label-"]');
  expect(badgeBoxes.length).toBe(numbered.length); expect(labelBoxes.length).toBeGreaterThan(0);
  for (const badge of badgeBoxes) for (const label of labelBoxes) expect(overlaps(badge, label), `${badge.testId} over ${label.testId}`).toBe(false);

  // Measure the whole exported badge, including associated background paint.
  const exportedPath = join(dir, 'badges-feed.svg');
  expect((await download(page, 'download-svg', exportedPath)).suggestedFilename()).toBe('badge-shop-overview-linkedin-feed.svg');
  await exportedBadgeLabels(page, await readFile(exportedPath, 'utf8'), post);

  // H55 exercises a non-empty spine label; the canned spine labels here are empty.
  await expect(page.getByTestId('share-preview').locator('[data-testid^="edge-label-"]')).toContainText(['review']);
  const spineA = labelled(post, 'Request').id, spineB = labelled(post, 'Request intake').id;
  async function spineGap() {
    const shapes = await previewBoxes(page, 'g[data-node-id]');
    const first = shapes.find(shape => shape.nodeId === spineA)!, second = shapes.find(shape => shape.nodeId === spineB)!;
    expect(first.x).toBeLessThan(second.x);
    return (second.x - (first.x + first.width)) / first.width;
  }
  // A drawn label got room of its own: ui-v2 draws no label over a component (a zone's box is its
  // children's, so a label beside a member legitimately falls inside it and is left out here).
  const zones = new Set(post.nodes.filter(node => node.form === 'group').map(node => node.id));
  const parts = (await previewBoxes(page, 'g[data-node-id]')).filter(shape => !zones.has(shape.nodeId));
  expect(parts.length).toBeGreaterThan(0);
  for (const label of labelBoxes) for (const part of parts) {
    expect(overlaps(label, part), `label ${label.testId} over part ${part.nodeId}`).toBe(false);
  }
  const withLabels = await spineGap(), reportWithLabels = await checkReadability(page, 1080, 552);
  await page.getByTestId('show-labels').uncheck();
  await expect(page.getByTestId('share-preview').locator('[data-testid^="edge-label-"]')).toHaveCount(0);
  // The approval sub-line still says "review the action"; only connection labels are hidden.
  await expect(page.getByTestId('share-preview').locator(`[data-node-id="${labelled(post, 'Approval').id}"]`)).toContainText('review the action');
  const withoutLabels = await spineGap(), reportWithoutLabels = await checkReadability(page, 1080, 552);
  // diagram-v2 LAY-6: a hidden label reserves no gap, and showing one reserves only its measured box.
  // So hiding it can never widen the gap; it need not narrow it, because the gap the layout already
  // needs may be wider than the label itself.
  expect(withoutLabels, 'a hidden label reserves no gap').toBeLessThanOrEqual(withLabels + 0.001);
  // Hidden text is not cut text; each meter above is checked against its actual fitted image.
  expect(reportWithoutLabels.cut).toBeLessThanOrEqual(reportWithLabels.cut);
  expect(reportWithoutLabels.connections).toBe(reportWithLabels.connections);
  // Hiding a label is an export switch, never an edit of the drawing.
  expect(postViewOf(await readDrawing(file), 'overview')).toEqual(post);
});
