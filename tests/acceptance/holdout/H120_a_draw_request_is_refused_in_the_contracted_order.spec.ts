import { test, expect } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitRepo, plainFolder, projectFiles, writeFiles, markerRepo, token, scanFolder, scanRecord, startScan, finishScan, startDraw, finishRun, refusedDraw, postJSON, listedDiagrams, samePath, exists } from './helpers';

const FOCUS = 'Unknown focus: use {"kind": "option" | "whole" | "typed"}';
const SCAN = 'Scan the folder first: that scan is unknown or did not succeed';

// The checks of a draw run come in a fixed order, each a 400 before any engine starts: the scan, the scan's folder (checked
// again), the focus, the focus option, the focus text, the channel, then the model and the engine. Several mistakes in one request report the first.
// H193 holds the order itself for `choices` and the single `focus` (an unknown or missing scan, neither choices nor focus, an unknown
// focus kind, the channel, a bad model before the engine, the engine, the token); this scenario keeps what H193 does not ask.
test('H120 [START-4, SCAN-3, STORY-1, #181] a draw request whose scan is no scan or has lost its folder, whose single focus is wrong or whose model is bad is refused with the first fault in the contracted order, a scan that failed, still runs or was cancelled is no scan to draw from, and nothing is started or written', async ({ request }) => {
  const auth = await token(request);
  const project = await gitRepo('draw-refusals');
  const scan = await scanFolder(request, auth, project.dir);
  const listedBefore = (await listedDiagrams(request)).length;
  const ask = (data: Record<string, unknown>) => refusedDraw(request, auth, data);
  const good = { scan: scan.id, focus: { kind: 'whole' }, channel: 'linkedin' };

  // 1. The scan comes first: a scan id that is not even a string is no scan.
  expect(await ask({ scan: 42, focus: { kind: 'whole' }, channel: 'linkedin' })).toEqual({ status: 400, error: SCAN });

  // 2. The scan's folder is checked again, as for any folder, before the focus: it may have gone since the scan. The finished scan
  // is kept meanwhile, and a draw from it works again once the folder is back.
  const away = await plainFolder('draw-folder-gone'); const awayScan = await scanFolder(request, auth, away);
  await rm(away, { recursive: true, force: true });
  const gone = await ask({ scan: awayScan.id, focus: { kind: 'banana' }, channel: 'board', model: '--x' });
  expect(gone.status).toBe(400); expect(gone.error.startsWith('Not found: '), gone.error).toBe(true); expect(samePath(gone.error.slice('Not found: '.length), away), gone.error).toBe(true);
  expect(await ask({ scan: 's_unknown', focus: { kind: 'whole' }, channel: 'linkedin' }), 'an unknown scan is still the first fault').toEqual({ status: 400, error: SCAN });
  await writeFile(away, 'now a file\n');
  const file = await ask({ scan: awayScan.id, focus: { kind: 'whole' }, channel: 'linkedin' });
  expect(file.status).toBe(400); expect(file.error.startsWith('Not a folder: '), file.error).toBe(true); expect(samePath(file.error.slice('Not a folder: '.length), away), file.error).toBe(true);
  expect((await scanRecord(request, awayScan.id)).status, 'the finished scan is kept').toBe('succeeded');
  await rm(away, { force: true }); await writeFiles(away, projectFiles);
  const back = await finishRun(request, await startDraw(request, auth, awayScan.id, { kind: 'whole' }, 'linkedin'), 'succeeded', 30_000);
  expect(samePath(back.path, join(away, 'docs', 'architecture.archdraw.json')), back.path).toBe(true);

  // 3. The focus kind, 4. the option, 5. the text, in the single `focus` form (H193 asks them through `choices`).
  expect(await ask({ scan: scan.id, focus: 'whole', channel: 'linkedin' })).toEqual({ status: 400, error: FOCUS });
  expect(await ask({ scan: scan.id, focus: { kind: 'option', option: 'o9' }, channel: 'board' })).toEqual({ status: 400, error: 'Unknown focus option "o9"' });
  // The fourth fixture option names a file that is not there: it was left out of the scan, so it cannot be chosen.
  expect(await ask({ ...good, focus: { kind: 'option', option: 'o4' } })).toEqual({ status: 400, error: 'Unknown focus option "o4"' });
  expect(await ask({ ...good, focus: { kind: 'typed', text: '   ' }, channel: 'board' })).toEqual({ status: 400, error: 'Say what to focus on: the focus is empty' });
  expect(await ask({ ...good, focus: { kind: 'typed', text: '' } })).toEqual({ status: 400, error: 'Say what to focus on: the focus is empty' });
  expect(await ask({ ...good, focus: { kind: 'typed', text: 'x'.repeat(301) }, channel: 'board' })).toEqual({ status: 400, error: 'The focus is too long (300 characters at most)' });

  // 7. A model name the contract does not allow (H193 holds the model before the engine, and the engine).
  expect(await ask({ ...good, model: 'bad model!' })).toEqual({ status: 400, error: 'Invalid model name "bad model!"' });

  // A scan that did not succeed is not a scan to draw from: here one that failed or is still running (the folder name carries the marker).
  if (process.platform !== 'win32') {
    const failing = (await markerRepo('[fixture:fail]'))!;
    const failedId = await startScan(request, auth, failing.dir); await finishScan(request, failedId, 'failed');
    expect(await ask({ scan: failedId, focus: { kind: 'whole' }, channel: 'linkedin' })).toEqual({ status: 400, error: SCAN });
    const slow = (await markerRepo('[fixture:slow]'))!;
    const runningId = await startScan(request, auth, slow.dir);
    expect(await ask({ scan: runningId, focus: { kind: 'whole' }, channel: 'linkedin' })).toEqual({ status: 400, error: SCAN });
    await postJSON(request, auth, `/api/scans/${runningId}/cancel`, {}); await finishScan(request, runningId, 'cancelled', 20_000);
    expect(await ask({ scan: runningId, focus: { kind: 'whole' }, channel: 'linkedin' })).toEqual({ status: 400, error: SCAN });
  }

  // `draw` stays a known kind of run: none of the refusals above is about the kind, and the sentence for a wrong kind lists it.
  expect(await ask({ ...good, kind: 'drawing' })).toEqual({ status: 400, error: 'Unknown run kind drawing: use refine, story, post, simplify, revise or draw' });

  // Must not happen: a refused request leaving a folder, a file or a drawing behind.
  expect(await exists(join(project.dir, 'docs'))).toBe(false);
  expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect(await exists(join(away, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length, 'only the draw that was accepted registered a drawing').toBe(listedBefore + 1);
});
