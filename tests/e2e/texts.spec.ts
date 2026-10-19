import { expect, test } from "@playwright/test";
import { centre, drag, onDisk, open, savedWhen } from "./helpers";

// Free text typed in place, sized by presets or by dragging a corner.
// Typing, the XL preset, the SE corner, editing, moving and deleting with undo are held-out H23; a
// v2.0 file's notes becoming texts is src/core/model.test.ts. What stays here is the keyboard path
// (Escape commits), the borderless editor that grows as you type, and the NW corner.
test("type a text in place, size it with a preset and by its corner, edit, move and delete it", async ({ page }) => {
  const { path } = await open(page);
  await page.getByTestId("tool-text").click();
  const c = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.click(c.x + 80, c.y + 60);

  // The editor is the text itself: no border, no background, nothing typed yet.
  const input = page.getByTestId("text-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  const look = await input.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, bg: s.backgroundColor }; });
  expect(look).toEqual({ border: "0px", bg: "rgba(0, 0, 0, 0)" });
  const w0 = (await input.boundingBox())!.width;
  await page.keyboard.type("How an order flows");
  await expect.poll(async () => (await input.boundingBox())!.width).toBeGreaterThan(w0 + 60);
  await page.keyboard.press("Escape");
  let d = await savedWhen(page, path, (x) => x.views[0].texts.length === 1);
  const id = d.views[0].texts[0].id;
  expect(d.views[0].texts[0]).toMatchObject({ text: "How an order flows", size: 20 });
  const text = page.getByTestId(`text-${id}`);
  await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");

  // A preset from its toolbar.
  await text.click();
  const bar = page.getByTestId("text-toolbar");
  await expect(bar.getByTestId("text-size-m")).toHaveAttribute("aria-pressed", "true");
  await bar.getByTestId("text-size-xl").click();
  d = await savedWhen(page, path, (x) => x.views[0].texts[0].size === 40);

  // Any size by a corner: the opposite corner stays where it was.
  const before = d.views[0].texts[0];
  const box0 = (await text.boundingBox())!;
  await drag(page, await centre(page.getByTestId("text-handle-se")), { x: box0.x + box0.width * 1.5, y: box0.y + box0.height * 1.5 });
  d = await savedWhen(page, path, (x) => x.views[0].texts[0].size > 50);
  expect(d.views[0].texts[0]).toMatchObject({ x: before.x, y: before.y });
  const big = d.views[0].texts[0];
  const box1 = (await text.boundingBox())!;
  // On screen too: the outline's top left did not move, however much the glyphs grew.
  expect(Math.abs(box1.x - box0.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box1.y - box0.y)).toBeLessThanOrEqual(1);
  await drag(page, await centre(page.getByTestId("text-handle-nw")), { x: box1.x + box1.width * 0.5, y: box1.y + box1.height * 0.5 });
  d = await savedWhen(page, path, (x) => x.views[0].texts[0].size < big.size - 10);
  const box2 = (await text.boundingBox())!;
  expect(Math.abs(box2.x + box2.width - (box1.x + box1.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(box2.y + box2.height - (box1.y + box1.height))).toBeLessThanOrEqual(1);
  await page.getByTestId("tool-undo").click();
  await savedWhen(page, path, (x) => x.views[0].texts[0].size === big.size);

  // Edit in place: the drawn text hides under the editor; Escape keeps what was typed.
  await text.dblclick();
  await expect(page.getByTestId("text-input")).toHaveValue("How an order flows");
  await expect(text).toBeHidden();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("end to end");
  await page.keyboard.press("Escape");
  d = await savedWhen(page, path, (x) => x.views[0].texts[0].text === "How an order flows\nend to end");

  // Move: it lands on the grid.
  const t0 = onDisk(path).views[0].texts[0];
  const at = await centre(text);
  await drag(page, at, { x: at.x + 50, y: at.y + 30 });
  d = await savedWhen(page, path, (x) => x.views[0].texts[0].x > t0.x + 20 && Math.abs(x.views[0].texts[0].x % 8) === 0 && Math.abs(x.views[0].texts[0].y % 8) === 0);

  // Delete from the toolbar; undo brings it back; an emptied text is deleted.
  await text.click();
  await page.getByTestId("text-toolbar").getByTestId("text-delete").click();
  await expect(text).toHaveCount(0);
  await page.getByTestId("tool-undo").click();
  await expect(text).toBeVisible();
  await text.dblclick();
  await page.getByTestId("text-input").fill("");
  await page.keyboard.press("Control+Enter");
  await savedWhen(page, path, (x) => x.views[0].texts.length === 0);

  // Nothing typed, nothing added.
  await page.getByTestId("tool-text").click();
  await page.mouse.click(c.x + 80, c.y + 60);
  await expect(page.getByTestId("text-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("text-input")).toHaveCount(0);
  await expect(page.locator("[data-text-id]")).toHaveCount(0);
});
