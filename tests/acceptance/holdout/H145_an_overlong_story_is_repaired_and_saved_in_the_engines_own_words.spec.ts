import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, register, startKind, finishRun, readDocument, viewOf } from './helpers';

const POST_LEDE = 'A request enters the app, is checked, and produces a result.';
const README_LEDE = 'A detailed drawing made by the test engine.';
const OVERLONG_START = 'Drawn by the test engine, with a description written far past the limit a story answer may hold.';

// STORY-7 (ADR 0009): a story answer over a hard limit gets one repair turn and the engine's second answer is saved as it is: no
// code shortening, no warning for the length. The progress puts `Fixing 1 problem in the answer` between the two check lines.
test('H145 [STORY-7, STORY-2, STORY-3] a post and a README story whose first answer has an over-long description are repaired by the engine: saved with its own shorter text, the Fixing line between the two check lines, no shortening and no warning', async ({ request }) => {
  test.setTimeout(60_000);

  // A post over an existing LinkedIn channel.
  const post = await workspaceRaw('story-overlong-post', withLinkedIn(shop3('Overlong shop')));
  const postOpen = await register(request, post.file);
  const before = await readDocument(post.file);
  const postRun = await finishRun(request, await startKind(request, postOpen.token, {
    diagramId: postOpen.id, kind: 'post', instruction: 'Design the post [fixture:overlong]', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(postRun).toMatchObject({ kind: 'post', status: 'succeeded', error: null, diagramId: postOpen.id });

  const lines: string[] = postRun.progress;
  const checks = lines.map((l, i) => l === 'Checking the post' ? i : -1).filter(i => i >= 0);
  expect(checks, 'the check line is shown once before and once after the repair turn').toHaveLength(2);
  const fixing = lines.filter(l => l.startsWith('Fixing'));
  expect(fixing, 'one repair turn, for the one over-long text').toEqual(['Fixing 1 problem in the answer']);
  const fixingAt = lines.indexOf('Fixing 1 problem in the answer');
  expect(fixingAt, 'right after its own check line').toBe(checks[0] + 1);
  expect(fixingAt).toBeLessThan(checks[1]);
  expect(checks[1] - fixingAt, 'the repair turn shows its engine lines').toBeGreaterThan(1);
  // The repair turn adds no warning: the only one is the fixture's two-way connection.
  expect(lines.at(-1)).toMatch(/^Saved with 1 warning/);
  expect(lines.some(l => /^Shortened/.test(l))).toBe(false);

  const stored = await readDocument(post.file);
  const view = viewOf(stored, 'linkedin')!;
  expect(view.caption.lede, 'the engine\'s repaired text, not the over-long one').toBe(POST_LEDE);
  expect(view.caption.lede.length).toBeLessThan(240);
  expect(view.caption.lede.endsWith('…')).toBe(false);
  expect(view.caption.lede).not.toContain('far past the limit');
  expect((stored.warnings ?? []).filter(w => /^Shortened/.test(w)), 'no warning for the length').toEqual([]);
  expect(stored.facts).toEqual(before.facts);

  // A README story over a drawing with no README yet: the same repair, the same result.
  const readme = await workspaceRaw('story-overlong-readme', shop3('Overlong README shop'));
  const readmeOpen = await register(request, readme.file);
  const storyRun = await finishRun(request, await startKind(request, readmeOpen.token, {
    diagramId: readmeOpen.id, kind: 'story', channel: 'readme', instruction: 'Draw the README [fixture:overlong]', engine: 'fixture', model: null }), 'succeeded', 120_000);
  const storyLines: string[] = storyRun.progress;
  const storyChecks = storyLines.map((l, i) => l === 'Checking the post' ? i : -1).filter(i => i >= 0);
  expect(storyChecks).toHaveLength(2);
  expect(storyLines.filter(l => l.startsWith('Fixing'))).toEqual(['Fixing 1 problem in the answer']);
  expect(storyLines.indexOf('Fixing 1 problem in the answer')).toBe(storyChecks[0] + 1);
  expect(storyLines.some(l => /^Shortened/.test(l))).toBe(false);
  const readmeDoc = await readDocument(readme.file);
  const readmeView = viewOf(readmeDoc, 'readme')!;
  expect(readmeView.caption.lede).toBe(README_LEDE);
  expect(readmeView.caption.lede.startsWith(OVERLONG_START)).toBe(false);
  expect((readmeDoc.warnings ?? []).filter(w => /^Shortened/.test(w))).toEqual([]);
});
