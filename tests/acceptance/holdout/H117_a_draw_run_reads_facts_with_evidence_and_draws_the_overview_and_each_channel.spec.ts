import { test, expect } from '@playwright/test';
import { basename, join } from 'node:path';
import { gitRepo, token, scanFolder, startDraw, finishRun, runEvents, listedDiagrams, samePath, sorted, exists, viewOf, partOf, factOf, outdatedOf, channelNames, type Doc3 } from './helpers';
import { getDocument, getRaw, SLUG } from './helpers-selections'; // a draw writes format 4: `getDocument` gives the choice in the shape this scenario was written in, `getRaw` the document

const MECHANISMS = ['model-call', 'tool-proposal', 'tool-check', 'tool-run', 'tool-result'];
const FOUR_WARNINGS = [
  'ghost: dropped the evidence fixture/ghost.ts: not found',
  'Dropped "ghost": no evidence left',
  'Dropped "r8": its component "ghost" was dropped',
  'Dropped "ghost-limit": its component "ghost" was dropped',
];
const CHANNELS = [
  { channel: 'linkedin', view: 'linkedin', format: 'feed', title: 'LinkedIn', progress: 'Drawing the LinkedIn post' },
  { channel: 'readme', view: 'readme', format: 'readme', title: 'README', progress: 'Drawing the README drawing' },
  { channel: 'presentation', view: 'presentation', format: 'slide', title: 'Presentation', progress: 'Drawing the presentation' },
] as const;

