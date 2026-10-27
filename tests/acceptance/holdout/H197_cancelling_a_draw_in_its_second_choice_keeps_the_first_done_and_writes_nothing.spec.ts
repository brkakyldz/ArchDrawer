import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, postJSON, exists } from './helpers';
import { WHOLE, option, typed, SLUG, ENGINE_LINES, startDrawChoices, runRecord, choiceStates, messagesOf, getRaw, choiceIds } from './helpers-selections';

const SLOW = 'Slow question [fixture:slow:second]';
const SLOW_ID = 'slow-question-fixture-slow-second';

// START-7, START-6, JOB-2, JOB-10 (api contract, *Deadlines, a choice that fails, and cancel*, *What a failed draw keeps*): the choices of a draw run
// side by side, so cancelling it while its second choice is read (slowly) stops that choice and keeps every choice that finished done:
// the first, and the third, which started beside the slow one on a free slot. Nothing is written. The next draw of the same scan, without
// the cancelled choice and in another order, draws the others from what was kept, with no engine call for them. The same cancel on the
// home screen (the rows, `Cancelled`, `Try again` into a new file) is H247.
test('H197 [START-7 START-6 JOB-2 JOB-10 #196] cancelling a draw over the API while its slow second choice is read keeps the choices that finished beside it done and writes nothing, and the next draw without the cancelled choice draws the others from what was kept', async ({ request }) => {
  test.setTimeout(90_000);
  const auth = await token(request);

  // A third choice beside the slow one: it is done before the cancel, so only the slow one is cancelled.
  const project = await gitRepo('api-cancel');
  const scan = await scanFolder(request, auth, project.dir);
  const runId = await startDrawChoices(request, auth, scan.id, [WHOLE, typed(SLOW), option('o2')], 'linkedin');
  await expect.poll(async () => choiceStates(await runRecord(request, runId)), { timeout: 30_000 }).toEqual(['system:done', `${SLOW_ID}:running`, `${SLUG.o2}:done`]);
  expect((await runRecord(request, runId)).choices.map((c: { stage: string | null }) => c.stage)).toEqual(['channel', 'read', 'channel']);
  expect((await postJSON(request, auth, `/api/runs/${runId}/cancel`, {})).status).toBe(200);
  const record = await finishRun(request, runId, 'cancelled', 30_000);
  expect(choiceStates(record)).toEqual(['system:done', `${SLOW_ID}:cancelled`, `${SLUG.o2}:done`]);
  expect(record).toMatchObject({ status: 'cancelled', diagramId: null, path: null });
  expect(await exists(join(project.dir, 'docs'))).toBe(false);
  // The next draw leaves the cancelled choice out and draws the others, both from what was kept.
  const again = await startDrawChoices(request, auth, scan.id, [option('o2'), WHOLE], 'linkedin');
  const done = await finishRun(request, again, 'succeeded', 30_000);
  const againEvents = await runEvents(again);
  for (const id of ['system', SLUG.o2]) {
    expect(messagesOf(againEvents, id, 'read')).toContain('Using the facts already read');
    for (const line of ENGINE_LINES) expect(messagesOf(againEvents, id)).not.toContain(line);
  }
  expect(choiceIds(await getRaw(request, done.diagramId))).toEqual([SLUG.o2, 'system']);
});
