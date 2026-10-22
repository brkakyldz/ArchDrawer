import { expect, test, type Page } from "@playwright/test";
import { onDisk, open, savedWhen, shop } from "./helpers";

// An edit past the file's limits (diagram contract, validation) is refused up front with a toast and
// leaves the drawing as it was, so no save is ever stuck on a validator error. The held-out scenarios
// check the validator itself (H107) and the steps' limits (H127); none fills a view, the overview's
// views or empties a post's title in the editor, which is what stays here.

const part = (id: string, i: number) => ({
  id, label: `Part ${i}`, kind: "service", form: "compact", icon: null, sub: "", items: [], description: "A part.",
  files: [], parent: null, detail: null, place: { row: Math.floor(i / 10), col: i % 10 },
});

async function refused(page: Page, toast: string) {
  await expect(page.getByTestId("toast")).toHaveText(toast);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
}

test("a 61st part in a view is refused with a toast", async ({ page }) => {
  const { path } = await open(page, shop((f) => { f.views[0].nodes = Array.from({ length: 60 }, (_, i) => part(`p${i}`, i)); f.views[0].edges = []; }));
  await page.getByTestId("tool-component").click();
  const c = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await refused(page, "A view holds at most 60 parts");
  await expect(page.getByTestId("component-picker")).toHaveCount(0);
  await expect(page.locator("[data-testid=canvas] [data-node-id]")).toHaveCount(60);
  expect(onDisk(path).views[0].nodes).toHaveLength(60);
});

test("a 31st view is refused with a toast, and the editor stays where it was", async ({ page }) => {
  const { path } = await open(page, shop((f) => {
    for (let i = 1; i < 30; i++) {
      f.views.push({ id: `v${i}`, title: `View ${i}`, caption: { title: `View ${i}`, lede: "" }, nodes: [part(`n${i}`, 0)], edges: [], texts: [] });
    }
  }));
  expect(onDisk(path).views).toHaveLength(30);
  await page.getByTestId("node-web").click();
  await page.getByTestId("callout-create-inside").click();
  await refused(page, "The overview holds at most 30 views");
  await expect(page.getByTestId("editor")).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId("tool-undo")).toBeDisabled();
  expect(onDisk(path).views).toHaveLength(30);
  expect(onDisk(path).views[0].nodes.find((n) => n.id === "web")!.detail).toBeNull();
});

test("an empty post title is never saved, and a later edit still is", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("channel-tab-linkedin").click();
  await page.getByTestId("design-post").click();
  await expect(page.getByTestId("ai-preview")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("ai-accept").click();
  const post = () => onDisk(path).views.find((v) => v.postOf)!;
  const before = post().caption.title;
  expect(before.trim()).not.toBe("");
  const title = page.getByTestId("share-caption-title");
  await title.fill("");
  await refused(page, "A post needs a title");
  await title.fill("   ");
  await refused(page, "A post needs a title");
  expect(post().caption.title).toBe(before);
  // Leaving the field shows the saved title again.
  await page.getByTestId("share-caption-lede").click();
  await expect(title).toHaveValue(before);
  await page.getByTestId("share-caption-lede").fill("What it does, in one line");
  await savedWhen(page, path, (d) => d.views.find((v) => v.postOf)!.caption.lede === "What it does, in one line");
  expect(post().caption.title).toBe(before);
  await title.fill("A shorter title");
  await savedWhen(page, path, (d) => d.views.find((v) => v.postOf)!.caption.title === "A shorter title");
});
