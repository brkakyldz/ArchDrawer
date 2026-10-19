import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// The empty library, an unreadable drawing, semantic zoom and visible editing are held-out H34,
// H40 and H41. An older server needs a faked /api/health, which the held-out suite never does.

test("a server older than the page is named instead of a blank page", async ({ page }) => {
  const { id } = await open(page);
  await page.route("**/api/health", (r) => r.fulfill({ json: { ok: true, app: "archdrawer", version: "2.0.0", build: "0000000000000000" } }));
  await page.goto(`/d/${id}`);
  await expect(page.getByTestId("load-error")).toContainText("The editor server is older than this page");
});
