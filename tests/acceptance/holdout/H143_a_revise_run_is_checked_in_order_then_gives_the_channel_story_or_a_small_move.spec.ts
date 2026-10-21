import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, withReadme, withPresentation, fact, part, workspaceRaw, register, startKind, refusedRun, finishRun, runEvents, readDocument, readDrawing, viewOf, sorted,
  TINY_PNG, paddedPng, noChanges, type Doc3 } from './helpers';

const POST_PARTS = ['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime'];

// The overview is a single group with a member: its only top-level component is a group.
function groupOnly(title: string): Doc3 {
  return { schema: 'archdraw/diagram@3', title, facts: { components: [fact('inner', { label: 'Inner part' })], relations: [] },
    channels: { overview: { showSteps: false, outdated: [], views: [{ id: 'overview', title: 'Overview', caption: { title: 'Only a group', lede: '' },
      nodes: [part('zone', { facts: [], form: 'group', label: 'Zone', kind: 'service', description: 'A group of components.', place: { row: 0, col: 0 } }), part('inner', { parent: 'zone' })],
      edges: [], texts: [] }] } } };
}

// LAYOUT-4: a `revise` run is the second look. The request is checked in the contracted order before any engine starts; with the
// fixture (it first checks that the image exists and is a PNG) the answer is the channel's story on LinkedIn, README and
// presentation and one small move on the overview; it names no route; a failed run writes nothing. Only the fixture runs here.
test('H143 [LAYOUT-4, AI-1, FILE-3] a revise run is refused in the contracted order before any engine starts, then gives the channel its story or the overview one small move, names no route, and a failure writes nothing', async ({ request }) => {
  test.setTimeout(300_000);
  const { file } = await workspaceRaw('second-look', withPresentation(withReadme(withLinkedIn(shop3('Second look shop')))));
  const opened = await register(request, file);
  const before = await readDocument(file), beforeDrawing = await readDrawing(file);
  const base = { diagramId: opened.id, kind: 'revise', channel: 'overview', view: 'overview', image: TINY_PNG, engine: 'fixture', model: null };
  const ask = (over: Record<string, unknown>) => refusedRun(request, opened.token, { ...base, ...over });
  const bytes = await readFile(file, 'utf8');

  // Refusals, each earlier one hiding the later: the kind and format, readCode, the image (missing, not a PNG, too large), an
  // image on another kind, the instruction, the scope, then the drawing, the view, the channel and the engine.
  const noImage = "A revise needs the drawing's image";
  expect((await ask({ format: 'nope', image: undefined })).error).toMatch(/^Invalid format "?nope"?; use one of/);
  // A revise's format is absent or the channel's default (README on the overview, the feed on LinkedIn): another share format is refused.
  expect((await ask({ format: 'square', image: undefined })).error).toMatch(/^Invalid format "?square"?; use one of/);
  expect((await ask({ channel: 'linkedin', view: undefined, format: 'linkedin', image: undefined })).error).toMatch(/^Invalid format "?linkedin"?; use one of/);
  expect(await ask({ format: 'readme', image: undefined }), 'the overview\'s own default is accepted, so the next check speaks').toEqual({ status: 400, error: "A revise needs the drawing's image" });
  expect(await ask({ channel: 'linkedin', view: undefined, format: 'feed', image: undefined })).toEqual({ status: 400, error: "A revise needs the drawing's image" });
  expect(await ask({ readCode: 'yes', image: undefined })).toEqual({ status: 400, error: 'readCode must be true or false' });
  expect(await ask({ readCode: true, image: undefined })).toEqual({ status: 400, error: 'readCode is for a story' });
  expect(await ask({ image: undefined })).toEqual({ status: 400, error: noImage });
  expect(await ask({ image: 7 })).toEqual({ status: 400, error: noImage });
  const notPng = { status: 400, error: 'The image is not a PNG' };
  expect(await ask({ image: 'not base64 at all !!!' })).toEqual(notPng);
  expect(await ask({ image: Buffer.from('GIF89a with nothing in it').toString('base64') })).toEqual(notPng);
  expect(await ask({ image: `data:image/png;base64,${TINY_PNG}` }), 'no data: prefix').toEqual(notPng);
  expect(await ask({ image: paddedPng(4 * 1024 * 1024 + 1024) })).toEqual({ status: 400, error: 'The image is too large (4 MB at most)' });
  expect(await ask({ image: Buffer.alloc(5 * 1024 * 1024, 0x41).toString('base64') }), 'a file that is no PNG is said so before its size').toEqual(notPng);
  for (const other of [{ kind: 'refine', instruction: 'add Cache component' }, { kind: 'story', channel: 'linkedin', view: undefined }, { kind: 'post', channel: 'linkedin', view: undefined }, { kind: 'simplify' }])
    expect(await ask(other), `an image on a ${other.kind}`).toEqual({ status: 400, error: 'An image is for a revise' });
  expect(await ask({ kind: 'refine', instruction: 7 })).toEqual({ status: 400, error: 'An image is for a revise' });
  expect(await ask({ kind: 'refine', instruction: 'add Cache component', readCode: true })).toEqual({ status: 400, error: 'readCode is for a story' });
  expect(await ask({ instruction: 7 })).toEqual({ status: 400, error: 'instruction must be a string' });
  const oneView = { status: 400, error: 'A story draws the channel\'s one view: give no scope or {"kind": "view"}' };
  expect(await ask({ scope: { kind: 'all' } })).toEqual(oneView); expect(await ask({ scope: { kind: 'parts', ids: ['web'] } })).toEqual(oneView);
  expect(await ask({ instruction: 7, scope: { kind: 'all' } })).toEqual({ status: 400, error: 'instruction must be a string' });
  expect((await ask({ diagramId: 'd_nothere1' })).status).toBe(404);
  const unknownView = await ask({ view: 'nope' }); expect(unknownView.status).toBe(400); expect(unknownView.error).toContain('Unknown view "nope"');
  expect(await ask({ channel: 'board', view: undefined })).toEqual({ status: 400, error: 'Unknown channel "board"; use one of overview, linkedin, readme, presentation' });
  const engine = await ask({ engine: 'nope' }); expect(engine.status).toBe(400); expect(engine.error).toContain('Unknown engine "nope"');
  const bare = await register(request, (await workspaceRaw('second-look-bare', shop3('Bare shop'))).file);
  expect(await refusedRun(request, bare.token, { ...base, diagramId: bare.id, channel: 'readme', view: undefined })).toEqual({ status: 400, error: 'The channel "readme" has no drawing' });
  expect(await readFile(file, 'utf8'), 'a refused request writes nothing').toBe(bytes);

  // The overview: one small move of the first top-level part, 40 px to the right, nothing else; no route; progress starts with the look.
  const overview = await finishRun(request, await startKind(request, opened.token, { ...base, instruction: 'Fix the crowding', scope: { kind: 'view' } }), 'succeeded', 90_000);
  expect(overview).toMatchObject({ kind: 'revise', channel: 'overview', view: 'overview', status: 'succeeded', diagramId: opened.id, route: null, path: null, error: null, engine: 'fixture' });
  expect(overview.progress[0]).toBe('Looking at the drawing'); expect(overview.progress).not.toContain('Changing the facts'); expect(overview.progress).not.toContain('Redrawing this channel from the facts');
  expect(overview.changes).toEqual({ ...noChanges, moved: ['web'] }); expect(overview.layoutReport).toMatchObject({ channel: 'overview', view: 'overview' });
  const done = (await runEvents(overview.id)).at(-1)!; expect(done.event).toBe('done'); expect(done.data).toMatchObject({ status: 'succeeded', route: null, channel: 'overview', view: 'overview' });
  const moved = await readDrawing(file), was = beforeDrawing.views[0].nodes.find(n => n.id === 'web')!, now = moved.views[0].nodes.find(n => n.id === 'web')!;
  expect(now.x! - was.x!, 'moved 40 px right (on the 8 px grid)').toBeGreaterThanOrEqual(32); expect(now.x! - was.x!).toBeLessThanOrEqual(48); expect(now.y).toBe(was.y);
  for (const n of beforeDrawing.views[0].nodes.filter(n => n.id !== 'web')) expect(moved.views[0].nodes.find(m => m.id === n.id), n.id).toEqual(n);
  const afterOverview = await readDocument(file);
  expect(afterOverview.facts, 'a second look changes no fact').toEqual(before.facts); expect(afterOverview.channels.linkedin).toEqual(before.channels.linkedin);

  // A view whose only top-level component is a group has nothing to move: the run succeeds and says nothing changed.
  const loneFile = (await workspaceRaw('second-look-group', groupOnly('Group only'))).file, lone = await register(request, loneFile), loneBefore = await readDocument(loneFile);
  const loneRun = await finishRun(request, await startKind(request, lone.token, { ...base, diagramId: lone.id }), 'succeeded', 90_000);
  expect(loneRun.changes).toEqual(noChanges); expect(loneRun.route).toBeNull(); expect(loneRun.progress[0]).toBe('Looking at the drawing');
  expect((await readDocument(loneFile)).channels.overview, 'nothing to move in a lone group').toEqual(loneBefore.channels.overview);

  // The channels with a story: the story the fixture gives each, its marks emptied, the facts and every other channel left alone.
  const readme = await finishRun(request, await startKind(request, opened.token, { ...base, channel: 'readme', view: 'readme' }), 'succeeded', 90_000);
  expect(readme).toMatchObject({ kind: 'revise', channel: 'readme', route: null }); expect(readme.progress[0]).toBe('Looking at the drawing'); expect(readme.layoutReport).toMatchObject({ channel: 'readme', format: 'readme' });
  const afterReadme = await readDocument(file);
  expect(sorted(viewOf(afterReadme, 'readme')!.nodes.map(n => n.id))).toEqual(['api', 'db', 'web']); expect(viewOf(afterReadme, 'readme')!.caption.lede).toBe('A detailed drawing made by the test engine.');
  const post = await finishRun(request, await startKind(request, opened.token, { ...base, channel: 'linkedin', view: 'linkedin-post' }), 'succeeded', 90_000);
  expect(post).toMatchObject({ channel: 'linkedin', view: 'linkedin-post', route: null }); expect(post.layoutReport).toMatchObject({ channel: 'linkedin', format: 'feed' });
  const afterPost = await readDocument(file);
  expect(sorted(viewOf(afterPost, 'linkedin')!.nodes.map(n => n.id))).toEqual(POST_PARTS); expect(viewOf(afterPost, 'linkedin')!.caption.lede).toBe('A request enters the app, is checked, and produces a result.');
  // A large image is fine: 3 MB is under the limit.
  const slides = await finishRun(request, await startKind(request, opened.token, { ...base, channel: 'presentation', view: 'presentation', image: paddedPng(3_000_000) }), 'succeeded', 90_000);
  expect(slides).toMatchObject({ channel: 'presentation', route: null }); expect(slides.layoutReport).toMatchObject({ channel: 'presentation', format: 'slide' });
  const afterSlides = await readDocument(file);
  expect(afterSlides.channels.presentation!.steps!.map(s => s.id)).toEqual(['s1', 's2', 's3']);
  expect(afterSlides.facts, 'no second look changed a fact').toEqual(before.facts);
  expect(viewOf(afterSlides, 'overview')).toEqual(viewOf(afterOverview, 'overview'));

  // A failed second look writes nothing, and says why.
  const stored = await readFile(file, 'utf8');
  const failed = await finishRun(request, await startKind(request, opened.token, { ...base, instruction: '[fixture:fail]' }), 'failed', 90_000);
  expect(failed.error).toBe('Fixture failure requested'); expect(failed.changes).toBeNull(); expect(failed.route).toBeNull();
  expect(await readFile(file, 'utf8'), 'a failed revise writes nothing').toBe(stored);
});
