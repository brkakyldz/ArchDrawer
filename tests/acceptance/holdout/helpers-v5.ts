import { expect, type Page, type Locator } from '@playwright/test';
import { bounds, overlaps, settledReport, svgBoxes, svgInfo, type View, type LayoutReport, type Shape, type Drawing } from './helpers';

import { measureEdgeAnnotations } from './helpers-v7';

export const simplifyText = "Simplify the overview: keep every component in a detail view or a merged part's from";

export async function sendControl(page: Page, control: string) {
  const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.getByTestId(control).click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(202);
  return { id: (await response.json()).runId as string, body: response.request().postDataJSON() };
}

// Inspect every complete frame in the chunk containing done; later chunks are unobserved.
// The contract does not require EOF, so this detects duplicates only within that observation window.
export async function terminalEvents(page: Page, base: string, id: string) {
  return await page.evaluate(async url => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const events: { event: string; data: any }[] = [];
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Expected SSE');
      const reader = response.body!.getReader(), decoder = new TextDecoder();
      let pending = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE ended without done');
        pending += decoder.decode(chunk.value, { stream: true });
        pending = pending.replace(/\r\n/g, '\n');
        let end: number;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const lines = frame.split('\n');
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!event || !data) continue;
          events.push({ event, data: JSON.parse(data) });
        }
        if (events.some(e => e.event === 'done')) { await reader.cancel(); return events; }
      }
    } finally { clearTimeout(timer); controller.abort(); }
  }, `${base}/api/runs/${id}/events`);
}

// Match names against the public document, including wrapped lines and explicitly shortened names.
// shortcut: repeated label/detail strings are ambiguous in exports, keep fixtures distinct until a name role is contracted.
export async function previewTextSizes(page: Page) {
  const url = new URL(page.url()), id = url.pathname.split('/').at(-1)!;
  const response = await page.request.get(`${url.origin}/api/diagrams/${id}`);
  expect(response.status()).toBe(200);
  const doc = await response.json() as Drawing;
  const preview = page.getByTestId('share-preview'), viewId = await preview.getAttribute('data-view');
  const drawn = doc.views.find(v => v.id === viewId); expect(drawn).toBeTruthy();
  return await visibleTextSizes(preview, drawn!);
}

