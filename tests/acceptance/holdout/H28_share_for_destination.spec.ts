import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, saved, svgInfo, previewSVG, previewBoxes, bounds, download, box, overlaps, postViewOf, finishRun } from './helpers';
import { checkReadability } from './helpers-v5';
import { compareSVGs } from './helpers-svg-parity';

test('H28 [SHR-1, SHR-2, SHR-3, SHR-4, SHR-5, SHR-6, SHR-10] preview and download an image for every destination, then design the post and keep its source view', async ({ page, request, context }) => {
  const doc = drawing('Share Shop');
  doc.views[0].nodes.push(component('agent-runtime', { label: 'Agent runtime', form: 'group', place: { row: 0, col: 2 } }),
    component('think', { label: 'Think', kind: 'llm', form: 'compact', parent: 'agent-runtime' }),
    component('act', { label: 'Act', kind: 'gate', form: 'compact', parent: 'agent-runtime' }),
    component('job', { label: 'Order relay', kind: 'worker', place: { row: 0, col: 4 } }),
    component('check', { label: 'Approval', kind: 'gate', place: { row: 0, col: 5 } }),
    component('ops', { label: 'Order telemetry', kind: 'ops', place: { row: 1, col: 5 } }));
  const path = ['web', 'api', 'agent-runtime', 'db', 'job', 'check', 'ops'];
  doc.views[0].edges = path.slice(1).map((to, i) => ({ id: `main-${i}`, from: path[i], to, label: `branch ${String.fromCharCode(65 + i)}`, style: 'call', both: false, step: i + 1 }));
  doc.views[0].edges.push({ id: 'inner', from: 'think', to: 'act', label: 'decide', style: 'call', both: true, step: null },
    { id: 'store', from: 'think', to: 'db', label: 'read', style: 'call', both: false, step: null },
    { id: 'reply', from: 'db', to: 'act', label: 'resume', style: 'async', both: false, step: null });
  doc.views[0].texts.push({ id: 'share-text', text: 'A human can stop the order.', x: 40, y: 600, size: 20 });
  const { dir, file } = await workspace('sharing', doc); await openDrawing(page, request, file);
  const original = await readFile(file, 'utf8'), source = (await readDrawing(file)).views[0];
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('preset-detailed')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['format-feed', 'format-readme', 'format-slide', 'format-square', 'preset-simple', 'preset-detailed']) await expect(page.getByTestId(id)).toBeVisible();
  // The wide post lives behind Advanced options, not among the where-choices.
  await expect(page.getByTestId('share-advanced')).not.toBeVisible(); await expect(page.getByTestId('format-linkedin')).not.toBeVisible();
  await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('share-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('share-advanced').getByTestId('format-linkedin')).toBeVisible();
  for (const id of ['show-title', 'show-items', 'show-steps', 'show-labels', 'show-legend', 'show-texts']) await expect(page.getByTestId('share-advanced').getByTestId(id)).toBeChecked();
  await expect(page.getByTestId('show-lede')).not.toBeChecked();
  const actions = page.getByTestId('share-actions');
  for (const id of ['layout-report', 'readability', 'download-png', 'download-svg', 'copy-image']) await expect(actions.getByTestId(id)).toBeVisible();

  // ADR 0014: measure names and all visible text separately; the meter prints three numbers.
  async function readability(width: number, seen: number) {
    await checkReadability(page, width, seen);
  }
  const formats = [
    { name: 'readme', w: 1600, h: 900, seen: 880 },
    { name: 'slide', w: 1920, h: 1080, seen: 1280 }, { name: 'square', w: 1080, h: 1080, seen: 552 },
  ];
  for (const format of formats) for (const theme of ['light', 'dark']) {
    await page.getByTestId(`format-${format.name}`).click(); await page.getByTestId('preset-detailed').click(); await page.getByTestId(`share-theme-${theme}`).click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', String(format.w)); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', String(format.h));
    await expect(page.getByTestId('share-size')).toHaveText(`${format.w} × ${format.h}`);
    const previewMarkup = await previewSVG(page), preview = await svgInfo(page, previewMarkup);
    expect(preview).toMatchObject({ error: false, width: format.w, height: format.h, theme, format: format.name, xmlns: 'http://www.w3.org/2000/svg', forbidden: false });
    expect(preview.viewBox.trim().split(/[\s,]+/).map(value => Number(value) === 0 ? 0 : Number(value))).toEqual([0, 0, format.w, format.h]);
    expect(preview.nodes.map(n => n.id).sort()).toEqual(source.nodes.map(n => n.id).sort()); expect(preview.edges).toHaveLength(9);
    expect(preview.text.join(' ')).toContain(source.caption.title); expect(preview.text.join(' ')).not.toContain(source.caption.lede);
    const captionBox = await box(page.getByTestId('share-preview').locator('text').filter({ hasText: source.caption.title }));
    // One <g data-node-id> per drawn component, each with its own box: the caption took a free corner
    // and covers none of them. Every component is checked, so the loop can never pass by running empty.
    const drawnNodes = page.getByTestId('share-preview').locator('[data-node-id]');
    await expect(drawnNodes).toHaveCount(source.nodes.length);
    for (let i = 0; i < source.nodes.length; i++) {
      const first = drawnNodes.nth(i).locator('rect').first();
      await expect(first).toHaveCount(1);
      expect(overlaps(captionBox, await box(first)), `caption over component ${i}`).toBe(false);
    }
    expect(preview.text.join(' ')).not.toMatch(/archdrawer|made with/i); expect(preview.text.join(' ')).toContain('A human can stop the order.');
    for (const label of ['Client app', 'API', 'Service', 'Data store', 'AI agent', 'Check', 'Background job', 'Monitoring']) expect(preview.text.filter(t => t === label)).toHaveLength(1);
    await readability(format.w, format.seen);
    const svgPath = join(dir, `${format.name}-${theme}.svg`), result = await download(page, 'download-svg', svgPath);
    expect(result.suggestedFilename()).toBe(`share-shop-overview-${format.name}.svg`);
    await compareSVGs(page, previewMarkup, await readFile(svgPath, 'utf8'), source.edges);
    const pngPath = join(dir, `${format.name}-${theme}.png`), pngDownload = await download(page, 'download-png', pngPath);
    expect(pngDownload.suggestedFilename()).toBe(`share-shop-overview-${format.name}.png`); const png = await readFile(pngPath);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(png.readUInt32BE(16)).toBe(format.w * 2); expect(png.readUInt32BE(20)).toBe(format.h * 2);
  }
  await page.getByTestId('preset-simple').click();
  for (const id of ['show-title', 'show-lede', 'show-steps', 'show-texts']) await expect(page.getByTestId(id)).toBeChecked();
  for (const id of ['show-items', 'show-labels', 'show-legend']) await expect(page.getByTestId(id)).not.toBeChecked();
  await page.getByTestId('show-title').uncheck(); await page.getByTestId('show-steps').uncheck(); await page.getByTestId('show-texts').uncheck();
  const toggled = await svgInfo(page, await previewSVG(page));
  expect(toggled.text.join(' ')).not.toContain(source.caption.title); expect(toggled.text.join(' ')).toContain(source.caption.lede);
  for (const absent of ['A human can stop the order.', 'Validate order', 'branch A', 'Client app', 'API', 'Data store']) expect(toggled.text).not.toContain(absent);
  expect(toggled.nodes.find(n => n.id === 'api')!.height).toBeLessThan(108); await readability(1080, 552);
  expect(await readFile(file, 'utf8')).toBe(original); // Export settings have not edited any view.

  // Both post sizes: portrait by default, the wide one from Advanced options.
  await page.getByTestId('format-feed').click(); await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('linkedin-flow')).toBeVisible();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  await page.getByTestId('format-linkedin').click();
  await expect(page.getByTestId('format-linkedin')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1620'); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1080');
  await expect(page.getByTestId('linkedin-flow')).toBeVisible();
  await page.getByTestId('format-feed').click(); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
  // Ask the post for everything the drawing can show, so the image rules below are tested with content on.
  for (const id of ['show-title', 'show-lede', 'show-items', 'show-steps', 'show-labels', 'show-texts']) await page.getByTestId(id).check();
  await page.getByTestId('show-legend').uncheck();

  // The engine designs the post; the deterministic path is only for a machine without engines.
  await expect(page.getByTestId('design-post')).toHaveText('Design the post'); await expect(page.getByTestId('linkedin-prepare')).toHaveCount(0);
  const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('design-post').click(); const started = await waiting; expect(started.status()).toBe(202);
  expect(started.request().postDataJSON()).toMatchObject({ kind: 'post', view: 'overview', format: 'feed', engine: 'fixture', scope: { kind: 'view' } });
  const designed = await finishRun(request, (await started.json()).runId, 'succeeded', 60_000);
  await expect(page.getByTestId('share-dialog')).toBeVisible();
  await persisted(file, d => d.views.length === 2);
  const post = postViewOf(await readDrawing(file), 'overview');
  expect(post.id).toBe('overview-linkedin'); expect(designed.view).toBe(post.id);
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-width', '1080'); await expect(page.getByTestId('share-preview')).toHaveAttribute('data-height', '1350');
  expect((await readDrawing(file)).views[0]).toEqual(source); // Designing a post never rewrites its source.

  // Nothing is drawn under a post's drawing: no steps list, no takeaway, no key strip.
  await expect(page.getByTestId('share-preview').locator('[data-caption="step"]')).toHaveCount(0);
  const drawn = bounds([...await previewBoxes(page, 'g[data-node-id]'), ...await previewBoxes(page, 'g[data-edge-id]')]);
  for (const text of await previewBoxes(page, 'text')) expect(text.y, text.text).toBeLessThan(drawn.bottom);
  const captionTitle = (await previewBoxes(page, 'text')).filter(t => t.text.includes(post.caption.title));
  expect(captionTitle.length).toBeGreaterThan(0); expect(Math.min(...captionTitle.map(t => t.y))).toBeLessThan(drawn.top);
  await readability(1080, 552);

  // Re-arrange places the same parts again, without an engine and without changing what they show.
  const beforeArrange = post.nodes.map(n => ({ label: n.label, form: n.form, items: n.items, from: n.from }));
  const runCalls: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') runCalls.push(r.url()); });
  await page.getByTestId('arrange-feed').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
  await saved(page); expect(runCalls).toEqual([]);
  const arranged = postViewOf(await readDrawing(file), 'overview');
  expect(arranged.nodes.map(n => ({ label: n.label, form: n.form, items: n.items, from: n.from }))).toEqual(beforeArrange);
  const feedSVG = join(dir, 'feed.svg'), feedDownload = await download(page, 'download-svg', feedSVG);
  expect(feedDownload.suggestedFilename()).toBe('share-shop-overview-linkedin-feed.svg');
  const downloaded = await readFile(feedSVG, 'utf8'); expect(downloaded).not.toContain('data-caption="step"');
  const feed = await svgInfo(page, downloaded); expect(feed).toMatchObject({ width: 1080, height: 1350, format: 'feed', forbidden: false });
  expect(feed.text.join(' ')).not.toMatch(/archdrawer|made with/i); expect(feed.text.join(' ')).not.toContain('A human can stop the order.');
  const feedPNG = join(dir, 'feed.png'); await download(page, 'download-png', feedPNG); const png = await readFile(feedPNG);
  expect(png.readUInt32BE(16)).toBe(2160); expect(png.readUInt32BE(20)).toBe(2700);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.getByTestId('copy-image').click(); await expect(page.getByTestId('toast')).toContainText(/copied|not allowed/i);
  if (/copied/i.test(await page.getByTestId('toast').innerText())) expect(await page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png')))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  const end = await readDrawing(file); expect(end.views[0]).toEqual(source); expect(end.views).toHaveLength(2);
});
