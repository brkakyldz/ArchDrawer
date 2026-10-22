import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, workspace, openDrawing, baseURL, edgePaths } from './helpers';

// Semantic zoom (ui contract): in `outline` only an edge label's contents fade; in `overview` also every node-sub, and
// connections without a step go to 0.3. Rows are not drawn at any zoom (ADR 0014): a panel has no `node-item` to fade.
test('H34 [LAYOUT-1 EDIT-2 LOOK-3 #177] fade detail at distance while keeping the open part lit and every shape and export unchanged, with no row drawn at any zoom', async ({ page, request }) => {
  const doc = drawing('Zoom shop'); doc.views[0].nodes[1].sub = 'Order intake';
  doc.views[0].edges[1].label = 'Store the order';
  doc.views[0].edges.push({ id: 'background', from: 'web', to: 'db', label: 'Lookup history', style: 'dep', both: false, step: null });
  const { file } = await workspace('semantic-zoom', doc), opened = await openDrawing(page, request, file);
  const before = await readFile(file, 'utf8'), exportURL = `${baseURL()}/api/diagrams/${opened.id}/export.svg`;
  const exported = await (await request.get(exportURL)).text(), canvas = page.getByTestId('canvas');
  async function level(wanted: string, button: string) {
    for (let i = 0; i < 30 && await canvas.getAttribute('data-detail') !== wanted; i++) {
      const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId(button).click();
      await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
    }
    await expect(canvas).toHaveAttribute('data-detail', wanted);
  }
  async function opacity(locator: Locator) {
    return await locator.evaluate(el => Number(getComputedStyle(el.tagName.toLowerCase() === 'text' ? el : el.querySelector('text')!).opacity));
  }
  async function geometry() {
    return await page.getByTestId('canvas').locator('[data-testid]').evaluateAll(els => els.filter(el => el.hasAttribute('data-kind')).map(el => {
      const b = (el.querySelector('rect') as SVGGraphicsElement).getBBox(); return { id: el.getAttribute('data-testid'), transform: el.getAttribute('transform'), x: b.x, y: b.y, width: b.width, height: b.height };
    }));
  }
  await level('full', 'zoom-in');
  const shapes = await geometry(), paths = await edgePaths(page, 'e1');
  async function connectionOpacity() {
    return await page.getByTestId('edge-background').evaluate(el => {
      const path = el.tagName.toLowerCase() === 'path' ? el : el.querySelector('path')!;
      let opacity = Number(getComputedStyle(path).strokeOpacity);
      for (let current: Element | null = path; current && current.getAttribute('data-testid') !== 'canvas'; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity);
      return opacity;
    });
  }
  const nearConnectionOpacity = await connectionOpacity();
  const api = page.getByTestId('node-api'), apiSub = api.getByTestId('node-sub');
  const webSub = page.getByTestId('node-web').getByTestId('node-sub'), label = page.getByTestId('edge-label-e1');
  // The panel is drawn like a card: it has no row to fade, at this zoom or any other.
  await expect(api).toHaveAttribute('data-form', 'panel'); await expect(api.getByTestId('node-item')).toHaveCount(0);
  await expect(label).toHaveCount(1); await expect.poll(() => opacity(apiSub)).toBe(1); await expect.poll(() => opacity(label)).toBe(1);
  await level('outline', 'zoom-out');
  await expect.poll(() => opacity(label)).toBe(0); await expect.poll(() => opacity(webSub)).toBe(1); await expect.poll(() => opacity(apiSub)).toBe(1);
  expect(await geometry()).toEqual(shapes); expect(await edgePaths(page, 'e1')).toEqual(paths);
  await level('overview', 'zoom-out');
  const displayedZoom = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')); expect(displayedZoom).toBeLessThanOrEqual(50);
  await expect.poll(() => opacity(webSub)).toBe(0); await expect.poll(() => opacity(apiSub)).toBe(0);
  await expect.poll(connectionOpacity).toBeLessThan(nearConnectionOpacity);
  await expect(api.getByTestId('node-label')).toBeVisible();
  await api.getByTestId('node-label').click(); await expect(page.getByTestId('callout-api')).toBeVisible();
  await expect.poll(() => opacity(apiSub)).toBe(1); await expect.poll(() => opacity(label)).toBe(1);
  await expect.poll(() => opacity(webSub)).toBe(0); // Unrelated sub-lines stay faded.
  await expect.poll(() => opacity(api.getByTestId('node-label'))).toBe(1);
  await expect(api.getByTestId('node-item')).toHaveCount(0); // the open part still draws no row
  expect(await geometry()).toEqual(shapes); expect(await edgePaths(page, 'e1')).toEqual(paths);
  await page.getByTestId('callout-api').getByTestId('callout-close').click(); await expect.poll(() => opacity(apiSub)).toBe(0);
  await level('full', 'zoom-in'); await expect.poll(() => opacity(apiSub)).toBe(1); await expect.poll(() => opacity(webSub)).toBe(1);
  expect(await geometry()).toEqual(shapes); expect(await (await request.get(exportURL)).text()).toBe(exported);
  expect(await readFile(file, 'utf8')).toBe(before);
});
