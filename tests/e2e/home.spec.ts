import { expect, test } from "@playwright/test";

// The home screen's frame. The journeys (the columns and their folds, the theme, the drawings grid, the choosing step,
// the keyboard, the sources: the folder list, the dialog, a link, forgetting) are held-out H229, H230, H236, H245, H27
// and H231–H235. What stays here needs a faked server response: Activity's count, its keep line and the top bar's
// toggle on a given GET /api/activity, a list entry on a given GET /api/sources, the folder list's highlight going
// round, and a link check that answers late.

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

test("the folder list's highlight wraps with ArrowUp and names the option it is on, and Enter takes it", async ({ page }) => {
  const entry = (name: string) => ({ name, path: `C:\\code\\${name}`, branch: "main", lastCommitAt: null, link: null, diagrams: [], usedAt: null });
  await page.route("**/api/sources", (r) => r.fulfill({ json: { picker: false, recent: [entry("shop"), entry("infra")], found: [entry("tools")], foundAt: new Date().toISOString() } }));
  await page.goto("/");
  const folder = page.getByRole("combobox", { name: "Folder of the project" });
  await folder.focus();
  await expect(page.getByTestId("start-folder-option")).toHaveCount(3);
  await expect(folder).not.toHaveAttribute("aria-activedescendant");
  await folder.press("ArrowUp"); // from no highlight to the last entry, the one under Found on this computer
  const on = await folder.getAttribute("aria-activedescendant");
  await expect(page.locator(`[id="${on}"]`)).toHaveAttribute("data-path", "C:\\code\\tools");
  await expect(page.locator(`[id="${on}"]`)).toHaveAttribute("aria-selected", "true");
  await folder.press("ArrowDown"); // and round to the first
  await expect(page.locator(`[id="${await folder.getAttribute("aria-activedescendant")}"]`)).toHaveAttribute("data-path", "C:\\code\\shop");
  await folder.press("Enter");
  await expect(folder).toHaveValue("C:\\code\\shop");
  await expect(page.getByTestId("start-folder-list")).toHaveCount(0);
  await expect(folder).toHaveAttribute("aria-expanded", "false");
});

test("a late answer for a link typed before is dropped: the hint and Scan follow the latest text", async ({ page }) => {
  const answer = (link: string) => ({ folder: `C:\\data\\repos\\${link}`, root: `C:\\data\\repos\\${link}`, git: false, drawing: null, link, branch: null, copied: false });
  await page.route("**/api/folders/check", async (r) => {
    const { link } = r.request().postDataJSON() as { link: string };
    if (link.endsWith("/slow")) { await new Promise((done) => setTimeout(done, 1500)); return r.fulfill({ json: answer("github.com/acme/slow") }); }
    return r.fulfill({ status: 400, json: { error: "Not a repository link" } });
  });
  await page.goto("/");
  await page.getByTestId("start-source-link").click();
  const link = page.getByTestId("start-link"), hint = page.getByTestId("start-link-hint");
  await link.fill("https://github.com/acme/slow");
  await page.waitForRequest((q) => q.url().endsWith("/api/folders/check")); // the check of the first text is on its way
  await link.fill("https://github.com/acme/slow/x");
  await expect(hint).toHaveText("Not a repository link");
  await page.waitForTimeout(1800); // the first answer has arrived by now
  await expect(hint).toHaveText("Not a repository link");
  await expect(hint).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("start-scan")).toBeDisabled();
});

test("a card scrolled under the sticky top bar still opens from its Open button", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  const updatedAt = new Date().toISOString();
  const diagrams = Array.from({ length: 9 }, (_, i) => ({ id: `d_card${i}`, title: `Card ${i}`, path: `C:\\code\\c${i}\\docs\\a.archdraw.json`, root: `C:\\code\\c${i}`, updatedAt }));
  await page.route("**/api/diagrams", (r) => r.fulfill({ json: { diagrams } }));
  await page.route(/\/api\/diagrams\/d_card\d$/, (r) => r.fulfill({ status: 404, json: { error: "Not found" } }));
  await page.goto("/");
  await expect(page.getByTestId("library-item")).toHaveCount(9);
  const card = page.locator('[data-testid="library-item"][data-diagram-id="d_card4"]');
  // The card's top edge, where Open sits, under the 56 px bar, and the pointer on the bar, not on the card: the
  // button must still count as there, and a click must bring it out from under the bar first.
  await card.evaluate((el) => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 24));
  await card.hover();
  await page.mouse.move(800, 20);
  await card.getByTestId("library-open").click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/d\/d_card4/);
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
