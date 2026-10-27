import { test, expect } from '@playwright/test';
import { gitRepo, markerRepo, token, startKind, finishRun, sorted, openDrawing } from './helpers';
import {
  WHOLE, option, SLUG, MECHANISMS, FOUR_WARNINGS, drawChoices, getRaw, choiceOf, viewIdsOf, missingFacts, where, panelStructure, type Choice4,
} from './helpers-selections';

const view = (c: Choice4, id: string) => c.channels.overview.views!.find(v => v.id === id)!;

// STORY-8, NAV-1, FILE-2 (ADR 0015, diagram contract *The map* and rule 16): the whole system of a draw is a map of a few parts, each
// holding its inside in a detail view written at once; the map and its detail views together show or hold every component fact. With
// the fixture engine the map is `app` and one card `zone-runtime` ("Agent runtime", no fact) whose inside is `zone-runtime-inside`
// (`agent` and `store`). A section, a flow or a typed choice keeps its overview complete in one view.
test('H202 [STORY-8 FILE-2 NAV-1 STORY-1 #183 #184 #185] the whole system of a draw is a map of a part and a card that holds its inside in a detail view, every fact is on the map or in a detail view, a flow stays in one view, the map has its own report target, and the editor goes from the map into the inside and back', async ({ page, request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);
  const project = await gitRepo('map-draw');

  // The whole system and a flow in one file, the presentation chosen: the flow's overview is the complete one-view overview as before.
  const { run } = await drawChoices(request, auth, project.dir, [WHOLE, option('o1')], 'presentation');
  const doc = await getRaw(request, run.diagramId);
  const system = choiceOf(doc, 'system'), flow = choiceOf(doc, SLUG.o1);

  // The map and its detail view: ids, titles, the card that holds the inside, its connection and the lanes.
  expect(system.channels.overview.views!.map(v => v.id)).toEqual(['overview', 'zone-runtime-inside']);
  const map = view(system, 'overview'), inside = view(system, 'zone-runtime-inside');
  expect(sorted(map.nodes.map(n => n.id))).toEqual(['app', 'zone-runtime']);
  expect(map.nodes.some(n => n.form === 'group'), 'nothing is a group on the map: the zone is a part with an inside').toBe(false);
  const app = map.nodes.find(n => n.id === 'app')!, card = map.nodes.find(n => n.id === 'zone-runtime')!;
  expect(app).toMatchObject({ facts: ['app'], parent: null, detail: null, lane: { spine: 0 } });
  expect(card).toMatchObject({ facts: [], form: 'card', label: 'Agent runtime', kind: 'service', description: 'A group of components.', detail: 'zone-runtime-inside', parent: null, lane: { spine: 1 } });
  expect(map.edges).toHaveLength(1);
  expect(map.edges[0]).toMatchObject({ id: 'app-zone-runtime', from: 'app', to: 'zone-runtime', step: 1, label: 'asks' });
  expect(map.edges[0].relations ?? [], 'the card shows no fact, so its connection shows no relation').toEqual([]);
  expect(inside).toMatchObject({ id: 'zone-runtime-inside', title: 'Agent runtime', caption: { title: 'Agent runtime', lede: '' } });
  expect(sorted(inside.nodes.map(n => n.id))).toEqual(['agent', 'store']);
  expect(inside.nodes.find(n => n.id === 'agent')).toMatchObject({ facts: ['agent'], form: 'panel', held: MECHANISMS, limits: ['turn-limit'], parent: null, lane: { spine: 1 } });
  expect(inside.nodes.find(n => n.id === 'store')).toMatchObject({ facts: ['store'], parent: null, lane: { anchor: 'agent', side: 'below' } });
  expect(inside.edges.map(e => [e.from, e.to, e.relations])).toEqual([['agent', 'store', ['r7']]]);
  for (const v of [map, inside]) expect(v.nodes.every(n => typeof n.x === 'number' && typeof n.y === 'number'), `${v.id} is laid out`).toBe(true);
  // Every component fact is shown or held by a part of the map or of its detail view (the rule moved from one view to the channel).
  expect(missingFacts(system)).toEqual([]);
  expect(new Set(map.nodes.flatMap(n => n.facts))).toEqual(new Set(['app']));
  expect(new Set(inside.nodes.flatMap(n => [...n.facts, ...(n.held ?? [])]))).toEqual(new Set(['agent', 'store', ...MECHANISMS]));
  // The flow keeps the complete overview in one view, with the zone as a group, as before.
  expect(viewIdsOf(flow)).toEqual([`${SLUG.o1}-overview`]);
  const whole = view(flow, `${SLUG.o1}-overview`);
  expect(whole.nodes.find(n => n.id === 'zone-runtime')).toMatchObject({ form: 'group', facts: [] });
  expect(whole.nodes.find(n => n.id === 'agent')).toMatchObject({ parent: 'zone-runtime', form: 'panel', held: MECHANISMS });
  expect(missingFacts(flow)).toEqual([]);
  // The split adds no warning: the system's warnings are the flow's, title apart.
  const own = (c: Choice4) => (doc.warnings ?? []).filter(w => w.startsWith(`${c.title}: `)).map(w => w.slice(c.title.length + 2));
  expect(own(system).slice(0, 4)).toEqual(FOUR_WARNINGS); expect(own(system)).toEqual(own(flow));
  // The chosen channel is told from the map and its detail view: the card that has an inside is skipped, and three steps name the three parts.
  for (const c of [system, flow]) {
    const pres = c.channels.presentation!;
    expect(sorted(pres.views![0].nodes.map(n => n.id)), c.id).toEqual(['agent', 'app', 'store']);
    expect(pres.steps!.map(s => s.id), c.id).toEqual(['s1', 's2', 's3']);
    expect(sorted(pres.steps!.flatMap(s => s.parts)), `${c.id}: one step for each of the three parts`).toEqual(['agent', 'app', 'store']);
    pres.steps!.forEach((s, i) => expect(s.text).toMatch(new RegExp(`^Step ${i + 1}: `)));
  }
  expect(sorted(system.channels.presentation!.views![0].edges.map(e => `${e.from}>${e.to}`))).toEqual(['agent>store']);
  expect(sorted(flow.channels.presentation!.views![0].edges.map(e => `${e.from}>${e.to}`))).toEqual(['agent>store', 'app>agent']);

  // The layout report: the map is the one view with a target of nine parts; its detail view and a flow's overview have none.
  const report = async (data: Record<string, unknown>) => (await finishRun(request, await startKind(request, auth, { diagramId: run.diagramId, instruction: 'Keep it as it is', engine: 'fixture', model: null, ...data }), 'succeeded', 15_000)).layoutReport;
  const mapReport = await report({ choice: 'system', view: 'overview' });
  expect(mapReport).toMatchObject({ choice: 'system', view: 'overview', counts: { parts: 2, zones: 0, connections: 1 }, targets: { parts: 9, zones: null, connections: null } });
  expect((await report({ choice: 'system', view: 'zone-runtime-inside' })).targets).toEqual({ parts: null, zones: null, connections: null });
  expect((await report({ choice: SLUG.o1, view: `${SLUG.o1}-overview` })).targets).toEqual({ parts: null, zones: null, connections: null });
  expect((await getRaw(request, run.diagramId)).choices, 'a run that changes nothing leaves the file as it was').toEqual(doc.choices);

  // The editor opens on the map; the card opens its inside, the crumb leads back, the panel lists both.
  await openDrawing(page, request, run.path);
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'overview' });
  expect(await panelStructure(page)).toEqual(['choice:system', 'entry:overview', 'entry:zone-runtime-inside', 'heading:flow', `choice:${SLUG.o1}`, `entry:${SLUG.o1}-overview`]);
  await expect(page.getByTestId('node-app')).toBeVisible(); await expect(page.getByTestId('node-zone-runtime')).toBeVisible(); await expect(page.getByTestId('node-agent')).toHaveCount(0);
  await expect(page.getByTestId('node-zone-runtime')).toHaveAttribute('data-open', 'true');
  await page.getByTestId('node-zone-runtime').getByTestId('node-inside').click();
  expect(await where(page)).toEqual({ choice: 'system', channel: 'overview', view: 'zone-runtime-inside' });
  await expect(page.getByTestId('node-agent')).toBeVisible(); await expect(page.getByTestId('node-store')).toBeVisible(); await expect(page.getByTestId('node-app')).toHaveCount(0);
  await expect(page.getByTestId('crumb-overview')).toBeVisible(); await expect(page.getByTestId('crumbs')).toContainText('Agent runtime');
  await page.getByTestId('crumb-overview').click(); expect(await where(page)).toMatchObject({ view: 'overview' });

  // A left-out store is added back inside the zone before the split, so it is drawn in the detail view and not on the map (a folder named with a marker).
  if (process.platform !== 'win32') {
    const partial = (await markerRepo('[fixture:partial]'))!;
    const done = await drawChoices(request, auth, partial.dir, [WHOLE], 'linkedin');
    const stored = choiceOf(await getRaw(request, done.run.diagramId), 'system');
    expect(sorted(view(stored, 'overview').nodes.map(n => n.id))).toEqual(['app', 'zone-runtime']);
    expect(sorted(view(stored, 'zone-runtime-inside').nodes.map(n => n.id))).toEqual(['agent', 'store']);
    expect(missingFacts(stored)).toEqual([]);
    // diagram contract *Every fact drawn*: one warning for the left-out part and one for the relation it left out (added as a connection);
    // testing contract, the fixture's post answer: its last two connections join into one two-way connection with exactly one warning.
    const warnings = (await getRaw(request, done.run.diagramId)).warnings ?? [];
    expect(warnings.slice(0, 4), 'the four evidence warnings come first').toEqual(FOUR_WARNINGS);
    const rest = warnings.slice(4);
    expect(rest.filter(w => w === 'Added "store", which the overview left out'), 'one warning for the part it added').toHaveLength(1);
    expect(rest.filter(w => !w.startsWith('Added "store"') && /agent/.test(w) && /store/.test(w)), 'one warning for the relation agent-store added as a connection').toHaveLength(1);
    expect(rest.filter(w => /result/.test(w) && /approval/.test(w)), 'one warning for the post joining result and approval into one two-way connection').toHaveLength(1);
    expect(rest, 'the part, its connection and the post join, and nothing else').toHaveLength(3);
  }
});
