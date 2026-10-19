import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspace, openDrawing, download, drawing, component, settledReport, type Drawing } from './helpers';
import { inDrawingFonts } from './helpers-v5';
import { arcDrawing, fullEditor, smoothConnection, shareGeometry, checkClear, checkCap, checkNearestMiddle, arcMiddle, boxGap, centre, distance, groupNameBox, type Geometry } from './helpers-v13';
import type { Point } from './helpers-v7';

// This fixture has one line. Its box starts at authored x/y; glyph ascent and grab paint are irrelevant.
async function freeTextBox(surface: import('@playwright/test').Locator, doc: Drawing, g: Geometry) {
  const item = doc.views[0].texts.find(t => t.id === 'middle-text')!;
  const anchor = doc.views[0].nodes.find(n => n.id === 'start')!;
  const width = await surface.evaluate(async (element, input) => {
    const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const text = Array.from(root.querySelectorAll('text')).find(t => t.textContent === input.text);
    if (!text) throw new Error('Missing competing free text');
    await text.ownerDocument.fonts.ready;
    const m = root.getScreenCTM()!.inverse().multiply(text.getScreenCTM()!);
    return Math.ceil(text.getComputedTextLength() * Math.hypot(m.a, m.b) / input.scale - 1e-7);
  }, { text: item.text, scale: g.scale });
  const left = g.source.left + (item.x - anchor.x!) * g.scale, top = g.source.top + (item.y - anchor.y!) * g.scale;
  return { left, right: left + width * g.scale, top, bottom: top + 1.25 * item.size * g.scale };
}

// Calibrate authored positions from public SVG geometry, never from assumed ports or handles.
function calibrateMiddle(doc: Drawing, g: Geometry, blocker: Point) {
  const middle = arcMiddle(g.routes[0]);
  if (distance(middle, blocker) <= 0.25 * g.scale) return true;
  const dx = (middle.x - blocker.x) / g.scale, dy = (middle.y - blocker.y) / g.scale;
  for (const node of doc.views[0].nodes.filter(n => n.id.startsWith('early-'))) { node.x! += dx; node.y! += dy; }
  for (const text of doc.views[0].texts) { text.x += dx; text.y += dy; }
  return false;
}

