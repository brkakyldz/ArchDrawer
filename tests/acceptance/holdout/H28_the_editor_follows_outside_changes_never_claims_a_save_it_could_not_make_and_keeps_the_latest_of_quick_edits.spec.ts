import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { useProduct } from './server';
import { says, drawingRepo, shopDoc, comp, part, view, link, openDrawing, outsideWrite, readJSON, stored, saved, viewOf, nodeOf } from './helpers';

const product = useProduct({ stepMs: 1500 });

// A user edits while an agent session also writes the drawing file. The editor shows the session's change within moments, with a fresh
// undo history so it can never write its older version back; a new fact the session added marks the LinkedIn channel; a save against a
// file broken on disk fails visibly and offers the file's version; two quick edits leave the second in the file.
test('H28 [FILE-1 EDIT-3 FILE-3 AI-1] the editor follows an outside change with a fresh history, a save against a broken file fails visibly and never says Saved, and the latest of two quick edits is what the file keeps', async ({ page }) => {
  const p = product();
  const document = shopDoc('Followed shop');
  document.choices[0].channels.linkedin = { views: [view('linkedin', 'LinkedIn', [part('web'), part('api'), part('db')], [link('web', 'api', ['r1'], 1)])], showSteps: false, outdated: [] };
  const { file } = await drawingRepo('outside', document);
  const id = await openDrawing(page, p, file);

  // A session adds a part to the overview and renames another.
  const onDisk = await readJSON(file);
  const system = onDisk.choices[0];
  system.facts.components.push(comp('cache', 'Cache', 'data', { files: [] }));
  system.facts.components.find((f: any) => f.id === 'web').label = 'Storefront';
  system.channels.overview.views[0].nodes.push(part('cache'));
  await outsideWrite(file, onDisk);
  await expect(page.getByTestId('toast')).toHaveText(/Updated from the file/, { timeout: 5_000 });
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('Storefront');
  await expect(page.getByTestId('node-cache')).toBeVisible();
  await expect(page.getByTestId('tool-undo'), 'a fresh history: nothing to undo').toBeDisabled();
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('data-outdated', '1');
  const served = await stored(p, id);
  expect(served.choices[0].channels.linkedin.outdated).toEqual(['cache']);

  // The file is broken on disk while the user edits: the save is refused, the status says so, and it never reads Saved.
  await writeFile(file, '{ "schema": "archdraw/diagram@4", "title": ', 'utf8');
  await page.getByTestId('node-db').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Orders store');
  await page.getByTestId('node-label-input').press('Enter');
  await expect(page.getByTestId('save-reload')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('save-status')).toHaveText(/changed outside the editor/);
  await expect(page.getByTestId('save-status')).not.toHaveText(/^\s*Saved\s*$/);
  // The API refuses the same way: a save based on an older version writes nothing.
  const stale = await p.put(`/api/diagrams/${id}`, served, { 'If-Unmodified-Since-Version': served.updatedAt });
  expect(stale.status).toBe(409);
  expect(stale.body.error).toMatch(/changed since you opened it/);
  // The session repairs the file; Load the file's version shows it, with nothing to undo.
  await outsideWrite(file, onDisk);
  await page.getByTestId('save-reload').click();
  await saved(page);
  await expect(page.getByTestId('node-db').getByTestId('node-label')).toHaveText('Orders DB');
  await expect(page.getByTestId('tool-undo')).toBeDisabled();

  // Two quick edits: the file keeps the second, also after a reload.
  const label = page.getByTestId('node-api').getByTestId('node-label');
  await label.dblclick(); await page.getByTestId('node-label-input').fill('First name'); await page.getByTestId('node-label-input').press('Enter');
  await label.dblclick(); await page.getByTestId('node-label-input').fill('Second name'); await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('node-api').getByTestId('node-label')).toHaveText('Second name');
  expect((await readJSON(file)).choices[0].facts.components.find((f: any) => f.id === 'api').label).toBe('Second name');
  expect(nodeOf(viewOf(await stored(p, id), 'overview'), 'cache'), "the session's part is still there").toBeTruthy();

  // A session writes the file while an instruction runs: the run fails, writes nothing, and the session's edit stays.
  const started = await p.post('/api/runs', { diagramId: id, view: 'overview', instruction: 'add Late', engine: 'fixture', model: null, scope: { kind: 'view' } });
  expect(started.status, started.text).toBe(202);
  const record = async () => (await p.get(`/api/runs/${started.body.runId}`)).body;
  await expect.poll(async () => says((await record()).progress, /^Reading the drawing$/)).toBe(true);
  const during = await readJSON(file);
  during.choices[0].facts.components.find((f: any) => f.id === 'db').label = 'Session store';
  await outsideWrite(file, during);
  await expect.poll(async () => (await record()).status, { timeout: 60_000 }).toBe('failed');
  expect((await record()).error).toMatch(/changed while the instruction ran/);
  const kept = await readJSON(file);
  expect(kept.choices[0].facts.components.find((f: any) => f.id === 'db').label).toBe('Session store');
  expect(kept.choices[0].facts.components.some((f: any) => f.id === 'late'), 'the failed run wrote nothing').toBe(false);
});
