import { test, expect } from '@playwright/test';
import { drawing, workspace, isolatedDrawing, readStoredRaw, readDocument, readDrawing, startKind, finishRun, outsideWrite } from './helpers';

// Moved from H24. Before it saves, a run checks that the stored `updatedAt` is still the one it started from; otherwise it fails with
// `The drawing changed while the instruction ran.` and the outside edit stays (api contract, *Lifecycle*). The run is a plain refine on a
// server of its own whose fixture steps are 750 ms: after its `Reading the code` line the engine call still has `Updating the drawing`
// and one more step to go (testing contract, *The fixture engine*), about 1.5 s in which the session writes the file.
test('H253 [AI-1 FILE-1 FILE-2 #182] a session that writes the drawing while an instruction runs makes the run fail, nothing of the run is written and the session edit stays', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspace('stale-run', drawing('Stale shop'));
  const server = await isolatedDrawing(page, request, file, '750');
  try {
    // `open` stored the file as `@4` with its one choice `system`; the session below writes that choice back in the `@3` shape it knows.
    const stored = await readStoredRaw(file);
    expect(stored.schema).toBe('archdraw/diagram@4'); expect(stored.choices.map((c: { id: string }) => c.id)).toEqual(['system']);
    const baseline = await readDrawing(file);
    const raced = await startKind(request, server.token, { diagramId: server.id, view: 'overview', instruction: 'add Stale part', engine: 'fixture', model: null }, server.base);
    const progress = async (): Promise<string[]> => (await (await request.get(`${server.base}/api/runs/${raced}`)).json()).progress ?? [];
    await expect.poll(async () => (await progress()).includes('Reading the code'), { timeout: 15_000, intervals: [100] }).toBe(true);
    // The session writes the stored file itself (read as it is stored, written back as it is stored).
    const external = await readDocument(file); external.title = 'Session owned title'; external.updatedAt = '2099-10-13T10:00:00.000Z';
    await outsideWrite(file, external);
    const raceResult = await finishRun(request, raced, 'failed', 20_000, server.base); expect(raceResult.error).toBe('The drawing changed while the instruction ran.');
    const changed = await readDrawing(file); expect(changed.title).toBe('Session owned title'); expect(changed.views).toEqual(baseline.views);
    expect(changed.views[0].nodes.some(n => n.label === 'Stale part')).toBe(false);
  } finally { await server.close(); }
});
