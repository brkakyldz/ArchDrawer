import { test, expect } from '@playwright/test';
import { drawing, component, workspace, openDrawing, readDrawing, previewSVG, svgInfo, baseURL } from './helpers';
import { previewTextSizes, checkReadability } from './helpers-v5';

test('H64 [SHR-4, SHR-10] distinguish readable names from readable detail and print the three measured sizes', async ({ page, request }) => {
  const doc = drawing('Readability levels');
  doc.views[0].nodes = [component('start', { label: 'Start', x: 0, y: 0 }), component('finish', { label: 'Finish', x: 1400, y: 0 })];
  doc.views[0].edges = [];
  doc.views[0].texts = [{ id: 'detail', text: 'Detail', x: 0, y: 220, size: 16 }];
  const { file } = await workspace('h64', doc), opened = await openDrawing(page, request, file);
  async function share() {
    await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
    if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
    for (const id of ['title', 'lede', 'items', 'steps', 'labels', 'legend']) await page.getByTestId(`show-${id}`).uncheck();
    await page.getByTestId('show-texts').check();
  }
  await share();
  const initial = await previewTextSizes(page), names = initial.runs.filter(r => r.name);
  expect(names.length).toBeGreaterThan(0);
  const nameFont = Math.min(...names.map(r => r.font)); expect(nameFont).toBeGreaterThan(0);
  const detailSize = Math.max(8, Math.min(200, nameFont * 0.8));
  const goodNames = Math.max(9.5, 7.25 * nameFont / detailSize);
  const cases = [
    { names: goodNames, size: detailSize, texts: true, region: 'good' },
    { names: 8.5, size: 8, texts: false, region: 'names-low' },
    { names: 3, size: 8, texts: false, region: 'warn' },
  ];
  // Ordinary names have no promised font floor. The legal 8 px note can separate the detail
  // threshold only when its measured ratio gives a non-empty ok region (opened >= 8).
  const lower = Math.max(9.1, 4.65 * nameFont / 8), upper = 6.35 * nameFont / 8;
  if (upper > lower) cases.push({ names: (lower + upper) / 2, size: 8, texts: true, region: 'detail-low' });
  else test.info().annotations.push({ type: 'oracle-limit', description: 'Ordinary name font cannot reach names >= 9 / text < 6.5 with a legal 8 px note; that distinguishing input is unverified.' });
  for (const target of cases) {
    const note = page.getByTestId('show-texts');
    if (target.texts) await note.check(); else await note.uncheck();
    // Move the second card until it enters a threshold region; no exact pair or fixed font is promised.
    let tuned = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const measured = await previewTextSizes(page);
      expect(measured.runs.length).toBeGreaterThan(0);
      const names = measured.runs.filter(r => r.name); expect(names.length).toBeGreaterThan(0);
      const inPlace = measured.opened * 880 / 1600, namesInPlace = measured.namesOpened * 880 / 1600;
      const validSize = (await readDrawing(file)).views[0].texts[0].size === target.size;
      const region = target.region === 'good' ? namesInPlace >= 9 && inPlace >= 6.5
        && (goodNames * detailSize / nameFont >= 9 || inPlace < 9)
        : target.region === 'names-low' ? namesInPlace < 9 && inPlace >= 6.5 && measured.opened >= 8
        : target.region === 'detail-low' ? namesInPlace >= 9 && inPlace < 6.5 && measured.opened >= 8
        : measured.opened < 8;
      if (validSize && region) { tuned = true; break; }
      const image = await svgInfo(page, await previewSVG(page)); expect(image.nodes).toHaveLength(2);
      const card = image.nodes.find(n => n.id === 'finish')!;
      const updated = await readDrawing(file), view = updated.views[0];
      const first = view.nodes.find(n => n.id === 'start')!, last = view.nodes.find(n => n.id === 'finish')!;
      const span = last.x! + card.width - first.x!;
      last.x = first.x! + span * namesInPlace / target.names - card.width;
      view.texts[0].size = target.size;
      expect(view.texts[0].size).toBeGreaterThanOrEqual(8); expect(view.texts[0].size).toBeLessThanOrEqual(200);
      const response = await request.put(`${baseURL()}/api/diagrams/${opened.id}`, {
        headers: { 'X-Archdraw-Token': opened.token, 'If-Unmodified-Since-Version': updated.updatedAt! }, data: updated,
      });
      expect(response.status(), await response.text()).toBe(200);
      await page.reload(); await expect(page.getByTestId('editor')).toBeVisible(); await share();
      if (!target.texts) await page.getByTestId('show-texts').uncheck();
    }
    expect(tuned, `the drawing enters the ${target.region} threshold region`).toBe(true);
    const actual = await checkReadability(page, 1600, 880);
    expect(actual.level).toBe(target.region === 'good' ? 'good' : target.region === 'warn' ? 'warn' : 'ok');
    if (target.region === 'good') {
      expect(actual.namesInPlace).toBeGreaterThanOrEqual(9);
      expect(actual.inPlace).toBeGreaterThanOrEqual(6.5);
      if (goodNames * detailSize / nameFont < 9) expect(actual.inPlace).toBeLessThan(9);
    } else if (target.region !== 'detail-low') expect(actual.namesInPlace).toBeLessThan(9);
    else { expect(actual.namesInPlace).toBeGreaterThanOrEqual(9); expect(actual.inPlace).toBeLessThan(6.5); }
    if (target.region === 'names-low' || target.region === 'detail-low') expect(actual.opened).toBeGreaterThanOrEqual(8);
    if (target.region === 'warn') expect(actual.opened).toBeLessThan(8);
  }
});
