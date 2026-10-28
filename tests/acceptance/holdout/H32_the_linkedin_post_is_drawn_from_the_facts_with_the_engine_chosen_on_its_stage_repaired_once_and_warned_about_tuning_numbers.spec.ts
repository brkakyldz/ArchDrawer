import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import {
  says, saying, gitRepo, scan, startDraw, waitRun, openDrawing, openAi, startedRun, turn, turnEnds, stored, viewOf, saved, readText, runEvents, lines, cli, outLines, isDisabled, WHOLE,
} from './helpers';

const product = useProduct();

// A user drew their project for a README and now wants the LinkedIn post. On the empty LinkedIn stage they choose the engine and model
// (the AI panel shows the same choice) and draw it from the facts alone; it is a phone-sized post with a title and one sentence. A post
// answer that runs too long is repaired once and saved in the engine's own words; one that stays broken fails and writes nothing. A
// number with a unit on a LinkedIn label is warned about, while the README may show it.
test('H32 [STORY-1 STORY-2 STORY-5 STORY-7 AI-2 START-5] the LinkedIn post is drawn from the facts with the engine chosen on its stage, a long answer is repaired once in the engine\'s words, a broken one writes nothing, and only LinkedIn warns about tuning numbers', async ({ page }) => {
  const p = product();
  const project = await gitRepo('linkedin-stage');
  const run = await waitRun(p, await startDraw(p, (await scan(p, { folder: project.dir })).id, [WHOLE], 'readme'));
  const id = await openDrawing(page, p, run.path, '?channel=linkedin');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('channel-empty')).toContainText(/not drawn yet/);
  await expect(page.getByTestId('share-button')).toBeDisabled();
  await expect.poll(() => isDisabled(page.getByTestId('tool-component'))).toBe(true);

  // The stage's engine and model are the AI panel's.
  await expect(page.getByTestId('stage-engine')).toHaveValue('fixture');
  await page.getByTestId('stage-model').selectOption('fixture-careful');
  await openAi(page);
  await expect(page.getByTestId('ai-model')).toHaveValue('fixture-careful');
  await expect(page.getByTestId('ai-send')).toBeDisabled();
  const drawn = await startedRun(page, () => page.getByTestId('channel-draw').click());
  expect(drawn.sent).toMatchObject({ readCode: false, model: 'fixture-careful', engine: 'fixture' });
  expect(['post', 'story']).toContain(drawn.sent.kind);
  // A post's channel may be left out ("absent means linkedin for post", api contract, *Runs*); a story names it.
  if (drawn.sent.kind === 'story' || drawn.sent.channel !== undefined) expect(drawn.sent.channel).toBe('linkedin');
  expect(await turnEnds(page, drawn.runId)).toBe('preview');
  await expect(turn(page, drawn.runId).getByTestId('ai-turn-text')).toHaveText(/Draw it/);
  await page.getByTestId('ai-accept').click();
  await expect(page.getByTestId('node-intake')).toBeVisible();
  await expect(page.getByTestId('linkedin-panel')).toBeVisible();
  await saved(page);
  const post = viewOf(await stored(p, id), 'linkedin');
  expect(post.caption.title.length).toBeGreaterThan(0);
  expect(post.caption.lede.length).toBeGreaterThan(0);
  for (const n of post.nodes) expect(n.held ?? [], `${n.id} holds no item`).toEqual([]);
  expect(post.edges.filter((e: any) => [e.from, e.to].sort().join() === 'approval,result'), 'one two-way connection').toHaveLength(1);
  const report = (await (await fetch(`${p.base}/api/runs/${drawn.runId}`)).json()).layoutReport;
  expect(report.targets).toEqual({ parts: 12, zones: { min: 0, max: 4 }, connections: 14 });

  // Too long, repaired once: saved in the engine's own words, with no shortening.
  const repaired = await p.post('/api/runs', { kind: 'post', diagramId: id, channel: 'linkedin', instruction: '[fixture:overlong]', engine: 'fixture', model: null });
  expect(repaired.status, repaired.text).toBe(202);
  const fixed = await waitRun(p, repaired.body.runId);
  const progress = lines(await runEvents(p, fixed.id));
  expect(saying(progress, /Fixing 1 problem/)).toBe(1);
  expect(saying(progress, /Checking the post/)).toBe(2);
  const after = await stored(p, id);
  expect(viewOf(after, 'linkedin').caption.lede).toBe(post.caption.lede);
  expect(says(after.warnings ?? [], /^Shortened/)).toBe(false);
  // Still broken after the repair turn: the run fails naming the problem, and the file is byte for byte as it was.
  const bytes = await readText(run.path);
  const broken = await p.post('/api/runs', { kind: 'post', diagramId: id, channel: 'linkedin', instruction: '[fixture:invalid] [fixture:stubborn]', engine: 'fixture', model: null });
  const failed = await waitRun(p, broken.body.runId, 'failed');
  expect(failed.error).toMatch(/LinkedIn post cannot be drawn: .*ghost/);
  expect(await readText(run.path)).toBe(bytes);

  // A tuning number: warned about on LinkedIn, allowed on the README.
  await page.reload();
  await page.getByTestId('node-intake').getByTestId('node-label').dblclick();
  // Units taken from the contract's own examples (diagram contract, *Warnings*, Tuning number: `6 turns`, `90 s`).
  await page.getByTestId('node-label-input').fill('Stops after 6 turns');
  await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  await page.getByTestId('channel-tab-readme').click();
  await page.getByTestId('node-store').getByTestId('node-label').dblclick();
  await page.getByTestId('node-label-input').fill('Store kept 90 s');
  await page.getByTestId('node-label-input').press('Enter');
  await saved(page);
  // Both texts are drawn labels in the file: the part's own label on LinkedIn, the part's own label on the README.
  const edited = await stored(p, id);
  const liNodes = viewOf(edited, 'linkedin').nodes as any[], rmNodes = viewOf(edited, 'readme').nodes as any[];
  const li = liNodes.findIndex(n => n.id === 'intake'), rm = rmNodes.findIndex(n => n.id === 'store');
  expect(liNodes[li].label).toBe('Stops after 6 turns');
  expect(rmNodes[rm].label).toBe('Store kept 90 s');
  const checked = await cli(p, ['validate', run.path]);
  expect(checked.code, checked.stderr).toBe(0);
  const warns = outLines(checked).filter(l => /^WARN\s/.test(l));
  // The warning is found by the place it names (a JSON path is an identifier), not by its wording.
  const liPath = `choices[0].channels.linkedin.views[0].nodes[${li}]`, rmPath = `choices[0].channels.readme.views[0].nodes[${rm}]`;
  expect(warns.filter(l => l.includes(liPath)).length, `a tuning-number warning at ${liPath}; got:\n${warns.join('\n')}`).toBeGreaterThanOrEqual(1);
  expect(warns.filter(l => l.includes(rmPath)), 'no tuning warning outside LinkedIn').toEqual([]);
  expect(outLines(checked).at(-1)).toMatch(/^valid with \d+ warning/);
});
