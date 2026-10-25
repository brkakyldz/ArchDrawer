import { expect, test, type Page } from "@playwright/test";
import { open, shop } from "./helpers";

// #165 (diagram contract, While dragging): H170 observes the held sides and the stateless routes after release. What
// stays here is the glide it does not observe: when an end's side changes during a drag, the line passes through
// in-between curves over about 120 ms; when the part only carries its ends, the line follows it with no glide.

const part = (id: string, x: number, y: number) =>
  ({ id, label: id.toUpperCase(), kind: "service", form: "card", icon: null, sub: "", items: [], description: "A part.", files: [], parent: null, detail: null, place: null, x, y });

/** Every frame's `d` of the connection's line for `ms` after `act`, consecutive repeats dropped. */
async function framesOf(page: Page, act: () => Promise<void>, ms = 500): Promise<string[]> {
  await page.evaluate((ms) => {
    const w = window as unknown as { __ds: (string | null)[] };
    w.__ds = [];
    const t0 = performance.now();
    const frame = () => {
      w.__ds.push(document.querySelector('[data-testid="edge-ab"] path.line')?.getAttribute("d") ?? null);
      if (performance.now() - t0 < ms) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, ms);
  await act();
  await page.waitForTimeout(ms + 100);
  const all = await page.evaluate(() => (window as unknown as { __ds: string[] }).__ds);
  return all.filter((d, i) => i === 0 || d !== all[i - 1]);
}

test("an end glides when its side changes during a drag, and follows its part otherwise", async ({ page }) => {
  await open(page, shop((f) => {
    f.views[0].nodes = [part("a", 0, 0), part("b", 300, 0)];
    f.views[0].edges = [{ id: "ab", from: "a", to: "b", label: "", style: "call", both: false, step: null }];
  }));
  const line = page.locator('[data-testid="edge-ab"] path.line');
  const b = (await page.getByTestId("node-b").boundingBox())!;
  let x = b.x + b.width / 2, y = b.y + 12;
  // Alt: no guides and no grid, so the part moves exactly with the pointer.
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, (y += 10), { steps: 2 });
  await page.waitForTimeout(300);

  // Carried: a small move keeps the sides; the line goes straight to its new curve.
  const carried = await framesOf(page, () => page.mouse.move(x, (y += 12)));
  expect(carried.length, `carried: ${carried.join(" | ")}`).toBe(2);

  // Far down, the bottom/top pair is clearly cheaper: the sides change and the end glides through in-between curves.
  const flipped = await framesOf(page, () => page.mouse.move(x, (y += 420)));
  expect(flipped.length, `glide: ${flipped.length} curves`).toBeGreaterThanOrEqual(4);
  expect(flipped[flipped.length - 1]).toBe(await line.getAttribute("d"));

  await page.mouse.up();
  await page.keyboard.up("Alt");
});
