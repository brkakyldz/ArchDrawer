import { test, expect } from '@playwright/test';
import { agent3, workspaceRaw, openDrawing, outsideWrite, fact, part, viewOf, partOf, outdatedOf, sorted, channelNames, callout,
  previewSVG, svgInfo, type Channel, type Doc3 } from './helpers';
import { readChoice, persistedChoice, cardSize } from './helpers-drawing';

const MECHANISMS = ['model-call', 'tool-check'];
const ROWS = ['Model call', 'Tool check', 'Stops after 12 turns'];

// A session writes the drawing in the shape it knows: the stored choice, as an `archdraw/diagram@3` file (the server converts it).
async function sessionDoc(file: string): Promise<Doc3> { return { ...(await readChoice(file)), schema: 'archdraw/diagram@3' }; }

// STORY-1/3: the README channel is chosen on its own tab and drawn from the facts alone, as one undoable step; the part that
// holds the mechanisms and the limit is a panel drawn like a card, and its rows are listed in its callout, not drawn (ADR 0014).
// When a fact it does not draw yet appears, the tab is marked and the stage offers Redraw it or Keep as it is, each one undoable step.
test('H124 [STORY-1 STORY-3 STORY-5 FILE-3 SHARE-2 AI-3 LOOK-3 #177] Draw it on the README tab draws the README from the facts as one undo step, with the held mechanisms and the limit listed in the callout and drawn nowhere; a reworded limit it shows marks nothing, a new limit or a new fact marks it, and Redraw it or Keep as it is clears the mark in one undoable step', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { file } = await workspaceRaw('readme-draw', agent3('Readme agent'));
  const posts: any[] = [];
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/runs') { try { posts.push(JSON.parse(req.postData() ?? 'null')); } catch { /* not json */ } } });
  await openDrawing(page, request, file);
  const before = await readChoice(file);
  const tab = (channel: Channel) => page.getByTestId(`channel-tab-${channel}`), empty = page.getByTestId('channel-empty');
  // The agent's callout lists its rows: held mechanisms first, then the limit.
  const agentRows = async () => {
    const rows = (await callout(page, 'agent')).getByTestId('callout-item');
    return await rows.evaluateAll(all => all.map(row => ({ row: row.getAttribute('data-row'), text: (row.textContent ?? '').replace(/\s+/g, ' ').trim() })));
  };

  // Nothing is drawn: the stage says so and offers to draw it with the engine; choosing the tab starts no run.
  await tab('readme').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'readme');
  await expect(empty).toContainText('The README drawing is not drawn yet');
  await expect(page.getByTestId('channel-draw')).toContainText('Draw it'); await expect(page.getByTestId('channel-prepare')).toHaveCount(0); // an engine is there
  expect(posts, 'choosing a channel starts no run').toEqual([]);

  // Draw it: a story run from the facts alone.
  await page.getByTestId('channel-draw').click();
  await persistedChoice(file, d => (d.channels.readme?.views ?? []).length === 1, 60_000);
  await expect(page.getByTestId('node-agent')).toBeVisible({ timeout: 15_000 }); await expect(empty).toHaveCount(0);
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ kind: 'story', channel: 'readme', readCode: false });
  await expect(page).toHaveURL(/channel=readme/); await expect(tab('readme')).toHaveAttribute('aria-current', 'true');
  const drawn = await readChoice(file), view = viewOf(drawn, 'readme')!;
  expect(view).toMatchObject({ id: 'readme', title: 'README', caption: { title: viewOf(before)!.caption.title, lede: 'A detailed drawing made by the test engine.' } });
  expect(sorted(view.nodes.map(n => n.id))).toEqual(['agent', 'app', 'store']);
  expect(partOf(drawn, 'readme', 'agent')).toMatchObject({ facts: ['agent'], form: 'panel', held: MECHANISMS, limits: ['turn-limit'] });
  expect(partOf(drawn, 'readme', 'app')).toMatchObject({ facts: ['app'] });
  expect(sorted(view.edges.map(e => `${e.from}>${e.to}:${(e.relations ?? []).join()}`))).toEqual(['agent>store:r2', 'app>agent:r1']);
  expect(drawn.channels.presentation?.steps ?? []).toEqual([]);
  // The rows are not drawn: the part has no row and no text of them; they are listed in its callout, the mechanisms first, then the limit.
  for (const row of ROWS) await expect(page.getByTestId('node-agent'), `${row} is not drawn`).not.toContainText(row);
  await expect(page.getByTestId('node-agent').getByTestId('node-item')).toHaveCount(0);
  expect(await agentRows()).toEqual([{ row: 'held', text: expect.stringContaining('Model call') }, { row: 'held', text: expect.stringContaining('Tool check') },
    { row: 'limit', text: expect.stringContaining('Stops after 12 turns') }]);
  await page.keyboard.press('Escape');
  // Must not happen: a fact or the overview changing, or a mark appearing, because a README was drawn.
  expect(drawn.facts).toEqual(before.facts); expect(drawn.channels.overview).toEqual(before.channels.overview);
  for (const channel of channelNames) expect(outdatedOf(drawn, channel), channel).toEqual([]);

  // From 0.4 the drawing arrives as a preview; kept, it is one undo step that takes the whole drawing away, and redo brings it back.
  await expect(page.getByTestId('ai-preview')).toBeVisible(); await page.getByTestId('ai-accept').click(); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await page.getByTestId('tool-undo').click();
  await persistedChoice(file, d => (d.channels.readme?.views ?? []).length === 0);
  await expect(empty).toContainText('The README drawing is not drawn yet');
  await page.getByTestId('tool-redo').click();
  await persistedChoice(file, d => (d.channels.readme?.views ?? []).length === 1);
  expect(viewOf(await readChoice(file), 'readme')).toEqual(view);

  // Share packages this channel for a README: its size, its own view; the image draws no row and the panel is the size of a card of its kind.
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('format-readme')).toHaveAttribute('aria-pressed', 'true');
  const preview = page.getByTestId('share-preview');
  await expect(preview).toHaveAttribute('data-view', 'readme'); await expect(preview).toHaveAttribute('data-width', '1600'); await expect(preview).toHaveAttribute('data-height', '900');
  const image = await svgInfo(page, await previewSVG(page));
  expect(image.nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']);
  const imageAgent = image.nodes.find(n => n.id === 'agent')!;
  for (const row of ROWS) expect(imageAgent.text.join(' '), `${row} is not in the image`).not.toContain(row);
  expect({ width: imageAgent.width, height: imageAgent.height }, 'the panel is a card of its kind').toEqual(cardSize('agent'));
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).toHaveCount(0);

  // A limit the README shows, reworded in a session: the README shows it directly, so nothing is marked. A new limit on a fact
  // the README shows, which it does not show, marks it with that limit's id.
  await tab('overview').click();
  const reworded = await sessionDoc(file);
  reworded.facts.limits![0].text = 'Stops after 8 turns'; reworded.updatedAt = '2098-01-01T00:00:00.000Z';
  await outsideWrite(file, reworded);
  await expect.poll(async () => (await agentRows()).map(r => r.text).join('|'), { timeout: 8000 }).toContain('Stops after 8 turns');
  await page.keyboard.press('Escape');
  for (const channel of channelNames) expect(outdatedOf(await readChoice(file), channel), `${channel} after the limit was reworded`).toEqual([]);
  const limited = await sessionDoc(file);
  limited.facts.limits!.push({ id: 'retry-limit', on: 'agent', text: 'Retries a failed call once', evidence: [{ file: 'src/api.ts', lines: [1, 1] }] });
  partOf(limited, 'overview', 'agent')!.limits!.push('retry-limit'); limited.updatedAt = '2098-06-01T00:00:00.000Z';
  await outsideWrite(file, limited);
  await persistedChoice(file, d => outdatedOf(d, 'readme').includes('retry-limit'));
  expect(outdatedOf(await readChoice(file), 'readme')).toEqual(['retry-limit']); expect(outdatedOf(await readChoice(file), 'overview')).toEqual([]);
  await tab('readme').click(); await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);
  await page.getByTestId('channel-keep').click();
  await persistedChoice(file, d => outdatedOf(d, 'readme').length === 0); await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
  await tab('overview').click();

  // A session adds a component the README does not draw: the overview shows it, the README is marked.
  const grown = await sessionDoc(file);
  grown.facts.components.push(fact('cache', { label: 'Cache', kind: 'data', description: 'Keeps recent answers.' }));
  viewOf(grown)!.nodes.push(part('cache', { place: { row: 2, col: 0 } })); grown.updatedAt = '2099-01-01T00:00:00.000Z';
  await outsideWrite(file, grown);
  await expect(page.getByTestId('node-cache')).toBeVisible({ timeout: 8000 });
  await persistedChoice(file, d => outdatedOf(d, 'readme').includes('cache'));
  expect(outdatedOf(await readChoice(file), 'readme')).toEqual(['cache']); expect(outdatedOf(await readChoice(file), 'overview')).toEqual([]);
  await expect(tab('readme')).toHaveAttribute('data-outdated', '1'); await expect(page.getByTestId('channel-outdated-readme')).toHaveAccessibleName(/Needs update: 1 change/);
  await tab('readme').click();
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/); await expect(page.getByTestId('channel-outdated')).toContainText(/in the facts since this was drawn/);
  await expect(page.getByTestId('channel-keep')).toBeVisible(); await expect(page.getByTestId('channel-redraw')).toBeVisible();
  await expect(page.getByTestId('node-cache')).toHaveCount(0); // the README is shown as it was drawn

  // Keep as it is: the mark goes as one undo step and the drawing stays.
  const marked = await readChoice(file);
  await page.getByTestId('channel-keep').click();
  await persistedChoice(file, d => outdatedOf(d, 'readme').length === 0);
  await expect(page.getByTestId('channel-outdated')).toHaveCount(0); await expect(tab('readme')).not.toHaveAttribute('data-outdated', /.*/);
  expect(viewOf(await readChoice(file), 'readme')).toEqual(viewOf(marked, 'readme'));
  await page.getByTestId('tool-undo').click();
  await persistedChoice(file, d => outdatedOf(d, 'readme').join() === 'cache');
  await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);

  // Redraw it: a story run from the facts, the new component drawn, the mark gone, one undo step back to the old README.
  await page.getByTestId('channel-redraw').click();
  await persistedChoice(file, d => !!partOf(d, 'readme', 'cache') && outdatedOf(d, 'readme').length === 0, 60_000);
  expect(posts.at(-1)).toMatchObject({ kind: 'story', channel: 'readme', readCode: false });
  await expect(page.getByTestId('node-cache')).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId('channel-outdated')).toHaveCount(0);
  const redrawn = await readChoice(file);
  expect(viewOf(redrawn, 'readme')!.id).toBe('readme'); expect(sorted(viewOf(redrawn, 'readme')!.nodes.map(n => n.id))).toEqual(['agent', 'app', 'cache', 'store']);
  expect(redrawn.facts, 'redrawing a channel changes no fact').toEqual(marked.facts);
  expect(sorted(redrawn.facts.components.map(f => f.id))).toEqual(sorted(['app', 'agent', 'model-call', 'tool-check', 'store', 'cache']));
  await expect(page.getByTestId('ai-preview')).toBeVisible(); await page.getByTestId('ai-accept').click(); await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  await page.getByTestId('tool-undo').click();
  await persistedChoice(file, d => !partOf(d, 'readme', 'cache') && outdatedOf(d, 'readme').join() === 'cache');
  await expect(page.getByTestId('node-cache')).toHaveCount(0); await expect(page.getByTestId('channel-outdated')).toContainText(/1 change/);
  // Must not happen: the other channels marked or redrawn by it.
  expect(outdatedOf(await readChoice(file), 'overview')).toEqual([]); expect(outdatedOf(await readChoice(file), 'linkedin')).toEqual([]);
});
