import { expect, test, type Page } from "@playwright/test";
import { open, storedOnDisk } from "./helpers";

// The presentation's steps panel (ui contract, steps-panel). Its journeys are held-out H126–H128;
// what stays here they do not observe: a step that is undone away lights and dims nothing, and an
// empty step text is never saved.

async function presentation(page: Page) {
  const opened = await open(page);
  await page.getByTestId("channel-tab-presentation").click();
  await page.getByTestId("channel-draw").click();
  await expect(page.getByTestId("step-item")).toHaveCount(3, { timeout: 30_000 });
  return opened;
}

test("a current step that an undo takes away leaves nothing dimmed", async ({ page }) => {
  await presentation(page);
  await page.getByTestId("step-item").first().click();
  await expect(page.locator('[data-dim="true"]').first()).toBeVisible();
  await page.getByTestId("step-add").click();
  await expect(page.getByTestId("step-item")).toHaveCount(4);
  await page.getByTestId("tool-undo").click();
  await expect(page.getByTestId("step-item")).toHaveCount(3);
  await expect(page.locator('[data-testid="step-item"][aria-current="true"]')).toHaveCount(0);
  await expect(page.locator('[data-dim="true"]')).toHaveCount(0);
});

test("an emptied step text is never saved; a typed one is saved trimmed", async ({ page }) => {
  const { path } = await presentation(page);
  await page.getByTestId("step-item").first().click();
  const text = page.getByTestId("step-text");
  const before = storedOnDisk(path).channels.presentation.steps![0].text;
  await text.fill("   ");
  await expect(text).toHaveValue("   ");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  expect(storedOnDisk(path).channels.presentation.steps![0].text).toBe(before);
  await text.fill("  Our own words ");
  await expect.poll(() => storedOnDisk(path).channels.presentation.steps![0].text).toBe("Our own words");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("step-note").click();
  await expect(text).toHaveValue("Our own words");
});
