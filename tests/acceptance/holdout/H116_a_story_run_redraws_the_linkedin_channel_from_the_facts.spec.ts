import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, workspaceRaw, register, startKind, finishRun, refusedRun, readDocument, viewOf, outdatedOf, sorted } from './helpers';

const POST_PARTS = ['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime'];

// ADR 0007: one story shape for every channel. A `story` run redraws the channel's one view from the facts alone; on the
// LinkedIn channel it gives what a `post` run gives (a post is a story on LinkedIn), and it changes nothing else.
test('H116 [STORY-1, STORY-2, STORY-6, AI-1] a story run on the LinkedIn channel redraws it from the facts like a post run, empties its marks and touches nothing else, and a wrong story request is refused before any engine starts', async ({ request }) => {
  const story = await workspaceRaw('story-run', withLinkedIn(shop3('Story shop'), { outdated: ['db'] }));
  const post = await workspaceRaw('post-run', withLinkedIn(shop3('Story shop'), { outdated: ['db'] }));
  const storyOpen = await register(request, story.file), postOpen = await register(request, post.file);
  const before = await readDocument(story.file);

  const storyRun = await finishRun(request, await startKind(request, storyOpen.token, {
    diagramId: storyOpen.id, kind: 'story', channel: 'linkedin', engine: 'fixture', model: null }), 'succeeded', 90_000);
  expect(storyRun).toMatchObject({ kind: 'story', channel: 'linkedin', view: 'linkedin-post', status: 'succeeded', diagramId: storyOpen.id, route: null, path: null, error: null });
  expect(storyRun.layoutReport).toMatchObject({ channel: 'linkedin', view: 'linkedin-post', format: 'feed' });
  expect(storyRun.layoutReport.targets).toEqual({ parts: 12, zones: { min: 0, max: 4 }, connections: 14 });
  const redrawn = await readDocument(story.file), view = viewOf(redrawn, 'linkedin')!;
  expect(view.id).toBe('linkedin-post'); // the channel had a view: its id is kept
  expect(view).toMatchObject({ title: 'LinkedIn', caption: { title: 'How a request becomes a result' } });
  expect(sorted(view.nodes.map(n => n.id))).toEqual(POST_PARTS);
  expect(outdatedOf(redrawn, 'linkedin')).toEqual([]); // redrawing empties the marks
  expect(redrawn.facts).toEqual(before.facts); expect(redrawn.channels.overview).toEqual(before.channels.overview);
  expect(redrawn.channels.readme ?? {}).toEqual(before.channels.readme ?? {}); expect(redrawn.channels.presentation ?? {}).toEqual(before.channels.presentation ?? {});
  for (const p of view.nodes) { expect(p.held ?? [], `${p.id}: LinkedIn holds no mechanism`).toEqual([]); expect(p.limits ?? [], `${p.id}: LinkedIn shows no limit`).toEqual([]); }
  expect(redrawn.channels.presentation?.steps ?? []).toEqual([]);

  // The same drawing a post run makes.
  await finishRun(request, await startKind(request, postOpen.token, { diagramId: postOpen.id, kind: 'post', engine: 'fixture', model: null }), 'succeeded', 90_000);
  expect(viewOf(await readDocument(post.file), 'linkedin')).toEqual(view);

  // A story needs no existing view: on a drawing with no LinkedIn channel it draws one, in the wide format when asked for it.
  const bare = await workspaceRaw('story-bare', shop3('Bare shop')), bareOpen = await register(request, bare.file);
  const wide = await finishRun(request, await startKind(request, bareOpen.token, {
    diagramId: bareOpen.id, kind: 'story', channel: 'linkedin', format: 'linkedin', engine: 'fixture', model: null }), 'succeeded', 90_000);
  expect(wide).toMatchObject({ channel: 'linkedin', view: 'linkedin' }); expect(wide.layoutReport).toMatchObject({ format: 'linkedin' });
  expect(sorted(viewOf(await readDocument(bare.file), 'linkedin')!.nodes.map(n => n.id))).toEqual(POST_PARTS);

  // Refusals: the sentence of the contract, status 400, and the file is as it was.
  const saved = await readFile(story.file, 'utf8');
  const ask = (data: Record<string, unknown>) => refusedRun(request, storyOpen.token, { diagramId: storyOpen.id, engine: 'fixture', model: null, ...data });
  expect(await ask({ kind: 'story', channel: 'overview' })).toEqual({ status: 400, error: 'A story is drawn in the linkedin, readme or presentation channel' });
  expect(await ask({ kind: 'story' })).toEqual({ status: 400, error: 'A story is drawn in the linkedin, readme or presentation channel' });
  expect(await ask({ kind: 'story', channel: 'board' })).toEqual({ status: 400, error: 'Unknown channel "board"; use one of overview, linkedin, readme, presentation' });
  expect(await ask({ kind: 'story', channel: 'linkedin', scope: { kind: 'parts', ids: ['intake'] } }))
    .toEqual({ status: 400, error: 'A story draws the channel\'s one view: give no scope or {"kind": "view"}' });
  expect(await ask({ kind: 'story', channel: 'linkedin', readCode: 'yes' })).toEqual({ status: 400, error: 'readCode must be true or false' });
  expect(await ask({ kind: 'refine', channel: 'linkedin', view: 'linkedin-post', instruction: 'Observe', readCode: true })).toEqual({ status: 400, error: 'readCode is for a story' });
  expect(await ask({ kind: 'story', channel: 'linkedin', instruction: 7 })).toEqual({ status: 400, error: 'instruction must be a string' });
  expect((await ask({ kind: 'story', channel: 'linkedin', format: 'readme' })).error).toMatch(/^Invalid format "?readme"?; use one of/);
  expect(await ask({ kind: 'poster', channel: 'linkedin' })).toEqual({ status: 400, error: 'Unknown run kind poster: use refine, story, post, simplify, revise or draw' });
  expect(await readFile(story.file, 'utf8'), 'a refused request writes nothing').toBe(saved);
});
