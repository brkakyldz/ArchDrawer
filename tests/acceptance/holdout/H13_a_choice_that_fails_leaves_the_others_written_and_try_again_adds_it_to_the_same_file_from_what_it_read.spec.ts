import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  says, gitRepo, scanOnHome, tick, startedRun, answerTo, rows, rowOf, runRecord, runEvents, lines, readJSON, listDir, engineLines, OPTION,
} from './helpers';

const product = useProduct();
const TYPED = 'How billing works [fixture:flaky:channel]', TYPED_ID = 'how-billing-works-fixture-flaky-channel';

// A user draws a section and a question of their own; the question's LinkedIn stage fails once. The draw still writes the section, says one
// could not be drawn and offers Try again, which draws the question into the same file from what it had already read and drawn.
test('H13 [JOB-3 START-6 START-7 HOME-6] a choice that fails at its last stage leaves the others in the file, and Try again adds it to the same file without reading again @smoke', async ({ page }) => {
  const p = product();
  const project = await gitRepo('try-again');
  await scanOnHome(page, p, project.dir);
  await tick(page, { options: ['o2'], typed: TYPED }, 'linkedin');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());

  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('draw-ready')).toContainText(/1 could not be drawn/);
  await expect(page.getByTestId('job-notice')).toBeVisible();
  const failedRow = rowOf(page, TYPED_ID);
  await expect(failedRow).toHaveAttribute('data-state', 'failed');
  await expect.poll(async () => (await rows(page)).find(r => r.choice === TYPED_ID)?.stages.map(s => `${s.stage}:${s.state}`)).toEqual(['read:done', 'overview:done', 'channel:failed']);
  await expect(failedRow.getByTestId('draw-choice-line')).toHaveText(/Could not draw: .*Fixture failure requested/);
  const first = await runRecord(p, run.runId);
  expect(first.status).toBe('succeeded');
  expect(first.choices.map((c: any) => `${c.id}:${c.status}:${c.stage}`)).toEqual([`${OPTION.o2.id}:done:channel`, `${TYPED_ID}:failed:channel`]);
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  const before = await readJSON(file);
  expect(before.choices.map((c: any) => c.id)).toEqual([OPTION.o2.id]);

  // Try again: the failed choice only, into the same file, from the read and the overview it already had.
  const retry = await answerTo(page, 'POST', /^\/api\/runs\/[^/]+\/retry$/, () => page.getByTestId('draw-retry').click());
  expect(retry.status).toBe(202);
  expect(retry.path).toBe(`/api/runs/${run.runId}/retry`);
  const retryId = retry.body.runId as string;
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('draw-ready')).not.toContainText(/could not be drawn/);
  const again = await runRecord(p, retryId);
  expect(again).toMatchObject({ status: 'succeeded', retryOf: run.runId, into: first.diagramId, diagramId: first.diagramId });
  expect(again.choices.map((c: any) => `${c.id}:${c.status}`)).toEqual([`${TYPED_ID}:done`]);
  expect(again.choices[0].filesRead, 'the read was reused').toBe(0);
  const events = await runEvents(p, retryId);
  expect(says(lines(events, TYPED_ID, 'read'), /facts already read/)).toBe(true);
  expect(says(lines(events, TYPED_ID, 'overview'), /overview already drawn/)).toBe(true);
  expect(engineLines(events, TYPED_ID, 'read'), 'no engine call').toEqual([]);
  expect(says(lines(events, TYPED_ID, 'channel'), /Drawing the LinkedIn post/)).toBe(true);
  expect(says(lines(events, TYPED_ID, 'channel'), /LinkedIn post already drawn/)).toBe(false);

  const after = await readJSON(file);
  expect(after.choices.map((c: any) => c.id)).toEqual([OPTION.o2.id, TYPED_ID]);
  expect(after.choices[0], 'the choice already in the file is exactly as it was').toEqual(before.choices[0]);
  expect(after.choices[1].channels.linkedin.views[0].id).toBe(`${TYPED_ID}-linkedin`);
  expect((await listDir(join(project.dir, 'docs'))).filter(n => n.endsWith('.json')), 'no second file').toEqual(['architecture.archdraw.json']);
  await expect(page.getByTestId('editor'), 'nothing opens the editor but the user').toHaveCount(0);

  // Open goes to the choice the retry added.
  await page.getByTestId('draw-open').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', TYPED_ID);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
});
