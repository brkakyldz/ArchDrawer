import { expect, test, type Page } from "@playwright/test";
import { onDisk, open, zoom } from "./helpers";

/**
 * Dragging (ui contract, Dragging): what a drag moves, its lifted look and its one save.
 * Defers to H167 (the same journey with numbered steps and colours) and H19 (regrouping);
 * this file keeps the stricter checks: every label box and the frame are compared on each
 * move, and the part's box size is compared during and after the drag.
 */

const node = (id: string, x: number, y: number, parent: string | null = null) => ({
  id, label: id === "zone" ? "Processing zone" : `Part ${id}`, kind: "service", form: id === "zone" ? "group" : "card", icon: null, sub: "",
  items: [], description: `Does ${id}.`, files: [], parent, detail: null, place: null, ...(id === "zone" ? {} : { x, y }),
});
const file = () => ({
  schema: "archdraw/diagram@2", title: "Drag",
  views: [{
    id: "overview", title: "Overview", caption: { title: "Drag", lede: "" }, texts: [],
    nodes: [node("a", 0, 0), node("b", 400, 0), node("zone", 0, 0), node("c", 400, 400, "zone"), node("d", 700, 400, "zone"), node("e", 1100, 430)],
    edges: [
      { id: "ab", from: "a", to: "b", label: "hands over", style: "call", both: false, step: null },
      { id: "cd", from: "c", to: "d", label: "inside", style: "call", both: false, step: null },
      { id: "ed", from: "e", to: "d", label: "notes", style: "call", both: false, step: null },
    ],
  }],
});

type Box = { x: number; y: number; width: number; height: number };
const boxOf = async (page: Page, testId: string): Promise<Box> => (await page.getByTestId(testId).boundingBox())!;
const marks = (page: Page) => page.getByTestId("canvas").evaluate((root) => {
  const ids = (sel: string) => Array.from(root.querySelectorAll(sel)).map((n) => n.getAttribute("data-testid")!).sort();
  return {
    lifted: ids('[data-lifted="true"]'), dimParts: ids('[data-kind][data-drag-dim="true"]'),
    dimEdges: ids('[data-style][data-drag-dim="true"]'), focus: ids('[data-style][data-focus="true"]'),
  };
});
const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a.width - b.width) < 0.6 && Math.abs(a.height - b.height) < 0.6;

test("a drag moves only the part and its own line, lifts it, dims the rest and saves once after release", async ({ page }) => {
  const { path } = await open(page, file());
  const puts: string[] = [];
  page.on("request", (r) => { if (r.method() === "PUT" && /\/api\/diagrams\//.test(r.url())) puts.push(r.url()); });
  const z = await zoom(page);
  const still = { label: await boxOf(page, "edge-label-ab"), inside: await boxOf(page, "edge-label-cd"), zone: await boxOf(page, "node-zone"), size: await boxOf(page, "node-e") };
  const lineAb = await page.getByTestId("edge-ab").locator("path.line").first().getAttribute("d");

  const e = await boxOf(page, "node-e");
  await page.mouse.move(e.x + e.width / 2, e.y + 20);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(e.x + e.width / 2 - i * 100 * z, e.y + 20 + i * 4 * z);
    // Across the group: nothing but e and its own line moves, and nothing is saved.
    expect(near(await boxOf(page, "edge-label-ab"), still.label), `move ${i}: another label stays`).toBe(true);
    expect(near(await boxOf(page, "edge-label-cd"), still.inside), `move ${i}: the label inside the group stays`).toBe(true);
    expect(near(await boxOf(page, "node-zone"), still.zone), `move ${i}: the group's frame stays`).toBe(true);
    if (i === 5) await page.waitForTimeout(500);
  }
  expect(await page.getByTestId("edge-ab").locator("path.line").first().getAttribute("d")).toBe(lineAb);
  expect(await marks(page)).toEqual({
    lifted: ["node-e"], dimParts: ["node-a", "node-b", "node-c", "node-d", "node-zone"], dimEdges: ["edge-ab", "edge-cd"], focus: ["edge-ed"],
  });
  const lifted = await boxOf(page, "node-e");
  expect(Math.abs(lifted.width - still.size.width) + Math.abs(lifted.height - still.size.height), "the lifted part keeps its size").toBeLessThan(0.1);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  expect(puts).toHaveLength(0);

  await page.mouse.up();
  await expect.poll(() => puts.length).toBe(1);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.waitForTimeout(800);
  expect(puts).toHaveLength(1);
  expect(await marks(page)).toEqual({ lifted: [], dimParts: [], dimEdges: [], focus: [] });
  const after = await boxOf(page, "node-e");
  expect(Math.abs(after.width - still.size.width) + Math.abs(after.height - still.size.height), "and after release").toBeLessThan(0.1);
  const moved = onDisk(path).views[0].nodes.find((n) => n.id === "e")!;
  expect(moved.x).toBeLessThan(1100 - 500);
  expect(moved.x % 8).toBe(0);

  // One undo step brings it back.
  await page.getByTestId("tool-undo").click();
  await expect.poll(() => onDisk(path).views[0].nodes.find((n) => n.id === "e")!.x).toBe(1100);
});
