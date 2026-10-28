import { test, expect } from '@playwright/test';
import { useProduct } from './server';
import { gitRepo, home, answerTo, activity, canonical, expectSamePath, scanRecord } from './helpers';

const product = useProduct();

// A user picks their folder with Choose folder… (the test folder dialog stands in for the system's): a folder with letters outside ASCII
// arrives unchanged, a cancelled or failed dialog changes nothing, one dialog opens at a time, a dialog whose request went away frees the
// next pick, and the picked folder scans like a pasted one. Where no dialog exists, the button goes and pasting stays.
test('H05 [SRC-3 START-4 HOME-2] Choose folder… fills the field with a non-ASCII path, cancel and failure change nothing, one dialog at a time, and the picked folder scans like a pasted one', async ({ page }) => {
  const p = product();
  const project = await gitRepo('picker', undefined, 'Masaüstü proje');
  await home(page, p);
  await expect(page.getByTestId('start-pick')).toBeVisible();
  expect((await p.get('/api/sources')).body).toEqual({ picker: true });

  await p.setPicker(project.dir);
  const picked = await answerTo(page, 'POST', /^\/api\/folders\/pick$/, () => page.getByTestId('start-pick').click());
  expect(picked.status).toBe(200);
  expect(picked.body.status).toBe('picked');
  await expectSamePath(picked.body.folder, project.dir, 'the picked folder');
  expect(await canonical(await page.getByTestId('start-folder').inputValue())).toBe(await canonical(project.dir));
  await expect(page.getByTestId('start-folder')).toHaveValue(/Masaüstü proje/);
  await expect(page.getByTestId('start-scan')).toBeFocused();
  expect((await activity(p)).jobs, 'choosing a folder never scans by itself').toHaveLength(0);

  // Cancelled: nothing changes. Failed and refused: one sentence, the field as it was.
  await p.setPicker('cancel');
  expect((await answerTo(page, 'POST', /^\/api\/folders\/pick$/, () => page.getByTestId('start-pick').click())).body).toEqual({ status: 'cancelled' });
  await expect(page.getByTestId('start-folder')).toHaveValue(/Masaüstü proje/);
  await expect(page.getByTestId('start-error')).toHaveCount(0);
  await p.setPicker('fail');
  expect((await answerTo(page, 'POST', /^\/api\/folders\/pick$/, () => page.getByTestId('start-pick').click())).status).toBe(500);
  await expect(page.getByTestId('start-error')).toHaveText(/dialog failed/i);
  await p.setPicker('relative/folder');
  expect((await answerTo(page, 'POST', /^\/api\/folders\/pick$/, () => page.getByTestId('start-pick').click())).status).toBe(400);
  await expect(page.getByTestId('start-error')).toHaveText(/absolute|whole path/i);
  await expect(page.getByTestId('start-folder')).toHaveValue(/Masaüstü proje/);

  // One dialog at a time; a dialog whose request closed frees the next pick at once.
  await p.setPicker(project.dir, 'slow');
  await page.getByTestId('start-pick').click();
  await expect(page.getByTestId('start-pick')).toBeDisabled();
  await expect(page.getByTestId('start-pick')).toHaveText(/Dialog open/);
  const second = await p.post('/api/folders/pick');
  expect(second.status, 'a second pick while one is open').toBe(409);
  expect(second.body.error).toMatch(/already open/);
  await expect(page.getByTestId('start-pick')).toBeEnabled({ timeout: 15_000 });
  // The page is reloaded while its dialog is open: the dialog goes with the request, so the next pick opens at once.
  await page.getByTestId('start-pick').click();
  await expect(page.getByTestId('start-pick')).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible();
  const next = await p.post('/api/folders/pick');
  expect(next.status, 'no 409 from an orphaned dialog').toBe(200);
  expect(next.body.status).toBe('picked');

  // The picked folder scans like a pasted one.
  await p.setPicker(project.dir);
  await page.getByTestId('start-pick').click();
  await expect(page.getByTestId('start-scan')).toBeFocused();
  const scanned = await answerTo(page, 'POST', /^\/api\/scans$/, () => page.keyboard.press('Enter'));
  expect(scanned.status).toBe(202);
  await expect(page.getByTestId('scan-card-name')).toHaveText('Masaüstü proje', { timeout: 60_000 });
  await expectSamePath((await scanRecord(p, scanned.body.scanId)).folder, project.dir, 'the scanned folder');

  // No dialog on this machine: the button goes, pasting stays.
  await p.setPicker('none');
  expect((await p.get('/api/sources')).body).toEqual({ picker: false });
  await home(page, p);
  await expect(page.getByTestId('start-folder')).toBeVisible();
  await expect(page.getByTestId('start-pick')).toHaveCount(0);
});
