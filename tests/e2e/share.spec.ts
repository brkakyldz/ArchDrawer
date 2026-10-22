import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { onDisk, open } from "./helpers";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const noFonts = (svg: string) => svg.replace(/<style>@font-face[\s\S]*?<\/style>/, "");

async function download(page: Page, id: string) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId(id).click()]);
  return { name: d.suggestedFilename(), path: (await d.path())! };
}

// Formats, sizes, file names, PNG scale, focus, readability, the layout report and shortened text
// are held-out H15, H28, H38, H39, H63, H64, H85 and H86; drawing the LinkedIn channel and packaging
// it are H99 and H100.
// What stays here is stricter than those: the browser download byte-equal to the CLI image, a copy
// that must succeed, a post's zone box clear of outside parts, and the undo keys held back by the
// dialog.

test("the downloaded SVG is the CLI image plus embedded fonts", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("share-button").click();
  await page.getByTestId("format-readme").click();
  await page.getByTestId("share-theme-light").click();
  const svg = await download(page, "download-svg");
  const out = join(dirname(path), "cli.svg");
  const r = spawnSync(process.execPath, [join(root, "bin", "archdrawer.mjs"), "svg", path, "--format", "readme", "--theme", "light", "--out", out], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const mine = readFileSync(svg.path, "utf8"), theirs = readFileSync(out, "utf8");
  expect(mine).toContain("@font-face{font-family:Geist;");
  expect(noFonts(mine)).toBe(noFonts(theirs));
});

test("copy puts a PNG on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.getByTestId("share-button").click();
  await page.getByTestId("copy-image").click();
  await expect(page.getByTestId("toast")).toContainText(/copied/i);
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain("image/png");
});

// On the canvas and in the preview, a post's zone holds no outside part.
test("a designed post's zone box holds no outside part on the canvas or in the preview, in both orientations", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("channel-tab-linkedin").click();
  await page.getByTestId("design-post").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "linkedin", { timeout: 15_000 });
  const post = onDisk(path).views.find((v) => v.postOf)!;
  const boxes = async (scope: string, sel: (id: string) => string) => {
    const sels = post.nodes.map((n) => [n.id, sel(n.id)] as const);
    return page.evaluate(([scope, sels]) => sels.flatMap(([id, s]) => {
      const el = document.querySelector(`${scope} ${s}`);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ id, x: r.x, y: r.y, w: r.width, h: r.height }];
    }), [scope, sels] as const);
  };
  const clear = (list: Awaited<ReturnType<typeof boxes>>) => {
    expect(list.map((b) => b.id).sort()).toEqual(post.nodes.map((n) => n.id).sort());
    const parent = new Map(post.nodes.map((n) => [n.id, n.parent]));
    for (const [i, a] of list.entries()) for (const b of list.slice(i + 1)) {
      if (parent.get(a.id) === b.id || parent.get(b.id) === a.id) continue;
      const hit = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(hit, `${a.id}/${b.id}`).toBe(false);
    }
  };
  clear(await boxes("[data-testid=editor]", (id) => `[data-testid="node-${id}"]`));
  await page.getByTestId("share-button").click();
  await expect(page.getByTestId("format-feed")).toHaveAttribute("aria-pressed", "true");
  clear(await boxes("[data-testid=share-preview]", (id) => `[data-node-id="${id}"]`));
  await page.getByTestId("share-advanced-toggle").click();
  await page.getByTestId("format-linkedin").click();
  clear(await boxes("[data-testid=share-preview]", (id) => `[data-node-id="${id}"]`));
});

// The dialog is a modal: the undo keys never reach the drawing behind it.
test("Ctrl+Z and Ctrl+Y do nothing while the share dialog is open", async ({ page }) => {
  const { path } = await open(page);
  const label = page.getByTestId("node-web").getByTestId("node-label");
  await label.dblclick();
  await page.getByTestId("node-label-input").fill("Storefront");
  await page.getByTestId("node-label-input").press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("share-button").click();
  await page.getByTestId("share-preview").click();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("share-preview").locator('[data-node-id="web"] text.label')).toHaveText("Storefront");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  expect(onDisk(path).views[0].nodes.find((n) => n.id === "web")!.label).toBe("Storefront");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-dialog")).toHaveCount(0);
  await expect(label).toHaveText("Storefront");
  // Closed, the keys undo again.
  await page.keyboard.press("Control+z");
  await expect(label).toHaveText("Web app");
});