// READ-1/2/3: the fixture's read is always the same facts with evidence; code drops what the repository cannot back, draws
// the overview from the facts so that every fact is shown or held, and the chosen channel on top. STORY-1: the three
// channels are drawn from the same facts. The fixture answer (testing contract, Draw) is what each assertion repeats.
test('H117 [START-4, READ-1, READ-2, READ-3, STORY-1, #181, #182] a draw run reads the agent project into facts with checked evidence, drops what the files do not back, draws every fact in the overview and the chosen channel, and writes one new file', async ({ request }) => {
  test.setTimeout(60_000);
  const auth = await token(request);

  for (const chosen of CHANNELS) {
    const project = await gitRepo(`draw-${chosen.channel}`);
    const listedBefore = (await listedDiagrams(request)).length;
    const scan = await scanFolder(request, auth, project.dir);
    const runId = await startDraw(request, auth, scan.id, { kind: 'option', option: 'o1' }, chosen.channel);
    const run = await finishRun(request, runId, 'succeeded', 120_000);

    // The run record: where the file went, which channel and view it opened on, the report, everything added.
    const file = join(project.dir, 'docs', 'architecture.archdraw.json');
    expect(run).toMatchObject({ kind: 'draw', choice: SLUG.o1, channel: chosen.channel, view: chosen.view, status: 'succeeded', error: null, route: null });
    expect(run.choices.map((c: { id: string; kind: string; status: string }) => [c.id, c.kind, c.status])).toEqual([[SLUG.o1, 'flow', 'done']]); // a request with one `focus` is a list of one choice
    expect(samePath(run.path, file), run.path).toBe(true); expect(run.diagramId).toMatch(/^d_[a-z0-9]{6,}$/);
    expect(run.layoutReport).toMatchObject({ choice: SLUG.o1, channel: chosen.channel, view: chosen.view, format: chosen.format });
    expect(run.changes.added.length).toBeGreaterThan(0);
    for (const key of ['removed', 'changed', 'moved', 'edgesRemoved', 'edgesChanged']) expect(run.changes[key], key).toEqual([]);
    const listed = await listedDiagrams(request);
    expect(listed).toHaveLength(listedBefore + 1);
    expect(listed.find(d => d.id === run.diagramId)).toMatchObject({ title: basename(project.dir) });
    expect(samePath(listed.find(d => d.id === run.diagramId)!.path!, file)).toBe(true);

    // The events: three stages in order, with the contracted lines, then one `done` that repeats the result.
    const events = await runEvents(runId);
    const lines = events.filter(e => e.event === 'progress');
    const stageOf = (message: string) => lines.find(e => e.data.message === message)?.data.stage;
    expect(stageOf('Checking the facts'), 'the read').toBe('read'); expect(stageOf('Drawing the overview')).toBe('overview'); expect(stageOf(chosen.progress)).toBe('channel');
    const stages = lines.map(e => e.data.stage).filter(Boolean) as string[];
    expect(stages, 'stages never go back').toEqual([...stages].sort((a, b) => ['read', 'overview', 'channel'].indexOf(a) - ['read', 'overview', 'channel'].indexOf(b)));
    expect(new Set(stages)).toEqual(new Set(['read', 'overview', 'channel']));
    expect(events.filter(e => e.event === 'done')).toHaveLength(1);
    expect(events.at(-1)!.data).toMatchObject({ status: 'succeeded', diagramId: run.diagramId, channel: chosen.channel, view: chosen.view, route: null });
    expect(samePath(events.at(-1)!.data.path, file)).toBe(true);

    const stored = await getRaw(request, run.diagramId);
    expect(stored).toMatchObject({ schema: 'archdraw/diagram@4', title: basename(project.dir) });
    expect(stored.choices.map(c => [c.id, c.kind, c.title])).toEqual([[SLUG.o1, 'flow', 'How a request moves through the project']]);
    const doc: Doc3 = await getDocument(request, run.diagramId);
    expect(samePath(doc.source!.path, project.dir)).toBe(true);

    // READ-1/2: components, the mechanisms inside the agent, relations and a limit, each with evidence in the project's files.
    expect(sorted(doc.facts.components.map(f => f.id))).toEqual(sorted(['app', 'agent', ...MECHANISMS, 'store']));
    expect(factOf(doc, 'ghost'), 'a fact the files cannot back is dropped').toBeUndefined();
    expect(factOf(doc, 'agent')).toMatchObject({ label: 'Agent', kind: 'llm', sub: '', description: 'Agent as the test engine read it.', items: [], files: ['beta.ts'], evidence: [{ file: 'beta.ts', lines: [1, 1] }] });
    expect(factOf(doc, 'app')).toMatchObject({ label: 'App', kind: 'service', files: ['alpha.ts'] }); expect(factOf(doc, 'app')!.evidence![0].file).toBe('alpha.ts');
    expect(factOf(doc, 'store')).toMatchObject({ kind: 'data', files: ['alpha.ts'] });
    for (const f of doc.facts.components) {
      expect(f.evidence!.length, `${f.id} has evidence`).toBeGreaterThan(0);
      expect(f.files, `${f.id}: files are the evidence files, each once`).toEqual([...new Set(f.evidence!.map(e => e.file))]);
      expect(f.items, `${f.id}: mechanisms are facts, not items`).toEqual([]);
      expect(await exists(join(project.dir, f.evidence![0].file))).toBe(true);
    }
    for (const id of MECHANISMS) expect(factOf(doc, id)!.within, id).toBe('agent');
    for (const id of ['app', 'agent', 'store']) expect(factOf(doc, id)!.within ?? null, id).toBeNull();
    expect(factOf(doc, 'tool-check')).toMatchObject({ kind: 'gate', label: 'Tool check' }); // the check around execution is a gate
    expect(factOf(doc, 'tool-run')).toMatchObject({ kind: 'worker', label: 'Tool execution' });
    expect((doc.facts.relations ?? []).map(r => [r.id, r.from, r.to, r.label, r.style])).toEqual([
      ['r1', 'app', 'agent', 'asks', 'call'], ['r2', 'model-call', 'tool-proposal', '', 'call'], ['r3', 'tool-proposal', 'tool-check', '', 'call'],
      ['r4', 'tool-check', 'tool-run', '', 'call'], ['r5', 'tool-run', 'tool-result', '', 'call'], ['r6', 'tool-result', 'model-call', '', 'async'],
      ['r7', 'agent', 'store', 'keeps state', 'call']]);
    expect(doc.facts.limits).toEqual([{ id: 'turn-limit', on: 'agent', text: 'Stops after 12 turns', evidence: [{ file: 'beta.ts', lines: [1, 1] }] }]);
    // The four warnings of the evidence check, exactly, first and in this order.
    expect(doc.warnings!.slice(0, 4)).toEqual(FOUR_WARNINGS);

    // The overview draws the whole read: the agent holds its loop and its limit, and every fact is shown or held.
    const overview = viewOf(doc, 'overview')!;
    expect(overview).toMatchObject({ id: 'overview', title: 'Overview', caption: { title: basename(project.dir), lede: 'Drawn by the test engine.' } });
    expect(partOf(doc, 'overview', 'zone-runtime')).toMatchObject({ form: 'group', facts: [], label: 'Agent runtime' });
    expect(partOf(doc, 'overview', 'agent')).toMatchObject({ facts: ['agent'], form: 'panel', held: MECHANISMS, limits: ['turn-limit'], parent: 'zone-runtime' });
    expect(partOf(doc, 'overview', 'app')).toMatchObject({ facts: ['app'], parent: null });
    expect(partOf(doc, 'overview', 'store')).toMatchObject({ facts: ['store'] });
    const drawnIds = new Set(overview.nodes.flatMap(n => [...n.facts, ...(n.held ?? [])]));
    for (const f of doc.facts.components) expect(drawnIds.has(f.id), `the overview shows or holds ${f.id}`).toBe(true);
    expect(overview.edges.map(e => [e.from, e.to, e.relations])).toEqual(expect.arrayContaining([['app', 'agent', ['r1']], ['agent', 'store', ['r7']]]));
    expect(overview.edges.find(e => e.from === 'app' && e.to === 'agent')!.step).toBe(1);

    // The chosen channel is drawn; the others are not, and nothing is waiting to be redrawn.
    const view = viewOf(doc, chosen.channel)!;
    expect(view).toMatchObject({ id: chosen.view, title: chosen.title });
    for (const other of CHANNELS.filter(c => c.channel !== chosen.channel)) expect(doc.channels[other.channel]?.views ?? [], `${other.channel} is not drawn`).toEqual([]);
    for (const c of channelNames) expect(outdatedOf(doc, c), c).toEqual([]);
    if (chosen.channel === 'linkedin') {
      expect(sorted(view.nodes.map(n => n.id))).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
      for (const p of view.nodes) { expect(p.held ?? [], `${p.id}: no held items on LinkedIn`).toEqual([]); expect(p.limits ?? []).toEqual([]); }
    } else {
      expect(sorted(view.nodes.map(n => n.id))).toEqual(['agent', 'app', 'store']);
      expect(partOf(doc, chosen.channel, 'agent')).toMatchObject({ facts: ['agent'], form: 'panel', held: MECHANISMS, limits: ['turn-limit'] }); // the loop is visible (QUAL-3 in the README)
      expect(sorted(view.edges.map(e => `${e.from}>${e.to}`))).toEqual(['agent>store', 'app>agent']);
      expect(view.caption.lede).toBe('A detailed drawing made by the test engine.');
    }
    if (chosen.channel === 'presentation') {
      const steps = doc.channels.presentation!.steps!;
      expect(steps.map(s => s.id)).toEqual(['s1', 's2', 's3']); steps.forEach((s, i) => expect(s.text).toMatch(new RegExp(`^Step ${i + 1}: `)));
    } else expect(doc.channels.presentation?.steps ?? []).toEqual([]);

    // Must not happen: anything in the project but the one new file, or a second drawing written.
    expect((await project.git(['status', '--porcelain'])).trim().split(/\r?\n/)).toEqual(['?? docs/']);
    expect(await exists(join(project.dir, 'docs', 'architecture-2.archdraw.json'))).toBe(false);
  }
});
