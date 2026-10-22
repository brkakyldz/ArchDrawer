import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { workspace, cli, baseURL, download } from './helpers';
import { readRaw, readDrawing } from './helpers-selections'; // the file the server writes is format 4: `readRaw` is its text, `readDrawing` its first choice drawn
import { compareSVGs } from './helpers-svg-parity';

test('H15 [START-5, FILE-1, FILE-2, LAYOUT-1, SHARE-1, #182] validate a session file, reopen the same editor and export it', async ({ page, request }) => {
  const { dir, file } = await workspace('CLI Shop');
  const original = await readFile(file, 'utf8');
  const validation = await cli(['validate', file]);
  expect(validation.code).toBe(0); expect(validation.stdout).toMatch(/\bvalid\b/);
  expect(await readFile(file, 'utf8')).toBe(original); // Validation must not normalise or repair.
  const health = await (await request.get(`${baseURL()}/api/health`)).json();
  expect(health).toMatchObject({ ok: true, app: 'archdrawer' });
  const serverFile = join(process.env.ARCHDRAW_HOLDOUT_DATA!, 'server.json'); const runningServer = JSON.parse(await readFile(serverFile, 'utf8'));
  const opened = await cli(['open', file, '--no-browser']);
  expect(opened.code, opened.stderr).toBe(0);
  const url = opened.stdout.trim().split(/\r?\n/).at(-1)!.match(/http:\/\/127\.0\.0\.1:\d+\/d\/d_[a-z0-9]+/)?.[0];
  expect(url).toBeTruthy(); expect(url).toContain(baseURL());
  const normal = await readRaw(file);
  expect(normal.schema).toBe('archdraw/diagram@4'); // the `@3` file the session wrote is one choice of a format 4 file
  expect(normal.id).toMatch(/^d_[a-z0-9]{6,}$/);
  expect(normal).toMatchObject({ theme: 'light', requests: [], warnings: [], source: { kind: 'local' } });
  expect(normal.choices).toHaveLength(1); expect(normal.choices[0]).toMatchObject({ id: 'system', kind: 'system', title: 'The whole system' });
  expect(normal.choices[0].channels.overview).toMatchObject({ showSteps: false, outdated: [] }); // The defaults are written, per channel.
  expect(Object.keys(normal.choices[0].channels).every(name => ['overview', 'linkedin', 'readme', 'presentation'].includes(name))).toBe(true);
  expect(resolve(normal.source!.path)).toBe(resolve(dir));
  expect(Number.isFinite(Date.parse(normal.createdAt!))).toBe(true);
  expect(normal.choices[0].channels.overview.views![0].nodes.every((n: { x: number; y: number }) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  expect(normal).not.toHaveProperty('views'); // The `@2` list of views is gone from the file,
  expect(normal).not.toHaveProperty('facts'); expect(normal).not.toHaveProperty('channels'); // and the facts and channels are the choice's.
  const text = await readFile(file, 'utf8');
  expect(text).toBe(`${JSON.stringify(normal, null, 2)}\n`);
  const again = await cli(['open', file, '--no-browser']);
  expect(again.code).toBe(0); expect(again.stdout.trim().split(/\r?\n/).at(-1)).toContain(url!);
  expect((await readRaw(file)).id).toBe(normal.id);
  expect(JSON.parse(await readFile(serverFile, 'utf8'))).toEqual(runningServer);
  const beforeExport = await readFile(file, 'utf8');
  const status = await cli(['status']); expect(status.code).toBe(0);
  expect(status.stdout).toMatch(new RegExp(`running on ${baseURL().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(pid \\d+\\)`));
  await page.goto(url!); await expect(page.getByTestId('repo-name')).toHaveText('CLI Shop');
  const out = join(dir, 'readme.svg');
  const exported = await cli(['svg', file, '--view', 'overview', '--format', 'readme', '--theme', 'dark', '--out', out]);
  expect(exported.code, exported.stderr).toBe(0); expect(exported.stdout).toContain(out);
  await page.getByTestId('share-button').click();
  await page.getByTestId('format-readme').click(); await page.getByTestId('share-theme-dark').click();
  const downloaded = join(dir, 'browser.svg'); await download(page, 'download-svg', downloaded);
  // Browser-only embedded font data is intentionally excluded; the image content and geometry agree.
  await compareSVGs(page, await readFile(out, 'utf8'), await readFile(downloaded, 'utf8'), (await readDrawing(file)).views[0].edges);
  expect(await readFile(file, 'utf8')).toBe(beforeExport); // Export and share settings must not edit the drawing.
  const wrongUsage = await cli([]); expect(wrongUsage.code).toBe(2);
  expect(wrongUsage.stdout).toMatch(/validate/); expect(wrongUsage.stdout).toMatch(/migrate/);
});
