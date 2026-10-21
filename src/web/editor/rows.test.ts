import { describe, expect, it } from "vitest";
import { ROW_CAPS, rowOf } from "./rows";

describe("a panel's rows in the callout", () => {
  const node = { items: ["Propose a tool", "Plain item", "Stops after twelve turns, whatever the model says"], heldIds: ["propose"], limitIds: ["turns"] };

  it("are held rows, then items, then limits", () => {
    expect(node.items.map((_, i) => rowOf(node, i))).toEqual(["held", "item", "limit"]);
    expect(rowOf({ items: ["a"] }, 0)).toBe("item");
  });

  it("each keep their own fact's cap, so a valid limit text is never cut to an item's", () => {
    expect(node.items[2].length).toBeGreaterThan(ROW_CAPS.item);
    expect(node.items[2].length).toBeLessThanOrEqual(ROW_CAPS[rowOf(node, 2)]);
    expect(ROW_CAPS).toEqual({ held: 48, item: 44, limit: 60 });
  });
});
