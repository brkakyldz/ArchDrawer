import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  says, gitRepo, scanOnHome, tick, startedRun, watchStream, runRecord, activity, rowOf, readJSON, exists, OPTION, lines, type Ev,
} from './helpers';

const product = useProduct({ stepMs: 300 });
const TYPED = 'How a refund is approved', TYPED_ID = 'how-a-refund-is-approved';
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

// A user ticks four things to draw at once on a server with three engine slots: three start side by side, the fourth waits and says so,
// every row reports its stage, files and parts, and one file holds all four, each with its own facts checked against the code.
test('H10 [JOB-1 JOB-2 JOB-6 HOME-4 START-7 SCAN-3 READ-1 READ-2] four choices on three slots: three run side by side, the fourth waits and says so, and one file holds all four with facts the code supports @smoke', async ({ page }) => {
  const p = product();
  const project = await gitRepo('side-by-side');
  await scanOnHome(page, p, project.dir);
  await tick(page, { whole: true, options: ['o2', 'o1'], typed: TYPED }, 'linkedin');
  await expect(page.getByTestId('draw-start')).toHaveText(/Draw all 4/);
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  const stream = watchStream(p, `/api/runs/${run.runId}/events`);
  const ids = ['system', OPTION.o2.id, OPTION.o1.id, TYPED_ID];

  // The fourth waits for a free engine, on the screen and in the record.
  const fourth = rowOf(page, TYPED_ID);
  await expect(fourth).toHaveAttribute('data-state', 'waiting');
  await expect(fourth.getByTestId('draw-choice-line')).toHaveText(/Waiting for a free engine/);
  await expect(fourth.locator('[data-testid="draw-stage"][data-state="waiting"]')).toHaveCount(3);
  await expect(fourth.getByTestId('draw-choice-time')).toHaveText('');
  await expect(rowOf(page, 'system').getByTestId('draw-stage').nth(1)).toHaveText(/Drawing the map/);

  // Never more engines than slots, until the draw ends.
  let busiest = 0;
  await expect.poll(async () => {
    const now = await activity(p); busiest = Math.max(busiest, now.slots.busy);
    expect(now.slots.total).toBe(3);
    return (await runRecord(p, run.runId)).status;
  }, { timeout: 120_000, intervals: [100] }).toBe('succeeded');
  expect(busiest, 'at most three engine processes at a time').toBeLessThanOrEqual(3);
  await expect.poll(() => stream.events.some(e => e.event === 'done')).toBe(true);
  stream.stop();

  // The first events: each choice in request order, the three with a slot drawing, the fourth waiting.
  const firsts: Ev[] = stream.events.slice(0, 8);
  expect(firsts.map(e => e.event)).toEqual(['progress', 'choice', 'progress', 'choice', 'progress', 'choice', 'progress', 'choice']);
  expect(firsts[0].data.message).toMatch(/Drawing .The whole system.*1 of 4/);
  expect(firsts[2].data.message).toMatch(new RegExp(`Drawing .${OPTION.o2.title}.*2 of 4`));
  expect(firsts[4].data.message).toMatch(new RegExp(`Drawing .${OPTION.o1.title}.*3 of 4`));
  expect(firsts[6].data).toMatchObject({ choice: TYPED_ID, stage: null, source: 'server' });
  expect(firsts[6].data.message).toMatch(/Waiting for a free engine/);
  expect(firsts.filter(e => e.event === 'choice').map(e => `${e.data.id}:${e.data.status}`)).toEqual([...ids.slice(0, 3).map(i => `${i}:running`), `${TYPED_ID}:waiting`]);
  // Every progress line carries its time and who wrote it; the engine's lines are the engine's.
  for (const e of stream.events.filter(x => x.event === 'progress')) {
    expect(e.data.at, e.data.message).toMatch(ISO_MS);
    expect(['engine', 'server'], e.data.message).toContain(e.data.source);
    if (/^Reading the code$/.test(e.data.message)) expect(e.data.source, 'a fixture line is the engine\'s').toBe('engine');
  }
  expect(says(lines(stream.events, TYPED_ID), /4 of 4/)).toBe(true);

  // The record: each choice done, its files read and its parts found; the fourth started only once a slot was freed.
  const record = await runRecord(p, run.runId);
  expect(record.choices.map((c: any) => `${c.id}:${c.status}`)).toEqual(ids.map(i => `${i}:done`));
  for (const c of record.choices) {
    expect([c.filesRead, c.parts], c.id).toEqual([2, 8]);
    expect(c.startedAt, c.id).toMatch(ISO_MS); expect(c.lastEngineEventAt, c.id).toMatch(ISO_MS);
  }
  const firstEnd = Math.min(...record.choices.slice(0, 3).map((c: any) => Date.parse(c.endedAt)));
  expect(Date.parse(record.choices[3].startedAt)).toBeGreaterThanOrEqual(firstEnd);
  await expect(page.getByTestId('draw-ready')).toContainText(/4 drawings/);
  await expect(rowOf(page, OPTION.o2.id).getByTestId('draw-choice-line')).toHaveText(/Drawn.*8 parts/);

  // One file, the choices in request order, each with the facts the code supports and the evidence check's four warnings.
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  expect(await exists(file)).toBe(true);
  const document = await readJSON(file);
  expect(document.choices.map((c: any) => c.id)).toEqual(ids);
  for (const c of document.choices) {
    const facts = c.facts;
    expect(facts.components.map((f: any) => f.id).sort(), c.id).toEqual(['agent', 'app', 'model-call', 'store', 'tool-check', 'tool-proposal', 'tool-result', 'tool-run']);
    expect(facts.components.filter((f: any) => f.within === 'agent').map((f: any) => f.id).sort()).toEqual(['model-call', 'tool-check', 'tool-proposal', 'tool-result', 'tool-run']);
    for (const f of facts.components) {
      expect(f.evidence.length, `${c.id}/${f.id} has evidence`).toBeGreaterThan(0);
      for (const ev of f.evidence) expect(await exists(join(project.dir, ev.file)), `${f.id}: ${ev.file}`).toBe(true);
    }
    expect(facts.relations.some((r: any) => r.to === 'ghost' || r.from === 'ghost'), 'no relation to a dropped fact').toBe(false);
    expect(facts.limits.map((l: any) => `${l.id}:${l.on}`)).toEqual(['turn-limit:agent']);
    expect(c.channels.linkedin.views).toHaveLength(1);
    expect(c.channels.readme?.views ?? [], 'only the chosen channel is drawn').toHaveLength(0);
  }
  expect(says(document.warnings, /^The whole system: ghost: dropped the evidence fixture.ghost\.ts/)).toBe(true);
  expect(says(document.warnings, new RegExp(`^${TYPED}: Dropped .ghost.: no evidence`))).toBe(true);
  expect(document.warnings.filter((w: string) => w.startsWith(`${OPTION.o1.title}: `) && /ghost/.test(w))).toHaveLength(4);
});
