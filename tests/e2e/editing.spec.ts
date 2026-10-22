import { expect, test, type Page } from "@playwright/test";
import { renameSync, writeFileSync } from "node:fs";
import type { Document3 } from "../../src/core/file3";
import { onDisk, open, savedWhen, storedOnDisk } from "./helpers";

// Selecting, dragging, grouping, deleting with undo, outside changes and the 409 conflict are
// held-out H19 and H26. What stays here: the keyboard path, a failed save (H26 can only make a
// save fail on POSIX; on Windows this is the one check that a failed save never says Saved), and
// undo after an outside change was adopted, which H26 does not try.

/** A session's atomic write of the stored file, with the web part renamed and a newer version. */
function outsideWrite(path: string, label: string, updatedAt: string) {
  const d: Document3 = storedOnDisk(path);
  d.facts.components.find((c) => c.id === "web")!.label = label;
  d.updatedAt = updatedAt;
  writeFileSync(`${path}.session.tmp`, JSON.stringify(d, null, 2));
  renameSync(`${path}.session.tmp`, path);
}

const webLabel = (page: Page) => page.getByTestId("node-web").getByTestId("node-label");

async function rename(page: Page, label: string) {
  await webLabel(page).dblclick();
  await page.getByTestId("node-label-input").fill(label);
  await page.getByTestId("node-label-input").press("Enter");
}

/** After an adopted outside change, undo and redo have nothing to step to: the file's version stays. */
async function historyStartsAt(page: Page, path: string, label: string) {
  await expect(page.getByTestId("tool-undo")).toBeDisabled();
  await expect(page.getByTestId("tool-redo")).toBeDisabled();
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await expect(webLabel(page)).toHaveText(label);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.waitForTimeout(600);
  expect(onDisk(path).views[0].nodes.find((n) => n.id === "web")!.label).toBe(label);
  // The next edit is undoable again, back to the file's version.
  await rename(page, "Mine again");
  await savedWhen(page, path, (d) => d.views[0].nodes.find((n) => n.id === "web")!.label === "Mine again");
  await page.getByTestId("tool-undo").click();
  await savedWhen(page, path, (d) => d.views[0].nodes.find((n) => n.id === "web")!.label === label);
}

test("undo after Updated from the file never writes the editor's older version over it", async ({ page }) => {
  const { path } = await open(page);
  await rename(page, "Storefront");
  await savedWhen(page, path, (d) => d.views[0].nodes.find((n) => n.id === "web")!.label === "Storefront");
  outsideWrite(path, "Session storefront", "2098-01-01T00:00:00.000Z");
  await expect(webLabel(page)).toHaveText("Session storefront", { timeout: 5000 });
  await expect(page.getByTestId("toast")).toHaveText("Updated from the file");
  await historyStartsAt(page, path, "Session storefront");
});

test("undo after loading the file's version on a conflict never writes the editor's version over it", async ({ page }) => {
  const { id, path } = await open(page);
  await rename(page, "Storefront");
  await savedWhen(page, path, (d) => d.views[0].nodes.find((n) => n.id === "web")!.label === "Storefront");
  // The local save waits until the session has written the file, so it gets 409.
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const put = new Promise<void>((r) => { reached = r; });
  const pattern = `**/api/diagrams/${id}`;
  await page.route(pattern, async (r) => { if (r.request().method() === "PUT") { reached(); await gate; } await r.continue(); });
  try {
    await rename(page, "Unsaved local version");
    await put;
    outsideWrite(path, "Newer session version", "2099-01-01T00:00:00.000Z");
    release();
    await expect(page.getByTestId("save-reload")).toBeVisible();
  } finally { release(); await page.unroute(pattern); }
  await page.getByTestId("save-reload").click();
  await expect(webLabel(page)).toHaveText("Newer session version");
  await historyStartsAt(page, path, "Newer session version");
});

test("the drawing's change stream is opened once, not again on every edit", async ({ page }) => {
  let streams = 0;
  page.on("request", (r) => { if (/\/api\/diagrams\/[^/]+\/events$/.test(r.url())) streams++; });
  const { path } = await open(page);
  await expect.poll(() => streams).toBeGreaterThan(0);
  const opened = streams;
  await page.getByTestId("tool-steps").click();
  await page.getByTestId("tool-theme").click();
  await page.getByTestId("node-web").click();
  await savedWhen(page, path, (d) => d.showSteps && d.theme === "dark");
  expect(streams).toBe(opened);
});

test("Escape clears the selection, Delete removes, and the keyboard undoes and redoes", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("node-web").click();
  await page.getByTestId("node-db").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-selected=true]")).toHaveCount(0);
  await page.getByTestId("node-db").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("node-db")).toHaveCount(0);
  await expect(page.getByTestId("edge-e2")).toHaveCount(0);
  await savedWhen(page, path, (d) => d.views[0].nodes.length === 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("node-db")).toBeVisible();
  await expect(page.getByTestId("edge-e2")).toBeVisible();
  await savedWhen(page, path, (d) => d.views[0].nodes.length === 3);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect(page.getByTestId("node-db")).toHaveCount(0);
  await expect(page.getByTestId("tool-redo")).toBeDisabled();
});

test("a failed save is never shown as Saved and can be retried", async ({ page }) => {
  const { path } = await open(page);
  await page.route("**/api/diagrams/*", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 500, body: JSON.stringify({ error: "Disk full" }) }) : r.continue()));
  await page.getByTestId("tool-steps").click();
  await expect(page.getByTestId("save-status")).toContainText("Disk full");
  await expect(page.getByTestId("save-status")).not.toHaveText("Saved");
  await page.unroute("**/api/diagrams/*");
  await page.getByTestId("save-retry").click();
  await savedWhen(page, path, (d) => d.showSteps);
});
