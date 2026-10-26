import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, withReadme, withPresentation, workspaceRaw, cli, register, startKind, finishRun, readDocument, warnLines, errorLines } from './helpers';
import { readFile } from 'node:fs/promises';

const allNull = (targets: unknown) => targets === null || targets === undefined || Object.values(targets as Record<string, unknown>).every(v => v === null || v === undefined);

// ADR 0007: one brief per channel replaces the shared rulebook. The numbers that tune a post (`90 s`, `3 retries`) are
// LinkedIn's warning alone, since elsewhere they may explain a guarantee; and only the LinkedIn view has count targets
// (about 12 parts, 0–4 zones, 14 connections) in its layout report.
test('H114 [STORY-2, STORY-5, STORY-6, LAYOUT-3] a tuning number is warned about on the LinkedIn view only, and the layout report carries count targets on LinkedIn, a parts target on the map and none on the other views', async ({ request }) => {
  const doc = withPresentation(withReadme(withLinkedIn(shop3('Tuning shop'))));
  doc.facts.components[0].sub = '90 s'; // drawn by `web` in the overview, the README and the presentation, and by `visitor` on LinkedIn
  const { file } = await workspaceRaw('tuning', doc);
  const bytes = await readFile(file, 'utf8');

  const checked = await cli(['validate', file]);
  expect(checked.code, checked.stdout + checked.stderr).toBe(0); expect(errorLines(checked)).toEqual([]);
  const tuning = warnLines(checked).filter(line => /tuning|90 s/i.test(line));
  expect(tuning.length, warnLines(checked).join('\n')).toBeGreaterThanOrEqual(1);
  // A violation's path starts at its choice (diagram contract, rule 1): the `@3` file is converted first, so it is `choices[0]`.
  for (const line of tuning) expect(line).toMatch(/^WARN\s+choices\[0\]\.channels\.linkedin\.views\[0\]/);
  // Must not happen: the same number warned about where it may explain a guarantee.
  for (const line of warnLines(checked)) expect(line, 'no other channel is told about its numbers').not.toMatch(/^WARN\s+choices\[0\]\.channels\.(overview|readme|presentation)\.views\[0\].*(tuning|90 s)/i);
  expect(await readFile(file, 'utf8')).toBe(bytes);

  // The layout report of a run: targets only on the LinkedIn view.
  const opened = await register(request, file);
  const report = async (channel: string, view: string) => {
    const runId = await startKind(request, opened.token, { diagramId: opened.id, channel, view, kind: 'refine', instruction: 'Observe the existing drawing',
      engine: 'fixture', model: null, scope: { kind: 'view' } });
    return (await finishRun(request, runId, 'succeeded', 90_000)).layoutReport;
  };
  const linkedin = await report('linkedin', 'linkedin-post');
  expect(linkedin).toMatchObject({ channel: 'linkedin', view: 'linkedin-post', counts: { parts: 3, connections: 2 } });
  expect(linkedin.targets).toEqual({ parts: 12, zones: { min: 0, max: 4 }, connections: 14 });
  for (const [channel, view] of [['overview', 'overview'], ['readme', 'readme'], ['presentation', 'presentation']] as const) {
    const other = await report(channel, view);
    expect(other, channel).toMatchObject({ channel, view, counts: { parts: 3, zones: 0, connections: 2 } }); // the counts are still reported
    // The converted file's one choice is `system`, so its first overview view is the map, which carries the one target `parts: 9`
    // (api contract, *Layout report*; ADR 0015); the README and the presentation have none.
    if (channel === 'overview') expect(other.targets, 'the map has a parts target only').toEqual({ parts: 9, zones: null, connections: null });
    else expect(allNull(other.targets), `${channel} has no count targets: ${JSON.stringify(other.targets)}`).toBe(true);
  }
  // The runs observed and changed nothing.
  const after = await readDocument(file);
  expect(after.facts.components[0].sub).toBe('90 s');
  for (const channel of ['overview', 'linkedin', 'readme', 'presentation'] as const)
    expect(after.channels[channel]!.views![0].nodes.map(n => [n.id, n.facts]), channel).toEqual(doc.channels[channel]!.views![0].nodes.map(n => [n.id, n.facts]));
});
