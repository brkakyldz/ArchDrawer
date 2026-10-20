import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shop3, workspaceRaw, openDrawing, readDocument, finishRun, drawn, viewOf, partOf, outdatedOf, sorted, previewSVG, svgInfo, download, settledReport } from './helpers';
import { compareSVGs } from './helpers-svg-parity';

// With an engine (here the test engine), the LinkedIn tab designs the post: the fixture's story, written into the
// LinkedIn channel by the server, its parts pointing at the facts they show. Share then only packages the channel.
test('H100 [AI-1, SHARE-1, SHARE-2, FILE-2] the Design the post run on the LinkedIn tab draws the channel from the facts with the fixture engine, and Share only packages it for the LinkedIn feed', async ({ page, request }) => {
  const { dir, file } = await workspaceRaw('post-run', shop3('Post shop'));
  const opened = await openDrawing(page, request, file);
  const before = await readDocument(file);
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('channel-empty')).toContainText('The LinkedIn post is not drawn yet');
  await expect(page.getByTestId('design-post')).toBeVisible();
  await expect(page.getByTestId('linkedin-prepare')).toHaveCount(0); // an engine is there: no "prepared without AI" route

  const started = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId('design-post').click();
  const response = await started; expect(response.status()).toBe(202);
  const run = await finishRun(request, (await response.json()).runId, 'succeeded');
  expect(run).toMatchObject({ kind: 'post', channel: 'linkedin', view: 'linkedin', diagramId: opened.id });
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('node-intake')).toBeVisible();

  // The story is the fixture's; its parts point at the facts of the overview's parts at the same index, the rest at none.
  const doc = await readDocument(file);
  const post = viewOf(doc, 'linkedin')!;
  expect(post).toMatchObject({ id: 'linkedin', title: 'LinkedIn', caption: { title: 'How a request becomes a result', lede: 'A request enters the app, is checked, and produces a result.' } });
  expect(sorted(post.nodes.map(n => n.id))).toEqual(['approval', 'facts', 'intake', 'loop', 'request', 'result', 'zone-runtime']);
  expect(post.nodes.some(n => /-(li|linkedin)$/.test(n.id)), 'no id depends on an ending').toBe(false);
  const factsOf = (id: string) => partOf(doc, 'linkedin', id)!.facts;
  expect(factsOf('request')).toEqual(['web']); expect(factsOf('intake')).toEqual(['api']); expect(factsOf('loop')).toEqual(['db']);
  for (const id of ['result', 'facts', 'approval', 'zone-runtime']) expect(factsOf(id), id).toEqual([]);
  expect(partOf(doc, 'linkedin', 'loop')?.parent).toBe('zone-runtime'); expect(partOf(doc, 'linkedin', 'facts')?.parent).toBe('zone-runtime');
  const shown = drawn(doc, 'linkedin');
  expect(shown.nodes.map(n => [n.id, n.label]).sort()).toEqual([['approval', 'Approval'], ['facts', 'Stored facts'], ['intake', 'Request intake'], ['loop', 'Work loop'],
    ['request', 'Request'], ['result', 'Result'], ['zone-runtime', 'App runtime']]);
  expect(shown.nodes.find(n => n.id === 'intake')!.items).toEqual(['Validate input', 'Bind the scope']); // the story's own list, not the fact's
  expect(post.edges).toHaveLength(5); // the last two story connections became one two-way connection
  expect(post.edges.slice(0, 3).map(e => [e.id, e.relations ?? []])).toEqual([['request-intake', ['r1']], ['intake-loop', ['r2']], ['loop-result', []]]);
  const pair = shown.edges.find(e => [e.from, e.to].sort().join() === 'approval,result')!;
  expect(pair).toMatchObject({ both: true, label: 'review' });
  expect(doc.warnings).toHaveLength(1);
  await expect(page.getByTestId('warnings')).toBeVisible();
  // Must not happen: the post correcting a fact, or the overview or another channel changing.
  expect(doc.facts).toEqual(before.facts); expect(doc.channels.overview).toEqual(before.channels.overview);
  expect(outdatedOf(doc, 'linkedin')).toEqual([]); expect(outdatedOf(doc, 'overview')).toEqual([]);
  expect(doc.engine).toMatchObject({ id: 'fixture' });

  // Share packages this channel: the LinkedIn feed size, the channel's own view, its own starting switches.
  await page.getByTestId('share-button').click();
  const dialog = page.getByTestId('share-dialog'), preview = page.getByTestId('share-preview');
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toHaveAttribute('data-view', 'linkedin'); await expect(preview).toHaveAttribute('data-width', '1080'); await expect(preview).toHaveAttribute('data-height', '1350');
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  await page.getByTestId('share-advanced-toggle').click(); await expect(page.getByTestId('share-advanced')).toBeVisible();
  for (const id of ['title', 'lede', 'items', 'steps', 'labels', 'texts']) await expect(page.getByTestId(`show-${id}`), id).toBeChecked();
  await expect(page.getByTestId('show-legend')).not.toBeChecked();
  for (const id of ['design-post', 'linkedin-prepare', 'arrange-feed', 'explain-feed', 'share-caption-title', 'share-caption-lede'])
    await expect(dialog.getByTestId(id), `${id} left the share dialog`).toHaveCount(0);
  const markup = await previewSVG(page), image = await svgInfo(page, markup);
  expect(image).toMatchObject({ error: false, width: 1080, height: 1350, format: 'feed', forbidden: false });
  expect(image.nodes.map(n => n.id).sort()).toEqual(sorted(post.nodes.map(n => n.id)));
  const report = await settledReport(page);
  expect(report).toMatchObject({ view: 'linkedin', format: 'feed', parts: 6, zones: 1, connections: 5 });
  const svgPath = join(dir, 'post.svg'), downloaded = await download(page, 'download-svg', svgPath);
  expect(downloaded.suggestedFilename()).toBe('post-shop-linkedin-feed.svg');
  await compareSVGs(page, markup, await readFile(svgPath, 'utf8'), shown.edges);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);

  // On the overview tab the same dialog packages the overview, README-sized.
  await page.getByTestId('channel-tab-overview').click();
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true'); await expect(preview).toHaveAttribute('data-view', 'overview');
  await expect(preview).toHaveAttribute('data-width', '1600');
  expect(await readDocument(file)).toEqual(doc); // Looking at and downloading the images wrote nothing into the drawing.
});
