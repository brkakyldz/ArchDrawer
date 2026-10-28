import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  gitRepo, scan, startDraw, waitRun, openDrawing, openAi, send, startedRun, turn, turnEnds, stored, viewOf, saved, listDir, WHOLE,
} from './helpers';

const product = useProduct();

// A user refines a drawing of their project with the AI panel: a content change goes to the facts and marks the LinkedIn channel as needing
// an update; the LinkedIn suggestion redraws that channel's story without touching the facts; on the overview a story-only instruction
// cannot add a part (it is ignored with a warning); and the second look moves one part, each ending in a preview.
test('H26 [AI-5 AI-4 AI-2 FILE-3 LAYOUT-4] a content change goes to the facts and marks the other channels, a suggestion redraws the channel\'s story, a story instruction cannot add a part, and the second look ends in a preview', async ({ page }) => {
  const p = product();
  const project = await gitRepo('routing');
  const run = await waitRun(p, await startDraw(p, (await scan(p, { folder: project.dir })).id, [WHOLE], 'linkedin'));
  const id = await openDrawing(page, p, run.path);
  await openAi(page);
  await expect(page.getByTestId('ai-suggest-simpler')).toBeVisible();
  await expect(page.getByTestId('ai-suggest-loop')).toBeVisible();
  await expect(page.getByTestId('ai-suggest-shorter')).toHaveCount(0);

  // The facts route: a new part in the facts; the LinkedIn channel, which did not take it up, needs an update.
  const added = await send(page, 'add Billing');
  expect(await turnEnds(page, added.runId)).toBe('preview');
  await expect(page.getByTestId('ai-route')).toHaveAttribute('data-route', 'facts');
  await page.getByTestId('ai-accept').click();
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('data-outdated', '1');
  await expect(page.getByTestId('channel-outdated-linkedin')).toBeVisible();
  await expect(page.getByTestId('channel-tab-overview'), 'the current channel is never marked').not.toHaveAttribute('data-outdated', /.+/);
  await saved(page);
  expect((await stored(p, id)).choices[0].channels.linkedin.outdated).toEqual(['billing']);

  // On LinkedIn the suggestion redraws the channel from the facts: the facts stay, the mark goes, the typed draft stays in the field.
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);
  await expect(page.getByTestId('ai-suggest-shorter')).toBeVisible();
  await expect(page.getByTestId('ai-suggest-simpler')).toHaveCount(0);
  await page.getByTestId('ai-input').fill('a draft I keep');
  const factsBefore = (await stored(p, id)).choices[0].facts;
  const shorter = await startedRun(page, () => page.getByTestId('ai-suggest-shorter').click());
  expect(shorter.sent).toMatchObject({ channel: 'linkedin', scope: { kind: 'view' } });
  expect(shorter.sent.instruction).toMatch(/^Make it shorter for LinkedIn/);
  expect(await turnEnds(page, shorter.runId)).toBe('preview');
  await expect(page.getByTestId('ai-route')).toHaveAttribute('data-route', 'story');
  await expect(turn(page, shorter.runId).getByTestId('ai-turn-text')).toHaveText(/Shorter for LinkedIn/);
  await expect(turn(page, shorter.runId).getByTestId('ai-turn-where')).toHaveText(/LinkedIn/);
  await expect(page.getByTestId('ai-input')).toHaveValue('a draft I keep');
  await page.getByTestId('ai-accept').click();
  await saved(page);
  const afterStory = await stored(p, id);
  expect(afterStory.choices[0].facts, 'the story route changes no fact').toEqual(factsBefore);
  expect(afterStory.choices[0].channels.linkedin.outdated).toEqual([]);
  await expect(page.getByTestId('channel-tab-linkedin')).not.toHaveAttribute('data-outdated', /.+/);

  // On the overview a story instruction may change appearance only. The fixture's `add` answers a new part and a new connection to it
  // (testing contract, *Refine*); each is ignored with one warning (api contract, *Routing*: "ignored with one warning each").
  await page.getByTestId('channel-tab-overview').click();
  await page.getByTestId('ai-input').fill('');
  const story = await send(page, '[fixture:story] add Ghost box');
  const ended = await turnEnds(page, story.runId);
  expect(['unchanged', 'preview']).toContain(ended);
  await expect(page.getByTestId('node-ghost-box')).toHaveCount(0);
  await expect(page.getByTestId('warnings')).toContainText(/2 warnings/);
  await expect(page.getByTestId('warnings')).toContainText(/Ghost box[\s\S]*Ghost box/);
  if (ended === 'preview') await page.getByTestId('ai-accept').click();
  expect((await stored(p, id)).choices[0].facts.components.some((f: any) => f.id === 'ghost-box')).toBe(false);

  // The second look: the view's image is sent, one part moves, and the result is a preview.
  const viewId = viewOf(await stored(p, id), 'overview').id;
  const look = await startedRun(page, () => page.getByTestId('ai-look-again').click());
  expect(look.sent).toMatchObject({ kind: 'revise', channel: 'overview', view: viewId });
  expect(String(look.sent.image)).toMatch(/^iVBORw0KGgo/);
  expect(await turnEnds(page, look.runId)).toBe('preview');
  await expect(turn(page, look.runId).getByTestId('ai-turn-text')).toHaveText(/Look at the drawing again/);
  await expect(page.getByTestId('ai-preview')).toContainText(/1 part moved/);
  await page.getByTestId('ai-accept').click();
  // Must not happen: the image the run looked at left behind.
  expect(await listDir(join(p.data, 'revise'))).toEqual([]);
});
