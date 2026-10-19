import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// Search, the views menu, the pinned callout and the narrow header are held-out H35 and H36. What
// stays here: the Ctrl/Cmd+K shortcut and Escape, and a pin that outlives a reload while pinned.

test("Ctrl+K opens search, picking a result closes it, Escape closes it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("search-input")).toBeFocused();
  await page.getByTestId("search-input").fill("orders db");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search")).toHaveCount(0);
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("search-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search")).toHaveCount(0);
});

test("a pinned callout stays pinned across a reload until it is unpinned", async ({ page }) => {
  await open(page);
  await page.getByTestId("node-api").click();
  await page.getByTestId("callout-api").getByTestId("callout-pin").click();
  await expect(page.getByTestId("callout-api")).toHaveAttribute("data-docked", "true");
  await page.reload();
  await page.getByTestId("node-db").click();
  await expect(page.getByTestId("callout-db")).toHaveAttribute("data-docked", "true");
  await page.getByTestId("callout-db").getByTestId("callout-pin").click();
  await expect(page.getByTestId("callout-db")).toHaveAttribute("data-docked", "false");
});
