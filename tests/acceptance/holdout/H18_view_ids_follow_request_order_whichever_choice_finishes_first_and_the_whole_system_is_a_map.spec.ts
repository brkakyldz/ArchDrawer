import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import { says, gitRepo, scan, startDraw, waitRun, readJSON, runRecord, runEvents, lines, WHOLE, option, typed, OPTION } from './helpers';

const product = useProduct({ stepMs: 250 });

const viewIds = (c: any) => ['overview', 'linkedin', 'readme'].flatMap(ch => (c.channels[ch]?.views ?? []).map((v: any) => `${ch}:${v.id}`));
// Every component fact shown or held by a part of the choice's overview channel (drawing contract rule 16).
const unshown = (c: any) => {
  const seen = new Set(c.channels.overview.views.flatMap((v: any) => v.nodes.flatMap((n: any) => [...n.facts, ...(n.held ?? [])])));
  return c.facts.components.map((f: any) => f.id).filter((id: string) => !seen.has(id));
};

// Two developers draw the same three things from two copies of a repository; in one, the first choice takes longer (its overview needs a
// repair turn) and finishes last. Both files have the same ids, in request order, as if drawn one after another. The whole system is drawn
// as a map of a few parts, each holding its inside in a detail view written at once.
test('H18 [JOB-2 START-7 STORY-8 STORY-6 FILE-2] view ids follow request order whichever choice finishes first, and the whole system is a map whose parts hold their inside in detail views', async () => {
  const p = product();
  const late = await gitRepo('ids-late'), control = await gitRepo('ids-control');
  const LATE = 'Slow first [fixture:overlong]', LATE_ID = 'slow-first-fixture-overlong';
  const lateRun = await waitRun(p, await startDraw(p, (await scan(p, { folder: late.dir })).id, [typed(LATE), WHOLE, option('o2')], 'readme'));
  const controlRun = await waitRun(p, await startDraw(p, (await scan(p, { folder: control.dir })).id, [typed('Slow first'), WHOLE, option('o2')], 'readme'));
  const ended = lateRun.choices.map((c: any) => Date.parse(c.endedAt));
  expect(ended[0], 'the first choice finished after the second').toBeGreaterThan(ended[1]);
  expect(ended[0], 'and after the third').toBeGreaterThan(ended[2]);
  expect(says(lines(await runEvents(p, lateRun.id), LATE_ID, 'overview'), /Fixing 1 problem/)).toBe(true);

  const lateDoc = await readJSON(join(late.dir, 'docs', 'architecture.archdraw.json'));
  const controlDoc = await readJSON(join(control.dir, 'docs', 'architecture.archdraw.json'));
  expect(lateDoc.choices.map((c: any) => c.id)).toEqual([LATE_ID, 'system', OPTION.o2.id]);
  const expected = (first: string) => ({
    [first]: ['overview:overview', 'readme:readme'],
    system: ['overview:system-overview', 'overview:zone-runtime-inside', 'readme:system-readme'],
    [OPTION.o2.id]: [`overview:${OPTION.o2.id}-overview`, `readme:${OPTION.o2.id}-readme`],
  });
  expect(Object.fromEntries(lateDoc.choices.map((c: any) => [c.id, viewIds(c)]))).toEqual(expected(LATE_ID));
  expect(Object.fromEntries(controlDoc.choices.map((c: any) => [c.id, viewIds(c)]))).toEqual(expected('slow-first'));
  lateDoc.choices.forEach((c: any, i: number) => expect(c.facts, `the same facts for choice ${i + 1}`).toEqual(controlDoc.choices[i].facts));
  const every = lateDoc.choices.flatMap(viewIds).map((v: string) => v.split(':')[1]);
  expect(new Set(every).size, 'no view id claimed twice').toBe(every.length);

  // The whole system: a map of a part and a card whose inside is a detail view; every fact is on the map or inside.
  const system = lateDoc.choices.find((c: any) => c.id === 'system');
  const [map, inside] = system.channels.overview.views;
  expect(map.nodes.map((n: any) => n.id).sort()).toEqual(['app', 'zone-runtime']);
  expect(map.nodes.find((n: any) => n.id === 'zone-runtime')).toMatchObject({ facts: [], detail: 'zone-runtime-inside', label: 'Agent runtime' });
  expect(map.nodes.some((n: any) => n.form === 'group'), 'nothing on the map is a group').toBe(false);
  expect(map.edges.map((e: any) => `${e.from}>${e.to}:${e.step}`)).toEqual(['app>zone-runtime:1']);
  expect(inside.nodes.map((n: any) => n.id).sort()).toEqual(['agent', 'store']);
  expect(inside.title).toBe('Agent runtime');
  expect(unshown(system)).toEqual([]);
  // A section keeps its complete overview in one view, the zone drawn as a group.
  const section = lateDoc.choices.find((c: any) => c.id === OPTION.o2.id);
  expect(section.channels.overview.views).toHaveLength(1);
  expect(section.channels.overview.views[0].nodes.find((n: any) => n.id === 'zone-runtime')).toMatchObject({ form: 'group' });
  expect(unshown(section)).toEqual([]);

  // Only the map has a part target (about nine); a detail view and the README have no count targets.
  const reportOf = async (data: Record<string, unknown>) => {
    const a = await p.post('/api/runs', { diagramId: lateRun.diagramId, instruction: 'Keep it as it is', engine: 'fixture', model: null, scope: { kind: 'view' }, ...data });
    expect(a.status, a.text).toBe(202);
    return (await waitRun(p, a.body.runId)).layoutReport;
  };
  expect((await reportOf({ choice: 'system', view: 'system-overview' })).targets).toEqual({ parts: 9, zones: null, connections: null });
  expect((await reportOf({ choice: 'system', view: 'zone-runtime-inside' })).targets).toEqual({ parts: null, zones: null, connections: null });
  expect((await reportOf({ choice: 'system', channel: 'readme', view: 'system-readme' })).targets).toEqual({ parts: null, zones: null, connections: null });
  // Must not happen: a run that changed nothing changing the file.
  expect((await readJSON(join(late.dir, 'docs', 'architecture.archdraw.json'))).choices).toEqual(lateDoc.choices);
  expect((await runRecord(p, lateRun.id)).status).toBe('succeeded');
});
