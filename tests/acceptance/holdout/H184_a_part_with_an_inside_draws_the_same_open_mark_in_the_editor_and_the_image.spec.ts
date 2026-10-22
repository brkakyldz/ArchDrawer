import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fact, part, workspaceRaw, openDrawing, box, cli, previewSVG, type View3 } from './helpers';
import { sketch, fullDetail, nodeRect, zoomFactor, cardSize, sizeIs, imageOf, inspectImage, openShare, closeShare, type ImageInfo } from './helpers-drawing';

interface Offsets { width: number; height: number; right: number; top: number; centreY: number }

// NAV-1 (#184): a part whose `detail` is set draws the open mark - a 20 px circle 8 px inside the top-right corner of a card or panel, 12 px inside the right
// end of a compact part and centred on its height, at the right end of a group header - the same in the editor and in every export. Navigating is not asserted here.
test('H184 [NAV-1 SHARE-1 LOOK-2 #184] a part with an inside draws the same open mark in the editor and in the exported image, on a card, a compact part, a panel and a group, and the mark changes no size', async ({ page, request }) => {
  test.setTimeout(240_000);
  const doc = sketch('Open marks', [
    { id: 'svc', kind: 'service', label: 'Service part', sub: 'sub line', detail: 'svc-inside', x: 0, y: 0 },
    { id: 'cmp', kind: 'service', form: 'compact', label: 'Compact part', sub: 'sub line', detail: 'cmp-inside', x: 320, y: 0 },
    { id: 'pnl', kind: 'service', form: 'panel', label: 'Panel part', sub: 'sub line', items: ['Row'], detail: 'pnl-inside', x: 640, y: 0 },
    { id: 'zone', form: 'group', label: 'Zone part', sub: 'zone line', detail: 'zone-inside', x: 0, y: 260 },
    { id: 'zc', label: 'Zone child', sub: 'sub line', parent: 'zone', x: 20, y: 320 },
    { id: 'plain', kind: 'service', label: 'Plain part', sub: 'sub line', x: 640, y: 260 },
  ]);
  ['svc', 'cmp', 'pnl', 'zone'].forEach((name, n) => {
    doc.facts.components.push(fact(`in-${n}`, { label: `Inside ${name}` }));
    const view: View3 = { id: `${name}-inside`, title: `Inside ${name}`, caption: { title: `Inside ${name}`, lede: '' }, nodes: [part(`in-${n}`, { facts: [`in-${n}`], x: 0, y: 0 })], edges: [], texts: [] };
    doc.channels.overview.views!.push(view);
  });
  const { dir, file } = await workspaceRaw('open-marks', doc), opened = await openDrawing(page, request, file);
  await fullDetail(page);
  const withInside = ['svc', 'cmp', 'pnl', 'zone'];

  // The editor: data-open on the four, none on the plain part; node-inside is the mark, 20 px, at the contracted place.
  for (const id of withInside) await expect(page.getByTestId(`node-${id}`), id).toHaveAttribute('data-open', 'true');
  expect(await page.getByTestId('node-plain').getAttribute('data-open'), 'a part with no inside is not open').not.toBe('true');
  await expect(page.getByTestId('node-plain').getByTestId('node-inside')).toHaveCount(0);
  const editorMark = async (id: string): Promise<Offsets> => {
    const host = id === 'zone' ? page.getByTestId('node-head-zone') : page.getByTestId(`node-${id}`);
    await expect(host.getByTestId('node-inside'), `${id} draws its mark`).toHaveCount(1);
    const m = await box(host.getByTestId('node-inside')), b = await nodeRect(page, id), z = await zoomFactor(page);
    return { width: m.width / z, height: m.height / z, right: (b.x + b.width - (m.x + m.width)) / z, top: (m.y - b.y) / z, centreY: (m.y + m.height / 2 - b.y) / z };
  };
  const inEditor: Record<string, Offsets> = {};
  for (const id of withInside) inEditor[id] = await editorMark(id);
  const near = (actual: number, wanted: number, what: string, tolerance = 1) => expect(Math.abs(actual - wanted), `${what}: ${actual} vs ${wanted}`).toBeLessThanOrEqual(tolerance);
  for (const id of withInside) { near(inEditor[id].width, 20, `editor ${id} width`); near(inEditor[id].height, 20, `editor ${id} height`); }
  for (const id of ['svc', 'pnl']) { near(inEditor[id].right, 8, `editor ${id} right inset`); near(inEditor[id].top, 8, `editor ${id} top inset`); }
  near(inEditor.cmp.right, 12, 'editor compact right inset'); near(inEditor.cmp.centreY, 46 / 2, 'editor compact centred on its height');
  near(inEditor.zone.centreY, 46 / 2, 'editor group mark centred on its 46 px header');
  // It is focusable and named (ui contract): a button, in the tab order, `Open <label>`.
  for (const label of ['Service part', 'Compact part', 'Panel part', 'Zone part']) {
    const button = page.getByRole('button', { name: `Open ${label}`, exact: true });
    await expect(button, label).toHaveCount(1); expect(await button.getAttribute('tabindex')).toBe('0');
  }
  await expect(page.getByRole('button', { name: 'Open Plain part', exact: true })).toHaveCount(0);
  // The mark changes no size: the card is the plain card, the same as the part with no inside.
  sizeIs(await (async () => { const z = await zoomFactor(page), b = await nodeRect(page, 'svc'); return { width: b.width / z, height: b.height / z }; })(), cardSize('card'), 'card with a mark');
  sizeIs(await (async () => { const z = await zoomFactor(page), b = await nodeRect(page, 'pnl'); return { width: b.width / z, height: b.height / z }; })(), cardSize('card'), 'panel with a mark');
  expect((await nodeRect(page, 'svc')).height).toBeCloseTo((await nodeRect(page, 'plain')).height, 0);

  // The image, three ways: the server, the command and the share preview. The same marks at the same offsets.
  const out = join(dir, 'marks.svg'), written = await cli(['svg', file, '--format', 'readme', '--out', out]); expect(written.code, written.stderr).toBe(0);
  await openShare(page, 'format-readme'); const preview = await previewSVG(page); await closeShare(page);
  const sources: [string, string][] = [['export.svg', await imageOf(request, opened.id, 'channel=overview&view=overview&format=readme')], ['svg command', await readFile(out, 'utf8')], ['share preview', preview]];
  for (const [what, svg] of sources) {
    const image: ImageInfo = await inspectImage(page, svg), at = (id: string) => image.nodes.find(n => n.id === id)!;
    for (const id of withInside) expect(at(id).open, `${what}: ${id} is open`).toBe('true');
    expect(at('plain').open, `${what}: the plain part is not open`).not.toBe('true'); expect(at('plain').openMark, `${what}: no mark on the plain part`).toBeNull();
    const svcBox = at('svc').box!, scale = (svcBox.right - svcBox.left) / 196;
    const mark = (id: string): Offsets => { const m = at(id).openMark!; expect(m, `${what}: ${id} draws one mark`).toBeTruthy();
      return { width: m.width / scale, height: m.height / scale, right: m.right / scale, top: m.top / scale, centreY: m.centreY / scale }; };
    for (const id of ['svc', 'cmp', 'pnl']) { near(mark(id).width, 20, `${what}: ${id} width`, 0.6); near(mark(id).height, 20, `${what}: ${id} height`, 0.6); expect(mark(id).width, 'not the old 14 px mark').not.toBeCloseTo(14, 0); }
    for (const id of ['svc', 'pnl']) { near(mark(id).right, 8, `${what}: ${id} right inset`, 0.6); near(mark(id).top, 8, `${what}: ${id} top inset`, 0.6); }
    near(mark('cmp').right, 12, `${what}: compact right inset`, 0.6); near(mark('cmp').centreY, (at('cmp').box!.bottom - at('cmp').box!.top) / scale / 2, `${what}: compact centred`, 0.6);
    // A group's mark is in its head, not on its frame; the head holds exactly one.
    expect(image.heads.find(h => h.id === 'zone')!.openMark, `${what}: the group's head draws the mark`).toBe(true);
    expect(at('zone').openMark, `${what}: the frame draws none`).toBeNull();
    // Sizes: the mark changes nothing.
    expect({ width: (svcBox.right - svcBox.left) / scale, height: (svcBox.bottom - svcBox.top) / scale }, `${what}: the card`).toEqual(cardSize('card'));
    near((at('plain').box!.bottom - at('plain').box!.top) / scale, 108, `${what}: the plain part`, 0.6);
    // Editor and image agree on where the mark sits.
    for (const id of ['svc', 'cmp', 'pnl']) { near(inEditor[id].right, mark(id).right, `${what} vs editor: ${id} right`, 1); near(inEditor[id].top, mark(id).top, `${what} vs editor: ${id} top`, 1); }
  }

  // Must not happen: the file gaining anything because of a mark, the editor-only marks in the image.
  const raw = await readFile(file, 'utf8');
  expect(raw).not.toMatch(/open-mark|"open"\s*:/);
  for (const [what, svg] of sources) expect(svg, `${what} carries no editor-only mark`).not.toMatch(/data-lifted|data-drop-target|drag-guide/);
});
