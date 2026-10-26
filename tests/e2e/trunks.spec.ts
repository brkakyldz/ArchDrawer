import { expect, test } from "@playwright/test";
import { open, shop } from "./helpers";

// #174 (diagram contract, Trunks): no held-out scenario names trunks. What stays here is the editor and the export
// drawing the same trunk: the same members, the same path, one arrowhead.

const part = (id: string, x: number, y: number) =>
  ({ id, label: id.toUpperCase(), kind: "service", form: "card", icon: null, sub: "", items: [], description: "A part.", files: [], parent: null, detail: null, place: null, x, y });

test("a trunk is the same in the editor and the exported image", async ({ page }) => {
  const { id } = await open(page, shop((f) => {
    f.views[0].nodes = [part("a", 0, 0), part("b", 260, 0), part("c", 520, 0), part("hub", 260, 1200)];
    f.views[0].edges = ["a", "b", "c"].map((s) => ({ id: `${s}-hub`, from: s, to: "hub", label: "", style: "dep", both: false, step: null }));
  }));
  const trunk = page.locator('[data-testid="canvas"] [data-trunk]');
  await expect(trunk).toHaveCount(1);
  await expect(trunk).toHaveAttribute("data-trunk", "hub:t");
  await expect(trunk).toHaveAttribute("data-edges", "a-hub b-hub c-hub");
  const editorD = await trunk.locator("path.line").getAttribute("d");
  // No member draws its own arrowhead at the hub.
  for (const e of ["a-hub", "b-hub", "c-hub"]) expect(await page.getByTestId(`edge-${e}`).locator("path.line").getAttribute("marker-end"), e).toBeNull();
  const svg = await (await page.request.get(`/api/diagrams/${id}/export.svg?view=overview&format=readme`)).text();
  const exported = /<g data-trunk="hub:t" data-edges="a-hub b-hub c-hub"[^>]*>[\s\S]*?<path class="line" d="([^"]+)"/.exec(svg);
  expect(exported, "the export has the same trunk").toBeTruthy();
  expect(exported![1]).toBe(editorD);
});

// Review bb42c16-1: the trunk fades as its connections do, at overview zoom (ui contract, Semantic zoom).
test("a trunk fades with its connections at overview zoom", async ({ page }) => {
  await open(page, shop((f) => {
    f.views[0].nodes = [part("a", 0, 0), part("b", 260, 0), part("c", 520, 0), part("hub", 260, 1200)];
    f.views[0].edges = ["a", "b", "c"].map((s) => ({ id: `${s}-hub`, from: s, to: "hub", label: "", style: "dep", both: false, step: null }));
  }));
  for (let i = 0; i < 12 && parseInt(await page.getByTestId("zoom-level").innerText(), 10) >= 45; i++) await page.getByTestId("zoom-out").click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-detail", "overview");
  const opacity = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity);
  await expect.poll(() => opacity('[data-testid="edge-a-hub"]')).toBe("0.3");
  await expect.poll(() => opacity('[data-testid="trunk"]')).toBe("0.3");
});

// Review 98baaf0-1: while a part it carries none of is dragged, the trunk dims with its connections (ui contract, Dragging).
test("a trunk dims with its connections while another part is dragged", async ({ page }) => {
  await open(page, shop((f) => {
    f.views[0].nodes = [part("a", 0, 0), part("b", 260, 0), part("c", 520, 0), part("hub", 260, 1200), part("x", 900, 600)];
    f.views[0].edges = ["a", "b", "c"].map((s) => ({ id: `${s}-hub`, from: s, to: "hub", label: "", style: "dep", both: false, step: null }));
  }));
  const x = await page.getByTestId("node-x").boundingBox();
  await page.mouse.move(x!.x + x!.width / 2, x!.y + 12);
  await page.mouse.down();
  await page.mouse.move(x!.x + x!.width / 2 + 60, x!.y + 40, { steps: 6 });
  await expect(page.getByTestId("edge-a-hub")).toHaveAttribute("data-drag-dim", "true");
  await expect(page.getByTestId("trunk")).toHaveAttribute("data-drag-dim", "true");
  await page.mouse.up();
  await expect(page.getByTestId("trunk")).not.toHaveAttribute("data-drag-dim", /.+/);
});
