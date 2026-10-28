import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { useProduct } from './server';
import {
  makeRemote, copyFolder, partialFolder, home, answerTo, tick, startedRun, library, exists, listDir, expectSamePath, readJSON, git,
} from './helpers';

const product = useProduct();
const LINK = 'github.com/acme/shop';

// A user draws a public repository they do not have on disk: they paste its link (checked as they type), scan it, draw the whole system
// for a README, read the agent's mechanisms and its limit in the drawing, then remove the drawing from the list together with the copy.
test('H06 [SRC-4 SRC-6 HOME-2 HOME-9 STORY-3 STORY-5] a pasted link is checked as typed, copied, scanned and drawn into its copy, listed by its link, and removed with its copy @smoke', async ({ page }) => {
  const p = product();
  expect(p.output(), 'the start-up line names every test switch that is on').toMatch(/test folder dialog/);
  expect(p.output()).toMatch(/test links/);
  const remote = await makeRemote(p, LINK);
  const remoteHead = await remote.head();
  const copy = copyFolder(p, LINK);

  await home(page, p);
  await page.getByTestId('start-source-link').click();
  const field = page.getByTestId('start-link'), hint = page.getByTestId('start-link-hint');
  await expect(hint).toHaveText(/github\.com.*gitlab\.com.*bitbucket\.org/);
  await field.fill('https://example.com/acme/shop');
  await expect(hint).toHaveAttribute('role', 'alert');
  await expect(hint).toHaveText(/github\.com, gitlab\.com and bitbucket\.org/);
  await expect(page.getByTestId('start-scan')).toBeDisabled();
  await field.fill('https://github.com/Acme/Shop');
  await expect(hint).toContainText(LINK);
  await expect(hint).toContainText(/copied into archdrawer's own folder/);
  await expect(page.getByTestId('start-scan')).toBeEnabled();
  expect(await exists(copy), 'checking a link copies nothing').toBe(false);

  const scanned = await answerTo(page, 'POST', /^\/api\/scans$/, () => page.getByTestId('start-scan').click());
  expect(scanned.sent).toMatchObject({ link: 'https://github.com/Acme/Shop' });
  expect(scanned.sent.folder ?? null).toBeNull();
  await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('scan-card-link')).toHaveText(LINK);
  await expect(page.getByTestId('scan-card-name')).toHaveText('shop');
  await expect(page.getByTestId('start-link')).toBeDisabled();

  await tick(page, { whole: true }, 'readme');
  const run = await startedRun(page, () => page.getByTestId('draw-start').click());
  await expect(page.getByTestId('draw-ready')).toBeVisible({ timeout: 90_000 });
  const file = join(copy, 'docs', 'architecture.archdraw.json');
  expect(await exists(file), 'the drawing is written into the copy').toBe(true);
  const listed = (await library(p)).find(d => d.link === LINK);
  await expectSamePath(listed?.path, file, 'the library lists the file in the copy');
  const record = await (await fetch(`${p.base}/api/runs/${run.runId}`)).json();
  expect(record.link).toBe(LINK);

  // The drawing: the README tells the agent's loop as the mechanisms the agent holds, and its turn limit as a number outside LinkedIn.
  await page.getByTestId('draw-open').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-channel', 'readme');
  const agent = page.getByTestId('node-agent');
  await agent.getByTestId('node-label').click();
  const callout = page.getByTestId('callout-agent');
  await expect(callout.locator('[data-testid="callout-item"][data-row="held"]')).toHaveCount(5);
  await expect(callout.locator('[data-testid="callout-item"][data-row="held"]').first()).toContainText('Model call');
  await expect(callout.locator('[data-testid="callout-item"][data-row="limit"]')).toHaveText([/12 turns/]);
  await expect(agent, 'no row is drawn on the part').not.toContainText('Model call');
  const document = await readJSON(file);
  expect(document.choices[0].channels.readme.views[0].nodes.map((n: any) => n.id).sort()).toEqual(['agent', 'app', 'store']);

  // The library names the drawing by its link; the link is now on this computer.
  await home(page, p);
  const card = page.locator(`[data-testid="library-item"][data-diagram-id="${listed!.id}"]`);
  await expect(card.getByTestId('library-item-path')).toHaveText(LINK);
  await page.getByTestId('start-source-link').click();
  await page.getByTestId('start-link').fill(`https://${LINK}`);
  await expect(page.getByTestId('start-link-hint')).toContainText(/already on this computer/);

  // Remove from list, and the copy with it.
  const asked: string[] = [];
  page.on('dialog', dialog => { asked.push(dialog.message()); void dialog.accept(); });
  await card.getByTestId('library-menu').click();
  const removed = await answerTo(page, 'DELETE', /^\/api\/diagrams\/[^/]+$/, () => page.getByTestId('library-forget').click());
  expect(removed.status).toBe(204);
  expect(asked).toHaveLength(2);
  expect(asked[1]).toContain(LINK);
  await expect(card).toHaveCount(0);
  expect(await exists(copy), 'the copy is deleted').toBe(false);
  expect((await library(p)).some(d => d.link === LINK)).toBe(false);

  // Must not happen: the remote changed by the copy, its drawing or its deletion, or half a copy left behind.
  expect(await remote.head()).toBe(remoteHead);
  expect((await git(remote.dir, ['status', '--porcelain'])).trim()).toBe('');
  expect(await listDir(partialFolder(p))).toEqual([]);
});
