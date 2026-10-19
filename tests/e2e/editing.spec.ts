import { expect, test } from "@playwright/test";
import { open, savedWhen } from "./helpers";

// Selecting, dragging, grouping, deleting with undo, outside changes and the 409 conflict are
// held-out H19 and H26. What stays here: the keyboard path, and a failed save (H26 can only make a
// save fail on POSIX; on Windows this is the one check that a failed save never says Saved).

test("the drawing's change stream is opened once, not again on every edit", async ({ page }) => {
  let streams = 0;
  page.on("request", (r) => { if (/\/api\/diagrams\/[^/]+\/events$/.test(r.url())) streams++; });
  const { path } = await open(page);
  await expect.poll(() => streams).toBeGreaterThan(0);
  const opened = streams;
  await page.getByTestId("tool-steps").click();
  await page.getByTestId("tool-theme").click();
  await page.getByTestId("node-web").click();
  await savedWhen(page, path, (d) => d.showSteps && d.theme === "dark");
  expect(streams).toBe(opened);
});

test("Escape clears the selection, Delete removes, and the keyboard undoes and redoes", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("node-web").click();
  await page.getByTestId("node-db").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-selected=true]")).toHaveCount(0);
  await page.getByTestId("node-db").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("node-db")).toHaveCount(0);
  await expect(page.getByTestId("edge-e2")).toHaveCount(0);
  await savedWhen(page, path, (d) => d.views[0].nodes.length === 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("node-db")).toBeVisible();
  await expect(page.getByTestId("edge-e2")).toBeVisible();
  await savedWhen(page, path, (d) => d.views[0].nodes.length === 3);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect(page.getByTestId("node-db")).toHaveCount(0);
  await expect(page.getByTestId("tool-redo")).toBeDisabled();
});

test("a failed save is never shown as Saved and can be retried", async ({ page }) => {
  const { path } = await open(page);
  await page.route("**/api/diagrams/*", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 500, body: JSON.stringify({ error: "Disk full" }) }) : r.continue()));
  await page.getByTestId("tool-steps").click();
  await expect(page.getByTestId("save-status")).toContainText("Disk full");
  await expect(page.getByTestId("save-status")).not.toHaveText("Saved");
  await page.unroute("**/api/diagrams/*");
  await page.getByTestId("save-retry").click();
  await savedWhen(page, path, (d) => d.showSteps);
});
