import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, register, startKind, finishRun, readDocument, viewOf } from './helpers';

const OVERLONG_START = 'Drawn by the test engine, with a description written far past the limit a story answer may hold.';

// STORY-7 (ADR 0009): when the repair turn answers the same over-long text, a length never fails the run: the text is cut to its
// limit and ends with `…`, with exactly one `Shortened …` warning, and there is never a second repair turn.
test('H146 [STORY-7, STORY-2, FILE-1] with a stubborn engine the over-long description is saved at 240 characters ending in an ellipsis with exactly one Shortened warning, after one repair turn only and the run not failed', async ({ request }) => {
  test.setTimeout(60_000);
  const SHORTENED = 'Shortened the description to 240 characters';

  const post = await workspaceRaw('story-stubborn-post', withLinkedIn(shop3('Stubborn shop')));
  const open = await register(request, post.file);
  const before = await readDocument(post.file);
  const run = await finishRun(request, await startKind(request, open.token, {
    diagramId: open.id, kind: 'post', instruction: 'Design the post [fixture:overlong][fixture:stubborn]', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(run).toMatchObject({ status: 'succeeded', error: null, diagramId: open.id });
  const lines: string[] = run.progress;
  expect(lines.filter(l => l.startsWith('Fixing')), 'one repair turn, never a second').toEqual(['Fixing 1 problem in the answer']);
  expect(lines.filter(l => l === 'Checking the post'), 'checked before and after the repair turn only').toHaveLength(2);
  expect(lines.at(-1)).toMatch(/^Saved with \d+ warnings?/);

  const stored = await readDocument(post.file);
  const lede = viewOf(stored, 'linkedin')!.caption.lede;
  expect(lede.length, 'cut to the file\'s limit').toBe(240);
  expect(lede.endsWith('…')).toBe(true);
  expect(lede.startsWith(OVERLONG_START), 'it is the engine\'s own text, cut').toBe(true);
  const shortened = (stored.warnings ?? []).filter(w => /^Shortened/.test(w));
  expect(shortened, 'exactly one Shortened warning').toEqual([SHORTENED]);
  // Nothing else of the post was cut.
  expect(viewOf(stored, 'linkedin')!.caption.title).toBe('How a request becomes a result');
  expect(viewOf(stored, 'linkedin')!.nodes.map(n => n.id).sort()).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(stored.facts).toEqual(before.facts);
  expect(stored.channels.overview).toEqual(before.channels.overview);

  // A README story has the same policy: 240 characters, `…`, one warning, a succeeded run.
  const readme = await workspaceRaw('story-stubborn-readme', shop3('Stubborn README shop'));
  const readmeOpen = await register(request, readme.file);
  const story = await finishRun(request, await startKind(request, readmeOpen.token, {
    diagramId: readmeOpen.id, kind: 'story', channel: 'readme', instruction: 'Draw it [fixture:overlong][fixture:stubborn]', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(story.status).toBe('succeeded'); expect(story.error).toBeNull();
  expect(story.progress.filter((l: string) => l.startsWith('Fixing'))).toEqual(['Fixing 1 problem in the answer']);
  const readmeDoc = await readDocument(readme.file);
  const readmeLede = viewOf(readmeDoc, 'readme')!.caption.lede;
  expect(readmeLede.length).toBe(240); expect(readmeLede.endsWith('…')).toBe(true); expect(readmeLede.startsWith(OVERLONG_START)).toBe(true);
  expect((readmeDoc.warnings ?? []).filter(w => /^Shortened/.test(w))).toEqual([SHORTENED]);
  // Must not happen: a second Shortened warning for the same text, or a cut in a text that was within its limit.
  expect(viewOf(readmeDoc, 'readme')!.caption.title).not.toContain('…');
});
