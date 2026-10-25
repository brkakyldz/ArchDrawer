import { expect, test } from "@playwright/test";
import { open, shop } from "./helpers";

const withDetail = () => shop((f) => {
  f.views[0].nodes[1].detail = "api-inside";
  f.views.push({
    id: "api-inside", title: "Order API", caption: { title: "Inside the order API", lede: "" },
    nodes: [
      { id: "router", label: "Router", kind: "api", form: "card", icon: null, sub: "", items: [], description: "Routes.", files: [], parent: null, detail: null, place: { row: 0, col: 0 } },
      { id: "orders", label: "Orders", kind: "service", form: "card", icon: null, sub: "", items: [], description: "Creates orders.", files: [], parent: null, detail: null, place: { row: 0, col: 1 } },
    ],
    edges: [{ from: "router", to: "orders", label: "", style: "call", both: false, step: null }],
    texts: [],
  });
});

// Callouts, drilling in and creating a detail view are held-out H18 and H20. What stays here: the
// URL after drilling, the callout's own way in, a second click closing a callout, and undo of a
// created view returning to the overview.

test("a second click closes a callout; drilling in puts the view in the URL; the callout opens it too", async ({ page }) => {
  const { id } = await open(page, withDetail());
  await page.getByTestId("node-db").click();
  await expect(page.getByTestId("callout-db")).toBeVisible();
  await page.getByTestId("node-db").click();
  await expect(page.getByTestId("callout-db")).toHaveCount(0);
  await page.getByTestId("node-api").getByTestId("node-inside").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "api-inside");
  await expect(page).toHaveURL(new RegExp(`/d/${id}\\?choice=system&channel=overview&view=api-inside$`));
  await page.getByTestId("crumb-overview").click();
  await page.getByTestId("node-api").click();
  await page.getByTestId("callout-open-inside").click();
  await expect(page.getByTestId("node-orders")).toBeVisible();
});

test("undo of a created inside view returns to the overview", async ({ page }) => {
  await open(page);
  await page.getByTestId("node-db").click();
  await page.getByTestId("callout-create-inside").click();
  await expect(page.getByTestId("editor")).not.toHaveAttribute("data-view", "overview");
  await page.getByTestId("tool-undo").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
});

// Going to a view shows it at its fitted zoom in the same frame, so a zoom read
// once the view shows is never taken back by a fit a frame later.
test("going to another view shows it at its own fitted zoom from its first frame", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const v = document.querySelector("[data-testid=editor]")?.getAttribute("data-view"), z = document.querySelector("[data-testid=zoom-level]")?.textContent;
      if (v && z && seen[seen.length - 1] !== `${v} ${z}`) seen.push(`${v} ${z}`);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await open(page, (() => {
    const f = withDetail(), db = f.views[0].nodes.find((n: { id: string }) => n.id === "db");
    for (let i = 0; i < 14; i++) f.views[0].nodes.push({ ...db, id: `part${i}`, label: `Part ${i}`, place: { row: 3, col: i } });
    return f;
  })());
  await page.getByTestId("views-entry-api-inside").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "api-inside");
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  const overview = seen.filter((s) => s.startsWith("overview ")), inside = seen.filter((s) => s.startsWith("api-inside "));
  expect(overview).toHaveLength(1);
  expect(inside).toHaveLength(1);
  expect(inside[0]).not.toBe(overview[0].replace("overview", "api-inside"));
});
