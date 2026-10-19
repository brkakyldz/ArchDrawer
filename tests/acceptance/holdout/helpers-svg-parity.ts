import { expect, type Page } from '@playwright/test';
import { svgInfo, type View } from './helpers';
import { inDrawingFonts } from './helpers-v5';
import { routeGeometry } from './helpers-v7';
import { compareRoutes, nodeRectBoxes } from './helpers-v8';
import { visibleTextContent } from './helpers-v9';

// ui-v2 promises the same drawn sizes/paths, independently of SVG paint serialization.
export async function compareSVGs(page: Page, first: string, second: string, edges: View['edges']) {
  const measure = async (svg: string) => {
    const info = await svgInfo(page, svg);
    return inDrawingFonts(page, svg, async surface => ({
      metadata: { error: info.error, width: info.width, height: info.height, theme: info.theme,
        format: info.format, viewBox: info.viewBox.trim().split(/[\s,]+/).map(value => Number(value) === 0 ? 0 : Number(value)), xmlns: info.xmlns, forbidden: info.forbidden },
      nodes: info.nodes.map(({ id, width, height }) => ({ id, width, height })).sort((a, b) => a.id.localeCompare(b.id)),
      boxes: (await nodeRectBoxes(surface)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
      text: await visibleTextContent(surface),
      routes: await Promise.all(info.edges.map(async ({ id }) => {
        const edge = edges.find(e => e.id === id); expect(edge, `known connection ${id}`).toBeTruthy();
        return { id, geometry: await routeGeometry(surface, id, edge!.from, edge!.to) };
      })),
    }));
  };
  // Sequential renders use the existing font-sharing iframe and always remove it.
  const a = await measure(first), b = await measure(second);
  expect(a.metadata).toEqual(b.metadata); expect(a.nodes).toEqual(b.nodes); expect(a.text).toEqual(b.text);
  expect(a.boxes.map(n => n.nodeId)).toEqual(b.boxes.map(n => n.nodeId));
  for (const [i, box] of a.boxes.entries()) for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(box[key] - b.boxes[i][key]), `same component ${box.nodeId} ${key}`).toBeLessThanOrEqual(0.3);
  expect(a.routes.map(r => r.id).sort()).toEqual(b.routes.map(r => r.id).sort());
  for (const route of a.routes) compareRoutes(route.geometry, b.routes.find(r => r.id === route.id)!.geometry, false, 0.3);
}


// Compare ink in the connection's region in both directions; background pixels cannot dilute a missing line.
export async function measureRasterAgreement(input: { svg: string; png: string; region: { left: number; right: number; top: number; bottom: number };
  masks: { left: number; right: number; top: number; bottom: number }[] }) {
  const load = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); return image; };
  const [svg, png] = await Promise.all([load(input.svg), load(input.png)]);
  if (png.naturalWidth !== svg.naturalWidth * 2 || png.naturalHeight !== svg.naturalHeight * 2) throw new Error('PNG must be twice SVG size');
  const width = png.naturalWidth, height = png.naturalHeight;
  const pixels = (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, width, height); return context.getImageData(0, 0, width, height).data;
  };
  const expected = pixels(svg), actual = pixels(png), background = expected.slice(0, 4);
  const delta = (a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number) =>
    Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]), Math.abs(a[i + 3] - b[j + 3]));
  const region = input.region, masks = input.masks;
  let ink = 0, missed = 0;
  for (let y = Math.max(2, Math.floor(region.top * 2) - 8); y < Math.min(height - 2, Math.ceil(region.bottom * 2) + 8); y++)
    for (let x = Math.max(2, Math.floor(region.left * 2) - 8); x < Math.min(width - 2, Math.ceil(region.right * 2) + 8); x++) {
      if (masks.some(b => x >= b.left * 2 - 6 && x <= b.right * 2 + 6 && y >= b.top * 2 - 6 && y <= b.bottom * 2 + 6)) continue;
      const i = (y * width + x) * 4;
      for (let direction = 0; direction < 2; direction++) {
        const a = direction ? actual : expected, b = direction ? expected : actual;
        if (delta(a, i, background, 0) <= 32) continue;
        ink++; let found = false;
        // One image pixel of positional tolerance at the contracted 2x PNG scale.
        for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2 && !found; dx++)
          if (delta(a, i, b, ((y + dy) * width + x + dx) * 4) <= 24) found = true;
        if (!found) missed++;
      }
    }
  return { ink, missed, fraction: missed / (ink || 1) };
}

export async function compareRasterConnection(page: Page, svg: string, png: string, edge: View['edges'][number]) {
  const measured = await inDrawingFonts(page, svg, async surface => {
    const geometry = await routeGeometry(surface, edge.id!, edge.from, edge.to);
    const text = await surface.evaluate(element => {
      const root = element as SVGSVGElement, inverse = root.getScreenCTM()!.inverse();
      return Array.from(root.querySelectorAll('text')).map(t => {
        const b = t.getBBox(), m = inverse.multiply(t.getScreenCTM()!);
        const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
          .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
        return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
          top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
      });
    });
    const region = geometry.routes[0].reduce((b, p) => ({ left: Math.min(b.left, p.x), right: Math.max(b.right, p.x),
      top: Math.min(b.top, p.y), bottom: Math.max(b.bottom, p.y) }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    return { region, masks: [...geometry.nodes.map(n => n.box), ...geometry.badges, ...text] };
  });
  const info = await svgInfo(page, svg);
  const [x, y, width, height] = info.viewBox.trim().split(/[\s,]+/).map(Number);
  expect([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0).toBe(true);
  const fit = (b: typeof measured.region) => ({ left: (b.left - x) * info.width / width, right: (b.right - x) * info.width / width,
    top: (b.top - y) * info.height / height, bottom: (b.bottom - y) * info.height / height });
  const result = await page.evaluate(measureRasterAgreement, { region: fit(measured.region), masks: measured.masks.map(fit), svg: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, png });
  expect(result.ink, 'visible connection ink outside text and parts').toBeGreaterThan(40);
  expect(result.fraction, `symmetric PNG/SVG connection mismatch: ${JSON.stringify(result)}`).toBeLessThanOrEqual(0.03);
}
