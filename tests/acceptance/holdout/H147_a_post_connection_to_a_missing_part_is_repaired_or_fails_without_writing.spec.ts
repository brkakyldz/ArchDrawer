import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, workspaceRaw, register, startKind, finishRun, readDocument, viewOf } from './helpers';

// STORY-7 (ADR 0009): a relation the answer violates (here the post's connection to `ghost`) is a problem for the repair turn, but
// code never repairs a relation: the engine's second answer saves, or the run fails naming the channel and the file stays as it was.
test('H147 [STORY-7, STORY-2, FILE-1] a post with a connection to ghost is saved without it after the repair turn, and with a stubborn engine the run fails naming the LinkedIn post and the connection, leaving the drawing file unchanged', async ({ request }) => {
  test.setTimeout(240_000);
  const { file } = await workspaceRaw('post-invalid', withLinkedIn(shop3('Invalid post shop')));
  const open = await register(request, file);
  const ask = (instruction: string) => startKind(request, open.token, { diagramId: open.id, kind: 'post', instruction, engine: 'fixture', model: null });

  // First: the stubborn engine. The run fails, naming the channel and the connection; nothing is written.
  const bytes = await readFile(file, 'utf8');
  const before = await readDocument(file);
  const failed = await finishRun(request, await ask('Design the post [fixture:invalid][fixture:stubborn]'), 'failed', 120_000);
  expect(failed.error).toContain("The engine's LinkedIn post cannot be drawn:");
  expect(failed.error).toContain('ghost');
  expect(failed.progress.filter((l: string) => l.startsWith('Fixing')), 'one repair turn was made').toHaveLength(1);
  expect(failed.progress.filter((l: string) => l === 'Checking the post')).toHaveLength(2);
  expect(failed.progress.some((l: string) => /^Saved/.test(l)), 'never saved').toBe(false);
  expect(failed.diagramId).toBeNull();
  expect(await readFile(file, 'utf8'), 'the drawing file is byte for byte as it was').toBe(bytes);
  expect(await readDocument(file)).toEqual(before);

  // Then the cooperative engine: the repair turn answers without the connection and the post is saved.
  const saved = await finishRun(request, await ask('Design the post [fixture:invalid]'), 'succeeded', 120_000);
  expect(saved.error).toBeNull(); expect(saved.diagramId).toBe(open.id);
  expect(saved.progress.filter((l: string) => l.startsWith('Fixing'))).toHaveLength(1);
  expect(saved.progress.filter((l: string) => l === 'Checking the post')).toHaveLength(2);
  expect(saved.progress.at(-1)).toMatch(/^Saved/);
  const stored = await readDocument(file);
  const view = viewOf(stored, 'linkedin')!;
  expect(view.edges.filter(e => e.from === 'ghost' || e.to === 'ghost'), 'no connection to ghost').toEqual([]);
  expect(view.nodes.some(n => n.id === 'ghost')).toBe(false);
  expect(view.nodes.map(n => n.id).sort()).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(view.caption.title).toBe('How a request becomes a result');
  expect(stored.facts).toEqual(before.facts);
  // Must not happen: the failed run's attempt showing in the saved file, or a Shortened warning for a length that was fine.
  expect((stored.warnings ?? []).filter(w => /^Shortened|ghost/.test(w))).toEqual([]);
});
