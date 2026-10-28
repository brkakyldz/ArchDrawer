import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  gitRepo, scanOnHome, isDisabled, isChecked, tick, startedRun, answerTo, rowStates, optionCard, runRecord, waitRun, scan, readJSON, listDir, OPTION, option, typed, WHOLE,
} from './helpers';

const product = useProduct();
const SLOW = 'A slow question [fixture:slow]', SLOW_ID = 'a-slow-question-fixture-slow';

// While a draw of the whole system and a slow question runs, the user comes back to the same folder and ticks one more section. The
// choosing step joins the running draw: what it holds is ticked and locked, the destination is its channel, and the new section lands in
// the same file. Joins the draw cannot take are refused with the reason, and nothing changes.
test('H15 [JOB-4 HOME-8 START-7] choices ticked while a draw of the folder runs join it, take its channel and land in its file, and joins it cannot take are refused', async ({ page }) => {
  test.setTimeout(240_000);
  const p = product();
  const project = await gitRepo('join');
  await scanOnHome(page, p, project.dir);
  await tick(page, { whole: true, typed: SLOW }, 'linkedin');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect.poll(() => rowStates(page), { timeout: 60_000 }).toEqual(['system:done', `${SLOW_ID}:running`]);

  // Back to the same folder: its scan is cached, and the choosing step joins the running draw.
  await page.getByTestId('draw-another').click();
  await page.getByTestId('start-folder').fill(project.dir);
  await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('focus-list')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => isDisabled(page.getByTestId('focus-whole'))).toBe(true);
  await expect.poll(() => isChecked(page.getByTestId('focus-whole')), { message: 'what the draw holds is ticked' }).toBe(true);
  await expect(page.getByTestId('focus-whole').getByTestId('focus-in-draw')).toBeVisible();
  await expect(page.getByTestId('focus-typed').getByTestId('focus-in-draw')).toBeVisible();
  await expect.poll(() => isDisabled(page.getByTestId('channel-choice-readme'))).toBe(true);
  await expect.poll(() => isChecked(page.getByTestId('channel-choice-linkedin')), { message: "the draw's channel, chosen" }).toBe(true);
  await expect(page.getByTestId('channel-locked')).toContainText(/LinkedIn post/);
  await optionCard(page, 'o3').click();
  await expect(page.getByTestId('draw-start')).toHaveText(/Add it to the draw/);
  const joined = await answerTo(page, 'POST', /^\/api\/runs\/[^/]+\/choices$/, () => page.getByTestId('draw-start').click());
  expect(joined.status).toBe(200);
  expect(joined.path).toBe(`/api/runs/${run.runId}/choices`);
  expect(joined.body).toEqual({ runId: run.runId, choices: [OPTION.o3.id] });
  expect(joined.sent.choices).toEqual([option('o3')]);
  await expect.poll(() => rowStates(page)).toContain(`${OPTION.o3.id}:done`);

  // Joins the draw cannot take: what it already holds, a second question of one's own, another commit's scan.
  for (const [choices, error] of [
    [[option('o3')], /option .o3. is already in this draw/],
    [[WHOLE], /whole system is already in this draw/],
    [[typed('Another question')], /already has a choice in your own words/],
  ] as const) {
    const refused = await p.post(`/api/runs/${run.runId}/choices`, { scan: joined.sent.scan, choices });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(error);
  }
  await project.commit({ 'delta.ts': '// delta\n' });
  const newer = await scan(p, { folder: project.dir });
  const otherScan = await p.post(`/api/runs/${run.runId}/choices`, { scan: newer.id, choices: [option('o1')] });
  expect(otherScan.status).toBe(409);
  expect(otherScan.body.error).toMatch(/started from another scan/);
  expect((await runRecord(p, run.runId)).choices.map((c: any) => c.id), 'a refused join changes nothing').toEqual(['system', SLOW_ID, OPTION.o3.id]);

  // One file holds them all, in the draw's order, drawn for the draw's channel.
  const record = await waitRun(p, run.runId, 'succeeded', 150_000);
  expect(record.choices.map((c: any) => `${c.id}:${c.status}`)).toEqual(['system:done', `${SLOW_ID}:done`, `${OPTION.o3.id}:done`]);
  const document = await readJSON(join(project.dir, 'docs', 'architecture.archdraw.json'));
  expect(document.choices.map((c: any) => c.id)).toEqual(['system', SLOW_ID, OPTION.o3.id]);
  expect(document.choices[2].channels.linkedin.views).toHaveLength(1);
  expect((await listDir(join(project.dir, 'docs'))).filter(n => n.endsWith('.json')), 'one file').toHaveLength(1);
  const late = await p.post(`/api/runs/${run.runId}/choices`, { scan: joined.sent.scan, choices: [option('o1')] });
  expect(late.status).toBe(409);
  expect(late.body.error).toMatch(/draw has ended/);
});