export async function visibleTextSizes(surface: Locator, view: View) {
  return await surface.evaluate((element, labels) => {
    const svg = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
    const toRoot = svg.getScreenCTM()!.inverse();
    const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
    const characters: { source: Node; text: string; nodeId: string | null; name: boolean; font: number; weight: number; opened: number; lineYs: number[] }[] = [];
    const offsets = new Map<SVGTextElement, number>();
    let run: Node | null;
    while ((run = walker.nextNode())) {
      const text = run.parentElement as SVGTextContentElement | null;
      const nameText = text?.closest('text') as SVGTextElement | null;
      if (!text || !nameText) continue;
      const content = run.textContent ?? '', offset = offsets.get(nameText) ?? 0;
      offsets.set(nameText, offset + content.length);
      if (!content.trim() || text.closest('defs, clipPath, mask, marker')) continue;
      const style = getComputedStyle(text);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
      if ((style.fill === 'none' || Number(style.fillOpacity) === 0)
        && (style.stroke === 'none' || Number(style.strokeOpacity) === 0)) continue;
      let hidden = false;
      for (let at: Element | null = text; at && at !== svg.parentElement; at = at.parentElement) {
        const own = getComputedStyle(at);
        if (own.display === 'none' || Number(own.opacity) === 0) { hidden = true; break; }
      }
      if (hidden) continue;
      const matrix = toRoot.multiply(text.getScreenCTM()!);
      const font = parseFloat(style.fontSize), opened = font * Math.hypot(matrix.a, matrix.b);
      if (!Number.isFinite(opened) || opened <= 0) throw new Error('Invalid visible text size');
      const nameMatrix = toRoot.multiply(nameText.getScreenCTM()!);
      for (let i = 0; i < content.length; i++) {
        const y = content[i].trim() ? nameText.getStartPositionOfChar(offset + i).matrixTransform(nameMatrix).y : 0;
        characters.push({ source: run, text: content[i], nodeId: text.closest('g[data-node-id]')?.getAttribute('data-node-id') ?? null,
          name: false, font, weight: Number(style.fontWeight), opened, lineYs: content[i].trim() ? [Math.round(y * 1000) / 1000] : [] });
      }
    }
    for (const group of Array.from(svg.querySelectorAll('g[data-node-id]'))) {
      const id = group.getAttribute('data-node-id')!, label = labels[id].replace(/\s/g, '');
      const own = characters.filter(c => c.nodeId === id && c.text.trim()), actual = own.map(c => c.text).join('');
      let start = actual.indexOf(label), length = label.length;
      if (start < 0) {
        for (let at = 0; at < own.length; at++) {
          const end = actual.indexOf('…', at);
          if (end >= at && label.startsWith(actual.slice(at, end))) { start = at; length = end - at + 1; break; }
        }
      }
      if (start < 0 || !length) throw new Error(`No rendered name for ${id}: ${actual}`);
      own.slice(start, start + length).forEach(c => { c.name = true; });
    }
    const runs: { text: string; nodeId: string | null; name: boolean; font: number; weight: number; opened: number; lineYs: number[] }[] = [];
    for (const source of new Set(characters.map(c => c.source))) {
      const own = characters.filter(c => c.source === source), first = own.findIndex(c => c.name), last = own.map(c => c.name).lastIndexOf(true);
      const slices = first < 0 ? [own] : [own.slice(0, first), own.slice(first, last + 1), own.slice(last + 1)];
      for (const slice of slices) {
        if (!slice.some(c => c.text.trim())) continue;
        const name = slice.some(c => c.name), { nodeId, font, weight, opened } = slice[0];
        runs.push({ text: slice.map(c => c.text).join(''), nodeId, name, font, weight, opened,
          lineYs: name ? slice.flatMap(c => c.lineYs) : [] });
      }
    }
    const minimum = (values: number[]) => values.length ? Math.min(...values) : 0;
    return { opened: minimum(runs.map(r => r.opened)), namesOpened: minimum(runs.filter(r => r.name).map(r => r.opened)), runs };
  }, Object.fromEntries(view.nodes.map(n => [n.id, n.label])));
}

export function reportNames(report: LayoutReport) {
  expect(report.smallestText).toMatchObject({ names: { inPlace: expect.any(Number), opened: expect.any(Number) } });
  const names = (report.smallestText as LayoutReport['smallestText'] & { names: { inPlace: number; opened: number } }).names;
  for (const value of [names.inPlace, names.opened]) {
    expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0);
  }
  return names;
}

// Compare in image coordinates, omitting only font-embedding markup outside the drawing.
// shortcut: routes use bounds and 17 samples, upgrade to curve equivalence if exact path parity needs proof.
export async function inDrawingFonts<T>(page: Page, svg: string, measure: (surface: Locator) => Promise<T>) {
  await page.evaluate(async markup => {
    await document.fonts.ready;
    const frame = document.createElement('iframe'); frame.setAttribute('data-holdout-image', '');
    frame.style.cssText = 'position:fixed;left:-10000px;width:1920px;height:1500px';
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.open(); doc.write(`<!doctype html><html><body style="margin:0">${markup}</body></html>`); doc.close();
    // FontFace objects can be shared with this same-origin document; ready alone cannot install Geist.
    document.fonts.forEach(face => doc.fonts.add(face));
    await doc.fonts.ready;
  }, svg);
  try {
    return await measure(page.frameLocator('iframe[data-holdout-image]').locator('svg').first());
  } finally { await page.locator('iframe[data-holdout-image]').evaluate(el => el.remove()); }
}

export async function imageGeometry(page: Page, image: string | Locator) {
  await page.evaluate(async () => { await document.fonts.ready; });
  return typeof image === 'string' ? await inDrawingFonts(page, image, measureImageGeometry) : await measureImageGeometry(image);
}

