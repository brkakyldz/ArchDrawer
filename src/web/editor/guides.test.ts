import { describe, expect, it } from "vitest";
import { snapDrag } from "./guides";

// EDIT-5 (ui contract, Dragging: Guides and snapping): the matcher a drag asks where the dragged box snaps to.
const box = (x: number, y: number, w = 100, h = 60) => ({ x, y, w, h });

describe("guides and snapping while dragging (#168)", () => {
  it("snaps an edge, a centre or the far edge to another box's within 6 screen px, and shows the line", () => {
    const other = box(0, 0);
    // Left to left: 4 px off at 100 % (boxes of one size tie on all three lines: the centres show).
    expect(snapDrag(box(4, 300), [other], 1)).toMatchObject({ dx: -4, guides: [{ axis: "x", at: 50 }] });
    expect(snapDrag(box(4, 300, 40), [other], 1)).toMatchObject({ dx: -4, guides: [{ axis: "x", at: 0 }] });
    // Centre to centre: the dragged box is 40 wide, its centre 3 px right of the other's.
    expect(snapDrag(box(33, 300, 40), [other], 1)).toMatchObject({ dx: -3, guides: [{ axis: "x", at: 50 }] });
    // Right to right in y: a horizontal line.
    const s = snapDrag(box(400, 5, 100, 20), [other], 1);
    expect(s).toMatchObject({ dy: -5, guides: [{ axis: "y", at: 0 }] });
    // The line runs from the other box to the dragged one.
    expect(s.guides[0]).toMatchObject({ from: 0, to: 500 });
  });

  it("the reach is 6 screen px: 6 drawing px at 100 %, 3 at 200 %, 12 at 50 %", () => {
    const other = box(0, 0);
    expect(snapDrag(box(6, 300), [other], 1).guides).toHaveLength(1);
    expect(snapDrag(box(7, 300), [other], 1).guides).toHaveLength(0);
    expect(snapDrag(box(3, 300), [other], 2).guides).toHaveLength(1);
    expect(snapDrag(box(4, 300), [other], 2).guides).toHaveLength(0);
    expect(snapDrag(box(12, 300), [other], 0.5).guides).toHaveLength(1);
    expect(snapDrag(box(13, 300), [other], 0.5).guides).toHaveLength(0);
  });

  it("between two boxes in a row it snaps so the gaps are equal, and marks both", () => {
    // Gaps 98 and 102 around the dragged box: it moves 2 right, both become 100.
    const s = snapDrag(box(198, 1000), [box(0, 1000), box(400, 1000)], 1);
    expect(s.dx).toBe(2);
    expect(s.gaps.map((g) => [g.axis, g.size])).toEqual([["x", 100], ["x", 100]]);
    // Gaps that differ by more than 6 px are not equalled.
    expect(snapDrag(box(190, 1000), [box(0, 1000), box(400, 1000)], 1).gaps).toEqual([]);
  });

  it("a line wins a tie with equal gaps, and the nearer wins otherwise", () => {
    // Gaps 98 and 102 (equal after 2 px right) and a third box's left edge 2 px right: a tie, the line.
    const tie = snapDrag(box(198, 1000), [box(0, 1000), box(400, 1000), box(200, 0)], 1);
    const xs = (g: { axis: string }[]) => g.filter((x) => x.axis === "x");
    expect(xs(tie.guides)).toMatchObject([{ axis: "x", at: 250 }]); expect(xs(tie.gaps)).toEqual([]);
    // The same gaps and a left edge 3 px left: the gaps are nearer.
    const near = snapDrag(box(198, 1000), [box(0, 1000), box(400, 1000), box(195, 0)], 1);
    expect(xs(near.guides)).toEqual([]); expect(xs(near.gaps)).toHaveLength(2); expect(near.dx).toBe(2);
  });

  it("with no snap in an axis the position snaps to the 8 px grid, in whole pixels", () => {
    const s = snapDrag(box(203.4, 1003.7), [], 1);
    expect([s.dx + 203.4, s.dy + 1003.7].map((v) => Math.round(v * 1000) / 1000)).toEqual([200, 1000]);
  });

  it("Alt: nothing snaps and no mark shows; the position stays a whole pixel", () => {
    const s = snapDrag(box(4.4, 300.6), [box(0, 0)], 1, true);
    expect(s.guides).toEqual([]); expect(s.gaps).toEqual([]);
    expect([4.4 + s.dx, 300.6 + s.dy].map((v) => Math.round(v * 1000) / 1000)).toEqual([4, 301]);
  });
});
