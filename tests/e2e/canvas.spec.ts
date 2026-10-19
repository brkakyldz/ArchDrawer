import { expect, test } from "@playwright/test";
import { open, painted, shop, zoom } from "./helpers";

// Opening, editor/export parity, zoom buttons, theme, steps and the library are held-out H17, H20,
// H27, H36 and H41. What stays here is how the canvas pans: by how much, and with which keys; and
// that a large drawing shows only its fitted zoom from the first frame.

test("the pan tool, Space+drag and right-drag pan by the distance dragged; v, Escape and fit go back", async ({ page }) => {
  await open(page);
  const k0 = await zoom(page);
  const c = (await page.getByTestId("canvas").boundingBox())!;
  const x0 = async () => (await page.getByTestId("node-web").boundingBox())!.x;
  await painted(page);

  let before = await x0();
  await page.getByTestId("tool-pan").click();
  await expect(page.getByTestId("tool-pan")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(c.x + 300, c.y + 300);
  await page.mouse.down();
  await page.mouse.move(c.x + 380, c.y + 340, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await x0()) - before)).toBe(80);
  await page.keyboard.press("v");
  await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("tool-pan").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
  // Space must reach the canvas, not the tool button that has focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  before = await x0();
  await page.mouse.move(c.x + 300, c.y + 300);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(c.x + 360, c.y + 320, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(async () => Math.round((await x0()) - before)).toBe(60);
  await expect(page.locator("[data-selected=true]")).toHaveCount(0);

  before = await x0();
  await page.mouse.move(c.x + 300, c.y + 300);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(c.x + 260, c.y + 300, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => Math.round((await x0()) - before)).toBe(-40);

  // Dragging across components and labels leaves no page text selected.
  const web = (await page.getByTestId("node-web").boundingBox())!;
  await page.mouse.move(web.x - 30, web.y + web.height / 2);
  await page.mouse.down();
  await page.mouse.move(web.x + web.width + 200, web.y + web.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => String(window.getSelection() ?? ""))).toBe("");

  await page.getByTestId("zoom-in").click();
  await page.getByTestId("zoom-fit").click();
  expect(await zoom(page)).toBeCloseTo(k0, 2);
});

// A drawing opens at its fitted zoom; the toolbar never shows a provisional
// 100 % (and `full`) that the fit then takes back, so a level read on arrival is the real one.
test("a drawing too large for the screen shows only its fitted zoom and level from the first frame", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const z = document.querySelector("[data-testid=zoom-level]")?.textContent, d = document.querySelector("[data-testid=canvas]")?.getAttribute("data-detail");
      if (z && d && seen[seen.length - 1] !== `${z} ${d}`) seen.push(`${z} ${d}`);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await open(page, shop((f) => {
    const db = f.views[0].nodes.find((n: { id: string }) => n.id === "db");
    for (let i = 0; i < 14; i++) f.views[0].nodes.push({ ...db, id: `part${i}`, label: `Part ${i}`, place: { row: 3, col: i } });
  }));
  await painted(page);
  const k = await zoom(page);
  expect(k).toBeLessThan(0.75);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen).toEqual([seen[seen.length - 1]]);
  expect(seen[0]).toMatch(/^\d+% (outline|overview)$/);
});
