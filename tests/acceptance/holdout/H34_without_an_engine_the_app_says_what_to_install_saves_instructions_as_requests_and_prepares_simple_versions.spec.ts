import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { drawingRepo, shopDoc, home, gitRepo, openDrawing, openAi, answerTo, stored, viewOf, saved, readJSON } from './helpers';

const product = useProduct({ engines: '' });

// A user on a machine with neither Claude Code nor Codex: the home screen says what to install and keeps Scan off, but still offers the
// example. In the editor their instructions and suggestions are saved in the file for the next session, and the LinkedIn and README
// channels are prepared in code as simple versions, each one undoable edit, ready to share.
test('H34 [START-3 AI-2 AI-4 STORY-1 SHARE-1] without an engine the home screen says what to install, instructions and suggestions are saved as requests, and LinkedIn and README are prepared as simple versions', async ({ page }) => {
  const p = product();
  expect(p.output()).toMatch(/engines: none/);
  const project = await gitRepo('no-engine');
  await home(page, p);
  await expect(page.getByTestId('start-no-engine')).toContainText(/install Claude Code or Codex/);
  await expect(page.getByTestId('start-no-engine')).toContainText('npm install -g @anthropic-ai/claude-code');
  await expect(page.getByTestId('start-no-engine')).toContainText('npm install -g @openai/codex');
  await expect(page.getByTestId('start-scan')).toBeDisabled();
  await expect(page.getByTestId('library-example')).toBeVisible();
  await expect(page.getByTestId('home-engine-chip')).toHaveCount(0);
  const refused = await p.post('/api/scans', { folder: project.dir, engine: null, model: null });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toMatch(/^No engine is available/);

  // The editor: an instruction is a saved request and a turn of the conversation.
  const { file } = await drawingRepo('no-engine-drawing', shopDoc('Offline shop'));
  const id = await openDrawing(page, p, file);
  const initialFacts = (await stored(p, id)).choices[0].facts;
  await openAi(page);
  await expect(page.getByTestId('ai-engine')).toHaveCount(0);
  await expect(page.getByTestId('ai-engine-note')).toContainText(/No engine is available/);
  await expect(page.getByTestId('ai-look-again')).toBeDisabled();
  await page.getByTestId('ai-input').fill('Add the payment provider');
  const request = await answerTo(page, 'POST', /^\/api\/diagrams\/[^/]+\/requests$/, () => page.getByTestId('ai-send').click());
  expect(request.status).toBe(201);
  expect(request.sent).toMatchObject({ choice: 'system', channel: 'overview', view: 'overview', text: 'Add the payment provider' });
  const turns = page.getByTestId('ai-thread').getByTestId('ai-turn');
  await expect(turns.last()).toHaveAttribute('data-state', 'saved');
  await expect(page.getByTestId('ai-saved')).toBeVisible();
  const simpler = await answerTo(page, 'POST', /^\/api\/diagrams\/[^/]+\/requests$/, () => page.getByTestId('ai-suggest-simpler').click());
  expect(simpler.sent.text).toMatch(/^Simplify the overview/);
  await expect(turns).toHaveCount(2);
  await expect(turns.last()).toHaveAttribute('data-state', 'saved');
  await expect.poll(async () => (await readJSON(file)).requests?.map((r: any) => `${r.choice}:${r.channel}:${r.view}`)).toEqual(['system:overview:overview', 'system:overview:overview']);

  // LinkedIn, prepared without AI: one undoable edit, its caption from the overview, ready to share.
  await page.getByTestId('channel-tab-linkedin').click();
  await expect(page.getByTestId('post-engine-note')).toContainText(/No engine available/);
  await expect(page.getByTestId('stage-engine')).toHaveCount(0);
  await page.getByTestId('linkedin-prepare').click();
  await saved(page);
  const prepared = viewOf(await stored(p, id), 'linkedin');
  expect(prepared).toMatchObject({ id: 'linkedin', title: 'LinkedIn', caption: viewOf(await stored(p, id), 'overview').caption });
  expect(prepared.edges.every((e: any) => /^li-e(-\d+)?$/.test(e.id))).toBe(true);
  expect(prepared.nodes.map((n: any) => n.id).sort()).toEqual(['api', 'db', 'web']);
  await page.getByTestId('tool-undo').click();
  await expect(page.getByTestId('channel-empty')).toBeVisible();
  await page.getByTestId('tool-redo').click();
  await expect(page.getByTestId('node-web')).toBeVisible();
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('format-feed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('share-preview')).toHaveAttribute('data-view', 'linkedin');
  await page.getByTestId('share-close').click();

  // README, prepared without AI: the overview's parts, facts and connections as they are, laid out again, no texts.
  await page.getByTestId('channel-tab-readme').click();
  await page.getByTestId('channel-prepare').click();
  await saved(page);
  const document = await stored(p, id);
  const readme = viewOf(document, 'readme'), overview = viewOf(document, 'overview');
  expect(readme).toMatchObject({ id: 'readme', title: 'README' });
  expect(readme.nodes.map((n: any) => `${n.id}:${n.facts.join(',')}:${n.form}`).sort()).toEqual(overview.nodes.map((n: any) => `${n.id}:${n.facts.join(',')}:${n.form}`).sort());
  expect(readme.edges.map((e: any) => e.relations.join(',')).sort()).toEqual(overview.edges.map((e: any) => e.relations.join(',')).sort());
  expect(readme.texts ?? []).toEqual([]);
  // Must not happen: a prepared channel touching the facts.
  expect(document.choices[0].facts).toEqual(initialFacts);
});
