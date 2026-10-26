import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, startedRun, runEvents, listedDiagrams, exists, samePath, viewOf } from './helpers';
import { getDocument } from './helpers-selections'; // a draw writes format 4: this gives the drawn choice in the shape the scenario was written in

const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found', 'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped', 'Dropped "ghost-limit": its component "ghost" was dropped',
];

// STORY-7 (ADR 0009) inside START-4: the overview call of a draw has an answer with an over-long description. The repair turn
// belongs to the overview stage, the draw goes on to the channel and ends in a written drawing, with the engine's own text.
test('H148 [STORY-7, START-4, STORY-1, #181] a draw from the home screen whose overview answer is over-long gets one repair turn in the overview stage and ends in a written drawing with the engine\'s own description and no Shortened warning', async ({ page, request }) => {
  test.setTimeout(240_000);
  const project = await gitRepo('story-home-repair');
  const listedBefore = (await listedDiagrams(request)).length;

  await page.goto('/'); await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('focus-typed').click(); await page.getByTestId('focus-text').fill('The tool loop [fixture:overlong]');
  await page.getByTestId('channel-choice-linkedin').click();
  const started = await startedRun(page, () => page.getByTestId('draw-start').click());
  expect(started.body).toMatchObject({ kind: 'draw', channel: 'linkedin', choices: [{ kind: 'typed', text: 'The tool loop [fixture:overlong]' }] }); expect(started.body).not.toHaveProperty('focus');

  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('draw-error')).toHaveCount(0);

  // The events: one `Fixing 1 problem in the answer`, in the overview stage, after the read and before the channel.
  const events = (await runEvents(started.runId)).filter(e => e.event === 'progress');
  const messages = events.map(e => e.data.message as string);
  const fixing = events.filter(e => String(e.data.message).startsWith('Fixing'));
  expect(fixing).toHaveLength(1);
  expect(fixing[0].data).toMatchObject({ message: 'Fixing 1 problem in the answer', stage: 'overview' });
  const at = messages.indexOf('Fixing 1 problem in the answer');
  expect(at).toBeGreaterThan(messages.indexOf('Checking the facts'));
  expect(at).toBeGreaterThan(messages.indexOf('Drawing the overview'));
  expect(at).toBeLessThan(messages.indexOf('Drawing the LinkedIn post'));
  expect(events.slice(at + 1).find(e => e.data.stage === 'overview'), 'the repair turn shows its engine lines in the overview stage').toBeTruthy();
  expect(events.filter(e => e.data.stage === 'channel').some(e => String(e.data.message).startsWith('Fixing')), 'the channel call needed none').toBe(false);
  expect(messages.some(m => m.startsWith('Shortened'))).toBe(false);

  // The drawing: written, registered, with the repaired overview description.
  const run = await (await request.get(`${new URL(page.url()).origin}/api/runs/${started.runId}`)).json();
  expect(run).toMatchObject({ status: 'succeeded', kind: 'draw', channel: 'linkedin', error: null });
  expect(run.path && await exists(run.path)).toBe(true);
  expect(samePath(run.path, join(project.dir, 'docs', 'architecture.archdraw.json'))).toBe(true);
  const doc = await getDocument(request, run.diagramId);
  expect(viewOf(doc, 'overview')!.caption.lede).toBe('Drawn by the test engine.');
  expect(doc.warnings!.slice(0, 4)).toEqual(FOUR_WARNINGS);
  expect((doc.warnings ?? []).filter(w => /^Shortened/.test(w)), 'no warning for the length').toEqual([]);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
});