async function measureImageGeometry(image: Locator) {
  return await image.evaluate(element => {
      const root = (element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg')) as SVGSVGElement;
      const toRoot = root.getScreenCTM()!.inverse();
      const round = (n: number) => Math.round(n * 1e6) / 1e6;
      return Array.from(root.querySelectorAll('*')).filter(el =>
        el instanceof SVGGraphicsElement && !el.closest('defs') &&
        (el.matches('g[data-node-id], g[data-edge-id], text, tspan') || el instanceof SVGGeometryElement)
      ).map(el => {
        const part = el as SVGGraphicsElement, matrix = toRoot.multiply(part.getScreenCTM()!), b = part.getBBox();
        const point = (x: number, y: number) => {
          const p = new DOMPoint(x, y).matrixTransform(matrix); return [round(p.x), round(p.y)];
        };
        const box = [point(b.x, b.y), point(b.x + b.width, b.y), point(b.x, b.y + b.height), point(b.x + b.width, b.y + b.height)];
        const route = el instanceof SVGGeometryElement ? Array.from({ length: 17 }, (_, i) => {
          const p = el.getPointAtLength(el.getTotalLength() * i / 16); return point(p.x, p.y);
        }) : [];
        const style = getComputedStyle(el);
        const font = el.matches('text, tspan') ? round(parseFloat(style.fontSize) * Math.hypot(matrix.a, matrix.b)) : null;
        const characters = el instanceof SVGTextContentElement ? Array.from({ length: el.getNumberOfChars() }, (_, i) => {
          const start = el.getStartPositionOfChar(i), end = el.getEndPositionOfChar(i);
          return [point(start.x, start.y), point(end.x, end.y), round(el.getRotationOfChar(i))];
        }) : [];
        return { tag: el.tagName, node: el.getAttribute('data-node-id'), edge: el.getAttribute('data-edge-id'),
          text: el.matches('text, tspan') ? el.textContent : null, box, route, font, characters };
      });
    });
}

export function checkReport(report: LayoutReport, view: View, format: string, post = false) {
  expect(report).toMatchObject({ view: view.id, format, counts: {
    parts: view.nodes.filter(n => n.form !== 'group').length,
    zones: view.nodes.filter(n => n.form === 'group' && !n.parent).length,
    connections: view.edges.length,
  }, targets: post ? { parts: 12, zones: { min: 0, max: 4 }, connections: 14 }
    : { parts: null, zones: { min: 4, max: 6 }, connections: 15 } });
  for (const value of [report.crossings, report.smallestText.inPlace, report.smallestText.opened, report.longestConnection]) {
    expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0);
  }
  expect(Number.isInteger(report.crossings)).toBe(true);
  const possibleCrossings = view.edges.flatMap((a, i) => view.edges.slice(i + 1)
    .filter(b => ![a.from, a.to].some(id => id === b.from || id === b.to))).length;
  expect(report.crossings).toBeLessThanOrEqual(possibleCrossings);
  expect(Array.isArray(report.edgesOverParts)).toBe(true); expect(Array.isArray(report.cutText)).toBe(true);
  expect(Array.isArray(report.overLimitText)).toBe(true);
  expect(new Set(report.edgesOverParts.map(p => `${p.edge}/${p.node}`)).size).toBe(report.edgesOverParts.length);
  if (report.edgesOverParts.length) for (const pair of report.edgesOverParts) {
    const edge = view.edges.find(e => e.id === pair.edge); expect(edge).toBeTruthy();
    expect(view.nodes.some(n => n.id === pair.node)).toBe(true);
    expect([edge!.from, edge!.to]).not.toContain(pair.node);
    for (const endpoint of [edge!.from, edge!.to]) {
      let parent = view.nodes.find(n => n.id === endpoint)?.parent;
      while (parent) { expect(pair.node).not.toBe(parent); parent = view.nodes.find(n => n.id === parent)?.parent; }
    }
  }
  if (report.cutText.length) for (const cut of report.cutText) {
    expect(cut).toMatchObject({ id: expect.any(String), field: expect.any(String), text: expect.any(String) });
    expect(cut.text.length).toBeGreaterThan(0);
  }
  if (report.overLimitText.length) for (const over of report.overLimitText) {
    expect(over).toMatchObject({ id: expect.any(String), field: expect.any(String), text: expect.any(String), limit: expect.any(Number) });
    expect(over.text.length).toBeGreaterThan(0); expect(Number.isFinite(over.limit)).toBe(true); expect(over.limit).toBeGreaterThanOrEqual(0);
  }
  const { inPlace, opened, level } = report.smallestText;
  const names = reportNames(report);
  const formats: Record<string, [number, number]> = { feed: [552, 1080], linkedin: [552, 1620], square: [552, 1080], readme: [880, 1600], slide: [1280, 1920] };
  const [seen, width] = formats[format];
  expect(names.inPlace).toBeCloseTo(names.opened * seen / width, 6);
  expect(level).toBe(names.inPlace >= 9 && inPlace >= 6.5 ? 'good' : opened >= 8 ? 'ok' : 'warn');
  if (!view.edges.length) expect(report.longestConnection === 0).toBe(true);
}

