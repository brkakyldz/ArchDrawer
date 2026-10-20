import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, workspace, isolatedDrawing, readDrawing, cli } from './helpers';

test('H41 [START-5, FILE-1, LOOK-1] open an example from an empty library and recover a registered file that became invalid', async ({ page, request }) => {
  const { file } = await workspace('recovery', drawing('Recovery shop')), server = await isolatedDrawing(page, request, file);
  try {
    const healthResponse = await request.get(`${server.base}/api/health`); expect(healthResponse.status()).toBe(200);
    const health = await healthResponse.json(); expect(health).toMatchObject({ ok: true, app: 'archdrawer', version: expect.any(String), build: expect.any(String) }); expect(health.build.trim()).not.toBe('');
    const serverInfo = JSON.parse(await readFile(join(server.data, 'server.json'), 'utf8')); expect(serverInfo.build).toBe(health.build);
    const repeat = await cli(['open', file, '--no-browser'], server.env); expect(repeat.code, repeat.stderr).toBe(0); expect(repeat.stdout).toContain(`/d/${server.id}`);
    expect(JSON.parse(await readFile(join(server.data, 'server.json'), 'utf8'))).toEqual(serverInfo);
    const goodBytes = await readFile(file, 'utf8');
    await page.goto(`${server.base}/`); const row = page.locator(`[data-testid="library-item"][data-diagram-id="${server.id}"]`);
    await expect(row.getByTestId('library-menu')).toHaveAccessibleName('More actions for Recovery shop');
    await row.getByTestId('library-menu').click(); await expect(page.getByTestId('library-menu-list').getByTestId('library-forget')).toHaveText('Remove from list');
    await page.keyboard.press('Escape'); await expect(page.getByTestId('library-menu-list')).not.toBeVisible(); await expect(row).toBeVisible();
    await row.getByTestId('library-menu').click();
    const confirmation = page.waitForEvent('dialog'); const forgetting = page.getByTestId('library-forget').click(); const prompt = await confirmation;
    expect(prompt.message()).toMatch(/file.*stay|stays.*file|remain.*(?:disk|where)/i); await prompt.accept(); await forgetting; await expect(row).toHaveCount(0);
    expect(await readFile(file, 'utf8')).toBe(goodBytes);
    await expect(page.getByTestId('start-help')).toBeVisible(); await expect(page.getByTestId('library-example')).toHaveText('Open the example drawing');
    for (const headers of [{}, { 'X-Archdraw-Token': 'wrong-process-token' }]) {
      expect((await request.post(`${server.base}/api/example`, { headers })).status()).toBe(403);
      expect((await (await request.get(`${server.base}/api/diagrams`)).json()).diagrams).toHaveLength(0);
    }
    const exampleResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/example');
    await page.getByTestId('library-example').click(); const example = await exampleResponse; expect(example.status()).toBe(201);
    const exampleId = (await example.json()).id; await expect(page.getByTestId('repo-name')).toHaveText('Sample Shop'); expect(new URL(page.url()).pathname).toBe(`/d/${exampleId}`);
    await page.goto(`${server.base}/`); const imported = page.locator(`[data-testid="library-item"][data-diagram-id="${exampleId}"]`);
    await expect(imported.getByTestId('library-item-path')).toHaveText('Imported');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const style = await imported.evaluate(el => {
        const title = el.querySelector('[data-testid="library-item-title"]')!, path = el.querySelector('[data-testid="library-item-path"]')!;
        function colors(element: Element) {
          const pixel = document.createElement('canvas'); pixel.width = pixel.height = 1;
          const context = pixel.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1);
          const ancestors: Element[] = []; for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
          for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
          const background = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
          context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1);
          return { background, color: Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3) };
        }
        return { title: { ...colors(title), size: parseFloat(getComputedStyle(title).fontSize), weight: parseInt(getComputedStyle(title).fontWeight) },
          path: { ...colors(path), size: parseFloat(getComputedStyle(path).fontSize), weight: parseInt(getComputedStyle(path).fontWeight) } };
      });
      function luminance(color: number[]) {
        const channels = color.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      function contrast(foreground: number[], background: number[]) { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
      expect(contrast(style.title.color, style.title.background)).toBeGreaterThanOrEqual(7); expect(contrast(style.path.color, style.path.background)).toBeGreaterThanOrEqual(4.5);
      expect(style.title.size).toBeGreaterThan(style.path.size); expect(style.title.weight).toBeGreaterThan(style.path.weight);
    }
    const openedAgain = await cli(['open', file, '--no-browser'], server.env); expect(openedAgain.code).toBe(0);
    const restoredId = (await readDrawing(file)).id!; expect(restoredId).toBe(server.id);
    await writeFile(file, '{ invalid on disk', 'utf8'); await page.goto(`${server.base}/d/${restoredId}`);
    await expect(page.getByTestId('load-error')).toBeVisible();
    const reason = await page.getByTestId('load-error').evaluate(el => {
      const message = el.cloneNode(true) as Element; message.querySelectorAll('[data-testid="load-retry"], [data-testid="load-back"]').forEach(button => button.remove()); return message.textContent?.trim();
    }); expect(reason).toMatch(/\S/);
    await expect(page.getByTestId('load-retry')).toHaveText('Try again'); await expect(page.getByTestId('load-back')).toHaveText('Back to the drawings');
    await page.getByTestId('load-retry').click(); await expect(page.getByTestId('load-error')).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe('{ invalid on disk'); // Retrying has not repaired or replaced a session's file.
    await writeFile(file, goodBytes, 'utf8'); await page.getByTestId('load-retry').click(); await expect(page.getByTestId('editor')).toBeVisible(); await expect(page.getByTestId('repo-name')).toHaveText('Recovery shop');
    await writeFile(file, '{ invalid again', 'utf8'); await page.reload(); await expect(page.getByTestId('load-error')).toBeVisible(); await page.getByTestId('load-back').click();
    await expect(page.getByTestId('library')).toBeVisible(); expect(new URL(page.url()).pathname).toBe('/');
    expect(await readFile(file, 'utf8')).toBe('{ invalid again'); await writeFile(file, goodBytes, 'utf8');
    expect((await request.get(`${server.base}/api/health`)).status()).toBe(200);
    expect((await (await request.get(`${server.base}/api/health`)).json()).build).toBe(health.build);
  } finally { await server.close(); }
});
