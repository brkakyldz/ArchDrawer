import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, readDrawing, baseURL, download, svgInfo, settledReport } from './helpers';
import { drawnNodeBoxes, paintedTextField, visibleTextContent } from './helpers-v9';

test('H76 [LAY-1, SHR-3, SHR-6, SHR-7, SHR-10] widen a post card for its sub-line and draw the same size in the editor', async ({ page, request }) => {
  const doc = drawing('Card sub-line room'); let sub = 'M';
  doc.views.push({ id: 'width-post', title: 'Post', postOf: 'overview', caption: { title: 'Card room', lede: '' }, texts: [], edges: [],
    nodes: [component('plain', { label: 'Work', x: 0, y: 0 }), component('wider', { label: 'Work', sub, x: 400, y: 0 })] });
  const { dir, file } = await workspace('h76', doc), opened = await openDrawing(page, request, file);
  await page.getByTestId('views-button').click(); await page.getByTestId('view-item-width-post').click();
  await page.evaluate(async () => { await document.fonts.ready; });
  // Select input wider than the whole default card; actual drawn ink decides the widening assertion.
  const probe = await page.getByTestId('node-wider').getByTestId('node-sub').evaluate(async el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let run: Node | null, leaf: Element | null = null;
    while ((run = walker.nextNode())) if (run.textContent === 'M') { leaf = run.parentElement; break; }
    if (!leaf) throw new Error('Missing actual M sub-line text run');
    const style = getComputedStyle(leaf), text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    // Copy the leaf's typography: the surrounding text element may carry the larger name font.
    for (const key of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing'])
      text.style.setProperty(key, style.getPropertyValue(key));
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, 'M');
    el.closest('svg')!.append(text);
    try {
      let candidate = { sub: '', width: 0 };
      for (let length = 1; length <= 60; length++) {
        text.textContent = 'M'.repeat(length);
        candidate = { sub: text.textContent, width: text.getBBox().width };
        if (candidate.width > 176) break;
      }
      return { ...candidate, font: style.fontSize, family: style.fontFamily, weight: style.fontWeight };
    } finally { text.remove(); }
  });
  expect(probe.width, `canvas input calibration glyph px: ${JSON.stringify(probe)}`).toBeGreaterThan(0);
  sub = probe.sub;
  const edit = await readDrawing(file); edit.views[1].nodes.find(n => n.id === 'wider')!.sub = sub;
  const put = await request.put(`${baseURL()}/api/diagrams/${opened.id}`, {
    headers: { 'X-Archdraw-Token': opened.token, 'If-Unmodified-Since-Version': edit.updatedAt! }, data: edit,
  });
  expect(put.status()).toBe(200);
  await page.reload(); await page.getByTestId('views-button').click(); await page.getByTestId('view-item-width-post').click();
  await expect(page.getByTestId('node-wider')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  const editor = await drawnNodeBoxes(page.getByTestId('canvas')); expect(editor).toHaveLength(2);
  const canvasSub = (await page.getByTestId('node-wider').getByTestId('node-sub').allTextContents()).join('').replace(/\s/g, '');
  const stored = await readDrawing(file), baseline = await readFile(file, 'utf8');
  const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=width-post&format=readme`);
  expect(response.status()).toBe(200);
  const http = await svgInfo(page, await response.text()); expect(http.nodes).toHaveLength(2);
  // Browser downloads embed the bundled font; HTTP need not. Measure glyph room in the font-bearing download.
  await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'width-post');
  const preview = await drawnNodeBoxes(page.getByTestId('share-preview')); expect(preview).toHaveLength(2);
  const report = await settledReport(page);
  const out = join(dir, 'width.svg'); await download(page, 'download-svg', out);
  const holder = await page.context().newPage();
  try {
    await holder.setContent(`<!doctype html><html><body style="margin:0">${await readFile(out, 'utf8')}</body></html>`);
    await holder.evaluate(async () => { await document.fonts.ready; });
    const boxes = await drawnNodeBoxes(holder.locator('svg')); expect(boxes).toHaveLength(2);
    const plain = boxes.find(b => b.nodeId === 'plain')!, wider = boxes.find(b => b.nodeId === 'wider')!;
    const dimensions = `downloaded SVG card-local px; diagram-v2: "card 176 × 84, widening up to 204 for its sub-line"; ${JSON.stringify({ input: probe, cards: boxes })}`;
    expect([plain.localWidth, plain.localHeight], dimensions).toEqual([176, 84]);
    const subline = async (surface: Parameters<typeof visibleTextContent>[0]) => {
      const content = (await visibleTextContent(surface)).find(n => n.key === 'wider')!.content.map(c => c[0]).join('');
      expect(content, 'wider card retains its Work name').toMatch(/^Work/);
      return content.slice('Work'.length);
    };
    const drawnSub = await subline(holder.locator('svg'));
    const field = drawnSub ? await paintedTextField(holder.locator('svg'), 'wider', drawnSub) : null;
    const evidence = `downloaded SVG card-local px; "card 176 × 84, widening up to 204 for its sub-line"; "The editor draws a post view with the post style too, so canvas and export agree."; ${JSON.stringify({ sub, probe, drawnSub, field, card: wider, canvasSub, canvas: editor, preview, http: http.nodes, report })}`;
    expect(wider.localWidth, evidence).toBeGreaterThanOrEqual(176); expect(wider.localWidth, evidence).toBeLessThanOrEqual(204);
    expect(wider.localHeight, evidence).toBe(84);
    if (field) {
      expect(field.room.width, evidence).toBeGreaterThan(0);
      expect(field.room.left, evidence).toBeGreaterThanOrEqual(-0.3);
      expect(field.room.right, evidence).toBeLessThanOrEqual(wider.localWidth + 0.3);
      // Ink wider than 176 cannot fit a 176 card; no padding or metrics-to-browser margin is assumed.
      if (field.room.width > 176) expect(wider.localWidth, evidence).toBeGreaterThan(176);
    }
    expect(canvasSub, `canvas vs downloaded SVG text; ${evidence}`).toBe(drawnSub);
    expect(await subline(page.getByTestId('share-preview')), `preview vs downloaded SVG text; ${evidence}`).toBe(drawnSub);
    if (drawnSub !== sub) {
      expect(report.cut, `api-v2: "every actual shortened or omitted non-empty text"; ${evidence}`).toBeGreaterThanOrEqual(1);
      if (drawnSub) {
        expect(drawnSub, evidence).toMatch(/…$/);
        expect(sub.startsWith(drawnSub.slice(0, -1)), evidence).toBe(true);
        await expect(page.getByTestId('share-clipped'), evidence).toBeVisible();
        await expect(page.getByTestId('share-clipped-item').filter({ hasText: sub }),
          `SHR-7: "listed as a warning beside the download"; ${evidence}`).toContainText(`Work: ${sub}`);
      }
    } else {
      expect(report.cut, evidence).toBe(0);
      await expect(page.getByTestId('share-clipped-item').filter({ hasText: sub }), evidence).toHaveCount(0);
    }
    for (const exported of boxes) {
      const canvas = editor.find(b => b.nodeId === exported.nodeId); expect(canvas, evidence).toBeTruthy();
      expect([canvas!.localWidth, canvas!.localHeight], `canvas vs downloaded SVG intrinsic dimensions; ${evidence}`).toEqual([exported.localWidth, exported.localHeight]);
      const inPreview = preview.find(b => b.nodeId === exported.nodeId); expect(inPreview, evidence).toBeTruthy();
      expect([inPreview!.localWidth, inPreview!.localHeight], `preview vs downloaded SVG intrinsic dimensions; ${evidence}`).toEqual([exported.localWidth, exported.localHeight]);
      const overHTTP = http.nodes.find(n => n.id === exported.nodeId); expect(overHTTP, evidence).toBeTruthy();
      expect([overHTTP!.width, overHTTP!.height], `HTTP SVG vs downloaded SVG intrinsic dimensions; ${evidence}`).toEqual([exported.localWidth, exported.localHeight]);
    }
  } finally { await holder.close(); }
  expect((await readDrawing(file)).views).toEqual(stored.views); expect(await readFile(file, 'utf8')).toBe(baseline);
});