export async function reportMatches(page: Page, report: LayoutReport, scope: 'share-dialog' | 'ai-panel') {
  await reportFields(page, scope);
  await expect.poll(async () => await settledReport(page, scope)).toEqual({
    crossings: report.crossings === 0 ? 0 : report.crossings, overParts: report.edgesOverParts.length, cut: report.cutText.length,
    overLimit: report.overLimitText.length, inPlace: report.smallestText.inPlace === 0 ? 0 : report.smallestText.inPlace,
    opened: report.smallestText.opened === 0 ? 0 : report.smallestText.opened, level: report.smallestText.level, parts: report.counts.parts === 0 ? 0 : report.counts.parts,
    zones: report.counts.zones === 0 ? 0 : report.counts.zones, connections: report.counts.connections === 0 ? 0 : report.counts.connections, longest: report.longestConnection === 0 ? 0 : report.longestConnection,
    view: report.view, format: report.format,
  });
  if (scope === 'share-dialog') {
    const measured = await previewTextSizes(page), names = reportNames(report);
    expect(measured.runs.length).toBeGreaterThan(0); expect(measured.namesOpened).toBeGreaterThan(0);
    expect(names.opened).toBeCloseTo(measured.namesOpened, 3);
  }
}

async function reportFields(page: Page, scope = 'share-dialog') {
  const report = page.getByTestId(scope).getByTestId('layout-report');
  for (const name of ['crossings', 'over-parts', 'cut', 'over-limit', 'in-place', 'opened', 'parts', 'zones', 'connections', 'longest']) {
    await expect.poll(async () => {
      const raw = await report.getAttribute(`data-${name}`);
      return raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0;
    }).toBe(true);
  }
  await expect(report).toHaveAttribute('data-level', /^(good|ok|warn)$/);
}

