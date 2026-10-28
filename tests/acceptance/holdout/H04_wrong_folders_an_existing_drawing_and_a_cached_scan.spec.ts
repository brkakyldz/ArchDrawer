import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import { gitRepo, plainFolder, scan, home, tick, startedRun, answerTo, activity, scanRecord, scanEvents, readText, writeJSON, shopDoc, listDir, exists } from './helpers';

const product = useProduct();

// A user mistypes the folder three ways, then points at a repository that already has a drawing: they start again (the new drawing takes the
// next free name and the old file is untouched), come back for the same commit (the scan is not made again, until they ask), and finally
// open the drawing that was already there.
test('H04 [START-4 SCAN-4 HOME-2 FILE-1 START-7] wrong folders are refused in one sentence, an existing drawing is kept, a second draw takes the next name, and the same commit is not scanned again until asked', async ({ page }) => {
  const p = product();
  const project = await gitRepo('existing');
  const earlier = join(project.dir, 'docs', 'architecture.archdraw.json');
  await writeJSON(earlier, shopDoc('Earlier drawing'));
  const earlierText = await readText(earlier);
  const notAFolder = join(project.dir, 'alpha.ts');

  await home(page, p);
  const error = page.getByTestId('start-error');
  await page.getByTestId('start-scan').click();
  await expect(error).toHaveText(/whole path/i);
  for (const [typedPath, words] of [['projects/shop', /whole path/i], [notAFolder, /file.*not a folder/i], [join(project.dir, 'missing'), /does not exist/i]] as const) {
    await page.getByTestId('start-folder').fill(typedPath);
    await page.getByTestId('start-scan').click();
    await expect(error).toHaveText(words);
    await expect(error).toHaveAttribute('role', 'alert');
  }
  // Must not happen: a refused folder starting a scan.
  expect((await activity(p)).jobs).toHaveLength(0);
  await expect(page.getByTestId('activity-none')).toBeVisible();

  // The folder already has a drawing: nothing scans until the user says so.
  await page.getByTestId('start-folder').fill(project.dir);
  await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('start-existing')).toBeVisible();
  await expect(error).toHaveCount(0);
  expect((await activity(p)).jobs).toHaveLength(0);
  await page.getByTestId('start-again').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('scan-cached')).toHaveCount(0);
  await tick(page, { whole: true }, 'readme');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });
  const second = join(project.dir, 'docs', 'architecture-2.archdraw.json');
  expect(await exists(second), 'the next free name').toBe(true);
  expect(await readText(earlier), 'the earlier drawing is untouched').toBe(earlierText);
  expect((await listDir(join(project.dir, 'docs'))).filter(n => n.endsWith('.json')).sort()).toEqual(['architecture-2.archdraw.json', 'architecture.archdraw.json']);
  expect((await (await fetch(`${p.base}/api/runs/${run.runId}`)).json()).path).toMatch(/architecture-2\.archdraw\.json$/);

  // The same commit again: answered from the cache, with no engine; Scan again makes it anew.
  const cachesBefore = (await listDir(join(p.data, 'scans'))).length;
  await page.getByTestId('draw-another').click();
  await expect(page.getByTestId('start-folder')).toHaveValue('');
  await page.getByTestId('start-folder').fill(project.dir);
  await page.getByTestId('start-scan').click();
  const cached = await answerTo(page, 'POST', /^\/api\/scans$/, () => page.getByTestId('start-again').click());
  expect(cached.status).toBe(202);
  await expect(page.getByTestId('scan-cached')).toContainText((await project.head()).slice(0, 7));
  const cachedRecord = await scanRecord(p, cached.body.scanId);
  expect(cachedRecord).toMatchObject({ status: 'succeeded', cached: true });
  const cachedLines = (await scanEvents(p, cached.body.scanId)).filter(e => e.event === 'progress');
  expect(cachedLines.map(e => e.data.source), 'no engine line').not.toContain('engine');
  expect(cachedLines).toHaveLength(1);
  const again = await answerTo(page, 'POST', /^\/api\/scans$/, () => page.getByTestId('scan-again').click());
  expect(again.sent.refresh).toBe(true);
  await expect(page.getByTestId('scan-card')).toBeVisible();
  await expect.poll(async () => (await scanRecord(p, again.body.scanId)).status, { timeout: 60_000 }).toBe('succeeded');
  expect((await scanRecord(p, again.body.scanId)).cached).toBe(false);
  await expect(page.getByTestId('scan-cached')).toHaveCount(0);
  expect((await listDir(join(p.data, 'scans'))).length, 'the entry is replaced, not added').toBe(cachesBefore);

  // A folder outside git is never cached: the same folder twice is scanned twice.
  const loose = await plainFolder('not-in-git');
  const once = await scan(p, { folder: loose });
  const twice = await scan(p, { folder: loose });
  expect([once.commit, once.cached, twice.cached]).toEqual([null, false, false]);
  expect((await listDir(join(p.data, 'scans'))).length, 'nothing cached for it').toBe(cachesBefore);

  // Back to the folder: the drawing that was there opens as it is.
  await page.getByTestId('start-change-folder').click();
  await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('start-existing')).toBeVisible();
  await page.getByTestId('start-open-existing').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('repo-name')).toHaveText('Earlier drawing');
});
