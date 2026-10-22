import { test, expect } from '@playwright/test';
import { component, drawing, workspace, openDrawing, saved, drag, box, svgInfo, baseURL } from './helpers';
import { inDrawingFonts } from './helpers-svg-parity';
import { fullDetail, readView, persistedChoice, viewIn, drawnRoutes, expectSameRoutes, expectSameBoxes } from './helpers-drawing';

// Outcome: what the editor draws and what the exported image draws are the same numbers, before and after an edit. Routes are read as the cubics
// themselves (`drawnRoutes`): a shaped part's end may lie on its outline inside the part's box, where a border test would lose the line.
test('H87 [LAYOUT-1 SHARE-1 EDIT-1 LAYOUT-5 #177 #165] the editor and the exported image agree on every part size and connection path, also after the user moves a part', async ({ page, request }) => {
  const doc = drawing('Editor and image'); doc.showSteps = true;
  doc.views[0].nodes = [
    component('web', { label: 'Web app', kind: 'client', sub: 'React', place: { row: 0, col: 0 } }),
    component('api', { label: 'Order API', kind: 'api', form: 'panel', items: ['Validate order', 'Create order'], sub: 'Intake', place: { row: 0, col: 1 } }),
    component('db', { label: 'Orders DB', kind: 'data', sub: 'Postgres', place: { row: 1, col: 1 } }),
    component('runtime', { label: 'Order runtime', form: 'group', place: { row: 0, col: 2 } }),
    component('check', { label: 'Check access', kind: 'gate', form: 'compact', parent: 'runtime' }),
    component('relay', { label: 'Order relay', kind: 'worker', parent: 'runtime' }),
  ];
  doc.views[0].edges = [
    { id: 'h1', from: 'web', to: 'api', label: 'POST /orders', style: 'call', both: true, step: 1 },
    { id: 'h2', from: 'api', to: 'db', label: '', style: 'async', both: false, step: 2 },
    { id: 'h3', from: 'api', to: 'check', label: '', style: 'call', both: false, step: 3 },
    { id: 'h4', from: 'check', to: 'relay', label: 'accepted', style: 'call', both: false, step: null },
    { id: 'h5', from: 'relay', to: 'db', label: '', style: 'dep', both: false, step: null },
  ];
  const { file } = await workspace('editor-and-image', doc), opened = await openDrawing(page, request, file);
  await fullDetail(page);

  async function agree(when: string) {
    const stored = await readView(file);
    const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
    expect(response.status()).toBe(200);
    const svg = await response.text(), image = await svgInfo(page, svg);
    expect(image.nodes.map(n => n.id).sort(), when).toEqual(stored.nodes.map(n => n.id).sort());
    // Part sizes: at the zoom shown, each part's box is the exported box times the zoom (the zoom is shown as a whole percent).
    const zoom = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')) / 100;
    for (const node of stored.nodes) {
      const shape = image.nodes.find(n => n.id === node.id)!, size = await box(page.getByTestId(`node-${node.id}`).locator('rect').first());
      expect(Math.abs(size.width - shape.width * zoom), `${when}: width of ${node.id}`).toBeLessThanOrEqual(shape.width * 0.005 + 1);
      expect(Math.abs(size.height - shape.height * zoom), `${when}: height of ${node.id}`).toBeLessThanOrEqual(shape.height * 0.005 + 1);
    }
    // Once no pointer is down, every connection has the same cubic in both surfaces (within 0.3 drawing px), and every numbered one its badge.
    const editor = await drawnRoutes(page.getByTestId('canvas'), 'web');
    for (const edge of stored.edges) await expect(page.getByTestId(`step-badge-${edge.id}`), `${when}: badge of ${edge.id}`).toHaveCount(edge.step === null ? 0 : 1);
    await inDrawingFonts(page, svg, async surface => {
      const exported = await drawnRoutes(surface, 'web');
      expectSameBoxes(editor, exported, when); expectSameRoutes(editor, exported, when);
    });
    return stored;
  }

  const first = await agree('as opened');
  // The user moves one part down. The editor follows, saves, and the image is drawn from the saved file.
  const db = first.nodes.find(n => n.id === 'db')!;
  await drag(page, page.getByTestId('node-db'), 0, 64);
  await saved(page); await persistedChoice(file, d => viewIn(d)!.nodes.find(n => n.id === 'db')?.y !== db.y);
  const second = await agree('after moving Orders DB');
  const moved = second.nodes.find(n => n.id === 'db')!;
  expect(moved.y!).toBeGreaterThan(db.y!);
  // Must not happen: any other part leaving its place because one was moved.
  for (const node of first.nodes.filter(n => n.id !== 'db')) {
    const now = second.nodes.find(n => n.id === node.id)!;
    expect([now.x, now.y], node.id).toEqual([node.x, node.y]);
  }
  expect(second.edges).toEqual(first.edges);
});
