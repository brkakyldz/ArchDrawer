import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { register, withDetail, shopWithoutFiles, writeJSON, exists } from './helpers';
import { homeServer, openHome, makeRepo, answerDialogs, squash } from './helpers-home';

// HOME-9 (ui contract, *Drawings*): the library is a grid of cards, each with a preview of the drawing's first view, a `<n> views`
// pill that steps through the views while the pointer is on the card, the kinds of its parts and when it changed; a search narrows
// them by title or path and says when nothing matches; the layout is kept in the browser; Enter opens a card; an empty library
// shows its own state and the example. A drawing that cannot be read still has a card.
test('H230 [HOME-9 #200] the drawings are cards with previews that step through their views on hover, a search by title or path, a layout kept in the browser, and an empty state with the example once all are removed', async ({ page, request }) => {
  test.setTimeout(60_000);
  const server = await homeServer(page, request, { library: ['Alpha shop', 'Beta shop'] });
  try {
    // A drawing with two views in its overview channel, and one that is registered and then broken on disk.
    const detail = await makeRepo(join(server.tools, 'extra', 'detail'), { 'readme.md': '# detail\n' });
    const detailFile = join(detail.dir, 'architecture.archdraw.json'); await writeJSON(detailFile, withDetail(shopWithoutFiles('Detail shop')));
    const detailId = (await register(request, detailFile, server.base)).id;
    const broken = await makeRepo(join(server.tools, 'extra', 'broken'), { 'readme.md': '# broken\n' });
    const brokenFile = join(broken.dir, 'architecture.archdraw.json'); await writeJSON(brokenFile, shopWithoutFiles('Broken shop'));
    const brokenId = (await register(request, brokenFile, server.base)).id; await writeFile(brokenFile, '{ not a drawing', 'utf8');
    const messages = answerDialogs(page, [true, true, true, true]);
    await openHome(page, server);
    const cards = page.getByTestId('library-item'), cardOf = (id: string) => page.locator(`[data-testid="library-item"][data-diagram-id="${id}"]`);
    await expect(cards).toHaveCount(4); await expect(page.getByTestId('library-count')).toHaveText('4');
    const alpha = cards.filter({ has: page.getByTestId('library-item-title').filter({ hasText: 'Alpha shop' }) });
    const beta = cards.filter({ has: page.getByTestId('library-item-title').filter({ hasText: 'Beta shop' }) });

    // Every card: a preview (drawn, not the "No preview" of an unreadable file), the kinds as titled dots, the change time.
    for (const card of [alpha, beta, cardOf(detailId)]) {
      const preview = card.getByTestId('library-item-preview'); await expect(preview).toBeVisible();
      await expect(preview).not.toContainText('No preview'); expect((await preview.boundingBox())!.width).toBeGreaterThan(100);
      const dots = card.getByTestId('library-item-kinds').locator('[title]'); expect(await dots.count()).toBeGreaterThanOrEqual(1); expect(await dots.count()).toBeLessThanOrEqual(5);
      expect(squash(await card.getByTestId('library-item-updated').textContent())).toMatch(/^(just now|\d+ min ago|\d+ h ago|Yesterday|\d+ days ago|\d{1,2} [A-Z][a-z]{2}( \d{4})?)$/);
    }
    const kinds = await cardOf(detailId).getByTestId('library-item-kinds').locator('[title]').evaluateAll(els => els.map(el => (el.getAttribute('title') ?? '').toLowerCase()));
    expect(kinds.join(' '), 'the kinds of the previewed view are named').toMatch(/client/); expect(kinds.join(' ')).toMatch(/api/); expect(kinds.join(' ')).toMatch(/data/);
    await expect(cardOf(brokenId).getByTestId('library-item-preview')).toContainText('No preview');
    await expect(alpha.getByTestId('library-item-views'), 'one view: no pill').toHaveCount(0);

    // Two views: the pill, and the preview moving to the next view while the pointer is on the card, back to the first when it leaves.
    const card = cardOf(detailId), preview = card.getByTestId('library-item-preview');
    await expect(card.getByTestId('library-item-views')).toHaveText('2 views');
    const first = await preview.innerHTML();
    await card.hover(); await expect(card.getByTestId('library-open')).toBeVisible();
    await expect.poll(async () => (await preview.innerHTML()) !== first, { timeout: 6_000, message: 'the preview moves to the next view' }).toBe(true);
    await page.mouse.move(2, 2);
    await expect.poll(async () => (await preview.innerHTML()) === first, { timeout: 6_000, message: 'and back to the first when the pointer leaves' }).toBe(true);

    // The search: title, path, case, the count that stays, the sentence for no match.
    const search = page.getByTestId('library-search');
    await search.fill('BETA'); await expect(cards).toHaveCount(1); await expect(cards.first().getByTestId('library-item-title')).toHaveText('Beta shop');
    await search.fill('alpha-shop'); await expect(cards).toHaveCount(1); await expect(cards.first().getByTestId('library-item-title')).toHaveText('Alpha shop');
    await expect(page.getByTestId('library-count')).toHaveText('4');
    await search.fill('zzz'); await expect(cards).toHaveCount(0); await expect(page.getByTestId('library-none')).toHaveText('No drawing matches "zzz"');
    await search.fill(''); await expect(cards).toHaveCount(4); await expect(page.getByTestId('library-none')).toHaveCount(0);

    // The layout: the list, kept over a reload; the grid again.
    await page.getByTestId('library-layout-list').click();
    await expect(page.getByTestId('library-layout-list')).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByTestId('library-layout-grid')).toHaveAttribute('aria-pressed', 'false');
    await page.reload(); await expect(page.getByTestId('library-layout-list')).toHaveAttribute('aria-pressed', 'true'); await expect(cards).toHaveCount(4);
    await page.getByTestId('library-layout-grid').click(); await expect(page.getByTestId('library-layout-grid')).toHaveAttribute('aria-pressed', 'true');

    // Enter on a card opens its drawing.
    await alpha.focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor')).toBeVisible(); await expect(page).toHaveURL(new RegExp(`/d/${server.seeds[0].id}`));
    await page.goto(`${server.base}/`); await expect(cards).toHaveCount(4);

    // Remove every card: the empty state, the example, nothing in Continue; the files stay where they were.
    for (let i = 0; i < 4; i++) {
      const before = await cards.count(); await cards.first().getByTestId('library-menu').click();
      await page.getByTestId('library-menu-list').getByTestId('library-forget').click(); await expect(cards).toHaveCount(before - 1);
    }
    expect(messages, 'one question for each, none about a copy').toHaveLength(4);
    await expect(page.getByTestId('library-empty')).toContainText('No drawings yet'); await expect(page.getByTestId('library-example')).toHaveText('Open the example drawing');
    await expect(page.getByTestId('library-count')).toHaveText('0'); await expect(page.getByTestId('home-continue')).toHaveCount(0);
    expect(await exists(server.seeds[0].file), 'removing a card keeps the file').toBe(true); expect(await exists(detailFile)).toBe(true);
  } finally { await server.close(); }
});
