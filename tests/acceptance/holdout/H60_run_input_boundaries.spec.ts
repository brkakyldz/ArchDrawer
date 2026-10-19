import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawing, component, workspace, isolatedDrawing, postRun, startKind, finishRun, readDrawing } from './helpers';
import { terminalEvents, checkReport } from './helpers-v5';

test('H60 [SHR-9, SHR-10, DEP-6, ASK-10, PLT-2] reject bad post and simplify inputs before a run, then expose a valid simplify through GET and SSE', async ({ page, request }) => {
  const doc = drawing('Run boundary');
  doc.views.push({ id: 'detail', title: 'Detail', caption: { title: 'Detail', lede: '' }, nodes: [component('detail-node')], edges: [], texts: [] });
  const { file } = await workspace('h60', doc), server = await isolatedDrawing(page, request, file, '1000');
  try {
    const before = await readFile(file, 'utf8');
    const common = { diagramId: server.id, view: 'overview', engine: 'fixture', model: null };
    const invalid = [
      { kind: 'story' }, { kind: 9 }, { kind: 'post', format: 'square' }, { kind: 'post', format: 1080 },
      { kind: 'post', scope: { kind: 'all' } }, { kind: 'post', scope: { kind: 'parts', ids: ['web'] } },
      { kind: 'simplify', view: 'detail' }, { kind: 'simplify', scope: { kind: 'all' } },
      { kind: 'simplify', scope: { kind: 'parts', ids: ['web'] } }, { kind: 'simplify', format: 'unknown' },
      { kind: 'post', instruction: 7 }, { kind: 'simplify', instruction: {} },
      { kind: 'post', instruction: 'x'.repeat(4001) },
      { kind: 'post', revise: 'true' }, { kind: 'simplify', revise: 1 },
      { kind: 'post', model: 123 }, { kind: 'simplify', engine: 'missing-engine' },
      { kind: 'post', view: 'missing-view' },
    ];
    expect(invalid.length).toBeGreaterThan(0);
    for (const patch of invalid) {
      const response = await postRun(request, server.token, { ...common, ...patch }, server.base);
      expect(response.status(), JSON.stringify(patch)).toBe(400);
      const error = await response.json(); expect(error.error).toEqual(expect.any(String));
      expect(error.error.length).toBeGreaterThan(0); expect(error.runId).toBeUndefined();
      expect(await readFile(file, 'utf8')).toBe(before);
    }
    for (const kind of ['post', 'simplify']) {
      const unauthorised = await request.post(`${server.base}/api/runs`, { data: { ...common, kind } });
      expect(unauthorised.status()).toBe(403); expect(await readFile(file, 'utf8')).toBe(before);
    }
    const runId = await startKind(request, server.token, { ...common, kind: 'simplify' }, server.base);
    const collecting = terminalEvents(page, server.base, runId);
    const pending = await (await request.get(`${server.base}/api/runs/${runId}`)).json();
    expect(pending).toMatchObject({ id: runId, kind: 'simplify', status: 'running', changes: null, layoutReport: null });
    const events = await collecting;
    const final = await finishRun(request, runId, 'succeeded', 60_000, server.base);
    const stored = await readDrawing(file); checkReport(final.layoutReport, stored.views[0], 'readme');
    expect(final).toMatchObject({ kind: 'simplify', view: 'overview', diagramId: server.id, engine: 'fixture', model: null, error: null });
    const done = events.filter(e => e.event === 'done'); expect(done).toHaveLength(1);
    // GET retains progress emitted before this live subscription; SSE replay is not contracted.
    expect(final.progress).toEqual(expect.arrayContaining(['Reading the drawing', 'Reading the code', 'Updating the drawing']));
    const progress = events.filter(e => e.event === 'progress');
    expect(progress).toEqual(progress.map(() => ({ event: 'progress', data: expect.objectContaining({ message: expect.any(String) }) })));
    expect(done[0].data).toMatchObject({ view: final.view, status: final.status, changes: final.changes, layoutReport: final.layoutReport });
    const overview = stored.views[0].nodes[0], original = JSON.parse(before);
    expect(final.changes.added).toContain(overview.id); expect(final.changes.removed).toEqual([]);
    const actualIds = stored.views.flatMap(v => v.nodes.map(n => n.id));
    expect(actualIds).toEqual(expect.arrayContaining(original.views[0].nodes.map((n: { id: string }) => n.id)));
    expect(stored.views.find(v => v.id === 'detail')).toEqual(original.views[1]);
    const exportResponse = await request.get(`${server.base}/api/diagrams/${server.id}/export.svg?view=${final.view}&format=readme`);
    expect(exportResponse.status()).toBe(200); expect(await exportResponse.text()).toContain(overview.label);
  } finally { await server.close(); }
});
