import { expect, test } from "@playwright/test";
import { open, shop } from "./helpers";

// #184 with the ui contract's double-click on a label (H108 renames a part with an inside whose inside holds no part
// under the pointer). What stays here: an inside that holds another part with an inside under the pointer (review
// 85af372-1), the sub-line, and below the label of a part with no sub-line (review fbb2e5d-2), a slow second click that
// still goes in with no callout (review fbb2e5d-1), a cancelled press (review cbe4f6a-1), and a double-click in a detail view soon after going in (H20).

const part = (id: string, label: string, detail: string | null, sub = "") =>
  ({ id, label, kind: "service", form: "card", icon: null, sub, items: [], description: "A part.", files: [], parent: null, detail, place: { row: 0, col: 0 } });
const view = (id: string, nodes: unknown[]) => ({ id, title: id, caption: { title: id, lede: "" }, nodes, edges: [], texts: [] });
const nested = (sub: string) => shop((f) => {
  f.views[0].nodes = [part("a", "Alpha", "a-inside", sub)];
  f.views[0].edges = [];
  f.views.push(view("a-inside", [part("b", "Beta", "b-inside")]), view("b-inside", [part("c", "Gamma", null)]));
});

test("a double-click on a part with an inside edits that part, not the one its inside holds under the pointer", async ({ page }) => {
  await open(page, nested("front door"));
  await page.getByTestId("node-a").getByTestId("node-label").dblclick();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId("node-label-input")).toHaveValue("Alpha");
  await page.getByTestId("node-label-input").press("Escape");

  await page.getByTestId("node-a").getByTestId("node-sub").dblclick();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId("node-sub-input")).toHaveValue("front door");
  await page.getByTestId("node-sub-input").press("Escape");
});

test("below the label of a part with an inside and no sub-line, a double-click adds a sub-line", async ({ page }) => {
  await open(page, nested(""));
  const label = (await page.getByTestId("node-a").getByTestId("node-label").boundingBox())!;
  await page.mouse.dblclick(label.x + label.width / 2, label.y + label.height + 14);
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId("node-sub-input")).toBeVisible();
  await expect(page.getByTestId("node-label-input")).toHaveCount(0);
});

test("a second click after the double-click time goes in again, selecting nothing and opening no callout", async ({ page }) => {
  await open(page, nested(""));
  await page.getByTestId("node-a").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "a-inside");
  await page.waitForTimeout(550);
  await page.getByTestId("node-b").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "b-inside");
  await expect(page.locator('[data-testid^="callout-"]')).toHaveCount(0);
  await expect(page.getByTestId("node-c")).toHaveAttribute("data-selected", "false");
});

test("a cancelled press on a part with an inside goes nowhere, now or on the next click", async ({ page }) => {
  await open(page, nested(""));
  const a = (await page.getByTestId("node-a").boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // The browser takes the pointer away (a pen's press-and-hold, a touch scroll): pointercancel, and no click follows.
  await page.getByTestId("canvas").dispatchEvent("pointercancel", { bubbles: true, pointerId: 1, isPrimary: true });
  const header = (await page.getByTestId("crumbs").boundingBox())!;
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
  await page.mouse.up();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  // A later ordinary click on empty canvas must not carry the cancelled press into A's inside (review cbe4f6a-1).
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.click(canvas.x + 12, canvas.y + canvas.height - 12);
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
});

test("a double-click on a plain part right after going in renames that part where it is", async ({ page }) => {
  await open(page, shop((f) => {
    f.views[0].nodes = [part("a", "Alpha", "a-inside")];
    f.views[0].edges = [];
    f.views.push(view("a-inside", [part("v", "Validator", null), { ...part("w", "Writer", null), place: { row: 0, col: 1 } }]));
  }));
  await page.getByTestId("node-a").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "a-inside");
  await page.getByTestId("node-v").getByTestId("node-label").dblclick();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "a-inside");
  await expect(page.getByTestId("node-label-input")).toHaveValue("Validator");
});
