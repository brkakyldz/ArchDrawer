import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { copyFile, writeFile } from 'node:fs/promises';
import { useProduct } from './server';
import {
  makeRemote, copyFolder, partialFolder, home, answerTo, scan, startScan, waitScan, startDraw, waitRun, runRecord, library, register, exists, listDir,
  WHOLE, typed,
} from './helpers';

const product = useProduct();
const SHOP = 'github.com/acme/shop', SLOW = 'github.com/acme/slowrepo', KEPT = 'github.com/acme/kept';

// A user's linked repository while work runs on it: a copy still being made is cancelled from the home screen and leaves nothing; while a
// draw uses a copy, a branch switch is refused, its own branch is scanned as it is, and the copy cannot be deleted; a copy holding another
// listed drawing cannot be deleted either; a copy with no listed drawing stays.
test('H09 [SRC-5 SRC-6 JOB-10 HOME-2] a cancelled copy leaves nothing, a copy in use is neither switched nor deleted, and a copy is deleted only with its last listed drawing', async ({ page }) => {
  test.setTimeout(240_000);
  const p = product();
  const shop = await makeRemote(p, SHOP);
  await makeRemote(p, SLOW); await writeFile(join(p.remotes, 'github.com', 'acme', 'slowrepo.slow'), '', 'utf8');
  await makeRemote(p, KEPT);

  // A slow copy, cancelled from the panel: no copy, no half copy, and the panel is free again with the link kept.
  await home(page, p);
  await page.getByTestId('start-source-link').click();
  await page.getByTestId('start-link').fill(`https://${SLOW}`);
  await expect(page.getByTestId('start-scan')).toBeEnabled();
  const started = await answerTo(page, 'POST', /^\/api\/scans$/, () => page.getByTestId('start-scan').click());
  await expect(page.getByTestId('scan-progress')).toContainText(`Copying ${SLOW}`);
  const second = await p.post('/api/scans', { link: `https://${SLOW}`, engine: 'fixture', model: null });
  expect(second).toMatchObject({ status: 409, body: { scanId: started.body.scanId } });
  expect(second.body.error).toMatch(/scan of this repository is already running/);
  await page.getByTestId('scan-cancel').click();
  await expect(page.getByTestId('start-error')).toHaveText(/Cancelled/);
  await expect(page.getByTestId('start-steps').locator('[data-state="now"]')).toHaveText(/Folder/);
  await expect(page.getByTestId('start-link')).toBeEnabled();
  await waitScan(p, started.body.scanId, 'cancelled');
  expect(await exists(copyFolder(p, SLOW)), 'a cancelled copy leaves no copy').toBe(false);
  expect(await listDir(partialFolder(p)), 'and no half copy').toEqual([]);

  // A copy with a listed drawing, and a draw running on it.
  const first = await scan(p, { link: `https://${SHOP}` });
  const drawn = await waitRun(p, await startDraw(p, first.id, [WHOLE], 'readme'));
  const copy = copyFolder(p, SHOP);
  const runId = await startDraw(p, first.id, [typed('A slow part [fixture:slow]')], 'readme');
  await expect.poll(async () => (await runRecord(p, runId)).choices[0].status).toBe('running');

  const switched = await waitScan(p, await startScan(p, { link: `https://${SHOP}/tree/other` }), 'failed');
  expect(switched.error).toMatch(/in use on the branch "main"/);
  const asIs = await scan(p, { folder: copy });
  expect(asIs.progress.join('\n')).toMatch(new RegExp(`in use: scanning the copy at ${(await shop.head()).slice(0, 7)} on main`));
  const inUse = await p.del(`/api/diagrams/${drawn.diagramId}?deleteCopy=true`);
  expect(inUse.status).toBe(409);
  expect(inUse.body.error).toMatch(/in use/);
  expect((await library(p)).some(d => d.id === drawn.diagramId), 'a refused delete forgets nothing').toBe(true);

  expect((await p.post(`/api/runs/${runId}/cancel`)).body).toEqual({ ok: true });
  await waitRun(p, runId, 'cancelled');
  expect((await listDir(join(copy, 'docs'))).filter(n => n.endsWith('.json')), 'the cancelled draw wrote nothing').toEqual(['architecture.archdraw.json']);

  // Another listed drawing in the same copy keeps it.
  const other = join(copy, 'docs', 'second.archdraw.json');
  await copyFile(join(copy, 'docs', 'architecture.archdraw.json'), other);
  const otherId = (await register(p, other)).id;
  const shared = await p.del(`/api/diagrams/${drawn.diagramId}?deleteCopy=true`);
  expect(shared.status).toBe(409);
  expect(shared.body.error).toMatch(/Other drawings .* in this copy/);
  expect((await p.del(`/api/diagrams/${otherId}`)).status, 'forgetting the other drawing only').toBe(204);
  expect(await exists(other), 'a forgotten file stays where it is').toBe(true);
  expect((await p.del(`/api/diagrams/${drawn.diagramId}?deleteCopy=true`)).status).toBe(204);
  expect(await exists(copy), 'deleted with its last listed drawing').toBe(false);

  // A copy no listed drawing lies in stays in the data folder.
  await scan(p, { link: `https://${KEPT}` });
  expect(await exists(join(copyFolder(p, KEPT), 'alpha.ts'))).toBe(true);
  expect((await p.del(`/api/diagrams/${otherId}?deleteCopy=true`)).status, 'a forgotten drawing is not in the list any more').toBe(404);
  expect(await exists(join(copyFolder(p, KEPT), 'alpha.ts'))).toBe(true);
});
