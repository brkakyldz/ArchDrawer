import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, openDrawing, readDrawing, download, svgInfo, settledReport, type View } from './helpers';
import { checkReadability } from './helpers-v5';
import { routeGeometry, type Point, type Box } from './helpers-v7';
import { paintedTextField } from './helpers-v9';
import { groupNameBox } from './helpers-v13';

function h67Evidence(measured: Awaited<ReturnType<typeof routeGeometry>>, nameText: Awaited<ReturnType<typeof paintedTextField>>,
  input: { post: boolean; branch: string; x: number }, surface: string) {
  const scale = measured.scale, epsilon = scale * 0.3, target = measured.target;
  // Remove the image fit's translation using the sender's authored (x, 0) position.
  const origin = { x: measured.source.left - input.x * scale, y: measured.source.top };
  const point = (p: Point) => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale });
  const box = (b: Box) => ({ left: (b.left - origin.x) / scale, right: (b.right - origin.x) / scale,
    top: (b.top - origin.y) / scale, bottom: (b.bottom - origin.y) / scale });
  const nodeBox = (id: string) => { const node = measured.nodes.find(n => n.id === id); return node ? box(node.box) : null; };
  const lines = measured.routes.map(route => {
    const start = route[0], end = route.at(-1)!;
    const onX = end.x >= target.left - epsilon && end.x <= target.right + epsilon;
    const onY = end.y >= target.top - epsilon && end.y <= target.bottom + epsilon;
    const sides = [onY && Math.abs(end.x - target.left) <= epsilon && 'left',
      onY && Math.abs(end.x - target.right) <= epsilon && 'right',
      onX && Math.abs(end.y - target.top) <= epsilon && 'top',
      onX && Math.abs(end.y - target.bottom) <= epsilon && 'bottom'].filter(Boolean);
    return { start: point(start), end: point(end), targetEndSides: sides.length ? sides : ['none'],
      endDistanceToSides: { left: Math.abs(end.x - target.left) / scale, right: Math.abs(end.x - target.right) / scale,
        top: Math.abs(end.y - target.top) / scale, bottom: Math.abs(end.y - target.bottom) / scale },
      rootStart: start, rootEnd: end };
  });
  return `H67 ${JSON.stringify({ input, surface, units: 'drawing px (sender anchored at authored x, y=0)',
    source: nodeBox('sender'), target: nodeBox('receiver'), leftPeer: nodeBox('peer'), rightPeer: nodeBox('right-peer'),
    rightPeerAbsent: input.branch !== 'nearest-left', group: nodeBox('runtime'), name: box(nameText.box), lines,
    rootUnits: 'SVG root image px', rootToDrawing: { scale, origin }, rootPorts: measured.ports,
    drawingEpsilon: 0.3, nameText })}`;
}

