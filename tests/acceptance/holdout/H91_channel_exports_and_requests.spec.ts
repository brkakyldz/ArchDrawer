import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shop3, withLinkedIn, workspaceRaw, register, cli, svgInfo, exportOf, readDocument, persistedDoc, token, baseURL, drawn } from './helpers';

const UNKNOWN_CHANNEL = (name: string) => `Unknown channel "${name}"; use one of overview, linkedin, readme, presentation`;

// A channel names what an image, a Mermaid chart and a saved instruction are about: the command, the export URLs and the
// requests endpoint all take it, default to the overview, and refuse a channel or view that is not there.
test('H91 [FILE-2, START-5, SHARE-1] write an image and a chart of a named channel, and save an instruction for it, with the contracted defaults and refusals', async ({ page, request }) => {
  const doc = withLinkedIn(shop3('Channel Shop'));
  const { dir, file } = await workspaceRaw('channels', doc);
  const opened = await register(request, file);
  const stored = await readDocument(file);
  const shown = drawn(stored, 'linkedin');
  const postNodes = shown.nodes.map(n => n.id).sort(), postEdges = shown.edges.map(e => e.id!).sort();
  expect(postNodes).toEqual(['intake', 'ledger', 'visitor']);

  // The command: no channel is the overview, with the contracted file name and the wide LinkedIn size.
  const plain = await cli(['svg', file]); expect(plain.code, plain.stderr).toBe(0);
  const plainPath = join(dir, 'architecture-overview-linkedin.svg');
  expect(plain.stdout).toContain(plainPath);
  const plainImage = await svgInfo(page, await readFile(plainPath, 'utf8'));
  expect(plainImage).toMatchObject({ error: false, width: 1620, height: 1080, format: 'linkedin' });
  expect(plainImage.nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);

  // `--channel linkedin` draws that channel's own view: its parts, its connections, its drawn names.
  const feedPath = join(dir, 'architecture-linkedin-post-feed.svg');
  const feed = await cli(['svg', file, '--channel', 'linkedin', '--format', 'feed']); expect(feed.code, feed.stderr).toBe(0);
  expect(feed.stdout).toContain(feedPath);
  const feedText = await readFile(feedPath, 'utf8'), feedImage = await svgInfo(page, feedText);
  expect(feedImage).toMatchObject({ error: false, width: 1080, height: 1350, format: 'feed', forbidden: false });
  expect(feedImage.nodes.map(n => n.id).sort()).toEqual(postNodes); expect(feedImage.edges.map(e => e.id).sort()).toEqual(postEdges);
  expect(feedImage.text.join(' ')).toContain('Orders ledger'); expect(feedImage.text.join(' ')).not.toContain('Orders DB'); // the post's own name
  expect(feedImage.nodes.some(n => ['web', 'api', 'db'].includes(n.id))).toBe(false);
  const explicit = join(dir, 'explicit.svg');
  const named = await cli(['svg', file, '--channel', 'linkedin', '--view', 'linkedin-post', '--format', 'feed', '--out', explicit]); expect(named.code, named.stderr).toBe(0);
  expect(await readFile(explicit, 'utf8')).toBe(feedText); // The channel's first view is the default view.

  // Refusals: the exit code and the message depend on what was wrong.
  const wrongView = await cli(['svg', file, '--channel', 'linkedin', '--view', 'overview']);
  expect(wrongView.code).toBe(1); expect(wrongView.stderr).toContain('No view "overview" in the linkedin channel of'); expect(wrongView.stderr).toContain('views: linkedin-post');
  const empty = await cli(['svg', file, '--channel', 'readme']);
  expect(empty.code).toBe(1); expect(empty.stderr).toContain('The channel "readme" has no drawing in');
  const unknown = await cli(['svg', file, '--channel', 'board']);
  expect(unknown.code).toBe(2); expect(unknown.stderr).toContain(UNKNOWN_CHANNEL('board')); expect(unknown.stderr).toContain('Run "archdrawer --help" for the commands.');
  const missingValue = await cli(['svg', file, '--channel']); expect(missingValue.code).toBe(2);
  expect((await cli(['svg', file, '--channel', 'linkedin', '--format', 'poster'])).code).toBe(2);

  // The same through the export URLs.
  const defaulted = await exportOf(request, opened.id, 'svg'); expect(defaulted.status()).toBe(200);
  expect(defaulted.headers()['content-type']).toContain('image/svg+xml');
  const defaultedText = await defaulted.text();
  expect(await (await exportOf(request, opened.id, 'svg', 'channel=overview')).text()).toBe(defaultedText); // overview is the default channel
  expect((await svgInfo(page, defaultedText)).nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);
  const dark = await exportOf(request, opened.id, 'svg', 'channel=linkedin&format=feed&theme=dark'); expect(dark.status()).toBe(200);
  const darkImage = await svgInfo(page, await dark.text());
  expect(darkImage).toMatchObject({ width: 1080, height: 1350, theme: 'dark', format: 'feed' }); expect(darkImage.nodes.map(n => n.id).sort()).toEqual(postNodes);
  const square = await exportOf(request, opened.id, 'svg', 'channel=linkedin&view=linkedin-post&format=square'); expect(square.status()).toBe(200);
  expect(await svgInfo(page, await square.text())).toMatchObject({ width: 1080, height: 1080, format: 'square' });
  const some = await exportOf(request, opened.id, 'svg', 'channel=linkedin&parts=visitor,intake'); expect(some.status()).toBe(200);
  const someImage = await svgInfo(page, await some.text());
  expect(someImage.nodes.map(n => n.id).sort()).toEqual(['intake', 'visitor']); expect(someImage.edges.map(e => e.id)).toEqual(['visitor-intake']);
  for (const [query, message] of [
    ['channel=board', UNKNOWN_CHANNEL('board')], ['channel=readme', 'The channel "readme" has no drawing'],
    ['channel=presentation', 'The channel "presentation" has no drawing'], ['channel=linkedin&view=overview', 'Unknown view "overview"'],
    ['channel=linkedin&format=poster', 'Unknown format "poster"; use one of linkedin, readme, slide, square, feed'],
    ['channel=linkedin&parts=web', 'Unknown component "web" in the view "linkedin-post"'],
  ] as const) {
    const refused = await exportOf(request, opened.id, 'svg', query);
    expect(refused.status(), query).toBe(400); expect((await refused.json()).error, query).toBe(message);
  }
  const chart = await exportOf(request, opened.id, 'mmd', 'channel=linkedin'); expect(chart.status()).toBe(200);
  expect(chart.headers()['content-type']).toContain('text/plain');
  const chartText = await chart.text();
  expect(chartText.trimStart()).toMatch(/^flowchart LR/); expect(chartText).toContain('Orders ledger'); expect(chartText).not.toContain('Orders DB');
  expect(await (await exportOf(request, opened.id, 'mmd')).text()).toContain('Orders DB');
  expect((await exportOf(request, opened.id, 'mmd', 'channel=readme')).status()).toBe(400);
  expect((await exportOf(request, opened.id, 'mmd', 'channel=linkedin&view=overview')).status()).toBe(400);
  expect((await exportOf(request, 'd_nothere', 'svg', 'channel=linkedin')).status()).toBe(404);

  // Instructions saved for the next session name their channel and view; the default channel is the overview.
  const auth = await token(request);
  const save = async (data: Record<string, unknown>) => await request.post(`${baseURL()}/api/diagrams/${opened.id}/requests`, { headers: { 'X-Archdraw-Token': auth }, data });
  const forPost = await save({ channel: 'linkedin', view: 'linkedin-post', text: 'Make the lede shorter' });
  expect(forPost.status(), await forPost.text()).toBe(201); expect((await forPost.json()).id).toMatch(/^q\d+$/);
  const forDefault = await save({ view: 'overview', text: 'Add a cache' }); expect(forDefault.status()).toBe(201);
  await persistedDoc(file, d => (d.requests ?? []).length === 2);
  const requests = (await readDocument(file)).requests!;
  expect(requests[0]).toMatchObject({ text: 'Make the lede shorter', channel: 'linkedin', view: 'linkedin-post' });
  expect(requests[1]).toMatchObject({ text: 'Add a cache', channel: 'overview', view: 'overview' });
  expect(requests[0].id).not.toBe(requests[1].id); expect(Number.isFinite(Date.parse(requests[0].at))).toBe(true);
  const before = await readFile(file, 'utf8');
  for (const [data, expected] of [
    [{ channel: 'board', view: 'overview', text: 'x' }, /channel/i], [{ channel: 'linkedin', view: 'overview', text: 'x' }, /view/i],
    [{ channel: 'readme', view: 'overview', text: 'x' }, /readme|channel|view/i], [{ channel: 'linkedin', view: 'linkedin-post', text: '   ' }, /empty/i],
    [{ channel: 'linkedin', view: 'linkedin-post', text: 'x'.repeat(4001) }, /too long/i],
  ] as const) {
    const refused = await save(data);
    expect(refused.status(), JSON.stringify(data).slice(0, 80)).toBe(400); expect((await refused.json()).error).toMatch(expected);
  }
  expect(await readFile(file, 'utf8')).toBe(before); // A refused request is not saved.
  expect((await readDocument(file)).requests).toHaveLength(2);
});
