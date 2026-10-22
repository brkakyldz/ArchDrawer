import { expect, test, type Page } from "@playwright/test";
import { onDisk, open, storedOnDisk } from "./helpers";

// A run's result as a preview (ui contract, Preview, Accept and Undo). Its journeys are held-out
// H138–H140; what stays here they do not observe: the autosave race after Accept, and an Undo whose
// save is refused for a stale token (a faked server answer).

async function previewOf(page: Page, instruction: string) {
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill(instruction);
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
}

test("two quick edits after Accept, then a reload, show the second", async ({ page }) => {
  const { path } = await open(page);
  await previewOf(page, "add Cache component");
  await page.getByTestId("ai-accept").click();
  await expect(page.getByTestId("ai-preview")).toHaveCount(0);
  const label = page.getByTestId("node-web").getByTestId("node-label");
  const input = page.getByTestId("node-label-input");
  await label.dblclick();
  await input.fill("First name");
  await input.press("Enter");
  await label.dblclick();
  await input.fill("Second name");
  await input.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("node-web").getByTestId("node-label")).toHaveText("Second name");
  expect(onDisk(path).views[0].nodes.find((n) => n.id === "web")!.label).toBe("Second name");
  expect(onDisk(path).views[0].nodes.some((n) => n.id === "cache")).toBe(true);
});

test("an Undo whose save is refused for a stale token says so in save-status, never Saved", async ({ page }) => {
  const { path } = await open(page);
  await previewOf(page, "add Cache component");
  await page.route("**/api/diagrams/*", (r) => (r.request().method() === "PUT"
    ? r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Missing or wrong token" }) })
    : r.continue()));
  await page.getByTestId("ai-undo").click();
  await expect(page.getByTestId("node-cache")).toHaveCount(0);
  await expect(page.getByTestId("ai-preview")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("The server restarted — reload the page");
  await expect(page.getByTestId("save-retry")).toBeVisible();
  await expect(page.getByTestId("save-status")).not.toHaveText("Saved");
  // The file still holds the result: nothing claimed the Undo was written.
  expect(storedOnDisk(path).facts.components.some((c) => c.id === "cache")).toBe(true);
});

test("a run that changes nothing leaves no undo step", async ({ page }) => {
  await open(page);
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill("leave it alone");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-summary")).toHaveText("Nothing changed", { timeout: 30_000 });
  await expect(page.getByTestId("ai-preview")).toHaveCount(0);
  await expect(page.getByTestId("tool-undo")).toBeDisabled();
});
