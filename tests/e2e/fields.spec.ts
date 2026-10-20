import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { open, savedWhen, shop } from "./helpers";

const withGroup = () => shop((f) => {
  f.views[0].nodes.push(
    { id: "rt", label: "Runtime", kind: "llm", form: "group", icon: null, sub: "", items: [], description: "Holds the loop.", files: [], parent: null, detail: null, place: { row: 1, col: 0 } },
    { id: "llm", label: "LLM", kind: "llm", form: "compact", icon: null, sub: "", items: [], description: "Model.", files: [], parent: "rt", detail: null, place: null },
  );
});

// The picker, in-place edits, the callout's fields and connections are held-out H18, H21, H22 and
// H40. What stays here are the defaults and refusals those do not reach.

test("the picker's default kind is service; a component added inside a group is its child", async ({ page }) => {
  const { path } = await open(page, withGroup());
  await page.getByTestId("tool-component").click();
  const g = (await page.getByTestId("node-rt").boundingBox())!;
  await page.mouse.click(g.x + g.width - 20, g.y + g.height - 14);
  await page.getByTestId("picker-form-compact").click();
  await page.getByTestId("picker-add").click();
  await page.getByTestId("node-label-input").press("Enter");
  const d = await savedWhen(page, path, (x) => x.views[0].nodes.length === 6);
  expect(d.views[0].nodes.at(-1)).toMatchObject({ label: "New component", kind: "service", form: "compact", parent: "rt" });
});

test("Escape cancels a sub-line edit in place", async ({ page }) => {
  const { path } = await open(page);
  const sub = page.getByTestId("node-web").getByTestId("node-sub");
  await sub.dblclick();
  await page.getByTestId("node-sub-input").fill("React SPA");
  await page.getByTestId("node-sub-input").press("Escape");
  await expect(sub).toHaveText("React");
  await sub.dblclick();
  await page.getByTestId("node-sub-input").fill("React SPA");
  await page.getByTestId("node-sub-input").press("Enter");
  await savedWhen(page, path, (x) => x.views[0].nodes[0].sub === "React SPA");
});

test("the callout names the kind it sets, and refuses a file path outside the repository", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("node-db").click();
  const c = page.getByTestId("callout-db");
  await c.getByTestId("callout-kind").click();
  await page.getByTestId("kind-option-worker").click();
  await expect(page.getByTestId("node-db")).toHaveAttribute("data-kind", "worker");
  await expect(c.getByTestId("callout-kind")).toHaveText("Background job");
  await c.getByTestId("callout-file-add").click();
  await c.getByTestId("callout-file-input").fill("src/api.ts");
  await c.getByTestId("callout-file-input").press("Enter");
  await expect(c.getByTestId("callout-file")).toHaveCount(1);
  await c.getByTestId("callout-file-add").click();
  await c.getByTestId("callout-file-input").fill("../secret.txt");
  await c.getByTestId("callout-file-input").press("Enter");
  await expect(c.getByTestId("callout-file")).toHaveCount(1);
  await c.getByTestId("callout-file-input").press("Escape");
  const d = await savedWhen(page, path, (x) => x.views[0].nodes.find((n) => n.id === "db")!.files.length === 1);
  expect(d.views[0].nodes.find((n) => n.id === "db")).toMatchObject({ kind: "worker", files: ["src/api.ts"] });
});

test("a path deleted from the repository is marked in the callout and never blocks a save", async ({ page }) => {
  const { path } = await open(page, shop((f) => { f.views[0].nodes.find((n: { id: string }) => n.id === "db").files = ["src/api.ts"]; }));
  // The file goes away after the drawing was saved.
  rmSync(join(dirname(path), "src", "api.ts"));
  await page.getByTestId("node-db").click();
  const c = page.getByTestId("callout-db");
  await expect(c.getByTestId("callout-file")).toHaveAttribute("data-missing", "true");
  await expect(c.getByTestId("callout-file-missing")).toHaveText("not in the repository");
  await c.getByTestId("callout-file-add").click();
  await c.getByTestId("callout-file-input").fill("web/index.html");
  await c.getByTestId("callout-file-input").press("Enter");
  await savedWhen(page, path, (x) => x.views[0].nodes.find((n) => n.id === "db")!.files.length === 2);
  await expect(c.getByTestId("callout-file").nth(1)).not.toHaveAttribute("data-missing");
  await expect(c.getByTestId("callout-file").first()).toHaveAttribute("data-missing", "true");
  await c.getByTestId("callout-file").first().getByTestId("callout-file-remove").click();
  const d = await savedWhen(page, path, (x) => x.views[0].nodes.find((n) => n.id === "db")!.files.length === 1);
  expect(d.views[0].nodes.find((n) => n.id === "db")!.files).toEqual(["web/index.html"]);
});
