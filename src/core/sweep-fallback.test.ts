import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DiagramView } from "./model";

// LAYOUT-6 step 5 (diagram contract, Layout): the reordered layout is kept only when it draws no more crossings than
// the one without steps 2–4. No fixture or random view found has a sweep that draws more (review 6adef2e-3: 5,500 random
// views, every differing sweep drew fewer), so the drawn count is stubbed here: the first count step 5 takes is the
// reordered layout's, the second the plain one's.
const counts = vi.hoisted(() => ({ next: [] as number[] }));
vi.mock("./geometry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./geometry")>();
  return { ...real, countCrossings: (...a: Parameters<typeof real.countCrossings>) => (counts.next.length ? counts.next.shift()! : real.countCrossings(...a)) };
});
const { layoutOnce, layoutView } = await import("./layout");
const { fillDefaults } = await import("./model");

const hotel = () => {
  const v = fillDefaults(JSON.parse(readFileSync("tests/fixtures/hotel.archdraw.json", "utf8"))).views[0] as DiagramView;
  return { ...v, nodes: v.nodes.map(({ x: _x, y: _y, ...n }) => ({ ...n, place: null })) };
};
const at = (lv: { nodes: { id: string; x: number; y: number }[] }) => lv.nodes.map((n) => [n.id, n.x, n.y]);

describe("step 5: the reordered layout only when it draws no more crossings", () => {
  it("draws more: the plain layout is used", () => {
    const bare = hotel(), plain = layoutOnce(bare, { reorder: false, post: false }), sweep = layoutOnce(bare, { post: false });
    expect(at(sweep)).not.toEqual(at(plain));
    counts.next = [5, 4];
    expect(at(layoutView(bare))).toEqual(at(plain));
    expect(counts.next).toEqual([]);
  });

  it("draws as many or fewer: the reordered layout is kept", () => {
    const bare = hotel(), sweep = layoutOnce(bare, { post: false });
    counts.next = [4, 4];
    expect(at(layoutView(bare))).toEqual(at(sweep));
    counts.next = [3, 4];
    expect(at(layoutView(bare))).toEqual(at(sweep));
  });
});
