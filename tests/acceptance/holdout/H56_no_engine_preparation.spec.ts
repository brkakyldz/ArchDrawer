import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawing, component, workspace, isolatedDrawing, readDrawing, postViewOf, persisted, download, svgInfo, postRun } from './helpers';
import { postSwitches, postImage, postGeometry, checkReadability, simplifyText } from './helpers-v5';

test('H56 [SHR-1, SHR-3, SHR-7, SHR-10, ASK-10, DEP-6] prepare and edit a post without an engine, then queue overview simplification', async ({ page, request }) => {
  const doc = drawing('Fulfilment');
  const source = doc.views[0];
  source.nodes = [component('customer', { label: 'Customer', kind: 'actor' }),
    component('intake', { label: 'Intake', form: 'panel', items: ['Validate', 'Accept'] }),
    component('runtime', { label: 'Runtime', form: 'group' }),
    component('check', { label: 'Check order', parent: 'runtime', form: 'compact' }),
    component('write', { label: 'Write order', parent: 'runtime', form: 'compact' }),
    component('store', { label: 'Store', kind: 'data' }),
    component('deliver', { label: 'Deliver', form: 'panel', items: ['Send receipt'] }),
    component('receipt', { label: 'Receipt' }),
    component('monitor', { label: 'Monitor', kind: 'ops', description: 'No description yet.' })];
  const path = ['customer', 'intake', 'runtime', 'store', 'deliver', 'receipt'];
  source.edges = path.slice(1).map((to, i) => ({ id: `order-${i}`, from: path[i], to, label: '', style: 'call', both: false, step: (i + 1) * 10 }));
  source.edges.push({ id: 'internal', from: 'check', to: 'write', label: '', style: 'call', both: false, step: null },
    { id: 'observe', from: 'intake', to: 'monitor', label: '', style: 'dep', both: false, step: null });
  source.texts.push({ id: 'private', text: 'Unpublished note', x: 20, y: 700, size: 20 });
  const { dir, file } = await workspace('h56', doc), server = await isolatedDrawing(page, request, file, '250', '');
  let calls = 0; page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') calls++; });
  try {
    const before = await readDrawing(file);
    await page.getByTestId('share-button').click(); await page.getByTestId('format-feed').click();
    await expect(page.getByTestId('design-post')).toHaveCount(0);
    await page.getByTestId('linkedin-prepare').click();
    await expect(page.getByTestId('post-engine-note')).toHaveText('No engine available — prepared without AI');
    await persisted(file, d => d.views.some(v => v.postOf === 'overview'));
    let post = postViewOf(await readDrawing(file), 'overview');
    expect(post.title).toBe('LinkedIn'); expect(post.texts).toEqual([]); expect(post.nodes).toHaveLength(7);
    const part = (label: string) => { const found = post.nodes.find(n => n.label === label); expect(found).toBeTruthy(); return found!; };
    expect(part('Runtime')).toMatchObject({ form: 'panel', items: ['Check order', 'Write order'] });
    expect(part('Intake')).toMatchObject({ form: 'panel', items: ['Validate', 'Accept'] });
    expect(part('Deliver')).toMatchObject({ form: 'panel', items: ['Send receipt'] });
    expect(part('Monitor').form).toBe('compact'); expect(part('Store').form).toBe('card');
    expect(part('Customer').form).toBe('card'); expect(part('Receipt').form).toBe('card');
    expect(post.nodes.some(n => n.form === 'group' || ['Check order', 'Write order'].includes(n.label))).toBe(false);
    expect(post.edges.filter(e => e.step !== null).map(e => e.step)).toEqual([1, 2, 3, 4, 5]);
    expect((await readDrawing(file)).views[0]).toEqual(before.views[0]);
    const title = 'How a customer order reaches the people who check the request, keep the record and deliver the final receipt';
    const lede = 'An order moves from the customer through intake and the runtime into storage, then delivery returns a receipt while monitoring observes the work.';
    await page.getByTestId('share-caption-title').fill(title); await page.getByTestId('share-caption-lede').fill(lede);
    await persisted(file, d => postViewOf(d, 'overview').caption.title === title && postViewOf(d, 'overview').caption.lede === lede);
    post = postViewOf(await readDrawing(file), 'overview'); await postSwitches(page);
    const output = join(dir, 'local.svg'); await download(page, 'download-svg', output);
    const svg = await readFile(output, 'utf8');
    expect(await svgInfo(page, svg)).toMatchObject({ width: 1080, height: 1350 });
    await postImage(page, svg, post); await checkReadability(page, 1080, 552);
    expect(calls).toBe(0);
    await page.getByTestId('linkedin-edit').click(); await postGeometry(page, svg, post);
    await page.getByTestId('ai-button').click();
    await expect(page.getByTestId('ai-engine')).toHaveCount(0);
    await page.getByTestId('simplify-overview').click();
    await expect(page.getByTestId('ai-saved')).toHaveText('Saved in the file for your next archdrawer session');
    await persisted(file, d => d.requests!.some(q => q.view === 'overview' && q.text === simplifyText));
    const queued = await readDrawing(file); expect(queued.views).toEqual([before.views[0], post]);
    expect(calls).toBe(0); await expect(page.getByTestId('ai-progress')).not.toBeVisible();
    const bytes = await readFile(file, 'utf8');
    for (const kind of ['post', 'simplify']) {
      const refused = await postRun(request, server.token, { diagramId: server.id, view: 'overview', kind, engine: null, model: null }, server.base);
      expect(refused.status()).toBe(400); expect(await readFile(file, 'utf8')).toBe(bytes);
    }
  } finally { await server.close(); }
});
