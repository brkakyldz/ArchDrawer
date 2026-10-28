import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { gitRepo, scan, startDraw, waitRun, openDrawing, openAi, send, startedRun, turnEnds, stored, viewOf, saved, choiceOf, option, OPTION } from './helpers';

const product = useProduct();

// A user who drew a section for LinkedIn adds the README drawing from the same facts: a detailed drawing whose agent holds its loop and
// its turn limit. They add a part in the overview; the README now needs an update, and Redraw it brings the new part in, after a preview,
// with the mark gone.
test('H33 [STORY-1 STORY-3 STORY-5 FILE-3 AI-3] the README is drawn from the facts with the agent holding its mechanisms and limit, and a content change marks it until Redraw it brings the change in', async ({ page }) => {
  const p = product();
  const project = await gitRepo('readme-stage');
  const run = await waitRun(p, await startDraw(p, (await scan(p, { folder: project.dir })).id, [option('o3')], 'linkedin'));
  const id = await openDrawing(page, p, run.path, '?channel=readme');
  const choiceId = OPTION.o3.id;
  await expect(page.getByTestId('channel-empty')).toContainText(/README drawing is not drawn yet/);

  const drawn = await startedRun(page, () => page.getByTestId('channel-draw').click());
  expect(drawn.sent).toMatchObject({ kind: 'story', channel: 'readme', readCode: false, choice: choiceId });
  expect(await turnEnds(page, drawn.runId)).toBe('preview');
  await page.getByTestId('ai-accept').click();
  await saved(page);
  const readme = viewOf(await stored(p, id), 'readme', undefined, choiceId);
  // The section is the file's only, so first, choice: its new view is named by the channel (diagram contract, *The view*).
  expect(readme.id).toBe('readme');
  expect(readme.nodes.map((n: any) => n.id).sort()).toEqual(['agent', 'app', 'store']);
  // The agent holds its loop and its limit; the callout lists them, the canvas draws none of them.
  expect(readme.nodes.find((n: any) => n.id === 'agent')).toMatchObject({ form: 'panel', limits: ['turn-limit'] });
  await page.getByTestId('node-agent').getByTestId('node-label').click();
  await expect(page.getByTestId('callout-agent').locator('[data-testid="callout-item"][data-row="held"]')).toHaveCount(5);
  await expect(page.getByTestId('callout-agent').locator('[data-testid="callout-item"][data-row="limit"]')).toContainText([/12 turns/]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-sublines'), 'sub-lines on by default').toHaveAttribute('aria-pressed', 'true');

  // A part added in the overview: README and LinkedIn need an update.
  await page.getByTestId('channel-tab-overview').click();
  await openAi(page);
  const added = await send(page, 'add Billing');
  expect(await turnEnds(page, added.runId)).toBe('preview');
  await page.getByTestId('ai-accept').click();
  await expect(page.getByTestId('channel-tab-readme')).toHaveAttribute('data-outdated', '1');
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('data-outdated', '1');

  // Redraw it: a preview from the facts, then the README holds the new part and the mark is gone; LinkedIn keeps its own mark.
  await page.getByTestId('channel-tab-readme').click();
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);
  const redraw = await startedRun(page, () => page.getByTestId('channel-redraw').click());
  expect(redraw.sent).toMatchObject({ kind: 'story', channel: 'readme', readCode: false });
  expect(await turnEnds(page, redraw.runId)).toBe('preview');
  await page.getByTestId('ai-accept').click();
  await saved(page);
  await expect(page.getByTestId('channel-tab-readme')).not.toHaveAttribute('data-outdated', /.+/);
  await expect(page.getByTestId('node-billing')).toBeVisible();
  const after = choiceOf(await stored(p, id), choiceId);
  expect(after.channels.readme.outdated).toEqual([]);
  expect(after.channels.readme.views[0].id, 'the view keeps its id').toBe('readme');
  expect(after.channels.linkedin.outdated, 'another channel keeps its mark').toEqual(['billing']);
});
