import { expect, test, type Page } from "@playwright/test";
import { open, painted, shop } from "./helpers";

// The views menu, the pinned callout and the narrow header are held-out H35 and H36, and so is
// search as a journey (H35). What stays here: the keyboard path (Ctrl/Cmd+K, Enter and Shift+Enter,
// the arrow keys into another view's match, Escape), the stricter checks that a highlight never
// changes a part's size and that stepping leaves an on-screen view where it is, and a pin that
// outlives a reload while pinned.

const withDetail = () => shop((f) => {
  f.views[0].nodes[1].detail = "api-inside";
  f.views.push({
    id: "api-inside", title: "Order API", caption: { title: "Inside the order API", lede: "" },
    nodes: [
      { id: "router", label: "Router", kind: "api", form: "card", icon: null, sub: "", items: [], description: "Routes.", files: [], parent: null, detail: null, place: { row: 0, col: 0 } },
      { id: "orders", label: "Orders queue", kind: "service", form: "card", icon: null, sub: "", items: [], description: "Queues orders.", files: [], parent: null, detail: null, place: { row: 0, col: 1 } },
    ],
    edges: [{ from: "router", to: "orders", label: "", style: "call", both: false, step: null }],
    texts: [],
  });
});

const box = async (page: Page, id: string) => { await painted(page); return (await page.getByTestId(`node-${id}`).boundingBox())!; };

test("search lights the matches, steps through them with Enter and Shift+Enter, and Escape keeps the last one selected", async ({ page }) => {
  await open(page, withDetail());
  const before = { db: await box(page, "db"), api: await box(page, "api") };
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByTestId("search-input");
  await expect(input).toBeFocused();
  await input.fill("order");
  await expect(page.getByTestId("search-count")).toHaveText("2 matches");
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-match", "true");
  await expect(page.getByTestId("node-api")).toHaveAttribute("data-match", "true");
  await expect(page.getByTestId("node-web")).toHaveAttribute("data-dim", "true");
  await expect(page.getByTestId("node-web")).not.toHaveAttribute("data-match");
  // The highlight is drawn around a part, never by resizing it, and typing moves nothing.
  expect(await box(page, "db")).toEqual(before.db);
  expect(await box(page, "api")).toEqual(before.api);

  await input.press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 2");
  await expect(page.getByTestId("node-api")).toHaveAttribute("data-match", "current");
  await expect(page.getByTestId("node-api")).toHaveAttribute("data-selected", "true");
  await input.press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("2 of 2");
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-match", "current");
  await input.press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 2");
  await input.press("Shift+Enter");
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-match", "current");
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("node-api")).toHaveAttribute("data-selected", "false");
  // Both matches were on screen: the view did not move.
  expect(await box(page, "db")).toEqual(before.db);
  await expect(page.getByTestId("search")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search")).toHaveCount(0);
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("node-web")).not.toHaveAttribute("data-dim");
  await expect(page.getByTestId("node-db")).not.toHaveAttribute("data-match");
});

test("a match off screen is brought into view; the arrow keys and Enter open a match in another view", async ({ page }) => {
  await open(page, withDetail());
  for (let i = 0; i < 6; i++) await page.getByTestId("zoom-in").click();
  const stage = (await page.locator("main.stage").boundingBox())!;
  const off = (b: { x: number; y: number; width: number; height: number }) =>
    b.x < stage.x || b.y < stage.y || b.x + b.width > stage.x + stage.width || b.y + b.height > stage.y + stage.height;
  expect(off(await box(page, "web"))).toBe(true);

  await page.keyboard.press("/");
  const input = page.getByTestId("search-input");
  await input.fill("web");
  await expect(page.getByTestId("search-count")).toHaveText("1 match");
  await input.press("Enter");
  await expect(page.getByTestId("node-web")).toHaveAttribute("data-match", "current");
  // The view settles a frame or more after the match is marked current (slower runners).
  await expect.poll(async () => off(await box(page, "web"))).toBe(false);
  const shown = await box(page, "web");
  await input.press("Enter"); // the only match, already on screen: nothing moves
  expect(await box(page, "web")).toEqual(shown);

  await input.fill("queue");
  await expect(page.getByTestId("search-count")).toHaveText("No match in this view");
  const listed = page.getByTestId("search-result");
  await expect(listed).toHaveCount(1);
  await expect(listed).toHaveAttribute("data-view", "api-inside");
  await expect(listed).toHaveAttribute("data-node-id", "orders");
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { selected: true })).toContainText("Orders queue");
  await input.press("Enter");
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "api-inside");
  await expect(page.getByTestId("node-orders")).toHaveAttribute("data-match", "current");
  await expect(page.getByTestId("node-orders")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 1");
  await expect(input).toBeFocused();
  await expect(page.getByTestId("search-result")).toHaveCount(0);
  // Escape outside the search closes it too, before it would clear the selection.
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search")).toHaveCount(0);
  await expect(page.getByTestId("node-orders")).toHaveAttribute("data-selected", "true");
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
