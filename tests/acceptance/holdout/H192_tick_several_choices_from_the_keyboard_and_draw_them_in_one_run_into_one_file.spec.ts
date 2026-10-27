import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, workspaceRaw, shop3, isolatedDrawing, startedRun, tabTo, exists } from './helpers';
import {
  OPTIONS, SLUG, FOUR_WARNINGS, scanThroughHome, optionBox, focusedChoice, watchPosts, drawRows, panelStructure, panelEntries,
  readChoices, where, missingFacts, viewIdsOf, type Doc4,
} from './helpers-selections';
import { recordRowFacts, recordedFacts, maxRunning } from './helpers-home';

const TYPED = 'How a booking is paid';
const TYPED_ID = 'how-a-booking-is-paid';

// SCAN-3, STORY-1, START-7 at the home screen (ADR 0015): the user ticks the whole system, a section, a flow and their own words
// from the keyboard, chooses one channel, and one `Draw all 4` draws every choice: a row per choice with its three stages, then `Ready`
// and, from `Open`, the editor on the first choice, the views panel listing all four and one file holding them. From ADR 0016 the choices
// run side by side in the shared slots (three by default: the fourth waits for one), the choosing step is gone while the draw is
// followed, and the editor opens only from `Open`.
test('H192 [SCAN-3 STORY-1 START-7 NAV-2 JOB-1 JOB-2 JOB-8 HOME-4 HOME-6 #181 #182 #200 #202] tick the whole system, a section, a flow and your own words from the keyboard, choose the LinkedIn post, draw all four in one run side by side in three slots, and open from Ready the first choice of one file that holds them all', async ({ page, request }) => {
  test.setTimeout(420_000);
  const project = await gitRepo('home-several');
  const other = await workspaceRaw('home-several-lib', shop3('Home shop'));
  const server = await isolatedDrawing(page, request, other.file, '300'); // slow enough to watch the rows change
  try {
    const posts = watchPosts(page);
    await scanThroughHome(page, project.dir, server.base);

    // The keyboard path through the list: the whole system, the sections, the flows, then something else; Space ticks.
    await tabTo(page, 'focus-whole');
    expect(await focusedChoice(page)).toBe('focus-whole');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('focus-whole')).toBeChecked(); await expect(page.getByTestId('focus-count')).toHaveText('1 chosen');
    await expect(page.getByTestId('draw-start')).toContainText('Draw it'); await expect(page.getByTestId('draw-start')).toBeDisabled(); // no channel yet
    for (const c of ['linkedin', 'readme', 'presentation']) { await expect(page.getByTestId(`channel-choice-${c}`)).toBeVisible(); await expect(page.getByTestId(`channel-choice-${c}`)).not.toBeChecked(); }
    const walked: (string | null)[] = [];
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page)); await page.keyboard.press('Space'); // the first section
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page)); // the second section: passed over
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page)); await page.keyboard.press('Space'); // the flow
    await page.keyboard.press('Tab'); walked.push(await focusedChoice(page));
    expect(walked, 'sections in option order, then flows, then something else').toEqual(['focus-option:o2', 'focus-option:o3', 'focus-option:o1', 'focus-typed']);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('focus-typed')).toBeChecked(); await expect(page.getByTestId('focus-text')).toBeFocused();
    await page.keyboard.type(TYPED);
    await expect(optionBox(page, 'o2')).toBeChecked(); await expect(optionBox(page, 'o1')).toBeChecked(); await expect(optionBox(page, 'o3')).not.toBeChecked();
    await expect(page.getByTestId('focus-count')).toHaveText('4 chosen');
    await expect(page.getByTestId('draw-start')).toContainText('Draw all 4');
    // The next stop is the channel; none is chosen until Space chooses it, and then Draw all is on.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? '')).toMatch(/^channel-choice-/);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('channel-choice-linkedin')).toBeChecked(); await expect(page.getByTestId('draw-start')).toBeEnabled();
    for (let i = 0; i < 8 && (await focusedChoice(page)) !== 'draw-start'; i++) await page.keyboard.press('Tab');
    expect(await focusedChoice(page)).toBe('draw-start');
    expect(posts.filter(p => p.path === '/api/runs'), 'nothing is drawn before the user asks').toEqual([]);

    // Draw all: one run whose choices are in the order of the list, not of the ticking, and carry no `focus`.
    await recordRowFacts(page);
    const run = await startedRun(page, () => page.keyboard.press('Enter'));
    expect(run.body).not.toHaveProperty('focus');
    expect(run.body).toMatchObject({ kind: 'draw', channel: 'linkedin' });
    expect(run.body.choices).toEqual([{ kind: 'whole' }, { kind: 'option', option: 'o2' }, { kind: 'option', option: 'o1' }, { kind: 'typed', text: TYPED }]);
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);

    // The rows: one per choice in the order drawn, three stages each; the panel follows the draw and the choosing step is gone.
    await expect(page.getByTestId('draw-progress')).toBeVisible();
    await expect(page.getByTestId('draw-choice')).toHaveCount(4);
    const rows = await drawRows(page);
    expect(rows.map(r => [r.choice, r.kind, r.title])).toEqual([
      ['system', 'system', 'The whole system'], [SLUG.o2, 'section', OPTIONS.o2.title], [SLUG.o1, 'flow', OPTIONS.o1.title], [TYPED_ID, 'custom', TYPED]]);
    for (const r of rows) expect(r.stages.map(s => s.stage), r.choice!).toEqual(['read', 'overview', 'channel']);
    expect(rows[0].stages.map(s => s.text)).toEqual([expect.stringContaining('Reading the code'), expect.stringContaining('Drawing the map'), expect.stringContaining('Drawing the LinkedIn post')]);
    for (const r of rows.slice(1)) expect(r.stages.map(s => s.text)).toEqual([expect.stringContaining('Reading the code'), expect.stringContaining('Drawing the overview'), expect.stringContaining('Drawing the LinkedIn post')]);
    await expect(page.getByTestId('draw-line')).toBeVisible(); await expect(page.getByTestId('draw-cancel')).toBeVisible();
    await expect(page.getByTestId('start-folder')).toBeDisabled(); await expect(page.getByTestId('focus-list')).toHaveCount(0); await expect(page.getByTestId('draw-start')).toHaveCount(0);
    await expect(page.getByTestId('channel-choice-readme')).toHaveCount(0);
    await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 300_000 });
    expect((await page.getByTestId('draw-ready').textContent())!.replace(/\s+/g, ' ')).toMatch(/^Ready.*4 drawings for a LinkedIn post/);
    await page.waitForTimeout(1000); await expect(page.getByTestId('editor'), 'the editor opens only from Open').toHaveCount(0);

    // The rows went side by side in three slots: three choices at once, the fourth waiting for one, each stage after the one before it.
    const seen = await recordedFacts(page);
    expect(seen.length).toBeGreaterThan(3);
    expect(maxRunning(seen), 'three slots by default: three choices at once, never more').toBe(3);
    expect(seen.some(rows => rows.length === 4 && rows.slice(0, 3).every(r => r.state === 'running') && rows[3].state === 'waiting' && rows[3].line === 'Waiting for a free engine'), 'the fourth choice waited for a free engine').toBe(true);
    expect(seen.some(rows => rows[3]?.state === 'running' && rows.slice(0, 3).some(r => r.state === 'done')), 'and started when one of the others was done').toBe(true);
    for (let k = 0; k < 4; k++) expect(seen.some(rows => rows[k]?.state === 'running'), `choice ${k + 1} was seen running`).toBe(true);
    for (const snapshot of seen) for (const r of snapshot) {
      const rank = (s: string) => s === 'done' ? 2 : s === 'running' || s === 'failed' ? 1 : 0;
      r.stages.forEach((s, j) => { if (rank(s) >= 1) for (let i = 0; i < j; i++) expect(r.stages[i], `${r.choice}: stage ${j + 1} only after stage ${i + 1} is done`).toBe('done'); });
    }

    // Open: the editor on the first choice at the chosen channel; the views panel lists all four, in its own order.
    await page.getByTestId('draw-open').click(); await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', 'system'); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
    await expect(page).toHaveURL(/\/d\/[^/?]+\?choice=system&channel=linkedin/);
    await expect(page.getByTestId('repo-name')).toHaveText(basename(project.dir));
    await expect(page.getByTestId('node-intake')).toBeVisible();
    await expect(page.getByTestId('views-panel')).toBeVisible();
    expect(await panelStructure(page)).toEqual(['choice:system', 'entry:overview', 'entry:zone-runtime-inside',
      'heading:section', `choice:${SLUG.o2}`, `entry:${SLUG.o2}-overview`, 'heading:flow', `choice:${SLUG.o1}`, `entry:${SLUG.o1}-overview`,
      'heading:custom', `choice:${TYPED_ID}`, `entry:${TYPED_ID}-overview`]);
    const entries = await panelEntries(page);
    expect(entries.find(e => e.view === 'overview')).toMatchObject({ text: 'The whole system', depth: 0, choice: 'system' });
    expect(entries.find(e => e.view === 'zone-runtime-inside')).toMatchObject({ text: 'Agent runtime', depth: 1, choice: 'system' });
    expect(entries.find(e => e.view === `${TYPED_ID}-overview`)!.text).toBe(TYPED);

    // One file holds the four choices in the order asked, each with its overview and the LinkedIn post, and no other channel.
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    const doc: Doc4 = await readChoices(file);
    expect(doc.title).toBe(basename(project.dir));
    expect(doc.choices.map(c => [c.id, c.kind, c.title, c.about])).toEqual([
      ['system', 'system', 'The whole system', ''], [SLUG.o2, 'section', OPTIONS.o2.title, OPTIONS.o2.sentence],
      [SLUG.o1, 'flow', OPTIONS.o1.title, OPTIONS.o1.sentence], [TYPED_ID, 'custom', TYPED, TYPED]]);
    for (const c of doc.choices) {
      expect(c.channels.linkedin?.views, `${c.id}: the LinkedIn post is drawn`).toHaveLength(1);
      expect(c.channels.readme?.views ?? [], `${c.id}: README not drawn`).toEqual([]); expect(c.channels.presentation?.views ?? [], `${c.id}: presentation not drawn`).toEqual([]);
      expect(missingFacts(c), `${c.id}: every fact is shown or held somewhere in its overview`).toEqual([]);
      expect(c.facts.components.map(f => f.id), `${c.id} has its own read`).toEqual(expect.arrayContaining(['app', 'agent', 'store']));
    }
    expect([...viewIdsOf(doc.choices[0])].sort()).toEqual(['overview', 'zone-runtime-inside']); expect(doc.choices[0].channels.overview.views![0].id, 'the map first').toBe('overview');
    expect(doc.choices[0].channels.linkedin!.views![0].id).toBe('linkedin');
    for (const c of doc.choices.slice(1)) { expect(viewIdsOf(c)).toEqual([`${c.id}-overview`]); expect(c.channels.linkedin!.views![0].id).toBe(`${c.id}-linkedin`); }
    // A run of several choices prefixes every warning with its choice's title; each choice has the fixture's four evidence warnings first.
    const warnings = doc.warnings ?? [];
    const starts = doc.choices.map(c => warnings.findIndex(w => w.startsWith(`${c.title}: `)));
    expect(starts.every(i => i >= 0) && starts.every((i, k) => k === 0 || i > starts[k - 1]), `warnings are choice by choice: ${starts}`).toBe(true);
    for (const c of doc.choices) expect(warnings.filter(w => w.startsWith(`${c.title}: `)).slice(0, 4), c.id).toEqual(FOUR_WARNINGS.map(w => `${c.title}: ${w}`));
    expect(warnings.every(w => doc.choices.some(c => w.startsWith(`${c.title}: `)))).toBe(true);

    // The channel was drawn for every choice: another choice has its own LinkedIn post, reached through the panel and its tab.
    await page.getByTestId(`views-entry-${SLUG.o2}-overview`).click();
    expect(await where(page)).toEqual({ choice: SLUG.o2, channel: 'overview', view: `${SLUG.o2}-overview` });
    await page.getByTestId('channel-tab-linkedin').click();
    expect(await where(page)).toEqual({ choice: SLUG.o2, channel: 'linkedin', view: `${SLUG.o2}-linkedin` });
    await expect(page.getByTestId('node-intake')).toBeVisible(); await expect(page.getByTestId('channel-empty')).toHaveCount(0);

    // Must not happen: a second run, a second file, or anything in the project but the one new folder.
    expect(posts.filter(p => p.path === '/api/runs')).toHaveLength(1);
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
    expect((await project.git(['status', '--porcelain'])).trim()).toBe('?? docs/');
  } finally { await server.close(); }
});
