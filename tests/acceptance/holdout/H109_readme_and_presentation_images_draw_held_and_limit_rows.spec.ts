import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agent3, withReadme, withPresentation, workspaceRaw, register, exportOf, svgInfo, cli, partOf, readDocument } from './helpers';

// A panel's height is `24 + 22 + (sub ? 17 : 0) + (k ? 10 + 26k + 4(k - 1) : 0)` for k rows, and every held mechanism,
// shown item and limit is a row (diagram contract, Geometry and What a channel draws). The agent below has no sub-line.
const panelHeight = (rows: number) => 24 + 22 + (rows ? 10 + 26 * rows + 4 * (rows - 1) : 0);

test('H109 [FILE-2, STORY-3, STORY-5, SHARE-1] the README and presentation images of a file draw the held mechanisms and the limit as rows of the panel, count them in its height, and never draw a mechanism as a part of its own', async ({ page, request }) => {
  const { dir, file } = await workspaceRaw('rows', withPresentation(withReadme(agent3('Rows agent'))));
  const opened = await register(request, file), bytes = await readFile(file, 'utf8');
  const rows = ['Model call', 'Tool check', 'Stops after 12 turns'];
  const agentOf = (image: Awaited<ReturnType<typeof svgInfo>>) => image.nodes.find(n => n.id === 'agent')!;

  // The README channel's image: three parts, the agent a panel with two mechanism rows and one limit row, in that order.
  const readme = await exportOf(request, opened.id, 'svg', 'channel=readme&format=readme');
  expect(readme.status(), await readme.text()).toBe(200); expect(readme.headers()['content-type']).toContain('image/svg+xml');
  const readmeImage = await svgInfo(page, await readme.text());
  expect(readmeImage).toMatchObject({ error: false, width: 1600, height: 900, format: 'readme', forbidden: false });
  expect(readmeImage.nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']);
  const agent = agentOf(readmeImage), at = rows.map(row => agent.text.indexOf(row));
  expect(agent.text).toContain('Agent'); expect(at.every(i => i >= 0), `rows drawn: ${agent.text.join(' | ')}`).toBe(true);
  expect(at, 'mechanisms first, then the limit').toEqual([...at].sort((a, b) => a - b));
  expect(agent.height).toBe(panelHeight(3)); expect(agent.width).toBeGreaterThanOrEqual(184); expect(agent.width).toBeLessThanOrEqual(320);
  expect(readmeImage.nodes.find(n => n.id === 'app')!.text.join(' ')).not.toContain('Model call'); // another part shows none of them
  expect(readmeImage.nodes.find(n => n.id === 'app')).toMatchObject({ width: 196, height: 108 });

  // The presentation channel's image draws the same panel.
  const slide = await exportOf(request, opened.id, 'svg', 'channel=presentation&format=slide');
  expect(slide.status(), await slide.text()).toBe(200);
  const slideImage = await svgInfo(page, await slide.text());
  expect(slideImage).toMatchObject({ error: false, width: 1920, height: 1080, format: 'slide', forbidden: false });
  expect(slideImage.nodes.map(n => n.id).sort()).toEqual(['agent', 'app', 'store']);
  for (const row of rows) expect(agentOf(slideImage).text).toContain(row);
  expect(agentOf(slideImage).height).toBe(panelHeight(3));
  // So does the overview, which holds the same mechanisms; the command writes the same presentation image the server serves.
  const overview = await svgInfo(page, await (await exportOf(request, opened.id, 'svg', 'format=readme')).text());
  expect(agentOf(overview).height).toBe(panelHeight(3)); for (const row of rows) expect(agentOf(overview).text).toContain(row);
  const written = await cli(['svg', file, '--channel', 'presentation', '--format', 'slide']);
  expect(written.code, written.stderr).toBe(0);
  const outPath = join(dir, 'architecture-presentation-slide.svg'); expect(written.stdout).toContain(outPath);
  const fromCommand = await svgInfo(page, await readFile(outPath, 'utf8'));
  expect(fromCommand.nodes.map(n => [n.id, n.width, n.height, n.text])).toEqual(slideImage.nodes.map(n => [n.id, n.width, n.height, n.text]));

  // One part alone keeps its rows; a mechanism is a row, not a part of the view, so it cannot be asked for.
  const only = await svgInfo(page, await (await exportOf(request, opened.id, 'svg', 'channel=readme&format=readme&parts=agent')).text());
  expect(only.nodes.map(n => n.id)).toEqual(['agent']); for (const row of rows) expect(only.nodes[0].text).toContain(row);
  const mechanism = await exportOf(request, opened.id, 'svg', 'channel=readme&parts=model-call');
  expect(mechanism.status()).toBe(400); expect((await mechanism.json()).error).toBe('Unknown component "model-call" in the view "readme"');

  // Without the limit row the panel is one row shorter, and a channel with no view is still refused.
  const lean = withReadme(agent3('Lean agent'));
  partOf(lean, 'overview', 'agent')!.limits = []; partOf(lean, 'readme', 'agent')!.limits = [];
  const leanFile = await workspaceRaw('rows-lean', lean), leanOpened = await register(request, leanFile.file);
  const leanImage = await svgInfo(page, await (await exportOf(request, leanOpened.id, 'svg', 'channel=readme&format=readme')).text());
  expect(agentOf(leanImage).height).toBe(panelHeight(2)); expect(agentOf(leanImage).text).not.toContain('Stops after 12 turns');
  expect(panelHeight(3) - panelHeight(2)).toBe(30);
  const noSlide = await exportOf(request, leanOpened.id, 'svg', 'channel=presentation');
  expect(noSlide.status()).toBe(400); expect((await noSlide.json()).error).toBe('The channel "presentation" has no drawing');
  const dark = await exportOf(request, opened.id, 'svg', 'channel=readme&format=square&theme=dark');
  expect(await svgInfo(page, await dark.text())).toMatchObject({ width: 1080, height: 1080, theme: 'dark', format: 'square' });

  // Must not happen: an image changing the drawing, or saying anything of the product.
  expect(await readFile(file, 'utf8')).toBe(bytes); expect((await readDocument(file)).facts.limits).toHaveLength(1);
  expect((await readme.text()).toLowerCase()).not.toContain('archdrawer');
});
