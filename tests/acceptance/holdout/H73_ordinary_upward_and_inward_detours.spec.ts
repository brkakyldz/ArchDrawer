import { test } from '@playwright/test';
import { runBorderCases } from './border-cases';

test('H73 [LAY-4, LAY-5, SHR-6, SHR-10] finish ordinary upward and asymmetric border detours within their own budget', async ({ page, request }) => {
  await runBorderCases(page, request, false, [3, 4, 5]);
});
