import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo } from './helpers';
import { WHOLE, option, typed, SLUG } from './helpers-selections';
import { jobServer, scanOn, drawOn, awaitRun, states, viewsByChoice, readDoc, ms } from './helpers-jobs';

// JOB-2, START-7 (api contract, *The draw run*, *Ids*; the "Ids that depend on finish order" trap of AGENTS.md): choices drawn side by side take
// their view ids when the file is written, as if they had been drawn one after another in request order. Here the first choice finishes last
// (its read is slow), so the ids a finish-order scheme would give differ from the contracted ones; they are the ones of the same draw
// with nothing slow, and the file keeps request order.
test('H216 [JOB-2 START-7 #196] the ids in the written file are the same whichever choice finishes first: a draw whose first choice finishes last has the view ids of the same draw drawn in request order', async () => {
  test.setTimeout(300_000);
  const server = await jobServer({ slots: 3, stepMs: 150 });
  try {
    const slow = await gitRepo('ids-slow-first'), control = await gitRepo('ids-control');
    const SLOW = 'Slow first [fixture:slow]', SLOW_ID = 'slow-first-fixture-slow';
    const scanSlow = await scanOn(server, { folder: slow.dir }), scanControl = await scanOn(server, { folder: control.dir });

    // The slow draw: the first choice's read counts to 30 two seconds at a time; the other two finish long before it.
    const slowRun = await awaitRun(server, await drawOn(server, scanSlow.id, [typed(SLOW), WHOLE, option('o2')], 'readme'), 'succeeded', 240_000);
    expect(states(slowRun)).toEqual([`${SLOW_ID}:done`, 'system:done', `${SLUG.o2}:done`]);
    const ended = slowRun.choices.map((c: { endedAt: string }) => ms(c.endedAt));
    expect(ended[0], 'the first choice finished last').toBeGreaterThan(ended[1]);
    expect(ended[0], 'the first choice finished after the third too').toBeGreaterThan(ended[2]);

    // The control: the same choices with nothing slow, so they finish about in request order.
    const controlRun = await awaitRun(server, await drawOn(server, scanControl.id, [typed('Slow first'), WHOLE, option('o2')], 'readme'), 'succeeded', 120_000);
    expect(states(controlRun)).toEqual(['slow-first:done', 'system:done', `${SLUG.o2}:done`]);

    const slowDoc = await readDoc(join(slow.dir, 'docs', 'architecture.archdraw.json')), controlDoc = await readDoc(join(control.dir, 'docs', 'architecture.archdraw.json'));
    // The file keeps request order whichever finished first.
    expect(slowDoc.choices.map((c: { id: string }) => c.id)).toEqual([SLOW_ID, 'system', SLUG.o2]);
    expect(controlDoc.choices.map((c: { id: string }) => c.id)).toEqual(['slow-first', 'system', SLUG.o2]);
    // The ids are those of a draw drawn one after another: the first choice's views are named by their channel, the others' after their choice.
    expect(viewsByChoice(slowDoc)).toEqual({
      [SLOW_ID]: ['overview:overview', 'readme:readme'],
      system: ['overview:system-overview', 'overview:zone-runtime-inside', 'readme:system-readme'],
      [SLUG.o2]: [`overview:${SLUG.o2}-overview`, `readme:${SLUG.o2}-readme`],
    });
    expect(viewsByChoice(controlDoc)).toEqual({
      'slow-first': ['overview:overview', 'readme:readme'],
      system: ['overview:system-overview', 'overview:zone-runtime-inside', 'readme:system-readme'],
      [SLUG.o2]: [`overview:${SLUG.o2}-overview`, `readme:${SLUG.o2}-readme`],
    });
    // Same questions, same answers: each choice's facts are those of the control's.
    slowDoc.choices.forEach((c: { facts: unknown }, i: number) => expect(c.facts, `choice ${i + 1}`).toEqual(controlDoc.choices[i].facts));
    // Must not happen: a view id claimed twice.
    const every = Object.values(viewsByChoice(slowDoc)).flat().map(v => v.split(':')[1]);
    expect(new Set(every).size).toBe(every.length);
  } finally { await server.stop(); }
});
