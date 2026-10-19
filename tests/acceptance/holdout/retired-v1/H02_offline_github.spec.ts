import * as path from 'node:path';
import { test, expect, bareRepo, startRun, waitRun, document, openEditor, library } from './helpers';

test('H02 [SRC-2, SRC-3, GEN-2, GEN-4, PER-1] offline GitHub forms and refs refresh files without altering older diagrams', async ({ page, request, token, workspace }) => {
  const name = `shop-${path.basename(workspace).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  const repo = await bareRepo(workspace, 'holdout', name);
  const identifier = `holdout/${name}`;
  let firstId = '';
  for (const [source, ref] of [
    [identifier, 'main'],
    [`git@github.com:${identifier}.git`, 'v1'],
    [`https://github.com/${identifier}.git`, null],
  ] as const) {
    const run = await waitRun(request, await startRun(request, token, source, 'Draw the checkout system', { ref }));
    const diagram = await document(request, run.diagramId!);
    if (!firstId) firstId = diagram.id;
    expect(diagram.source).toMatchObject({ kind: 'github', repo: identifier, ref });
    if (diagram.source?.kind === 'github' && diagram.source.commit !== null) expect(diagram.source.commit).toBe(repo.commit);
    expect(diagram.subtitle).toBe(`Fixture diagram of ${name}`);
    expect(diagram.warnings).toEqual([]);
    await openEditor(page, diagram.id);
    await page.getByTestId('node-api').click();
    const link = page.getByTestId('inspector-file');
    await expect(link).toHaveText('server/api.js');
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    const url = new URL(href!);
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toMatch(new RegExp(`^/${identifier}/blob/[^/]+/server/api\\.js$`));
    const linkedRef = decodeURIComponent(url.pathname.split('/')[4]);
    const validRefs = diagram.source?.kind === 'github' ? [diagram.source.commit, diagram.source.ref].filter(Boolean) : [];
    if (validRefs.length) expect(validRefs).toContain(linkedRef);
    expect(href).not.toContain('file:');
  }
  const original = await document(request, firstId);
  const nextCommit = await repo.advance();
  const refreshed = await waitRun(request, await startRun(request, token, identifier, 'Draw after the main branch update', { ref: 'main' }));
  const next = await document(request, refreshed.diagramId!);
  if (next.source?.kind === 'github' && next.source.commit !== null) expect(next.source.commit).toBe(nextCommit);
  expect(next.nodes.find(node => node.id === 'auth')!.files).toEqual([]);
  expect(next.nodes.find(node => node.id === 'api')!.files).toEqual(['server/api.js']);
  expect(next.warnings).toHaveLength(1);
  expect(next.warnings[0]).toContain('server/auth.js');
  expect(await document(request, firstId)).toEqual(original);
  const beforeFailure = await library(request);
  const failed = await waitRun(request, await startRun(request, token, `holdout/missing-${name}`), 'failed');
  expect(failed.error).toMatch(/clone.*fail|fail.*clone/i);
  expect(failed.diagramId).toBeNull();
  expect(await library(request)).toEqual(beforeFailure);
});
