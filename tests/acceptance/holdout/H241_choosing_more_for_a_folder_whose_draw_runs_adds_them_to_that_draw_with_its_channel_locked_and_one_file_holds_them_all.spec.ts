import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { gitRepo, exists, startedRun } from './helpers';
import { SLUG, scanThroughHome, watchPosts, readChoices } from './helpers-selections';
import { homeServer, tickOnHome, rowFacts, jobsOnScreen, startedJoin, squash } from './helpers-home';
import { optionBox } from './helpers-selections';

const SLOW = 'Slow part [fixture:slow]';
const SLOW_ID = 'slow-part-fixture-slow';

// JOB-4, HOME-8, START-7 (ui contract, *Joining a running draw*; api contract, *Joining a running draw*): while a draw of a folder is running, choosing
// what to draw for the same folder (the same commit and options) shows the choices the draw holds as ticked, disabled and
// `In this draw`, the draw's channel chosen, disabled and explained, and the button as `Add … to the draw`; adding sends only the new
// choices to the running draw, the panel follows the draw with the new rows added, and one file holds every choice in the draw's order.
test('H241 [JOB-4 HOME-8 START-7 STORY-1 #200 #202] choosing more for a folder whose draw is running shows what the draw holds, locks its channel with a sentence, adds only the new choices to that draw and ends in one file with all of them', async ({ page, request }) => {
  test.setTimeout(300_000);
  const project = await gitRepo('home-join');
  const server = await homeServer(page, request, { stepMs: '400' });
  try {
    const posts = watchPosts(page);
    await scanThroughHome(page, project.dir, server.base);
    await tickOnHome(page, { whole: true, typed: SLOW }, 'readme');
    const draw = await startedRun(page, () => page.getByTestId('draw-start').click());
    await expect(page.getByTestId('draw-choice')).toHaveCount(2);

    // The panel is freed and the same folder is chosen again: its scan is the same commit's, so the choosing step joins the draw.
    await page.getByTestId('draw-another').click(); await expect(page.getByTestId('draw-progress')).toHaveCount(0);
    await page.getByTestId('start-folder').fill(project.dir); await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('focus-list')).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId('scan-cached')).toContainText('Scanned before at ');
    await expect(page.getByTestId('focus-in-draw')).toHaveCount(2); await expect(page.getByTestId('focus-in-draw').first()).toHaveText('In this draw');
    for (const id of ['focus-whole', 'focus-typed']) { await expect(page.getByTestId(id)).toBeChecked(); await expect(page.getByTestId(id)).toBeDisabled(); }
    for (const id of ['o1', 'o2', 'o3']) { await expect(optionBox(page, id)).not.toBeChecked(); await expect(optionBox(page, id)).toBeEnabled(); }
    await expect(page.getByTestId('channel-locked')).toHaveText('New choices join the draw that is running, so they take its README drawing.');
    await expect(page.getByTestId('channel-choice-readme')).toBeChecked();
    for (const id of ['linkedin', 'readme', 'presentation']) await expect(page.getByTestId(`channel-choice-${id}`)).toBeDisabled();
    await expect(page.getByTestId('channel-choice-linkedin')).not.toBeChecked(); await expect(page.getByTestId('draw-start')).toBeDisabled();

    // Add two: the button says so and needs no channel; only the new choices are sent, to the running draw, in the list's order.
    await optionBox(page, 'o3').click(); await expect(page.getByTestId('draw-start')).toHaveText('Add it to the draw'); await expect(page.getByTestId('draw-start')).toBeEnabled();
    await optionBox(page, 'o1').click(); await expect(page.getByTestId('draw-start')).toHaveText('Add all 2 to the draw');
    const joined = await startedJoin(page, () => page.getByTestId('draw-start').click());
    expect(joined.to).toBe(draw.runId); expect(joined.runId).toBe(draw.runId); expect(joined.choices).toEqual([SLUG.o3, SLUG.o1]);
    expect(joined.body.choices).toEqual([{ kind: 'option', option: 'o3' }, { kind: 'option', option: 'o1' }]); expect(typeof joined.body.scan).toBe('string');
    expect(joined.body).not.toHaveProperty('channel');
    expect(posts.filter(p => p.path === '/api/runs'), 'joining is not a second draw').toHaveLength(1);

    // The panel follows that draw: the new rows are added at the end and run beside the slow one.
    await expect(page.getByTestId('draw-progress')).toBeVisible(); await expect(page.getByTestId('draw-choice')).toHaveCount(4, { timeout: 30_000 });
    expect((await rowFacts(page)).map(r => r.choice)).toEqual(['system', SLOW_ID, SLUG.o3, SLUG.o1]);
    await expect.poll(async () => (await rowFacts(page)).map(r => r.state), { timeout: 60_000 }).toEqual(['done', 'running', 'done', 'done']);
    const jobs = await jobsOnScreen(page);
    expect(jobs.filter(j => j.type === 'draw'), 'one draw job, not two').toHaveLength(1); expect(jobs.find(j => j.id === draw.runId)).toMatchObject({ state: 'running', status: expect.stringMatching(/^README drawing · /) });

    // The slow choice ends: one Ready for the four, one file with all of them, the README drawn for each.
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 120_000 }); // the slow read is 30 lines two seconds apart
    expect(squash(await page.getByTestId('draw-ready').textContent())).toMatch(/^Ready.*4 drawings for a README$/);
    const doc = await readChoices(join(project.dir, 'docs', 'architecture.archdraw.json'));
    expect(doc.choices.map(c => c.id), 'the draw\'s order: its own choices, then the joined ones in the order they joined').toEqual(['system', SLOW_ID, SLUG.o3, SLUG.o1]);
    for (const c of doc.choices) { expect(c.channels.readme?.views, `${c.id}: README drawn`).toHaveLength(1); expect(c.channels.linkedin?.views ?? [], `${c.id}: LinkedIn not drawn`).toEqual([]); }
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1); await expect(page.getByTestId('editor')).toHaveCount(0);
  } finally { await server.close(); }
});
