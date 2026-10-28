import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { drawingRepo, doc, choice, comp, rel, part, link, view, openDrawing, openAi, startedRun, turnEnds, stored, viewOf, saved, readText, waitRun } from './helpers';

const product = useProduct();

function busy() {
  const ids = ['gate', 'api', 'svc', 'job', 'db', 'cache', 'mail', 'logs'];
  const kinds = ['gate', 'api', 'service', 'worker', 'data', 'data', 'external', 'ops'];
  return doc('Busy shop', [choice('system', 'The whole system', 'system', {
    components: ids.map((id, i) => comp(id, `Part ${id}`, kinds[i])),
    relations: ids.slice(1).map((id, i) => rel(`r${i + 1}`, ids[i], id)),
  }, [view('overview', 'Overview', ids.map(id => part(id)), ids.slice(1).map((id, i) => link(ids[i], id, [`r${i + 1}`], i + 1)))])]);
}
const shownFacts = (d: any) => new Set(d.choices[0].channels.overview.views.flatMap((v: any) => v.nodes.flatMap((n: any) => n.facts)));

// A user finds the overview too busy and presses Simpler: the parts move into a view of their own behind one part on the overview, every
// fact still drawn, as a preview they accept (and could undo in one step). A simplification that would lose a part fails and changes
// nothing in the file.
test('H36 [AI-4 AI-3 FILE-2 NAV-2] Simpler moves the overview behind one part with every fact still drawn, as a preview, and a simplification that loses a part changes nothing', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('simpler', busy());
  const id = await openDrawing(page, p, file);
  const factsBefore = (await stored(p, id)).choices[0].facts;
  await openAi(page);
  const run = await startedRun(page, () => page.getByTestId('ai-suggest-simpler').click());
  expect(run.sent).toMatchObject({ kind: 'simplify', channel: 'overview', view: 'overview' });
  expect(run.sent.instruction).toMatch(/^Simplify the overview: keep every component in a detail view or a merged part/);
  expect(await turnEnds(page, run.runId)).toBe('preview');
  await page.getByTestId('ai-accept').click();
  await saved(page);

  const after = await stored(p, id);
  const overview = viewOf(after, 'overview');
  expect(overview.nodes.map((n: any) => n.id)).toEqual(['system-map']);
  expect(overview.nodes[0]).toMatchObject({ facts: [], detail: 'inside-the-system', label: 'System map' });
  expect(viewOf(after, 'overview', 'inside-the-system').nodes.map((n: any) => n.id).sort()).toEqual(['api', 'cache', 'db', 'gate', 'job', 'logs', 'mail', 'svc']);
  expect(after.choices[0].facts, 'no fact changes').toEqual(factsBefore);
  expect([...shownFacts(after)].sort(), 'every fact still drawn').toEqual(factsBefore.components.map((f: any) => f.id).sort());
  await expect(page.getByTestId('node-system-map')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('views-panel').getByTestId('views-entry-inside-the-system')).toHaveAttribute('data-depth', '1');
  // Undo is one step back to the busy overview.
  await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('node-gate')).toBeVisible();
  await expect(page.getByTestId('node-system-map')).toHaveCount(0);
  await saved(page);
  await page.getByTestId('tool-redo').click();
  await saved(page);

  // A simplification that would lose a part: refused, the file byte for byte as it was.
  const { file: other } = await drawingRepo('simpler-lose', busy());
  const otherId = (await p.post('/api/files', { path: other })).body.id as string;
  const bytes = await readText(other);
  const lose = await p.post('/api/runs', { kind: 'simplify', diagramId: otherId, view: 'overview', engine: 'fixture', model: null, instruction: 'Simplify the overview: keep every component in a detail view or a merged part [fixture:lose]' });
  expect(lose.status, lose.text).toBe(202);
  const failed = await waitRun(p, lose.body.runId, 'failed');
  expect(failed.error).toMatch(/loses 1 components?: logs\. Nothing was changed/);
  expect(await readText(other)).toBe(bytes);
  const wrongView = await p.post('/api/runs', { kind: 'simplify', diagramId: id, view: 'inside-the-system', engine: 'fixture', model: null });
  expect(wrongView.status).toBe(400);
  expect(wrongView.body.error).toMatch(/Only the overview is simplified/);
});