// LAY-8 / diagram-v2: "A connection's label, and its step badge, take the free spot nearest the middle of its curve."
test('H83 [LAY-8, LAY-7, SHR-6] put an arc label and badge in the nearest free middle spots clear of every part', async ({ page, request }) => {
  const { dir, file } = await workspace('h83', arcDrawing('continue', 1)); await openDrawing(page, request, file); await fullEditor(page);
  let checks = 0;
  const check = async (surface: import('@playwright/test').Locator) => {
    const g = await smoothConnection(surface, 'arc', 'start', 'end');
    const zone = g.nodes.find(n => n.id === 'zone')!;
    const name = groupNameBox(zone.box, zone.texts.map(t => t.box), g.scale);
    const witnessName = groupNameBox(zone.box, zone.texts.map(t => t.box), g.scale, 'maximum');
    checkClear(g, [...g.nodes.filter(n => n.id !== 'zone').map(n => n.box), name]); checkCap(g);
    expect(g.labels.map(l => l.text.trim())).toContain('continue'); expect(g.badges).toHaveLength(1);
    const labels = g.labels.filter(l => l.text.trim() === 'continue'); expect(labels).toHaveLength(1);
    // Labels precede badges: only the badge must avoid the already placed label.
    checkNearestMiddle(g, labels[0].box, [name], 'label', [witnessName]);
    checkNearestMiddle(g, g.badges[0], [...g.labels.map(l => l.box), name], 'badge', [...g.labels.map(l => l.box), witnessName]); checks++;
  };
  await check(page.getByTestId('canvas')); await shareGeometry(page); await check(page.getByTestId('share-preview'));
  const out = join(dir, 'annotations.svg'); await download(page, 'download-svg', out);
  await inDrawingFonts(page, await readFile(out, 'utf8'), check); expect(checks).toBe(3);

  // Separate activation cases isolate earlier-label clearance and free-text clearance.
  for (const kind of ['earlier-label', 'free-text'] as const) {
    const doc = drawing(`Competing middle ${kind}`); doc.showSteps = true;
    doc.views[0].nodes = [component('start', { label: 'Start', form: 'compact', x: 0, y: 0 }),
      component('end', { label: 'End', form: 'compact', x: 600, y: 0 })];
    doc.views[0].edges = [{ id: 'arc', from: 'start', to: 'end', label: 'continue', step: 1, style: 'call', both: false }];
    if (kind === 'earlier-label') {
      // Separate ends leave room to translate this pair during public-geometry calibration.
      doc.views[0].nodes.push(component('early-start', { label: 'Start', form: 'compact', x: 0, y: -200 }),
        component('early-end', { label: 'End', form: 'compact', x: 600, y: 200 }));
      doc.views[0].edges.unshift({ id: 'early', from: 'early-start', to: 'early-end', label: 'earlier', step: null, style: 'call', both: false });
    }
    else doc.views[0].texts = [{ id: 'middle-text', text: 'Middle work', x: 330, y: 8, size: 24 }];
    let fixture!: Awaited<ReturnType<typeof workspace>>, calibrated = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      fixture = await workspace(`h83-${kind}-${attempt}`, doc); await openDrawing(page, request, fixture.file); await fullEditor(page);
      const surface = page.getByTestId('canvas'), g = await smoothConnection(surface, 'arc', 'start', 'end');
      const blocker = kind === 'earlier-label'
        ? arcMiddle((await smoothConnection(surface, 'early', 'early-start', 'early-end')).routes[0])
        : centre(await freeTextBox(surface, doc, g));
      calibrated = calibrateMiddle(doc, g, blocker);
      if (calibrated) break;
    }
    expect(calibrated, `${kind}: public-geometry calibration must activate the blocker; no skipped case`).toBe(true);
    const inspect = async (surface: import('@playwright/test').Locator) => {
      const g = await smoothConnection(surface, 'arc', 'start', 'end');
      expect(g.labels.map(l => l.text.trim())).toContain('continue'); expect(g.badges).toHaveLength(1);
      const label = g.labels.find(l => l.text.trim() === 'continue')!.box;
      let blockers: typeof g.badges = [], allLabels = [label];
      if (kind === 'earlier-label') {
        const early = await smoothConnection(surface, 'early', 'early-start', 'early-end');
        const other = early.labels.find(l => l.text.trim() === 'earlier'); expect(other).toBeTruthy();
        allLabels.push(other!.box);
        expect(boxGap(label, other!.box), 'labels maintain the new 4 px margin').toBeGreaterThanOrEqual(4 * g.scale - 0.05 * g.scale);
        // Placement order is not a public hook. The unconstrained first label is at its own middle.
        const choices = [{ geometry: early, box: other!.box }, { geometry: g, box: label }]
          .sort((a, b) => distance(centre(a.box), arcMiddle(a.geometry.routes[0])) - distance(centre(b.box), arcMiddle(b.geometry.routes[0])));
        const [first, later] = choices;
        checkNearestMiddle(first.geometry, first.box, []);
        const mid = arcMiddle(later.geometry.routes[0]), c = centre(later.box);
        const atMiddle = { left: later.box.left + mid.x - c.x, right: later.box.right + mid.x - c.x,
          top: later.box.top + mid.y - c.y, bottom: later.box.bottom + mid.y - c.y };
        expect(boxGap(atMiddle, first.box), 'the earlier label actually competes for the later middle').toBeLessThan(4 * g.scale);
        checkNearestMiddle(later.geometry, later.box, [first.box]);
      } else {
        const text = await freeTextBox(surface, doc, g);
        const middle = arcMiddle(g.routes[0]);
        expect(middle.x).toBeGreaterThan(text.left); expect(middle.x).toBeLessThan(text.right);
        expect(middle.y).toBeGreaterThan(text.top); expect(middle.y).toBeLessThan(text.bottom);
        blockers = [text]; checkNearestMiddle(g, label, blockers);
      }
      checkNearestMiddle(g, g.badges[0], [...blockers, ...allLabels], 'badge'); checks++;
    };
    await inspect(page.getByTestId('canvas')); await shareGeometry(page);
    if (kind === 'free-text') { await page.getByTestId('show-texts').check(); await settledReport(page); }
    await inspect(page.getByTestId('share-preview'));
    const out = join(fixture.dir, `${kind}.svg`); await download(page, 'download-svg', out);
    await inDrawingFonts(page, await readFile(out, 'utf8'), inspect);
  }
  expect(checks).toBe(9);
});
