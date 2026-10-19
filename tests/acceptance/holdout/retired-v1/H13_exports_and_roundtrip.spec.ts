import { test, expect, makeDiagram, createDiagram, openEditor, saved, document, download, content } from './helpers';

test('H13 [DM-1, DM-3, EDT-7, PER-2, EXP-1, EXP-2, EXP-3, EXP-4, EXP-5] clean SVG, scaled PNG, Mermaid and JSON downloads round-trip into a separate diagram', async ({ page, request, token }) => {
  const draft = makeDiagram('Holdout export review');
  draft.groups = [
    { id: 'backend', label: 'Backend', parent: null, x: 365, y: 105, w: 650, h: 330 },
    { id: 'storage', label: 'Storage', parent: 'backend', x: 700, y: 135, w: 290, h: 270 },
  ];
  draft.nodes[1].group = 'backend';
  draft.nodes[2].group = 'storage';
  draft.edges.push(
    { id: 'reply', from: 'api', to: 'web', label: 'accepted', style: 'result', step: null },
    { id: 'write', from: 'api', to: 'db', label: 'enqueue', style: 'async', step: null },
  );
  const original = await createDiagram(request, token, draft);
  await openEditor(page, original.id);
  await page.getByTestId('tool-theme').click();
  await page.getByTestId('node-api').click();
  const current = await saved(page, request, original.id, diagram => diagram.theme === 'light');
  const svgDownload = await download(page, 'svg');
  expect(svgDownload.name).toBe('holdout-export-review.svg');
  const svg = svgDownload.bytes.toString('utf8');
  const inspectSVG = async (text: string) => page.evaluate(text => {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = xml.documentElement;
    return {
      parseErrors: xml.querySelectorAll('parsererror').length,
      name: root.localName, xmlns: root.getAttribute('xmlns'), theme: root.getAttribute('data-theme'),
      width: root.getAttribute('width'), height: root.getAttribute('height'), viewBox: root.getAttribute('viewBox'),
      nodes: Array.from(xml.querySelectorAll('g[data-node-id]')).map(group => ({ id: group.getAttribute('data-node-id'), text: Array.from(group.querySelectorAll('text')).map(text => text.textContent).join(' ') })),
      edges: Array.from(xml.querySelectorAll('g[data-edge-id]')).map(group => group.getAttribute('data-edge-id')),
      groups: Array.from(xml.querySelectorAll('g[data-group-id]')).map(group => group.getAttribute('data-group-id')),
      texts: Array.from(xml.querySelectorAll('text')).map(text => text.textContent),
      forbidden: xml.querySelectorAll('foreignObject, script, [data-handle-id], [data-selection], [class*="handle"], [class*="selection"]').length,
    };
  }, text);
  const structure = await inspectSVG(svg);
  expect(structure).toMatchObject({ parseErrors: 0, name: 'svg', xmlns: 'http://www.w3.org/2000/svg', theme: 'light', forbidden: 0 });
  expect(structure.viewBox).toMatch(/^\s*-?[\d.]+[ ,]+-?[\d.]+[ ,]+[\d.]+[ ,]+[\d.]+\s*$/);
  const width = Number.parseFloat(structure.width!);
  const height = Number.parseFloat(structure.height!);
  expect(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0).toBe(true);
  expect(structure.nodes.map(node => node.id).sort()).toEqual(current.nodes.map(node => node.id).sort());
  for (const node of current.nodes) expect(structure.nodes.find(candidate => candidate.id === node.id)!.text).toContain(node.label);
  expect([...structure.edges].sort()).toEqual(current.edges.map(edge => edge.id).sort());
  expect([...structure.groups].sort()).toEqual(current.groups.map(group => group.id).sort());
  expect(structure.texts).toContain(current.title);
  expect(structure.texts.join(' ')).toContain(current.notes[0].text);
  expect(svg).not.toMatch(/handle-source-|handle-target-|tool-add-|node-label-input/);
  for (const scale of [1, 2, 3]) {
    if (!(await page.getByTestId('export-png-scale').isVisible())) await page.getByTestId('export-button').click();
    if (scale === 1) await expect(page.getByTestId('export-png-scale')).toHaveValue('2');
    await page.getByTestId('export-png-scale').selectOption(String(scale));
    const png = await download(page, 'png');
    expect(png.name).toBe('holdout-export-review.png');
    expect(png.bytes.length).toBeGreaterThan(33);
    expect(png.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.bytes.readUInt32BE(8)).toBe(13);
    expect(png.bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(Math.abs(png.bytes.readUInt32BE(16) - width * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(png.bytes.readUInt32BE(20) - height * scale)).toBeLessThanOrEqual(1);
    const decoded = await page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, png.bytes.toString('base64'));
    expect(decoded).toEqual({ width: png.bytes.readUInt32BE(16), height: png.bytes.readUInt32BE(20) });
  }
  const mermaid = await download(page, 'mermaid');
  expect(mermaid.name).toBe('holdout-export-review.mmd');
  const text = mermaid.bytes.toString('utf8').replace(/\r\n/g, '\n');
  expect(text.split('\n')[0]).toMatch(/^flowchart (LR|TB)$/);
  for (const node of current.nodes) expect(text).toContain(`${node.id}["${node.label}"]`);
  for (const group of current.groups) expect(text).toContain(`subgraph ${group.id}["${group.label}"]`);
  expect(text.match(/^\s*end\s*$/gm)).toHaveLength(current.groups.length);
  expect(text).toMatch(/web\s*-->\s*\|submit\|\s*api/);
  expect(text).toMatch(/api\s*-\.->\s*\|accepted\|\s*web/);
  expect(text).toMatch(/api\s*--o\s*\|enqueue\|\s*db/);
  expect(text).not.toContain('data-testid');
  const svgResponse = await request.get(`/api/diagrams/${original.id}/export.svg`);
  expect(svgResponse.status()).toBe(200);
  expect(svgResponse.headers()['content-type']).toContain('image/svg+xml');
  expect(await inspectSVG(await svgResponse.text())).toEqual(structure);
  const darkResponse = await request.get(`/api/diagrams/${original.id}/export.svg?theme=dark`);
  expect(darkResponse.status()).toBe(200);
  expect((await inspectSVG(await darkResponse.text())).theme).toBe('dark');
  const mermaidResponse = await request.get(`/api/diagrams/${original.id}/export.mmd`);
  expect(mermaidResponse.status()).toBe(200);
  expect(mermaidResponse.headers()['content-type']).toContain('text/plain');
  expect((await mermaidResponse.text()).replace(/\r\n/g, '\n')).toBe(text);
  const json = await download(page, 'json');
  expect(json.name).toBe('holdout-export-review.archdraw.json');
  expect(JSON.parse(json.bytes.toString('utf8'))).toEqual(current);
  await page.getByTestId('back-to-library').click();
  await page.getByTestId('import-input').setInputFiles({ name: json.name, mimeType: 'application/json', buffer: json.bytes });
  await expect(page).toHaveURL(/\/d\/d_[a-z0-9]{6,}$/);
  const importedId = new URL(page.url()).pathname.slice(3);
  expect(importedId).not.toBe(original.id);
  await expect(page.getByTestId('diagram-title')).toHaveText(current.title);
  expect(content(await document(request, importedId))).toEqual(content(current));
  expect(await document(request, original.id)).toEqual(current);
});
