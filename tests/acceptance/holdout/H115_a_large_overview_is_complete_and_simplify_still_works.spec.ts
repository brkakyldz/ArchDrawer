import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, cli, readDocument, warnLines, errorLines, factOf, sorted } from './helpers';

const FIVE_KINDS = /flat|pipeline|held items|panel|tuning|main path|step|repeat/i;

// STORY-6: the overview is the complete map, with no zone or connection caps. A big overview is no longer warned about or
// offered a suggestion to cut; Simplify stays, as the user's own choice, and never loses a fact.
test('H115 [STORY-6, AI-1, FILE-3] a 24-part overview gets no size warning and no overview suggestion, shows no count targets, and Simplify the overview still folds it without losing a fact', async ({ page, request }) => {
  const doc = drawing('Large system'), view = doc.views[0];
  view.nodes = Array.from({ length: 24 }, (_, i) => component(`part-${i}`, { label: `Part ${i}`, place: { row: Math.floor(i / 6), col: i % 6 } }));
  view.edges = Array.from({ length: 23 }, (_, i) => ({ id: `flow-${i}`, from: `part-${i}`, to: `part-${i + 1}`, label: `Hop ${i}`, style: 'call', both: false, step: i + 1 }));
  const { file } = await workspace('large-overview', doc);

  // The command warns about the depth of a drawing, never about its size.
  const checked = await cli(['validate', file]);
  expect(checked.code, checked.stdout + checked.stderr).toBe(0); expect(errorLines(checked)).toEqual([]);
  for (const line of warnLines(checked)) expect(line, 'no warning is about how many zones or connections there are').toMatch(FIVE_KINDS);

  await openDrawing(page, request, file);
  await expect(page.getByTestId('node-part-23')).toBeVisible();
  await page.getByTestId('ai-button').click(); await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(page.getByTestId('overview-suggestion')).toHaveCount(0); // gone with the overview's count targets
  await expect(page.getByTestId('simplify-overview')).toBeVisible(); await expect(page.getByTestId('simplify-overview')).toBeEnabled();
  await page.getByTestId('ai-close').click();

  // Share reports what is drawn, with no target to miss: no `/ <target>` beside the counts, no line about a missed target.
  await page.getByTestId('share-button').click();
  const report = page.getByTestId('share-actions').getByTestId('layout-report');
  await expect(report).toHaveAttribute('data-parts', '24'); await expect(report).toHaveAttribute('data-connections', '23');
  const text = (await report.textContent()) ?? '';
  expect(text, text).toMatch(/24 parts/); expect(text).not.toMatch(/parts?\s*\/\s*\d+/); expect(text).not.toMatch(/connections?\s*\/\s*\d+/);
  for (const line of await page.getByTestId('layout-report-warning').allTextContents()) expect(line).not.toMatch(/target|zones?|connections/i);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);

  // Simplify is still there when the user asks: the overview folds into one group, every part in the detail view.
  const before = await readDocument(file);
  await page.getByTestId('ai-button').click();
  await page.getByTestId('simplify-overview').click();
  await expect(page.getByTestId('ai-input')).toHaveValue('Simplify the overview: keep every component in a detail view or a merged part');
  await expect(page.getByTestId('ai-summary')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('overview-suggestion')).toHaveCount(0);
  const after = await readDocument(file);
  const views = after.channels.overview.views!;
  expect(views.map(v => v.id)).toEqual(['overview', 'inside-the-system']);
  expect(views[0].nodes).toHaveLength(1); expect(views[0].nodes[0]).toMatchObject({ id: 'system-map', form: 'group', detail: 'inside-the-system', facts: [] });
  expect(sorted(views[1].nodes.map(n => n.id))).toEqual(sorted(view.nodes.map(n => n.id)));
  // Must not happen: a fact lost or changed by folding the map.
  expect(after.facts).toEqual(before.facts); expect(factOf(after, 'part-23')).toEqual(factOf(before, 'part-23'));
  expect(after.facts.components).toHaveLength(24);
  // The report of the finished run has the counts and no targets either.
  const finished = (await page.getByTestId('ai-panel').getByTestId('layout-report').textContent()) ?? '';
  expect(finished).not.toMatch(/parts?\s*\/\s*\d+/);
});
