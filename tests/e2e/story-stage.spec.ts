import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// The README stage's Draw it (ui contract, channel-empty). Its journeys are held-out H124 and H125;
// what stays here needs a faked server answer: a story run that fails says so on the stage, with a
// retry, instead of only stopping its spinner.

test("a failed story run on the README stage shows its error and can be tried again", async ({ page }) => {
  await open(page);
  await page.getByTestId("channel-tab-readme").click();
  await expect(page.getByTestId("channel-empty")).toBeVisible();
  // The start is refused (another instruction is running), so no run goes on behind the faked answer.
  let faked = true;
  await page.route("**/api/runs", async (r) => {
    if (!faked || r.request().method() !== "POST") return r.continue();
    await r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "An instruction is already running on this drawing" }) });
  });
  await page.getByTestId("channel-draw").click();
  await expect(page.getByTestId("share-run-error")).toContainText("An instruction is already running on this drawing");
  faked = false;
  await page.getByTestId("share-run-retry").click();
  await expect(page.getByTestId("channel-empty")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("share-run-error")).toHaveCount(0);
});
