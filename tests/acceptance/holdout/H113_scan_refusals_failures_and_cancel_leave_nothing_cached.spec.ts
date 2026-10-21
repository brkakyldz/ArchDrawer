import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, markerRepo, token, postJSON, checkFolder, startScan, scanRecord, finishScan, scanEvents, scanCacheCount, listedDiagrams, baseURL } from './helpers';

// The folder is checked the same way for the folder check and for a scan, with the contract's sentences, before anything
// else happens. A failed or cancelled scan keeps nothing; a folder being scanned refuses a second scan.
test('H113 [START-4, SCAN-1, SCAN-4] a wrong folder, refresh or model is refused with the contract sentence before any scan starts, and a failed or cancelled scan leaves nothing in the cache', async ({ request }) => {
  const auth = await token(request);
  const project = await gitRepo('scan-errors');
  const before = await scanCacheCount(), diagramsBefore = (await listedDiagrams(request)).length;
  const missing = join(project.dir, 'nothing-here'), aFile = join(project.dir, 'alpha.ts');

  // The folder sentences, the same for the check and for a scan; each is a 400.
  const refusals: [unknown, string | RegExp][] = [
    [undefined, 'Give the absolute path of a folder'], [42, 'Give the absolute path of a folder'], [null, 'Give the absolute path of a folder'],
    ['some/relative/folder', 'The path must be absolute'], [missing, new RegExp(`^Not found: .*${basename(missing)}$`)],
    [aFile, new RegExp(`^Not a folder: .*alpha\\.ts$`)],
  ];
  for (const [folder, expected] of refusals) {
    const checked = await checkFolder(request, auth, folder), scanned = await postJSON(request, auth, '/api/scans', { folder, engine: 'fixture', model: null });
    for (const answer of [checked, scanned]) {
      expect(answer.status, String(folder)).toBe(400);
      if (typeof expected === 'string') expect(answer.body.error).toBe(expected); else expect(answer.body.error).toMatch(expected);
    }
  }

  // The checks run in order: the folder, then `refresh`, then the model, then the engine.
  const order = await postJSON(request, auth, '/api/scans', { folder: missing, refresh: 'yes', model: '--evil', engine: 'nope' });
  expect(order.status).toBe(400); expect(order.body.error).toMatch(/^Not found: /);
  const refresh = await postJSON(request, auth, '/api/scans', { folder: project.dir, refresh: 'yes', model: '--evil', engine: 'nope' });
  expect(refresh).toMatchObject({ status: 400, body: { error: 'refresh must be true or false' } });
  const asNumber = await postJSON(request, auth, '/api/scans', { folder: project.dir, refresh: 1, engine: 'fixture' });
  expect(asNumber).toMatchObject({ status: 400, body: { error: 'refresh must be true or false' } });
  const model = await postJSON(request, auth, '/api/scans', { folder: project.dir, model: '--evil', engine: 'nope' });
  expect(model).toMatchObject({ status: 400, body: { error: 'Invalid model name "--evil"' } });
  const engine = await postJSON(request, auth, '/api/scans', { folder: project.dir, engine: 'nope', model: null });
  expect(engine.status).toBe(400); expect(engine.body.error).toContain('Unknown engine "nope"');
  // A scan needs the token like every other change.
  const noToken = await request.post(`${baseURL()}/api/scans`, { data: { folder: project.dir } });
  expect(noToken.status()).toBe(403);
  // Must not happen: a refused request starting a scan or keeping anything.
  expect(await scanCacheCount()).toBe(before);

  // Unknown scans are not found, for the record, the stream and the cancel.
  const gone = await request.get(`${baseURL()}/api/scans/s_nothere`);
  expect(gone.status()).toBe(404); expect((await gone.json()).error).toBe('Scan not found');
  expect((await request.get(`${baseURL()}/api/scans/s_nothere/events`)).status()).toBe(404);
  expect((await postJSON(request, auth, '/api/scans/s_nothere/cancel', {})).status).toBe(404);

  // The fixture's markers live in the folder's last segment, which a Windows folder cannot carry (":").
  if (process.platform !== 'win32') {
    const failing = (await markerRepo('[fixture:fail]'))!;
    const failedId = await startScan(request, auth, failing.dir), failed = await finishScan(request, failedId, 'failed');
    expect(failed.error, 'a failed scan says why').toBeTruthy(); expect(failed.card).toBeNull(); expect(failed.options).toBeNull();
    const failedEvents = await scanEvents(failedId);
    expect(failedEvents.filter(e => e.event === 'done')).toHaveLength(1);
    expect(failedEvents.at(-1)!.data).toMatchObject({ status: 'failed', card: null }); expect(failedEvents.at(-1)!.data.error).toBeTruthy();
    expect(await scanCacheCount(), 'a failed scan caches nothing').toBe(before);

    // A folder being scanned refuses a second scan; cancelling stops it and keeps nothing; the folder can be scanned again.
    const slow = (await markerRepo('[fixture:slow]'))!;
    const running = await startScan(request, auth, slow.dir);
    await expect.poll(async () => (await scanRecord(request, running)).progress.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect((await scanRecord(request, running)).status).toBe('running');
    const second = await postJSON(request, auth, '/api/scans', { folder: slow.dir, engine: 'fixture', model: null });
    expect(second).toMatchObject({ status: 409, body: { error: 'A scan of this folder is already running' } });
    const cancelled = await postJSON(request, auth, `/api/scans/${running}/cancel`, {});
    expect(cancelled).toMatchObject({ status: 200, body: { ok: true } });
    const stopped = await finishScan(request, running, 'cancelled', 20_000);
    expect(stopped.card).toBeNull(); expect(stopped.options).toBeNull();
    expect((await scanEvents(running)).at(-1)).toMatchObject({ event: 'done', data: { status: 'cancelled' } });
    expect(await scanCacheCount(), 'a cancelled scan caches nothing').toBe(before);
    const again = await startScan(request, auth, slow.dir); // not refused: the first one is over
    await postJSON(request, auth, `/api/scans/${again}/cancel`, {}); await finishScan(request, again, 'cancelled', 20_000);
    expect(await scanCacheCount()).toBe(before);
  }
  expect((await listedDiagrams(request)).length, 'no scan registers a drawing').toBe(diagramsBefore);
});
