import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, workspaceRaw, register, readDocument, startKind, refusedRun, finishRun, viewOf, ownText, outdatedOf, channelNames, type Doc3 } from './helpers';

const nothingToUpdate = (doc: Doc3) => { for (const channel of channelNames) expect(outdatedOf(doc, channel), `${channel} has nothing to update`).toEqual([]); };

// Split from H105. Simplify is an appearance change of the overview and may never lose a fact: coverage is counted on the facts,
// the other channels are not touched, and only the overview is simplified.
test('H254 [AI-1, FILE-2, FILE-3, #182] simplify rearranges the overview without losing a fact or touching another channel, fails and writes nothing when it would lose one, and is refused on another channel', async ({ request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('runs-simplify', withLinkedIn(shop3('Simplify shop'), { visitorLabel: 'Visitor' }));
  const opened = await register(request, file);
  const before = await readDocument(file);

  // Simplify that would lose a fact fails and writes nothing: coverage is counted on the facts.
  const base = { diagramId: opened.id, kind: 'simplify', view: 'overview', engine: 'fixture', model: null };
  const bytes = await readFile(file, 'utf8');
  const lost = await finishRun(request, await startKind(request, opened.token, { ...base, instruction: '[fixture:lose]' }), 'failed');
  expect(lost.error).toMatch(/loses 1 component/); expect(lost.error).toContain('db'); expect(lost.error).toContain('Nothing was changed.');
  expect(await readFile(file, 'utf8')).toBe(bytes);

  // Simplify that keeps them: the overview's parts move into a detail view under one merged part; no fact changes.
  const simplified = await finishRun(request, await startKind(request, opened.token, base), 'succeeded');
  expect(simplified).toMatchObject({ kind: 'simplify', channel: 'overview', view: 'overview' });
  const afterSimplify = await readDocument(file);
  const views = afterSimplify.channels.overview.views!;
  expect(views.map(v => v.id)).toEqual(['overview', 'inside-the-system']);
  expect(views[0].nodes).toHaveLength(1); expect(views[0].edges).toHaveLength(0);
  const merged = views[0].nodes[0];
  expect(merged).toMatchObject({ id: 'system-map', facts: [], detail: 'inside-the-system', form: 'group' });
  expect(ownText(merged)).toMatchObject({ label: 'System map', kind: 'service', description: 'The whole system; open it for its parts.' });
  expect(views[1].nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);
  expect(views[1].nodes.map(n => n.facts).sort()).toEqual([['api'], ['db'], ['web']]); // every fact is still drawn, in the view the part opens
  expect(afterSimplify.facts).toEqual(before.facts); // the facts never change
  expect(viewOf(afterSimplify, 'linkedin')).toEqual(viewOf(before, 'linkedin')); // an appearance change of the overview only
  nothingToUpdate(afterSimplify);

  // Only the overview is simplified; nothing is written for the refusal.
  const stored = await readFile(file, 'utf8');
  const simplifyElsewhere = await refusedRun(request, opened.token, { diagramId: opened.id, kind: 'simplify', channel: 'linkedin', view: 'linkedin-post', engine: 'fixture', model: null });
  expect(simplifyElsewhere.status).toBe(400); expect(simplifyElsewhere.error).toContain('Only the overview is simplified');
  expect(await readFile(file, 'utf8')).toBe(stored);
});
