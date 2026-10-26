import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, token, baseURL, postJSON, finishRun, startKind, previewSVG } from './helpers';
import { fourChoices, workspace4, openFourChoices, getRaw, readRaw, exportText, exportError, svgOpenInfo, choiceOf, type Doc4 } from './helpers-selections';

// FILE-2, SHARE-1 (api contract, export.svg / export.mmd / requests / runs; cli contract, `svg`; ui contract, the share dialog): every
// export draws one choice, named by `choice`, by default the choice that holds `view` when `view` is given and else the first; a
// request and a run name their choice the same way and change that choice alone. An unknown choice, and a view of another choice,
// are refused with the contracted sentences.
test('H201 [FILE-2 SHARE-1 START-5 AI-1 #182] the image, the Mermaid text, the command, the share dialog, a saved request and a run each take the current choice: the default is the one that holds the view or else the first, and a wrong choice or a view of another choice is refused', async ({ page, request }) => {
  test.setTimeout(300_000);
  const auth = await token(request);
  const made = await workspace4('f4-exports', fourChoices('Export four'));
  const registered = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path: made.file } });
  expect(registered.status(), await registered.text()).toBe(200);
  const { id } = await registered.json() as { id: string };
  // The parts an image draws, the group `shop-zone` (a frame, not a part to count here) left out.
  const nodes = async (query: string) => { const answer = await exportText(request, id, 'svg', query); expect(answer.status, `${query}: ${answer.body.slice(0, 200)}`).toBe(200); return (await svgOpenInfo(page, answer.body)).nodeIds.filter(n => n !== 'shop-zone').sort(); };

  // ---- Images: the first choice by default, the choice that holds the view, the choice named.
  expect(await nodes(''), 'the first choice, its overview, its first view').toEqual(['cart', 'charge']);
  expect(await nodes('choice=checkout')).toEqual(['cart', 'charge']);
  expect(await nodes('choice=system')).toEqual(['back-end', 'web']);
  expect(await nodes('choice=system&view=orders-inside')).toEqual(['db', 'mail', 'pay']);
  expect(await nodes('view=orders-inside'), 'no choice: the one that holds the view').toEqual(['db', 'mail', 'pay']);
  expect(await nodes('view=back-end-inside&format=readme')).toEqual(['api', 'orders']);
  expect(await nodes('choice=server')).toEqual(['api', 'store']);
  expect(await nodes('choice=server&channel=linkedin&format=feed')).toEqual(['entry', 'keep']);
  expect(await nodes('choice=system&channel=linkedin&format=feed')).toEqual(['core', 'ledger', 'visitor']);
  expect(await nodes('view=server-linkedin&channel=linkedin'), 'a LinkedIn view alone finds its choice').toEqual(['entry', 'keep']);
  expect(await nodes('choice=howto')).toEqual(['bill']);
  expect(await nodes('choice=system&view=overview&parts=web&format=readme')).toEqual(['web']);
  // The same view with and without its choice is the same image.
  expect((await exportText(request, id, 'svg', 'view=orders-inside&format=readme&theme=dark')).body).toBe((await exportText(request, id, 'svg', 'choice=system&view=orders-inside&format=readme&theme=dark')).body);

  // ---- Refusals, with the contracted words.
  expect(await exportError(request, id, 'svg', 'choice=nope')).toEqual({ status: 400, error: 'Unknown choice "nope"' });
  expect(await exportError(request, id, 'mmd', 'choice=nope')).toMatchObject({ status: 400 });
  expect(await exportError(request, id, 'svg', 'choice=howto&channel=linkedin')).toEqual({ status: 400, error: 'The channel "linkedin" has no drawing' });
  expect(await exportError(request, id, 'svg', 'choice=server&view=checkout-overview')).toEqual({ status: 400, error: 'Unknown view "checkout-overview"' });
  expect(await exportError(request, id, 'svg', 'choice=checkout&view=overview')).toEqual({ status: 400, error: 'Unknown view "overview"' });
  expect(await exportError(request, id, 'svg', 'choice=system&view=overview&parts=api')).toEqual({ status: 400, error: 'Unknown component "api" in the view "overview"' });
  expect(await exportError(request, id, 'svg', 'view=no-such-view')).toMatchObject({ status: 400, error: 'Unknown view "no-such-view"' });

  // ---- Mermaid: one choice's view, not all of them.
  const section = await exportText(request, id, 'mmd', 'choice=server');
  expect(section.status).toBe(200); expect(section.body).toMatch(/^flowchart LR/); expect(section.body).toContain('Order API'); expect(section.body).toContain('Order store'); expect(section.body).not.toContain('Web app');
  const whole = await exportText(request, id, 'mmd', 'view=overview');
  expect(whole.body).toContain('Web app'); expect(whole.body).toContain('Back-end'); expect(whole.body).not.toContain('Order store');
  expect((await exportText(request, id, 'mmd', '')).body, 'the default is the first choice').toContain('Cart');

  // ---- The command: `--choice`, the default, and its sentences on stderr.
  const out = (name: string) => join(made.dir, name);
  const svgOf = async (args: string[], name: string) => { const result = await cli(['svg', made.file, ...args, '--out', out(name)]); return { result, text: result.code === 0 ? await readFile(out(name), 'utf8') : '' }; };
  const byChoice = await svgOf(['--choice', 'server', '--format', 'readme'], 'server.svg'); expect(byChoice.result.code, byChoice.result.stderr).toBe(0);
  expect((await svgOpenInfo(page, byChoice.text)).nodeIds.sort()).toEqual(['api', 'store']);
  expect(byChoice.text, 'the command and the server draw the same image').toBe((await exportText(request, id, 'svg', 'choice=server&format=readme')).body);
  const byView = await svgOf(['--view', 'orders-inside', '--format', 'readme'], 'view.svg'); expect(byView.result.code, byView.result.stderr).toBe(0);
  expect((await svgOpenInfo(page, byView.text)).nodeIds.sort()).toEqual(['db', 'mail', 'pay']);
  const first = await svgOf(['--format', 'readme'], 'first.svg'); expect((await svgOpenInfo(page, first.text)).nodeIds.filter(n => n !== 'shop-zone').sort()).toEqual(['cart', 'charge']);
  const noChoice = await cli(['svg', made.file, '--choice', 'nope', '--out', out('nope.svg')]);
  expect(noChoice.code).toBe(1); expect(noChoice.stderr).toMatch(/No choice "nope" in .+; choices: /); for (const choice of ['checkout', 'howto', 'server', 'system']) expect(noChoice.stderr).toContain(choice);
  const noView = await cli(['svg', made.file, '--choice', 'server', '--view', 'overview', '--out', out('noview.svg')]);
  expect(noView.code).toBe(1); expect(noView.stderr).toMatch(/No view "overview" in the overview channel of .+; views: .*server-overview/);
  const noChannel = await cli(['svg', made.file, '--choice', 'howto', '--channel', 'linkedin', '--out', out('nochannel.svg')]);
  expect(noChannel.code).toBe(1); expect(noChannel.stderr).toMatch(/The channel "linkedin" has no drawing in /);

  // ---- The share dialog draws the choice on screen.
  await openFourChoices(page, request, made.file);
  await page.getByTestId('views-entry-server-overview').click();
  await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-dialog')).toBeVisible();
  const shown = await svgOpenInfo(page, await previewSVG(page));
  expect(shown.nodeIds.sort(), 'the dialog shows the section it was opened on').toEqual(['api', 'store']);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-dialog')).not.toBeVisible();
  await page.getByTestId('views-entry-overview').click();
  await page.getByTestId('share-button').click();
  expect((await svgOpenInfo(page, await previewSVG(page))).nodeIds.sort()).toEqual(['back-end', 'web']);
  await page.keyboard.press('Escape');

  // ---- Requests: the choice is named, or is the one that holds the view; a wrong one is refused and nothing is saved.
  const ask = (data: Record<string, unknown>) => postJSON(request, auth, `/api/diagrams/${id}/requests`, data);
  const one = await ask({ choice: 'server', channel: 'overview', view: 'server-overview', text: 'Add a cache' }); expect(one.status, JSON.stringify(one.body)).toBe(201);
  const two = await ask({ channel: 'overview', view: 'orders-inside', text: 'Show the retry' }); expect(two.status, JSON.stringify(two.body)).toBe(201);
  const three = await ask({ channel: 'linkedin', view: 'server-linkedin', text: 'Shorter' }); expect(three.status, JSON.stringify(three.body)).toBe(201);
  const stored = (await getRaw(request, id)).requests ?? [];
  expect(stored.map(r => [r.id, r.choice, r.channel, r.view, r.text])).toEqual([
    [one.body.id, 'server', 'overview', 'server-overview', 'Add a cache'], [two.body.id, 'system', 'overview', 'orders-inside', 'Show the retry'], [three.body.id, 'server', 'linkedin', 'server-linkedin', 'Shorter']]);
  expect((await ask({ choice: 'nope', view: 'overview', text: 'x' }))).toMatchObject({ status: 400, body: { error: 'Unknown choice "nope"' } });
  expect((await ask({ choice: 'server', view: 'orders-inside', text: 'x' }))).toMatchObject({ status: 400, body: { error: 'Unknown view "orders-inside"' } });
  expect((await ask({ choice: 'howto', channel: 'linkedin', view: 'howto-overview', text: 'x' })).status).toBe(400);
  expect((await ask({ choice: 'server', view: 'server-overview', text: '   ' }))).toMatchObject({ status: 400, body: { error: 'The instruction is empty' } });
  expect((await getRaw(request, id)).requests, 'refusals save nothing').toHaveLength(3);

  // ---- Runs: the choice is named or found by the view; the run changes that choice alone and its report names it.
  const before = await getRaw(request, id);
  const runId = await startKind(request, auth, { diagramId: id, choice: 'server', view: 'server-overview', instruction: 'rename Order API to Gateway', engine: 'fixture', model: null });
  const run = await finishRun(request, runId, 'succeeded', 120_000);
  expect(run).toMatchObject({ kind: 'refine', choice: 'server', channel: 'overview', view: 'server-overview' });
  expect(run.layoutReport).toMatchObject({ choice: 'server', view: 'server-overview' });
  expect(run.changes.changed).toContain('api');
  const after = await getRaw(request, id);
  expect(choiceOf(after, 'server').facts.components.find(f => f.id === 'api')!.label).toBe('Gateway');
  expect(choiceOf(after, 'system').facts.components.find(f => f.id === 'api')!.label, 'the same fact id in another choice').toBe('Order API');
  for (const other of ['checkout', 'howto', 'system']) expect(choiceOf(after, other), other).toEqual(choiceOf(before, other));
  const byView2 = await finishRun(request, await startKind(request, auth, { diagramId: id, view: 'orders-inside', instruction: 'rename Payments to Billing', engine: 'fixture', model: null }), 'succeeded', 120_000);
  expect(byView2).toMatchObject({ choice: 'system', view: 'orders-inside' });
  expect(choiceOf(await getRaw(request, id), 'system').facts.components.find(f => f.id === 'pay')!.label).toBe('Billing');
  const refusals = async (data: Record<string, unknown>) => { const answer = await postJSON(request, auth, '/api/runs', { diagramId: id, instruction: 'x', engine: 'fixture', model: null, ...data }); return { status: answer.status as number, error: (answer.body?.error ?? '') as string }; };
  expect(await refusals({ choice: 'nope', view: 'overview' })).toEqual({ status: 400, error: 'Unknown choice "nope"' });
  expect(await refusals({ choice: 'server', view: 'orders-inside' })).toEqual({ status: 400, error: 'Unknown view "orders-inside"' });
  // Must not happen: the file on disk rewritten by an image, a command or a refusal beyond what registering and the edits above wrote.
  expect((await readRaw(made.file) as Doc4).choices.map(c => c.id)).toEqual(['checkout', 'howto', 'server', 'system']);
});
