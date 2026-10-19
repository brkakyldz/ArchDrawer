import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, isolatedDrawing, readDrawing, finishRun, postViewOf, labelled, ids, download, svgInfo, previewSVG, settledReport } from './helpers';
import { sendControl, terminalEvents, checkReport, reportMatches, postSwitches, postImage, postGeometry, checkReadability } from './helpers-v5';

test('H52 [SHR-1, SHR-3, SHR-9, SHR-10, DEP-5, ASK-9] design a portrait post and download the reported result without changing its source', async ({ page, request }) => {
  const doc = drawing('Support request');
  doc.views[0].nodes.push(component('review'), component('archive'), component('notify'));
  doc.views[0].texts.push({ id: 'private-remark', text: 'Internal review only', x: 20, y: 600, size: 20 });
  const { dir, file } = await workspace('h52', doc);
  const server = await isolatedDrawing(page, request, file, '900');
  try {
    const before = await readDrawing(file);
    await page.getByTestId('ai-button').click(); await page.getByTestId('ai-model').selectOption('fixture-careful');
    await page.getByTestId('ai-close').click(); await page.getByTestId('share-button').click();
    await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('linkedin-flow')).toContainText('Test engine (no AI)');
    await expect(page.getByTestId('linkedin-prepare')).toHaveCount(0);
    const run = await sendControl(page, 'design-post');
    const collecting = terminalEvents(page, server.base, run.id);
    expect(run.body).toMatchObject({ diagramId: server.id, kind: 'post', view: 'overview', format: 'feed',
      engine: 'fixture', model: 'fixture-careful', scope: { kind: 'view' } });
    const running = await (await request.get(`${server.base}/api/runs/${run.id}`)).json();
    expect(running).toMatchObject({ id: run.id, kind: 'post', status: 'running', changes: null, layoutReport: null });
    await expect(page.getByTestId('share-run')).toBeVisible(); await expect(page.getByTestId('design-post')).toBeDisabled();
    await expect(page.getByTestId('share-run-cancel')).toBeVisible();
    await expect(page.getByTestId('share-run')).toContainText(/Reading the drawing|Reading the code|Updating the drawing/);
    const events = await collecting;
    const result = await finishRun(request, run.id, 'succeeded', 60_000, server.base);
    const stored = await readDrawing(file), post = postViewOf(stored, 'overview');
    expect(result).toMatchObject({ kind: 'post', view: post.id, diagramId: server.id, engine: 'fixture', model: 'fixture-careful', error: null });
    expect(result.progress).toEqual(expect.arrayContaining(['Using model fixture-careful', 'Reading the drawing', 'Reading the code', 'Updating the drawing']));
    const done = events.filter(e => e.event === 'done'); expect(done).toHaveLength(1);
    // Live SSE need not replay progress emitted before subscription; GET history proves those lines.
    const progress = events.filter(e => e.event === 'progress');
    expect(progress).toEqual(progress.map(() => ({ event: 'progress', data: expect.objectContaining({ message: expect.any(String) }) })));
    expect(done[0].data).toMatchObject({ status: 'succeeded', diagramId: server.id, view: post.id,
      error: null, changes: result.changes, layoutReport: result.layoutReport });
    expect(stored.views[0]).toEqual(before.views[0]); expect(stored.requests).toEqual(before.requests);
    expect(post.postOf).toBe('overview'); expect(post.texts).toEqual([]);
    const zone = labelled(post, 'App runtime'), loop = labelled(post, 'Work loop');
    expect(zone.form).toBe('group'); expect(zone.parent).toBeNull();
    expect(loop).toMatchObject({ form: 'panel', parent: zone.id, lane: { spine: 2 }, items: ['Propose action', 'Read tool result'] });
    expect(labelled(post, 'Request intake')).toMatchObject({ form: 'panel', lane: { spine: 1 }, items: ['Validate input', 'Bind the scope'] });
    expect(labelled(post, 'Stored facts')).toMatchObject({ form: 'card', parent: zone.id, lane: { anchor: loop.id, side: 'below' } });
    expect(labelled(post, 'Approval')).toMatchObject({ lane: { anchor: labelled(post, 'Result').id, side: 'above' } });
    const partLabels = ['Request', 'Request intake', 'Work loop', 'Result', 'Stored facts', 'Approval'];
    for (const [i, label] of partLabels.entries()) expect(labelled(post, label).from).toEqual([before.views[0].nodes[i].id]);
    expect(ids(stored).length).toBe(new Set(ids(stored)).size);
    const merged = post.edges.find(e => e.from === labelled(post, 'Result').id && e.to === labelled(post, 'Approval').id);
    expect(merged).toMatchObject({ both: true, label: 'review', style: 'async', step: null });
    expect(stored.warnings!.length - before.warnings!.length).toBeGreaterThanOrEqual(1);
    expect(result.changes.added.sort()).toEqual(post.nodes.map(n => n.id).sort());
    expect(result.changes.edgesAdded.sort()).toEqual(post.edges.map(e => e.id).sort());
    expect(result.changes.removed).toEqual([]); expect(result.changes.edgesRemoved).toEqual([]);
    checkReport(result.layoutReport, post, 'feed', true);
    await expect(page.getByTestId('share-dialog')).toBeVisible();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await postSwitches(page); await reportMatches(page, result.layoutReport, 'share-dialog');
    await expect(page.getByTestId('share-actions').getByTestId('layout-report')).toBeVisible();
    const out = join(dir, 'portrait.svg'); await download(page, 'download-svg', out);
    const svg = await readFile(out, 'utf8'), image = await svgInfo(page, svg);
    expect(image).toMatchObject({ width: 1080, height: 1350, format: 'feed', forbidden: false, error: false });
    expect(image.text.join(' ')).not.toContain('Internal review only');
    await postImage(page, svg, post);
    await page.getByTestId('share-part').selectOption(`group:${zone.id}`);
    await expect.poll(() => settledReport(page)).toMatchObject({ parts: 2, zones: 1, connections: 1, view: post.id, format: 'feed' });
    const portion = await svgInfo(page, await previewSVG(page));
    expect(portion.nodes.map(n => n.id).sort()).toEqual([zone.id, loop.id, labelled(post, 'Stored facts').id].sort());
    expect(portion.edges).toHaveLength(1); await checkReadability(page, 1080, 552);
    await page.getByTestId('linkedin-edit').click();
    await postGeometry(page, svg, post);
    expect((await readDrawing(file)).views[0]).toEqual(before.views[0]);
  } finally { await server.close(); }
});
