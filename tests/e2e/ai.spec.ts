import { expect, test } from "@playwright/test";
import { onDisk, open, savedWhen, storedOnDisk } from "./helpers";

// The AI panel, the one place to type. Its journeys (model, scope, progress, summary, retry, cancel,
// no engine, the conversation) are held-out H24, H25, H30–H33 and H135–H137. What stays here is what
// those do not observe, or need a faked engine list or a faked server answer for, and that a new run
// never shows the previous report.

test("a real engine is chosen over the test engine, and the choice is remembered", async ({ page }) => {
  await page.route("**/api/engines", (r) => r.fulfill({ json: { engines: [
    { id: "fixture", label: "Fixture (test)", available: true, version: "1", detail: "", test: true, models: [] },
    { id: "claude", label: "Claude Code", available: true, version: "9", detail: "", test: false, models: [{ id: "opus", label: "Opus" }] },
    { id: "codex", label: "Codex", available: false, version: null, detail: "not found", test: false, models: [] },
  ] } }));
  await open(page);
  await page.getByTestId("ai-button").click();
  await expect(page.getByTestId("ai-input")).toHaveAttribute("placeholder", "Ask Claude Code to change this drawing");
  await expect(page.getByTestId("ai-engine")).toHaveValue("claude");
  await expect(page.getByTestId("ai-engine").locator("option")).toHaveText(["Test engine (no AI)", "Claude Code"]);
  await page.getByTestId("ai-engine").selectOption("fixture");
  await expect(page.getByTestId("ai-input")).toHaveAttribute("placeholder", "Ask the test engine (no AI) to change this drawing");
  await page.reload();
  await page.getByTestId("ai-button").click();
  await expect(page.getByTestId("ai-input")).toHaveAttribute("placeholder", "Ask the test engine (no AI) to change this drawing");
});

test("a selected-parts run sends that scope and moves only that part; undo puts it back", async ({ page }) => {
  const { path } = await open(page);
  const before = onDisk(path).views[0].nodes;
  await page.getByTestId("node-web").click();
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-scope-selection").check();
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/runs") && r.method() === "POST");
  await page.getByTestId("ai-input").fill("align Web app with Orders DB");
  await page.getByTestId("ai-send").click();
  expect((await sent).postDataJSON().scope).toEqual({ kind: "parts", ids: ["web"] });
  await expect(page.getByTestId("ai-summary")).toHaveText("1 part moved");
  const after = onDisk(path).views[0].nodes;
  const db = before.find((n) => n.id === "db")!;
  expect(after.find((n) => n.id === "web")!.y).toBe(Math.round(db.y! / 8) * 8);
  for (const id of ["api", "db"]) {
    const b = before.find((n) => n.id === id)!;
    expect(after.find((n) => n.id === id)).toMatchObject({ x: b.x, y: b.y });
  }
  await page.getByTestId("tool-undo").click();
  await savedWhen(page, path, (d) => d.views[0].nodes.find((n) => n.id === "web")!.y === before.find((n) => n.id === "web")!.y);
});

test("the panel cannot send an empty instruction, and Escape inside it closes it", async ({ page }) => {
  await open(page);
  await page.getByTestId("ai-button").click();
  await expect(page.getByTestId("ai-send")).toBeDisabled();
  await page.getByTestId("ai-input").fill("add Cache component");
  await expect(page.getByTestId("ai-send")).toBeEnabled();
  await page.getByTestId("ai-input").press("Escape");
  await expect(page.getByTestId("ai-panel")).toHaveCount(0);
});

// After a run the panel shows the kept result's layout report.
test("a finished run shows its layout report; a new run never shows the previous one", async ({ page }) => {
  await open(page);
  await page.getByTestId("ai-button").click();
  await expect(page.getByTestId("ai-panel").getByTestId("layout-report")).toHaveCount(0);
  await page.getByTestId("ai-input").fill("add Cache component");
  await page.getByTestId("ai-send").click();
  const report = page.getByTestId("ai-panel").getByTestId("layout-report");
  await expect(report).toHaveAttribute("data-format", "readme");
  await expect(report).toHaveAttribute("data-view", "overview");
  await expect(report).toHaveAttribute("data-parts", "4");
  // The overview has no count targets (ADR 0007): counts only, and no target warning.
  await expect(report).toContainText(/^\d+ crossings? · \d+ connections? over parts · (nothing cut|\d+ cut) · \d+\.\d px in place · 4 parts · \d+ zones? · \d+ connections? · longest \d\.\d\d/);
  await expect(report.getByTestId("layout-report-warning")).toHaveCount(0);

  await page.getByTestId("ai-input").fill("add Queue component [fixture:slow]");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-cancel")).toBeVisible();
  await expect(report).toHaveCount(0);
  await page.getByTestId("ai-cancel").click();
  await expect(page.getByTestId("ai-error")).toContainText("Cancelled");
  await expect(report).toHaveCount(0);
});


