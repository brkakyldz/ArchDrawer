import { expect, test } from "@playwright/test";
import { open, shop } from "./helpers";

// #184 with the ui contract's double-click on a label (H108 observes a plain part): a double-click on a part with an
// inside renames it even when its inside holds, under the pointer, another part with an inside (review 85af372-1), and a
// double-click on its sub-line edits the sub-line (review 85af372-2).

const part = (id: string, label: string, detail: string | null, sub = "") =>
  ({ id, label, kind: "service", form: "card", icon: null, sub, items: [], description: "A part.", files: [], parent: null, detail, place: { row: 0, col: 0 } });
const view = (id: string, nodes: unknown[]) => ({ id, title: id, caption: { title: id, lede: "" }, nodes, edges: [], texts: [] });

test("a double-click on a part with an inside edits that part, not the one its inside holds under the pointer", async ({ page }) => {
  await open(page, shop((f) => {
    f.views[0].nodes = [part("a", "Alpha", "a-inside", "front door")];
    f.views[0].edges = [];
    f.views.push(view("a-inside", [part("b", "Beta", "b-inside")]), view("b-inside", [part("c", "Gamma", null)]));
  }));
  await page.getByTestId("node-a").getByTestId("node-label").dblclick();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId("node-label-input")).toHaveValue("Alpha");
  await page.getByTestId("node-label-input").press("Escape");

  await page.getByTestId("node-a").getByTestId("node-sub").dblclick();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId("node-sub-input")).toHaveValue("front door");
  await page.getByTestId("node-sub-input").press("Escape");

  // A single click still goes in, and a second single click later goes in again from there.
  await page.getByTestId("node-a").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "a-inside");
  await page.waitForTimeout(700);
  await page.getByTestId("node-b").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "b-inside");
});
