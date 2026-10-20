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
// are held-out H15, H28, H38, H39, H63, H64, H85 and H86; the LinkedIn post flow has none, since it
// is rebuilt with the channels.
// What stays here is stricter than those: the browser download byte-equal to the CLI image, a copy
// that must succeed, and a post's zone box clear of outside parts.

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
  await page.getByTestId("share-button").click();
  await page.getByTestId("format-feed").click();
  await page.getByTestId("design-post").click();
  await expect(page.getByTestId("share-preview")).toHaveAttribute("data-view", "overview-linkedin", { timeout: 15_000 });
  const post = onDisk(path).views.find((v) => v.postOf === "overview")!;
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
  clear(await boxes("[data-testid=share-preview]", (id) => `[data-node-id="${id}"]`));
  await page.getByTestId("share-advanced-toggle").click();
  await page.getByTestId("format-linkedin").click();
  clear(await boxes("[data-testid=share-preview]", (id) => `[data-node-id="${id}"]`));
  await page.getByTestId("linkedin-edit").click();
  clear(await boxes("[data-testid=editor]", (id) => `[data-testid="node-${id}"]`));
});