export async function postSwitches(page: Page) {
  const toggle = page.getByTestId('share-advanced-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  for (const id of ['title', 'lede', 'items', 'steps', 'labels', 'texts']) await page.getByTestId(`show-${id}`).check();
  await page.getByTestId('show-legend').uncheck(); await page.getByTestId('share-part').selectOption('');
}

export async function checkReadability(page: Page, width: number, seen: number) {
  await reportFields(page);
  const surface = page.getByTestId('share-dialog').getByTestId('layout-report');
  await expect(surface).toHaveAttribute('data-view', (await page.getByTestId('share-preview').getAttribute('data-view'))!);
  const format = await page.getByTestId('share-preview').evaluate(el => (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg'))!.getAttribute('data-format'));
  expect(format).toBeTruthy(); await expect(surface).toHaveAttribute('data-format', format!);
  await expect.poll(async () => {
    const report = await settledReport(page);
    return Math.abs(report.opened - (await previewTextSizes(page)).opened);
  }).toBeLessThan(0.001);
  const report = await settledReport(page), measured = await previewTextSizes(page);
  expect(measured.runs.length).toBeGreaterThan(0); expect(measured.namesOpened).toBeGreaterThan(0);
  expect(report.opened).toBeGreaterThan(0);
  expect(report.inPlace).toBeCloseTo(report.opened * seen / width, 6);
  const namesInPlace = measured.namesOpened * seen / width;
  expect(report.level).toBe(namesInPlace >= 9 && report.inPlace >= 6.5 ? 'good' : report.opened >= 8 ? 'ok' : 'warn');
  const meter = page.getByTestId('share-dialog').getByTestId('readability');
  await expect(meter).toHaveAttribute('data-level', report.level!);
  await expect(meter).toContainText({ good: 'Readable in place', ok: 'Readable when opened', warn: 'Too small to read' }[report.level as 'good' | 'ok' | 'warn']);
  expect((await meter.innerText()).match(/\d+\.\d(?=\s*px)/g)?.map(Number))
    .toEqual([Number(namesInPlace.toFixed(1)), Number(report.inPlace.toFixed(1)), Number(report.opened.toFixed(1))]);
  expect((await meter.innerText()).match(/\d+(?:\.\d+)?(?=\s*px)/g)).toHaveLength(3);
  return { ...report, namesInPlace, namesOpened: measured.namesOpened };
}

export function noUnrelatedOverlap(view: View, shapes: Shape[]) {
  expect(view.nodes.length).toBeGreaterThan(1); expect(shapes.length).toBe(view.nodes.length);
  const ancestor = (id: string, target: string): boolean => {
    const parent = view.nodes.find(n => n.id === id)?.parent;
    return !!parent && (parent === target || ancestor(parent, target));
  };
  let checked = 0;
  for (const [i, a] of shapes.entries()) for (const b of shapes.slice(i + 1)) {
    if (ancestor(a.nodeId, b.nodeId) || ancestor(b.nodeId, a.nodeId)) continue;
    checked++; expect(overlaps(a, b), `${a.nodeId}/${b.nodeId}`).toBe(false);
  }
  expect(checked).toBeGreaterThan(0);
}

export async function badgeLabels(surface: Locator) {
  const badges = surface.locator('[data-testid^="step-badge-"]'), labels = surface.locator('[data-testid^="edge-label-"]');
  expect(await badges.count()).toBeGreaterThan(0); expect(await labels.count()).toBeGreaterThan(0);
  for (const badge of await badges.all()) for (const label of await labels.all()) {
    const a = await badge.boundingBox(), b = await label.boundingBox();
    expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(overlaps(a!, b!)).toBe(false);
  }
}

// HTTP/download SVGs promise real text and edge groups; test ids are not required on every export.
export async function exportedBadgeLabels(page: Page, svg: string, view: View) {
  const text = await svgBoxes(page, svg, 'g[data-edge-id] text');
  const numbered = view.edges.filter(e => e.step !== null); expect(numbered.length).toBeGreaterThan(0);
  const holder = await page.context().newPage();
  let badges: Shape[] = [];
  try {
    await holder.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await holder.evaluate(async () => { await document.fonts.ready; });
    for (const edge of numbered) {
      const measured = await holder.locator('svg').evaluate(measureEdgeAnnotations, { edgeId: edge.id!, step: edge.step });
      expect(measured.badges).toHaveLength(1);
      badges.push(...measured.badges.map(b => ({ tag: '', testId: '', nodeId: '', edgeId: edge.id!, text: String(edge.step),
        x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top })));
    }
  } finally { await holder.close(); }
  let labels = await svgBoxes(page, svg, '[data-testid^="edge-label-"]');
  if (!labels.length) labels = text.filter(t => view.edges.some(e => e.label && t.text === e.label));
  expect(badges.length).toBe(numbered.length); expect(labels.length).toBeGreaterThan(0);
  for (const badge of badges) for (const label of labels) expect(overlaps(badge, label)).toBe(false);
}

export async function postImage(page: Page, svg: string, view: View) {
    const holder = await page.context().newPage();
    try {
      await holder.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
      await expect(holder.locator('svg').first()).toBeVisible();
      const measured = await visibleTextSizes(holder.locator('body'), view);
      expect(measured.runs.length).toBeGreaterThan(0);
      // ADR 0014 sets the drawing fonts; fitting the entire drawing scales them in image pixels.
      for (const run of measured.runs) expect(run.font, run.text).toBeGreaterThanOrEqual(12.5);
    } finally { await holder.close(); }
    expect(svg).not.toMatch(/data-caption\s*=\s*["']step["']/);
    const parts = await svgBoxes(page, svg, 'g[data-node-id]');
    expect(parts.map(p => p.nodeId).sort()).toEqual(view.nodes.map(n => n.id).sort());
    const routes = await svgBoxes(page, svg, 'g[data-edge-id] path');
    expect(routes.length).toBeGreaterThan(0);
    const drawing = bounds([...parts, ...routes]);
    const texts = await svgBoxes(page, svg, 'text'); expect(texts.length).toBeGreaterThan(0);
    // Wrapping may use tspans or separate text elements; assert the full prose, not an SVG encoding.
    const captions = await svgBoxes(page, svg, 'text:not(g[data-node-id] text):not(g[data-edge-id] text)');
    expect(captions.length).toBeGreaterThan(0);
    const compact = (s: string) => s.replace(/\s/g, '');
    const prose = compact(captions.map(t => t.text).join(''));
    const expectedCaptions = [view.caption.title, view.caption.lede].filter(Boolean); expect(expectedCaptions.length).toBeGreaterThan(0);
    for (const caption of expectedCaptions) expect(prose).toContain(compact(caption));
    for (const text of captions) {
      expect(text.y + text.height).toBeLessThanOrEqual(drawing.top); expect(text.text).not.toContain('…');
    }
    for (const text of texts) expect(text.y + text.height, text.text).toBeLessThanOrEqual(drawing.bottom + 0.001);
    const badges = await svgBoxes(page, svg, 'g[data-edge-id] text');
    const steps = badges.filter(t => view.edges.some(e => e.step !== null && t.text === String(e.step)));
    expect(steps.length).toBeGreaterThan(0);
    for (const badge of steps) {
      expect(badge.x).toBeGreaterThanOrEqual(drawing.left); expect(badge.x + badge.width).toBeLessThanOrEqual(drawing.right);
      expect(badge.y).toBeGreaterThanOrEqual(drawing.top); expect(badge.y + badge.height).toBeLessThanOrEqual(drawing.bottom);
    }
}

// The editor/export parity surface is each node's first rect; badge paint is measured without a shape-tag assumption.
export async function postGeometry(page: Page, svg: string, view: View) {
  await expect(page.getByTestId('editor')).toHaveAttribute('data-view', view.id);
  for (let i = 0; i < 30 && await page.getByTestId('canvas').getAttribute('data-detail') !== 'full'; i++) {
    const previous = await page.getByTestId('zoom-level').innerText(); await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('zoom-level')).not.toHaveText(previous);
  }
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-detail', 'full');
  const steps = page.getByTestId('tool-steps');
  if (await steps.getAttribute('aria-pressed') !== 'true') await steps.click();
  const image = await svgInfo(page, svg);
  const exported = await inDrawingFonts(page, svg, async surface => {
    const text = await visibleTextSizes(surface, view);
    expect(text.runs.length).toBeGreaterThan(0);
    for (const run of text.runs) expect(run.font, run.text).toBeGreaterThanOrEqual(12.5);
    const badges = await surface.evaluate((root, edges) => edges.map(edge => {
      const group = root.querySelector(`g[data-edge-id="${edge.id}"]`) as SVGGraphicsElement;
      const number = Array.from(group.querySelectorAll('text')).find(t => t.textContent?.trim() === String(edge.step)) as SVGTextElement;
      if (!number) throw new Error(`Missing step ${edge.id}`);
      const b = number.getBBox(), screen = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(number.getScreenCTM()!);
      const paint = Array.from(group.querySelectorAll('*')).filter((el): el is SVGGeometryElement =>
        el instanceof SVGGeometryElement && getComputedStyle(el).fill !== 'none' &&
        el.isPointInFill(screen.matrixTransform(el.getScreenCTM()!.inverse())));
      if (!paint.length) throw new Error(`Missing badge paint ${edge.id}`);
      const corners = paint.flatMap(el => {
        const box = el.getBBox(), matrix = group.getScreenCTM()!.inverse().multiply(el.getScreenCTM()!);
        return [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      });
      return { id: edge.id, font: parseFloat(getComputedStyle(number).fontSize), width: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)),
        height: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)) };
    }), view.edges.filter(e => e.step !== null));
    return { text, badges };
  });
  const cards = view.nodes.filter(n => n.form === 'card'), panels = view.nodes.filter(n => n.form === 'panel');
  expect(cards.length).toBeGreaterThan(0); expect(panels.length).toBeGreaterThan(0);
  expect(image.nodes).toHaveLength(view.nodes.length);
  for (const node of view.nodes) {
    const shape = image.nodes.find(n => n.id === node.id)!;
    const editor = await page.getByTestId(`node-${node.id}`).evaluate(el => {
      const rect = (el.querySelector('rect') as SVGRectElement).getBBox();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), fonts: number[] = [];
      let run: Node | null;
      while ((run = walker.nextNode())) {
        const text = run.parentElement;
        if (run.textContent?.trim() && text?.closest('text') && text.closest('[data-testid="node-label"], [data-testid="node-sub"], [data-testid="node-item"]'))
          fonts.push(parseFloat(getComputedStyle(text).fontSize));
      }
      return { width: rect.width, height: rect.height, fonts };
    });
    expect(editor.width, node.id).toBeCloseTo(shape.width, 6); expect(editor.height, node.id).toBeCloseTo(shape.height, 6);
    expect(editor.fonts.length, node.id).toBeGreaterThan(0);
    for (const font of editor.fonts) expect(font, node.id).toBeGreaterThanOrEqual(12.5);
    const exportFonts = exported.text.runs.filter(r => r.nodeId === node.id).map(r => r.font);
    expect(exportFonts.length, node.id).toBeGreaterThan(0);
    expect([...new Set(editor.fonts)].sort((a, b) => a - b), node.id).toEqual([...new Set(exportFonts)].sort((a, b) => a - b));
    if (node.form === 'card') {
      expect(shape.width).toBeGreaterThanOrEqual(176); expect(shape.width).toBeLessThanOrEqual(204);
      const name = exported.text.runs.filter(r => r.nodeId === node.id && r.name);
      expect(name.length).toBeGreaterThan(0);
      const lines = new Set(name.flatMap(r => r.lineYs)); expect(lines.size).toBeGreaterThan(0);
      expect(shape.height).toBe(84 + (lines.size > 1 ? 20 : 0));
    }
    if (node.form === 'panel') {
      const k = node.items.length;
      expect(shape.width).toBeGreaterThanOrEqual(150); expect(shape.width).toBeLessThanOrEqual(300);
      expect(shape.height).toBe(14 + 22 + (node.sub ? 16 : 0) + (k ? 6 + 19 * k + (k - 1) : 0));
    }
  }
  const numbered = view.edges.filter(e => e.step !== null); expect(numbered.length).toBeGreaterThan(0);
  expect(exported.badges).toHaveLength(numbered.length);
  for (const badge of exported.badges) {
    expect(badge.width, badge.id).toBeCloseTo(23, 6); expect(badge.height, badge.id).toBeCloseTo(23, 6);
    const editor = await page.getByTestId(`step-badge-${badge.id}`).evaluate(el => {
      const box = (el as SVGGraphicsElement).getBBox(), number = el.matches('text') ? el : el.querySelector('text')!;
      return { width: box.width, height: box.height, font: parseFloat(getComputedStyle(number).fontSize) };
    });
    expect(editor.width, badge.id).toBeCloseTo(badge.width, 6); expect(editor.height, badge.id).toBeCloseTo(badge.height, 6);
    expect(editor.font, badge.id).toBeGreaterThanOrEqual(12.5); expect(editor.font, badge.id).toBe(badge.font);
  }
}
