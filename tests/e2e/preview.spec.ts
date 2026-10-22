import { expect, test, type Page } from "@playwright/test";
import { onDisk, open, storedOnDisk } from "./helpers";

// A run's result as a preview (ui contract, Preview, Accept and Undo). Its journeys are held-out
// H138–H140; what stays here they do not observe: the autosave race after Accept, and an Undo whose
// save is refused for a stale token (a faked server answer), a preview that arrives on an empty
// channel's stage, and the callout's footer clear of the preview bar.

async function previewOf(page: Page, instruction: string) {
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill(instruction);
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
}

test("two quick edits after Accept, then a reload, show the second", async ({ page }) => {
  const { path } = await open(page);
  await previewOf(page, "add Cache component");
  await page.getByTestId("ai-accept").click();
  await expect(page.getByTestId("ai-preview")).toHaveCount(0);
  const label = page.getByTestId("node-web").getByTestId("node-label");
  const input = page.getByTestId("node-label-input");
  await label.dblclick();
  await input.fill("First name");
  await input.press("Enter");
  await label.dblclick();
  await input.fill("Second name");
  await input.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("node-web").getByTestId("node-label")).toHaveText("Second name");
  expect(onDisk(path).views[0].nodes.find((n) => n.id === "web")!.label).toBe("Second name");
  expect(onDisk(path).views[0].nodes.some((n) => n.id === "cache")).toBe(true);
});

test("an Undo whose save is refused for a stale token says so in save-status, never Saved", async ({ page }) => {
  const { path } = await open(page);
  await previewOf(page, "add Cache component");
  await page.route("**/api/diagrams/*", (r) => (r.request().method() === "PUT"
    ? r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Missing or wrong token" }) })
    : r.continue()));
  await page.getByTestId("ai-undo").click();
  await expect(page.getByTestId("node-cache")).toHaveCount(0);
  await expect(page.getByTestId("ai-preview")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("The server restarted — reload the page");
  await expect(page.getByTestId("save-retry")).toBeVisible();
  await expect(page.getByTestId("save-status")).not.toHaveText("Saved");
  // The file still holds the result: nothing claimed the Undo was written.
  expect(storedOnDisk(path).facts.components.some((c) => c.id === "cache")).toBe(true);
});

test("a run that changes nothing leaves no undo step", async ({ page }) => {
  await open(page);
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill("leave it alone");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-summary")).toHaveText("Nothing changed", { timeout: 30_000 });
  await expect(page.getByTestId("ai-preview")).toHaveCount(0);
  await expect(page.getByTestId("tool-undo")).toBeDisabled();
});

// When a preview starts the editor goes to the run's channel, even from a channel with no drawing,
// whose stage still holds the overview's first view behind it.
test("a preview that arrives while an empty channel is open goes to the run's channel", async ({ page }) => {
  const { id } = await open(page);
  // The run's result is read once it ends; hold that read until the empty channel is open.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const pattern = `**/api/diagrams/${id}`;
  await page.route(pattern, async (r) => { if (r.request().method() === "GET") await gate; await r.continue(); });
  try {
    await page.getByTestId("ai-button").click();
    await page.getByTestId("ai-input").fill("add Queue component");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-progress")).toBeVisible();
    await page.getByTestId("channel-tab-readme").click();
    await expect(page.getByTestId("editor")).toHaveAttribute("data-channel", "readme");
    await expect(page.getByTestId("channel-empty")).toBeVisible();
    release();
    await expect(page.getByTestId("ai-preview")).toBeVisible({ timeout: 30_000 });
  } finally { release(); await page.unroute(pattern); }
  await expect(page.getByTestId("editor")).toHaveAttribute("data-channel", "overview");
  await expect(page.getByTestId("node-queue")).toHaveAttribute("data-changed", "true");
});

// The preview bar never covers the callout's buttons: "Change this part" is allowed during a preview.
test("the callout's footer can be clicked while a preview is shown", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page);
  await page.getByTestId("node-api").click();
  await page.getByTestId("callout-create-inside").click();
  await expect(page.getByTestId("editor")).not.toHaveAttribute("data-view", "overview");
  const inside = (await page.getByTestId("editor").getAttribute("data-view"))!;
  await page.getByTestId("crumb-overview").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await previewOf(page, "add Cache component");
  await page.getByTestId("node-api").getByTestId("node-inside").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", inside);
  await page.locator("[data-testid=canvas] [data-node-id]").first().click();
  for (const b of ["callout-open-inside", "callout-create-inside", "callout-ask", "callout-delete"]) {
    const el = page.getByTestId(b);
    if (!(await el.count())) continue;
    const box = (await el.boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid"), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit, `${b} is on top`).toBe(b);
  }
  await page.getByTestId("callout-ask").click({ timeout: 3000 });
  await expect(page.getByTestId("ai-input")).toBeFocused();
});
