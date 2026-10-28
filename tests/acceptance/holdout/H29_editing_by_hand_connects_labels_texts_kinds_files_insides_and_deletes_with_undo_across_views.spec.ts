import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { drawingRepo, shopDoc, openDrawing, stored, viewOf, saved, box, choiceOf, clickEdge } from './helpers';

const product = useProduct();

async function connect(page: import('@playwright/test').Page, from: string, to: string) {
  const a = await box(page.getByTestId(`node-${from}`)), b = await box(page.getByTestId(`node-${to}`));
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
}
const facts = async (p: ReturnType<typeof product>, id: string) => choiceOf(await stored(p, id)).facts;

// A user edits a drawing by hand: connects two parts by dragging (and back again, which makes it two-way), labels and restyles the line,
// adds a free text, changes a part's kind and form, adds a file the repository does not have (kept, and marked), draws a part's inside and
// comes back, deletes a part, and undoes their way back across views.
test('H29 [EDIT-1 EDIT-2 FILE-3 NAV-1] editing by hand: connect by dragging, label and restyle a line, free text, kind and form, a missing file marked, an inside drawn, a delete, and undo across views', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('workbench', shopDoc('Workbench'));
  const id = await openDrawing(page, p, file);
  await page.getByTestId('zoom-fit').click();

  // Connect by dragging, then back again: one two-way connection, and the relation in the facts.
  await page.getByTestId('tool-connect').click();
  await expect(page.getByTestId('tool-hint')).toBeVisible();
  await connect(page, 'web', 'db');
  await saved(page);
  await expect.poll(async () => (await facts(p, id)).relations.filter((r: any) => r.from === 'web' && r.to === 'db')).toHaveLength(1);
  await page.getByTestId('tool-connect').click();
  await connect(page, 'db', 'web');
  await expect(page.getByTestId('toast')).toHaveText(/two-way/);
  await saved(page);
  await expect.poll(async () => (await facts(p, id)).relations.find((r: any) => r.from === 'web' && r.to === 'db')?.both).toBe(true);
  const newEdge = viewOf(await stored(p, id), 'overview').edges.find((e: any) => e.from === 'web' && e.to === 'db');

  // Select the line: label it and make it async.
  await page.getByTestId('tool-select').click();
  await clickEdge(page, newEdge.id);
  await expect(page.getByTestId('edge-callout')).toBeVisible();
  await page.getByTestId('edge-label-input').fill('reads');
  await page.getByTestId('edge-label-input').press('Enter');
  await page.getByTestId('edge-style-async').click();
  await expect(page.getByTestId('edge-style-async')).toHaveAttribute('aria-pressed', 'true');
  await saved(page);
  await expect.poll(async () => { const r = (await facts(p, id)).relations.find((x: any) => x.from === 'web' && x.to === 'db'); return [r.label, r.style]; }).toEqual(['reads', 'async']);
  await page.keyboard.press('Escape');

  // A free text, larger.
  await page.getByTestId('tool-text').click();
  const canvas = await box(page.getByTestId('canvas'));
  await page.mouse.click(canvas.x + 80, canvas.y + canvas.height - 80);
  await expect(page.getByTestId('text-input')).toBeFocused();
  await page.keyboard.type('Orders flow left to right');
  await page.keyboard.press('Escape');
  const text = page.locator('[data-testid^="text-"][data-size]');
  await expect(text).toHaveCount(1);
  await text.click();
  await page.getByTestId('text-size-l').click();
  await expect(text).toHaveAttribute('data-size', '28');
  await saved(page);

  // The callout: kind and form, a missing file kept and marked, a path outside the repository refused.
  await page.getByTestId('node-api').getByTestId('node-label').click();
  const callout = page.getByTestId('callout-api');
  await expect(callout.getByTestId('callout-description')).toHaveText(/Takes orders/);
  await expect(callout.getByTestId('callout-link-web')).toHaveAttribute('data-direction', 'both');
  await callout.getByTestId('callout-kind').click();
  await page.getByTestId('kind-option-gate').click();
  await expect(page.getByTestId('node-api')).toHaveAttribute('data-kind', 'gate');
  await callout.getByTestId('callout-form').click();
  await page.getByTestId('form-option-compact').click();
  await expect(page.getByTestId('node-api')).toHaveAttribute('data-form', 'compact');
  await expect(callout.getByTestId('callout-file').filter({ hasText: 'src/api.ts' })).not.toHaveAttribute('data-missing', 'true');
  await callout.getByTestId('callout-file-add').click();
  await page.getByTestId('callout-file-input').fill('../outside.ts');
  await page.getByTestId('callout-file-input').press('Enter');
  await expect(page.getByTestId('toast')).toHaveText(/inside the repository/);
  await expect(callout.getByTestId('callout-file').filter({ hasText: 'outside.ts' }), 'the refused path is not added').toHaveCount(0);
  // The contract closes the field only on Escape or blur, so after a refused path it may still be open: type the next path into it.
  if (!(await page.getByTestId('callout-file-input').isVisible())) await callout.getByTestId('callout-file-add').click();
  await page.getByTestId('callout-file-input').fill('src/missing.ts');
  await page.getByTestId('callout-file-input').press('Enter');
  const missing = callout.getByTestId('callout-file').filter({ hasText: 'src/missing.ts' });
  await expect(missing).toHaveAttribute('data-missing', 'true');
  await expect(missing.getByTestId('callout-file-missing')).toBeVisible();
  await saved(page);
  expect((await facts(p, id)).components.find((f: any) => f.id === 'api').files).toEqual(['src/api.ts', 'src/missing.ts']);
  expect((await p.post(`/api/diagrams/${id}/check-files`, { files: ['src/api.ts', 'src/missing.ts'] })).body).toEqual({ missing: ['src/missing.ts'] });

  // Draw its inside: a new view holding a copy of it; the crumb leads back.
  await callout.getByTestId('callout-create-inside').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'api-inside');
  // The copy lives in the same overview channel, so it cannot be `api` (drawing contract rule 2) and the contracts name no id for it.
  // It is known by what it points to: the one part of the new view, showing the same fact.
  await saved(page);
  await expect.poll(async () => viewOf(await stored(p, id), 'overview', 'api-inside')?.nodes.length ?? 0).toBe(1);
  const copy = viewOf(await stored(p, id), 'overview', 'api-inside').nodes[0];
  expect(copy.facts).toEqual(['api']);
  expect(copy.id, 'a part id unique within the channel').not.toBe('api');
  await expect(page.getByTestId(`node-${copy.id}`)).toBeVisible();
  await expect(page.getByTestId(`node-${copy.id}`).getByTestId('node-label')).toHaveText('Order API');
  await page.getByTestId('crumb-overview').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'overview');
  await expect(page.getByTestId('node-api')).toHaveAttribute('data-open', 'true');

  // Delete a part in the overview: its fact and its relations go.
  await page.getByTestId('node-db').getByTestId('node-label').click();
  await page.getByTestId('callout-delete').click();
  await expect(page.getByTestId('node-db')).toHaveCount(0);
  await saved(page);
  await expect.poll(async () => (await facts(p, id)).components.some((f: any) => f.id === 'db')).toBe(false);
  expect((await facts(p, id)).relations.some((r: any) => r.from === 'db' || r.to === 'db')).toBe(false);

  // Undo steps back across the edits, the inside view included; redo brings the delete back.
  await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('node-db')).toBeVisible();
  await page.getByTestId('tool-undo').click();
  await saved(page);
  await expect.poll(async () => (await stored(p, id)).choices[0].channels.overview.views.map((v: any) => v.id)).toEqual(['overview']);
  await page.getByTestId('tool-redo').click(); await page.getByTestId('tool-redo').click();
  await expect(page.getByTestId('node-db')).toHaveCount(0);
  await saved(page);
  await expect.poll(async () => (await stored(p, id)).choices[0].channels.overview.views.map((v: any) => v.id)).toEqual(['overview', 'api-inside']);
});
