import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agent3, withReadme, withPresentation, workspaceRaw, openDrawing, exportOf, svgInfo, cli, partOf, callout } from './helpers';
import { readChoice, cardSize } from './helpers-drawing';

// ADR 0014: no part draws a held mechanism, a shown item or a limit, on the canvas or in any export. A panel is drawn exactly like a card
// of its kind; the rows stay in the file and are listed in the part's callout. (Until ADR 0014 this scenario counted them as rows.)
const ROWS = ['Model call', 'Tool check', 'Stops after 12 turns'];

test('H109 [FILE-2 STORY-3 STORY-5 SHARE-1 LOOK-3 #177] the README and presentation images of a file draw the agent as a plain card of its kind and no row, the rows still sit in the file and in the callout, the mechanism is never a part of its own, and the limit is not drawn', async ({ page, request }) => {
  const { dir, file } = await workspaceRaw('rows', withPresentation(withReadme(agent3('Rows agent'))));
  const opened = await openDrawing(page, request, file), bytes = await readFile(file, 'utf8');
  const agentOf = (image: Awaited<ReturnType<typeof svgInfo>>) => image.nodes.find(n => n.id === 'agent')!;
  const plain = (image: Awaited<ReturnType<typeof svgInfo>>, what: string) => {
    // The agent is a panel of kind llm: the card of an `agent` shape (196 x 108); app is a client (a `window`, 196 x 108); store is a data store (196 x 124).
    expect([agentOf(image).width, agentOf(image).height], `${what}: agent`).toEqual([cardSize('agent').width, cardSize('agent').height]);
    expect([image.nodes.find(n => n.id === 'app')!.width, image.nodes.find(n => n.id === 'app')!.height], `${what}: app`).toEqual([196, 108]);
    expect([image.nodes.find(n => n.id === 'store')!.width, image.nodes.find(n => n.id === 'store')!.height], `${what}: store`).toEqual([cardSize('store').width, cardSize('store').height]);
    expect(agentOf(image).text.join(' '), `${what}: the agent draws its name`).toContain('Agent');
    for (const row of ROWS) expect(image.text.join(' '), `${what}: ${row} is not drawn anywhere`).not.toContain(row);
  };

  // The README channel's image: three parts, the agent a plain card, and no row of the panel anywhere in the image.
  const readme = await exportOf(request, opened.id, 'svg', 'channel=readme&format=readme');
  expect(readme.status(), await readme.text()).toBe(200); expect(readme.headers()['content-type']).toContain('image/svg+xml');
  const readmeMarkup = await readme.text(), readmeImage = await svgInfo(page, readmeMarkup);
  expect(readmeImage).toMatchObject({ error: false, width: 1600, height: 900, format: 'readme', forbidden: false });
  expect(readmeImage.nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']);
  plain(readmeImage, 'README');

  // The presentation channel's image and the overview's draw the same card; the command writes the same presentation image the server serves.
  const slide = await exportOf(request, opened.id, 'svg', 'channel=presentation&format=slide');
  expect(slide.status(), await slide.text()).toBe(200);
  const slideImage = await svgInfo(page, await slide.text());
  expect(slideImage).toMatchObject({ error: false, width: 1920, height: 1080, format: 'slide', forbidden: false });
  expect(slideImage.nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']); plain(slideImage, 'slide');
  plain(await svgInfo(page, await (await exportOf(request, opened.id, 'svg', 'format=readme')).text()), 'overview');
  const written = await cli(['svg', file, '--channel', 'presentation', '--format', 'slide']);
  expect(written.code, written.stderr).toBe(0);
  const outPath = join(dir, 'architecture-presentation-slide.svg'); expect(written.stdout).toContain(outPath);
  const fromCommand = await svgInfo(page, await readFile(outPath, 'utf8'));
  expect(fromCommand.nodes.map(n => [n.id, n.width, n.height, n.text])).toEqual(slideImage.nodes.map(n => [n.id, n.width, n.height, n.text]));

  // One part alone is the same card; a mechanism is a row of the file, not a part of the view, so it cannot be asked for.
  const only = await svgInfo(page, await (await exportOf(request, opened.id, 'svg', 'channel=readme&format=readme&parts=agent')).text());
  expect(only.nodes.map(n => n.id)).toEqual(['agent']); expect([only.nodes[0].width, only.nodes[0].height]).toEqual([cardSize('agent').width, cardSize('agent').height]);
  for (const row of ROWS) expect(only.text.join(' ')).not.toContain(row);
  const mechanism = await exportOf(request, opened.id, 'svg', 'channel=readme&parts=model-call');
  expect(mechanism.status()).toBe(400); expect((await mechanism.json()).error).toBe('Unknown component "model-call" in the view "readme"');

  // The rows are still in the file: held mechanisms and the limit, in the README's part as in the overview's.
  const stored = await readChoice(file);
  expect(partOf(stored, 'readme', 'agent')).toMatchObject({ held: ['model-call', 'tool-check'], limits: ['turn-limit'] });
  expect(stored.facts.limits).toHaveLength(1);
  // ... and in the callout, which is the only place they show: the editor's README tab draws none of them on the canvas.
  await page.getByTestId('channel-tab-readme').click(); await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'readme');
  await expect(page.getByTestId('node-agent')).toBeVisible();
  await expect(page.getByTestId('node-agent').getByTestId('node-item')).toHaveCount(0);
  for (const row of ROWS) await expect(page.getByTestId('node-agent')).not.toContainText(row);
  const agentCallout = await callout(page, 'agent'), rows = agentCallout.getByTestId('callout-items').getByTestId('callout-item');
  await expect(rows).toHaveCount(3);
  await expect(rows).toContainText(ROWS);
  expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('data-row')))).toEqual(['held', 'held', 'limit']);
  await page.getByTestId('callout-close').click();

  // Without the limit the card is just as big: rows never change a size. A channel with no view is still refused.
  const lean = withReadme(agent3('Lean agent'));
  partOf(lean, 'overview', 'agent')!.limits = []; partOf(lean, 'readme', 'agent')!.limits = [];
  const leanFile = await workspaceRaw('rows-lean', lean), leanOpened = await openDrawing(page, request, leanFile.file);
  const leanImage = await svgInfo(page, await (await exportOf(request, leanOpened.id, 'svg', 'channel=readme&format=readme')).text());
  expect([agentOf(leanImage).width, agentOf(leanImage).height]).toEqual([agentOf(readmeImage).width, agentOf(readmeImage).height]);
  expect(leanImage.text.join(' ')).not.toContain('Stops after 12 turns');
  const noSlide = await exportOf(request, leanOpened.id, 'svg', 'channel=presentation');
  expect(noSlide.status()).toBe(400); expect((await noSlide.json()).error).toBe('The channel "presentation" has no drawing');
  const dark = await exportOf(request, opened.id, 'svg', 'channel=readme&format=square&theme=dark');
  expect(await svgInfo(page, await dark.text())).toMatchObject({ width: 1080, height: 1080, theme: 'dark', format: 'square' });

  // Must not happen: an image changing the drawing, a row or a limit drawn, or an image saying anything of the product.
  expect(await readFile(file, 'utf8')).toBe(bytes);
  expect(readmeMarkup.toLowerCase()).not.toContain('archdrawer');
  expect(readmeMarkup).not.toContain('Stops after 12 turns');
});
