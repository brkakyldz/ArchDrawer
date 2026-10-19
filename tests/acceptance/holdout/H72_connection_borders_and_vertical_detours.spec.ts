import { test } from '@playwright/test';
import { runBorderCases } from './border-cases';

test('H72 [LAY-4, LAY-5, SHR-6, SHR-10] end connections on borders and take the nearest available side around vertical obstacles', async ({ page, request }) => {
  await runBorderCases(page, request, false, [0, 1, 2]);
});
