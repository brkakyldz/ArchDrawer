import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { drawingRepo, doc, choice, comp, rel, part, link, view, openDrawing, exportSvg, readImage, drawn, box, overlap } from './helpers';

const product = useProduct();

function drawing() {
  const users = ['u1', 'u2', 'u3', 'u4'];
  return doc('Calm lines', [choice('system', 'The whole system', 'system', {
    components: [
      comp('db', 'Shared store', 'data'), comp('w', 'Writer', 'service'), ...users.map(u => comp(u, `User ${u}`, 'service')), comp('x', 'Mailer', 'external'),
      comp('t', 'Target', 'service'), comp('t1', 'Left one', 'client'), comp('t2', 'Left two', 'client'),
    ],
    relations: [
      ...users.map((u, i) => rel(`r${i + 1}`, u, 'db')), rel('r5', 'w', 'db', { label: 'writes' }), rel('r6', 'u1', 'x', { label: 'sends mail' }),
      rel('r7', 't1', 't'), rel('r8', 't2', 't'),
    ],
  }, [view('overview', 'Overview', [
    part('db', { x: 560, y: 360 }), part('w', { x: 560, y: 64 }),
    part('u1', { x: 64, y: 64 }), part('u2', { x: 64, y: 360 }), part('u3', { x: 1040, y: 64 }), part('u4', { x: 1040, y: 360 }),
    part('x', { x: 64, y: -240 }),
    part('t', { x: 1040, y: 760 }), part('t1', { x: 64, y: 700 }), part('t2', { x: 64, y: 860 }),
  ], [
    ...users.map((u, i) => link(u, 'db', [`r${i + 1}`], null, { id: `${u}-db` })), link('w', 'db', ['r5'], 1, { id: 'w-db' }),
    link('u1', 'x', ['r6'], null, { id: 'u1-x' }), link('t1', 't', ['r7'], null, { id: 't1-t' }), link('t2', 't', ['r8'], null, { id: 't2-t' }),
  ])])]);
}

// A user reading a busy drawing: lines are one calm colour until a part is hovered or a line selected; the numbered line keeps its colours;
// the store four parts use is marked "used by 5" and its plain lines show only while it is hovered, moving nothing; two lines that arrive at
// the target from the same side share a trunk; labels stay off the parts. The image draws the same.
test('H24 [LOOK-4 LAYOUT-5 LAYOUT-3] connections are neutral until in focus, a part many parts use is marked and shows its lines only on hover, and lines arriving from one side share a trunk, in the editor and the image', async ({ page }) => {
  const p = product();
  const { file } = await drawingRepo('calm', drawing());
  const id = await openDrawing(page, p, file);
  await page.getByTestId('zoom-fit').click();
  const edge = (e: string) => page.getByTestId(`edge-${e}`);

  // At rest: neutral, except the numbered line.
  await expect(edge('u1-x')).toHaveAttribute('data-tone', 'neutral');
  await expect(edge('w-db')).toHaveAttribute('data-tone', 'kind');
  await expect(edge('w-db')).not.toHaveAttribute('data-hidden', 'true');
  // Hovering a part puts its lines in focus, in its kind colours; leaving it calms them again.
  await page.getByTestId('node-x').hover();
  await expect(edge('u1-x')).toHaveAttribute('data-focus', 'true');
  await expect(edge('u1-x')).toHaveAttribute('data-tone', 'kind');
  await page.mouse.move(5, 5);
  await expect(edge('u1-x')).toHaveAttribute('data-tone', 'neutral');
  // A label sits off every part.
  const label = page.getByTestId('edge-label-u1-x');
  if (await label.count()) {
    const lb = await box(label);
    for (const n of ['u1', 'x', 'w', 'db']) {
      const nb = await box(page.getByTestId(`node-${n}`));
      expect(overlap({ left: lb.x, right: lb.x + lb.width, top: lb.y, bottom: lb.y + lb.height }, { left: nb.x, right: nb.x + nb.width, top: nb.y, bottom: nb.y + nb.height }), `label over ${n}`).toBe(false);
    }
  }

  // The hub: marked with its users, its plain lines hidden until it is hovered, and showing them moves nothing.
  const usedBy = page.getByTestId('node-db').getByTestId('node-used-by');
  await expect(usedBy).toHaveAttribute('data-count', '5');
  await expect(usedBy).toHaveText(/used by 5/);
  for (const u of ['u1', 'u2', 'u3', 'u4']) await expect(edge(`${u}-db`)).toHaveAttribute('data-hidden', 'true');
  const before = await drawn(page.getByTestId('canvas'), 'w');
  await page.getByTestId('node-db').hover();
  for (const u of ['u1', 'u2', 'u3', 'u4']) {
    await expect(edge(`${u}-db`)).not.toHaveAttribute('data-hidden', 'true');
    await expect(edge(`${u}-db`)).toHaveAttribute('data-focus', 'true');
  }
  const during = await drawn(page.getByTestId('canvas'), 'w');
  expect(during.nodes, 'showing the hidden lines moves no part').toEqual(before.nodes);
  for (const e of ['w-db', 'u1-x', 't1-t', 't2-t']) expect(during.edges[e].d, `showing them moves no other line: ${e}`).toBe(before.edges[e].d);
  await page.mouse.move(5, 5);
  await expect(edge('u2-db')).toHaveAttribute('data-hidden', 'true');

  // The two lines from the left arrive at the target in one trunk.
  const trunk = page.locator('[data-testid="trunk"][data-part="t"]');
  await expect(trunk).toHaveCount(1);
  await expect(trunk).toHaveAttribute('data-side', 'l');
  await expect(trunk).toHaveAttribute('data-edges', 't1-t t2-t');

  // The image: the same marks, the hidden lines not drawn at all, the numbered one coloured, the rest neutral.
  const image = await readImage(page, await exportSvg(p, id, 'format=readme'));
  expect(image.nodes.find(n => n.id === 'db')!.usedBy).toBe('5');
  expect(image.edges.map(e => e.id).sort()).toEqual(['t1-t', 't2-t', 'u1-x', 'w-db']);
  expect(Object.fromEntries(image.edges.map(e => [e.id, e.tone]))).toEqual({ 't1-t': 'neutral', 't2-t': 'neutral', 'u1-x': 'neutral', 'w-db': 'kind' });
  expect(image.trunks).toEqual(['t:l|t1-t t2-t']);
  // The report counts what is drawn: the hidden lines are no connections of the image.
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-dialog').getByTestId('layout-report')).toHaveAttribute('data-connections', '4');
});
