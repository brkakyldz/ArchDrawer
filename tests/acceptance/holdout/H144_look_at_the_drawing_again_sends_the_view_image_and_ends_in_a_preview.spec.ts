import { test, expect } from '@playwright/test';
import { shop3, withLinkedIn, workspaceRaw, openDrawing, readDocument, readDrawing, persisted, persistedDoc, viewOf, sorted, startedRun, sendInPanel, runDone, acceptPreview, openAiPanel,
  aiTurn, pngInfo, DEFAULT_IMAGE } from './helpers';

const POST_PARTS = ['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime'];

// LAYOUT-4 in the editor: `ai-look-again` renders the current view as the share image in the channel's default format, at 1x, as a
// PNG, and sends it with a `revise` run. With the fixture the answer on the overview is one part moved 40 px, and on LinkedIn the
// channel's story; either arrives as a preview (AI-3). The control is off while a run goes and on a channel with no drawing.
test('H144 [LAYOUT-4, AI-3, AI-2] Look at the drawing again sends the share image of the current view as a second look that ends in a preview, and is off during a run and on a channel with no drawing', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { file } = await workspaceRaw('look-again', withLinkedIn(shop3('Look again shop')));
  const posts: Record<string, any>[] = [];
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') posts.push(req.postDataJSON()); });
  await openDrawing(page, request, file);
  const baseline = await readDocument(file), baselineDrawing = await readDrawing(file);
  const web = baselineDrawing.views[0].nodes.find(n => n.id === 'web')!;
  const lookAgain = page.getByTestId('ai-look-again');
  await openAiPanel(page);
  await expect(lookAgain).toHaveText('Look at the drawing again'); await expect(lookAgain).toBeEnabled(); expect(posts).toEqual([]);

  // The overview: the request carries the view's PNG in the channel's default format at 1x, and no old `revise` flag.
  const overview = await startedRun(page, () => lookAgain.click());
  expect(overview.body).toMatchObject({ kind: 'revise', view: 'overview', engine: 'fixture' }); expect(overview.body.channel ?? 'overview').toBe('overview');
  expect(typeof overview.body.image).toBe('string'); expect(overview.body.image).not.toMatch(/^data:/); expect(overview.body).not.toHaveProperty('revise');
  expect([undefined, 'readme'], 'a revise names no format but its channel\'s default').toContain(overview.body.format);
  expect(pngInfo(overview.body.image)).toMatchObject({ png: true, ...DEFAULT_IMAGE.overview }); expect(pngInfo(overview.body.image).bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  const turn = aiTurn(page, overview.runId);
  await expect(turn.getByTestId('ai-turn-text')).toHaveText('Look at the drawing again'); await expect(turn.getByTestId('ai-turn-where')).toHaveText('Overview · This view');
  expect(await runDone(page, overview.runId)).toBe('preview');
  const record = await (await request.get(`/api/runs/${overview.runId}`)).json();
  expect(record).toMatchObject({ kind: 'revise', status: 'succeeded', route: null }); expect(record.progress[0]).toBe('Looking at the drawing');
  await expect(page.getByTestId('ai-summary')).toHaveText('1 part moved'); await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-moved', '1');
  await expect(page.getByTestId('ai-preview')).toContainText('The drawing was updated: 1 part moved'); await expect(page.getByTestId('ai-route'), 'a second look names no route').toHaveCount(0);
  await expect(page.getByTestId('node-web')).toHaveAttribute('data-changed', 'true'); await expect(page.getByTestId('node-api')).not.toHaveAttribute('data-changed', 'true');
  await expect(page.getByTestId('layout-report')).toBeVisible();
  await persisted(file, d => (d.views[0].nodes.find(n => n.id === 'web')?.x ?? 0) > web.x!);
  // Undo takes the move back, to the exact place, and saves it.
  await page.getByTestId('ai-undo').click();
  await persisted(file, d => { const back = d.views[0].nodes.find(n => n.id === 'web')!; return back.x === web.x && back.y === web.y; });
  await expect(turn).toHaveAttribute('data-state', 'undone'); await expect(page.getByTestId('ai-preview')).toHaveCount(0);

  // Off while a run goes: the button follows the run, and Cancel gives it back.
  const slow = await sendInPanel(page, 'rename Orders DB to Vault\n[fixture:slow]');
  await expect(page.getByTestId('ai-progress-line').filter({ hasText: 'Working 1/30' })).toBeVisible(); await expect(lookAgain).toBeDisabled();
  await page.getByTestId('ai-cancel').click(); expect(await runDone(page, slow.runId, 30_000)).toBe('cancelled'); await expect(lookAgain).toBeEnabled();
  await page.getByTestId('ai-input').fill('');

  // LinkedIn: the feed image (1080 x 1350), and the channel's story as the answer, which changes the post and arrives as a preview.
  await page.getByTestId('channel-tab-linkedin').click(); await openAiPanel(page);
  await expect(lookAgain).toBeEnabled();
  const post = await startedRun(page, () => lookAgain.click());
  expect(post.body).toMatchObject({ kind: 'revise', channel: 'linkedin', view: 'linkedin-post' }); expect(pngInfo(post.body.image)).toMatchObject({ png: true, ...DEFAULT_IMAGE.linkedin });
  expect([undefined, 'feed']).toContain(post.body.format);
  expect(await runDone(page, post.runId)).toBe('preview');
  await expect(aiTurn(page, post.runId).getByTestId('ai-turn-where')).toHaveText(/^LinkedIn · \S/); await expect(aiTurn(page, post.runId).getByTestId('ai-turn-text')).toHaveText('Look at the drawing again');
  await expect(page.getByTestId('ai-preview')).toBeVisible(); await expect(page.getByTestId('ai-route')).toHaveCount(0);
  await persistedDoc(file, d => sorted(viewOf(d, 'linkedin')!.nodes.map(n => n.id)).join() === POST_PARTS.join());
  // The editor went to the run's channel and view once, when the preview started: going to another channel is then free, the
  // preview is still there for the user to choose, and the editor does not pull the user back.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await page.getByTestId('channel-tab-overview').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'overview');
  await expect(page.getByTestId('ai-preview')).toBeVisible();
  await page.waitForTimeout(1000); // longer than any pull back would take
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'overview'); await expect(page.getByTestId('ai-preview')).toBeVisible();
  await acceptPreview(page);

  // A channel with no drawing has nothing to look at: the control is off on the README and the presentation.
  for (const channel of ['readme', 'presentation'] as const) {
    await page.getByTestId(`channel-tab-${channel}`).click(); await expect(page.getByTestId('channel-empty')).toBeVisible(); await openAiPanel(page);
    await expect(lookAgain, `no drawing on ${channel}`).toBeDisabled();
  }
  // Must not happen: a second look started where there was nothing to look at, a fact changed by it, or an image sent as a data URL.
  expect(posts.map(p => p.kind ?? 'refine')).toEqual(['revise', 'refine', 'revise']);
  for (const p of posts.filter(p => p.kind === 'revise')) expect(p.image.startsWith('data:')).toBe(false);
  expect((await readDocument(file)).facts, 'a second look changes no fact').toEqual(baseline.facts);
});