test('H67 [LAY-1, LAY-4, SHR-6, SHR-10] bring a connection into a first-row member without crossing its group name', async ({ page, request }) => {
  const diagnostics: string[] = [];
  let active: { post: boolean; branch: string; x: number; name: string } | undefined, currentEvidence = '';
  try {
    const cases = [false, true].flatMap(post => ['top', 'free-right', 'nearest-left'].map(branch => ({ post, branch })));
    let topChecks = 0, freeChecks = 0, fallbackChecks = 0, headerChecks = 0;
    for (const [index, input] of cases.entries()) {
      const doc = drawing(`Group entry ${index}`), source = doc.views[0];
      const width = input.post ? 176 : 196, x = input.branch === 'top' ? 430 : 330;
      const name = input.branch === 'top' ? 'Runtime' : 'W'.repeat(48);
      active = { ...input, x, name }; currentEvidence = '';
      const nodes = [component('sender', { label: 'Sender', x, y: 0 }),
        component('runtime', { label: name, form: 'group' }),
        component('receiver', { label: 'Receiver', parent: 'runtime', x, y: 320 }),
        component('peer', { label: 'Peer', parent: 'runtime', x: input.branch === 'top' ? 100 : x - width, y: 320 })];
      // A touching full-height neighbour occupies the entire left side; the fallback has both sides occupied.
      if (input.branch === 'nearest-left') nodes.push(component('right-peer', { label: 'Peer right', parent: 'runtime', x: x + width, y: 320 }));
      const view: View = { id: input.post ? 'entry-post' : 'overview', title: 'Group entry',
        postOf: input.post ? source.id : null, caption: { title: 'Enter the runtime', lede: '' }, texts: [], nodes,
        edges: [{ id: 'enter', from: 'sender', to: 'receiver', label: '', style: 'call', both: false, step: null }] };
      if (input.post) doc.views.push(view); else doc.views[0] = view;
      const { dir, file } = await workspace(`h67-${index}`, doc); await openDrawing(page, request, file);
      if (input.post) { await page.getByTestId('views-button').click(); await page.getByTestId(`view-item-${view.id}`).click(); }
      const baseline = await readFile(file, 'utf8'), stored = (await readDrawing(file)).views.find(v => v.id === view.id)!;
      const members = stored.nodes.filter(n => n.parent === 'runtime'); expect(members.length).toBe(nodes.length - 2);
      for (const member of members) expect(member.y).toBe(320);
      await page.getByTestId('share-button').click(); await page.getByTestId('format-readme').click();
      if (await page.getByTestId('share-advanced-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('share-advanced-toggle').click();
      for (const id of ['title', 'lede', 'legend', 'texts', 'steps']) await page.getByTestId(`show-${id}`).uncheck();
      await page.getByTestId('show-labels').check();
      const report = await settledReport(page);
      expect(report).toMatchObject({ view: view.id, format: 'readme', parts: nodes.length - 1, zones: 1, connections: 1, crossings: 0 });
      expect(Number.isInteger(report.overParts) && report.overParts >= 0).toBe(true);
      // api-v2 excludes endpoint-containing zones; over-parts is not a group-name collision oracle.
      await checkReadability(page, 1600, 880);
      const out = join(dir, 'entry.svg'); await download(page, 'download-svg', out);
      const svg = await readFile(out, 'utf8'), info = await svgInfo(page, svg);
      expect(info.nodes).toHaveLength(nodes.length); expect(info.edges.map(e => e.id)).toEqual(['enter']);
      // A blank page's fonts.ready does not install the editor's bundled font; use the same loaded faces.
      await page.evaluate(async markup => {
        await document.fonts.ready;
        const frame = document.createElement('iframe'); frame.setAttribute('data-h67-download', '');
        frame.style.cssText = 'position:fixed;left:-10000px;width:1920px;height:1500px'; document.body.append(frame);
        const doc = frame.contentDocument!;
        doc.open(); doc.write(`<!doctype html><html><body style="margin:0">${markup}</body></html>`); doc.close();
        document.fonts.forEach(face => doc.fonts.add(face));
        await Promise.all(Array.from(doc.querySelectorAll('text')).map(text => {
          const s = doc.defaultView!.getComputedStyle(text);
          return doc.fonts.load(`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, text.textContent ?? '');
        }));
        await doc.fonts.ready;
      }, svg);
      const surface = page.frameLocator('iframe[data-h67-download]').locator('svg');
      try {
        const measured = await routeGeometry(surface, 'enter', 'sender', 'receiver');
        const group = measured.nodes.find(n => n.id === 'runtime')!;
        const nameText = await paintedTextField(surface, 'runtime', name);
        const evidence = h67Evidence(measured, nameText, active, 'downloaded SVG in font-loaded iframe');
        currentEvidence = evidence; diagnostics.push(evidence);
        expect(measured.sampled).toBeGreaterThan(0); expect(measured.checked).toBeGreaterThan(0); expect(measured.routes.length).toBeGreaterThan(0);
        expect(nameText.text).toBe(name.replace(/\s/g, ''));
        const header = groupNameBox(group.box, group.texts.map(t => t.box), measured.scale), target = measured.target;
        const scale = (target.right - target.left) / info.nodes.find(n => n.id === 'receiver')!.width;
        expect(scale).toBeGreaterThan(0); const epsilon = scale * 0.3;
        const intersects = (a: { x: number; y: number }, b: { x: number; y: number }) => {
          let lo = 0, hi = 1;
          for (const [origin, delta, min, max] of [[a.x, b.x - a.x, header.left, header.right], [a.y, b.y - a.y, header.top, header.bottom]]) {
            if (!delta) { if (origin < min || origin > max) return false; }
            else { const t = [(min - origin) / delta, (max - origin) / delta].sort((a, b) => a - b); lo = Math.max(lo, t[0]); hi = Math.min(hi, t[1]); }
          }
          return lo <= hi;
        };
        expect(nameText.fonts.every(font => font.loaded), evidence).toBe(true);
        let checked = 0, firstViolation: Point[] | null = null;
        for (const route of measured.routes) for (let i = 1; i < route.length; i++) {
          checked++;
          if (!firstViolation && intersects(route[i - 1], route[i])) firstViolation = [route[i - 1], route[i]];
        }
        expect(firstViolation, `"A group's name is never crossed"; ${evidence}`).toBe(null);
        expect(checked).toBeGreaterThan(0); expect(measured.source.bottom).toBeLessThan(target.top);
        expect(measured.ports.length).toBeGreaterThan(0);
        if (input.branch === 'top') {
          topChecks++;
          for (const port of measured.ports) {
            expect(Math.abs(port.y - target.top)).toBeLessThanOrEqual(epsilon);
            expect((port.x - header.right) / scale).toBeGreaterThanOrEqual(10 - 0.3);
          }
        } else {
          expect(target.left).toBeGreaterThanOrEqual(header.left); expect(target.right).toBeLessThanOrEqual(header.right);
          const left = measured.nodes.find(n => n.id === 'peer')!.box;
          expect(Math.abs(left.right - target.left)).toBeLessThanOrEqual(epsilon);
          expect(left.top).toBeLessThanOrEqual(target.top + epsilon); expect(left.bottom).toBeGreaterThanOrEqual(target.bottom - epsilon);
          // Left is nearer the group's edge in BOTH cases: choosing right proves free-side priority.
          expect(target.left - group.box.left).toBeLessThan(group.box.right - target.right);
          if (input.branch === 'free-right') {
            freeChecks++;
            const otherParts = measured.nodes.filter(n => !['runtime', 'receiver'].includes(n.id)); expect(otherParts.length).toBeGreaterThan(0);
            for (const part of otherParts) expect(part.box.left <= target.right + epsilon && part.box.right > target.right + epsilon &&
              part.box.top < target.bottom && part.box.bottom > target.top, `${part.id} occupies the right side`).toBe(false);
          } else {
            fallbackChecks++;
            const right = measured.nodes.find(n => n.id === 'right-peer')!.box;
            expect(Math.abs(right.left - target.right)).toBeLessThanOrEqual(epsilon);
            expect(right.top).toBeLessThanOrEqual(target.top + epsilon); expect(right.bottom).toBeGreaterThanOrEqual(target.bottom - epsilon);
          }
          for (const port of measured.ports) {
            expect(Math.abs(port.x - (input.branch === 'free-right' ? target.right : target.left))).toBeLessThanOrEqual(epsilon);
            expect(port.y).toBeGreaterThan(target.top + epsilon); expect(port.y).toBeLessThan(target.bottom - epsilon);
          }
          if (input.post) {
            headerChecks++;
            const childrenRight = Math.max(...measured.nodes.filter(n => members.some(m => m.id === n.id)).map(n => n.box.right));
            expect(header.right, 'the post header dominates the children plus 18px padding').toBeGreaterThan(childrenRight + 18 * scale);
            expect(group.box.left).toBeLessThanOrEqual(header.left + epsilon); expect(group.box.right).toBeGreaterThanOrEqual(header.right - epsilon);
            expect(group.box.top).toBeLessThanOrEqual(header.top + epsilon); expect(group.box.bottom).toBeGreaterThanOrEqual(header.bottom - epsilon);
          }
        }
      } finally { await page.locator('iframe[data-h67-download]').evaluate(el => el.remove()); }
      expect(await readFile(file, 'utf8')).toBe(baseline);
    }
    expect(cases).toHaveLength(6);
    expect(topChecks).toBe(2); expect(freeChecks).toBe(2); expect(fallbackChecks).toBe(2); expect(headerChecks).toBe(2);
  } catch (error) {
    // Include shared-helper assertion failures without changing those helpers or their callers.
    if (!currentEvidence && active) {
      const unavailable: string[] = [];
      for (const id of ['share-preview', 'canvas']) {
        try {
          const surface = page.getByTestId(id);
          if (!await surface.count()) { unavailable.push(`${id}: not present`); continue; }
          currentEvidence = h67Evidence(await routeGeometry(surface, 'enter', 'sender', 'receiver'),
            await paintedTextField(surface, 'runtime', active.name), active, `${id} (failure-time fallback; download not yet measured)`);
          diagnostics.push(currentEvidence); break;
        } catch (measurementError) { unavailable.push(`${id}: ${String(measurementError)}`); }
      }
      if (!currentEvidence) diagnostics.push(`H67 ${JSON.stringify({ input: active, surface: 'unavailable',
        source: null, target: null, leftPeer: null, rightPeer: null, group: null, name: null, lines: null, unavailable })}`);
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nH67 diagnostics:\n${diagnostics.join('\n')}`, { cause: error });
  }
});
