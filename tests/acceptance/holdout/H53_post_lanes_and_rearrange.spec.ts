import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, workspace, openDrawing, readDrawing, startKind, finishRun, postViewOf, labelled, persisted, svgInfo, download, drag } from './helpers';
import { noUnrelatedOverlap, postSwitches, postImage, checkReadability } from './helpers-v5';
import { drawnNodeBoxes } from './helpers-v9';

test('H53 [DEP-5, LAY-5, SHR-1, SHR-3, SHR-10, EDT-6] switch post orientation and re-arrange lanes without another engine call or changed forms', async ({ page, request }) => {
  const { dir, file } = await workspace('h53', drawing('Incident response'));
  const opened = await openDrawing(page, request, file), baseline = await readDrawing(file);
  const run = await startKind(request, opened.token, { diagramId: opened.id, view: 'overview', kind: 'post', format: 'feed', engine: 'fixture', model: null });
  await finishRun(request, run, 'succeeded');
  await page.reload();
  let post = postViewOf(await readDrawing(file), 'overview');
  await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${post.id}`).click();
  let calls = 0; page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') calls++; });
  await page.getByTestId('share-button').click(); await postSwitches(page);
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await expect(page.getByTestId('share-size')).toHaveText('1080 × 1350');
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  const checkPlacement = async (state: string) => {
    const boxes = await drawnNodeBoxes(page.getByTestId('share-preview'));
    // LAY-5: "Stored positions shall otherwise stay unchanged"; check placement only before a drag or after relayout.
    try { noUnrelatedOverlap(post, boxes); }
    catch (cause) { throw new Error(`H53 preview SVG image-px; ${state}; drawn node rectangles=${JSON.stringify(boxes)}; ${String(cause)}`); }
  };
  const find = async (label: string) => {
    const boxes = await drawnNodeBoxes(page.getByTestId('share-preview'));
    const found = boxes.find(b => b.nodeId === labelled(post, label).id); expect(found).toBeTruthy(); return found!;
  };
  const requestBox = await find('Request'), intakeBox = await find('Request intake'), runtime = await find('App runtime'), result = await find('Result');
  expect(requestBox.x).toBeLessThan(intakeBox.x);
  expect(result.y).toBeGreaterThan(requestBox.y); // Four outer units: the fourth turns back in the second band.
  expect(result.x).toBeGreaterThanOrEqual(requestBox.x);
  const facts = await find('Stored facts'), loop = await find('Work loop'), approval = await find('Approval');
  expect(intakeBox.x).toBeLessThan(loop.x); // ADR 0014: the member takes the outer spine cell.
  expect(facts.y).toBeGreaterThan(loop.y); expect(approval.y).toBeLessThan(result.y);
  expect(facts.x).toBeGreaterThanOrEqual(runtime.x); expect(facts.x + facts.width).toBeLessThanOrEqual(runtime.x + runtime.width);
  expect(facts.y + facts.height).toBeLessThanOrEqual(runtime.y + runtime.height);
  // diagram-v2 reserves the drawn zone box; a rect in its clipPath is not that box.
  await checkPlacement('fresh fixture post in feed, no manual edit');
  await checkReadability(page, 1080, 552);
  const beforeSwitch = await readFile(file, 'utf8');
  await page.getByTestId('format-linkedin').click();
  await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080');
  await expect(page.getByTestId('linkedin-flow')).toBeVisible();
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  const wide = await Promise.all(['Request', 'Request intake', 'Work loop', 'Result'].map(find));
  for (let i = 1; i < wide.length; i++) expect(wide[i].x).toBeGreaterThan(wide[i - 1].x);
  await checkPlacement('switched feed to linkedin, no manual edit');
  expect(await readFile(file, 'utf8')).toBe(beforeSwitch); expect(calls).toBe(0);
  const wideFile = join(dir, 'wide.svg'); await download(page, 'download-svg', wideFile);
  const wideSVG = await readFile(wideFile, 'utf8');
  expect(await svgInfo(page, wideSVG)).toMatchObject({ width: 1620, height: 1080, format: 'linkedin' });
  await postImage(page, wideSVG, post); await checkReadability(page, 1620, 552);
  // Keep the manual move for the Re-arrange/undo journey, after the generated-layout checks.
  await page.getByTestId('share-close').click();
  const intake = labelled(post, 'Request intake');
  await drag(page, page.getByTestId(`node-${intake.id}`), -72, -40);
  await persisted(file, d => labelled(postViewOf(d, 'overview'), 'Request intake').x !== intake.x);
  const moved = postViewOf(await readDrawing(file), 'overview');
  expect(labelled(moved, 'Request intake').parent).toBe(intake.parent);
  await page.getByTestId('share-button').click(); await postSwitches(page);
  await page.getByTestId('format-linkedin').click();
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', post.id);
  await expect(page.getByTestId('share-size')).toHaveText('1620 × 1080');
  await page.getByTestId('arrange-feed').click();
  await persisted(file, d => labelled(postViewOf(d, 'overview'), 'Request intake').x !== labelled(moved, 'Request intake').x);
  post = postViewOf(await readDrawing(file), 'overview');
  await checkPlacement('Re-arrange in linkedin after intake drag (-72,-40 screen-px)');
  const previewBoxes = await drawnNodeBoxes(page.getByTestId('share-preview'));
  const reference = previewBoxes.find(b => b.nodeId === labelled(post, 'Request').id)!;
  const origin = post.nodes.find(n => n.id === reference.nodeId)!, scale = reference.width / reference.localWidth;
  expect(scale).toBeGreaterThan(0);
  for (const box of previewBoxes) {
    const node = post.nodes.find(n => n.id === box.nodeId)!;
    const evidence = `H53 saved placement vs preview with fit removed; ${JSON.stringify({ node, box, origin, reference, scale })}`;
    expect(Math.abs((box.x - reference.x) / scale - (node.x! - origin.x!)), evidence).toBeLessThanOrEqual(0.3);
    expect(Math.abs((box.y - reference.y) / scale - (node.y! - origin.y!)), evidence).toBeLessThanOrEqual(0.3);
    expect(Math.abs(box.height / scale - box.localHeight), evidence).toBeLessThanOrEqual(0.3);
  }
  noUnrelatedOverlap(post, previewBoxes.map(box => {
    const node = post.nodes.find(n => n.id === box.nodeId)!;
    return { ...box, x: node.x!, y: node.y!, width: box.localWidth, height: box.localHeight };
  }));
  const committed = ['Request', 'Request intake', 'Work loop', 'Result'].map(label => labelled(post, label));
  expect(committed).toHaveLength(4);
  for (const node of post.nodes) {
    expect(Number.isFinite(node.x)).toBe(true); expect(Number.isFinite(node.y)).toBe(true);
  }
  for (let i = 1; i < committed.length; i++) expect(committed[i].x!).toBeGreaterThan(committed[i - 1].x!);
  expect(labelled(post, 'Stored facts').y!).toBeGreaterThan(labelled(post, 'Work loop').y!);
  expect(labelled(post, 'Approval').y!).toBeLessThan(labelled(post, 'Result').y!);
  expect(labelled(post, 'Stored facts').parent).toBe(labelled(post, 'App runtime').id);
  expect(labelled(post, 'Work loop').parent).toBe(labelled(post, 'App runtime').id);
  const editorial = (v: typeof post) => v.nodes.map(({ x, y, ...n }) => n);
  expect(editorial(post)).toEqual(editorial(moved)); expect(post.edges).toEqual(moved.edges);
  expect((await readDrawing(file)).views[0]).toEqual(baseline.views[0]); expect(calls).toBe(0);
  await page.getByTestId('share-close').click(); await page.getByTestId('tool-undo').click();
  await persisted(file, d => JSON.stringify(postViewOf(d, 'overview')) === JSON.stringify(moved));
  expect((await readDrawing(file)).views[0]).toEqual(baseline.views[0]);
});
