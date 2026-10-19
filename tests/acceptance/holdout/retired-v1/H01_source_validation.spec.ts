import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test, expect, auth, library, waitRun } from './helpers';

test('H01 [SRC-1, SRC-3, ENG-2, GEN-1] rejected sources never start a run and a corrected form generates', async ({ page, request, token, workspace, source }) => {
  const before = await library(request);
  const file = path.join(workspace, 'not-a-folder.txt');
  await fs.writeFile(file, 'This is a file.');
  const body = { source, ref: null, engine: 'fixture', model: null, instruction: 'Draw the system', diagramId: null };
  for (const invalid of [path.join(workspace, 'missing'), file]) {
    const response = await request.post('/api/runs', { headers: auth(token), data: { ...body, source: invalid } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('Folder not found');
  }
  for (const invalid of ['relative-folder', 'https://gitlab.com/owner/repo', 'owner/repo/extra', 'owner/repo;echo-injected', 'https://github.com/space owner/repo']) {
    const response = await request.post('/api/runs', { headers: auth(token), data: { ...body, source: invalid } });
    expect(response.status()).toBe(400);
    const error = (await response.json()).error;
    expect(error).toContain('Unsupported source');
    expect(error).toMatch(/absolute|folder|local path/i);
    expect(error).toMatch(/github|owner\/repo/i);
  }
  for (const ref of ['main..bad', 'main;echo-injected', 'main with spaces', 'main~1', 'feature/.hidden', 'feature//branch', 'feature.', 'x'.repeat(101)]) {
    const response = await request.post('/api/runs', { headers: auth(token), data: { ...body, source: 'holdout/shop', ref } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
  }
  for (const change of [{ engine: 'does-not-exist' }, { instruction: '' }]) {
    const response = await request.post('/api/runs', { headers: auth(token), data: { ...body, ...change } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.length).toBeGreaterThan(0);
  }
  expect(await library(request)).toEqual(before);
  await page.goto('/');
  await page.getByTestId('source-input').fill(file);
  await page.getByTestId('engine-select').selectOption('fixture');
  await page.getByTestId('instruction-input').fill('Draw the system');
  await page.getByTestId('generate-button').click();
  await expect(page.getByTestId('form-error')).toContainText('Folder not found');
  await expect(page.getByTestId('editor')).toHaveCount(0);
  expect(await library(request)).toEqual(before);
  await page.getByTestId('source-input').fill(source);
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
  await page.getByTestId('generate-button').click();
  const accepted = await pending;
  expect(accepted.status()).toBe(202);
  const run = await waitRun(request, (await accepted.json()).runId);
  await expect(page).toHaveURL(new RegExp(`/d/${run.diagramId}$`));
  await expect(page.getByTestId('diagram-title')).toHaveText('Sample Shop architecture');
  expect((await library(request)).length).toBe(before.length + 1);
});
