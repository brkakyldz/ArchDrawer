import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

// Presenting (ui contract, Presenting and the tour). Its journeys are held-out H158–H161; what stays
// here they do not observe: a refused full screen, forced (H158 accepts either answer), and the
// stricter rule that no key but Space and Enter acts on a focused button.

async function presentation(page: Page) {
  await open(page);
  await page.getByTestId("channel-tab-presentation").click();
  await page.getByTestId("channel-draw").click();
  await expect(page.getByTestId("step-item")).toHaveCount(3, { timeout: 30_000 });
  await page.getByTestId("ai-accept").click();
  await expect(page.getByTestId("present-start")).toBeEnabled();
}

test("a refused full screen leaves the layer open, filling the window, and Escape still leaves it", async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError("Permissions check failed")); };
  });
  await presentation(page);
  await page.getByTestId("present-start").click();
  const layer = page.getByTestId("present");
  await expect(layer).toBeVisible();
  await expect(layer).toHaveAttribute("data-fullscreen", "false");
  await page.waitForTimeout(300); // the refusal has been answered by now
  await expect(layer).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  const fit = await layer.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width - innerWidth, r.height - innerHeight].map(Math.round); });
  expect(fit).toEqual([0, 0, 0, 0]);
  await expect(layer).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(layer).toHaveAttribute("data-index", "1");
  await page.keyboard.press("Escape");
  await expect(layer).toHaveCount(0);
  await expect(page.getByTestId("present-start")).toBeFocused();
});

test("on a focused button only Space and Enter act: the arrows and N move nothing", async ({ page }) => {
  await presentation(page);
  await page.getByTestId("present-start").click();
  const layer = page.getByTestId("present");
  await page.keyboard.press("ArrowRight");
  await expect(layer).toHaveAttribute("data-index", "1");
  await page.getByTestId("present-exit").focus();
  for (const key of ["ArrowRight", "ArrowLeft", "End", "Home", "PageDown", "n"]) await page.keyboard.press(key);
  await page.waitForTimeout(150);
  await expect(layer).toHaveAttribute("data-index", "1");
  await expect(page.getByTestId("present-note")).toHaveCount(0);
  await page.getByTestId("present-note-toggle").focus();
  await page.keyboard.press("ArrowRight");
  await expect(layer).toHaveAttribute("data-index", "1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("present-note")).toBeVisible();
  await expect(layer).toHaveAttribute("data-index", "1");
  await layer.focus();
  await page.keyboard.press("Escape");
  await expect(layer).toHaveCount(0);
});
