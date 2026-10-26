import { expect, test } from "@playwright/test";
import { open, shop } from "./helpers";

// #184 (ui contract, Opening a part's inside): H203 observes Enter and Tab on a drawing whose groups come first. What
// stays here is review 6adef2e-2: a group after a part in the view's order, where the page's own order from the last
// part would go back to the first, so Tab past the last part with an inside must leave the canvas.

const inside = (id: string) => ({
  id, title: id, caption: { title: id, lede: "" },
  nodes: [{ id: `${id}-x`, label: "X", kind: "service", form: "card", icon: null, sub: "", items: [], description: "A part.", files: [], parent: null, detail: null, place: { row: 0, col: 0 } }],
  edges: [], texts: [],
});

test("Tab walks the parts with an inside in the view's order and then leaves the canvas", async ({ page }) => {
  await open(page, shop((f) => {
    f.views[0].nodes = [
      { id: "a", label: "Alpha", kind: "service", form: "card", icon: null, sub: "", items: [], description: "A part.", files: [], parent: null, detail: "a-inside", place: { row: 0, col: 0 } },
      { id: "g", label: "Zone", kind: "service", form: "group", icon: null, sub: "", items: [], description: "A group.", files: [], parent: null, detail: "g-inside", place: { row: 0, col: 1 } },
      { id: "m", label: "Member", kind: "data", form: "card", icon: null, sub: "", items: [], description: "A member.", files: [], parent: "g", detail: null, place: { row: 0, col: 0 } },
    ];
    f.views[0].edges = [];
    f.views.push(inside("a-inside"), inside("g-inside"));
  }));
  const focused = () => page.evaluate(() => {
    const a = document.activeElement;
    return a?.getAttribute("data-testid") ?? a?.tagName.toLowerCase() ?? null;
  });
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Tab");
  await expect.poll(focused).toBe("node-a");
  await page.keyboard.press("Tab");
  await expect.poll(focused).toBe("node-g");
  await page.keyboard.press("Tab");
  // Out of the canvas: neither a part nor the canvas itself.
  const out = await focused();
  expect(out).not.toMatch(/^node-/);
  expect(out).not.toBe("canvas");
  expect(await page.evaluate(() => !!document.activeElement && !document.querySelector('[data-testid="canvas"]')!.contains(document.activeElement))).toBe(true);
  // Shift+Tab from the first part goes back to the canvas.
  await page.getByTestId("node-a").focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(focused).toBe("canvas");
});
