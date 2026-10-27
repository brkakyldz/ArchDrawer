import { expect, test } from "@playwright/test";

// The home screen's frame. The journeys (the columns and their folds, the theme, the drawings grid, the choosing step,
// the keyboard) are held-out H229, H230, H236, H245 and H27. What stays here needs a faked server response: Activity
// and the navigation's lists read GET /api/activity and GET /api/sources, which the server lanes of #190 add, so the
// panel's count, its keep line, the top bar's toggle and a list entry are checked on answers the page is given.

const job = (id: string, status: string, waiting = false) => ({ type: "draw", events: `/api/runs/${id}/events`, id, status, waiting, createdAt: "2026-10-27T10:00:00.000Z" });

test("Activity counts the running jobs from GET /api/activity, and the top bar's toggle shows only once the side column folds", async ({ page }) => {
  await page.route("**/api/activity", (r) => r.fulfill({ json: {
    instance: "0123456789abcdef", now: new Date().toISOString(), timeoutMs: 600_000, slots: { total: 2, busy: 2, waiting: 1 },
    jobs: [job("r_a", "running"), job("r_b", "running", true), job("r_c", "succeeded")],
  } }));
  await page.goto("/");
  await expect(page.getByTestId("activity-count")).toHaveText("1 running"); // the waiting one is not counted
  await expect(page.getByTestId("activity-none")).toHaveCount(0);
  await expect(page.getByTestId("activity-keep")).toHaveText("Keeps going if you reload. Up to 2 at once.");
  await expect(page.getByTestId("activity-toggle")).toHaveCount(0);

  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.getByTestId("activity-toggle")).toHaveText("1 running");
  await page.getByTestId("activity-toggle").click();
  await expect.poll(async () => { const b = (await page.getByTestId("activity").boundingBox())!; return b.y >= 0 && b.y < 700; }).toBe(true);
});

test("without GET /api/activity the panel says nothing runs and promises nothing", async ({ page }) => {
  await page.route("**/api/activity", (r) => r.fulfill({ status: 404, json: { error: "Not found" } }));
  await page.goto("/");
  await expect(page.getByTestId("activity-none")).toHaveText("Nothing is running.");
  await expect(page.getByTestId("activity-keep")).toHaveCount(0);
  await expect(page.getByTestId("activity-count")).toHaveCount(0);
});

test("an entry of Recent puts its path in the folder field and focuses Scan, scanning nothing", async ({ page }) => {
  const entry = { name: "shop", path: "C:\\code\\shop", branch: "main", lastCommitAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), link: null, diagrams: [], usedAt: null };
  await page.route("**/api/sources", (r) => r.fulfill({ json: { picker: false, recent: [entry], found: [{ ...entry, name: "infra", path: "C:\\code\\infra", branch: null, lastCommitAt: null }], foundAt: new Date().toISOString() } }));
  const scans: string[] = [];
  page.on("request", (req) => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/scans") scans.push(req.url()); });
  await page.goto("/");
  const recent = page.getByTestId("source-recent").getByTestId("source-item");
  await expect(recent).toHaveAttribute("data-path", entry.path);
  await expect(recent).toContainText("shop");
  await expect(recent).toContainText("main · 3 h ago");
  await expect(page.getByTestId("source-found").getByTestId("source-item")).toHaveText("infra"); // no branch, no commit: the name alone
  await recent.click();
  await expect(page.getByTestId("start-folder")).toHaveValue(entry.path);
  await expect(page.getByTestId("start-scan")).toBeFocused();
  await page.waitForTimeout(300);
  expect(scans).toEqual([]);
});
