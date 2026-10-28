import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import {
  drawingRepo, doc, choice, comp, part, view, openDrawing, exportSvg, readImage, stored, viewOf, box, saved, KINDS, SHAPE_OF, drawn,
} from './helpers';

const product = useProduct();

function drawing() {
  const components = KINDS.map(k => comp(`k-${k}`, `The ${k} part`, k, { sub: 'one line' }));
  components.push(comp('c-api', 'Small API', 'api', { sub: 'routes' }), comp('c-data', 'Small store', 'data'), comp('job-panel', 'The worker part', 'worker', { sub: 'one line', items: ['Retry later', 'Give up'] }));
  const nodes = [
    ...KINDS.map((k, i) => part(`k-${k}`, { place: { row: Math.floor(i / 5), col: i % 5 } })),
    part('c-api', { form: 'compact', place: { row: 2, col: 0 } }), part('c-data', { form: 'compact', place: { row: 2, col: 1 } }),
    part('job-panel', { form: 'panel', place: { row: 2, col: 2 } }),
  ];
  return doc('Kinds', [choice('system', 'The whole system', 'system', { components }, [view('overview', 'Overview', nodes, [])])]);
}
const shapeIn = (page: import('@playwright/test').Page, id: string) => page.getByTestId(`node-${id}`).locator('.body[data-shape]').first();
const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

// A user drawing a mixed system sees each kind in its own outline, in the editor and in the image, with its text inside it; a panel looks
// like a card of its kind and lists its rows only in the callout; adding a part shows the shape of the kind chosen; switching sub-lines
// off shrinks every part of the view, and the share image follows the view.
test('H23 [LOOK-2 LOOK-3 EDIT-1 SHARE-1] every kind draws its own outline in the editor and the image with its text inside, a panel draws no row, and the sub-line switch shrinks the parts and the share image follows', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('kinds', drawing());
  const id = await openDrawing(page, p, file);
  await page.getByTestId('zoom-fit').click();

  const image = await readImage(page, await exportSvg(p, id, 'format=readme'));
  for (const k of KINDS) {
    await expect(shapeIn(page, `k-${k}`), `${k} in the editor`).toHaveAttribute('data-shape', SHAPE_OF[k]);
    expect(image.nodes.find(n => n.id === `k-${k}`)!.shape, `${k} in the image`).toBe(SHAPE_OF[k]);
    const outline = await box(page.getByTestId(`node-k-${k}`));
    expect(inside(await box(page.getByTestId(`node-k-${k}`).getByTestId('node-label')), outline), `${k}: label inside`).toBe(true);
    expect(inside(await box(page.getByTestId(`node-k-${k}`).getByTestId('node-sub')), outline), `${k}: sub-line inside`).toBe(true);
  }
  await expect(shapeIn(page, 'c-api')).toHaveAttribute('data-shape', 'port');
  await expect(shapeIn(page, 'c-data')).toHaveAttribute('data-shape', 'store');
  await expect(shapeIn(page, 'job-panel')).toHaveAttribute('data-shape', 'stack');
  // The shield, the cylinder, the cloud top and the stack make a card taller than a plain card with the same text.
  const height = (kind: string) => image.nodes.find(n => n.id === `k-${kind}`)!.h;
  for (const k of ['gate', 'data', 'external', 'worker']) expect(height(k), `${k} is taller than a plain card`).toBeGreaterThan(height('service'));
  // A panel measures as a card of its kind and draws none of its rows; the rows are in its callout.
  const panel = image.nodes.find(n => n.id === 'job-panel')!;
  expect([panel.w, panel.h]).toEqual([image.nodes.find(n => n.id === 'k-worker')!.w, height('worker')]);
  expect(panel.texts.join(' ')).not.toMatch(/Retry later|Give up/);
  await expect(page.getByTestId('node-job-panel')).not.toContainText('Retry later');
  await page.getByTestId('node-job-panel').getByTestId('node-label').click();
  await expect(page.getByTestId('callout-job-panel').locator('[data-testid="callout-item"][data-row="item"]')).toHaveText([/Retry later/, /Give up/]);
  await page.keyboard.press('Escape');

  // Adding a part: the picker shows the chosen kind's shape, and the new part wears it.
  await page.getByTestId('tool-component').click();
  const canvas = await box(page.getByTestId('canvas'));
  await page.mouse.click(canvas.x + canvas.width - 80, canvas.y + canvas.height - 80);
  await expect(page.getByTestId('component-picker')).toBeVisible();
  await page.getByTestId('picker-kind-data').click();
  await expect(page.getByTestId('picker-form-card').locator('[data-testid="form-thumb"][data-shape], [data-testid="form-thumb"] [data-shape]').first()).toHaveAttribute('data-shape', 'store');
  await page.getByTestId('picker-add').click();
  await expect(page.getByTestId('node-label-input')).toBeFocused();
  await page.keyboard.type('Cache');
  await page.keyboard.press('Enter');
  await expect(shapeIn(page, 'new-component')).toHaveAttribute('data-shape', 'store');
  await saved(page);
  expect((await stored(p, id)).choices[0].facts.components.find((f: any) => f.id === 'new-component')).toMatchObject({ label: 'Cache', kind: 'data' });

  // Sub-lines off: no sub-line in the view, every part shorter, the share image drawn the same way.
  const tall = (await box(page.getByTestId('node-k-service'))).height;
  await page.getByTestId('tool-sublines').click();
  await expect(page.getByTestId('tool-sublines')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('canvas').getByTestId('node-sub')).toHaveCount(0);
  await expect.poll(async () => (await box(page.getByTestId('node-k-service'))).height).toBeLessThan(tall - 1);
  await saved(page);
  expect(viewOf(await stored(p, id), 'overview').subLines).toBe(false);
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-advanced-toggle').click();
  await expect(page.getByTestId('show-sub')).not.toBeChecked();
  const preview = await drawn(page.getByTestId('share-preview'), 'k-service');
  const editor = await drawn(page.getByTestId('canvas'), 'k-service');
  for (const k of KINDS) expect(Math.abs((preview.nodes[`k-${k}`].bottom - preview.nodes[`k-${k}`].top) - (editor.nodes[`k-${k}`].bottom - editor.nodes[`k-${k}`].top)), `${k}: preview height = editor height`).toBeLessThanOrEqual(1);
  await page.getByTestId('share-close').click();
  const subOf = async () => (await readImage(page, await exportSvg(p, id, 'format=readme'))).nodes.find(n => n.id === 'k-service')!.texts.join(' ');
  expect(await subOf(), 'the export follows the view').not.toContain('one line');
  // On again: the field leaves the view.
  await page.getByTestId('tool-sublines').click();
  await saved(page);
  await expect.poll(async () => 'subLines' in viewOf(await stored(p, id), 'overview')).toBe(false);
  expect(await subOf()).toContain('one line');
});
