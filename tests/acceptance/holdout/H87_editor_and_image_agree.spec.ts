import { test, expect, type Page } from '@playwright/test';
import { component, drawing, workspace, openDrawing, readDrawing, persisted, saved, drag, box, svgInfo, baseURL } from './helpers';
import { inDrawingFonts, routeGeometry, compareRoutes } from './helpers-svg-parity';

async function fullDetail(page: Page) {
  for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
    const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
  }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
}

// Outcome: what the editor draws and what the exported image draws are the same numbers, before and after an edit.
test('H87 [LAYOUT-1, SHARE-1, EDIT-1] the editor and the exported image agree on every part size and connection path, also after the user moves a part', async ({ page, request }) => {
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
    const stored = (await readDrawing(file)).views[0];
    const response = await request.get(`${baseURL()}/api/diagrams/${opened.id}/export.svg?view=overview&format=readme`);
    expect(response.status()).toBe(200);
    const svg = await response.text(), image = await svgInfo(page, svg);
    expect(image.nodes.map(n => n.id).sort(), when).toEqual(stored.nodes.map(n => n.id).sort());
    // Part sizes: at the zoom shown, each part's box is the exported box times the zoom (the zoom is shown as a whole percent).
    const zoom = Number((await page.getByTestId('zoom-level').innerText()).replace('%', '')) / 100;
    for (const node of stored.nodes) {
      const shape = image.nodes.find(n => n.id === node.id)!, size = await box(page.getByTestId(`node-${node.id}`));
      expect(Math.abs(size.width - shape.width * zoom), `${when}: width of ${node.id}`).toBeLessThanOrEqual(shape.width * 0.005 + 1);
      expect(Math.abs(size.height - shape.height * zoom), `${when}: height of ${node.id}`).toBeLessThanOrEqual(shape.height * 0.005 + 1);
    }
    // Connection paths and step badges: the same curve, fitted to each surface, within 0.3 drawing px.
    const editor = [];
    for (const edge of stored.edges) editor.push(await routeGeometry(page.getByTestId('canvas'), edge.id!, edge.from, edge.to));
    await inDrawingFonts(page, svg, async surface => {
      for (const [i, edge] of stored.edges.entries()) {
        const exported = await routeGeometry(surface, edge.id!, edge.from, edge.to);
        expect(editor[i].badges, `${when}: badge of ${edge.id}`).toHaveLength(edge.step === null ? 0 : 1);
        compareRoutes(editor[i], exported, true);
      }
    });
    return stored;
  }

  const first = await agree('as opened');
  // The user moves one part down. The editor follows, saves, and the image is drawn from the saved file.
  const db = first.nodes.find(n => n.id === 'db')!;
  await drag(page, page.getByTestId('node-db'), 0, 64);
  await saved(page); await persisted(file, d => d.views[0].nodes.find(n => n.id === 'db')?.y !== db.y);
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
