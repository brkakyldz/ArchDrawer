import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, startKind, refusedRun, finishRun, factOf, partOf, viewOf, ownText, outdatedOf, channelNames, type Doc3 } from './helpers';

const empty = { added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] };
const nothingToUpdate = (doc: Doc3) => { for (const channel of channelNames) expect(outdatedOf(doc, channel), `${channel} has nothing to update`).toEqual([]); };

// A run names its channel and view. In the LinkedIn channel a rename is that channel's own name, a removal only leaves a part
// out, and the scope still limits what may change. Simplify is an appearance change of the overview and may never lose a fact.
test('H105 [AI-1, FILE-3, FILE-2] a refine on the LinkedIn channel with a scope changes only that channel, and simplify rearranges the overview without losing a fact or running on another channel', async ({ page, request }) => {
  const { file } = await workspaceRaw('runs-channel', withLinkedIn(shop3('Scope shop'), { visitorLabel: 'Visitor' }));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  const linkedin = { diagramId: opened.id, channel: 'linkedin', view: 'linkedin-post', kind: 'refine', engine: 'fixture', model: null };
  const refine = async (instruction: string, scope: Record<string, unknown>) => await finishRun(request, await startKind(request, opened.token, { ...linkedin, instruction, scope }), 'succeeded');

  // A part named by the scope is renamed: in the LinkedIn channel that is the part's own name, the fact is not corrected.
  const renamed = await refine('rename Visitor to Shopper', { kind: 'parts', ids: ['visitor'] });
  expect(renamed).toMatchObject({ kind: 'refine', channel: 'linkedin', view: 'linkedin-post' });
  expect(renamed.changes).toEqual({ ...empty, changed: ['visitor'] });
  const afterRename = await readDocument(file);
  expect(partOf(afterRename, 'linkedin', 'visitor')?.label).toBe('Shopper');
  expect(factOf(afterRename, 'web')!.label).toBe('Web app'); expect(afterRename.facts).toEqual(before.facts);
  expect(afterRename.channels.overview).toEqual(before.channels.overview); nothingToUpdate(afterRename);

  // A part outside the scope is not touched: the run succeeds, changes nothing, and says so once.
  const warned = (afterRename.warnings ?? []).length;
  const ignored = await refine('rename Orders ledger to Vault', { kind: 'parts', ids: ['visitor'] });
  expect(ignored.changes).toEqual(empty);
  const afterIgnored = await readDocument(file);
  expect(partOf(afterIgnored, 'linkedin', 'ledger')?.label).toBe('Orders ledger');
  expect((afterIgnored.warnings ?? []).length - warned).toBe(1); expect(afterIgnored.warnings!.at(-1)).toMatch(/scope|outside|ignored/i);
  expect(viewOf(afterIgnored, 'linkedin')).toEqual(viewOf(afterRename, 'linkedin'));

  // A removal in the LinkedIn channel leaves the part out of that channel: its fact, relation and overview part stay.
  const removed = await refine('remove Orders ledger', { kind: 'view' });
  expect(removed.changes).toEqual({ ...empty, removed: ['ledger'], edgesRemoved: ['intake-ledger'] });
  const afterRemove = await readDocument(file);
  expect(viewOf(afterRemove, 'linkedin')!.nodes.map(n => n.id)).toEqual(['visitor', 'intake']);
  expect(factOf(afterRemove, 'db')).toBeTruthy(); expect(afterRemove.facts).toEqual(before.facts);
  expect(partOf(afterRemove, 'overview', 'db')).toBeTruthy(); expect(afterRemove.channels.overview).toEqual(before.channels.overview);
  nothingToUpdate(afterRemove);

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
  expect(viewOf(afterSimplify, 'linkedin')).toEqual(viewOf(afterRemove, 'linkedin')); // an appearance change of the overview only
  nothingToUpdate(afterSimplify);

  // The channel a run names must exist, hold a drawing and (for simplify) be the overview; nothing is written for a refusal.
  const stored = await readFile(file, 'utf8');
  const asked = { diagramId: opened.id, kind: 'refine', instruction: 'add Nothing', engine: 'fixture', model: null };
  expect(await refusedRun(request, opened.token, { ...asked, channel: 'readme' })).toEqual({ status: 400, error: 'The channel "readme" has no drawing' });
  expect(await refusedRun(request, opened.token, { ...asked, channel: 'board' }))
    .toEqual({ status: 400, error: 'Unknown channel "board"; use one of overview, linkedin, readme, presentation' });
  const otherChannelsView = await refusedRun(request, opened.token, { ...asked, channel: 'linkedin', view: 'overview' });
  expect(otherChannelsView.status).toBe(400); expect(otherChannelsView.error).toContain('Unknown view "overview"');
  const simplifyElsewhere = await refusedRun(request, opened.token, { diagramId: opened.id, kind: 'simplify', channel: 'linkedin', view: 'linkedin-post', engine: 'fixture', model: null });
  expect(simplifyElsewhere.status).toBe(400); expect(simplifyElsewhere.error).toContain('Only the overview is simplified');
  expect(await readFile(file, 'utf8')).toBe(stored);
});
