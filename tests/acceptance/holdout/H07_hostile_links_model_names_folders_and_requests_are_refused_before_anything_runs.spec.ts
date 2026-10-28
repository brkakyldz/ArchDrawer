import { test, expect } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import { join, dirname } from 'node:path';
import { useProduct } from './server';
import { gitRepo, home, activity, listDir, scan, exists, startScan, waitScan } from './helpers';

const product = useProduct();

// A raw request, so the Host and Origin headers are exactly the ones a hostile page or process would send.
function raw(port: number, method: string, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => { let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; } resolve({ status: res.statusCode ?? 0, body: parsed }); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

const NOT_A_LINK = 'Not a repository link';
// One representative of each way a pasted link could reach git as an option, another transport, a credential or a device (AGENTS.md
// invariant 1, *A link reaching git as an option*); the rest of the link rules are unit-test work (RETIRED.md).
const HOSTILE: [string, RegExp | string][] = [
  ['--upload-pack=touch x', /^(Not a repository link|Only github\.com, gitlab\.com and bitbucket\.org links can be drawn)$/],
  ['ext::sh -c touch% /tmp/pwned', NOT_A_LINK],
  ['file:///etc', NOT_A_LINK],
  ['https://github.com/-x/y', NOT_A_LINK],
  ['https://user:secret@github.com/acme/shop', 'Leave the user name and password out of the link'],
  ['https://github.com/acme/con', NOT_A_LINK],
];

// Someone pastes hostile input into every field the product takes: links, model names, a folder named like a command, and requests from
// another origin, another host name or without the token. Every one is refused before anything runs, and nothing is copied or started.
test('H07 [SAFE-1 SAFE-3 SRC-4] hostile links, model names, folder names and foreign requests are refused before git, an engine or a write runs', async ({ page }) => {
  const p = product();
  const project = await gitRepo('hostile');

  // The security envelope: no token, a wrong token, a foreign origin, a foreign host: 403 and no side effect.
  const body = JSON.stringify({ folder: project.dir, engine: 'fixture', model: null });
  const host = `127.0.0.1:${p.port}`;
  expect(await raw(p.port, 'POST', '/api/scans', { host }, body)).toEqual({ status: 403, body: { error: 'Missing or wrong token' } });
  expect(await raw(p.port, 'POST', '/api/scans', { host, 'x-archdraw-token': 'not-the-token' }, body)).toEqual({ status: 403, body: { error: 'Missing or wrong token' } });
  expect(await raw(p.port, 'POST', '/api/scans', { host, origin: 'http://evil.example', 'x-archdraw-token': p.token }, body)).toEqual({ status: 403, body: { error: 'Forbidden origin' } });
  expect(await raw(p.port, 'GET', '/api/diagrams', { host: `evil.example:${p.port}` })).toEqual({ status: 403, body: { error: 'Forbidden host' } });
  expect((await raw(p.port, 'GET', '/api/health', { host: `localhost:${p.port}` })).status, 'localhost is this server too').toBe(200);
  expect((await activity(p)).jobs, 'no refused request started a scan').toHaveLength(0);

  // Links: refused before anything is copied, through the check and through the scan alike.
  for (const [linkText, error] of HOSTILE) {
    for (const path of ['/api/folders/check', '/api/scans']) {
      const answer = await p.post(path, { link: linkText, engine: 'fixture', model: null });
      expect(answer.status, `${path} ${linkText}`).toBe(400);
      if (typeof error === 'string') expect(answer.body.error, linkText).toBe(error); else expect(answer.body.error, linkText).toMatch(error);
    }
  }
  expect((await listDir(join(p.data, 'repos'))).filter(n => n !== '.partial'), 'nothing was copied').toEqual([]);
  expect(await listDir(join(p.data, 'repos', '.partial'))).toEqual([]);
  const both = await p.post('/api/scans', { folder: project.dir, link: 'https://github.com/acme/shop' });
  expect(both.status).toBe(400);
  expect(both.body.error).toMatch(/folder or a link, not both/);

  // The home screen shows the refusal under the link field and keeps Scan off.
  await home(page, p);
  await page.getByTestId('start-source-link').click();
  await page.getByTestId('start-link').fill('ext::sh -c touch% /tmp/pwned');
  await expect(page.getByTestId('start-link-hint')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('start-link-hint')).toHaveText(new RegExp(NOT_A_LINK));
  await expect(page.getByTestId('start-scan')).toBeDisabled();

  // Model names that look like options or commands never reach an engine.
  for (const model of ['--dangerously-skip-permissions', 'x; rm -rf ~']) {
    const refused = await p.post('/api/scans', { folder: project.dir, engine: 'fixture', model });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(`Invalid model name "${model}"`);
  }
  expect((await activity(p)).jobs).toHaveLength(0);

  // A folder named like a command is one argument: it scans and draws as itself, and nothing runs.
  const odd = await gitRepo('hostile-name', undefined, 'shop & echo pwned ; touch owned');
  const around = await listDir(dirname(odd.dir));
  const scanned = await scan(p, { folder: odd.dir });
  expect(scanned.card.name).toBe('shop & echo pwned ; touch owned');
  const draw = await p.post('/api/runs', { kind: 'draw', scan: scanned.id, choices: [{ kind: 'whole' }], channel: 'readme', engine: 'fixture', model: '-x' });
  expect(draw.status).toBe(400);
  expect(draw.body.error).toBe('Invalid model name "-x"');
  expect(await listDir(dirname(odd.dir)), 'no file appeared beside the folder').toEqual(around);
  expect(await exists(join(odd.dir, 'owned'))).toBe(false);
  expect(await exists(join(odd.dir, 'docs')), 'the refused draw wrote nothing').toBe(false);
  // The same scan again is answered from the cache, still as one folder.
  const again = await waitScan(p, await startScan(p, { folder: odd.dir }));
  expect(again.cached).toBe(true);
});
