import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, workspaceRaw, register, startKind, finishRun, readDocument, viewOf } from './helpers';

const POST_LEDE = 'A request enters the app, is checked, and produces a result.';
const PLURAL = 'Fixing 2 problems in the answer';

// STORY-7 (ADR 0009): a post answer with two problems (a connection to `ghost`, a description over 240) gets ONE repair turn, and its
// progress line is the plural `Fixing 2 problems in the answer`. The engine's second answer fixes both and is saved as it is; a
// stubborn engine still has the connection to `ghost`, so the run fails and the file is untouched.
test('H155 [STORY-7, STORY-2, FILE-1] a post answer with two problems gets one repair turn announced as Fixing 2 problems in the answer, is saved without the connection and without shortening, and with a stubborn engine fails naming ghost with the file unchanged', async ({ request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('post-two-problems', withLinkedIn(shop3('Two problems shop')));
  const open = await register(request, file);
  const ask = (instruction: string) => startKind(request, open.token, { diagramId: open.id, kind: 'post', instruction, engine: 'fixture', model: null });
  const bytes = await readFile(file, 'utf8');
  const before = await readDocument(file);

  // The cooperative engine: one repair turn, the plural line between the two check lines, both problems gone, the engine's own words.
  const saved = await finishRun(request, await ask('Design the post [fixture:invalid][fixture:overlong]'), 'succeeded', 120_000);
  expect(saved).toMatchObject({ kind: 'post', status: 'succeeded', error: null, diagramId: open.id });
  const lines: string[] = saved.progress;
  const checks = lines.map((l, i) => l === 'Checking the post' ? i : -1).filter(i => i >= 0);
  expect(checks, 'checked before and after the one repair turn').toHaveLength(2);
  expect(lines.filter(l => l.startsWith('Fixing')), 'one repair turn, announced once, in the plural').toEqual([PLURAL]);
  expect(lines.some(l => /^Fixing 1 problem/.test(l)), 'not the singular').toBe(false);
  expect(lines.indexOf(PLURAL), 'right after its own check line').toBe(checks[0] + 1);
  expect(checks[1] - lines.indexOf(PLURAL), 'the repair turn shows its engine lines').toBeGreaterThan(1);
  expect(lines.at(-1)).toMatch(/^Saved/);
  expect(lines.some(l => /^Shortened/.test(l))).toBe(false);

  const stored = await readDocument(file);
  const view = viewOf(stored, 'linkedin')!;
  expect(view.caption.lede, 'the engine\'s repaired description').toBe(POST_LEDE);
  expect(view.caption.lede.endsWith('…')).toBe(false);
  expect(view.edges.filter(e => e.from === 'ghost' || e.to === 'ghost'), 'no connection to ghost').toEqual([]);
  expect(view.nodes.map(n => n.id).sort()).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect((stored.warnings ?? []).filter(w => /^Shortened|ghost/.test(w)), 'the repair turn added no warning for either problem').toEqual([]);
  expect(stored.facts).toEqual(before.facts);

  // The stubborn engine answers the same two problems again: one repair turn only (still plural), then the relation fails the run.
  const afterSaved = await readFile(file, 'utf8');
  const failed = await finishRun(request, await ask('Design the post [fixture:invalid][fixture:overlong][fixture:stubborn]'), 'failed', 120_000);
  expect(failed.error).toContain("The engine's LinkedIn post cannot be drawn:");
  expect(failed.error).toContain('ghost');
  expect(failed.progress.filter((l: string) => l.startsWith('Fixing')), 'one repair turn, never a second').toEqual([PLURAL]);
  expect(failed.progress.filter((l: string) => l === 'Checking the post')).toHaveLength(2);
  expect(failed.progress.some((l: string) => /^Saved/.test(l)), 'never saved').toBe(false);
  expect(failed.diagramId).toBeNull();
  expect(await readFile(file, 'utf8'), 'the file is as the first run left it').toBe(afterSaved);
  expect(afterSaved, 'and the first run did write').not.toBe(bytes);
});
