import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Starting a drawing from a folder. The journeys (folder, card, focus, channel, draw, retry, no engine,
// the keyboard path) are held-out H121–H123 and H41. What stays here needs a faked server: the server
// going away during a scan or a draw, which must end the wait with a sentence, never a screen stuck busy.

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "archdraw-e2e-start-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "main.ts"), "export const main = 1;\n");
  writeFileSync(join(dir, "README.md"), "# Project\n");
  return dir;
}

test("a scan whose server goes away ends with a sentence and the controls come back", async ({ page }) => {
  await page.route("**/api/scans/*/events", (r) => r.abort());
  await page.route(/\/api\/scans\/s_[0-9a-f]+$/, (r) => r.abort());
  await page.goto("/");
  await page.getByTestId("start-folder").fill(project());
  await page.getByTestId("start-scan").click();
  await expect(page.getByTestId("start-error")).toHaveText("Could not reach the archdrawer server", { timeout: 15_000 });
  await expect(page.getByTestId("scan-progress")).toHaveCount(0);
  await expect(page.getByTestId("start-folder")).toBeEnabled();
  await expect(page.getByTestId("start-scan")).toBeEnabled();
});

test("a scan the server no longer knows (it restarted) ends at once with its own sentence", async ({ page }) => {
  await page.route("**/api/scans/*/events", (r) => r.abort());
  await page.route(/\/api\/scans\/s_[0-9a-f]+$/, (r) => r.fulfill({ status: 404, json: { error: "Scan not found" } }));
  await page.goto("/");
  await page.getByTestId("start-folder").fill(project());
  await page.getByTestId("start-scan").click();
  await expect(page.getByTestId("start-error")).toHaveText("The server restarted; scan again", { timeout: 5_000 });
  await expect(page.getByTestId("start-scan")).toBeEnabled();
});

test("a draw whose server goes away ends in draw-error with Try again, and keeps every choice", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-folder").fill(project());
  await page.getByTestId("start-scan").click();
  await expect(page.getByTestId("scan-card")).toBeVisible({ timeout: 30_000 });
  await page.route("**/api/runs/*/events", (r) => r.abort());
  await page.route(/\/api\/runs\/r_[0-9a-f]+$/, (r) => r.abort());
  await page.getByTestId("focus-whole").check();
  await page.getByTestId("channel-choice-readme").check();
  await page.getByTestId("draw-start").click();
  await expect(page.getByTestId("draw-error")).toContainText("Could not reach the archdrawer server", { timeout: 15_000 });
  await expect(page.getByTestId("draw-retry")).toBeVisible();
  await expect(page.getByTestId("focus-whole")).toBeChecked();
  await expect(page.getByTestId("channel-choice-readme")).toBeChecked();
});
