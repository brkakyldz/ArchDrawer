import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, token, scanFolder, finishRun, runEvents, listedDiagrams, exists, cli, errorLines, samePath, sorted } from './helpers';
import {
  WHOLE, option, typed, SLUG, OPTIONS, FOUR_WARNINGS, startDrawChoices, runRecord, progressOf, messagesOf, choiceSlug, drawChoices,
  getRaw, flat3, missingFacts, allViewIds, type ChoiceReq, type RunChoice,
} from './helpers-selections';

const TYPED = 'How a booking is paid';

// START-7, SCAN-3, STORY-1 (api contract, *The draw run*): one `draw` run of several choices draws them one after another, one read
// each. The run record lists them from the start; every progress event names its choice; `succeeded` means a registered, readable
// `@4` file that holds every choice, each with its overview and the chosen channel and its other channels empty. Ids are slugs.
test('H194 [START-7 SCAN-3 STORY-1 READ-1 FILE-2 #181 #182] one draw run of three choices lists them from the start, reads each in turn with events that name their choice, and writes one valid format 4 file with every choice, its overview and the README; ids are slugs', async ({ request }) => {
  test.setTimeout(420_000);
  const auth = await token(request);
  const project = await gitRepo('draw-three');
  const listedBefore = (await listedDiagrams(request)).length;
  const scan = await scanFolder(request, auth, project.dir);
  const wanted = [{ id: 'system', kind: 'system', title: 'The whole system' }, { id: SLUG.o2, kind: 'section', title: OPTIONS.o2.title }, { id: 'how-a-booking-is-paid', kind: 'custom', title: TYPED }];

  const runId = await startDrawChoices(request, auth, scan.id, [WHOLE, option('o2'), typed(` ${TYPED} `)], 'readme');
  const early = await runRecord(request, runId);
  expect(early).toMatchObject({ kind: 'draw', channel: 'readme', choice: 'system' });
  expect((early.choices as RunChoice[]).map(c => ({ id: c.id, kind: c.kind, title: c.title })), 'the choices are listed from the start, in request order, the typed text trimmed').toEqual(wanted);
  expect((early.choices as RunChoice[]).every(c => ['waiting', 'running', 'done'].includes(c.status))).toBe(true);
  const run = await finishRun(request, runId, 'succeeded', 240_000);

  // The finished record: every choice done at its last stage, the first choice and the README of it, the report of that view.
  expect(run.choices as RunChoice[]).toEqual(wanted.map(c => ({ ...c, status: 'done', stage: 'channel' })));
  expect(run).toMatchObject({ status: 'succeeded', error: null, choice: 'system', channel: 'readme', view: 'readme' });
  expect(run.layoutReport).toMatchObject({ choice: 'system', channel: 'readme', view: 'readme', format: 'readme' });
  expect(run.changes.added.length).toBeGreaterThan(0);
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  expect(samePath(run.path, file), run.path).toBe(true); expect(run.diagramId).toMatch(/^d_[a-z0-9]{6,}$/);

  // The events: a line opening each choice, every draw line carrying its choice and stage, choices never interleaved, the stages in order.
  const events = await runEvents(runId);
  const lines = progressOf(events);
  expect(lines.length).toBeGreaterThan(9);
  expect(lines.every(e => typeof e.data.choice === 'string' && ['read', 'overview', 'channel'].includes(e.data.stage)), 'every progress line of a draw names its choice and stage').toBe(true);
  const order = lines.map(e => wanted.findIndex(w => w.id === e.data.choice));
  expect(order.every(i => i >= 0)).toBe(true); expect(order, 'one choice after another').toEqual([...order].sort((a, b) => a - b));
  wanted.forEach((w, i) => {
    const mine = messagesOf(events, w.id);
    expect(mine[0], `${w.id} opens with its own line`).toBe(`Drawing "${w.title}" (${i + 1} of 3)`);
    expect(progressOf(events, w.id)[0].data.stage).toBe('read');
    for (const line of ['Reading the code', 'Checking the facts', 'Drawing the overview', 'Drawing the README drawing']) expect(mine, `${w.id}: ${line}`).toContain(line);
    const stages = progressOf(events, w.id).map(e => e.data.stage);
    expect([...new Set(stages)]).toEqual(['read', 'overview', 'channel']);
    expect(messagesOf(events, w.id, 'read')).not.toContain('Using the facts already read'); // a draw that never failed reuses nothing
  });
  expect(events.filter(e => e.event === 'done')).toHaveLength(1);
  expect(events.at(-1)!.data).toMatchObject({ status: 'succeeded', diagramId: run.diagramId, choice: 'system', channel: 'readme', view: 'readme' });
  expect(events.at(-1)!.data.choices).toEqual(run.choices);

  // `succeeded` means a readable, registered file holding every choice, valid as the command line checks it.
  expect(await exists(file)).toBe(true); expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  const listed = await listedDiagrams(request);
  expect(listed).toHaveLength(listedBefore + 1); expect(listed.find(d => d.id === run.diagramId)).toMatchObject({ title: basename(project.dir) });
  const doc = await getRaw(request, run.diagramId);
  expect(doc.schema).toBe('archdraw/diagram@4'); expect(doc.title).toBe(basename(project.dir)); expect(samePath(doc.source!.path, project.dir)).toBe(true);
  expect(doc.choices.map(c => [c.id, c.kind, c.title, c.about])).toEqual([['system', 'system', 'The whole system', ''], [SLUG.o2, 'section', OPTIONS.o2.title, OPTIONS.o2.sentence], ['how-a-booking-is-paid', 'custom', TYPED, TYPED]]);
  const validated = await cli(['validate', file]); expect(validated.code, validated.stdout + validated.stderr).toBe(0); expect(errorLines(validated)).toEqual([]);
  for (const c of doc.choices) {
    expect(c.channels.readme?.views, `${c.id}: the README is drawn`).toHaveLength(1);
    expect(c.channels.linkedin?.views ?? [], `${c.id}: LinkedIn is not drawn`).toEqual([]); expect(c.channels.presentation?.views ?? []).toEqual([]);
    expect(c.channels.overview.outdated ?? [], `${c.id}: nothing waits to be redrawn`).toEqual([]); expect(c.channels.readme!.outdated ?? []).toEqual([]);
    expect(missingFacts(c), `${c.id}: every fact is drawn`).toEqual([]);
  }
  expect(doc.choices[1].facts, 'each choice has its own read, the same here because the fixture reads the same').toEqual(doc.choices[0].facts);
  expect(doc.choices[2].facts).toEqual(doc.choices[0].facts);
  expect(doc.choices.map(c => c.channels.readme!.views![0].id)).toEqual(['readme', `${SLUG.o2}-readme`, 'how-a-booking-is-paid-readme']);

  // The README tells the whole system from its map and its detail views: the map's connection ends at a part that has an inside and is
  // skipped, so the system has one connection and the section, whose overview is complete in one view, both.
  const edges = (id: string) => sorted(flat3(doc, id).channels.readme!.views![0].edges.map(e => `${e.from}>${e.to}`));
  const parts = (id: string) => sorted(flat3(doc, id).channels.readme!.views![0].nodes.map(n => n.id));
  expect(parts('system')).toEqual(['agent', 'app', 'store']); expect(edges('system')).toEqual(['agent>store']);
  expect(parts(SLUG.o2)).toEqual(['agent', 'app', 'store']); expect(edges(SLUG.o2)).toEqual(['agent>store', 'app>agent']);
  expect(edges('how-a-booking-is-paid')).toEqual(['agent>store', 'app>agent']);

  // Warnings: a run of several choices starts each with its choice's title, choice by choice.
  const warnings = doc.warnings ?? [];
  for (const c of doc.choices) expect(warnings.filter(w => w.startsWith(`${c.title}: `)).slice(0, 4), c.id).toEqual(FOUR_WARNINGS.map(w => `${c.title}: ${w}`));
  expect(warnings.every(w => doc.choices.some(c => w.startsWith(`${c.title}: `)))).toBe(true);

  // Ids are slugs: a text that gives an id an earlier choice has gets `-2`, `system` is kept for the whole system, an empty slug is
  // `choice`, a title over 80 characters is cut to 79 and an ellipsis (the about keeps the whole text).
  const long = `${'a'.repeat(95)}!`;
  const cases: { choices: ChoiceReq[]; ids: string[]; titles?: string[]; about?: string }[] = [
    { choices: [option('o2'), typed('the Agent loop!')], ids: [SLUG.o2, `${SLUG.o2}-2`] },
    { choices: [WHOLE, typed('System')], ids: ['system', 'system-2'] },
    { choices: [typed('???')], ids: ['choice'], titles: ['???'] },
    { choices: [typed(long)], ids: ['a'.repeat(40)], titles: [`${'a'.repeat(79)}…`], about: long },
  ];
  expect(choiceSlug('the Agent loop!')).toBe(SLUG.o2); expect(choiceSlug('???')).toBe('choice');
  for (const [k, c] of cases.entries()) {
    const done = await drawChoices(request, auth, project.dir, c.choices, 'linkedin', { scan: scan.id });
    expect((done.run.choices as RunChoice[]).map(x => x.id), `case ${k}`).toEqual(c.ids);
    const stored = await getRaw(request, done.run.diagramId);
    expect(stored.choices.map(x => x.id), `case ${k}: the file`).toEqual(c.ids);
    if (c.titles) { expect(stored.choices.map(x => x.title)).toEqual(c.titles); expect(stored.choices[0].title.length).toBeLessThanOrEqual(80); }
    if (c.about) expect(stored.choices[0].about).toBe(c.about);
    const viewIds = allViewIds(stored);
    expect(new Set(viewIds).size, `case ${k}: view ids are unique across the file`).toBe(viewIds.length);
  }
});
