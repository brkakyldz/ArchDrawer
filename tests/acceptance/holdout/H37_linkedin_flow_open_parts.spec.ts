import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, isolatedDrawing, readDrawing, persisted, previewSVG, svgInfo, previewBoxes, bounds, download, drag, finishRun, overlaps, postViewOf, labelled, ids } from './helpers';
import { postSwitches } from './helpers-v5';
import { compareSVGs } from './helpers-svg-parity';

test('H37 [SHR-1, SHR-3, SHR-7, SHR-9, SHR-10, ASK-5, ASK-9, VIEW-7, EDT-6, PER-1] design a post for LinkedIn, edit its full caption and re-arrange only that version', async ({ page, request }) => {
  const doc = drawing('LinkedIn shop'), view = doc.views[0];
  view.nodes.push(component('order-runtime', { label: 'Order runtime', form: 'group', place: { row: 0, col: 2 } }),
    component('validator', { label: 'Validate order', parent: 'order-runtime', form: 'compact', kind: 'gate' }),
    component('writer', { label: 'Store order', parent: 'order-runtime', form: 'compact' }),
    component('relay', { label: 'Order relay', kind: 'worker', sub: 'Send accepted orders', place: { row: 0, col: 4 } }),
    component('metrics', { label: 'Metrics sink', kind: 'ops', description: 'No description yet.', place: { row: -1, col: 1 } }));
  view.edges = [
    { id: 'story-1', from: 'web', to: 'api', label: 'Send an order to the shop', style: 'call', both: true, step: 9 },
    { id: 'story-2', from: 'api', to: 'order-runtime', label: 'Check and accept the order', style: 'call', both: false, step: 23 },
    { id: 'story-3', from: 'order-runtime', to: 'db', label: 'Keep the accepted order safe', style: 'call', both: false, step: 40 },
    { id: 'story-4', from: 'db', to: 'relay', label: 'Send it to the fulfilment team', style: 'async', both: false, step: 72 },
    { id: 'cross', from: 'api', to: 'db', label: 'Read past orders', style: 'dep', both: false, step: null },
    { id: 'observe', from: 'api', to: 'metrics', label: 'Record a trace', style: 'dep', both: false, step: null },
    { id: 'inside', from: 'validator', to: 'writer', label: 'Validated', style: 'call', both: false, step: null },
  ];
  view.texts.push({ id: 'editor-only', text: 'Internal review remark', x: 40, y: 680, size: 20 });
  const { dir, file } = await workspace('linkedin-story', doc), server = await isolatedDrawing(page, request, file);
  try {
    const baseline = await readDrawing(file), source = baseline.views[0];
    await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1080'); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
    // An engine is available, so the engine designs the post and the test engine is named as one.
    await expect(page.getByTestId('design-post')).toHaveText('Design the post');
    await expect(page.getByTestId('linkedin-flow')).toContainText('Test engine (no AI)');
    await expect(page.getByTestId('linkedin-prepare')).toHaveCount(0);
    const designing = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
    await page.getByTestId('design-post').click(); const started = await designing; expect(started.status()).toBe(202);
    expect(started.request().postDataJSON()).toMatchObject({ kind: 'post', view: 'overview', format: 'feed', engine: 'fixture', scope: { kind: 'view' } });
    await expect(page.getByTestId('share-run')).toContainText(/Reading the drawing|Reading the code|Updating the drawing/);
    await expect(page.getByTestId('share-run-cancel')).toBeVisible(); await expect(page.getByTestId('design-post')).toBeDisabled();
    const designed = await finishRun(request, (await started.json()).runId, 'succeeded', 60_000, server.base);
    await expect(page.getByTestId('share-dialog')).toBeVisible(); await expect(page.getByTestId('share-run')).not.toBeVisible();
    await persisted(file, d => d.views.length === 2);
    let stored = await readDrawing(file); const post = postViewOf(stored, 'overview');
    expect(post.id).toBe('overview-linkedin'); expect(designed.view).toBe(post.id);
    // diagram-v2 (Relations and conversion): the caption carries the story's title and lede and texts
    // start empty. The engine-made post's own view title is not fixed by any contract, only its length.
    expect(post.texts).toEqual([]); expect(post.title.length).toBeGreaterThan(0); expect(post.title.length).toBeLessThanOrEqual(60);
    expect(stored.views[0]).toEqual(source);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
    await expect(page.getByTestId('share-dialog').getByTestId('layout-report')).toBeVisible();
    // Parts that hold something open as panels; the zone is a group; the rest are cards.
    expect(labelled(post, 'Request intake')).toMatchObject({ form: 'panel', items: ['Validate input', 'Bind the scope'] });
    expect(labelled(post, 'Work loop')).toMatchObject({ form: 'panel', items: ['Propose action', 'Read tool result'] });
    for (const label of ['Request', 'Result', 'Stored facts', 'Approval']) expect(labelled(post, label).form).toBe('card');
    expect(labelled(post, 'App runtime').form).toBe('group');
    expect(labelled(post, 'Work loop').parent).toBe(labelled(post, 'App runtime').id);
    expect(ids(stored)).toHaveLength(new Set(ids(stored)).size);
    await postSwitches(page);
    const image = await svgInfo(page, await previewSVG(page));
    expect(image.nodes.find(n => n.id === labelled(post, 'Request intake').id)!.text.join(' ')).toContain('Validate input');
    expect(image.text.join(' ')).not.toContain('Internal review remark'); // Texts never travel into the post.

    const title = 'How a customer order reaches the people who check it, store it safely and send it to the fulfilment team';
    const lede = 'An order travels from the storefront through the intake and the runtime, reaches durable storage, then arrives with the team that prepares it, while a separate trace records what happened along the way.';
    async function writtenText(locator: Locator) {
      return await locator.evaluate(el => Array.from(el.querySelectorAll('text')).map(text => {
        const spans = Array.from(text.querySelectorAll('tspan')); return spans.length ? spans.map(span => span.textContent ?? '').join(' ') : text.textContent ?? '';
      }).join(' ').replace(/\s+/g, ' ').trim());
    }
    await page.getByTestId('share-caption-title').fill(title); await page.getByTestId('share-caption-lede').fill(lede);
    await expect.poll(() => writtenText(page.getByTestId('share-preview'))).toContain(title); await expect.poll(() => writtenText(page.getByTestId('share-preview'))).toContain(lede);
    await persisted(file, d => postViewOf(d, 'overview').caption.title === title && postViewOf(d, 'overview').caption.lede === lede);
    // Nothing is written under a post's drawing, and its badges stay inside it.
    await expect(page.getByTestId('share-preview').locator('[data-caption="step"]')).toHaveCount(0);
    const drawn = bounds([...await previewBoxes(page, 'g[data-node-id]'), ...await previewBoxes(page, 'g[data-edge-id]')]);
    for (const text of await previewBoxes(page, 'text')) expect(text.y, text.text).toBeLessThan(drawn.bottom);
    const badges = await previewBoxes(page, '[data-testid^="step-badge-"]');
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.x).toBeGreaterThanOrEqual(drawn.left - 1); expect(badge.x + badge.width).toBeLessThanOrEqual(drawn.right + 1);
      expect(badge.y).toBeGreaterThanOrEqual(drawn.top - 1); expect(badge.y + badge.height).toBeLessThanOrEqual(drawn.bottom + 1);
    }
    expect((await svgInfo(page, await previewSVG(page))).text.join(' ')).not.toContain('…');

    const beforeRewrite = (await readDrawing(file)).views;
    const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
    await page.getByTestId('explain-feed').click(); const rewriting = await waiting; expect(rewriting.status()).toBe(202);
    expect(rewriting.request().postDataJSON()).toMatchObject({ kind: 'post', engine: 'fixture', view: post.id, scope: { kind: 'view' } });
    await expect(page.getByTestId('share-run')).toContainText(/Reading the drawing|Reading the code|Updating the drawing/); await expect(page.getByTestId('share-dialog')).toBeVisible();
    const rewritten = await finishRun(request, (await rewriting.json()).runId, 'succeeded', 60_000, server.base);
    expect(rewritten.view).toBe(post.id); // The redesign resolves its source through postOf and keeps the post's id.
    await expect(page.getByTestId('share-run')).not.toBeVisible();
    await persisted(file, d => postViewOf(d, 'overview').caption.title === 'How a request becomes a result');
    stored = await readDrawing(file); expect(stored.views[0]).toEqual(source); expect(stored.views).toHaveLength(2);
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);

    await page.getByTestId('linkedin-edit').click(); await expect(page.getByTestId('share-dialog')).not.toBeVisible();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-view', post.id);
    const intake = labelled(postViewOf(await readDrawing(file), 'overview'), 'Request intake');
    await drag(page, page.getByTestId(`node-${intake.id}`), 48, 24);
    await persisted(file, d => labelled(postViewOf(d, 'overview'), 'Request intake').x !== intake.x);
    const moved = postViewOf(await readDrawing(file), 'overview');
    await page.getByTestId('share-button').click(); await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id); await expect(page.getByTestId('linkedin-prepare')).toHaveCount(0);
    await expect(page.getByTestId('design-post')).toBeVisible();
    await page.getByTestId('arrange-feed').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
    await persisted(file, d => labelled(postViewOf(d, 'overview'), 'Request intake').x !== labelled(moved, 'Request intake').x);
    const arranged = postViewOf(await readDrawing(file), 'overview'), arrangedMarkup = await previewSVG(page), arrangedImage = await svgInfo(page, arrangedMarkup);
    expect(arranged.nodes.map(n => ({ id: n.id, form: n.form, items: n.items, from: n.from, lane: n.lane })))
      .toEqual(moved.nodes.map(n => ({ id: n.id, form: n.form, items: n.items, from: n.from, lane: n.lane })));
    // No two unrelated parts overlap. A zone is skipped against its own members: diagram-v2's Geometry
    // makes a group's box its children's bounding box plus padding and a header, so it always covers them.
    const parentOf = new Map(arranged.nodes.map(n => [n.id, n.parent] as const));
    const within = (node: string, group: string) => {
      let at = parentOf.get(node) ?? null;
      while (at) { if (at === group) return true; at = parentOf.get(at) ?? null; }
      return false;
    };
    for (const [i, a] of arranged.nodes.entries()) for (const b of arranged.nodes.slice(i + 1)) {
      if (within(a.id, b.id) || within(b.id, a.id)) continue;
      const sa = arrangedImage.nodes.find(n => n.id === a.id)!, sb = arrangedImage.nodes.find(n => n.id === b.id)!;
      expect(overlaps({ x: a.x!, y: a.y!, width: sa.width, height: sa.height }, { x: b.x!, y: b.y!, width: sb.width, height: sb.height }),
        `${a.label} and ${b.label}`).toBe(false);
    }
    const output = join(dir, 'linkedin.svg'), exported = await download(page, 'download-svg', output);
    expect(exported.suggestedFilename()).toBe('linkedin-shop-overview-linkedin-feed.svg');
    await compareSVGs(page, arrangedMarkup, await readFile(output, 'utf8'), arranged.edges);
    await page.getByTestId('share-close').click(); await page.getByTestId('tool-undo').click();
    await persisted(file, d => labelled(postViewOf(d, 'overview'), 'Request intake').x === labelled(moved, 'Request intake').x);
    expect((await readDrawing(file)).views[0]).toEqual(source); expect(beforeRewrite[0]).toEqual(source);
    await page.getByTestId('views-button').click(); await expect(page.getByTestId(`view-item-${post.id}`)).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('view-item-overview').click(); await expect(page.getByTestId('node-order-runtime')).toHaveAttribute('data-form', 'group');
    expect((await readDrawing(file)).views).toHaveLength(2);
  } finally { await server.close(); }
});
