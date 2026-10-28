import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  gitRepo, projectFiles, scanOnHome, optionCard, startedRun, rows, library, readJSON, viewOf, readImage, expectSamePath, exists, OPTION,
} from './helpers';

const product = useProduct();

// The first-run path: a developer pastes the path of their repository, scans it, ticks one section, chooses LinkedIn, draws it, opens
// the drawing when it is ready, and downloads the image from the share dialog.
test('H01 [START-4 SCAN-1 SCAN-2 SCAN-3 STORY-1 STORY-2 JOB-8 HOME-2 HOME-3 HOME-4 HOME-6 SHARE-1 SHARE-2 SAFE-4] a folder pasted on the home screen becomes a LinkedIn image downloaded from the share dialog @smoke', async ({ page }, info) => {
  const p = product();
  const project = await gitRepo('first-run', projectFiles, 'Holdout shop');
  const hosts = new Set<string>();
  page.on('request', r => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.host); });

  await scanOnHome(page, p, project.dir);
  // The card is built from the folder: its name, the kind of project, an entry point and the commit it was scanned at.
  await expect(page.getByTestId('scan-card-name')).toHaveText('Holdout shop');
  await expect(page.getByTestId('scan-card-type')).toHaveAttribute('data-type', 'agent');
  await expect(page.getByTestId('scan-card-entry').filter({ hasText: 'main.ts' })).toHaveCount(1);
  await expect(page.getByTestId('scan-card-commit')).toHaveText((await project.head()).slice(0, 7));
  await expect(page.getByTestId('start-steps').locator('[data-state="now"]')).toHaveText(/Focus/);

  // The choices: the whole system first, then the sections and the flows, then Something else; the option backed by a missing file is absent.
  await expect(page.getByTestId('focus-whole')).toHaveAttribute('data-kind', 'system');
  await expect(page.getByTestId('focus-sections').getByTestId('focus-option')).toHaveCount(2);
  await expect(page.getByTestId('focus-flows').getByTestId('focus-option')).toHaveCount(1);
  await expect(optionCard(page, 'o1')).toHaveAttribute('data-kind', 'flow');
  await expect(optionCard(page, 'o1').getByTestId('focus-option-files')).toContainText('alpha.ts');
  await expect(page.getByTestId('focus-list')).not.toContainText('A path that is not there');
  await expect(page.getByTestId('focus-typed')).toHaveAttribute('data-kind', 'custom');
  await expect(page.getByTestId('draw-start')).toBeDisabled();

  await optionCard(page, 'o2').click();
  await expect(page.getByTestId('focus-count')).toHaveText(/1/);
  await expect(page.getByTestId('draw-summary')).toHaveText(/1 drawing.*choose/i);
  await expect(page.getByTestId('draw-start'), 'no channel chosen yet').toBeDisabled();
  await page.getByTestId('channel-choice-linkedin').click();
  await expect(page.getByTestId('draw-summary')).toHaveText(/1 drawing.*LinkedIn/i);
  await expect(page.getByTestId('draw-start')).toHaveText(/Draw it/);

  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  expect(run.sent).toMatchObject({ kind: 'draw', choices: [{ kind: 'option', option: 'o2' }], channel: 'linkedin', engine: 'fixture' });
  await expect(page.getByTestId('start-steps').locator('[data-state="now"]')).toHaveText(/Draw/);
  await expect(page.getByTestId('draw-choice')).toHaveCount(1);
  await expect(page.getByTestId('draw-choice')).toHaveAttribute('data-choice', OPTION.o2.id);
  await expect(page.getByTestId('draw-stage')).toHaveCount(3);

  // It ends Ready with Open and a notice, and the screen stays where it is.
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('draw-ready')).toContainText(/Ready/);
  await expect(page.getByTestId('draw-ready')).toContainText(/LinkedIn/);
  await expect.poll(async () => (await rows(page))[0]?.stages.map(s => s.state)).toEqual(['done', 'done', 'done']);
  await expect(page.getByTestId('job-notice')).toBeVisible();
  await expect(page.getByTestId('job-notice')).toContainText(/Holdout shop/);
  await expect(page.getByTestId('editor'), 'nothing opens the editor but the user').toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/');

  // The drawing is a new file in the project, registered in the library; nothing the project tracked changed.
  const file = join(project.dir, 'docs', 'architecture.archdraw.json');
  expect(await exists(file)).toBe(true);
  const listed = (await library(p)).find(d => d.title === 'Holdout shop');
  await expectSamePath(listed?.path, file, 'the library lists the written file');
  expect((await project.git(['status', '--porcelain'])).trim()).toBe('?? docs/');
  const document = await readJSON(file);
  expect(document.schema).toBe('archdraw/diagram@4');
  expect(document.choices.map((c: any) => `${c.id}:${c.kind}`)).toEqual([`${OPTION.o2.id}:section`]);
  const post = viewOf(document, 'linkedin');
  expect(post.caption.title.length, 'a title').toBeGreaterThan(0);
  expect(post.caption.lede.length, 'one plain sentence').toBeGreaterThan(0);
  for (const node of post.nodes) expect(node.held ?? [], `no held items on ${node.id}`).toEqual([]);
  expect(viewOf(document, 'readme'), 'the other channel is not drawn').toBeUndefined();

  // Open: the editor on the LinkedIn channel of that choice.
  await page.getByTestId('draw-open').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'linkedin');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-choice', OPTION.o2.id);
  await expect(page.getByTestId('channel-tab-linkedin')).toHaveAttribute('aria-current', 'true');
  for (const node of post.nodes) await expect(page.getByTestId(`node-${node.id}`)).toBeVisible();

  // Share packages what the channel shows, at LinkedIn's size.
  await page.getByTestId('share-button').click();
  const dialog = page.getByTestId('share-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-size')).toHaveText(/1080\D+1350/);
  await expect(dialog.getByText(/simplify/i), 'share offers no simplifying').toHaveCount(0);
  const pngDownload = page.waitForEvent('download'); await page.getByTestId('download-png').click();
  const png = await pngDownload; const pngFile = info.outputPath('post.png'); await png.saveAs(pngFile);
  expect(png.suggestedFilename()).toBe('holdout-shop-linkedin-feed.png');
  const bytes = await readFile(pngFile);
  expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], 'twice the image size').toEqual([2160, 2700]);
  const svgDownload = page.waitForEvent('download'); await page.getByTestId('download-svg').click();
  const svg = await svgDownload; const svgFile = info.outputPath('post.svg'); await svg.saveAs(svgFile);
  expect(svg.suggestedFilename()).toBe('holdout-shop-linkedin-feed.svg');
  const image = await readImage(page, await readFile(svgFile, 'utf8'));
  expect(image.parsed).toBe(true);
  expect([image.width, image.height, image.format]).toEqual([1080, 1350, 'feed']);
  expect(image.forbidden, 'no foreignObject or script').toBe(false);
  expect(image.nodes.map(n => n.id).sort()).toEqual(post.nodes.map((n: any) => n.id).sort());
  expect(image.words.join(' ').toLowerCase(), 'no product mark').not.toContain('archdrawer');

  // Must not happen: the page reaching any host but the local server (no hosted service, no telemetry).
  expect([...hosts]).toEqual([`127.0.0.1:${p.port}`]);
});