// The run's progress stream refused for good (the server restarted and no longer knows the run):
// the editor ends the run instead of showing it going forever.
test("a run whose progress stream is refused ends as failed and is stopped", async ({ page }) => {
  await open(page);
  await page.route("**/api/runs/*/events", (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Run not found"}' }));
  const stopped = page.waitForRequest((r) => /\/api\/runs\/[^/]+\/cancel$/.test(r.url()) && r.method() === "POST");
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill("add Y [fixture:slow]");
  await page.getByTestId("ai-send").click();
  await stopped;
  await expect(page.getByTestId("ai-progress")).toHaveCount(0);
  await expect(page.getByTestId("ai-error")).toContainText("Lost the connection");
  await expect(page.getByTestId("ai-turn")).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("ai-input")).toHaveValue("add Y [fixture:slow]");
});

// A second send while the first is still on its way (saving, starting) is ignored: the panel
// shows the first run going, never "already running" as a failure.
test("a second send while the first run is starting is ignored, never shown as a failure", async ({ page }) => {
  await open(page);
  let posts = 0;
  await page.route("**/api/runs", async (r) => {
    if (r.request().method() === "POST") { posts++; await new Promise((res) => setTimeout(res, 800)); }
    await r.continue();
  });
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill("add Y [fixture:slow]");
  await page.getByTestId("ai-input").focus();
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("ai-send")).toBeDisabled();
  await expect(page.getByTestId("ai-progress-line").last()).toHaveText(/Working|Reading|Checking|Starting/);
  await page.waitForTimeout(1500);
  expect(posts).toBe(1);
  await expect(page.getByTestId("ai-error")).toHaveCount(0);
  await expect(page.getByTestId("ai-progress")).toBeVisible();
  await page.getByTestId("ai-cancel").click();
  await expect(page.getByTestId("ai-error")).toContainText("Cancelled");
});

// Before a run the client flushes pending saves and pauses edits, so an edit can never
// make the run's result fail on the version check and be thrown away.
test("edits are paused while an instruction runs and work again once it ends", async ({ page }) => {
  const { path } = await open(page);
  const before = JSON.stringify(onDisk(path));
  await page.getByTestId("ai-button").click();
  await page.getByTestId("ai-input").fill("add Y [fixture:slow]");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-progress")).toBeVisible();
  await page.getByTestId("tool-steps").click();
  await expect(page.getByTestId("toast")).toContainText("paused");
  await expect(page.getByTestId("tool-steps")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("node-web").click();
  await page.getByTestId("callout-delete").click();
  await expect(page.getByTestId("node-web")).toBeVisible();
  await expect(page.getByTestId("tool-undo")).toBeDisabled();
  await page.getByTestId("ai-cancel").click();
  await expect(page.getByTestId("ai-error")).toContainText("Cancelled");
  expect(JSON.stringify(onDisk(path))).toBe(before);
  await page.getByTestId("tool-steps").click();
  await savedWhen(page, path, (d) => d.showSteps);
});

// Draw it and Redraw it tell the story from the facts alone; Design the post may read the code.
// H102 and H103 run them through the fixture engine, which ignores the flag: this checks what the
// buttons send.
test("Draw it and Redraw it send readCode false, Design the post does not", async ({ page }) => {
  const { path } = await open(page);
  const sent: unknown[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/runs") && r.method() === "POST") sent.push(r.postDataJSON().readCode); });
  // A run has ended once it was sent and nothing on the page is running any more.
  const ended = async (n: number) => {
    await expect.poll(() => sent.length).toBe(n);
    await expect(page.getByTestId("share-run")).toHaveCount(0, { timeout: 15_000 });
  };

  await page.getByTestId("channel-tab-linkedin").click();
  await page.getByTestId("channel-draw").click();
  await ended(1);
  await expect(page.getByTestId("linkedin-panel")).toBeVisible();
  await page.getByTestId("design-post").click();
  await ended(2);

  // Deleting a part the post shows marks the LinkedIn channel.
  await page.getByTestId("channel-tab-overview").click();
  await page.getByTestId("node-db").click();
  await page.keyboard.press("Delete");
  await savedWhen(page, path, () => storedOnDisk(path).channels.linkedin.outdated.length > 0);
  await page.getByTestId("channel-tab-linkedin").click();
  await page.getByTestId("channel-redraw").click();
  await expect(page.getByTestId("channel-outdated")).toHaveCount(0, { timeout: 15_000 });

  // Draw it, Design the post, Redraw it: only Design the post may read the code.
  expect(sent.map((readCode) => readCode === false)).toEqual([true, false, true]);
});

test("Simplify the overview started on the LinkedIn tab simplifies the overview and shows it", async ({ page }) => {
  await open(page);
  await page.getByTestId("channel-tab-linkedin").click();
  await page.getByTestId("design-post").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "linkedin", { timeout: 15_000 });
  await page.getByTestId("ai-button").click();
  await page.getByTestId("simplify-overview").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-channel", "overview");
  await expect(page.getByTestId("node-system-map")).toBeVisible({ timeout: 15_000 });
});
