import { test } from '@playwright/test';
import { runBorderCases } from './border-cases';

test('H75 [LAY-4, LAY-5, SHR-6, SHR-10] finish post upward and asymmetric border detours within their own budget', async ({ page, request }) => {
  await runBorderCases(page, request, true, [3, 4, 5]);
});
