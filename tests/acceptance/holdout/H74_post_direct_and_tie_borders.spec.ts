import { test } from '@playwright/test';
import { runBorderCases } from './border-cases';

test('H74 [LAY-4, LAY-5, SHR-6, SHR-10] end post direct and right-on-tie connections on their borders', async ({ page, request }) => {
  await runBorderCases(page, request, true, [0, 1, 2]);
});
