import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, component, workspace, openDrawing, readDrawing, svgInfo, svgBoxes, previewSVG, baseURL, type Shape, type View } from './helpers';

test('H66 [LAY-1, LAY-5, SHR-3, SHR-10] leave the contracted row gaps around an anchor in ordinary and post styles', async ({ page, request }) => {
  const doc = drawing('Lane row gaps'), ordinary = doc.views[0];
  ordinary.nodes = [component('anchor', { label: 'Anchor', form: 'panel', sub: 'Work', items: ['Check', 'Send'], lane: { spine: 0 } }),
    component('above', { label: 'Above', lane: { anchor: 'anchor', side: 'above' } }),
    component('below', { label: 'Below', lane: { anchor: 'anchor', side: 'below' } })];
  ordinary.edges = []; ordinary.texts = []; ordinary.caption = { title: 'Row gaps', lede: '' };
  const post: View = structuredClone(ordinary); post.id = 'gaps-post'; post.title = 'Post'; post.postOf = ordinary.id;
  for (const node of post.nodes) {
    node.id = `post-${node.id}`;
    if (node.lane && 'anchor' in node.lane) node.lane.anchor = `post-${node.lane.anchor}`;
  }
  doc.views.push(post);
  const { file } = await workspace('h66', doc), opened = await openDrawing(page, request, file);
  const stored = await readDrawing(file), baseline = await readFile(file, 'utf8');
  async function gaps(view: View, svg: string, gap: number) {
    const image = await svgInfo(page, svg), shapes: Shape[] = await svgBoxes(page, svg, 'g[data-node-id]');
    expect(image.nodes).toHaveLength(3); expect(shapes).toHaveLength(3);
    const anchor = view.nodes.find(n => n.lane && 'spine' in n.lane)!;
    const a = shapes.find(s => s.nodeId === anchor.id)!;
    const scale = a.width / image.nodes.find(n => n.id === anchor.id)!.width;
    expect(scale).toBeGreaterThan(0);
    const sides = view.nodes.filter(n => n.lane && 'anchor' in n.lane); expect(sides).toHaveLength(2);
    for (const node of sides) {
      const b = shapes.find(s => s.nodeId === node.id)!;
      const measured = (node.lane as { side: string }).side === 'above' ? a.y - b.y - b.height : b.y - a.y - a.height;
      expect(measured / scale, `${view.id}/${node.id}`).toBeCloseTo(gap, 5);
    }
  }
  const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
  expect(response.status()).toBe(200); await gaps(stored.views[0], await response.text(), 32);
  await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${post.id}`).click();
  await page.getByTestId('share-button').click();
  if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
  await page.getByTestId('format-linkedin').click();
  await page.getByTestId('show-title').uncheck(); await page.getByTestId('show-lede').uncheck();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080');
  await gaps(stored.views[1], await previewSVG(page), 22);
  expect(await readFile(file, 'utf8')).toBe(baseline);
});
