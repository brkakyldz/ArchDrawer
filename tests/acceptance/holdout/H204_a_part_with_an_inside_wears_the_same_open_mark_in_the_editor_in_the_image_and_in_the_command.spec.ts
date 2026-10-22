import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { fact, part, cli, svgBoxes, exportOf } from './helpers';
import { doc4, choice4, workspace4, openFourChoices, svgOpenInfo, near, type Doc4 } from './helpers-selections';

// A drawing with a part of each form that has an inside: `card` (a, kind service), `compact` (b), a group (z), and one plain card (c).
function marksDoc(): Doc4 {
  const v = (id: string, title: string, nodes: ReturnType<typeof part>[]) => ({ id, title, caption: { title, lede: '' }, nodes, edges: [], texts: [] });
  return doc4('Marks shop', [choice4({
    facts: { components: [fact('a', { label: 'Alpha', kind: 'service' }), fact('b', { label: 'Beta', kind: 'service' }), fact('c', { label: 'Gamma', kind: 'service' }),
      fact('d', { label: 'Delta', kind: 'service' }), fact('e', { label: 'Epsilon', kind: 'service' }), fact('f', { label: 'Zeta', kind: 'service' })], relations: [] },
    channels: { overview: { showSteps: false, outdated: [], views: [
      v('marks-overview', 'Overview', [part('a', { detail: 'marks-a', x: 0, y: 0 }), part('b', { form: 'compact', detail: 'marks-b', x: 0, y: 200 }), part('c', { x: 400, y: 0 }),
        part('z', { facts: [], form: 'group', label: 'Zone', kind: 'service', description: 'A frame with an inside.', detail: 'marks-z', x: 400, y: 200 })]),
      v('marks-a', 'Alpha inside', [part('d', { x: 0, y: 0 })]), v('marks-b', 'Beta inside', [part('e', { x: 0, y: 0 })]), v('marks-z', 'Zone inside', [part('f', { x: 0, y: 0 })]),
    ] } } }, { id: 'marks', title: 'Marks', kind: 'section' })]);
}
type Box = { x: number; y: number; width: number; height: number };
// The circle of the open mark in the editor: the circle inside the element with class `open-mark` (or that element when it is a circle).
async function editorMark(page: Page, scope: string): Promise<Box | null> {
  return await page.getByTestId(scope).evaluate(el => {
    const mark = el.querySelector('[class~="open-mark"]'); if (!mark) return null;
    const circle = mark.matches('circle') ? mark : (mark.querySelector('circle') ?? mark);
    const b = circle.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
}
async function editorBox(page: Page, id: string): Promise<Box> {
  return await page.getByTestId(`node-${id}`).evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
}

// NAV-1 (drawing contract, *The open mark*): a part whose `detail` is set draws a filled circle 20 px across in the part's kind colour,
// holding the `layers` icon, 8 px inside the top-right corner of a card's body, 12 px inside the right end of a compact part and centred
// on its height, and at the right end of a group's header. It is the element with class `open-mark` in `node-<id>` (a group's in
// `node-head-<id>`) and in the image's `g[data-node-id]` (a group's in `<g data-group-head>`), which carries `data-open="true"`.
// The image and the command draw it as the editor does.
test('H204 [NAV-1 SHARE-1 START-5 #184] a part with an inside draws the same open mark in the editor, the image and the command: 20 px, 8 px inside a card\'s top-right corner, 12 px inside a compact part, in a group\'s header, and a part with no inside draws none', async ({ page, request }) => {
  test.setTimeout(240_000);
  const made = await workspace4('f4-marks', marksDoc());
  const opened = await openFourChoices(page, request, made.file);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', 'marks-overview');

  // The editor: the parts with an inside are open and draw the mark; the plain card does not.
  for (const id of ['a', 'b', 'z']) await expect(page.getByTestId(`node-${id}`)).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('node-c')).not.toHaveAttribute('data-open', 'true');
  expect(await editorMark(page, 'node-c'), 'a part with no inside draws no mark').toBeNull();
  const inEditor: Record<string, { w: number; right: number; top: number; middle: number }> = {};
  for (const [id, scope] of [['a', 'node-a'], ['b', 'node-b'], ['z', 'node-head-z']] as const) {
    const mark = await editorMark(page, scope); expect(mark, `${id}: the mark is in ${scope}`).not.toBeNull();
    const body = await editorBox(page, id), m = mark!;
    expect(Math.abs(m.width - m.height), `${id}: a circle`).toBeLessThan(0.6);
    inEditor[id] = { w: m.width / body.width, right: (body.x + body.width - (m.x + m.width)) / body.width, top: (m.y - body.y) / body.width, middle: (m.y + m.height / 2 - body.y) / body.width };
    await expect(page.getByTestId('node-inside').first()).toBeVisible();
  }
  // Card: 20 across, 8 in from the right and from the top, as parts of the 196 px card.
  expect(near(inEditor.a.w, 20 / 196, 0.012), `card mark width ${inEditor.a.w}`).toBe(true);
  expect(near(inEditor.a.right, 8 / 196, 0.012), `card mark from the right ${inEditor.a.right}`).toBe(true);
  expect(near(inEditor.a.top, 8 / 196, 0.012), `card mark from the top ${inEditor.a.top}`).toBe(true);
  // The editor's scale: a plain card is 196 px wide.
  const scale = (await editorBox(page, 'a')).width / 196;
  // Compact: 12 px from the right end, centred on the part's height (46 px).
  const compact = await editorBox(page, 'b');
  expect(near(compact.height, 46 * scale, 1.5), 'a compact part is 46 px tall').toBe(true);
  expect(near(inEditor.b.w * compact.width, 20 * scale, 1.2), 'compact mark is 20 across at the editor\'s scale').toBe(true);
  expect(near(inEditor.b.right * compact.width, 12 * scale, 1.5), 'compact mark is 12 from the right end').toBe(true);
  expect(near(inEditor.b.middle * compact.width, compact.height / 2, 1.5), 'compact mark is centred on the height').toBe(true);
  // Group: in the header (its top 46 px), centred on it, at the right end.
  const group = await editorBox(page, 'z');
  expect(near(inEditor.z.middle * group.width, 23 * scale, 3), 'the group mark is centred on the 46 px header').toBe(true);
  expect(inEditor.z.right * group.width, 'the group mark is at the right end').toBeLessThan(group.width * 0.15);

  // The image: the same marks, the same proportions, `data-open` on the part.
  const svg = await (await exportOf(request, opened.id, 'svg', 'view=marks-overview&format=readme')).text();
  const info = await svgOpenInfo(page, svg);
  expect(info.nodes.find(n => n.id === 'a')).toMatchObject({ open: 'true', marks: 1 }); expect(info.nodes.find(n => n.id === 'b')).toMatchObject({ open: 'true', marks: 1 });
  expect(info.nodes.find(n => n.id === 'c')).toMatchObject({ marks: 0 }); expect(info.nodes.find(n => n.id === 'c')!.open).not.toBe('true');
  expect(info.heads.find(h => h.id === 'z'), 'a group\'s mark is in its head').toMatchObject({ marks: 1 });
  expect(info.nodes.reduce((sum, n) => sum + n.marks, 0) + info.heads.reduce((sum, h) => sum + h.marks, 0), 'three marks and no more').toBe(3);
  const circleOf = (id: string) => `g[data-node-id="${id}"] [class~="open-mark"] circle, g[data-node-id="${id}"] circle[class~="open-mark"]`;
  const measure = async (text: string, id: string, markSelector: string) => {
    const [body] = await svgBoxes(page, text, `g[data-node-id="${id}"] rect`); const [mark] = await svgBoxes(page, text, markSelector);
    expect(body, `${id}: the part's box`).toBeTruthy(); expect(mark, `${id}: the mark`).toBeTruthy();
    return { body, mark, w: mark.width / body.width, right: (body.x + body.width - (mark.x + mark.width)) / body.width, top: (mark.y - body.y) / body.width, middle: (mark.y + mark.height / 2 - body.y) / body.width };
  };
  const a = await measure(svg, 'a', circleOf('a')), b = await measure(svg, 'b', circleOf('b'));
  expect(near(a.w, 20 / 196, 0.012), `image: card mark width ${a.w}`).toBe(true); expect(near(a.right, 8 / 196, 0.012), `image: card mark from the right ${a.right}`).toBe(true); expect(near(a.top, 8 / 196, 0.012), `image: card mark from the top ${a.top}`).toBe(true);
  expect(near(b.mark.width, 20 * (b.body.height / 46), 1.2), 'image: compact mark is 20 across at the part\'s scale').toBe(true);
  expect(near((b.body.x + b.body.width - (b.mark.x + b.mark.width)), 12 * (b.body.height / 46), 1.5), 'image: compact mark is 12 from the right end').toBe(true);
  expect(near(b.mark.y + b.mark.height / 2, b.body.y + b.body.height / 2, 1.5), 'image: compact mark is centred on the height').toBe(true);
  // Editor and image agree on the proportions.
  expect(near(a.w, inEditor.a.w, 0.012) && near(a.right, inEditor.a.right, 0.012) && near(a.top, inEditor.a.top, 0.012), 'card: the editor and the image draw the mark in the same place').toBe(true);
  const [zHead] = await svgBoxes(page, svg, `g[data-group-head="z"] [class~="open-mark"] circle, g[data-group-head="z"] circle[class~="open-mark"]`);
  const [zBody] = await svgBoxes(page, svg, 'g[data-node-id="z"] rect');
  expect(zHead, 'the group head draws the mark').toBeTruthy();
  expect(near(zHead.y + zHead.height / 2 - zBody.y, 23 * (zHead.width / 20), 2.5), 'image: the group mark is centred on the header').toBe(true);
  expect(zBody.x + zBody.width - (zHead.x + zHead.width), 'image: at the right end of the header').toBeLessThan(zBody.width * 0.15);

  // The command draws the image the server does, so the same marks.
  const out = join(made.dir, 'marks.svg'); const result = await cli(['svg', made.file, '--view', 'marks-overview', '--format', 'readme', '--out', out]);
  expect(result.code, result.stderr).toBe(0); expect(await readFile(out, 'utf8')).toBe(svg);
  expect((await svgOpenInfo(page, await readFile(out, 'utf8'))).nodes.filter(n => n.open === 'true').map(n => n.id).sort()).toEqual(info.nodes.filter(n => n.open === 'true').map(n => n.id).sort());
  // A detail view's own parts have none: an image of another view draws only what that view's parts have.
  const inside = await svgOpenInfo(page, await (await exportOf(request, opened.id, 'svg', 'view=marks-a&format=readme')).text());
  expect(inside.nodes.reduce((sum, n) => sum + n.marks, 0)).toBe(0); expect(inside.heads).toEqual([]);
});
