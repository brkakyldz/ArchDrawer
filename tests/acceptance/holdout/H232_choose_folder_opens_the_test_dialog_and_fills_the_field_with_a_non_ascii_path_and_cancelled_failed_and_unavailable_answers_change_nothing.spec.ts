import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { samePath, writeExistingDrawing } from './helpers';
import { watchPosts } from './helpers-selections';
import { homeServer, openHome, makeRepo } from './helpers-home';

// SRC-3, HOME-2, START-4 (ui contract, `start-pick`; api contract, *The folder dialog*; testing contract, *The test folder dialog*): `Choose
// folder…` calls the dialog and waits (disabled, `Dialog open…`); a picked folder with letters outside ASCII goes into the field
// unchanged and Scan takes the focus; a folder that already has a drawing offers it; cancelled changes nothing; a refused or failed
// dialog shows its message; with no dialog the button is not offered, on the Link tab either. Nothing here opens a real dialog.
test('H232 [SRC-3 HOME-2 START-4 #201] Choose folder opens the test dialog and fills the field with a path outside ASCII, a folder with a drawing offers it, and cancelled, refused, failed and unavailable answers change nothing but their message', async ({ page, request }) => {
  test.setTimeout(60_000);
  const server = await homeServer(page, request);
  try {
    const project = await makeRepo(join(server.tools, 'Masaüstü', 'shop-ü'));
    const withDrawing = await makeRepo(join(server.tools, 'Masaüstü', 'has-drawing')); await writeExistingDrawing(withDrawing.dir);
    const posts = watchPosts(page);
    const folder = page.getByTestId('start-folder'), pick = page.getByTestId('start-pick'), error = page.getByTestId('start-error');
    const picks = () => posts.filter(p => p.path === '/api/folders/pick').length;
    await openHome(page, server);

    // The test dialog answers `cancelled` while its file is missing: nothing changes.
    await expect(pick).toHaveText('Choose folder…');
    await pick.click(); await expect.poll(picks).toBe(1);
    await expect(pick).toBeEnabled(); await expect(folder).toHaveValue(''); await expect(error).toHaveCount(0); await expect(page.getByTestId('start-existing')).toHaveCount(0);

    // A picked folder (a slow dialog): the button waits, then the path arrives unchanged, Scan has the focus and nothing is scanned.
    await server.setPicker(project.dir, 'slow');
    await pick.click(); await expect(pick).toBeDisabled(); await expect(pick).toHaveText('Dialog open…');
    await expect(folder).toHaveValue(project.dir, { timeout: 20_000 }); await expect(page.getByTestId('start-scan')).toBeFocused(); await expect(pick).toBeEnabled();
    await page.waitForTimeout(500);
    expect(posts.filter(p => p.path === '/api/scans'), 'picking does not scan').toEqual([]);
    await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-card')).toBeVisible({ timeout: 60_000 }); await expect(page.getByTestId('scan-card-name')).toHaveText('shop-ü');
    expect(samePath(posts.find(p => p.path === '/api/scans')!.body.folder, project.dir)).toBe(true);

    // A folder that has a drawing: the offer, with no scan; neither choice scans by itself.
    await page.getByTestId('home-nav-new').click(); await expect(folder).toBeEnabled(); await expect(folder).toHaveValue('');
    await server.setPicker(withDrawing.dir);
    await pick.click(); await expect(folder).toHaveValue(withDrawing.dir);
    await expect(page.getByTestId('start-existing')).toContainText('This folder already has a drawing.'); await expect(page.getByTestId('start-open-existing')).toBeVisible(); await expect(page.getByTestId('start-again')).toBeVisible();
    await page.waitForTimeout(500);
    expect(posts.filter(p => p.path === '/api/scans'), 'only the first folder was scanned').toHaveLength(1);

    // A refused folder and a failed dialog show their sentence; the field is not filled by them.
    await page.getByTestId('home-nav-new').click(); await expect(folder).toHaveValue('');
    await server.setPicker('relative/folder');
    await pick.click(); await expect(error).toHaveText(/The path must be absolute|Give the whole path, starting from the drive or from \//); await expect(error).toHaveAttribute('role', 'alert'); await expect(folder).toHaveValue('');
    await server.setPicker('fail');
    await pick.click(); await expect(error).toHaveText('The folder dialog failed: Test dialog failure'); await expect(folder).toHaveValue('');
    await expect(pick).toBeEnabled();

    // Only on the Folder step of This computer: the Link tab does not offer it.
    await page.getByTestId('start-source-link').click(); await expect(pick).toBeHidden();
    await page.getByTestId('start-source-local').click(); await expect(pick).toBeVisible();

    // No dialog on this machine: asking hides the button, a reload keeps it hidden; with a dialog again, a reload shows it.
    await server.setPicker('none');
    await pick.click(); await expect(pick).toBeHidden();
    await page.reload(); await expect(page.getByTestId('start')).toBeVisible(); await expect(pick).toHaveCount(0);
    await server.setPicker('cancel');
    await page.reload(); await expect(pick).toBeVisible();
    expect(picks()).toBe(6);
    expect(posts.filter(p => p.path === '/api/runs'), 'nothing was drawn').toEqual([]);
  } finally { await server.close(); }
});
