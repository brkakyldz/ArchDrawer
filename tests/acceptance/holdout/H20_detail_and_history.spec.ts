import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, saved, box, callout, emptyCanvasPoint } from './helpers';

test('H20 [VIEW-2, VIEW-3, EDT-2, EDT-6, EDT-7, PER-1] enter and create detail views and retain a hundred undo steps across views', async ({ page, request }) => {
  const doc = drawing('Inside the shop'); doc.views[0].nodes[1].detail = 'inside-api';
  doc.views.push({ id: 'inside-api', title: 'Inside API', caption: { title: 'Inside order intake', lede: '' },
    nodes: [component('validator', { label: 'Validator', kind: 'gate', form: 'panel', items: ['Check scope'] }), component('writer', { label: 'Writer' })],
    edges: [{ id: 'detail-edge', from: 'validator', to: 'writer', label: 'valid', style: 'call', both: false, step: 1 }], texts: [] });
  const { file } = await workspace('details', doc); const opened = await openDrawing(page, request, file);
  const canvas = await box(page.getByTestId('canvas'));
  for (const id of ['web', 'api', 'db']) { const b = await box(page.getByTestId(`node-${id}`)); expect(b.x).toBeGreaterThanOrEqual(canvas.x); expect(b.y).toBeGreaterThanOrEqual(canvas.y); expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width); expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + canvas.height); }
  const fit = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')); expect(fit).toBeLessThanOrEqual(115);
  await page.getByTestId('zoom-out').click(); const zoomOut = await page.getByTestId('zoom-level').innerText();
  expect(Number(zoomOut.replace('%', ''))).toBeLessThan(fit);
  await page.getByTestId('zoom-in').click(); expect(Number((await page.getByTestId('zoom-level').innerText()).replace('%', ''))).toBeGreaterThan(Number(zoomOut.replace('%', '')));
  const anchor = await box(page.getByTestId('node-web')); const beforeWheel = await page.getByTestId('zoom-level').innerText();
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2); await page.mouse.wheel(0, -180);
  await expect.poll(() => page.getByTestId('zoom-level').innerText()).not.toBe(beforeWheel);
  const afterWheel = await box(page.getByTestId('node-web'));
  expect(Math.abs(afterWheel.x + afterWheel.width / 2 - anchor.x - anchor.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterWheel.y + afterWheel.height / 2 - anchor.y - anchor.height / 2)).toBeLessThanOrEqual(2);
  await page.getByTestId('tool-pan').click(); const beforePan = await box(page.getByTestId('node-web'));
  const empty = await emptyCanvasPoint(page);
  await page.mouse.move(canvas.x + empty.x, canvas.y + empty.y); await page.mouse.down(); await page.mouse.move(canvas.x + empty.x + 50, canvas.y + empty.y + 30, { steps: 5 }); await page.mouse.up();
  expect((await box(page.getByTestId('node-web'))).x).not.toBe(beforePan.x);
  await page.getByTestId('zoom-fit').click(); await page.getByTestId('tool-select').click();
  await page.getByTestId('node-api').getByTestId('node-inside').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  await expect(page.getByTestId('node-web')).toHaveCount(0); await expect(page.getByTestId('crumbs')).toContainText('Inside API');
  await page.getByTestId('node-validator').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Scope check'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page); await page.getByTestId('crumb-overview').click();
  await (await callout(page, 'db')).getByTestId('callout-create-inside').click();
  const createdView = await page.getByTestId('editor').getAttribute('data-view'); expect(createdView).not.toBe('overview'); expect(createdView).not.toBe('inside-api');
  await saved(page); const afterCreate = await readDrawing(file);
  const inside = afterCreate.views.find(v => v.id === createdView)!; expect(inside.title).toBe('Orders DB'); expect(inside.nodes).toHaveLength(1);
  expect(inside.nodes[0].label).toBe('Orders DB'); expect(afterCreate.views[0].nodes.find(n => n.id === 'db')?.detail).toBe(createdView);
  const ids = afterCreate.views.flatMap(v => v.nodes.map(n => n.id)); expect(new Set(ids).size).toBe(ids.length); // The copied component cannot duplicate an id.
  await page.getByTestId('crumb-overview').click(); await page.getByTestId('tool-steps').click();
  await expect(page.getByTestId('step-badge-e1')).toHaveText('1'); await expect(page.getByTestId('step-badge-e2')).toHaveText('2');
  await persisted(file, d => d.showSteps === true); await page.getByTestId('tool-steps').click();
  await expect(page.getByTestId('step-badge-e1')).toHaveCount(0);
  // These 96 theme edits plus label, detail creation and two step toggles make exactly 100.
  for (let i = 0; i < 96; i++) {
    await page.getByTestId('tool-theme').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', i % 2 === 0 ? 'dark' : 'light');
  }
  await saved(page);
  for (let i = 0; i < 96; i++) {
    await expect(page.getByTestId('tool-undo')).toBeEnabled(); await page.getByTestId('tool-undo').click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', i % 2 === 0 ? 'dark' : 'light');
  }
  // Undo the two step changes and the creation in another view, then the detail label edit.
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('tool-steps')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tool-undo').click(); await expect(page.getByTestId('tool-steps')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('tool-undo').click(); await persisted(file, d => d.views.length === 2 && d.views[0].nodes.find(n => n.id === 'db')?.detail === null);
  await page.getByTestId('tool-undo').click(); await persisted(file, d => d.views[1].nodes[0].label === 'Validator');
  await page.getByTestId('tool-redo').click(); await persisted(file, d => d.views[1].nodes[0].label === 'Scope check');
  await page.getByTestId('node-api').getByTestId('node-inside').click(); await expect(page.getByTestId('node-validator').getByTestId('node-label')).toHaveText('Scope check');
  await page.goto(`/d/${opened.id}?view=inside-api`); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  await page.getByTestId('tool-theme').click(); await saved(page); await page.reload();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-theme', 'dark'); await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'inside-api');
  expect((await readDrawing(file)).views).toHaveLength(2); // Undone detail creation must remain absent.
});
