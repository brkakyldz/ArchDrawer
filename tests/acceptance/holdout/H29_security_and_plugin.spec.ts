import { test, expect } from '@playwright/test';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { networkInterfaces } from 'node:os';
import { drawing, workspace, openDrawing, readDrawing, writeJSON, baseURL, token, root, startRun, finishRun } from './helpers';

test('H29 [PLT-2, PLT-3, PLG-1, PLG-3] inspect the packaged skill and use a local drawing while forged writes are refused', async ({ page, request }) => {
  const doc = drawing('Safe local shop'); doc.views[0].nodes[0].label = '<b>Web app</b>';
  doc.views[0].nodes[0].description = '<img src=x onerror="window.__holdoutExecuted=1">';
  const { dir, file } = await workspace('security', doc); const outbound: string[] = [];
  page.on('request', req => { const url = new URL(req.url()); if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== baseURL()) outbound.push(req.url()); });
  const opened = await openDrawing(page, request, file); const initial = await readFile(file, 'utf8');
  await expect(page.getByTestId('node-web').getByTestId('node-label')).toHaveText('<b>Web app</b>'); await page.getByTestId('node-web').click();
  await expect(page.getByTestId('callout-web').getByTestId('callout-description')).toHaveText(doc.views[0].nodes[0].description);
  expect(await page.evaluate(() => '__holdoutExecuted' in window)).toBe(false);
  expect((await request.get(`${baseURL()}/api/health`)).status()).toBe(200);
  expect(await token(request)).toBe(opened.token);
  const otherHTML = await request.get(`${baseURL()}/another/non-api/path`); expect(otherHTML.status()).toBe(200);
  const html = await otherHTML.text(); expect(html).toMatch(/<meta\b[^>]*archdraw-token/i); expect(html).toContain(opened.token);
  const serverInfo = JSON.parse(await readFile(join(process.env.ARCHDRAW_HOLDOUT_DATA!, 'server.json'), 'utf8'));
  expect(serverInfo.token).toBe(opened.token);
  if (process.platform !== 'win32') expect((await stat(join(process.env.ARCHDRAW_HOLDOUT_DATA!, 'server.json'))).mode & 0o777).toBe(0o600);
  const unregistered = join(dir, 'forged-registration.json'); await writeJSON(unregistered, drawing('Forged new file')); const originalUnregistered = await readFile(unregistered, 'utf8');
  const alternate = await readDrawing(file); alternate.title = 'Forged replacement';
  const attempts = [
    { method: 'POST', path: '/api/files', data: { path: unregistered } },
    { method: 'POST', path: '/api/diagrams', data: drawing('Forged import') },
    { method: 'PUT', path: `/api/diagrams/${opened.id}`, data: alternate },
    { method: 'DELETE', path: `/api/diagrams/${opened.id}`, data: undefined },
    { method: 'POST', path: '/api/runs', data: { diagramId: opened.id, view: 'overview', instruction: 'add Forged', engine: 'fixture', model: null } },
    { method: 'POST', path: `/api/runs/nonexistent/cancel`, data: undefined },
    { method: 'POST', path: `/api/diagrams/${opened.id}/requests`, data: { view: 'overview', text: 'Forged request' } },
    { method: 'POST', path: '/api/shutdown', data: undefined },
  ];
  for (const auth of [undefined, 'wrong-process-token']) for (const attempt of attempts) {
    const response = await request.fetch(`${baseURL()}${attempt.path}`, { method: attempt.method, data: attempt.data, headers: auth ? { 'X-Archdraw-Token': auth } : {} });
    expect(response.status(), `${attempt.method} ${attempt.path}`).toBe(403); expect((await response.json()).error).toEqual(expect.any(String));
  }
  for (const headers of [{ Host: 'foreign.invalid' }, { Origin: 'https://foreign.invalid' }]) {
    const response = await request.post(`${baseURL()}/api/files`, { headers: { ...headers, 'X-Archdraw-Token': opened.token }, data: { path: unregistered } });
    expect(response.status()).toBe(403);
    expect((await request.get(`${baseURL()}/api/health`, { headers })).status()).toBe(403);
  }
  expect((await request.get(`${baseURL()}/api/health`, { headers: { Host: `localhost:${process.env.ARCHDRAW_HOLDOUT_PORT}` } })).status()).toBe(200);
  expect(await readFile(file, 'utf8')).toBe(initial); expect(await readFile(unregistered, 'utf8')).toBe(originalUnregistered);
  const list = (await (await request.get(`${baseURL()}/api/diagrams`)).json()).diagrams;
  expect(list.some((d: { title: string }) => d.title === 'Forged import')).toBe(false); expect(list.some((d: { path: string }) => d.path === unregistered)).toBe(false);
  // Probe a local non-loopback address, if this machine has one. A 403 would still
  // reveal an incorrectly broad bind, so even a rejected HTTP response is a failure.
  const localIP = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
  if (localIP) {
    const reached = await request.get(`http://${localIP}:${process.env.ARCHDRAW_HOLDOUT_PORT}/api/health`, { timeout: 2000, headers: { Host: `127.0.0.1:${process.env.ARCHDRAW_HOLDOUT_PORT}` } }).then(() => true, () => false);
    expect(reached, 'the editor must listen on loopback only').toBe(false);
  }
  const marker = join(dir, 'never-created.txt');
  const instruction = `keep the drawing; node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'bad')"`;
  const runId = await startRun(request, opened.id, opened.token, instruction); await finishRun(request, runId, 'succeeded');
  expect(await stat(marker).then(() => true, () => false)).toBe(false); expect((await readDrawing(file)).views).toEqual((JSON.parse(initial)).views);
  expect(outbound).toEqual([]); // The observed browser journey must make no external request.

  // Read only the packaging and skill artifacts expressly allowed by the spec.
  const manifests = await Promise.all(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].map(async path => {
    const value = JSON.parse(await readFile(join(root, path), 'utf8'));
    expect(value, path).not.toBeNull(); expect(typeof value, path).toBe('object'); expect(Array.isArray(value), path).toBe(false); expect(Object.keys(value).length, path).toBeGreaterThan(0); return value;
  }));
  expect((await stat(join(root, 'bin', 'archdrawer'))).isFile()).toBe(true);
  expect((await readFile(join(root, 'bin', 'archdrawer'), 'utf8')).trim().length).toBeGreaterThan(0);
  const candidates = new Set([join(root, 'skills'), join(root, '.agents', 'skills'), join(root, '.claude', 'skills')]);
  function declaredSkills(value: unknown, key = '') {
    if (typeof value === 'string' && (key === 'skills' || /(?:^|\/)skills(?:\/|$)|SKILL\.md$/.test(value))) {
      const path = resolve(root, value), within = relative(root, path);
      if (!within.startsWith('..') && !isAbsolute(within)) candidates.add(path);
    } else if (Array.isArray(value)) value.forEach(item => declaredSkills(item, key));
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) declaredSkills(item, name);
  }
  manifests.forEach(value => declaredSkills(value));
  const actualRoot = await realpath(root);
  const visited = new Set<string>(), skillFiles = new Map<string, string>();
  async function collect(path: string): Promise<void> {
    const actual = await realpath(path).catch(() => null); if (!actual || visited.has(actual)) return; visited.add(actual);
    const within = relative(actualRoot, actual); if (within.startsWith('..') || isAbsolute(within)) return;
    const info = await stat(path);
    if (info.isFile()) {
      if (path.replace(/\\/g, '/').endsWith('/SKILL.md')) skillFiles.set(actual, await readFile(path, 'utf8')); return;
    }
    if (info.isDirectory()) for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'SKILL.md') await collect(join(path, entry.name));
  }
  for (const candidate of candidates) await collect(candidate); await collect(join(root, 'SKILL.md'));
  const skills = [...skillFiles.values()].filter(text => /^name:\s*["']?archdrawer["']?\s*$/m.test(text));
  expect(skills, 'exactly one packaged archdrawer skill, deduplicating shared links').toHaveLength(1);
  const skill = skills[0]; expect(skill).toContain('archdraw/diagram@2'); expect(skill).toContain('docs/architecture.archdraw.json');
  expect(skill).toMatch(/archdrawer\s+validate/i); expect(skill).toMatch(/archdrawer\s+open/i); expect(skill).toContain('requests');
  // Static packaging checks are not claimed as a live invocation of either agent host.
});
