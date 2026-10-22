import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, listedDiagrams, exists, samePath } from './helpers';
import {
  WHOLE, option, typed, SLUG, ENGINE_LINES, CHANNEL_LINE, CHANNEL_REUSED, startDrawChoices, messagesOf, progressOf, choiceStates, getRaw, choiceIds, viewIdsOf, type RunChoice,
} from './helpers-selections';

const FLAKY = 'Billing [fixture:flaky:second]';
const STUBBORN = 'Notes [fixture:fail:second]';

// START-7, START-6 (api contract, *What a failed draw keeps*, ADR 0015): a choice that fails ends the run, writes nothing and keeps, in
// memory, the choices that finished. The same draw again goes through the finished choices without an engine call and starts from the
// first choice that did not finish; a draw that leaves the failed choice out draws the others from what is kept, whatever the order;
// a success removes what was kept.
test('H195 [START-7 START-6 STORY-1 READ-1 #181] a failure in the second choice writes nothing and keeps the first, the same draw again goes through the first without an engine call and starts at the second, and a draw without the failed choice reuses what was kept in any order', async ({ request }) => {
  test.setTimeout(480_000);
  const auth = await token(request);
  const lines = (events: { event: string; data: any }[], id: string, stage: string) => messagesOf(events, id, stage);
  const listedBefore = (await listedDiagrams(request)).length;

  // ---- A choice fails once: the first draw stops in its read, the second goes on from there.
  const project = await gitRepo('draw-keeps');
  const control = await gitRepo('draw-keeps-control');
  const scan = await scanFolder(request, auth, project.dir);
  const choices = [WHOLE, typed(FLAKY), option('o2')];
  const flakyId = 'billing-fixture-flaky-second';
  const firstId = await startDrawChoices(request, auth, scan.id, choices, 'linkedin');
  const first = await finishRun(request, firstId, 'failed', 240_000);
  expect(first.error).toContain('Fixture failure requested');
  expect(choiceStates(first), 'the first is done, the one it stopped in failed, the last still waits').toEqual(['system:done', `${flakyId}:failed`, `${SLUG.o2}:waiting`]);
  expect((first.choices as RunChoice[]).map(c => c.stage)).toEqual(['channel', 'read', null]);
  expect(first).toMatchObject({ status: 'failed', diagramId: null, path: null, choice: 'system' });
  const firstEvents = await runEvents(firstId);
  expect(firstEvents.at(-1)!.data).toMatchObject({ status: 'failed', diagramId: null, path: null }); expect(firstEvents.at(-1)!.data.choices).toEqual(first.choices);
  expect(lines(firstEvents, 'system', 'read'), 'the first choice was read').toContain('Reading the code');
  expect(lines(firstEvents, 'system', 'channel')).toContain(CHANNEL_LINE.linkedin);
  expect(messagesOf(firstEvents, flakyId)[0]).toBe(`Drawing "${FLAKY}" (2 of 3)`);
  expect(progressOf(firstEvents, SLUG.o2), 'the third never started').toEqual([]);
  // Nothing is written or registered: not even the choice that finished.
  expect(await exists(join(project.dir, 'docs'))).toBe(false); expect((await project.git(['status', '--porcelain'])).trim()).toBe('');
  expect((await listedDiagrams(request)).length).toBe(listedBefore);

  // The same draw again: the first choice goes through what was kept (the read checked again, the overview and the post "already drawn"),
  // with no engine line in it; the second reads for the first time; the third as usual. One file is written.
  const secondId = await startDrawChoices(request, auth, scan.id, choices, 'linkedin');
  const second = await finishRun(request, secondId, 'succeeded', 240_000);
  expect(choiceStates(second)).toEqual(['system:done', `${flakyId}:done`, `${SLUG.o2}:done`]);
  const events = await runEvents(secondId);
  const read = lines(events, 'system', 'read'), overview = lines(events, 'system', 'overview'), channel = lines(events, 'system', 'channel');
  expect(read).toContain('Using the facts already read'); expect(read).toContain('Checking the facts');
  expect(read.indexOf('Using the facts already read')).toBeLessThan(read.indexOf('Checking the facts'));
  expect(overview).toContain('Drawing the overview'); expect(overview).toContain('Using the overview already drawn');
  expect(overview.indexOf('Drawing the overview')).toBeLessThan(overview.indexOf('Using the overview already drawn'));
  expect(channel).toContain(CHANNEL_LINE.linkedin); expect(channel).toContain(CHANNEL_REUSED.linkedin);
  expect(channel.indexOf(CHANNEL_LINE.linkedin)).toBeLessThan(channel.indexOf(CHANNEL_REUSED.linkedin));
  for (const line of ENGINE_LINES) expect(messagesOf(events, 'system'), `no engine call for the finished choice: "${line}"`).not.toContain(line);
  expect(messagesOf(events, flakyId)[0]).toBe(`Drawing "${FLAKY}" (2 of 3)`);
  expect(lines(events, flakyId, 'read'), 'the failed choice reads for the first time').toEqual(expect.arrayContaining(['Reading the code', 'Checking the facts']));
  expect(messagesOf(events, flakyId)).not.toContain('Using the facts already read');
  expect(lines(events, SLUG.o2, 'read')).toContain('Reading the code');
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  expect(samePath(second.path, file)).toBe(true); expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  expect((await listedDiagrams(request)).length).toBe(listedBefore + 1);
  const doc = await getRaw(request, second.diagramId);
  expect(choiceIds(doc)).toEqual(['system', flakyId, SLUG.o2]);

  // It is the drawing of a draw that never failed: the same facts and the same warnings (titles apart).
  const cleanRun = await finishRun(request, await startDrawChoices(request, auth, (await scanFolder(request, auth, control.dir)).id, [WHOLE, typed('Billing'), option('o2')], 'linkedin'), 'succeeded', 240_000);
  const clean = await getRaw(request, cleanRun.diagramId);
  doc.choices.forEach((c, i) => expect(c.facts, c.id).toEqual(clean.choices[i].facts));
  expect((doc.warnings ?? []).map(w => w.replace(`${FLAKY}: `, 'Billing: '))).toEqual(clean.warnings ?? []);
  expect(doc.choices.map(c => viewIdsOf(c))).toEqual(clean.choices.map(c => viewIdsOf(c).map(v => v.replace('billing', flakyId))));

  // ---- A choice that fails every time: the finished one is kept for any later draw of the folder, in any order.
  const other = await gitRepo('draw-keeps-other');
  const otherScan = await scanFolder(request, auth, other.dir);
  const stubborn = [WHOLE, typed(STUBBORN), option('o2')];
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = await finishRun(request, await startDrawChoices(request, auth, otherScan.id, stubborn, 'linkedin'), 'failed', 240_000);
    expect(choiceStates(run), `attempt ${attempt}`).toEqual(['system:done', 'notes-fixture-fail-second:failed', `${SLUG.o2}:waiting`]);
  }
  expect(await exists(join(other.dir, 'docs'))).toBe(false);
  // Without the failed choice, and with the finished one second: the section reads, the whole system comes from what was kept.
  const without = await startDrawChoices(request, auth, otherScan.id, [option('o2'), WHOLE], 'linkedin');
  const done = await finishRun(request, without, 'succeeded', 240_000);
  const withoutEvents = await runEvents(without);
  expect(choiceStates(done)).toEqual([`${SLUG.o2}:done`, 'system:done']);
  expect(lines(withoutEvents, SLUG.o2, 'read'), 'the section had no record').toContain('Reading the code');
  expect(lines(withoutEvents, 'system', 'read')).toContain('Using the facts already read');
  expect(lines(withoutEvents, 'system', 'overview')).toContain('Using the overview already drawn');
  expect(lines(withoutEvents, 'system', 'channel')).toContain(CHANNEL_REUSED.linkedin);
  for (const line of ENGINE_LINES) expect(messagesOf(withoutEvents, 'system'), `"${line}" for the reused choice`).not.toContain(line);
  const without4 = await getRaw(request, done.diagramId);
  expect(choiceIds(without4)).toEqual([SLUG.o2, 'system']);
  // The reused choice is now the second of the file: its views are named as the second choice's are, and they are valid and unique.
  expect(viewIdsOf(without4.choices[0])).toEqual([`overview`]); expect([...viewIdsOf(without4.choices[1])].sort()).toEqual(['system-overview', 'zone-runtime-inside']);
  expect(without4.choices[1].channels.overview.views![0].id, 'the map is the overview\'s first view').toBe('system-overview');
  expect(without4.choices[1].channels.linkedin!.views![0].id).toBe('system-linkedin');
  // A success removes what was kept: the next draw reads the whole system again.
  const again = await startDrawChoices(request, auth, otherScan.id, [WHOLE, option('o2')], 'linkedin');
  await finishRun(request, again, 'succeeded', 240_000);
  const againEvents = await runEvents(again);
  expect(lines(againEvents, 'system', 'read')).toContain('Reading the code'); expect(messagesOf(againEvents)).not.toContain('Using the facts already read');

  // ---- The channel is free: a finished choice drawn in LinkedIn, asked for in the README, reuses its read and overview and draws the README.
  const third = await gitRepo('draw-keeps-channel');
  const thirdScan = await scanFolder(request, auth, third.dir);
  const failing = await finishRun(request, await startDrawChoices(request, auth, thirdScan.id, [WHOLE, typed(STUBBORN)], 'linkedin'), 'failed', 240_000);
  expect(choiceStates(failing)).toEqual(['system:done', 'notes-fixture-fail-second:failed']);
  const readme = await startDrawChoices(request, auth, thirdScan.id, [WHOLE], 'readme');
  const readmeRun = await finishRun(request, readme, 'succeeded', 240_000);
  const readmeEvents = await runEvents(readme);
  expect(lines(readmeEvents, 'system', 'read')).toContain('Using the facts already read');
  expect(lines(readmeEvents, 'system', 'overview')).toContain('Using the overview already drawn');
  expect(lines(readmeEvents, 'system', 'channel')).toContain(CHANNEL_LINE.readme);
  expect(lines(readmeEvents, 'system', 'channel'), 'the README was not the channel it was kept in: it is drawn by a call').not.toContain(CHANNEL_REUSED.readme);
  expect(lines(readmeEvents, 'system', 'channel').some(m => ENGINE_LINES.includes(m))).toBe(true);
  const readmeDoc = await getRaw(request, readmeRun.diagramId);
  expect(choiceIds(readmeDoc)).toEqual(['system']); expect(readmeDoc.choices[0].channels.readme!.views).toHaveLength(1); expect(readmeDoc.choices[0].channels.linkedin?.views ?? []).toEqual([]);
});
