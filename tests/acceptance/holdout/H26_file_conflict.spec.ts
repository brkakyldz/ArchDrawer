import { test, expect } from '@playwright/test';
import { readFile, chmod, stat } from 'node:fs/promises';
import { drawing, workspace, openDrawing, readDrawing, persisted, saved, outsideWrite, baseURL } from './helpers';

test('H26 [PER-1, PER-2, EDT-2] save to the repository file, follow an outside edit and refuse a stale editor write with a reload offer', async ({ page, request }) => {
  const { file } = await workspace('persistence', drawing('Persistence shop')); const opened = await openDrawing(page, request, file);
  const label = page.getByTestId('node-web').getByTestId('node-label'); await label.dblclick();
  await page.getByTestId('node-label-input').fill('Storefront'); await page.getByTestId('node-label-input').press('Enter');
  await persisted(file, d => d.views[0].nodes[0].label === 'Storefront', 1000); await saved(page);
  await page.reload(); await expect(label).toHaveText('Storefront');
  const external = await readDrawing(file); external.views[0].nodes[0].label = 'Session storefront'; external.updatedAt = '2098-01-01T00:00:00.000Z';
  await outsideWrite(file, external);
  await expect(label).toHaveText('Session storefront', { timeout: 2000 }); await expect(page.getByTestId('toast')).toHaveText('Updated from the file');
  await saved(page);
  const stale = await readDrawing(file);
  // Schedule a race at the HTTP boundary. The real PUT is forwarded unchanged to the real
  // server after the external write; no response, engine or server is mocked.
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let observed!: () => void; const intercepted = new Promise<void>(resolve => { observed = resolve; });
  let header: string | undefined;
  const routePattern = `**/api/diagrams/${opened.id}`;
  await page.route(routePattern, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    header = route.request().headers()['if-unmodified-since-version']; observed(); await gate; await route.continue();
  });
  const rejected = page.waitForResponse(r => new URL(r.url()).pathname === `/api/diagrams/${opened.id}` && r.request().method() === 'PUT');
  try {
    await label.dblclick(); await page.getByTestId('node-label-input').fill('Unsaved local version'); await page.getByTestId('node-label-input').press('Enter');
    await intercepted; expect(header).toBe(stale.updatedAt);
    const newer = structuredClone(stale); newer.views[0].nodes[0].label = 'Newer session version'; newer.updatedAt = '2099-01-01T00:00:00.000Z';
    await outsideWrite(file, newer); release(); const response = await rejected; expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ updatedAt: newer.updatedAt });
    await expect(page.getByTestId('save-status')).toContainText('The file changed outside the editor');
    await expect(page.getByTestId('save-status')).not.toHaveText('Saved'); await expect(page.getByTestId('save-reload')).toBeVisible();
    expect((await readDrawing(file)).views[0].nodes[0].label).toBe('Newer session version');
    await page.getByTestId('save-reload').click(); await expect(label).toHaveText('Newer session version'); await saved(page);
  } finally { release(); await page.unroute(routePattern); }
  // The same stale-version protection works through the public API and does not touch bytes.
  const before = await readFile(file, 'utf8');
  const conflict = await request.put(`${baseURL()}/api/diagrams/${opened.id}`, { headers: { 'X-Archdraw-Token': opened.token, 'If-Unmodified-Since-Version': stale.updatedAt! }, data: stale });
  expect(conflict.status()).toBe(409); expect(await readFile(file, 'utf8')).toBe(before);
  // On POSIX, use an actual unwritable repository directory to observe a failed atomic save.
  // Windows chmod does not remove write ACLs; the 409 above still proves failed-save feedback there.
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
    const folder = (await import('node:path')).dirname(file); const mode = (await stat(folder)).mode;
    try {
      await chmod(folder, 0o555); await label.dblclick(); await page.getByTestId('node-label-input').fill('Cannot save this'); await page.getByTestId('node-label-input').press('Enter');
      await expect(page.getByTestId('save-retry')).toBeVisible(); await expect(page.getByTestId('save-status')).not.toHaveText('Saved'); expect(await readFile(file, 'utf8')).toBe(before);
      await chmod(folder, mode); await page.getByTestId('save-retry').click(); await persisted(file, d => d.views[0].nodes[0].label === 'Cannot save this'); await saved(page);
    } finally { await chmod(folder, mode); }
  }
});
