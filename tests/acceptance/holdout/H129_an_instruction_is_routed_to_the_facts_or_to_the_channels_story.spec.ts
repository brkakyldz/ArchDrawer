import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { shop3, withLinkedIn, withReadme, withPresentation, workspaceRaw, register, startKind, refusedRun, finishRun, runEvents, readDocument, viewOf, partOf, factOf, outdatedOf, sorted,
  type Channel } from './helpers';

const FACTS = 'Changing the facts', STORY = 'Redrawing this channel from the facts';

// ADR 0007 and AI-5: an instruction first asks one small question without tools, whether it changes what is true about the system
// or only how a channel tells it. `facts` runs the refine, which may change facts and marks the other channels that tell them
// differently; `story` redraws the current channel from the facts and marks nothing. A `parts` scope never asks. The fixture
// answers `story` when the instruction holds `[fixture:story]`.
test('H129 [AI-5, AI-1, FILE-3, STORY-6] a refine goes to the facts or to the channel story, says which in its record and its done event, marks other channels only on the facts route, and a parts scope takes the facts route without being asked', async ({ request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('routing', withPresentation(withReadme(withLinkedIn(shop3('Routing shop')))));
  const opened = await register(request, file);
  const run = async (channel: Channel, view: string, instruction: string, extra: Record<string, unknown> = {}) => {
    const runId = await startKind(request, opened.token, { diagramId: opened.id, channel, view, kind: 'refine', instruction, engine: 'fixture', model: null, scope: { kind: 'view' }, ...extra });
    const record = await finishRun(request, runId, 'succeeded', 120_000);
    const events = await runEvents(runId);
    expect(events.at(-1)!.data.route, `done event of "${instruction}"`).toBe(record.route);
    return record;
  };
  const marks = async () => { const d = await readDocument(file); return { linkedin: sorted(outdatedOf(d, 'linkedin')), readme: sorted(outdatedOf(d, 'readme')), presentation: sorted(outdatedOf(d, 'presentation')), overview: outdatedOf(d, 'overview') }; };
  const warnings = async () => ((await readDocument(file)).warnings ?? []).length;
  expect(await marks()).toEqual({ linkedin: [], readme: [], presentation: [], overview: [] });

  // Facts route: a new component is a new fact; the three channels that draw something else are told, the overview is not.
  const added = await run('overview', 'overview', 'add Cache component');
  expect(added).toMatchObject({ kind: 'refine', channel: 'overview', route: 'facts' }); expect(added.progress).toContain(FACTS); expect(added.progress).not.toContain(STORY);
  expect(added.changes.added).toEqual(['cache']);
  expect(factOf(await readDocument(file), 'cache')).toMatchObject({ label: 'Cache' });
  expect(await marks()).toEqual({ linkedin: ['cache'], readme: ['cache'], presentation: ['cache'], overview: [] });

  // Story route on the overview: it may change how the map is drawn (a move) and nothing it says (a new component is ignored, with one warning).
  const warnedBefore = await warnings();
  const ignored = await run('overview', 'overview', '[fixture:story] add Search component');
  expect(ignored).toMatchObject({ route: 'story' }); expect(ignored.progress).toContain(STORY); expect(ignored.progress).not.toContain(FACTS);
  expect(ignored.changes).toEqual({ added: [], removed: [], changed: [], moved: [], edgesAdded: [], edgesRemoved: [], edgesChanged: [] });
  expect(factOf(await readDocument(file), 'search')).toBeUndefined(); expect(await warnings()).toBeGreaterThanOrEqual(warnedBefore + 1); // each ignored change is warned about
  const moved = await run('overview', 'overview', '[fixture:story] move Web app right of Order API');
  expect(moved).toMatchObject({ route: 'story' }); expect(moved.changes.moved).toContain('web'); expect(moved.changes.added).toEqual([]);
  expect(await marks(), 'the story route marks nothing').toEqual({ linkedin: ['cache'], readme: ['cache'], presentation: ['cache'], overview: [] });

  // Story route on LinkedIn: the channel is drawn again from the facts, cache included in what it may draw; its marks go, the others stay.
  const post = await run('linkedin', 'linkedin-post', '[fixture:story] Make it shorter');
  expect(post).toMatchObject({ kind: 'refine', channel: 'linkedin', route: 'story' }); expect(post.progress).toContain(STORY);
  const afterPost = await readDocument(file);
  expect(sorted(viewOf(afterPost, 'linkedin')!.nodes.map(n => n.id))).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(await marks()).toEqual({ linkedin: [], readme: ['cache'], presentation: ['cache'], overview: [] });
  expect(factOf(afterPost, 'cache')).toBeTruthy();

  // Facts route again: a correction to a fact the LinkedIn post tells in its own words marks LinkedIn alone.
  const renamed = await run('overview', 'overview', 'rename Orders DB to Order store');
  expect(renamed).toMatchObject({ route: 'facts' }); expect(renamed.changes.changed).toEqual(['db']);
  expect(factOf(await readDocument(file), 'db')!.label).toBe('Order store');
  expect(await marks()).toEqual({ linkedin: ['db'], readme: ['cache'], presentation: ['cache'], overview: [] }); // the README and presentation show `db` directly

  // Story route on the README and on the presentation: drawn again from the facts, with the cache and the corrected name; steps made anew.
  const readme = await run('readme', 'readme', '[fixture:story] Simpler, please');
  expect(readme).toMatchObject({ channel: 'readme', route: 'story' });
  const afterReadme = await readDocument(file);
  expect(sorted(viewOf(afterReadme, 'readme')!.nodes.map(n => n.id))).toEqual(['api', 'cache', 'db', 'web']);
  expect(partOf(afterReadme, 'readme', 'db')?.label ?? null).toBeNull();
  const slides = await run('presentation', 'presentation', '[fixture:story] Fewer steps');
  expect(slides).toMatchObject({ channel: 'presentation', route: 'story' });
  const afterSlides = await readDocument(file);
  expect(afterSlides.channels.presentation!.steps!.map(s => s.id)).toEqual(['s1', 's2', 's3']); expect(afterSlides.channels.presentation!.steps![0].text).toMatch(/^Step 1: /);
  expect(await marks()).toEqual({ linkedin: ['db'], readme: [], presentation: [], overview: [] });
  expect(afterSlides.facts.components.map(f => f.id).sort()).toEqual(['api', 'cache', 'db', 'web']); // no story run touched a fact

  // A parts scope never asks: the marker is not heard, the instruction is the refine of the facts and may add a component.
  const scoped = await run('overview', 'overview', '[fixture:story] add Mailer component', { scope: { kind: 'parts', ids: ['web'] } });
  expect(scoped).toMatchObject({ route: 'facts' }); expect(scoped.progress).toContain(FACTS); expect(scoped.progress).not.toContain(STORY);
  expect(scoped.changes.added).toEqual(['mailer']); expect(factOf(await readDocument(file), 'mailer')).toBeTruthy();
  expect(await marks()).toEqual({ linkedin: ['db', 'mailer'], readme: ['mailer'], presentation: ['mailer'], overview: [] });

  // The other kinds ask nothing and name no route (the stories first: after Simplify the overview is one group with no fact to tell).
  const storyKind = await finishRun(request, await startKind(request, opened.token, { diagramId: opened.id, kind: 'story', channel: 'readme', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(storyKind.route).toBeNull(); expect((await runEvents(storyKind.id)).at(-1)!.data.route).toBeNull();
  // A story's format follows its channel: the README's own size on the README, the slide on the presentation. The format of
  // another channel is refused before any engine starts, and a refused request changes nothing.
  const asked = (data: Record<string, unknown>) => refusedRun(request, opened.token, { diagramId: opened.id, kind: 'story', engine: 'fixture', model: null, ...data });
  const bytes = await readFile(file, 'utf8');
  for (const [channel, format] of [['readme', 'feed'], ['readme', 'slide'], ['presentation', 'readme'], ['presentation', 'feed']] as const) {
    const refusal = await asked({ channel, format });
    expect(refusal.status, `${channel} as ${format}`).toBe(400); expect(refusal.error).toMatch(new RegExp(`^Invalid format "?${format}"?; use one of`));
  }
  expect(await readFile(file, 'utf8'), 'a refused story changes nothing').toBe(bytes);
  const readmeFormat = await finishRun(request, await startKind(request, opened.token, { diagramId: opened.id, kind: 'story', channel: 'readme', format: 'readme', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(readmeFormat.layoutReport).toMatchObject({ channel: 'readme', format: 'readme' });
  const slideFormat = await finishRun(request, await startKind(request, opened.token, { diagramId: opened.id, kind: 'story', channel: 'presentation', format: 'slide', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(slideFormat.layoutReport).toMatchObject({ channel: 'presentation', format: 'slide' });
  const simplified = await finishRun(request, await startKind(request, opened.token, { diagramId: opened.id, kind: 'simplify', view: 'overview', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(simplified.route).toBeNull(); expect(simplified.progress).not.toContain(FACTS); expect(simplified.progress).not.toContain(STORY);
  expect((await runEvents(simplified.id)).at(-1)!.data.route).toBeNull();
});
