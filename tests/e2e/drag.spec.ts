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
  // e stays selected, so its own line stays in focus (ui contract, Connections in focus); the drag marks are gone.
  expect(await marks(page)).toEqual({ lifted: [], dimParts: [], dimEdges: [], focus: ["edge-ed"] });
  const after = await boxOf(page, "node-e");
  expect(Math.abs(after.width - still.size.width) + Math.abs(after.height - still.size.height), "and after release").toBeLessThan(0.1);
  const moved = onDisk(path).views[0].nodes.find((n) => n.id === "e")!;
  expect(moved.x).toBeLessThan(1100 - 500);
  // Release keeps where it was dropped, in whole pixels (the 8 px grid is the drag's own snap, ui contract, Dragging).
  expect(Number.isInteger(moved.x) && Number.isInteger(moved.y)).toBe(true);

  // One undo step brings it back.
  await page.getByTestId("tool-undo").click();
  await expect.poll(() => onDisk(path).views[0].nodes.find((n) => n.id === "e")!.x).toBe(1100);
});

test("while dragging, the group a release would join is marked; outside every group none is, and after release none is; the drop covers nothing (#167)", async ({ page }) => {
  const { path } = await open(page, file());
  const target = () => page.getByTestId("canvas").evaluate((root) => Array.from(root.querySelectorAll('[data-drop-target="true"]')).map((n) => n.getAttribute("data-testid")));
  const e = await boxOf(page, "node-e"), c = await boxOf(page, "node-c"), zone = await boxOf(page, "node-zone");
  const from = { x: e.x + e.width / 2, y: e.y + e.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Over the zone, between its members: the zone is the target, with its ring.
  const over = { x: c.x + c.width + 20, y: c.y + c.height / 2 };
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((over.x - from.x) * i) / 8, from.y + ((over.y - from.y) * i) / 8);
  await expect.poll(target).toEqual(["node-zone"]);
  await expect(page.getByTestId("drop-target-ring")).toHaveCount(1);
  // Far below every group: no target.
  const away = { x: over.x, y: zone.y + zone.height + 400 };
  for (let i = 1; i <= 6; i++) await page.mouse.move(over.x, over.y + ((away.y - over.y) * i) / 6);
  await expect.poll(target).toEqual([]);
  await expect(page.getByTestId("drop-target-ring")).toHaveCount(0);
  // Back over the zone and released: none is marked, the part joined the zone and covers neither member.
  for (let i = 1; i <= 6; i++) await page.mouse.move(over.x, away.y + ((over.y - away.y) * i) / 6);
  await expect.poll(target).toEqual(["node-zone"]);
  await page.mouse.up();
  await expect.poll(target).toEqual([]);
  await expect(page.getByTestId("node-e")).toHaveAttribute("data-parent", "zone");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const after = await boxOf(page, "node-e");
  for (const id of ["node-c", "node-d", "node-a", "node-b"]) expect(overlap(after, await boxOf(page, id)), id).toBe(false);
  await expect.poll(() => onDisk(path).views[0].nodes.find((n) => n.id === "e")?.parent).toBe("zone");
});
